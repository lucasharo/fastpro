# Inventário F0 da matriz de acesso — H-115 (Issue #124)

- **Issue:** #124 `[E15] Autorização por recurso e paridade` · **História:** H-115 · **Workflow:** WF-03 · **Etapa:** Desenvolvimento, fatia F0 · **EXEC-ID:** EXEC-DEV-124-20261120
- **Desenho de referência:** `164-DESENHO-H115.md` (seção 8, F0). **Data:** 2026-11-20.
- **Natureza:** somente leitura. Nenhum código, teste, migração, grant ou dado foi alterado. As consultas rodaram no banco de desenvolvimento apenas com `SELECT` (catálogo `pg_*`, `information_schema`, `has_table_privilege`, `has_function_privilege`, `has_column_privilege`). Nada foi gravado.
- **Etiquetas:** `[VERIFICADO]` medido no DEV nesta rodada · `[AJUSTE]` correção do desenho por divergência com o banco ou o código · `[PENDÊNCIA]` a tratar em fatia própria.

---

## 1. Papéis de banco e conexão da API

| Papel | Login | BYPASSRLS | Quem usa | Situação |
|---|---|---|---|---|
| `app_api` | não (NOLOGIN) | não | rascunho, mídia, catálogo, cobrança (ver §3) | `[VERIFICADO]` não é membro de nenhum papel |
| `app_system` | não (NOLOGIN) | **sim** | pedidos, descoberta, perfil/verificação do profissional, admin, publicação, trial | `[VERIFICADO]` `DATABASE_URL_APP_SYSTEM` usa `fastpro_system_login`, membro com `inherit false` |
| `fastpro_api_login` | sim | não | conexão `DATABASE_URL_APP_API` | `[VERIFICADO]` membro de `app_api` com `inherit true`: herda o `EXECUTE` |
| `fastpro_system_login` | sim | não | conexão `DATABASE_URL_APP_SYSTEM` | `[VERIFICADO]` membro de `app_system` com `inherit false` |
| `app_keepalive` | sim | não | manutenção de conexão | `[VERIFICADO]` fora da API |
| `app_backup_reader` | sim | **sim** | leitura de cópia | `[PENDÊNCIA]` o papel existe no DEV, mas #151 tirou backup do escopo. Não é tratado aqui; registrar ao líder |
| `anon`, `authenticated` | não | não | — | `[VERIFICADO]` nenhum `SELECT` em nenhuma relação de `app`, `billing`, `ops`, `audit`, `private`, `public` |

`[VERIFICADO]` `SET ROLE app_api` funciona para a conexão de DEV (papel `postgres`, membro de `app_api`). Risco R-H115-C resolvido: o executor de banco pode usar `set local role app_api`.

## 2. Estado de RLS, grants e funções (DEV)

- `[VERIFICADO]` 63 relações nos esquemas `app` (43), `billing` (4), `ops` (13), `audit` (3). `private` e `public` não têm tabelas. **Todas** as tabelas têm RLS habilitada e forçada.
- `[VERIFICADO]` Nenhuma view e nenhuma view materializada nesses esquemas. Logo, CAT-05 (`security_invoker`) é trivialmente cumprida; `catalog.dbtest.mjs` já cobre o caso.
- `[VERIFICADO]` `app_api` **não tem privilégio de tabela** em nenhuma relação, e **nenhum privilégio de coluna** em `app` (`has_column_privilege` falso em todas as colunas). Logo, `table_select` como sonda do `app_api` não representa a produção.
- `[VERIFICADO]` 233 funções `SECURITY DEFINER` em `app`, `private`, `billing`, `ops`, `audit`. **Todas** têm `search_path=""` (algumas também `lock_timeout=5s`). Zero sem `search_path`. Regra CAT-04 cumprida.
- `[VERIFICADO]` 34 funções `SECURITY DEFINER` são executáveis por `app_api`: `audit_append`, `catalog_admin_list`, `catalog_group_save`, `catalog_public_list`, `catalog_revision_list`, `catalog_search`, `catalog_service_save`, `catalog_synonym_save`, `commercial_access`, `draft_*` (confirm, create, discard, get, identity_get, identity_set, patch, review_get), `media_*` (delete, finalize, get, issue, known, list, original_cleanup_list, original_removed, purge_done, read_target, reduce_begin/done/reject/release, reorder, sweep), `plan_price_at`.
- `[VERIFICADO]` As demais funções de negócio (pedido, descoberta, profissional, admin, verificação, contato, ops) são executáveis **só por `app_system`**.

### 2.1 Lacuna real encontrada (CAT-06)

`[VERIFICADO]` Oito funções **não** `SECURITY DEFINER` em `private` são executáveis por `PUBLIC`, `anon` e `authenticated`. Todas retornam `trigger`:

`private.dsr_case_event_refuse_mutation`, `private.dsr_case_guard`, `private.dsr_case_insert_guard`, `private.dsr_case_refuse_delete`, `private.dsr_export_guard`, `private.dsr_registro_refuse_delete`, `private.dsr_step_up_grant_guard`.

Esta é a lista exata de funções com `PUBLIC` no `EXECUTE` em `private` (8 de 336). É violação de CAT-06 (EXECUTE de `private.*` negado a `PUBLIC`, `anon` e `authenticated`).

- Efeito prático: baixo. Função `trigger` não pode ser chamada diretamente por SQL, e o `EXECUTE` não é checado quando o gatilho dispara. Revogar não quebra os gatilhos existentes.
- Domínio: H-111 (#120, direitos do titular), que está em Desenvolvimento em paralelo. Não toco nesse domínio sem decisão.
- Tratamento previsto: a F2 (CAT-06) vai reprovar essa lista. A correção é `revoke execute ... from public, anon, authenticated` por migração reservada (faixa `20261120300000`+), conforme §6.3 do desenho. Será aplicada só se o teste confirmar, e registrada na Issue.

## 3. Mapa rota → caminho de banco → papel da sonda

`[AJUSTE A-1]` O desenho (§4.2) assume que toda sonda roda como `app_api`. **Isso não vale para a maior parte do sistema.** A sonda de cada caso deve usar o papel e a função que a rota realmente usa.

| Caso / recurso | Rota (método e caminho) | Cliente da API | Papel da sonda | Função de produção (sonda `function_call`) |
|---|---|---|---|---|
| Pedido do dono, lista | `GET /v1/requests` | `DATABASE_URL_APP_SYSTEM` | `app_system` | `private.request_list_owner` |
| Pedido do dono, detalhe | `GET /v1/requests/<id>` | `DATABASE_URL_APP_SYSTEM` | `app_system` | `private.request_owner_get(p_user, p_request_id)` |
| Visão do profissional | `GET /v1/professional/requests/<id>` | `DATABASE_URL_APP_SYSTEM` | `app_system` | `private.request_detail_professional` |
| Descoberta | `GET /v1/professional/discovery/requests` | `DATABASE_URL_APP_SYSTEM` | `app_system` | `private.discover_requests` |
| Cobertura do pedido | (leitura interna do detalhe) | `DATABASE_URL_APP_SYSTEM` | `app_system` | `private.coverage_for_request` |
| Telefone (revelação) | (aceite/consentimento) | `DATABASE_URL_APP_SYSTEM` | `app_system` | `private.contact_reveal_phone` (`deferred` para chat/aceite) |
| Rascunho sem conta | rotas de rascunho (H-025) | `DATABASE_URL_APP_API` | `app_api` | `private.draft_get`, `draft_create`, `draft_patch`, `draft_discard`, `draft_confirm` |
| Fotos (mídia) | rotas de mídia | `DATABASE_URL_APP_API` | `app_api` | `private.media_get`, `media_list` |
| Catálogo de busca | `POST` de busca do catálogo | `DATABASE_URL_APP_API` | `app_api` | `private.catalog_search` |
| Perfil público | `GET /v1/public/professionals/<slug>` | `DATABASE_URL_APP_SYSTEM` | sem sessão (`anon`) | `private.professional_public_profile` |
| Perfil e área do profissional | `GET/PUT /v1/professional/profile`, `/profile/area` | `DATABASE_URL_APP_SYSTEM` | `app_system` | `professional_area_get`, `professional_area_save`, `professional_profile_set_document` |
| Documento de identidade | (verificação) | `DATABASE_URL_APP_SYSTEM` | `app_system` | `private.idoc_list`, `idoc_review_target` |
| Caso de verificação | `GET /v1/admin/verificacao/casos[/<id>]` | `DATABASE_URL_APP_SYSTEM` | `app_system` | `private.verification_queue_list`, `verification_case_detail` |
| Painel e auditoria (admin) | `GET /v1/admin/...` (ops), `POST /v1/admin/audit/query` | `DATABASE_URL_APP_SYSTEM` | `app_system` | `private.ops_panel_read`, `private.audit_query` |
| Caso de acesso (admin) | `.../admin-access-case` | `DATABASE_URL_APP_SYSTEM` | `app_system` | `private.access_case_*` |
| Cobrança e trial | `POST /v1/billing/trial/activate` | `DATABASE_URL_APP_SYSTEM` (trial), `app_api` (`commercial_access`) | conforme função | `private.trial_activate`, `private.commercial_access` |
| Conta e sessão do profissional | `GET /v1/professional/me` | `DATABASE_URL_APP_SYSTEM` | `app_system` | `private.professional_me` (sem `EXECUTE` para `app_api`) |

Rotas registradas em `apps/api/src/app.ts` (método + caminho, verificadas): `GET /health`; `POST` tick, consume, challenges, challenges/verify, step-up, audit query, console, ops, auth session, `POST /v1/geo/...` (endereço), catálogo (`POST`); `GET` e `POST` de `/v1/requests` e `/v1/requests/`; `GET /v1/public/professionals/`; `GET/PUT /v1/professional/profile` e `/profile/services`, `/profile/area`; `GET /v1/professional/verificacao`, `POST /v1/professional/verificacao/recurso`; `GET /v1/professional/me`; `POST /v1/professional/password/change`; `POST /v1/professional/...` (rotas de conta); `POST /v1/auth/...` (sessão, logout, senha); `GET /v1/admin/catalog`, `/v1/admin/retention`, `/v1/admin/verificacao/casos`.

`[PENDÊNCIA]` Caminhos exatos de rascunho (`/v1/drafts`?) e de mídia não foram confirmados linha a linha nesta fatia. O F3 confirma antes de escrever os casos de API.

## 4. Estado das sondas (`deferred`)

Entidades futuras, pelo código atual, não têm relação nem função:
- `app.conversation`, `app.message` (chat #71, #76, #77, #136): `[VERIFICADO]` não existem no DEV nem têm função.
- Seleção, aceite, avaliação, checkout (#60 a #67, #84 a #101): `[VERIFICADO]` sem relação no DEV.

Os casos ativos da matriz são os que têm função de produção acima. Os `deferred` ficam em `to_regclass(requiresRelation)` para o aviso de ativação (desenho §5.5).

## 5. Storage (CAT-07)

- `[VERIFICADO]` Buckets `request-photos` e `identity-docs` existem e são **privados** (`public = false`).
- `[VERIFICADO]` `storage.objects` tem **uma** política: `dsr_exports_negar_acesso_direto`, `RESTRICTIVE`, `ALL`, para `public`, com `bucket_id IS DISTINCT FROM 'dsr-exports'`. Não há nenhuma política `PERMISSIVE`. Sem política permissiva, `anon` e `authenticated` não leem os objetos.
- `[AJUSTE]` O desenho pede "nenhuma política SELECT para anon/public". O DEV está mais restrito: nenhuma política permissiva. CAT-07 vai afirmar as duas coisas: nenhuma política permissiva e, por comportamento, `SET ROLE anon` não enxerga objetos de `request-photos` e `identity-docs`.

## 6. Achados e ajustes para as fatias seguintes

| ID | Achado | Efeito | Tratamento |
|---|---|---|---|
| A-1 | Sonda deve usar o papel da rota (§3). `app_api` não lê tabela nem coluna. | Desenho §4.2 precisa do papel por caso. | F4 usa o papel e a função da rota |
| A-2 | Rotas de negócio usam `app_system`, com `BYPASSRLS`. A proteção está na função, por parâmetro explícito (`p_user`, `p_request_id`). | A paridade desses casos prova a lógica da função, não o RLS. | Registrar no relatório. Casos de RLS direta valem só para `app_api` |
| A-3 | `set_config('app.*')` só é usado nas funções de catálogo (`app.principal_id`, `app.principal_type`, `app.aal`, `app.permissions`, `app.offering_purge`, `app.correlation_id`). Os demais `app.*` não existem no banco. | Decisão 913 vale só para as funções de catálogo e admin. Demais casos recebem o principal como argumento. | Ajuste do desenho §4.2, registrado no relatório |
| A-4 | `app.catalog_public` (migração `20261111200000`) não existe no DEV. A migração `20261111250000` a removeu com `drop view if exists`. | Sem efeito: o grant citado não está ativo. | Nenhum. Só nota |
| A-5 | Grants de coluna em `app.service`, `app.service_group`, `app.service_synonym` citados nas migrações não estão ativos no DEV. | `app_api` não lê essas tabelas direto. | Nenhum. Só nota |
| A-6 | Oito funções `private.dsr_*` (trigger) com `EXECUTE` para `PUBLIC`, `anon`, `authenticated`. | Violação de CAT-06. | F2 reprova. Migração reservada se confirmado (§2.1) |
| A-7 | Papel `app_backup_reader` existe com `LOGIN` e `BYPASSRLS`, apesar de #151 ter tirado backup do escopo. | Fora de H-115. | Pendência para o líder |
| A-8 | Nomes de relação do desenho divergem do DEV: pedido é `app.service_request` (não `app.request`); caso admin é `app.access_case` (não `app.admin_access_case`); trilha é `audit.audit_event` (não `ops.audit_event`). `app.conversation`, `app.address_share`, `app.acceptance` não existem. | Relações erradas quebrariam o guarda de relação. | F1 usa os nomes reais. `app.acceptance` é o nome provisório do aceite (#71), ainda inexistente |
| A-9 | O desenho fala em 19 principais; a lista tem 20 (inclui `app_system`). | Contagem apenas. | F1 usa 20 |

## 7. Saídas da F0 e critérios para F1

- Nenhum arquivo de código foi alterado. Este inventário é o único artefato.
- F1 (matriz e integridade em `packages/access-matrix`) não depende de nada além desta F0: os casos ativos em §3 e os `deferred` em §4 já estão definidos.
- F2 (CAT-01 a CAT-08) pode começar. A lacuna A-6 deve aparecer como falha de CAT-06 e é o único motivo para uma migração reservada.
