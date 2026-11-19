# Desenho de Arquitetura — Issue #146: db:test T-H018-13 depende de semente ausente no DEV (E15)

- **Issue:** #146 `[E15] db:test: T-H018-13 depende de semente ausente no DEV`
- **Workflow:** WF-03 (Feature / Engenharia / Qualidade), etapa Arquitetura
- **EXEC-ID:** EXEC-ARQ-146-20261119
- **Repositório / branch:** `D:\projetos\fastpro`, `feature/init`
- **Data:** 2026-11-19
- **Entrada:** `docs/factory/151-REFINO-DBTEST-146.md` (critérios CA-01 a CA-08; perguntas 810 a 814)
- **Natureza:** SOMENTE DOCUMENTO. Nenhum código, banco, quadro ou `11-DECISOES.md` foi tocado nesta etapa. Sem Docker, Mapbox real, e-mail real ou backup.
- **Etiquetas:** `[VERIFICADO]` conferido no código/refino; `[PROPOSTA]` desenho deste documento; `[A CONFIRMAR NO DEV]` o Desenvolvedor deve conferir ao abrir o arquivo.

---

## 1. Diagnóstico (resumo)

`[VERIFICADO]` O teste `T-H018-13` (`packages/db/tests/catalog-service.dbtest.mjs`, linhas 560 a 580):
1. insere um grupo manual com o nome fixo `'Reformas e construção'`, que já existe no DEV (grupo `g01` da semente oficial já gravada), violando `service_group_name_key` (erro 23505);
2. mesmo sem o erro, `aplicarSemente(SEED)` com a semente oficial retornaria `ja_aplicada` (mesmo `seed_version`/checksum já em `app.catalog_seed_run`);
3. termina com `assert.equal(total, 25)`, contagem global em banco compartilhado, proibida pela regra da Rodada 65.

Categoria F: a fixture depende do estado do DEV. A função de produção `private.catalog_seed_apply` está correta e fica intocada.

## 2. Decisões

Todas as recomendações do PO foram adotadas. Cada uma está marcada "adotada pelo líder" para veto posterior (registro em `11-DECISOES.md` fica a cargo do Orquestrador, não desta etapa).

| Nº | Decisão | Origem | Status |
|---|---|---|---|
| 810 | Fixture sintética mínima e autocontida construída dentro do próprio teste (2 grupos, 3 serviços, versão própria). Rejeitadas: B (apagar/renomear `g01` e limpar `catalog_seed_run`, arriscado por FKs e por mexer na semente oficial) e C (clonar a semente de 575 serviços, lenta e sem ganho). | Refino 810, alt. A | **adotada pelo líder** |
| 811 | O grupo manual usa variação de caixa e acentuação em relação ao grupo da semente sintética, provando a normalização `private.catalog_norm`. | Refino 811, alt. A | **adotada pelo líder** |
| 812 | Remover a asserção global `total = 25`. Asserir só linhas do próprio teste, identificadas por marcador. | Refino 812, alt. A | **adotada pelo líder** |
| 813 | Alterar apenas o corpo de `T-H018-13` no mesmo arquivo; sem novo arquivo de teste. | Refino 813, alt. A | **adotada pelo líder** |
| 814 | Commit: `test(E15): T-H018-13 usa semente sintetica para isolar conflito de nome (#146)`. | Refino 814, alt. A | **adotada pelo líder** |

### 2.1 Decisões de desenho complementares `[PROPOSTA]` (adotadas pelo líder, sem pergunta nova)

- **D-1. Sem mascarar o teste.** O teste continua exercitando o caminho real `private.catalog_seed_apply` com conflito de nome real contra uma linha manual real. Não se usa mock da função, não se remove asserção de comportamento, não se pula o teste (`skip`/`todo`), não se condiciona o resultado ao estado do DEV. A regra de negócio comprovada (H-018 CA-04, Desenho 53 §6.2) é a mesma; só muda a massa de dados.
- **D-2. Marcador por execução.** Todos os nomes e chaves da fixture levam um sufixo único por execução, gerado no teste a partir de `randomUUID()` (ex.: `const tag = 'T146-' + randomUUID().slice(0, 8)`). Isso evita colisão com o DEV hoje e com dados futuros (R-02 do refino) e permite filtrar as linhas do teste por padrão. Nomes de grupo ficam dentro de `service_group.name` (único) e chaves em `seed_key` com prefixo `t146_`.
- **D-3. Versão e checksum próprios.** O payload sintético usa `version` própria com o marcador (ex.: `'t146-' + tag`), garantindo que não exista em `app.catalog_seed_run` e a função não responda `ja_aplicada`. `[A CONFIRMAR NO DEV]` o formato exato do payload aceito (campos `version`, `groups`, `services`, `synonyms`, e se o checksum é calculado pela própria função ou por `aplicarSemente`) deve ser copiado do auxiliar `aplicarSemente` e do `catalog.v1.json`, nunca inventado.
- **D-4. Limpeza por rollback, comprovada.** O teste continua em `inTx` (rollback incondicional em `finally`). Adicionalmente, após o bloco, uma consulta fora da transação comprova que o grupo manual, os grupos `t146_*`, serviços `t146_*` e o registro de `catalog_seed_run` com a versão do teste não existem (CA-07). Se o auxiliar `inTx` não permitir consulta posterior dentro do mesmo teste, a verificação pode ser um segundo teste leve ou ficar após o `inTx` no mesmo corpo, usando o `client` (a conexão `client` é a mesma, já fora da transação).
- **D-5. Auditoria.** `[A CONFIRMAR NO DEV]` se `catalog_seed_apply` grava em `audit.audit_event`; qualquer linha ali nasce dentro da transação e é desfeita pelo rollback, então nenhuma limpeza extra é necessária.
- **D-6. Papel.** Manter o `set local role app_system` (via `aplicarSemente`) apenas durante a chamada e `reset role` antes das consultas de verificação, como já faz o teste atual.
- **D-7. Escopo estrito de arquivos.** Único arquivo de código alterado: `packages/db/tests/catalog-service.dbtest.mjs`. Nenhuma migração, nenhuma mudança em `catalog-search`, `catalog`, `catalog-h107`, nem em `supabase/seed/catalog/catalog.v1.json`.

## 3. Desenho da fixture e das asserções

Fixture (nomes ilustrativos; o sufixo `tag` entra em todos):

- **Grupo conflitante da semente (`t146_gc`)**: nome `'Grupo Sintético Conflito <tag>'`, posição 9100.
- **Grupo regular da semente (`t146_gok`)**: nome `'Grupo Sintético Regular <tag>'`, posição 9101.
- **Serviços:** 2 no grupo conflitante (`t146_sc1`, `t146_sc2`) e 1 no regular (`t146_sok1`), no mesmo formato dos serviços de `catalog.v1.json`.
- **Grupo manual** (inserido antes da aplicação, `seed_key` nulo, posição 500, `active = false`): nome com variação de caixa e acento, por exemplo `'GRUPO SINTETICO CONFLITO <tag em maiúsculas conforme normalização>'`. `[A CONFIRMAR NO DEV]` que `private.catalog_norm` ignora caixa e acento; se a normalização não tratar o caso escolhido, usar variação que ela trata (não alterar a função para caber no teste).

Asserções (todas locais ao teste):

1. Inserção do grupo manual sem erro 23505 (CA-01).
2. `r.status === 'aplicada'` (CA-02).
3. `r.groups_inserted === 1`, `r.services_inserted === 1` (CA-04).
4. `r.skipped_conflict === 3` (1 grupo + 2 serviços) (CA-03).
5. Grupo manual por `manualId`: `seed_key` nulo, nome e posição 500 intactos (CA-05).
6. Existe exatamente 1 grupo com `seed_key = 't146_gok'` e 0 com `seed_key = 't146_gc'`; 1 serviço `t146_sok1` e 0 com `t146_sc1`/`t146_sc2` (marcador, sem contagem global).
7. Variação de caixa/acento no manual efetivamente gerou o conflito (decorre de 4 e de 5) (CA-06).
8. Após o rollback, nada com o marcador permanece (CA-07).
9. Removida: `total = 25` e qualquer contagem global de `app.service_group`.

## 4. Plano de implementação em fatias

Cada fatia é pequena, verificável e reversível. Tudo no mesmo arquivo; um único commit ao final (decisão 814), podendo ser dividido se o Desenvolvedor preferir, mantendo o prefixo e a referência `#146`.

| Fatia | O que fazer | Verificação |
|---|---|---|
| F0 | Ler o auxiliar `aplicarSemente`, `inTx`, `idOf` e o formato do `catalog.v1.json`; copiar o formato do payload; ler a definição de `private.catalog_norm` e a checagem de checksum/versão na migração `20261111210000`. Confirmar os itens `[A CONFIRMAR NO DEV]`. Sem editar nada. | Anotar na Issue o formato confirmado. |
| F1 | Substituir a fixture: criar `tag`, `TEST_SEED` sintético (D-2, D-3) e o grupo manual com variação de caixa/acento (810, 811). | `node --check` do arquivo; teste roda sem 23505. |
| F2 | Trocar a chamada `aplicarSemente(SEED)` por `aplicarSemente(TEST_SEED)` e reescrever as asserções de status/contadores (itens 2 a 4 da seção 3). | T-H018-13 passa isolado. |
| F3 | Reescrever asserções do grupo manual e dos itens sintéticos por marcador; remover `total = 25` (812). | T-H018-13 passa; sem contagem global no corpo. |
| F4 | Acrescentar verificação de limpeza pós-rollback (D-4, CA-07). | Consulta por marcador retorna 0 após o teste. |
| F5 | Execução completa local: arquivo do catálogo 13/13, depois suíte `db:test` completa para provar que o teste não afeta vizinhos. Registrar comando, contagem e código de saída na Issue. | `# pass 13`, `# fail 0`, saída 0. |
| F6 | Conferir que o DEV segue com a semente oficial intacta (25 grupos, 575 serviços, `catalog_seed_run` com a versão oficial) por consulta somente leitura via `npx supabase`/conexão do teste, sem apagar nada. Commit com a mensagem da decisão 814 em `feature/init`. | Consulta de leitura registrada; commit criado. |

Sem Docker. Banco sempre o DEV pelo `.env.local`, segredos nunca impressos. Migrações: nenhuma.

## 5. Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| R-1. Formato do payload sintético divergir do esperado pela função (campos obrigatórios, checksum, validação de JSON). | Função rejeita a semente sintética e o teste falha por erro de fixture. | F0 obrigatória: copiar a estrutura de `aplicarSemente` e de `catalog.v1.json`; começar por uma semente de 1 grupo e 1 serviço e crescer. |
| R-2. Normalização `catalog_norm` não tratar a variação escolhida (ex.: acento). | Conflito não detectado: grupo "conflitante" é inserido e `23505` ou contagem errada. | Escolher variação que a função trata, verificada em F0; nunca alterar a função de produção. |
| R-3. Contenção de lock no DEV compartilhado (`lock_timeout = 5s` interno). | Falha intermitente. | Semente mínima mantém a transação curta; repetir até 2 vezes antes de investigar (limite de 3 tentativas da fábrica). |
| R-4. Resíduo se o teste falhar antes do rollback. | Poluição do catálogo. | `inTx` faz rollback em `finally`; marcador permite localizar qualquer resto; verificação D-4. |
| R-5. `catalog_seed_run` com restrição de versão/checksum única ou unicidade de `seed_key` global que colida com `t146_*`. | Falha de fixture. | Sufixo aleatório em versão e chaves (D-2, D-3). |
| R-6. Mascarar o teste por engano (asserções enfraquecidas). | Perde-se a prova da regra H-018 CA-04. | Matriz da seção 6 exige verificar conflito real, contadores exatos e preservação do manual; revisão (Code Review) confere D-1. |
| R-7. Outro teste da suíte depender de efeito colateral deste. | Falha em vizinhos. | Rollback incondicional; F5 roda a suíte completa. |
| R-8. Aplicar a semente oficial ao DEV por engano ou apagar/limpar `catalog_seed_run`. | Perda de dados do DEV. | Proibido (fora de escopo, alternativa B rejeitada); F6 confere o estado oficial. |

## 6. Matriz de testes

| CA | Cenário | Dados | Resultado esperado | Fatia |
|---|---|---|---|---|
| CA-01 | Inserir grupo manual em banco com semente oficial | Nome sintético com marcador, inexistente no DEV | Sem erro 23505 | F1 |
| CA-02 | Aplicar semente sintética nova | `version` única com marcador | `status = 'aplicada'` (não `ja_aplicada`) | F2 |
| CA-03 | Conflito de nome com 2 serviços dependentes | Grupo `t146_gc` + serviços `t146_sc1`, `t146_sc2` | `skipped_conflict = 3` | F2 |
| CA-04 | Itens sem conflito | Grupo `t146_gok` + serviço `t146_sok1` | `groups_inserted = 1`, `services_inserted = 1` | F2, F3 |
| CA-05 | Preservação do manual | `manualId`, `seed_key` nulo, posição 500, `active = false` | `seed_key` nulo, nome e posição intactos | F3 |
| CA-06 | Normalização | Manual com caixa/acento diferentes da semente | Conflito detectado mesmo assim | F1, F3 |
| CA-07 | Sem resíduos | Consulta por marcador após o rollback | 0 grupos, 0 serviços, 0 execuções com a versão do teste | F4 |
| CA-08 | Suíte do catálogo | `node --test --test-concurrency=1 packages/db/tests/catalog-service.dbtest.mjs` | `# pass 13`, `# fail 0`, saída 0 | F5 |
| Regressão | Suíte `db:test` completa | Todas as suítes | Nenhuma nova falha atribuível a #146; falhas conhecidas de outras Issues (ex.: #147, #149) permanecem fora | F5 |
| Integridade DEV | Semente oficial intacta | Consulta somente leitura | 25 grupos, 575 serviços, registro oficial em `catalog_seed_run` presentes | F6 |
| Anti-mascaramento | Inspeção do diff | Diff do arquivo | Sem `skip`/`todo`, sem mock da função, sem contagem global, único arquivo alterado | Code Review |

## 7. Critérios de saída da etapa de Desenvolvimento

1. CA-01 a CA-08 comprovados com comando, contagem e código de saída registrados na Issue (execução local, sem depender de GitHub Actions).
2. Diff restrito a `packages/db/tests/catalog-service.dbtest.mjs`.
3. Commit na `feature/init` com a mensagem da decisão 814, com as linhas de atribuição padrão.
4. Nenhum dado oficial do DEV alterado; nenhum segredo em log ou commit.

## 8. Pendências para o Orquestrador

- Registrar as decisões 810 a 814 como "adotada pelo líder" em `11-DECISOES.md` (não feito aqui, por instrução).
- Mover o cartão no quadro (`docs/factory/quadro-status.md`) para Desenvolvimento (não feito aqui, por instrução).
- Nenhuma pergunta nova ao usuário: não há dinheiro, jurídico, perda irreversível nem credencial envolvidos.
