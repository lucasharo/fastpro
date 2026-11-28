# Desenho técnico H-006 — Auditoria append-only (Issue #19, WF-03, Arquitetura)

Decisão: **APROVADO_ARQUITETURA** (com 3 pontos de interpretação não bloqueantes na §7).
Rastro: 22-REFINO-H006 (CA-01 a CA-14); 08 §4.2, §7 (mesma transação), §13; 09 `audit_event`, §6, §7; ADR-012; I-15; B-08 (17 §4.7); R-22. Padrões reaproveitados: migrações `20261110120000` (baseline, papéis `app_api`/`app_system`) e `20261110130000` (H-005: funções em `private`, `set search_path = ''`, RLS habilitada e forçada sem políticas, revoke explícito, rollback manual em `supabase/rollbacks/`).

## 0. Resumo do desenho

- Tabela `audit.audit_event` (esquema `audit`, já existente) + `audit.chain_head` (cabeça da cadeia, 1 linha) + `audit.action_catalog` (catálogo de ações com chaves de estado permitidas).
- **Única porta de escrita:** `private.audit_append(...)` (SECURITY DEFINER, `search_path` vazio), chamada na mesma transação da ação. `app_api`/`app_system` **não têm INSERT direto**; só EXECUTE na função.
- **Quem sela a linha é o banco:** um trigger BEFORE INSERT (`ENABLE ALWAYS`) atribui `seq`, `at`, `prev_hash`, `row_hash` (valores do chamador são sobrescritos). Mesmo um INSERT direto de dono produz uma cadeia válida.
- **Append-only em 3 camadas:** (1) sem privilégio UPDATE/DELETE/TRUNCATE para ninguém além do dono; (2) triggers `ENABLE ALWAYS` que bloqueiam UPDATE, DELETE e TRUNCATE até para o dono; (3) detecção por hash (`private.audit_verify_chain`).
- **Concorrência:** a linha única de `audit.chain_head` é travada com `FOR UPDATE` até o COMMIT; a cadeia é linear, sem lacunas e sem bifurcação (mesma ordem de commit e de `seq`).
- **Sem PII:** estado só com chaves permitidas por ação (allowlist no catálogo, coerente com 08 §14), valores escalares restritos a um alfabeto sem `@`/espaço, mais lista global de chaves proibidas como defesa em profundidade. Violação é **rejeitada** (nunca redigida em silêncio).

## 1. Modelo de dados

### 1.1 `audit.audit_event`

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `uuid` PK, `default gen_random_uuid()` | identificador do evento (09) |
| `seq` | `bigint not null unique` | posição na cadeia, **sem lacunas** (não é `identity`: sequence tem lacunas em rollback); `check (seq >= 1)`; atribuída pelo trigger |
| `at` | `timestamptz not null` | `clock_timestamp()` do banco, UTC, atribuída pelo trigger depois de obter o lock (monótona na cadeia) |
| `actor_ref` | `text not null` | `check (actor_ref ~ '^(customer\|professional\|admin\|system):[A-Za-z0-9_-]{1,64}$')` (ID pseudônimo; o formato exclui e-mail) |
| `actor_role` | `text not null` | `check (actor_role ~ '^[a-z][a-z0-9_]{0,31}$')` (`cliente`, `profissional`, `auditor`, `superadmin`, `system`...; a lista fechada vem de H-102, por isso só formato) |
| `action` | `text not null` | FK composta `(action, object_type)` → `audit.action_catalog(action, object_type)`, `ON DELETE RESTRICT` |
| `object_type` | `text not null` | `check (~ '^[a-z][a-z0-9_]{0,63}$')` |
| `object_id` | `uuid not null` | |
| `before_state` | `jsonb not null` | `{}` quando o objeto não existia; `check (private.audit_state_is_valid(before_state))` |
| `after_state` | `jsonb not null` | idem |
| `reason_code` | `text` | `check (reason_code is null or reason_code ~ '^[a-z][a-z0-9_]{0,63}$')`; exigido quando `action_catalog.reason_required` (validação no trigger). **Sem texto livre** |
| `correlation_id` | `uuid` | opcional (CA-11 diz "dado uma ação com correlation_id"); se o parâmetro vier nulo, a função usa `current_setting('app.correlation_id', true)` (mesmo padrão do `app.principal_id`, 08 §4.2) |
| `hash_version` | `smallint not null default 1` | versão do algoritmo (permite evoluir sem quebrar a cadeia antiga) |
| `prev_hash` | `char(64) not null` | `check (~ '^[0-9a-f]{64}$')`; gênese = 64 zeros |
| `row_hash` | `char(64) not null unique` | idem |

CHECKs adicionais: `(actor_ref like 'system:%') = (actor_role = 'system')`; `pg_column_size(before_state) <= 4096` e idem `after_state` (protege R-22: 0,5–1 KB/evento).

Índices (09 §índices): `unique(seq)`, `(object_type, object_id, at)`, `(actor_ref, at)`. `correlation_id` indexado só quando H-104 precisar.

Segurança de tabela (regra do baseline): `enable` + `force row level security`, **sem políticas** (nega tudo a quem não ignora RLS). Idem para `chain_head` e `action_catalog`.

### 1.2 `audit.chain_head`

`id boolean primary key default true check (id)`, `last_seq bigint not null default 0`, `last_hash char(64) not null default repeat('0',64)`, `updated_at timestamptz`. Uma única linha criada na migração. Triggers: UPDATE só se `new.last_seq = old.last_seq + 1`; DELETE e TRUNCATE bloqueados.

### 1.3 `audit.action_catalog` (CA-14)

`action text pk` (`^[a-z][a-z0-9_.]{0,99}$`), `object_type text not null`, `reason_required boolean not null`, `state_keys text[] not null` (chaves permitidas em `before/after_state`; CHECK: nenhuma está na lista proibida), `active boolean default true`, `description text`, `unique(action, object_type)`. Alterado **somente por migração** (cada história consumidora acrescenta sua ação e suas chaves). Sem grants para papéis de aplicação.

Semente inicial (CA-14; chaves são PROPOSTA e podem ser ampliadas pelo consumidor):

| action | object_type | reason | state_keys |
|---|---|---|---|
| `professional.suspended` | `professional_profile` | sim | `status`, `suspension_kind`, `until_at`, `approval_request_id` |
| `review.revised` | `review` | sim | `status`, `visible`, `moderation_case_id` |
| `completion.corrected` | `service_request` | sim | `status`, `selected_acceptance_id`, `completed_at`, `support_case_id` |
| `payment.refunded` | `payment` | sim | `status`, `refund_amount_cents`, `currency`, `approval_request_id` |
| `consent.changed` | `contact_consent` | não | `scope`, `granted`, `consent_text_version`, `acceptance_id` |

Reservadas, **não semeadas aqui** (cada história liga o seu): `verification.decided` (H-039), `selection.changed` (H-076), `access_case.opened` (H-073), `catalog.changed` (H-107).

`reason_code` sugerido (apenas convenção; o banco valida o formato): `policy_violation`, `fraud_suspected`, `user_request`, `error_correction`, `chargeback`, `consent_granted`, `consent_revoked`, `judicial_order`, `other`.

### 1.4 Sem PII no estado (CA-09)

`private.audit_state_is_valid(jsonb) returns boolean` (IMMUTABLE), usada em CHECK:
1. objeto **plano** (`jsonb_typeof = 'object'`), valores escalares (número, booleano, nulo ou string); sem objetos/arrays aninhados;
2. string: até 64 caracteres, `^[A-Za-z0-9_.:-]*$` (sem `@`, espaço, `+`, `/`: e-mail, nome com sobrenome, texto de chat e endereço não cabem); rejeita string só de dígitos com 10–15 caracteres (telefone/CPF/CNPJ sem máscara; números devem ser números JSON) e o padrão `^\d{3}\.\d{3}\.\d{3}-\d{2}$`;
3. chave **não pode** conter (regra da correção F-1, migração `20261110150000_audit_fix_forbidden_keys`, espelho `isForbiddenStateKey`). Normalização: `camelCase` vira palavras (separadas por `_`), minúsculas, e `_ . -` são fronteira de palavra.
   - **termos longos** como substring da chave sem separadores: `email`, `mail`, `telefone`, `phone`, `celular`, `whatsapp`, `cpf`, `cnpj`, `documento`, `endereco`, `addr` (cobre `address` e `ipaddr`), `logradouro`, `latitude`, `longitude`, `useragent`, `mensagem`, `message`, `senha`, `password`, `token`, `secret`, `birth`, `nascimento`, `fullname`, `username`, `firstname`, `lastname`, `nome`;
   - **termos curtos** como palavra em **qualquer** posição: `rg`, `name`, `cep`, `lat`, `lng`, `ip`, `body`, `conteudo`, `content`;
   - `text` / `texto` como palavra em qualquer posição, **exceto** quando a última palavra é `version` / `versao` (identificador de versão, ex.: `consent_text_version`).

Validação adicional no trigger: toda chave de `before/after_state` ∈ `action_catalog.state_keys` da ação (allowlist). Violação: `raise exception ... errcode 'AU002'` (nunca redige).

## 2. Hash encadeado (CA-08)

- **Algoritmo:** SHA-256 nativo (`sha256(bytea)`, PostgreSQL 11+; **sem `pgcrypto`**), saída `encode(..., 'hex')` minúsculo.
- **Entrada (`hash_version = 1`)**, texto UTF-8 com campos separados por `\n` (nenhum campo pode conter `\n`: formatos por regex; JSON escapa quebra de linha), nesta ordem:
  `'v1'`, `seq`, `id`, `at` (UTC: `to_char(at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`), `actor_ref`, `actor_role`, `action`, `object_type`, `object_id`, `canon(before_state)`, `canon(after_state)`, `coalesce(reason_code,'')`, `coalesce(correlation_id::text,'')`, `prev_hash`.
  Cobre todas as colunas exceto `row_hash`; `prev_hash` dentro da entrada cria o encadeamento.
- **Canonicalização do estado:** objeto plano → chaves em ordem bytewise (`COLLATE "C"`), `{` + `to_json(chave)::text || ':' || valor::text` unidos por `,` + `}`. Definida em `private.audit_canonical_state(jsonb)` e replicada em TS (§5) para teste de paridade.
- **Gênese:** `prev_hash` do `seq = 1` = 64 zeros (`chain_head.last_hash` inicial).
- **Cálculo único:** `private.audit_row_hash(...)` é usada pelo trigger de selagem e pela verificação (uma só definição).
- **Verificação:** `private.audit_verify_chain(p_from_seq bigint default 1, p_to_seq bigint default null)` retorna `(ok boolean, checked bigint, first_bad_seq bigint, reason text)`. Checa: `seq` contíguo (`lacuna_seq`), `prev_hash` = `row_hash` do anterior (`prev_hash_divergente`), recálculo de `row_hash` (`row_hash_divergente`), gênese e, quando `p_to_seq` é nulo, `chain_head` = última linha (`cabeca_divergente`; detecta remoção do final). Consulta de leitura, SECURITY INVOKER; EXECUTE só para `app_system` (consulta pelo Auditor é H-104). Faixa parcial ancora na linha `p_from_seq - 1`.

## 3. Gravação: interface única (CA-01..04, CA-13)

```sql
private.audit_append(
  p_actor_ref text, p_actor_role text, p_action text,
  p_object_type text, p_object_id uuid,
  p_before_state jsonb, p_after_state jsonb,
  p_reason_code text default null, p_correlation_id uuid default null
) returns uuid           -- id do evento
-- SECURITY DEFINER; set search_path = ''; set lock_timeout = '5s'
-- revoke execute from public, anon, authenticated, service_role; grant execute to app_api, app_system;
-- grant usage on schema private to app_api (app_system já tem, H-005).
```

Contrato:
1. Apenas monta a linha e faz `INSERT` (colunas de selo omitidas). O trigger `audit.tg_event_seal` (BEFORE INSERT, FOR EACH ROW, `ENABLE ALWAYS`) valida catálogo/chaves/`reason_required`, obtém `chain_head ... FOR UPDATE`, atribui `seq = last_seq + 1`, `at = clock_timestamp()`, `prev_hash = last_hash`, `row_hash`, e atualiza `chain_head`. Valores de `seq/at/prev_hash/row_hash` enviados pelo chamador são **sobrescritos** (caso negativo 8).
2. **Falha fecha a transação:** qualquer erro (catálogo, PII, lock_timeout, constraint) é propagado. O consumidor **não pode** envolver a chamada em `EXCEPTION`/savepoint que engula o erro (regra de revisão B-08). Sem auditoria gravada, sem ação (CA-03); ação que falha depois reverte a auditoria e o avanço de `chain_head` (CA-04).
3. **Mesma transação:** a função não abre transação própria; roda no `BEGIN`/`COMMIT` do chamador. Padrão para as histórias: a função de domínio (ex.: `accept_work`) chama `private.audit_append` internamente, ou o repositório TS usa a mesma conexão/transação (`appendAudit(tx, ...)`, §5). Nunca por outra conexão/pool.
4. **Ordem recomendada:** `audit_append` como **última** escrita antes do COMMIT (depois dos locks de domínio §7.1 e do outbox): reduz o tempo com o lock da cadeia e evita deadlock (ordem de aquisição fixa: domínio, depois cadeia). Sem custo para a regra da 08 §7 (tudo na mesma transação).
5. Em `REPEATABLE READ`/`SERIALIZABLE` o `FOR UPDATE` concorrente falha com `40001`: o chamador repete a transação inteira (idempotência 08 §7.5). Em `READ COMMITTED` (padrão) a segunda transação espera e relê a cabeça confirmada.

## 4. Travas e privilégios (CA-05..07, 11 do refino §2)

| Camada | Medida |
|---|---|
| Privilégio | `revoke all` em `audit.*` de PUBLIC/anon/authenticated/service_role/app_api/app_system. `app_system`: somente `SELECT` em `audit.audit_event` (verificação). `app_api`: **nenhum** privilégio de tabela, **e continua assim após a H-104**: a leitura pelo Auditor é por função `security definer` em `app_system` (`private.audit_query`, 63-DESENHO-H104 §1), alinhada a 54-DESENHO-H102 §1; não há `SELECT` nem política `audit.read` para `app_api` (decisão de 2026-11-11, substitui o texto anterior). Nenhum papel de aplicação recebe INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER. `chain_head` e `action_catalog`: nenhum grant |
| Trigger | `tg_block_mutation`: BEFORE UPDATE OR DELETE FOR EACH ROW e BEFORE TRUNCATE FOR EACH STATEMENT, `RAISE ... ERRCODE 'AU001'`; `ENABLE ALWAYS` (dispara também com `session_replication_role = replica`). `AU001` é distinto de `42501` para não poluir a métrica de negações de RLS (08 §14) |
| Detecção | `audit_verify_chain` (§2) |
| Governança | teste de catálogo no CI reprova migração que remova trigger, habilitação `ALWAYS` ou privilégio |

Observações:
- "Superadmin" e "Auditor" são papéis da aplicação: no banco usam `app_api`, que não tem privilégio; o trigger cobre também o dono.
- A tabela é toda de uso interno; `audit` nunca é exposto à Data API (baseline).
- Migração e rollback seguem H-005: arquivo `supabase/migrations/<ts>_audit_create_event_chain.sql` (idempotente) e `supabase/rollbacks/<ts>_audit_create_event_chain.down.sql` (manual, só em dev).

## 5. Contrato de código (TypeScript) e arquivos

- `packages/db/src/audit.ts` (espelho puro, estilo `platform.ts`): `AUDIT_ACTIONS` (constantes), `canonicalizeState`, `computeRowHash(fields)` (SHA-256 igual ao SQL), `assertAuditStateClean(state, allowedKeys)` (rejeição antecipada; o banco é a autoridade) e `appendAudit(tx, input)` que executa `select private.audit_append($1..$9)` num cliente já em transação (tipo `TxClient` marcado, para a API não chamar fora de transação).
- `packages/db/tests/audit.test.ts` (Vitest, sem banco) e `packages/db/tests/audit.dbtest.mjs` (banco, via `pnpm db:test`).
- Sem Docker nem pgTAP no projeto (supabase/README, pendência 2): os testes de banco são `*.dbtest.mjs` em Node, como H-003/H-005.

## 6. Testes para o DEV

**Regra de ouro dos testes de banco:** o banco de desenvolvimento é a nuvem compartilhada e as linhas de auditoria **não podem ser apagadas**; portanto todo teste roda em transação com `ROLLBACK` (nunca COMMIT), exceto o de estresse (T-23), que só roda em banco descartável. Todos os testes de auditoria ficam em **um** arquivo (o `node --test` roda arquivos em paralelo e o lock da cadeia serializaria testes de arquivos diferentes).

Unitários (Vitest, `audit.test.ts`):
- U-01 `computeRowHash` com vetor fixo (golden) e sensível a cada campo (alterar 1 campo muda o hash).
- U-02 `canonicalizeState`: ordem de chaves independente da entrada; números/booleanos/nulos.
- U-03 `assertAuditStateClean` rejeita e-mail, CPF com/sem máscara, telefone, chave proibida, aninhado, string > 64, chave fora da allowlist.
- U-04 encadeamento puro: lista de eventos válida passa; adulteração, lacuna e troca de ordem são detectadas (mesma regra de `audit_verify_chain`).
- U-05 `appendAudit` monta os 9 parâmetros na ordem e propaga erro sem engolir.

Banco (`audit.dbtest.mjs`; "catálogo" = somente leitura; "txn" = transação com rollback):
- Catálogo
  - D-01 `audit_event`, `chain_head`, `action_catalog` existem com RLS habilitada e forçada, sem políticas.
  - D-02 CA-07: para `anon`, `authenticated`, `service_role`, PUBLIC, `app_api`, `app_system`: UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER = false; INSERT = false; SELECT: `app_system` true, demais false. EXECUTE de `audit_append` true para `app_api`/`app_system`, false para o restante.
  - D-03 triggers `tg_block_mutation` (UPDATE/DELETE/TRUNCATE) e `tg_event_seal` existem, habilitados com `tgenabled = 'A'`.
  - D-04 (caso 11) falha se faltar trigger/privilégio: teste de catálogo comparando o conjunto esperado.
  - D-05 `audit_append` é SECURITY DEFINER com `proconfig` contendo `search_path=""`.
  - D-06 catálogo semeia exatamente as 5 ações do CA-14; nenhuma chave semeada está na lista proibida.
  - D-07 pré-condição: o dono da migração ignora RLS ou há política de INSERT que o permita (§7.3); se a verificação falhar, o teste explica a causa.
- Comportamento (txn)
  - T-01 CA-01 um exemplo por ação do catálogo (5): evento completo, 1 linha por chamada, `at` não nulo.
  - T-02 CA-08 três eventos: `seq` consecutivo, `prev_hash` = `row_hash` anterior, `row_hash` igual ao calculado em TS (paridade SQL×TS), `audit_verify_chain` retorna `ok`.
  - T-03 CA-02/04: ação (tabela temporária `on commit drop`) + auditoria; ROLLBACK ⇒ nenhum evento e `chain_head` igual ao inicial.
  - T-04 CA-03: ação executada, auditoria inválida (ação fora do catálogo) ⇒ erro; após ROLLBACK a ação não persiste.
  - T-05 CA-05/06: com `SET LOCAL ROLE` para `app_api`, `app_system`: UPDATE/DELETE/TRUNCATE ⇒ `42501`; como dono: UPDATE/DELETE/TRUNCATE ⇒ `AU001`; linha intacta. Repetir com `session_replication_role = replica` (continua negado, por `ALWAYS`).
  - T-06 caso 5: ator/ação/objeto nulos ou formato inválido ⇒ NOT NULL/CHECK; `actor_ref` com `@` rejeitado; `system:` com papel diferente de `system` rejeitado; `at` fornecido pelo chamador é sobrescrito pela hora do banco (CA-10: `at` entre `clock_timestamp()` antes e depois, e passado explícito de 2000-01-01 ignorado).
  - T-07 CA-09 / caso 7: e-mail, telefone, CPF (com e sem máscara), chave `email`, chave fora da allowlist, objeto aninhado ⇒ `AU002`; sem redação silenciosa.
  - T-08 caso 8: INSERT direto como dono com `seq`, `prev_hash`, `row_hash` forjados ⇒ valores calculados pelo banco prevalecem.
  - T-09 CA-11: `correlation_id` informado é gravado; nulo usa `app.correlation_id` da transação; ausente ⇒ nulo.
  - T-10 `reason_required`: ação com razão obrigatória sem `reason_code` ⇒ erro; `reason_code` fora do formato ⇒ erro.
  - T-11 caso 6: dentro da transação, dono faz `ALTER TABLE ... DISABLE TRIGGER tg_block_mutation`, altera `after_state` de uma linha, ⇒ `audit_verify_chain` retorna `row_hash_divergente` com `first_bad_seq` correto; idem alterar `prev_hash` (`prev_hash_divergente`), apagar linha do meio (`lacuna_seq`) e apagar a última (`cabeca_divergente`); ROLLBACK.
  - T-12 `chain_head`: UPDATE que não seja `+1`, DELETE e TRUNCATE ⇒ bloqueados.
  - T-13 caso 9: com `SET LOCAL ROLE app_api` (Auditor é apenas `app_api`), qualquer INSERT/UPDATE/DELETE direto em `audit.*` ⇒ `42501`.
  - T-14 `audit_append` com papel sem EXECUTE (`anon`) ⇒ `42501`.
- Concorrência (CA-12, caso 10; sem COMMIT)
  - T-20 duas conexões: A chama `audit_append` e fica aberta; B (`set local lock_timeout = '300ms'`) chama `audit_append` ⇒ `55P03` (prova serialização). A faz ROLLBACK; B repete e obtém o mesmo `seq` que A teria (sem lacuna). B faz ROLLBACK.
  - T-21 duas conexões em `REPEATABLE READ`: segunda falha com `40001` depois da confirmação da primeira (não bifurca). Requer commit ⇒ **somente banco descartável** (ver T-23).
  - T-22 chamada sem savepoint: erro de `audit_append` marca a transação como abortada (a ação não pode seguir).
  - T-23 (estresse, `AUDIT_ALLOW_COMMIT=1`, banco descartável/CI futuro; `skip` por padrão): 20 transações concorrentes com COMMIT ⇒ `audit_verify_chain` `ok`, `count = max(seq)`, sem `seq` duplicado. Pendência: depende de `ci-db.yml` (hoje desativado).

Regressão: o teste existente "nenhuma política nos esquemas do produto" e o de objetos fora do padrão (catalog.dbtest) continuam verdes; o novo `GRANT USAGE ON SCHEMA private` a `app_api` não pode abrir nenhuma outra função (conferir EXECUTE de todas as funções de `private` para `app_api` = apenas `audit_append`).

## 7. Interpretações e pontos para o Orquestrador (todos não bloqueantes)

1. **CA-07 "somente INSERT (e SELECT)":** este desenho é mais estrito: nenhum INSERT direto para papéis de aplicação, só EXECUTE em `audit_append` (impede dados forjados e burla do catálogo). Alternativa: conceder também INSERT em `audit_event`; segue seguro porque o trigger sela a linha, mas abre caminho paralelo ao CA-13. **Recomendação:** sem INSERT direto (o teste D-02 afirma INSERT = false).
2. **Caso negativo 5 "sem `at`":** como `at` é sempre atribuída pelo banco (CA-10), não existe evento sem `at`; o teste verifica NOT NULL no catálogo e que o valor do chamador é ignorado.
3. **Dono do banco e RLS forçada:** a função DEFINER roda como dono da migração (`postgres`). Se esse papel não tiver `BYPASSRLS`, o INSERT sob `FORCE ROW LEVEL SECURITY` seria negado. O DEV deve verificar `rolbypassrls` do papel de migração (D-07). Plano B: política `FOR INSERT TO <dono> WITH CHECK (true)` só em `audit_event`, com ajuste no teste "nenhuma política" para essa exceção documentada.
4. **Throughput:** a cadeia única serializa as auditorias (lock até o COMMIT). Volume esperado do MVP (ações críticas administrativas e consentimentos) cabe com folga; risco se consentimento virar evento de massa. Mitigação futura: cadeia por fatia (coluna `chain_id`), sem alterar o contrato da função. Não implementar agora.
5. **Particionamento mensal (09 PROPOSTA):** adiado, conforme dúvida 2 do refino. Se for feito depois, particionar por **faixa de `seq`** (não por `at`) para manter `unique(seq)` e `unique(row_hash)` válidos sem incluir a chave de partição.
6. **Ordem na 08 §7 ("auditoria, outbox"):** recomendado auditar por último (item 4 da §3); mudança de ordem dentro da mesma transação, sem impacto semântico.
7. **Leitura pelo Auditor (atualizado em 2026-11-11, H-104):** não há `SELECT` nem política `audit.read` para `app_api`; a leitura é a função `private.audit_query`, `security definer`, executável só por `app_system`, que revalida sessão e `audit.read` no banco e grava a própria consulta na trilha (63-DESENHO-H104). O teste D-02 permanece (`app_api` sem SELECT) e ganha o EXECUTE da nova função só para `app_system`.

## 8. Limites reconhecidos

- **Superusuário/dono contorna** o trigger (`ALTER TABLE ... DISABLE TRIGGER`, `DROP TABLE`, `ALTER TABLE`); `ENABLE ALWAYS` só impede o desvio por `session_replication_role`. No Supabase Free não há como impedir isso por privilégio. Mitigação: **detecção** por hash (`audit_verify_chain` reporta qualquer alteração ou remoção em linhas já encadeadas) e teste de catálogo no CI que reprova migração que enfraqueça as travas.
- **Quem controla o banco inteiro pode recalcular a cadeia desde o ponto alterado** e fazer a verificação passar. O hash prova integridade interna, não imutabilidade absoluta. Mitigação fora do escopo (refino §3): ancorar `chain_head.last_hash` em fonte externa (log estruturado diário, e-mail ao Auditor, assinatura). Recomendação de baixo custo para H-007/H-008: job que registra `seq` e `row_hash` da cabeça no log estruturado.
- **Truncar a cauda** só é detectado comparando com `chain_head` (e esta também é modificável pelo dono); a ancoragem externa cobre isso.
- **Backups e restauração** (rotação, retenção RC-07 / H-109 / BLQ-JUR L1): restaurar um backup antigo "perde" eventos; o hash detecta a lacuna em relação a âncoras externas, não sozinho.
- A allowlist de chaves e o alfabeto de valores reduzem, mas **não eliminam**, o risco de PII (um ID mal escolhido ou um valor `enum` sensível passa). A revisão de PR (17 §4.7) continua obrigatória a cada nova ação do catálogo.
- Retenção, anonimização de atores e expurgo da auditoria ficam para H-109 (o trigger de bloqueio precisará de uma exceção auditada e controlada; decisão futura, não desta história).
- Verificação completa é O(n): suficiente no MVP; para cadeias grandes, usar faixas (`p_from_seq`/`p_to_seq`).

## 9. Itens de implementação (ordem sugerida para o DEV)

1. Migração `audit_create_event_chain` (+ rollback manual): `audit_event`, `chain_head` (+ linha inicial), `action_catalog` (+ semente), funções `private.audit_state_is_valid`, `audit_canonical_state`, `audit_row_hash`, `audit_verify_chain`, `audit_append`, triggers `tg_event_seal`, `tg_block_mutation`, `tg_head_guard`, RLS enable+force, grants (§4), `ENABLE ALWAYS`.
2. `packages/db/src/audit.ts` + `audit.test.ts` (exportar em `src/index.ts`).
3. `packages/db/tests/audit.dbtest.mjs` (D-01..D-07, T-01..T-14, T-20..T-23).
4. Atualizar `supabase/README.md` (estado H-006 e pendência de T-21/T-23).
5. Executar `pnpm db:migrate` no banco de desenvolvimento e `pnpm db:test`; nada de segredo em saída ou commit.

## Resumo em linguagem simples
Cada ação importante é registrada numa tabela de auditoria que só aceita novas linhas, gravada na mesma operação da ação (se uma falha, a outra também some), sem dados pessoais.
Ninguém da aplicação consegue alterar ou apagar esses registros, e cada linha carrega o "carimbo" da anterior, então qualquer adulteração, mesmo feita por quem administra o banco, é detectada.
