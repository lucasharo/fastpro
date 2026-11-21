# Entrega H-111 (Issue #120): fatias 9 e 10 e pendências do desenho 147

- Workflow: WF-03, etapa Desenvolvimento (continuação). EXEC-ID: EXEC-DEV2-120-20261120.
- Branch de trabalho: `feature/init`. Desenho: `147-DESENHO-H111.md`. Decisões: Rodadas 141 e 143 de `11-DECISOES.md`.
- Situação: a Issue NÃO está completa. As fatias de banco e de serviço estão entregues e testadas; faltam as rotas da API (titular e DPO), o processamento da correção e o vigia de prazo.

## 1. Fatias desta sessão

| Fatia | Commit | Conteúdo |
|---|---|---|
| 9 (extrato, serviço TS) | `09ac1a7` | `GeradorExtratoDsr` chama `app.dsr_admin_generate_extract`, grava o JSON no bucket privado `dsr-exports` (nome aleatório, sem sobrescrita), calcula sha256 e HMAC-SHA256 com chave de servidor (só em memória), registra com `app.dsr_register_extract` e apaga o arquivo se o registro falhar. Storage ganha `gravar`. |
| 10 (download de uso único, D-A6) | `73d22d7` | Migração `20261120000000_privacy_create_dsr_download` (tabela `app.dsr_download_token`, funções `app.dsr_issue_extract_token` e `app.dsr_consume_extract_token`, ação `dsr.extract_downloaded`). `ServicoDownloadExtrato` emite token de 256 bits (validade de 5 min, limitada à validade do extrato), consome uma vez, lê o arquivo e confere sha256 e HMAC antes de devolver. Storage ganha `ler`. |

Fatias 1 a 8 já estavam commitadas (até `98fb76b`).

## 2. Migrações

- `20261120000000_privacy_create_dsr_download.sql`: aplicada no DEV pelo executor do repo (`node packages/db/scripts/db.mjs migrate`). Status depois: 97 aplicadas, 0 pendentes.
- Desfazer: `supabase/rollbacks/20261120000000_privacy_create_dsr_download.down.sql` (recusa se houver tokens gravados; não executado).
- Nenhuma migração de outra faixa foi tocada.

## 3. Testes (rodados localmente)

| Comando | Resultado |
|---|---|
| `npx vitest run` com `privacy-dsr-download.test.ts`, `privacy-dsr-extrato.test.ts`, `privacy-dsr-jobs-handlers.test.ts`, `privacy-dsr-download-migration.test.mjs` (em `packages/db`) | 4 arquivos, 70 testes, saída 0 |
| `npx vitest run tests/privacy-*migration* tests/privacy-dsr-*.test.ts` | 12 arquivos, 172 testes, saída 0 |
| `node --test --test-concurrency=1 packages/db/tests/privacy-*.dbtest.mjs` (banco de DEV, cada teste em transação com rollback) | 82 testes, 82 aprovados, 0 falhas, saída 0 (rodado duas vezes, antes e depois de outros commits) |
| `npx tsc -p packages/db/tsconfig.json --noEmit` | saída 0 |
| `npx eslint` nos arquivos tocados | saída 0 |

Não executados: `db:test` completo, `check:all` (fora do escopo desta sessão, conforme a instrução), testes de API (não há rotas do H-111 ainda).

Ajuste em teste de vizinho: `privacy-step-up-export.dbtest.mjs`, T-DB-02 (TRUNCATE do extrato). A tabela nova referencia o extrato com chave estrangeira, e o Postgres recusa o TRUNCATE pela FK antes do gatilho. A proteção continua valendo; a asserção agora aceita as duas mensagens.

Observação de ambiente: o relógio desta máquina está cerca de 71 s atrás do relógio do banco de DEV. O teste de validade do token mede pelo `now()` do próprio banco para não depender disso.

## 4. Pendências do desenho 147 (o que falta)

Ordem sugerida pela dependência. Nenhuma depende de chave ou decisão do dono.

- **P-A, rotas do titular (§5.1), não implementadas:** `POST /v1/privacy/step-up` e `/step-up/confirm` (depende da composição do desafio existente em `apps/api/src/challenge-*`); `POST` e `GET /v1/privacy/dsr-requests`; `GET /:id` com `download_url` (chama `ServicoDownloadExtrato.emitir`); `POST /:id/cancel`. Hoje não há `apps/api/src/privacy/`.
- **P-B, rotas do DPO (§5.2), não implementadas:** listar, detalhar, abertura assistida, atribuir, processar, recusar. As funções SQL de atribuição, recusa e geração de extrato já existem (migração 520000).
- **P-C, processamento da correção (kind `correcao`), não localizado:** a função `app.dsr_process` (despacho por tipo, whitelist de campos e auditoria `dsr.correction_applied`) não aparece nas migrações. Antes de concluir a Issue, confirmar.
- **P-D, vigia de prazo (`dsr_deadline_watch`, §4.4), não localizado** nas migrações.
- **P-E, abertura assistida pelo DPO (`app.dsr_open_assisted`, §4.2):** a busca encontrou um arquivo com o termo; confirmar se a função existe com esse nome.
- **P-F, limite de emissão de token (R-10):** não há contador por extrato no banco. O limite deve ficar na camada de API (§6.1).
- **P-G, falha do Storage depois do consumo:** o token fica usado e o titular precisa de um novo link (cada `GET` gera um novo token). Registrar isso na resposta da API.
- **P-H, testes de API (T-API-*) e de interface:** dependem de P-A e P-B.
- **P-I, execução dos jobs:** os handlers e o registro (`registerDsrJobHandlers`) existem; não verifiquei nesta sessão se o ticker de jobs os chama.
- **P-J, pendências jurídicas (DV-1, posições 663, 666, 667, 668, 669, 670, 673, 678 e 681):** rodam como `[PROPOSTA]` em DEV. Fora do escopo até produção.

## 5. Decisões tomadas nesta sessão (para o líder registrar)

- Uso único do token: o banco guarda só o SHA-256; a validade de 5 min é fixa na função (D-A6). Alternativa: parametrizar por `app_config`. Recomendação: manter fixa agora.
- A recusa de TRUNCATE do extrato passou a aceitar a mensagem da FK nova. Alternativa: remover a FK e manter só o gatilho. Recomendação: manter a FK (integridade referencial do token).

## 6. Pode ir a Code Review?

Parcialmente. As fatias 1 a 10 (banco e serviços TypeScript) podem ser revisadas como entrega parcial. A Issue não deve ir para Aguardando aprovação nem para QA antes de P-A, P-B e P-C. A decisão de mover o cartão é do Orquestrador.

## 7. Trailers de commit

As tarefas pediram `Co-Authored-By: Claude Sonnet 5.5`. Os commits desta sessão usam `Claude Haiku 5.5`, que é o modelo deste agente e o indicado pela regra de atribuição do sistema. Não atribuí a um modelo que não foi usado.

## 8. Continuação 4 (EXEC-DEV4-120-20261120)

Modelo real deste agente: Claude Haiku 5.5 (`claude-haiku-5-5`). Trailer usado: `Co-Authored-By: Claude Haiku 5.5`.

### 8.1 Commits

| Commit | Conteúdo |
|---|---|
| `c9319da` | Rotas do titular (P-A parcial): `POST` e `GET /v1/privacy/dsr-requests`, `GET /:id` (sem `download_url`), `POST /:id/cancel`. Montagem em `privacy-composicao.ts`, ligação em `app.ts` e `composicao.ts`, testes em `titular-route.test.ts`. |
| `6cda75a` | Painel do DPO (P-B em nível de contrato): `GET` e `POST /v1/admin/privacy/dsr-cases`, `GET /:id`, `POST /:id/assign`, `/:id/process`, `/:id/reject`. Serviço `dpo-service.ts`, rota `dpo-route.ts` (guarda admin, permissão da rota, Origin e JSON nas mutações), montagem `dpo-composicao.ts`, testes `dpo-route.test.ts`. Permissões `dsr.read`, `dsr.decide` e `dsr.open_assisted` entram em `packages/domain/src/admin/roles.ts` (`ADMIN_PERMISSIONS`); o `dist` do domínio foi reconstruído. |

### 8.2 Testes (rodados localmente)

| Comando | Resultado |
|---|---|
| `npx vitest run src/privacy tests/app.test.ts` (em `apps/api`) | 3 arquivos, 48 testes, saída 0 |
| `npx tsc -p tsconfig.json --noEmit` (em `apps/api`) | saída 0 |
| `npx eslint src/privacy src/app.ts src/composicao.ts` (em `apps/api`) | saída 0 |
| `npx vitest run` (em `packages/domain`) | saída 0 |

Não executados nesta sessão: `check:all`, `db:test` completo (fora do escopo, conforme instrução). Nenhuma migração nova foi criada nesta sessão.

### 8.3 Pendências

- **P-A, step-up (`POST /v1/privacy/step-up` e `/step-up/confirm`): NÃO implementado.** `app.step_up_grant` existe, mas não há função SQL para emitir o código de 6 dígitos (com tentativas e bloqueio) nem para trocar o código pelo token de uso único. `private.step_up_request` e `private.step_up_verify` são ligados à sessão de identidade e não servem ao titular. Exige migração nova, função de emissão, enfileiramento do e-mail em `ops.email_outbox` com modelo, e testes de banco. Sem isso, o titular não consegue abrir acesso nem eliminação: a API responde 403 `step_up_obrigatorio` sempre.
- **P-A, `download_url` em `GET /:id`: NÃO implementado.** `ServicoDownloadExtrato.emitir` existe em `packages/db`, mas faltam a rota de consumo do link, a composição do Storage e a URL assinada de 5 minutos.
- **P-B, processar caso de acesso:** responde 409 `dsr_acesso_usa_extrato`. A geração do extrato (`app.dsr_admin_generate_extract` mais `GeradorExtratoDsr`, que grava no bucket `dsr-exports`) não está composta na API.
- **P-B, dupla aprovação da eliminação assistida:** o SQL confere `approval_request`; a rota não cria nem consulta a aprovação.
- **P-F, limites de emissão (5 aberturas por dia, 3 step-ups por hora, 1 extrato por 30 dias na API):** não implementado. O limite de extrato já é recusado pelo SQL (`dsr_carencia`).
- **P-H, testes:** cobertos em nível de contrato T-API-01, 02, 03, 07, 08 e 16 (parcial). Faltam T-API-05 (download de uso único), T-API-10 (rate limit), testes do step-up e teste de montagem (`dpo-composicao.ts`).
- **Ligação na Vercel, bloqueio para as rotas funcionarem em DEV:** `apps/api/src/vercel.ts` NÃO foi tocado (alteração alheia, não commitada). Sem as linhas `privacyTitular: integracoes.privacyTitular` e `privacyDpo: integracoes.privacyDpo` nesse arquivo, as rotas do titular e do DPO não sobem na função da Vercel e respondem 404 vazio. É preciso registrar isso para quem é dono do arquivo.
- **P-C, P-D e P-E (processar, vigia de prazo e abertura assistida):** a migração `20261120410000` existe no repositório (commit `a51b061`). A aplicação no banco de DEV não foi verificada nesta sessão.
- **P-I, ticker de jobs:** não verificado.
- **P-J, pendências jurídicas:** fora do escopo até produção.

### 8.4 Pode ir a Code Review?

Ainda não como Issue completa. As rotas do titular e do DPO estão prontas em nível de contrato e de testes unitários de API, mas o step-up (P-A) e o download não existem, e a ligação na Vercel depende de arquivo alheio. O cartão da Issue #120 continua em Desenvolvimento. Os commits podem ser revisados como entrega parcial (fatias de API desta sessão).

### 8.5 Decisões tomadas nesta sessão (para o líder registrar)

- As permissões `dsr.*` foram adicionadas à lista do domínio. O mapa `ADMIN_ROLE_PERMISSIONS` não foi alterado, porque a autoridade de permissão é a tabela `app.admin_role_permission` (já semeada na migração 520000).
- As colunas `out_*` das funções SQL do DPO são publicadas sem o prefixo. Para listar, a lista devolve o cursor com `opened_at` e `case_id` da última linha.

## 9. Continuação 6 (EXEC-DEV6-120-20261120, 2026-11-20)

- **Commit f296980**: migração 20261120600000 (step-up: tabela de códigos, emissão, confirmação, blob selado), serviço e ponte SQL no pacote db, modelo de e-mail `dsr_stepup`, policy de domínio (18 tipos), composição do step-up e do download no `privacy-composicao.ts`. Typecheck da API voltou a verde nesta fatia (o `dist` dos pacotes estava defasado e o `auth-renderer.ts` tinha um `join` quebrado, corrigido).
- **Commit deste registro**: migração corretiva **20261120620000** (com rollback). O guarda `private.dsr_step_up_code_guard` proibia gravar `outbox_id`, e a emissão grava esse campo logo após inserir o código. Toda emissão falhava com `dsr_step_up_code_imutavel`. A correção permite preencher `outbox_id` uma vez (nulo para valor) e mantém o resto da regra. Aplicada no DEV via `corepack pnpm db:migrate` (111 aplicadas, 0 pendentes). A migração 20261120600000 já aplicada não foi editada.
- **Testes desta continuação**:
  - `packages/db/tests/privacy-dsr-step-up.test.ts` (unitário, ida e volta do código, HMAC, hash do token, decorador de envio): 10 testes, passando.
  - `packages/db/tests/privacy-dsr-step-up-migration.test.mjs` (estático): 11 testes, passando.
  - `apps/api/src/privacy/titular-stepup-route.test.ts` (rotas POST /v1/privacy/step-up e /step-up/confirm): 11 testes, passando.
  - `packages/db/tests/privacy-dsr-step-up.dbtest.mjs` (banco DEV, transacional, com rollback): 9 testes, passando.
  - `packages/db/tests/authorization-catalog.dbtest.mjs` (CAT-01 a CAT-08, inclusive CAT-06): 11 testes, passando após a migração corretiva.
- **Pendência P-C (aberta, não resolvida nesta continuação)**: o `DsrStepUpEmailProvider` (decorador que troca a referência do e-mail pelo código no instante do envio) ainda não está ligado a nenhum consumidor. O despacho genérico de `ops.email_outbox` (`registerNotificationHandlers`) não é montado em `apps/api`. Logo, o código é gerado e enfileirado, mas o envio real depende dessa composição. Nenhum e-mail foi enviado.
- **Pendência P-D**: o typecheck da API está vermelho por arquivos **não commitados de outra fatia** (`apps/api/src/requests/photo-view-*.ts` e `packages/db/src/photo-view-store.ts`, que não está exportado pelo `index.ts`). Não são desta Issue e não foram tocados.
- **Não feito**: `check:all` e `db:test` completos (não solicitados). Os testes desta continuação foram rodados por arquivo.

## 10. Continuação 7 (EXEC-DEV7-120-20261121, 2026-11-21)

- **P-C fechado em nível de envio (sem tick):** `PgDsrTitularDirectory` (`packages/db/src/privacy-dsr-step-up.ts`) lê o e-mail cadastrado (`app.app_user`) só no instante do envio; conta bloqueada vira `suprimido`. `comEnvioStepUp` (`apps/api/src/privacy/dsr-stepup-envio.ts`) agenda, pela primitiva pos-resposta, o `processOutbox` existente (cota, espaçamento e revalidação do pipeline) com o `DsrStepUpEmailProvider` por cima do provedor real. Sem `waitUntil`, nada é agendado e a linha fica pendente: não há tick nem contingência neste fluxo. `registerNotificationHandlers` continua não montado (depende de executor de jobs).
- Ligação: `montarPrivacidadeTitular` recebe `email` e `waitUntil`; `composicao.ts` passa o provedor de e-mail já montado; `vercel.ts` passa `waitUntil`. **Pendente de commit:** as linhas desses dois arquivos misturam alterações não commitadas do H-056 (`watermarkedPhoto`), então não foram commitadas por este agente.
- Testes: `apps/api/src/privacy/dsr-stepup-envio.test.ts` (5 testes, cliente SQL falso, sem rede). Demais: `src/privacy` 4 arquivos, 48 testes, saída 0; `packages/db/tests/privacy-dsr-step-up.test.ts` 11 testes, saída 0. `tsc` da API e do pacote db: saída 0. ESLint nos arquivos tocados: saída 0.
- **Não feito nesta continuação:** teste ponta a ponta de API com banco (exige sessão real e extrato para o `download_url`; a fixação do papel app_system no banco de DEV e a sessão ainda não estão montadas no teste); composição da geração do extrato no caso de acesso (P-B 3); limites de 5 aberturas por dia e 3 step-ups por hora na API (P-F). Nenhuma migração nova nesta continuação. Nenhum e-mail real foi enviado.
