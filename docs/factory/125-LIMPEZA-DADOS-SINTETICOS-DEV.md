# 125 — Limpeza dos dados sintéticos do banco de desenvolvimento

**Autorização:** pergunta 261, Rodada 89 de `11-DECISOES.md` ("apague os dados", 2026-11-13).
**Escopo:** só registros sintéticos de teste com marcador, criados há mais de 2 horas, no banco de DESENVOLVIMENTO (`DATABASE_URL_MIGRATIONS` do `.env.local`). Sem outro ambiente, sem MCP do Supabase, sem Docker, sem rotação de senha. Nenhum valor de conexão foi impresso ou gravado.

**Marcadores usados:** e-mail `@example.test`; `h037-conc-`; `h039-`; `H031` (nomes "Grupo H031…" e "Servico H031…"). Linhas filhas (perfil, documento, caso de verificação, evento, ponto de geocodificação, sessão, papel de administrador) entram quando pertencem a um usuário marcado.

**Fora do escopo desta limpeza (ficam):**
- 15 usuários com domínio `sintetico.test`: são a carga de demonstração, removida só pelo comando próprio de demonstração (com dry-run). Não são marcador de teste desta autorização.
- Linhas com data 2099 sem dono marcado (fila de tarefas `ops.job`, contadores de taxa `ops.rate_counter`, bloqueio `ops.code_lock`): não trazem marcador de teste e não têm data de criação para provar a idade de 2 horas.

## 1. Inventário (somente leitura, `BEGIN READ ONLY`)

Contagens do DEV antes de qualquer escrita. "Marcados" = marcador no registro ou dono marcado. "Elegíveis" = marcados e criados há mais de 2 horas.

| Tabela | Total | Marcados | Elegíveis (>2 h) | Situação |
|---|---:|---:|---:|---|
| `ops.idempotency_key` | 26 | 26 | 26 | apagável (sem chave estrangeira) |
| `app.request_draft` | 7 | 5 | 5 | 3 têm pedido de origem (`origin_draft_id`): ficam |
| `app.app_user` | 58 | 43 | 14 | 9 têm pedidos do cliente (chave estrangeira RESTRICT): ficam |
| `app.service` | 595 | 20 | 11 | 9 têm pedido ou rascunho ligado: ficam |
| `app.service_group` | 45 | 20 | 11 | 9 têm serviço ligado (`service_group_fk`): ficam |
| `app.identity_document` | 8 | 8 | 0 | criados há menos de 2 h (teste em andamento): ficam |
| `app.verification_case` | 8 | 8 | 0 | recentes; além disso bloqueado pelo gatilho `verification_case_no_delete` |
| `app.verification_case_event` | 19 | 19 | 0 | recentes; além disso imutável (`verification_case_event_no_mutation`) |
| `app.professional_profile` | 21 | 8 | 0 | recentes |
| `app.customer_profile` | 3 | 1 | 0 | recente |
| `app.admin_staff` | 11 | 11 | 0 | recentes |
| `app.admin_session` | 11 | 11 | 0 | recentes |
| `app.admin_user_role` | 11 | 11 | 0 | recentes |
| `app.app_session` | 1 | 0 | 0 | sem marcador |
| `app.geocode_point` | 22 | 0 | 0 | sem marcador |
| `app.auth_challenge` | 1 | 0 | 0 | sem marcador |
| `ops.rate_counter` | 56 | 0 | 0 | 4 linhas com janela em 2099 e sem data de criação: ficam |
| `ops.job` | 64 | 0 | 0 | 18 com data 2099 sem dono marcado: ficam |
| `app.service_request` (pedidos) | 18 | 18 (dono marcado) | — | **não apagável pelo banco** (`service_request_sem_delete_bd`) |
| `audit.audit_event` (auditoria) | 93 | 0 | — | **não apagável** (somente inserção, `tg_block_mutation`) |
| `app.access_case`, `app.sensitive_access_log` | 0 e 3 | 0 | — | **não apagável** (gatilhos de acesso) |
| `app.professional_area`, `app.professional_area_history` | 0 | 0 | — | **não apagável** (gatilhos `professional_area_apagar_bd` e `professional_area_history_guard_bud`) |

Demais tabelas de `app`, `audit`, `ops` e `billing` não têm linha marcada. `auth.users` e `storage.objects` estão vazios.

## 2. Dry-run (transação com `ROLLBACK`)

Script: `limpeza-sinteticos.mjs` (fora do repositório, no scratchpad da sessão), modo padrão. Ordem por dependência (filhos antes de pais), passagens até estabilizar, uma linha por savepoint. Guarda: tabelas fora do escopo com diferença zero, impressão digital (md5) das linhas não marcadas idêntica antes e depois.

Resultado: **guarda aprovada**; nenhuma linha não marcada alterada; só tabelas do inventário mudaram.

Apagaria: `ops.idempotency_key` 26; `app.request_draft` 2; `app.service` 2; `app.service_group` 2; `app.app_user` 5.

Recusadas pelo banco (ficam, com motivo registrado): 9 usuários, 9 serviços e 9 grupos (chaves estrangeiras de pedidos, rascunhos e serviços).

**Ocorrência corrigida no dry-run:** a primeira versão apagaria 5 rascunhos. A chave estrangeira de `origin_draft_id` é `SET NULL`, e o gatilho de pedido não bloqueou a alteração do pedido. Isso alteraria pedidos, o que a autorização proíbe. A regra passou a excluir rascunhos que são origem de pedido, e a guarda passou a comparar as linhas não marcadas. Nenhuma linha foi apagada nessa tentativa (transação revertida).

## 3. Execução

Executada uma vez, em 2026-11-13 por volta das 16:19 (horario local), em transacao unica com COMMIT; guarda aprovada; nenhuma linha nao marcada alterada. Apagadas por tabela: ops.idempotency_key 26; app.request_draft 2; app.service 2; app.service_group 2; app.app_user 5. Recusadas pelo banco (ficam): app.service (6 por service_request_service_id_fkey, 3 por request_draft_service_id_fkey), app.service_group 9, app.app_user 9. Marcadores: e-mails @example.test e marcadores H031, h037-conc-, h039- (somente linhas criadas ha mais de 2 horas). Em 2026-11-14 a coordenacao suspendeu a limpeza: nada mais sera apagado ate o usuario confirmar explicitamente.

## 4. Contagens antes e depois

Antes: ops.idempotency_key 26; app.request_draft 7; app.service 598; app.service_group 48; app.app_user 61. Depois: 0; 5; 596; 46; 56. Demais tabelas de app, audit, ops e billing: sem diferenca (service_request 21 e audit.audit_event 96 antes e depois).

## 5. Pendências

- Os 15 usuários `sintetico.test` e os dados de demonstração continuam; a remoção deles é decisão separada, pelo comando de demonstração.
- Os 9 usuários, 9 serviços e 9 grupos com pedidos ficam porque a própria proteção do banco impede apagar pedidos. Não há ação possível sem alterar pedidos, o que está fora da autorização.
- Os 3 rascunhos que são origem de pedido ficam pelo mesmo motivo.
- Registros marcados criados há menos de 2 horas (testes em andamento) ficam; podem ser removidos em outra rodada, depois que os testes terminarem.
