# Linha de base e classificação das falhas do db:test no DEV (#140, E15)

- Issue: #140 [E15] Triagem das falhas do db:test no banco de desenvolvimento
- Workflow: WF-03 (Feature), etapa Desenvolvimento (fluxos F1 a F3 do refino 111). Só leitura e execução de testes.
- Data de início da execução: 2026-11-13 (UTC, ver seção 2)
- Repositório: D:\projetos\fastpro, branch feature/init
- Status deste documento: PARCIAL. Atualizado ao final da execução (ver seção 8).

## 0. Escopo desta rodada

Não foram feitos, nesta rodada: apagar dados, corrigir código, rodar migrações, alterar fixtures, carga ou remoção de demonstração (`db:demo:load` e `db:demo:remove`, inclusive dry-run, porque o dry-run grava dentro de transação antes de desfazer). Decisões 261 a 266 lidas: a remoção de resíduo (decisão 261) continua sem autorização, então nada foi removido.

## 1. Passo 0: preparação

- `corepack pnpm db:status`: 65 migrações aplicadas, 0 pendentes (`[aplicada]` em todas).
- Script `db:test` (raiz): `node --test --test-concurrency=1 "packages/db/tests/*.dbtest.mjs"`. Execução por arquivo: `node --test --test-concurrency=1 packages/db/tests/<arquivo>` a partir da raiz (mesmo formato do script).
- Node: v22.14.0.
- Arquivos `packages/db/tests/*.dbtest.mjs`: 64 (CA-02 atendido).
- Processos `node` residuais (leitura via `Get-CimInstance`, sem encerrar nada): 12 processos, todos de outras sessões (proxies MCP `mcp-remote` do Vercel, Codex, servidor do quadro `docs/factory/servidor-quadro.mjs`, portless). Nenhum é `db:test`. Nenhum foi encerrado.
- Fila (`docs/factory/quadro-status.md`): #140 em Desenvolvimento, junto com #44 e #119 (Desenvolvimento) e #141 e #50 (QA, no snapshot). O líder confirmou que nenhum outro agente usa o DEV agora. Essa confirmação foi aceita, e a verificação de fila foi lida como cartão de Desenvolvimento, não como Product Owner.

## 2. Contagem antes (leitura, transação READ ONLY, desfeita)

Script auxiliar fora do repo (`scratchpad`, `contagem-leitura2.mjs`), que usa `connect()` de `packages/db/scripts/lib/env.mjs` (`DATABASE_URL_MIGRATIONS`). Nenhum valor de conexão foi impresso. Papel `postgres`, banco `postgres`.

Resumo (arquivo completo: `D:\Temp\claude\fbed4beb0d3cb77a\c1e23bcd-290d-445b-a672-5e4210e2070b\scratchpad\dbtest-baseline\contagem-antes.txt`):

| Métrica | Valor |
|---|---|
| Relações (tabelas) lidas nos esquemas app, audit, ops, public, auth, storage | 88 |
| Total de linhas | 2280 |
| Linhas com marcador `@example.test` em colunas de texto | 1 (`app.app_user`) |
| Perfis de profissional (`app.professional_profile`) | 13 (coincide com a carga de demonstração, camada 1) |
| Rascunhos (`app.request_draft`) | 2 |
| Clientes (`app.customer_profile`) | 3 |
| Serviços (`app.service`) / grupos / sinônimos | 575 / 25 / 1253 |

Limitações da contagem: o marcador `2099` (prazo de teste) não foi contado; a demonstração não foi separada por marcador (o dry-run não foi rodado, por ser transação de escrita); a coluna de texto é a única fonte de marcador.

## 3. Linha de base por arquivo (série)

Runner: `D:\Temp\claude\fbed4beb0d3cb77a\c1e23bcd-290d-445b-a672-5e4210e2070b\scratchpad\run-baseline.sh`. Um arquivo por vez, a partir da raiz do repo, `timeout 300` por arquivo, `node --test --test-concurrency=1 packages/db/tests/<arquivo>`, ordem `LC_ALL=C sort`. Logs: `...\scratchpad\dbtest-baseline\<nome>.log`. Resumo: `...\scratchpad\dbtest-baseline\resumo.tsv` (arquivo, código de saída, duração em segundos).

Início da série: 2026-11-13 05:51 UTC (aprox.). Ainda em andamento no momento deste parcial. Resultados por arquivo serão preenchidos na atualização final.

## 4. Comandos usados

- `corepack pnpm db:status`
- `node packages/db/scripts/lib/...` (apenas como módulo, via `contagem-leitura2.mjs`)
- `bash ...\run-baseline.sh` (em segundo plano)
- Leitura de cabeçalhos e de `git log -1 -- <arquivo>` dos 64 arquivos (somente leitura)

## 5. Origem candidata por arquivo (cabeçalho e último commit, somente leitura)

Verificado pelo último commit do arquivo e pelo cabeçalho. Os IDs de Issue são os citados nos arquivos. "H-xxx" é a história de referência; a Issue de origem é a inferida do cabeçalho e precisa de confirmação no quadro.

| Arquivo | Último commit | Referência no cabeçalho |
|---|---|---|
| audit.dbtest.mjs | b3f11fb feat(H-104) | H-006 (cabeçalho) |
| backup-roles.dbtest.mjs | dd25616 docs(H-017) | H-010 |
| catalog-search.dbtest.mjs | 258e922 feat(H-019) | H-019 |
| catalog-service.dbtest.mjs | cba2345 test(H-018) | H-018 |
| draft-request-h025.dbtest.mjs | 8ae560d fix(H-025) | H-025 / Issue #38 |
| draft-review-h030.dbtest.mjs | 00fb736 feat(H-030) | H-030 / Issue #43 |
| draft-rollback-h025.dbtest.mjs | 299c759 feat(H-025) | H-025 / Issue #38 |
| geo-geocode-point.dbtest.mjs | 3d3edfa feat(H-021) | H-021 |
| geo-match-point.dbtest.mjs | cd9b22e feat(#35) | H-021 / H-022 |
| request-publish-h031.dbtest.mjs | e9d7193 feat(H-031) | H-031 / Issue #44 |
| role-exclusivity.dbtest.mjs | 1c62515 test(H-017) | H-017 / Issue #30 |

Demais arquivos (64 no total): ver a lista completa na seção 9 após a execução.

## 6. Tabela de falhas classificadas

PENDENTE. Será preenchida após a linha de base e a reexecução dos arquivos que falharam (F3).

## 7. O que NÃO foi possível verificar até este ponto

- Resultado de cada arquivo (ainda rodando).
- Contagem final de linhas com marcador (CA-06) e de linhas sem marcador (CA-07): depois da série.
- Estado de demonstração (CA-08): dry-run não rodado (fora do escopo de leitura).
- `corepack pnpm db:test` como comando único (CA-09 a): não executado nesta rodada, por ora, por causa do limite de tempo (ver decisão 263).

## 8. Atualização final

PENDENTE.
