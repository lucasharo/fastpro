# Linha de base e classificação das falhas do db:test no DEV (#140, E15)

- Issue: #140 [E15] Triagem das falhas do db:test no banco de desenvolvimento
- Workflow: WF-03 (Feature), etapa Desenvolvimento (fluxos F1 a F3 do refino 111). Só leitura e execução de testes.
- Execução: 2026-11-13, série de aprox. 05:51 às 06:25 UTC (34 min de relógio).
- Repositório: D:\projetos\fastpro, branch feature/init.
- Status deste documento: linha de base concluída. Classificação PROVISÓRIA (ver seção 6). Não é conclusão.

## 0. Escopo desta rodada

Não foram feitos: remoção de dados (decisão 261 sem resposta), correção de código ou fixture, migrações, carga ou remoção de demonstração (inclusive dry-run, porque ele grava dentro de transação antes de desfazer; ficou fora da leitura pedida). Não foram abertas Issues de origem nesta rodada (sem escrita no GitHub).

## 1. Passo 0: preparação

- `corepack pnpm db:status`: 65 migrações aplicadas, 0 pendentes.
- Script `db:test` (raiz): `node --test --test-concurrency=1 "packages/db/tests/*.dbtest.mjs"`. Execução por arquivo, a partir da raiz: `node --test --test-concurrency=1 packages/db/tests/<arquivo>`, com `timeout 300`.
- Node: v22.14.0.
- Arquivos `packages/db/tests/*.dbtest.mjs`: 64 (CA-02 atendido).
- Processos `node` (leitura via `Get-CimInstance`, nada encerrado): 12 processos de outras sessões (proxies MCP `mcp-remote` do Vercel, Codex, `docs/factory/servidor-quadro.mjs`, portless). Nenhum é `db:test`.
- Fila (`docs/factory/quadro-status.md`): #140, #44 e #119 em Desenvolvimento; #141 e #50 em QA (snapshot). O líder confirmou que nenhum outro agente usa o DEV. Essa confirmação foi aceita. Não confirmei a fila de novo na hora de cada arquivo (CA-12 parcial).

## 2. Contagem antes e depois (leitura, transação READ ONLY, desfeita)

Script auxiliar fora do repo: `D:\Temp\claude\fbed4beb0d3cb77a\c1e23bcd-290d-445b-a672-5e4210e2070b\scratchpad\contagem-leitura2.mjs`, usando `connect()` de `packages/db/scripts/lib/env.mjs` (`DATABASE_URL_MIGRATIONS`). Papel `postgres`, banco `postgres`. Nenhum valor de conexão foi impresso. Saídas: `...\scratchpad\dbtest-baseline\contagem-antes.txt` e `contagem-depois.txt`.

Achado de preparação: as tabelas de domínio estão nos esquemas `app`, `audit` e `ops`, não em `public`. Uma primeira tentativa só com `public` retornou zero tabelas e foi descartada.

| Métrica | Antes | Depois |
|---|---|---|
| Relações lidas (app, audit, ops, public, auth, storage) | 88 | 88 |
| Total de linhas | 2280 | 2282 |
| Linhas com marcador `@example.test` em colunas de texto | 1 (`app.app_user`) | 1 |
| Diferença por tabela | n/a | `ops.job`: 56 para 58 (+2, sem marcador) |

Leitura: CA-06 (marcador) atendido, a contagem com marcador não mudou. CA-07 (linhas sem marcador iguais antes e depois) NÃO atendido: `ops.job` ganhou 2 linhas durante a série. É resíduo provável de um teste que faz COMMIT real (R-DEV-3). Não houve remoção, por falta de autorização (decisão 261). Arquivo de origem não identificado: candidatos a verificar são os testes que escrevem em `ops.job` (`platform.dbtest.mjs`, `jobs-tick.dbtest.mjs`, `ops-*.dbtest.mjs`). NÃO VERIFICADO.

Demonstração (CA-08): o dry-run do F1 passo 3 não foi rodado. Estado de demonstração antes da execução: 13 perfis de profissional e 2 rascunhos em `app` (compatível com a carga da camada 1), sem confirmação formal do estado do comando.

## 3. Linha de base por arquivo (série)

- Runner: `D:\Temp\claude\fbed4beb0d3cb77a\c1e23bcd-290d-445b-a672-5e4210e2070b\scratchpad\run-baseline.sh`. Um arquivo por vez, a partir da raiz, `timeout 300` por arquivo, ordem `LC_ALL=C sort`.
- Logs: `...\scratchpad\dbtest-baseline\<nome>.log`. Resumo: `...\scratchpad\dbtest-baseline\resumo.tsv`. Tabela: `...\scratchpad\dbtest-baseline\tabela.tsv`.
- Totais: 64 arquivos; 669 testes; 636 passaram; 21 falharam; 12 ignorados; soma das durações por arquivo 2018 s. Código de saída 0 em 56 arquivos e 1 em 8 arquivos. Nenhum código 124 (timeout de 300 s).

Tabela por arquivo (código de saída da linha de base, duração em segundos):

| Arquivo | Saída | Duração (s) | Testes | Passam | Falham | Ignorados |
|---|---|---|---|---|---|---|
| admin-access-case-list.dbtest.mjs | 0 | 9 | 5 | 5 | 0 | 0 |
| admin-access-case.dbtest.mjs | 0 | 48 | 18 | 18 | 0 | 0 |
| admin-rbac.dbtest.mjs | 0 | 41 | 22 | 22 | 0 | 0 |
| admin-staff-list.dbtest.mjs | 0 | 7 | 5 | 5 | 0 | 0 |
| admin-staff.dbtest.mjs | 0 | 12 | 6 | 6 | 0 | 0 |
| approval-dual-h105-concorrencia.dbtest.mjs | 0 | 24 | 3 | 3 | 0 | 0 |
| approval-dual-h105.dbtest.mjs | 0 | 72 | 27 | 27 | 0 | 0 |
| audit-query.dbtest.mjs | 0 | 92 | 12 | 12 | 0 | 0 |
| audit.dbtest.mjs | 1 | 94 | 27 | 24 | 1 | 2 |
| auth-challenge.dbtest.mjs | 0 | 10 | 10 | 10 | 0 | 0 |
| backup-roles.dbtest.mjs | 1 | 5 | 9 | 5 | 2 | 2 |
| catalog-h107.dbtest.mjs | 0 | 22 | 7 | 7 | 0 | 0 |
| catalog-promo-ausente.dbtest.mjs | 0 | 1 | 3 | 2 | 0 | 1 |
| catalog-search.dbtest.mjs | 1 | 9 | 8 | 0 | 8 | 0 |
| catalog-service.dbtest.mjs | 1 | 49 | 13 | 11 | 2 | 0 |
| catalog.dbtest.mjs | 0 | 7 | 9 | 9 | 0 | 0 |
| challenge-concorrencia-h013.dbtest.mjs | 0 | 41 | 5 | 4 | 0 | 1 |
| challenges-jobs.dbtest.mjs | 0 | 3 | 3 | 3 | 0 | 0 |
| challenges-store.dbtest.mjs | 0 | 2 | 1 | 1 | 0 | 0 |
| demo.dbtest.mjs | 0 | 36 | 4 | 4 | 0 | 0 |
| draft-identity-h013.dbtest.mjs | 0 | 18 | 7 | 7 | 0 | 0 |
| draft-request-h025.dbtest.mjs | 1 | 31 | 17 | 15 | 2 | 0 |
| draft-review-h030.dbtest.mjs | 0 | 73 | 14 | 14 | 0 | 0 |
| draft-rollback-h025.dbtest.mjs | 1 | 4 | 3 | 1 | 2 | 0 |
| geo-geocode-point.dbtest.mjs | 1 | 28 | 33 | 31 | 2 | 0 |
| geo-mapbox-quota.dbtest.mjs | 0 | 8 | 7 | 7 | 0 | 0 |
| geo-match-point.dbtest.mjs | 1 | 77 | 27 | 25 | 2 | 0 |
| h013-provas-banco.dbtest.mjs | 0 | 30 | 4 | 4 | 0 | 0 |
| h097-ca04-aceite-adiado.dbtest.mjs | 0 | 4 | 1 | 1 | 0 | 0 |
| h097-login-prioridade.dbtest.mjs | 0 | 16 | 7 | 7 | 0 | 0 |
| h097-tempo-uniforme.dbtest.mjs | 0 | 27 | 1 | 1 | 0 | 0 |
| identity-active-session.dbtest.mjs | 0 | 45 | 10 | 10 | 0 | 0 |
| identity-docs-h037.dbtest.mjs | 0 | 29 | 24 | 24 | 0 | 0 |
| identity-professional-profile-document.dbtest.mjs | 0 | 15 | 16 | 15 | 0 | 1 |
| identity-professional-recovery.dbtest.mjs | 0 | 17 | 10 | 10 | 0 | 0 |
| identity-professional-session.dbtest.mjs | 0 | 6 | 6 | 6 | 0 | 0 |
| identity-session-stage.dbtest.mjs | 0 | 14 | 8 | 8 | 0 | 0 |
| identity-step-up-code.dbtest.mjs | 0 | 24 | 16 | 16 | 0 | 0 |
| jobs-tick.dbtest.mjs | 0 | 92 | 17 | 16 | 0 | 1 |
| media-gallery-h029.dbtest.mjs | 0 | 22 | 12 | 12 | 0 | 0 |
| media-gallery.dbtest.mjs | 0 | 8 | 6 | 6 | 0 | 0 |
| media-quarantine-h026.dbtest.mjs | 0 | 19 | 11 | 11 | 0 | 0 |
| media-reduce-h027.dbtest.mjs | 0 | 19 | 11 | 11 | 0 | 0 |
| notifications-cancelamento.dbtest.mjs | 0 | 4 | 2 | 2 | 0 | 0 |
| notifications-cortes.dbtest.mjs | 0 | 15 | 3 | 3 | 0 | 0 |
| notifications-cota-h094.dbtest.mjs | 0 | 38 | 17 | 17 | 0 | 0 |
| notifications-email.dbtest.mjs | 0 | 6 | 4 | 4 | 0 | 0 |
| notifications-flush.dbtest.mjs | 0 | 2 | 3 | 1 | 0 | 2 |
| notifications-motor.dbtest.mjs | 0 | 21 | 10 | 9 | 0 | 1 |
| notifications-rede.dbtest.mjs | 0 | 0 | 5 | 5 | 0 | 0 |
| notifications-rollback.dbtest.mjs | 0 | 2 | 1 | 1 | 0 | 0 |
| notifications-vigencia.dbtest.mjs | 0 | 5 | 3 | 3 | 0 | 0 |
| notifications.dbtest.mjs | 0 | 38 | 12 | 12 | 0 | 0 |
| ops-panel-h108.dbtest.mjs | 0 | 14 | 11 | 11 | 0 | 0 |
| ops-purge-h110.dbtest.mjs | 0 | 27 | 18 | 18 | 0 | 0 |
| platform.dbtest.mjs | 0 | 29 | 15 | 15 | 0 | 0 |
| professional-login-concurrency.dbtest.mjs | 0 | 3 | 1 | 1 | 0 | 0 |
| professional-offering-pg.dbtest.mjs | 0 | 17 | 9 | 9 | 0 | 0 |
| profile-offering.dbtest.mjs | 0 | 68 | 17 | 17 | 0 | 0 |
| rate-limit.dbtest.mjs | 0 | 55 | 13 | 13 | 0 | 0 |
| request-publish-h031.dbtest.mjs | 0 | 35 | 12 | 12 | 0 | 0 |
| retention-h109.dbtest.mjs | 0 | 85 | 26 | 26 | 0 | 0 |
| role-exclusivity-concorrencia.dbtest.mjs | 0 | 286 | 4 | 4 | 0 | 0 |
| role-exclusivity.dbtest.mjs | 0 | 58 | 18 | 17 | 0 | 1 |

## 4. Reexecução dos arquivos que falharam (separar determinístico de intermitente)

Os 8 arquivos com código 1 foram rodados de novo, uma vez cada, em série: `...\scratchpad\dbtest-baseline\reexec\`.

| Arquivo | Falhas na linha de base | Falhas na reexecução | Resultado |
|---|---|---|---|
| audit.dbtest.mjs | 1 | 1 | determinística |
| backup-roles.dbtest.mjs | 2 | 2 | determinística |
| catalog-search.dbtest.mjs | 8 | 8 | determinística |
| catalog-service.dbtest.mjs | 2 | 2 | determinística |
| draft-request-h025.dbtest.mjs | 2 | 2 | determinística |
| draft-rollback-h025.dbtest.mjs | 2 | 2 | determinística |
| geo-geocode-point.dbtest.mjs | 2 | 2 | determinística |
| geo-match-point.dbtest.mjs | 2 | 2 | determinística |

Nenhuma falha foi intermitente nesta rodada. Nenhum erro de tempo (timeout) apareceu: todas as falhas são asserções ou erros SQL.

## 5. Confirmações pedidas pelo líder

- T-DB02 de `draft-review-h030.dbtest.mjs` (#43): PASSA. Arquivo com 14 de 14 testes e código 0. CA-05 (filtro `--test-name-pattern` isolado) NÃO executado separadamente; o arquivo inteiro passa.
- T-DB02 de `request-publish-h031.dbtest.mjs` (#44): PASSA. 12 de 12, código 0.
- D-01 de `audit.dbtest.mjs` (linha 136): PASSA. D-01 de `draft-request-h025.dbtest.mjs`: FALHA (ver tabela 6). O nome se repete em dois arquivos; a atribuição é por arquivo (decisão 265).
- D-02b de `audit.dbtest.mjs`: FALHA.
- D-10: FALHA em `draft-request-h025.dbtest.mjs` (teste 17) e em `draft-rollback-h025.dbtest.mjs` (testes 2 e 3).
- T-BK-09 de `backup-roles.dbtest.mjs`: FALHA. Além dele, falha o teste 9 do mesmo arquivo (ver tabela 6).
- T-H019-09 a T-H019-16 (8 casos de `catalog-search.dbtest.mjs`): TODOS FALHAM. T-H019-16 falhou por asserção, não por tempo, então não é categoria E nesta rodada.
- T-H018-11 e T-H018-13 (`catalog-service.dbtest.mjs`): FALHAM.
- CA-4 (`geo-geocode-point.dbtest.mjs`): 2 casos falham (testes 3 e 4); o restante do arquivo passa.
- T-CA10 (`geo-match-point.dbtest.mjs`, teste 27): FALHA. Também falha T-CA05b (teste 11), que não estava na lista do refino.
- T-H013-03 (timeout de 5 s, rodada 41): NÃO reproduzido. Nenhum teste de timeout apareceu; os arquivos `challenge-concorrencia-h013` e `h013-provas-banco` passam.

## 6. Tabela de falhas classificadas (PROVISÓRIA)

Todas as 21 falhas da linha de base estão listadas (CA-04: 21 menos 21 classificadas = 0, mas a categoria final é provisória). Categoria final exige a consulta que aparece na última coluna. Origem: cabeçalho do arquivo e último commit do arquivo (somente leitura).

| # | Arquivo | Teste (nome resumido) | Mensagem curta (sem segredo) | Origem | Categoria provisória | Ação recomendada |
|---|---|---|---|---|---|---|
| 1 | audit.dbtest.mjs | D-02b: app_api executa só audit_append | asserção de lista (deep-equal) | #19 | B ou D (NÃO VERIFICADO) | Consulta de privilégios, só leitura; decidir B ou D |
| 2 | backup-roles.dbtest.mjs | T-BK-09: papel de backup lê toda tabela de domínio | tabela de domínio sem SELECT ao papel de leitura | Backup (H-010), decisão 147 | C provável (NÃO VERIFICADO) | Conferir lista de exceções com a decisão 147 |
| 3 | backup-roles.dbtest.mjs | teste 9: senha do dono fora do código | varredura achou texto que o teste considera credencial | H-010 / H-092 (NÃO VERIFICADO) | D ou C; PRIORIDADE | Verificar sem imprimir valor; se for credencial versionada, tratar como incidente (R6, decisão 150) |
| 4-11 | catalog-search.dbtest.mjs | T-H019-09 a T-H019-16 (8 casos) | asserção de igualdade, 8 de 8 | H-019, candidato #32 | A ou F (NÃO VERIFICADO); falha uniforme sugere causa comum (fixture ou função), não bug isolado | Ler o bloco de fixture e comparar com a semente; T-H019-16 não é tempo |
| 12 | catalog-service.dbtest.mjs | T-H018-11: semente com 25 grupos | asserção de igualdade | H-018, candidato #31 | A ou F (NÃO VERIFICADO): o DEV já tem os 25 grupos da semente | Confirmar contagem; ajustar fixture se a semente já existir |
| 13 | catalog-service.dbtest.mjs | T-H018-13: conflito por nome | duplicate key em service_group_name_key | H-018, candidato #31 | F provável: o teste insere nome da semente sem tratar conflito | Fixture deve tratar o conflito (ou usar a semente existente) |
| 14 | draft-request-h025.dbtest.mjs | D-01: rascunho sem conta, colunas exatas | asserção sobre colunas do modelo | #38 | C ou B (NÃO VERIFICADO) | Comparar lista de colunas com migrações posteriores |
| 15 | draft-request-h025.dbtest.mjs | D-10: aplicar migração duas vezes | "quatro funcoes de rascunho" | #38 | C ou B (NÃO VERIFICADO) | Comparar contagem de funções com o estado aplicado |
| 16 | draft-rollback-h025.dbtest.mjs | D-10: aplicar, desfazer e rollback | não é possível remover app.request_draft: outros objetos dependem dela | #38 | D provável, ou C (teste desfaz fora de ordem) | Abrir/indicar Issue de origem #38; decidir D ou C |
| 17 | draft-rollback-h025.dbtest.mjs | D-10: desfazer duas vezes e reaplicar | mesmo erro de dependência (item 16) | #38 | D provável, ou C | Mesmo tratamento do item 16 |
| 18 | geo-geocode-point.dbtest.mjs | CA-4: ponto fora do Brasil recusado pelo CHECK | asserção de igualdade | H-021, candidato #34 | B ou D (NÃO VERIFICADO) | Ler a restrição aplicada no DEV (leitura) |
| 19 | geo-geocode-point.dbtest.mjs | CA-4: eixos invertidos recusados | asserção de igualdade | H-021, candidato #34 | B ou D (NÃO VERIFICADO) | Mesmo tratamento do item 18 |
| 20 | geo-match-point.dbtest.mjs | T-CA05b: só app_system executa funções que tocam exact_point | asserção de lista (deep-equal) | H-022, candidato #35 | C ou D (NÃO VERIFICADO); item novo | Comparar lista fechada com funções aplicadas |
| 21 | geo-match-point.dbtest.mjs | T-CA10: linhas antigas recebem match_* | asserção de igualdade | H-021/H-022, candidato #35 | A ou B (NÃO VERIFICADO) | Ver estado da migração de match_point antes e depois |

Resumo provisório por categoria (uma falha pode ter mais de uma hipótese):
- A (estado sujo do DEV): candidatos 4-11, 12, 21. Resíduo confirmado em `ops.job` (+2), origem não identificada.
- B (migração): candidatos 1, 14, 15, 18, 19, 21.
- C (teste desatualizado): candidatos 2, 14, 15, 16, 17, 20.
- D (bug real): candidatos 1, 3, 16, 17, 18, 19, 20.
- E (concorrência/tempo): nenhuma. Nenhum timeout.
- F (fixture do teste): candidatos 4-11, 12, 13.

Nenhuma falha foi confirmada com categoria definitiva. Os itens com "NÃO VERIFICADO" precisam de leitura de privilégios, de restrições, de funções ou de migrações no DEV, o que não foi feito nesta rodada (só execução e contagem).

## 7. Comandos usados

- `corepack pnpm db:status`
- Leitura de cabeçalhos e de `git log -1 -- <arquivo>` dos 64 arquivos
- `node ...\scratchpad\contagem-leitura2.mjs` (antes e depois)
- `bash ...\scratchpad\run-baseline.sh` (série, 64 arquivos, em segundo plano)
- `node --test --test-concurrency=1 packages/db/tests/<arquivo>` por arquivo (dentro do runner, e na reexecução dos 8 arquivos com falha)
- Extração de linhas `not ok`, `# pass`, `# fail` e mensagens de erro dos logs
- Verificação de URL de conexão nos logs (CA-10): `grep -l -E "postgres(ql)?://"` retornou 0 arquivos (equivalente a `Select-String` em PowerShell)
- Não executado: `corepack pnpm db:test` como comando único (CA-09 a). A série levou 2018 s somados, acima do limite de 580 s. Por decisão 263, a série por arquivo é a forma usada.

## 8. O que NÃO foi possível verificar

- Mensagens completas de asserção (valores esperado e obtido) de cada falha: extraí só o tipo de erro. Para as tabelas 6 detalhadas, falta a leitura do corpo de cada asserção.
- Filtro `--test-name-pattern` isolado para T-DB02 (CA-05 literal).
- Consulta de privilégios (D-02b), restrições do CHECK (CA-4), lista de funções (T-CA05b, D-10), estado de migrações (D-10, T-CA10): nenhuma leitura de metadado do DEV além das contagens.
- Dry-run de demonstração (CA-08) e estado formal de demonstração.
- Origem de `ops.job` (+2 linhas): arquivo de teste responsável.
- Abertura de Issues de origem para as categorias D (nenhuma aberta; sem escrita no GitHub nesta rodada).
- Conclusão final da #140: a classificação é provisória e a Issue não está verde (CA-09 b).
- Movimento do cartão: não feito (regra: não mover cartão pelo agente de Desenvolvimento nesta rodada).

## 9. Próximos passos sugeridos (decisão do líder)

1. Autorizar a leitura de metadados do DEV (privilégios, restrições, funções e estado de migrações) para fechar as categorias. Isso não exige remoção.
2. Verificar com prioridade o teste 9 de `backup-roles.dbtest.mjs` sem imprimir valores.
3. Decidir sobre o resíduo de `ops.job` (+2) depois de identificar o teste de origem (decisão 261).
4. Abrir Issues de origem para os casos D (#38 rollback de rascunho em primeiro lugar).

## 10. Complemento do líder (2026-11-13)

- **Teste 9 de backup-roles (prioridade):** leitura feita pelo líder sem imprimir valores. Nenhuma senha real do `.env.local` aparece em arquivo versionado (0 coincidências). O teste falha porque 4 arquivos de teste têm URL de banco fictícia com senha que não é placeholder: `apps/api/tests/media-composicao.test.ts`, `apps/api/tests/media-ponta-a-ponta.test.ts` (ambos da #141), `apps/api/tests/professional-composicao.test.ts` (#48/H-035) e `packages/db/tests/demo-guard.test.mjs` (#129). Classificação final: **C (fixture do teste)**, não é incidente de credencial. Correção: trocar as URLs fictícias por forma aceita pelo placeholder do teste (por exemplo `postgres://usuario:senha@host/db`), ou, para o demo-guard, que precisa de refs reais fictícios, manter a senha no formato `senha`.
- **Resíduo `ops.job` +2:** segue sem origem identificada; sem remoção (pergunta 261 sem resposta).
