# Desenho H-104 — Consulta à auditoria pelo Auditor (Issue #113, WF-03, Arquitetura)

- **Decisão:** APROVADO_ARQUITETURA, com 3 dúvidas não bloqueantes (§7).
- **Rastro:** 62-REFINO-H104 (CA-H104-01..07); decisões do Orquestrador (1 a 6, abaixo); 23-DESENHO-H006 (cadeia, `audit_append`, privilégios; atualizado neste commit); 54-DESENHO-H102 (§1 funções `private.admin_*`, §3 guarda, §4 404 e 403); 08 §13; 09 `audit_event`. Código lido (somente leitura): migrações `20261110140000_audit_create_event_chain`, `20261111220000_admin_create_rbac`, `20261111290000_admin_create_access_case` (padrão "ler e auditar na mesma transação"), `packages/domain/src/admin/routes.ts`.
- **Natureza:** documento. Nenhum código, migração, teste, conta, chave ou e-mail foi criado.
- **Decisões do Orquestrador adotadas:** D1 consulta registrada na própria trilha; D2 falha ao registrar fecha a consulta; D3 negações só em métrica; D4 período obrigatório, teto de 90 dias; D5 tela é H-103; D6 verificação de encadeamento fora.
- **Etiquetas:** `[DECIDIDO]` Orquestrador · `[VERIFICADO]` lido no repositório · `[PROPOSTA]` deste desenho.

## 0. Fatos e conflito resolvido

1. `[VERIFICADO]` `app_system` já tem `SELECT` em `audit.audit_event`; `app_api` não tem nada. `audit.read` e o papel `auditor` já estão semeados (migração `20261111220000`); `auditor` tem só `audit.read`. `admin_guard(secret_hash, now)` e `admin_has_permission(user, permission)` existem.
2. `[DECIDIDO]` **Conflito de leitura fechado:** 23 previa `SELECT` a `app_api` com política; 54 §1 manda acessar tabelas administrativas só por funções `security definer` de `app_system`. Vale 54: **`app_api` continua sem privilégio**. 23 foi atualizado (§4 e §7, item 7).
3. Índices atuais: `(seq)`, `(object_type, object_id, at)`, `(actor_ref, at)`. Falta índice por período e por ação (§1.4).

## 1. Função de consulta (CA-H104-01, 04)

### 1.1 Contrato `[PROPOSTA]`

```sql
private.audit_query(
  p_actor uuid, p_session_hash text,
  p_from timestamptz, p_to timestamptz,           -- obrigatórios; [p_from, p_to)
  p_action text default null,                      -- tipo de ação (catálogo)
  p_object_type text default null, p_object_id uuid default null,  -- entidade
  p_after_seq bigint default 0,                    -- cursor
  p_limit int default 50,                          -- 1..100
  p_now timestamptz default now()
) returns jsonb
-- SECURITY DEFINER; set search_path = ''; set lock_timeout = '5s'
-- revoke execute de public, anon, authenticated, service_role, app_api; grant execute somente a app_system
```

Retorno: `{"consulta_id": uuid, "eventos": [...], "tem_mais": bool, "proximo_cursor": seq|null}`.

### 1.2 Regras da consulta

- **Filtros:** todos combinados com E; omitido não restringe (exceto o período). `p_action` deve existir em `audit.action_catalog`. `p_object_type` deve existir como `object_type` no catálogo. `p_object_id` só é aceito junto com `p_object_type`. Nenhum texto livre: só valores do catálogo, UUID e datas.
- **Período:** `at >= p_from and at < p_to` (intervalo semiaberto). Regras em §4.
- **Ordem e paginação:** cronológica por `seq` crescente (a cadeia garante `seq` e `at` monotônicos, 23 §1.1); cursor por `seq` (`seq > p_after_seq`); busca `p_limit + 1` linhas para calcular `tem_mais`; `proximo_cursor` = `seq` da última linha devolvida. O cursor é só um número, sem estado no servidor.
- **Campos devolvidos (lista fechada, CA-H104-04):** `seq`, `id`, `at`, `actor_ref`, `actor_role`, `action`, `object_type`, `object_id`, `before_state`, `after_state`, `reason_code`, `correlation_id`. **Não** saem `prev_hash` e `row_hash` (a verificação do encadeamento está fora, D6). A tabela já proíbe PII no estado (23 §1.4), então nenhuma coluna nova de dado pessoal existe para vazar; a defesa é a lista fechada na função.
- **Sem efeito colateral além da trilha:** a função só lê `audit_event` e grava a entrada de consulta (§2).

### 1.3 Corpo da função (ordem obrigatória)

1. Validar nulos/período/filtros (§4) **antes** de qualquer leitura; erro → nada é gravado (CA-H104-06).
2. Revalidar autoridade no banco, na mesma transação: `admin_guard(p_session_hash, p_now)` com `out_user_id = p_actor`; sem linha → `ADM30` (API: 404); com linha mas sem `audit.read` em `out_permissions` (ou `admin_has_permission(p_actor,'audit.read')` falso) → `42501` (API: 403). Isso garante o efeito imediato da revogação (CA-H104-07) mesmo que o papel tenha sido revogado entre o guarda da API e a função.
3. Ler as linhas em uma variável `jsonb` (não devolver ainda) e contar `returned_count`.
4. Gravar a entrada de consulta (§2) como **última escrita**, seguindo 23 §3 item 4.
5. Montar e devolver o `jsonb`. As linhas só existem no retorno da função: se qualquer passo falhar, a chamada termina em erro e nenhuma linha chega à API.

### 1.4 Índices `[PROPOSTA]`

Na migração: `audit_event_at_idx on audit.audit_event (at, seq)` (período) e `audit_event_action_idx on (action, at)` (filtro por ação). `(object_type, object_id, at)` já atende o filtro por entidade. O DEV confere o plano (`explain`) no banco de desenvolvimento com volume sintético; a tabela cresce só com inserção, então o custo de escrita é pequeno.

## 2. Registro da consulta na trilha e falha que fecha (CA-H104-03; D1, D2)

- **Mesma trilha, mesma transação:** `private.audit_append('admin:' || p_actor, <papel>, 'audit.queried', 'audit_query', <consulta_id>, '{}', <estado>, null, null)`. `<papel>` é o primeiro papel ativo do ator que contém `audit.read` (`order by role_code`), lido de `admin_guard`; `consulta_id` é um UUID novo e também vai na resposta (permite ao Auditor referenciar a própria consulta).
- **Ação nova no catálogo (migração):** `audit.queried`, `object_type = 'audit_query'`, `reason_required = false`. Chaves permitidas (só escalares, sem chave proibida, valores no alfabeto `[A-Za-z0-9_.:-]`, até 64): `period_from`, `period_to` (ISO UTC com `Z`, sem `+`), `filter_action`, `filter_object_type`, `filter_object_id`, `after_seq`, `page_limit`, `returned_count`, `has_more`. **Nunca** o conteúdo dos eventos lidos. A migração deve passar pelo CHECK de chaves proibidas de 23 §1.3 (`period_from`, `filter_action` etc. não contêm termo proibido; o teste D-06 de 23 é ajustado para 6 ações).
- **Cada página é uma consulta:** uma página, uma entrada, com o `after_seq` usado e o `returned_count` da página. Dá rastro fiel e evita sessão de consulta com estado. Zero resultados também grava (CA-H104-03 "com ou sem resultados").
- **Regra de falha (D2):** não existe bloco `EXCEPTION` nem savepoint em volta de `audit_append` (regra B-08 de 23 §3). Qualquer erro (catálogo, `lock_timeout` de 5 s na cabeça da cadeia, conexão) propaga, a transação inteira desfaz e a API devolve **503 `auditoria_indisponivel`**, sem dado e sem tentar reler (sem "devolver e alertar"). A API não faz retentativa automática dentro da mesma transação; o cliente pode repetir. A falha vai a métrica sem PII.
- **Consulta não se vê no próprio resultado:** a leitura (passo 3) precede a gravação (passo 4); a nova entrada tem `seq` maior e entra só nas consultas seguintes.
- **Negações fora da trilha (D3):** 404, 403 e 422 não gravam entrada; vão a métrica agregada sem PII (`admin_denied{causa}`, mesmo padrão da H-102). Conferir: uma consulta rejeitada **não** cria `audit.queried`.
- **Contenção `[PROPOSTA]`:** a entrada toma o lock da cabeça da cadeia até o COMMIT (23 §7, item 4). A transação é curta (leitura indexada + um append). Risco R-2.

## 3. Permissão `audit.read`, rota, 404 e 403 (CA-H104-02, 05, 07)

- **Rota (registro de `ADMIN_ROUTES`, fonte única):** `POST /v1/admin/audit/queries`, permissão `audit.read`, corpo JSON `{from, to, action?, object_type?, object_id?, cursor?, limit?}`. Escolha de POST `[PROPOSTA]`: a chamada grava na trilha (não é segura nem idempotente para GET), mantém os filtros fora de URL e logs e passa pela checagem de `Origin` e `Content-Type` de 54 §3. A resposta carrega `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.
- **Sequência no manipulador:** (1) guarda da API `admin_guard` (uma consulta) → (2) `Origin` (só com sessão e papel válidos, ressalva da #111) → (3) validação do corpo (422) → (4) `audit_query` (revalida permissão no banco).

| Situação | Resposta | Entrada na trilha |
|---|---|---|
| Sem cookie, sessão vencida/revogada, sessão de outro domínio, staff `pendente_mfa`/`desativado`, sem papel ativo, papel revogado | **404**, corpo e cabeçalhos idênticos ao de rota inexistente | não |
| Sessão e papel ativos, sem `audit.read` (ex.: Financeiro, Superadmin) | **403** `{"code":"permission_denied"}` | não |
| Com `audit.read`, corpo válido | **200** com o `jsonb` de §1.1 | sim (`audit.queried`) |
| Falha ao gravar a entrada | **503** `auditoria_indisponivel`, sem dado | não (transação desfeita) |

- **Sem alteração nem exclusão (CA-H104-02):** não se cria nenhuma rota `PUT`, `PATCH` ou `DELETE` sob `/v1/admin/audit/*`; rota fora do registro responde 404. No banco, `UPDATE`/`DELETE` seguem negados (privilégio de H-006 e triggers `AU001`). A função de consulta é `STABLE`-equivalente em dados de domínio: escreve só `audit_event`, via `audit_append`.
- **Efeito imediato da revogação (CA-H104-07):** `admin_guard` na API e `admin_guard`/`admin_has_permission` dentro de `audit_query` leem o banco a cada chamada; nada vem do cookie além do segredo da sessão.
- **Superadmin não herda `audit.read`** (segregação de 54 §1): leva 403.

## 4. Validação do período e 422 (CA-H104-06; D4)

Validação na API (resposta rápida e mensagem estável) **e** na função (autoridade, mesmo critério); a função levanta `ADM31` (API: 422).

| Regra | Erro 422 (`code`) |
|---|---|
| `from` e `to` obrigatórios, instantes ISO 8601 com fuso (`Z` ou offset), convertidos a UTC | `periodo_invalido` |
| `from < to` | `periodo_invalido` |
| `to - from <= 90 days` (exato, `interval '90 days'`; teto fixo no banco, constante `AUDIT_QUERY_MAX_DAYS = 90` espelhada na API) | `periodo_acima_do_teto` |
| `limit` inteiro 1..100 (padrão 50); `cursor` inteiro >= 0 | `paginacao_invalida` |
| `action` presente no catálogo; `object_type` presente no catálogo; `object_id` UUID e só com `object_type` | `filtro_invalido` |
| Corpo com campo desconhecido ou tipo errado | `corpo_invalido` |

- O corpo do 422 traz só `code` e o nome do campo, **nunca o valor recebido** (CA-H104-04: erros sem eco de dado). 422 não grava entrada e não devolve dado.
- Sem limite inferior de data (a retenção é H-109). `to` no futuro é aceito (resultado é o que existe até agora).

## 5. Testes para o DEV (banco de desenvolvimento e unidade; sem rede e sem e-mail)

Setup bloqueia `fetch`/sockets (padrão T-H102). `AdminRepository` simulado em memória nos testes de manipulador. E-mails `@example.test`. Regra de ouro de 23 §6: banco de dev é compartilhado e a trilha não se apaga, então **todo teste de banco roda em transação com ROLLBACK**; `db:test` já é serial (`--test-concurrency=1`), o que evita disputa pelo lock da cadeia. Arquivo novo `packages/db/tests/audit-query.dbtest.mjs` e `packages/domain/tests/audit-query.test.ts`.

**Unidade (Vitest)**
- T-H104-01 validação (§4): sem `from`/`to`; `from >= to`; 90 dias exatos passa e 90 dias + 1 s → `periodo_acima_do_teto`; `limit` 0 e 101; `object_id` sem `object_type`; campo desconhecido. Corpo do erro sem eco do valor.
- T-H104-02 manipulador: sem sessão, sessão vencida, revogada, papel revogado, cookie de cliente → 404 byte a byte igual ao de rota inexistente; Financeiro e Superadmin → 403 `permission_denied`; Auditor → 200. Nenhum caso de negação chama `audit_query`.
- T-H104-03 matriz (T-08, `access-matrix`): `POST /v1/admin/audit/queries` está no registro com `audit.read`; para cada papel o resultado esperado; verbos `PUT/PATCH/DELETE` em `/v1/admin/audit/*` e em `/v1/admin/audit/events/:id` → 404 (CA-H104-02). Auditor chamando "aprovar estorno" → 403.
- T-H104-04 falha fecha: repositório devolve erro de auditoria → resposta 503 `auditoria_indisponivel`, corpo sem nenhuma linha de evento; sem retentativa; sem log com estado dos eventos.
- T-H104-05 sentinelas: e-mail, token, cookie e `row_hash` nunca aparecem em resposta, log ou erro; resposta tem exatamente as 12 chaves de §1.2 por evento.

**Banco (`audit-query.dbtest.mjs`, ROLLBACK; usuário admin sintético com papel `auditor` criado no teste)**
- T-H104-20 catálogo: `audit.queried` existe com as 9 chaves e `reason_required=false`; nenhuma chave na lista proibida; `audit_query` é `security definer` com `search_path=""`; EXECUTE só `app_system` (falso para `app_api`, `anon`, `authenticated`, `service_role`, PUBLIC); `app_api` continua sem `SELECT` em `audit.*` (D-02 de 23 ajustado).
- T-H104-21 filtros (CA-H104-01): semear eventos (via `audit_append`) em dois dias, duas ações, dois objetos; período, ação, entidade e combinações devolvem exatamente o conjunto esperado, em `seq` crescente; filtro omitido não restringe; limites do intervalo semiaberto (`at = p_to` fora, `at = p_from` dentro).
- T-H104-22 paginação: `limit=2` com 5 eventos → 3 páginas, `tem_mais` correto, sem repetição nem lacuna; cada página grava **uma** entrada (3 entradas, `returned_count` 2, 2, 1).
- T-H104-23 registro (CA-H104-03): entrada `audit.queried` com ator, papel, `period_from/to`, filtros, `returned_count` e instante; `after_state` não contém dado de evento lido (varredura de `to_jsonb(row)::text` por sentinelas do conteúdo semeado); consulta sem resultado também grava com `returned_count = 0`; a nova entrada não aparece na própria resposta e aparece na seguinte; `audit_verify_chain` continua `ok`.
- T-H104-24 falha fecha (CA-H104-03): forçar falha em `audit_append` (ação `audit.queried` com `active=false` dentro da transação, ou `lock_timeout` com a cabeça travada por uma segunda conexão) → erro, **nenhuma linha devolvida**, nenhuma entrada, `chain_head` inalterado após ROLLBACK.
- T-H104-25 autoridade no banco (CA-H104-05/07): hash de sessão inexistente, vencida e revogada → `ADM30`; Financeiro e Superadmin → `42501`; revogar o papel `auditor` na transação e chamar de novo → `ADM30` (efeito imediato); em todos, zero entradas novas.
- T-H104-26 validação no banco (CA-H104-06): período invertido, acima de 90 dias, ação fora do catálogo, `object_id` sem tipo, `limit` fora de 1..100 → `ADM31`, zero entradas.
- T-H104-27 imutabilidade (CA-H104-02): `SET LOCAL ROLE app_system` e `app_api`: UPDATE/DELETE/TRUNCATE em `audit_event` negados (`42501`); como dono: `AU001`. Reaproveita a bateria T-05 de 23.
- T-H104-28 plano: `explain` das consultas por período e por ação usa os índices novos (afirmar `Index Scan` ou `Bitmap Index Scan` com a tabela semeada; se o planejador escolher outro plano por volume baixo, registrar sem falhar).

Regressão: testes de H-006 (D-01..D-07, T-01..T-14), H-102 e H-073 continuam verdes; o teste D-06 de H-006 (exatamente 5 ações semeadas) é atualizado para 6 junto da migração. Evidência: `corepack pnpm check:all` e `db:test` locais; comando, contagem e código de saída na Issue.

### 5.1 Arquivos esperados e ordem
(1) migração `AAAAMMDDHHMMSS_audit_create_query.sql` (+ rollback manual `.down.sql`): ação no catálogo, 2 índices, `private.audit_query`, grants; (2) `packages/domain/src/admin/audit-query.ts` (validação pura, constantes, códigos de resposta) e linha no `ADMIN_ROUTES`; (3) repositório Pg em `packages/db/src/admin.ts` + manipulador; (4) testes T-H104-01..05; (5) `audit-query.dbtest.mjs`; (6) `pnpm db:migrate` em dev e `db:test`. Sem segredo em saída ou commit.

## 6. Riscos

| # | Risco | Mitigação |
|---|---|---|
| R-1 | A trilha cresce por consulta (uma linha por página). | Linha pequena (só filtros, 23 §1.1 limita 4 KB); página até 100; retenção/expurgo é H-109. Auditor mal-intencionado pode inflar a trilha: limite de taxa opcional (R-2). |
| R-2 | Cada consulta toma o lock da cabeça da cadeia (23 §7, item 4) e concorre com ações críticas. | Transação curta; `lock_timeout 5s`; leitura primeiro e `audit_append` por último. Opcional `[PROPOSTA]`: limite H-015 de 30 consultas por 5 min por admin (429 `muitas_consultas`, sem entrada). Se o tráfego crescer, cadeia por fatia (23 §7, item 4). |
| R-3 | Falha fecha derruba a consulta quando a cadeia está indisponível. | Aceito (D2): sem rastro, sem leitura. 503 explícito, cliente repete. |
| R-4 | O Auditor lê `before/after_state`; uma chave mal escolhida numa ação futura vira dado pessoal visível. | Defesa já existente (allowlist + alfabeto, 23 §1.4) e revisão de PR a cada ação nova (23 §8); a lista fechada de colunas de §1.2 não amplia o risco. |
| R-5 | Dono do banco contorna a trilha; ler não prova integridade. | Fora desta história (D6); `audit_verify_chain` fica com `app_system` (23 §2). Limites de 23 §8 valem. |
| R-6 | `private.audit_query` roda como dono e ignora RLS forçada (como `audit_append`). | Mesmo ponto 7.3 de 23 (D-07 confere `rolbypassrls`); função só lê as colunas listadas e é executável só por `app_system`. |
| R-7 | Índices extras encarecem a inserção. | Apenas 2 índices simples em tabela só de inserção; medir em T-H104-28. |
| R-8 | Sem tela até H-103, o Auditor só usa a rota (D5). | Aceito; H-104 entrega regra, rota e testes. |
| R-9 | Teto de 90 dias é número fixo no banco. | Constante única na função e espelho na API; mudança = migração. Ajustável pelo Product Owner. |

## 7. Dúvidas ao Orquestrador (não bloqueantes; recomendação em itálico)

1. **D-H104-7 POST em vez de GET** para a consulta (grava na trilha; filtros fora de URL e logs; checagem de `Origin`). *Recomendação: aceitar.*
2. **D-H104-8 Uma entrada por página** (e não por "sessão de consulta"). *Recomendação: aceitar; mantém o rastro fiel e o servidor sem estado.*
3. **D-H104-9 Limite de taxa por Auditor** (30 por 5 min, H-015) para proteger a cadeia e a trilha. *Recomendação: incluir se o DEV tiver folga; não bloqueia o aceite.*

## Resumo em linguagem simples

O Auditor poderá consultar o histórico do sistema informando um período de até 90 dias e, se quiser, o tipo de ação ou o item afetado; ele só lê, nunca altera nem apaga. Cada consulta fica registrada na própria trilha e, se o registro falhar, nada é mostrado.
Quem não tem sessão ou papel recebe a resposta de "página inexistente", e quem tem papel sem essa permissão é barrado; os testes usam serviços de mentira, sem rede nem e-mail.
