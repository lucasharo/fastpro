# Desenho de Arquitetura — Issue #147: db:test: rollback de H-025 falha com objetos posteriores (E15)

- **Issue:** #147 `[E15] db:test: rollback de H-025 falha com objetos posteriores`
- **Workflow:** WF-03, etapa Arquitetura
- **EXEC-ID:** EXEC-ARQ-147-20261119
- **Repositório / branch:** `D:\projetos\fastpro`, `feature/init`
- **Data:** 2026-11-19
- **Entrada:** `docs/factory/152-REFINO-DBTEST-147.md` (critérios CA-147-01 a 07; perguntas 800 a 804)
- **Natureza:** SOMENTE DOCUMENTO. Nenhum código, migração, comando contra o banco, quadro ou `11-DECISOES.md` foi tocado. Sem Docker, Mapbox real, e-mail real ou backup.

---

## 1. Diagnóstico confirmado (lido nos arquivos)

- `[VERIFICADO]` `packages/db/tests/draft-rollback-h025.dbtest.mjs` tem 3 testes: (1) sanidade estática do `.down.sql`; (2) aplica a migração, executa `DESFAZER` e compara o estado antes/depois; (3) desfaz duas vezes, reaplica duas vezes. Tudo dentro de `begin ... rollback` (helper `naTransacao`).
- `[VERIFICADO]` `supabase/rollbacks/20261111440000_draft_create_request_draft.down.sql` remove 4 funções `private.draft_*`, faz `drop table if exists app.request_draft;` (sem CASCADE) e apaga a versão de `ops.schema_migration`. Não será editado.
- Os testes 2 e 3 falham porque o `drop table` bate em dependentes posteriores (FK `media_asset_draft_id_fkey` de H-026, FK `service_request_origin_draft_id_fkey` de H-031, funções `private.request_publish_*` com o tipo de linha `app.request_draft`). Erro PostgreSQL `2BP01`. O banco está certo; o teste foi escrito quando H-025 era a última migração (desfazer fora da ordem LIFO).
- Correção ao refino (§5.1 do 152): gatilho e índices da própria tabela são dependências automáticas (`deptype 'a'`) e NÃO bloqueiam o `drop table`. Os bloqueios reais são FKs de outras tabelas e objetos que usam o tipo de linha (funções, e views se existirem). A consulta de detecção deve refletir isso.

## 2. Decisões

Todas as recomendações do PO foram adotadas, e marcadas "adotada pelo líder" para o líder registrar depois em `11-DECISOES.md` (esta etapa não o altera).

| Nº | Decisão | Origem |
|---|---|---|
| 800 | Alternativa A: o teste passa a (a) provar idempotência do UP, (b) provar que o `.down.sql` é recusado com `2BP01` quando há dependentes, (c) executar o ciclo completo desfazer/reaplicar SOMENTE quando a consulta ao catálogo achar zero dependentes; caso contrário `t.skip` com motivo. Rejeitadas: B (desfazer 10+ migrações posteriores dentro do teste: frágil, quebra a cada migração nova) e C (CASCADE). **Adotada pelo líder.** | PO 800 |
| 801 | O `.down.sql` e a migração `20261111440000` ficam intocados, sem CASCADE. **Adotada pelo líder.** | PO 801 |
| 802 | A recusa `2BP01` vira asserção positiva (proteção relacional comprovada). **Adotada pelo líder.** | PO 802 |
| 803 | Subteste dedicado de idempotência do UP (reexecutar `MIGRACAO` sobre o banco migrado, em transação desfeita). **Adotada pelo líder.** | PO 803 |
| 804 | Commit: `test(E15): draft-rollback-h025 valida idempotencia, protecao relacional 2BP01 e guarda (#147)`. **Adotada pelo líder.** | PO 804 |

### 2.1 Decisões de arquitetura complementares (para não mascarar o teste)

1. **Detecção dinâmica, nunca fixa.** A decisão "há dependentes?" vem do catálogo em tempo de execução (não de lista de migrações escrita no teste). Assim o teste muda sozinho de comportamento conforme o banco, e não vira skip permanente por engano.
2. **Skip só no ciclo destrutivo completo.** Os subtestes 1 a 3 sempre executam e sempre afirmam algo. O skip tem motivo impresso com a contagem e os nomes dos dependentes encontrados.
3. **A guarda é bidirecional.** Com dependentes: exige `2BP01` (se o `drop` passar, o teste FALHA, pois a proteção sumiu). Sem dependentes: exige ciclo completo verde (`2BP01` seria falha). Nenhum caminho passa sem afirmar.
4. **Cobertura parcial real do DESFAZER (extensão do arquiteto, dentro do escopo do teste).** Subteste que executa o `DESFAZER` sem a linha `drop table` (remoção por regex da linha, afirmando antes que ela existe exatamente uma vez) e afirma: as 4 funções saem, a versão sai de `ops.schema_migration`, `app.service` e a tabela `app.request_draft` intactas. Isso preserva a parte de D-10 que ainda é testável no banco evoluído. Condição: o desenvolvedor confirma em execução que o `drop function` sem CASCADE não esbarra em dependentes; se esbarrar, remove este subteste e registra o motivo no PR (não substituir por CASCADE).
5. **Isolamento.** Tudo em `begin ... rollback` incondicional (helper `naTransacao` existente). `set local lock_timeout = '5s'` no início de cada transação (risco R-04). O erro `2BP01` aborta a transação: usar `savepoint` + `rollback to savepoint` para poder continuar afirmando depois da recusa. Nunca `commit`.
6. **Nenhuma alteração fora de `packages/db/tests/draft-rollback-h025.dbtest.mjs`** (e este desenho). Suítes irmãs (`verification-rollback`, `draft-request-h025` etc.) não mudam.

## 3. Desenho do teste final

Estrutura do arquivo (nomes sugeridos; manter `connect`, `REPO_ROOT`, `checksum`, `estado()`, `registrarSeFaltar()`, `naTransacao()` já existentes):

1. `T1 estático` (mantido): `.down.sql` tem `begin;`/`commit;`, `DESFAZER` sem eles, contém `drop table if exists app.request_draft` e NÃO contém `cascade` (nova asserção que blinda a decisão 801), contém os 4 `drop function` e o `delete ... '20261111440000'`.
2. `T2 idempotência do UP` (novo, CA-147-02): transação; `MIGRACAO` duas vezes; `estado()` igual entre 1ª e 2ª aplicação; tabela existe e 4 funções existem; rollback; `estado()` igual ao inicial.
3. `T3 proteção relacional` (novo, CA-147-03): consulta `dependentesPosteriores()`. Se vier vazio, o teste faz `t.skip` informando que a proteção só é verificável com dependentes (o ciclo completo cobre esse caso em T5). Se houver: `savepoint`, `DESFAZER` rejeitado com `err.code === '2BP01'`, `rollback to savepoint`, estado da tabela inalterado (`to_regclass` não nulo, contagem de linhas igual), rollback final.
4. `T4 desfazer parcial` (extensão 2.1.4): ver acima.
5. `T5 ciclo completo condicional` (CA-147-04/05): reaproveita, como funções auxiliares, os corpos dos antigos testes 2 e 3 (aplicar, desfazer, comparar `depois` vs `antes`; desfazer 2x, reaplicar 2x, comparar). Executa só se `dependentesPosteriores()` vazio; senão `t.skip('Ciclo completo de rollback de H-025 requer banco na versão 20261111440000; dependentes posteriores: <n> (<nomes>)')`.
6. `dependentesPosteriores()`: consulta de leitura ao catálogo, retornando linhas com nome/tipo do dependente, excluindo a própria tabela, seus índices, gatilhos e as 4 funções `private.draft_*`. Fontes: `pg_constraint` (`confrelid = to_regclass('app.request_draft')`, contype `f`) e `pg_depend` com `refobjid` igual ao `oid` da tabela ou ao seu `reltype`, `deptype = 'n'`, `classid` em `pg_proc`, `pg_constraint`, `pg_rewrite`/`pg_class`, usando `pg_describe_object`. Retorna `[]` se a tabela não existir.

Resultado esperado no DEV atual: T1, T2, T3, T4 passam; T5 `skip`; saída 0.

## 4. Plano de implementação em fatias

| Fatia | Conteúdo | Saída verificável |
|---|---|---|
| F1 | Escrever `dependentesPosteriores()` e rodar uma consulta de leitura para conferir que acha H-026/H-031 (sem DDL) | Lista contém as FKs e as funções `request_publish_*` |
| F2 | T1 reforçado (sem cascade) e T2 idempotência | `node --test --test-concurrency=1 packages/db/tests/draft-rollback-h025.dbtest.mjs` com T1 e T2 verdes |
| F3 | T3 recusa 2BP01 com savepoint e `lock_timeout` | T3 verde; estado idêntico depois |
| F4 | T4 desfazer parcial (ou descarte justificado) | T4 verde, ou nota de descarte no PR |
| F5 | T5 condicional com `t.skip` rastreável (reaproveita corpos antigos) | Runner mostra SKIP com motivo, `# fail 0` |
| F6 | Rodar o arquivo 2 vezes seguidas; `lint` e `typecheck` do pacote; conferir `git status` sem arquivos fora do escopo; commit conforme 804 | Saída 0 duas vezes; escopo limpo |

Cada fatia roda localmente (sem GitHub Actions). Evidência na Issue: comando, contagem de pass/skip/fail e código de saída. Máximo de 3 tentativas por etapa e 2 ciclos de correção.

## 5. Riscos

| Risco | Mitigação |
|---|---|
| R1: skip virar escudo permanente e esconder regressão | Decisões 2.1.1 a 2.1.3: detecção dinâmica, T1 a T4 sempre afirmam, T3 falha se o `drop` passar com dependentes. Reviewer confere que não há `t.skip` incondicional |
| R2: edição acidental do `.down.sql` com CASCADE | Fora de escopo; T1 afirma ausência de `cascade`; Reviewer confere `git diff` só em um arquivo de teste |
| R3: `commit` ou resíduo no DEV compartilhado | `naTransacao` com rollback no `finally`; comparação `estado()` antes/depois; nenhum `commit` |
| R4: contenção de lock (ACCESS EXCLUSIVE no `drop table`) com outros testes | `set local lock_timeout = '5s'`; DEV sem agentes concorrentes durante a execução (regra de 1 execução `db:test` por vez) |
| R5: consulta de dependentes com falso negativo/positivo | F1 valida contra o DEV real; consulta somente leitura; comparação por catálogo, não por nome fixo |
| R6: T4 esbarrar em dependentes das funções `draft_*` antigas | Verificação na F4; se falhar, descartar T4 e registrar, sem CASCADE |
| R7: transação abortada após `2BP01` invalidar as asserções seguintes | `savepoint`/`rollback to savepoint` obrigatórios em T3 e T4 |
| R8: mensagem do PostgreSQL mudar de idioma/texto | Afirmar `err.code`, nunca o texto |

## 6. Matriz de testes (critério x prova)

| Critério | Teste | Prova | Tipo |
|---|---|---|---|
| CA-147-01 estático | T1 | begin/commit presentes e removíveis; `drop table` sem `cascade`; 4 drops de função; delete da versão | sem banco |
| CA-147-02 idempotência UP | T2 | `MIGRACAO` x2 sem erro; estado igual; tabela e 4 funções presentes | banco DEV, rollback |
| CA-147-03 recusa 2BP01 | T3 | `DESFAZER` rejeita com `code === '2BP01'`; tabela e contagem intactas | banco DEV, savepoint |
| CA-147-04 guarda e skip | T5 | Com dependentes: SKIP com motivo e lista; runner sem falha | banco DEV |
| CA-147-05 ciclo em banco isolado | T5 | Sem dependentes (banco na versão 440000): desfazer, reaplicar e idempotência passam. Não executável no DEV atual; fica coberto pelos corpos reaproveitados e pela guarda dinâmica | condicional |
| CA-147-06 inocuidade | T2 a T5 | `estado()` depois é igual a antes (`deepEqual`); nenhum `commit` | banco DEV |
| CA-147-07 suíte verde | arquivo todo | `node --test --test-concurrency=1 packages/db/tests/draft-rollback-h025.dbtest.mjs` sai 0, `# fail 0`, T1 a T4 pass, T5 skip | execução local |
| D-10 parcial (extensão) | T4 | funções saem, versão sai do registro, `app.service` e tabela intactas | banco DEV, rollback |

Limite assumido e declarado: no DEV atual o ciclo completo D-10 (tabela removida e recriada) não é exercitado; o que o substitui é a prova de proteção (T3) e a cobertura parcial (T4). Isso não é mascaramento porque o skip é impresso, dinâmico e bidirecional. Executar o ciclo completo de verdade exigiria um banco efêmero parado na versão 440000, hoje fora de escopo (sem Docker, sem desfazer migrações posteriores).

## 7. Pontos para Code Review e QA

- Review: um único arquivo de teste alterado (mais este desenho); sem `cascade`, sem `commit`, sem `t.skip` incondicional; `err.code` e não texto.
- QA (agy): rodar o arquivo duas vezes, conferir saída 0, linha SKIP com motivo, e que `ops.schema_migration` e `app.request_draft` não mudaram (contagem antes e depois).
