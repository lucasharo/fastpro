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
