# Desenho técnico H-039 — Fila de verificação (Issue #52)

- **Issue:** #52 `[E4] Fila de verificação` · **História:** H-039 · **Workflow:** WF-03 (Feature) · **Etapa:** Arquitetura.
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-13. **EXEC-ID:** não informado.
- **Natureza:** somente documento. Nenhum código, migração, banco, chamada externa (Mapbox proibido) ou quadro foi alterado.
- **Entradas:** `123-REFINO-H039.md` (CA-H039-01 a 19, RN-H039-01 a 11), decisões 370 a 389 (Rodada 76, adotadas como recomendadas), `107-DESENHO-H037.md` §7 e D-H037-15, `114-DESENHO-H045.md` (padrão de migração, RLS, grants e funções `private`), migrações `20261111220000_admin_create_rbac.sql`, `20261111290000_admin_create_access_case.sql`, `20261112220000_identity_create_documents.sql`, `20261111400000_identity_create_professional_account.sql`.
- **Etiquetas:** `[DECIDIDO n]` decisão registrada · `[VERIFICADO]` lido no repositório · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]` o DEV confere antes de codar · `[PERGUNTA n]` ao líder (§12).
- **Limites da leitura:** não li o texto da Issue no GitHub, não consultei banco e não reli `roles/factory-software-architect.md` além do já carregado (orçamento de turnos). Perguntas numeradas a partir de 390 (a faixa 370 a 389 é do refino).

## 1. Decisões e fatos que moldam o desenho

| Dec. | Efeito |
|---|---|
| 370 | O caso nasce no primeiro envio com `status='recebido'`. |
| 371 | O caso é a fonte; `app.professional_profile.verification_status` espelha o caso na mesma transação; só H-039 escreve nele. |
| 372 | Autoatribuição da Verificação; reatribuição só por Superadmin, auditada. |
| 373 | Serviço REG ativo sem elegibilidade completa: não aprova (fail closed). |
| 374 | H-039 só faz retenção manual; o índice de `document_hmac` é de H-040. |
| 375 a 377 | Motivos fixos; complemento até 500 caracteres sem dado pessoal; um recurso por decisão. |
| 378, 379 | Recurso decidido por outra pessoa da Verificação; `retida_duplicidade` só sai por decisão motivada. |
| 380 | `suspensa` fora de H-039. |
| 381 | Documento entregue pela API como anexo, `no-store`, sem URL. |
| 382, 383 | Sem limite de leituras (todas registradas); nenhuma leitura por admin ou Superadmin. |
| 384 | Prazo-meta em dias úteis, segunda a sexta, sem feriados, sem alerta. |
| 385, 386, 387 | Evento de decisão sem e-mail; tela no console admin (#112); fila sem CPF/CNPJ, nome de arquivo ou SHA-256. |
| 388 | A aprovação completa só fecha com #51; Arquitetura e Desenvolvimento de #52 podem andar. |
| 389 | Motivo fixo (código) na leitura do documento, gravado em `sensitive_access_log`. |

Fatos `[VERIFICADO]` no repositório:
- Última migração: `20261113190000_billing_create_plan_pricing.sql`. Última reversão: `supabase/rollbacks/20261113190000_billing_create_plan_pricing.down.sql`.
- Papéis de console: `app.admin_role` (`superadmin`, `verificacao`, `moderador`, `financeiro`, `suporte`, `auditor`); permissão `verification.review` já existe e é concedida **só** a `verificacao` (Superadmin não a tem: RN-H039-01 já vale pelo mapa). `private.admin_has_permission(uuid, text)` existe e é usada por `private.access_case_open` (padrão `p_actor`, `p_session_hash`, `p_now`).
- `app.professional_profile.verification_status` já aceita os seis valores (`pendente`, `em_revisao`, `aprovada`, `retida_duplicidade`, `recusada`, `suspensa`); o comentário da migração diz que só a função de decisão de H-039 o muda. `verified_at` e `suspended_at` existem.
- `app.identity_document`: `id`, `professional_id`, `status` (`pendente_envio`, `recebido`, `substituido`), `stored_type`, `received_at`, `analyzed_at`, `purge_requested_at`; constraint que só admite `analyzed_at` em `recebido` ou `substituido`.
- **`app.sensitive_access_log` hoje não serve como está:** `case_id uuid not null references app.access_case`, `scope_kind check (scope_kind = 'conversation')`, `action check (action = 'read')`, `audit_event_id not null`, gatilho append-only. Precisa de expansão aditiva (§3.5).
- Auditoria: `private.audit_append(p_actor_ref, p_actor_role, p_action, p_object_type, p_object_id, p_before_state, p_after_state, p_reason_code, p_correlation_id)`; `audit.action_catalog (action, object_type, reason_required, state_keys, description)` exige cadastro prévio de cada ação (H-073 faz `insert ... on conflict do nothing`); `actor_role` segue `^[a-z][a-z0-9_]{0,31}$`; `actor_ref like 'system:%'` se, e somente se, `actor_role = 'system'`.
- Padrão H-073: funções `security definer`, `search_path = ''`, `revoke ... from public, anon, authenticated, service_role, app_api`, `grant execute ... to app_system`, `alter table ... enable` e `force row level security`, códigos de erro `42501` (`permissao_negada`) e SQLSTATE próprio `ADMnn`.
- Existem `apps/api/src/identity-docs/`, `apps/api/src/billing/`, `apps/api/src/admin-*-route.ts`, `apps/admin/src/app/console/{catalogo,operacao}` e `apps/admin/src/*-state.ts` (modelo para a tela). `packages/domain/src/identity-docs/ports.ts` declara `IdentityDocReaderPort.readForReview(id)` sem implementação.

## 2. Visão geral

```
Profissional envia identidade (H-037)  ->  idoc_finalize grava status 'recebido'
        |  (gatilho AFTER UPDATE, mesma transação)
        v
app.verification_case (pendente) + evento 'created' + audit  (espelho do perfil: pendente)
        |  Verificação autoatribui           pendente -> em_revisao
        v
Leitura do documento: private.idoc_review_target (trava, analyzed_at, log sensível, evento, audit)
        |  decisão motivada
        v
aprovada | recusada | retida_duplicidade  (+ espelho no perfil, + evento de saída, + audit)
        |  recurso (função; rota é de H-041)
        v
em_revisao sem responsável (outra pessoa da Verificação assume)
```

Princípios: (1) toda escrita passa por função `private` `security definer` com autorização dentro da função; (2) tabelas sem nenhum grant a papéis de API; (3) nenhum relógio do banco nas regras (o chamador injeta `p_now`; exceção única: gatilho de criação, que usa `received_at`); (4) todas as negações de caso devolvem erro uniforme.

## 3. Modelo de dados

### 3.1 Migração e rollback (nomes)

- **Migração:** `supabase/migrations/20261113200000_verification_create_case_queue.sql` (maior que `20261113190000`). O DEV reconfere o prefixo livre na hora de criar (outras Issues podem ter usado o mesmo). Aplicar com `npx supabase`. Idempotente (`if not exists`, `create or replace`, `on conflict do nothing`). Expansão aditiva: tabelas novas, gatilho novo em `app.identity_document`, colunas e constraints relaxadas em `app.sensitive_access_log`, permissão nova, ações novas no catálogo de auditoria. Nenhum `cron`, `ops.job`, agendamento ou gatilho de tempo (CA-H039-18).
- **Rollback:** `supabase/rollbacks/20261113200000_verification_create_case_queue.down.sql`: remove o gatilho de `identity_document`, as funções, `app.verification_case_event`, `app.verification_case`, as linhas de permissão e do catálogo de auditoria que a migração inseriu, e reverte `sensitive_access_log` (só possível se não houver linha com `scope_kind='identity_document'`; o cabeçalho manda exportá-las antes). Não restaura `verification_status` de perfis nem desfaz eventos de auditoria (append-only). Seguro apenas enquanto não houver caso decidido; depois disso, exige exportação prévia (registrar no cabeçalho).

### 3.2 `app.verification_case`

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `professional_id` | `uuid not null unique` | FK `app.professional_profile (user_id) on delete restrict`; um caso por profissional (recurso reabre o mesmo caso; `[PERGUNTA 391]`) |
| `status` | `text not null default 'pendente'` | `check in ('pendente','em_revisao','retida_duplicidade','aprovada','recusada','suspensa')` (mesmo conjunto do perfil) |
| `assigned_to` | `uuid` | FK `app.admin_staff (user_id)` |
| `assigned_at` | `timestamptz` | |
| `reason_code` | `text` | `check in ('aprovado','documento_ilegivel','documento_divergente','tipo_nao_aceito','duplicidade_suspeita','certificacao_insuficiente','outro')` (dec. 375) |
| `explanation_to_professional` | `text` | `check (char_length(...) <= 500)`; só o complemento livre (o modelo de texto por motivo fica no domínio, dec. 376) |
| `appeal_status` | `text not null default 'nenhum'` | `check in ('nenhum','pendente','decidido')` |
| `decided_by` | `uuid` | FK `app.admin_staff`; mantido até a próxima decisão (base da regra "outra pessoa" no recurso, dec. 378) |
| `decided_at` | `timestamptz` | |
| `sla_target_at` | `timestamptz not null` | calculado na criação (§5.2) |
| `version` | `integer not null default 1` | incrementa a cada mutação; controle otimista (CA-H039-03, §5.4 do refino) |
| `created_at`, `updated_at` | `timestamptz not null` | |

CHECKs de coerência:
- `vc_pendente_sem_responsavel`: `status <> 'pendente' or assigned_to is null`.
- `vc_revisao_com_responsavel`: `status <> 'em_revisao' or assigned_to is not null or appeal_status = 'pendente'` (recurso aguardando nova pessoa).
- `vc_decisao_completa`: `status not in ('aprovada','recusada','retida_duplicidade') or (reason_code is not null and decided_by is not null and decided_at is not null)`.
- `vc_outro_com_explicacao`: `reason_code <> 'outro' or char_length(btrim(coalesce(explanation_to_professional,''))) > 0`.
- `vc_recurso_so_apos_decisao`: `appeal_status = 'nenhum' or decided_at is not null`.

Gatilho `private.verification_case_guard()` (`BEFORE UPDATE`, `security invoker`, `search_path = ''`): `professional_id` e `created_at` imutáveis; valida o par `(old.status, new.status)` contra a tabela abaixo; incrementa `version` e `updated_at`; `BEFORE DELETE` e `BEFORE TRUNCATE` recusam sempre. Mensagens fixas: `vrf_imutavel`, `vrf_transicao_invalida`, `vrf_sem_delete`.

| De | Para | Quem (função) |
|---|---|---|
| (insert) | `pendente` | gatilho de criação |
| `pendente` | `em_revisao` | `verification_case_assign` |
| `em_revisao` | `aprovada`, `recusada`, `retida_duplicidade` | `verification_case_decide` |
| `retida_duplicidade` | `aprovada`, `recusada` | `verification_case_decide` (dec. 379) |
| `recusada`, `retida_duplicidade` | `em_revisao` | `verification_case_appeal` |
| `em_revisao` (sem dono, recurso) | `em_revisao` (com dono) | `verification_case_assign` |
| `aprovada`, `suspensa` | qualquer | nenhuma nesta história; o gatilho recusa |

Qualquer par fora da tabela é recusado pelo banco, não só pela função (CA-H039-03).

### 3.3 `app.verification_case_event` (histórico imutável)

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `case_id` | `uuid not null` | FK `app.verification_case (id) on delete restrict` |
| `seq` | `integer not null` | `unique (case_id, seq)`; seq = max+1 sob o `for update` do caso |
| `action` | `text not null` | `check in ('created','assigned','reassigned','document_read','decided','appeal_received')` |
| `actor_id` | `uuid` | nulo só em `created` e `appeal_received` (ator é o sistema/profissional); FK `app.admin_staff` |
| `actor_role` | `text not null` | `'system'`, `'verificacao'`, `'superadmin'` ou `'profissional'` |
| `from_status`, `to_status` | `text` | |
| `reason_code` | `text` | motivo da decisão ou código da leitura (§4.5) |
| `explanation` | `text` | cópia do complemento (≤ 500), só em `decided` |
| `audit_event_id` | `uuid not null` | elo com `audit.audit_event` |
| `at` | `timestamptz not null` | |

Gatilho `BEFORE UPDATE OR DELETE OR TRUNCATE` chama `private.verification_event_refuse_mutation()` (modelo: `private.access_case_refuse_mutation`). A tabela é também a **fonte do evento de saída** da dec. 385 (E11 consome sem e-mail agora; `[PERGUNTA 399]`).

### 3.4 Índices

- `verification_case_professional_uk`: `unique (professional_id)` (já pela coluna).
- `verification_case_fila_pendente_idx`: `(sla_target_at, id) where status = 'pendente'`.
- `verification_case_fila_minha_idx`: `(assigned_to, sla_target_at, id) where status in ('em_revisao','retida_duplicidade')`.
- `verification_case_fila_recurso_idx`: `(sla_target_at, id) where status = 'em_revisao' and assigned_to is null`.
- `verification_case_event_caso_idx`: `(case_id, at)`; `unique (case_id, seq)`.
- Paginação por chave `(sla_target_at, id)` (sem OFFSET).

### 3.5 Expansão de `app.sensitive_access_log` (dec. 389; `[PERGUNTA 390]`)

Alterações aditivas (linhas existentes de H-073 continuam válidas):
- `alter column case_id drop not null`.
- Novas colunas: `verification_case_id uuid references app.verification_case (id)` e `reason_code text`.
- Substituir a constraint `scope_kind = 'conversation'` por `scope_kind in ('conversation','identity_document')` e acrescentar `check ((scope_kind = 'conversation') = (case_id is not null))`, `check ((scope_kind = 'identity_document') = (verification_case_id is not null))` e `check (scope_kind <> 'identity_document' or reason_code in (...códigos de leitura...))`. `[NÃO VERIFICADO]` os nomes das constraints existentes: a migração os descobre em `pg_constraint` por `conrelid`/definição antes do `drop constraint`.
- `scope_id` guarda o `id` do documento; `action` continua `'read'`; `actor_id` é a pessoa da Verificação (já é `admin_staff`).
- Índice `sensitive_access_log_verificacao_idx (verification_case_id, read_at) where verification_case_id is not null`.
- O DEV procura em `apps/api/src/admin-access-case-route.ts` e nos testes `admin-access-case*.dbtest.mjs` consultas que presumam `case_id` não nulo e as ajusta; se houver risco, cair para a alternativa da pergunta 390 (tabela própria).

### 3.6 RLS, privilégios e permissões

- `alter table app.verification_case enable row level security` e `force row level security`; idem `app.verification_case_event`. **Nenhuma política.** Negação por padrão.
- `revoke all on app.verification_case, app.verification_case_event from public, anon, authenticated, service_role, app_api;`. **Nenhum grant de tabela nem a `app_system`:** toda leitura e escrita passa por funções `security definer` (a fila, o detalhe e as decisões também). A "Verificação" não é papel de banco: é o papel de console `verificacao` (permissão `verification.review`), conferido **dentro** de cada função por `private.admin_has_permission`.
- Permissão nova `verification.reassign` concedida só a `superadmin` (`insert ... on conflict do nothing` em `app.admin_permission` e `app.admin_role_permission`; `[PERGUNTA 398]`). O DEV atualiza os mapas esperados em `admin-rbac.dbtest.mjs` e afins.
- Funções: `revoke execute ... from public, anon, authenticated, service_role, app_api;` `grant execute ... to app_system;` (assinaturas completas, como em H-073). Funções de gatilho: sem `execute` para ninguém.
- Registro em `audit.action_catalog` (todas `object_type='verification_case'`, exceto a leitura): `verification.case.created`, `verification.case.assigned`, `verification.case.reassigned`, `verification.document.read` (object_type `identity_document`), `verification.case.decided`, `verification.case.appeal_received`. `state_keys`: apenas `status`, `appeal_status`, `assigned` (booleano, nunca o id do analista no estado), `scope_kind`. O motivo vai em `p_reason_code`; **nunca** o complemento nem dado do profissional. `[NÃO VERIFICADO]` `audit_state_is_valid` e as chaves proibidas: o DEV lê a regra antes de montar o estado.

## 4. Funções `private` (todas `security definer`, `set search_path = ''`)

Erros: `42501 / permissao_negada` para qualquer negação de autorização, de existência, de atribuição ou de estado visível ao ator (mesma mensagem e mesmo código, CA-H039-02); `ADM`-like próprios `VRF01 caso_conflito` (versão ou estado mudou), `VRF02 motivo_invalido`, `VRF03 explicacao_invalida`, `VRF04 identidade_nao_analisada`, `VRF05 certificacao_pendente`, `VRF06 documento_indisponivel`, `VRF07 perfil_suspenso`, `22023 entrada_invalida`. Códigos `VRF` só aparecem depois de a autorização passar.

Padrão de abertura (todas as funções de ator): validar parâmetros não nulos; `private.admin_has_permission(p_actor, 'verification.review')` (ou `verification.reassign`); validar sessão do ator como em `private.access_case_session_totp`/`access_case_gate` de H-073 (o DEV reaproveita a função de sessão existente; `[PERGUNTA 394]` sobre prova recente); travar o caso `for update`.

### 4.1 Criação do caso (CA-H039-01, 15)

- `private.verification_case_on_idoc_received()` (gatilho): `AFTER UPDATE OF status ON app.identity_document FOR EACH ROW WHEN (new.status = 'recebido' and old.status is distinct from 'recebido')`. Insere o caso `pendente` com `on conflict (professional_id) do nothing`; se criou, grava evento `created` (ator `system:verification`, papel `system`) e `private.audit_append('system:verification','system','verification.case.created','verification_case', id, '{}', '{"status":"pendente"}', null, null)`. Usa `new.received_at` como instante (`[NÃO VERIFICADO]` que a função de finalização o preenche; senão `clock_timestamp()`). Roda na transação de `idoc_finalize` de #50: falha aqui aborta a finalização (fail closed; teste de regressão obrigatório, T-02).
- Novo documento depois de `recusada` não reabre o caso (cabe a H-041, `[PERGUNTA 393]`).
- Carga inicial: na mesma migração, `insert ... select` idempotente cria caso `pendente` para cada profissional que já tenha documento `recebido` sem caso (`[PERGUNTA 401]`), sem eventos de leitura.
- `private.verification_sla_target(p_from timestamptz) returns timestamptz` (`stable`, sem `now()`): converte para `America/Sao_Paulo`; sábado e domingo contam como segunda 00:00 local; soma 2 dias úteis mantendo a hora local; devolve `timestamptz`. Exemplos: sexta 10:00 vira terça 10:00; sábado 10:00 vira quarta 00:00; quinta 10:00 vira segunda 10:00 (`[PERGUNTA 397]`). Sem feriados (dec. 384).

### 4.2 Atribuição (CA-H039-02, 03, 07)

`private.verification_case_assign(p_actor uuid, p_session_hash text, p_case uuid, p_expected_version integer, p_now timestamptz) returns table (out_status text, out_version integer)`.
- Aceita (a) caso `pendente` -> `em_revisao`, `assigned_to = p_actor`; (b) caso `em_revisao` sem dono e `appeal_status='pendente'`, desde que `p_actor <> decided_by` (dec. 378).
- Outro estado ou versão diferente: `VRF01`. Profissional do caso não pode ser o próprio analista (conflito; `admin_staff` e profissional são identidades distintas, o DEV confirma).
- Perfil espelha `em_revisao`. Evento `assigned` e audit `verification.case.assigned`.

`private.verification_case_reassign(p_actor, p_session_hash, p_case, p_new_assignee uuid, p_expected_version, p_now)`: exige `verification.reassign` (Superadmin); o novo responsável precisa ter `verification.review` e, se há recurso pendente, ser diferente de `decided_by`; só em `em_revisao` ou `retida_duplicidade`. Evento `reassigned`, audit `verification.case.reassigned`. Superadmin continua sem ler documento nem decidir (dec. 383).

### 4.3 Decisão (CA-H039-04 a 06, 13, 14)

`private.verification_case_decide(p_actor uuid, p_session_hash text, p_case uuid, p_decision text, p_reason_code text, p_complement text, p_expected_version integer, p_now timestamptz) returns table (out_status text, out_version integer)`.
Passos, todos na mesma transação:
1. Autoriza (`verification.review`), trava o caso, exige `assigned_to = p_actor` e `status in ('em_revisao','retida_duplicidade')`; versão igual a `p_expected_version` (senão `VRF01`).
2. `p_decision in ('aprovada','recusada','retida_duplicidade')`. Motivo: `aprovada` só com `aprovado`; `retida_duplicidade` só com `duplicidade_suspeita`; `recusada` com qualquer outro. Fora da regra: `VRF02`.
3. Complemento: nulo ou até 500 caracteres; `outro` exige complemento não vazio; `private.verification_text_has_pii(text)` recusa padrão de CPF, CNPJ, e-mail e sequência de 10 ou mais dígitos (com ou sem separadores): `VRF03`.
4. `retida_duplicidade` só a partir de `em_revisao`.
5. `aprovada`: (a) existe documento `recebido` do profissional com `analyzed_at` não nulo, senão `VRF04` (CA-H039-06); (b) perfil não está `suspensa`, senão `VRF07`; (c) `private.verification_reg_gate(professional_id)` devolve `sem_reg` ou `completas`, senão `VRF05` (CA-H039-05).
6. Atualiza o caso (`status`, `reason_code`, `explanation_to_professional`, `decided_by = p_actor`, `decided_at = p_now`, `appeal_status` vira `decidido` se estava `pendente`); atualiza o perfil (`verification_status`, `verified_at = p_now` se aprovada, `updated_at`); grava evento `decided` e audit `verification.case.decided` com `p_reason_code`. A retenção não bloqueia, não suspende e não toca pedidos (CA-H039-13).
7. `[NÃO VERIFICADO]` o DEV confere se `professional_profile` tem gatilho que restrinja a escrita de `verification_status` e usa o mecanismo previsto por H-035 (o comentário da migração indica que a função de decisão é a escritora).

`private.verification_reg_gate(p_professional uuid) returns text` (`stable`): 1) se não há serviço de atividade regulamentada ativo para o profissional, devolve `sem_reg`; 2) caso contrário, se `to_regprocedure('private.certificacoes_completas(uuid)')` existe, executa-a dinamicamente e devolve `completas` ou `incompletas`; 3) se a função ainda não existe (#51 não entregue), devolve `incompletas` (fail closed, dec. 373). Assim #51 não exige migração em H-039. `[NÃO VERIFICADO]` a tabela e a coluna que marcam REG no catálogo de H-036; `[PERGUNTA 403]`.

### 4.4 Recurso (CA-H039-14)

`private.verification_case_appeal(p_professional uuid, p_now timestamptz) returns table (out_code text)`: `ok`, `sem_caso`, `nao_elegivel`, `recurso_ja_usado`. Elegível: caso `recusada` ou `retida_duplicidade` com `appeal_status='nenhum'`. Efeito: `appeal_status='pendente'`, `status='em_revisao'`, `assigned_to = null` (a fila de recurso), perfil espelha `em_revisao`, evento `appeal_received` (papel `profissional`), audit `verification.case.appeal_received`. Em `pendente`, `em_revisao` ou `aprovada`: `nao_elegivel`. Sem rota em H-039 (a rota e o texto são de H-041; `[PERGUNTA 392]`).

### 4.5 Leitura do documento (CA-H039-08 a 10, 12)

`private.idoc_review_target(p_actor uuid, p_session_hash text, p_case uuid, p_document uuid, p_reason_code text, p_now timestamptz) returns table (out_id uuid, out_stored_type text)` (contrato de 107 §7: devolve só `id` e `stored_type`).
1. Autoriza `verification.review`; trava o caso `for update`; exige `status = 'em_revisao'` e `assigned_to = p_actor`. Qualquer falha: `42501 permissao_negada` (uniforme).
2. `p_reason_code in ('analise_inicial','conferencia_duvida','reanalise_recurso')` (dec. 389, `[PERGUNTA 396]`); senão `VRF02`.
3. Trava o documento `for update`: `id = p_document`, `professional_id` igual ao do caso, `status = 'recebido'`, `purge_requested_at is null`, `stored_type is not null`; senão `VRF06`. O `for update` serializa com `idoc_delete` de #50 (CA-H039-09; `[NÃO VERIFICADO]` que `idoc_delete` trava a mesma linha com `for update` antes de decidir 409, como diz 107 §7).
4. `analyzed_at = coalesce(analyzed_at, p_now)`.
5. `private.audit_append(... 'verification.document.read', 'identity_document', p_document, '{}', '{"scope_kind":"identity_document"}', p_reason_code, null)` e `insert into app.sensitive_access_log (id, verification_case_id, actor_id, scope_kind, scope_id, action, read_at, audit_event_id, reason_code)`; evento `document_read` no histórico do caso. Falha em qualquer insert desfaz tudo, inclusive `analyzed_at` (CA-H039-08).
6. Devolve `(id, stored_type)`. Nunca devolve caminho, nome ou SHA-256.

Transação única de ponta a ponta (`[PERGUNTA 395]`): o adaptador abre a transação, chama a função, lê os bytes do storage (tempo limite curto, por exemplo 8 s) e só então confirma. Se o storage falhar, a transação inteira é desfeita e `analyzed_at` não é gravado. O bloqueio da linha dura no máximo esse tempo; a exclusão do dono espera e depois recebe 409 se foi lido, ou apaga se a leitura falhou.

### 4.6 Fila e detalhe (CA-H039-16)

- `private.verification_queue_list(p_actor, p_session_hash, p_scope text, p_limit integer, p_after_sla timestamptz, p_after_id uuid, p_now timestamptz)`: `p_scope in ('pendentes','minhas','recursos','retidas')`; `limit` entre 1 e 50; ordena por `(sla_target_at, id)`. Retorna por linha apenas: `id`, `short_id` (primeiros 8 caracteres do uuid), `status`, `appeal_status`, `sla_target_at`, `received_at` (do documento recebido), `services text[]` (rótulos do catálogo de H-036; `[NÃO VERIFICADO]` tabelas), `overdue boolean` (`p_now > sla_target_at`, só informação), `assigned_to_me boolean`, `version`. **Sem** CPF/CNPJ, nome, e-mail, nome de arquivo ou hash.
- `private.verification_case_detail(p_actor, p_session_hash, p_case, p_now)`: mesmos campos, mais `reason_code`, `explanation_to_professional` (do caso), `decided_at`, indicador `document_available boolean`, `document_id` e `document_received_at`; **sem** `stored_type` expandido, caminho ou hash; o `document_id` é opaco (uuid) e só serve à rota de leitura. Pessoa sem permissão ou caso não visível: `permissao_negada`.

## 5. Domínio, adaptadores, API e tela

### 5.1 Domínio (`packages/domain/src/verification/`, lógica pura)

- `types.ts`: `ESTADOS_CASO`, `MOTIVOS_DECISAO`, `MOTIVOS_LEITURA`, `DECISOES`, tipos `VerificationCase`, `QueueRow`, constante `COMPLEMENTO_MAX = 500`.
- `transitions.ts`: tabela de transições (§3.2) e `podeTransitar(de, para)`; teste de paridade com o gatilho de banco.
- `reasons.ts`: catálogo de motivos com texto-modelo por motivo (dec. 376) e validação de combinação decisão x motivo.
- `sla.ts`: espelho em TS de `verification_sla_target` (teste de paridade em datas de fronteira).
- `ports.ts`: `VerificationCasePort` (`list`, `detail`, `assign`, `reassign`, `decide`, `receiveAppeal`) e `Clock`. A porta `IdentityDocReaderPort` **continua em** `packages/domain/src/identity-docs/ports.ts` sem mudança.
- `service.ts`: `VerificationService` (validação de entrada, mapeamento de erros `VRF` para códigos de domínio, uso do relógio injetado).
- `index.ts`: barril (só lista; sem lógica).

### 5.2 Adaptadores (`apps/api/src/verification/`; `[NÃO VERIFICADO]` alinhar com o layout de `apps/api/src/billing/`)

- `pg-verification-case-store.ts`: `PgVerificationCaseStore implements VerificationCasePort` (chama as funções `private` pelo papel `app_system`; parâmetros posicionais; `p_now` vem do `Clock`).
- `pg-identity-doc-review-reader.ts`: `PgIdentityDocReviewReader implements IdentityDocReaderPort`, construída **por requisição** com `{ actorId, sessionHash, caseId, reasonCode, clock }`, de modo que `readForReview(id)` mantém a assinatura atual. Executa o §4.5 em transação única, lê o bucket `identity-docs` com credencial própria e devolve `{ bytes, type }` ou `null`. **Arquivo novo; nenhum arquivo de `apps/api/src/identity-docs/` ou do serviço de envio o importa** (CA-H039-12, teste estático).
- `verification-composicao.ts`: injeta store, leitor e relógio (barril de composição).
- `admin-verification-route.ts` (em `apps/api/src/`, junto às demais `admin-*-route.ts`): rotas abaixo; usa a mesma sessão, CSRF e cabeçalhos das rotas de console existentes.

### 5.3 Rotas da API (contrato, sem implementação)

Todas exigem sessão de console válida e a permissão no corpo da função; nenhuma é pública, nenhuma serve ao profissional ou ao admin comum.

| Método e caminho | Permissão | Entrada | Resposta |
|---|---|---|---|
| `GET /admin/verificacao/casos?escopo=&limite=&apos=` | `verification.review` | escopo (`pendentes`, `minhas`, `recursos`, `retidas`), cursor `(sla, id)` | `{ itens: QueueRow[], proximo }`; `Cache-Control: no-store` |
| `GET /admin/verificacao/casos/:id` | `verification.review` | | detalhe do §4.6 |
| `POST /admin/verificacao/casos/:id/atribuir` | `verification.review` | `{ versao }` | `{ status, versao }` |
| `POST /admin/verificacao/casos/:id/reatribuir` | `verification.reassign` | `{ responsavel, versao }` | `{ status, versao }` |
| `POST /admin/verificacao/casos/:id/documento/leitura` | `verification.review` | `{ documento, motivo }` | corpo binário (`image/jpeg` ou `application/pdf`); `Content-Disposition: attachment; filename="documento-identidade.<ext>"` (nome fixo), `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`; sem `Location`, sem URL |
| `POST /admin/verificacao/casos/:id/decisao` | `verification.review` | `{ decisao, motivo, complemento?, versao }` | `{ status, versao }` |

Leitura é `POST` de propósito (tem efeito: grava leitura, evita prefetch, cache e compartilhamento de link). Erros: `403 acesso_negado` (sem permissão no papel), `404 nao_encontrado` (qualquer negação no nível do caso, corpo idêntico exista ou não o caso), `409 caso_conflito` (versão ou estado mudou), `422` com código de domínio (`motivo_invalido`, `explicacao_invalida`, `identidade_nao_analisada`, `certificacao_pendente`, `perfil_suspenso`), `502 documento_indisponivel` com mensagem genérica "Não foi possível abrir o documento. Tente de novo." (sem caminho nem detalhe). O corpo das requisições e o complemento não entram em log. Recurso: **sem rota** em H-039.

### 5.4 Tela (console admin #112, `apps/admin`; `[DECIDIDO 386]`)

- Arquivos: `apps/admin/src/app/console/verificacao/page.tsx` (fila), `apps/admin/src/app/console/verificacao/[caso]/page.tsx` (detalhe) e `apps/admin/src/verification-state.ts` (estado da tela, no padrão de `catalog-state.ts`). Item de menu só aparece para quem tem `verification.review`.
- Fila: abas "Pendentes", "Minhas", "Recursos", "Retidas"; colunas identificador curto, serviços, data de envio, estado, prazo-meta (selo "além da meta" apenas informativo). Estado vazio: "Nenhum caso nesta lista." (texto final a aprovar, dec. 386). Sem CPF/CNPJ, nome de arquivo, hash ou nome completo (dec. 387).
- Detalhe: dados não sensíveis, botão "Abrir documento" (pede o motivo fixo, chama a rota de leitura e entrega o arquivo como download; nada de `<img src>` com URL), formulário de decisão (decisão, motivo fixo, complemento até 500 com contador, aviso "não escreva CPF, CNPJ, e-mail ou telefone"). Estados: carregando, vazio, erro genérico de leitura, conflito (mensagem e recarga do caso), sucesso.
- Acessibilidade e responsividade conforme o Design System já adotado no console (WCAG, 375 px); o DEV reaproveita componentes de `catalogo`/`operacao`.

## 6. Plano de testes (T-xx por CA)

Dados sintéticos com marcador único; transação desfeita (`rollback`) salvo nos testes de concorrência (herdam o padrão de T-24 de #50 e da Rodada 65). Arquivos: `packages/db/tests/verification-case.dbtest.mjs`, `verification-case-concorrencia.dbtest.mjs`, `verification-case-migration.test.mjs` (estático), `packages/domain/src/verification/*.test.ts`, `apps/api/src/verification/*.test.ts`, `apps/admin` (estado e tela).

| T | Prova | CA |
|---|---|---|
| T-01 | Documento passa a `recebido`: nasce 1 caso `pendente` com `sla_target_at`; sem envio, nenhum caso | CA-01 |
| T-02 | Reenvio e segundo `recebido` não duplicam o caso (`unique`); regressão: testes de #50 (`idoc_finalize`) continuam verdes | CA-01 |
| T-03 | Matriz de papéis (Admin, Superadmin, Auditor, Suporte, Financeiro, Moderador, profissional dono, Verificação): só Verificação atribui, lê e decide; Superadmin só reatribui; demais recebem `permissao_negada` | CA-02 |
| T-04 | Negação uniforme: caso inexistente, caso de outro analista e caso fora de estado dão o mesmo erro e a mesma resposta HTTP `404` | CA-02 |
| T-05 | Uma transição válida e uma inválida por linha da tabela §3.2 (inclusive `aprovada` -> qualquer, `suspensa` -> qualquer) | CA-03 |
| T-06 | `verification_case_event`: UPDATE, DELETE e TRUNCATE recusados; `verification_case`: DELETE e TRUNCATE recusados | CA-03 |
| T-07 | Decisão sem motivo, motivo fora da lista, combinação decisão x motivo inválida, `outro` sem complemento: recusados; complemento com CPF, CNPJ, e-mail ou 10 dígitos: recusado; 500 aceito, 501 recusado | CA-04 |
| T-08 | Com serviço REG ativo e sem `private.certificacoes_completas`: aprovar recusa (`VRF05`); com função de teste criada na transação devolvendo `true`: aprova; sem REG: aprova (parte 1 depende de #51 só pela função real; a stub cobre a lógica) | CA-05 |
| T-09 | Aprovação em 3 cenários: sem documento, documento sem leitura, documento lido | CA-06 |
| T-10 | Cada ação (criar, atribuir, reatribuir, ler, decidir, recurso) gera 1 evento de histórico e 1 `audit_event` com ator, papel, ação, objeto, antes e depois e motivo; cadeia de hash válida; nenhum estado contém CPF/CNPJ, nome de arquivo ou texto livre | CA-07 |
| T-11 | Leitura pela Verificação atribuída: devolve `(id, stored_type)`, grava `analyzed_at` se nulo, grava `sensitive_access_log` (`identity_document`, motivo) na mesma transação; segunda leitura mantém o primeiro `analyzed_at` | CA-08 |
| T-12 | Falha injetada (gatilho de teste que levanta erro no insert do log, em transação desfeita): `analyzed_at` continua nulo e nenhum evento resta | CA-08 |
| T-13 | Duas conexões: leitura e `idoc_delete` do dono concorrentes serializam; depois da leitura a exclusão responde 409; exclusão antes da leitura impede a leitura (`VRF06`); documento analisado nunca é apagado | CA-09 |
| T-14 | Rota de leitura: `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, sem `Location` nem URL no corpo; nome de arquivo fixo | CA-10 |
| T-15 | Varredura de rotas: a única rota que devolve bytes de identidade é `.../documento/leitura` da Verificação; nenhuma para admin comum, dono ou perfil público | CA-11 |
| T-16 | Teste estático: o leitor é arquivo novo; nenhum arquivo de `apps/api/src/identity-docs/` ou do serviço de envio o importa; `ports.ts` de #50 inalterado | CA-12 |
| T-17 | `retida_duplicidade` com `duplicidade_suspeita`: perfil espelha o estado, conta não é suspensa, `suspended_at` e pedidos intactos; liberação só por decisão motivada (aprovada ou recusada) | CA-13 |
| T-18 | Recurso em `recusada` e `retida_duplicidade`: `appeal_status='pendente'`, `em_revisao` sem dono, evento; em `pendente`, `em_revisao`, `aprovada` e segundo recurso: recusados; quem decidiu não consegue assumir o recurso | CA-14 |
| T-19 | `verification_sla_target` em sexta, sábado e quinta (cruzando fim de semana), e paridade com o espelho TS | CA-15 |
| T-20 | Estático e catálogo: nenhum `cron`, `ops.job`, gatilho de tempo ou rota de exclusão por decisão criado; consulta a `cron.job` sem entradas novas | CA-18 |
| T-21 | Fila: ordenação por `sla_target_at`, paginação por chave estável, limite máximo, resposta sem campos proibidos (esquema da resposta com lista branca); estado vazio na tela | CA-16 |
| T-22 | Tela com storage simulado indisponível: mensagem genérica sem caminho nem detalhe técnico; transação desfeita (T-12 por baixo) | CA-17 |
| T-23 | Estático da migração: RLS habilitado e forçado, nenhum grant de tabela a `anon`, `authenticated`, `service_role`, `app_api`; funções com `execute` só a `app_system`; `search_path = ''` | CA-02, 11 |
| T-24 | Conflito de concorrência: duas atribuições simultâneas, uma vence e a outra recebe `VRF01`; decisão com `versao` antiga: 409 | CA-03 |
| T-25 | Regressão de H-073 e H-102: `admin-access-case*.dbtest.mjs` e `admin-rbac.dbtest.mjs` verdes após a expansão de `sensitive_access_log` e a permissão nova | CA-07 |
| T-26 | Rollback: aplicar a migração, aplicar o `down`, reaplicar (idempotência) em transação desfeita ou banco descartável do DEV | CA-19 |
| T-27 | Evidência local: `corepack pnpm check:all` e `corepack pnpm db:test` com comando, contagem e código de saída na Issue; nenhuma chamada externa nem Mapbox; sem alegar CI | CA-19 |

## 7. Segurança e impacto

- **Sem rota para admin comum:** a leitura só existe na rota de Verificação; negação por permissão e por atribuição dentro da função; Superadmin não tem `verification.review` (dec. 383); acesso excepcional continua com H-073 (`access_case`).
- **Sem URL do documento:** nenhum link assinado, nenhuma URL pública, nenhum `<img src>`; o arquivo atravessa a API como anexo. O caminho do bucket nunca sai da camada do adaptador, não entra em mensagem de erro, log nem auditoria.
- **Mínimo de dado:** fila e detalhe sem CPF/CNPJ, nome, e-mail, nome de arquivo ou SHA-256; auditoria sem texto livre e sem id do analista dentro do estado; complemento filtrado por padrão de dado pessoal (limite técnico: filtro por padrão não pega nome próprio; o aviso na tela e o treino ficam como controle complementar).
- **Credencial de leitura separada:** o leitor usa credencial própria do bucket, só de leitura, fora do serviço de envio. `[NÃO VERIFICADO]` se o provedor de storage permite chave somente leitura; se não, registrar o risco (pergunta 402).
- **Fail closed:** REG sem função de #51 não aprova; falha de auditoria, de log sensível ou de storage desfaz a operação.
- **Concorrência:** `for update` no caso e no documento; versão otimista; exclusão do dono e primeira leitura se serializam.
- **Sessão:** reutiliza a validação de sessão e CSRF das rotas de console; prova recente é a pergunta 394.
- **Impacto em outras histórias:** #50/H-037 (gatilho novo em `identity_document`; regressão obrigatória), H-073 (`sensitive_access_log` expandida; regressão), H-102 (permissão nova `verification.reassign`; mapa de testes), H-035 (`verification_status` passa a ser escrito pelas funções de H-039), H-040 e H-041 (usam retenção e a função de recurso), #51 (`certificacoes_completas` ativa a aprovação REG sem nova migração), E11 (consome eventos de decisão).
- **Documentação a atualizar no Desenvolvimento:** `09` §3.3 e §6 (tabela de eventos, valores de `appeal_status`, colunas de `sensitive_access_log`), `08` §5 (transições e função de leitura), registro de risco R8 (sem expurgo).
- **Fora de escopo mantido:** job de expurgo, suspensão administrativa, e-mail, alerta de prazo, feriados, detecção automática de duplicidade, rota de recurso do profissional.

## 8. Ordem de implementação sugerida

1. Migração e rollback; testes de banco T-01 a T-13, T-17 a T-20, T-23 a T-26.
2. Domínio e testes (T-05 em paridade, T-07, T-19).
3. Adaptadores e rotas; T-14 a T-16, T-21.
4. Tela e T-22.
5. Validação local (T-27) e registro na Issue.

## 9. Perguntas ao líder (lista única, a partir de 390)

**390. Registro de leitura sensível: expandir `app.sensitive_access_log` ou criar tabela própria?**
- (a) Expandir de forma aditiva (colunas e constraints em §3.5), como pedem o refino e a dec. 389.
- (b) Tabela nova `app.identity_document_read_log`, sem tocar H-073.
- **Recomendação:** (a); (b) só se o DEV achar consulta de H-073 que quebre. Destrava a migração.

**391. Recurso: um por caso ou um por decisão?** A dec. 377 diz "um recurso por decisão". O desenho usa `appeal_status` com um recurso por caso (`nenhum`, `pendente`, `decidido`): depois da decisão do recurso, nova contestação fica com H-040/H-041 ou com o admin.
- **Recomendação:** um recurso por caso nesta história, pelo tamanho. Destrava CA-H039-14.

**392. Rota de recurso do profissional.**
- (a) H-039 entrega só a função e o serviço de domínio; a rota é de H-041.
- (b) H-039 entrega também uma rota mínima.
- **Recomendação:** (a). Destrava T-18.

**393. Novo documento enviado depois de `recusada`.** Reabre o caso?
- **Recomendação:** não em H-039; o gatilho só cria caso inexistente. H-041 decide se novo envio equivale a recurso. Destrava §4.1.

**394. Prova recente (TOTP em até 30 min, como em H-073) para ler documento e decidir.**
- **Recomendação:** exigir para a leitura do documento; para as demais ações basta sessão válida. Destrava as assinaturas (`p_session_hash`) e a tela.

**395. Leitura do storage dentro da transação (tempo limite de cerca de 8 s) para que falha de storage desfaça `analyzed_at`.**
- **Recomendação:** sim; custa um bloqueio curto da linha do documento. Destrava CA-H039-08 e 17.

**396. Códigos de motivo da leitura (dec. 389).**
- **Recomendação:** `analise_inicial`, `conferencia_duvida`, `reanalise_recurso`. Destrava `sensitive_access_log.reason_code`.

**397. Convenção de fim de semana no prazo-meta.**
- **Recomendação:** sábado e domingo contam como segunda 00:00 (horário de Brasília); soma de 2 dias úteis mantendo a hora; sem feriados. Destrava CA-H039-15 e T-19.

**398. Permissão para reatribuir.**
- (a) Nova `verification.reassign` só do Superadmin.
- (b) Reaproveitar `admin.role.manage`.
- **Recomendação:** (a), por privilégio mínimo. Destrava T-03 e T-25.

**399. Papel gravado na auditoria e saída para E11.** (i) `actor_role = 'verificacao'` (H-073 usou `'admin'`); (ii) o evento de saída da dec. 385 é a própria `verification_case_event` (sem usar a fila de notificações de #102 agora).
- **Recomendação:** `'verificacao'` e tabela de eventos como fonte; E11 cria a ligação com o envio. Destrava o contrato de eventos.

**400. Atribuição do recurso com `assigned_to` nulo.** O desenho deixa o recurso em `em_revisao` sem dono, na aba "Recursos", e a primeira pessoa elegível pega (exceto quem decidiu).
- **Recomendação:** aceitar. Destrava CA-H039-14 e a dec. 378.

**401. Carga inicial de casos para documentos já `recebido` no banco de desenvolvimento.**
- **Recomendação:** sim, na migração, idempotente e sem evento de leitura. Destrava T-01 em banco já povoado.

**402. Credencial somente leitura do bucket `identity-docs`.** Qual credencial a #50 usa no serviço de envio, e o provedor permite chave só de leitura?
- **Recomendação:** o DEV confere em `apps/api/src/identity-docs/`; se só existir chave de serviço, criar variável separada para o leitor e registrar o risco aceito. Destrava CA-H039-12.

**403. Gate de certificação antes de #51.**
- (a) Função `verification_reg_gate` que chama `private.certificacoes_completas` quando existir e falha fechado quando não existir (§4.3).
- (b) Esperar #51 para criar o gate.
- **Recomendação:** (a), em linha com as dec. 373 e 388. Destrava CA-H039-05.

## 10. Próximos passos

1. Líder responde 390 a 403 em lista única; registrar em `11-DECISOES.md` com os mesmos números.
2. Mover #52 para Desenvolvimento só depois de confirmar a coluna no quadro (não alterado aqui).
3. DEV resolve os `[NÃO VERIFICADO]` (constraints de `sensitive_access_log`, gatilho de `verification_status`, tabela de REG, função de sessão, credencial do bucket, prefixo de migração) antes de escrever a migração.
4. Aprovação completa só fecha com #51 (dec. 388); o gate fail closed protege até lá.
