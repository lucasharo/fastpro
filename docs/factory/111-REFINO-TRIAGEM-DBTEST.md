# Refino da triagem do db:test no banco de desenvolvimento (#140, E15)

- Issue: #140 [E15] Triagem das falhas do db:test no banco de desenvolvimento
- Workflow: WF-03 (Feature), etapa Product Owner (primeira coluna; nenhuma etapa pulada)
- Data: 2026-11-13
- Repositório: D:\projetos\fastpro, branch feature/init
- Saída: este refino. Não há código, não há execução de testes e não há mudança de banco nesta etapa.

## 0. Fontes e limitações desta etapa

Fontes lidas: `docs/factory/11-DECISOES.md` (Incidente de processo de 2026-11-12, rodadas 39, 40, 41, 44 e 56, decisões 148, 149, 150 e 157), `docs/factory/quadro-status.md` (atualizado em 2026-11-12 15:23 UTC), `package.json` raiz (script `db:test`), `packages/db/package.json`, `packages/db/scripts/demo-load.mjs` (cabeçalho), cabeçalhos e nomes de teste dos arquivos `packages/db/tests/*.dbtest.mjs` citados no log, e `workflows/WF-03-FEATURE.md` (apenas localizado).

Limitações (NÃO VERIFICADO):
- O texto completo da Issue #140 não foi lido. Esta execução não tem shell, então `gh issue view` não rodou. O objetivo e a lista de falhas foram reconstruídos a partir de `11-DECISOES.md`. O líder deve conferir o texto da Issue antes da Arquitetura.
- Nenhum teste foi executado. Os nomes de falha vêm do log de 2026-11-12, não de uma execução nova.
- Não há registro de quantas vezes cada teste falhou. O log lista grupos, e a soma dos grupos nomeados pode passar de 22 se algum grupo tiver só parte dos testes falhando.
- WF-03 foi localizado em `workflows/WF-03-FEATURE.md`, mas suas etapas não foram lidas.
- `docs/factory/13-VERIFICACAO-SERVICOS.md` foi pesquisado por `db:test|DEV|banco de desenvolvimento` sem resultados. Não foi lido por inteiro.
- O arquivo `.env.local` existe na raiz. Só o nome foi confirmado. Seu conteúdo não foi lido nem impresso.

## 1. Verificação de fila

- `quadro-status.md` mostra #140 na coluna "Product Owner (1)". Está na primeira coluna. A ordem de colunas está correta.
- A fila não tem outro cartão em Product Owner.

## 2. Objetivo

Classificar cada falha do `corepack pnpm db:test` completo, rodado no banco de desenvolvimento (DEV), em uma destas categorias:
- A. estado sujo do DEV (resíduo ou dado que muda contagem);
- B. migração (não aplicada, aplicada fora de ordem ou com histórico divergente);
- C. teste desatualizado (expectativa que não acompanha uma decisão já aceita);
- D. bug real (código de produção errado);
- E. instabilidade (timeout ou carga no DEV);
- F. falha no fixture do próprio teste.

Para cada falha, indicar arquivo, teste, dono (Issue de origem) e ação. Reconciliar o estado do DEV sem apagar dado não sintético. Terminar com `db:test` completo verde, ou com falhas conhecidas justificadas por escrito, com Issue de origem e código de saída registrados.

## 3. Escopo

Dentro do escopo:
- rodar o diagnóstico no DEV, em série, conforme o fluxo da seção 5;
- classificar as falhas e registrar a tabela da seção 4;
- reconciliar o DEV: remover apenas resíduo sintético identificado por marcador de teste, após dry-run e autorização (pergunta P-140-1);
- corrigir apenas fixture ou expectativa de teste, quando a decisão registrada já aceita o comportamento (pergunta P-140-4);
- abrir ou indicar a Issue de origem para cada bug real.

Fora do escopo:
- corrigir código de produção das Issues de origem (#19, #31, #32, #34, #35, #38, #43, #44 etc.). Isso vira Issue ou ciclo próprio, com seu próprio Product Owner, Arquitetura e Desenvolvimento;
- alterar, apagar ou migrar dado real (não sintético) do DEV;
- rodar carga ou remoção de demonstração em paralelo com o `db:test`;
- usar Docker, MCP do Supabase ou `npx supabase db push` para resolver histórico de migração (ver risco R7);
- declarar CI verde. A evidência é local.

## 4. Tabela inicial de classificação (hipóteses, não conclusões)

A coluna "candidato" foi obtida pelo arquivo de teste. A coluna "origem" é candidata e NÃO VERIFICADA: a confirmação vem do cabeçalho do arquivo e do quadro.

| Falha (nome no log de 2026-11-12) | Arquivo (verificado) | Origem candidata (NÃO VERIFICADO) | Hipótese inicial | Ação prevista |
|---|---|---|---|---|
| D-02b (app_api só executa audit_append) | packages/db/tests/audit.dbtest.mjs:183 | #19 Auditoria append-only | B ou D: grant divergente no DEV | Consulta de privilégios (somente leitura); decidir B ou D |
| D-01 (tabelas de auditoria com RLS forçada) | packages/db/tests/audit.dbtest.mjs:136 | #19 | B ou D | Mesma análise de D-02b |
| D-01 (rascunho sem conta) | packages/db/tests/draft-request-h025.dbtest.mjs:100 | #38 Rascunho de pedido sem conta | A ou B | Confirmar qual D-01 falhou; o nome é repetido em dois arquivos (risco R2) |
| T-BK-09 (papel de backup lê toda tabela de domínio) | packages/db/tests/backup-roles.dbtest.mjs:121 | Backup (28-DESENHO-H010); decisão 147 | D ou C: tabelas de localização (professional_area, professional_area_history, professional_service) fora do backup | Reproduzir; a decisão 147 aceita a exclusão das tabelas de localização do papel de backup, então pode ser C; a lista de exceção do teste precisa conferir com a decisão |
| T-H019-09 a T-H019-16 (8 casos da busca de serviço) | packages/db/tests/catalog-search.dbtest.mjs:137 a :292 | H-019 (64-DESENHO-H019); candidato #32 | A ou E. T-H019-16 é medição de tempo (E). Os demais: sinônimos ou grupos residuais no DEV (A) | Separar T-H019-16 dos demais; checar resíduo da busca no DEV |
| T-H018-11 e T-H018-13 (semente de 25 grupos e conflito por nome) | packages/db/tests/catalog-service.dbtest.mjs:460 e :548 | H-018; candidato #31 | A: contagem do catálogo do DEV diferente da semente (dados extras ou demo). Também pode ser F | Comparar contagem do catálogo do DEV com a semente, em leitura |
| D-10 (revoke, search_path e execute da migração de rascunho) | packages/db/tests/draft-request-h025.dbtest.mjs:306, :334, :435; packages/db/tests/draft-rollback-h025.dbtest.mjs:97 e :133 | #38 (H-025) | B: estado de migração 20261111440000 no DEV, ou A: resíduo de desfazer | Ver se a migração está aplicada uma vez e se o arquivo de desfazer foi executado sem rollback |
| desfazer de rascunho ("aplicar, desfazer e fazer rollback...") | packages/db/tests/draft-rollback-h025.dbtest.mjs:97 | #38 | A ou B | Mesma análise de D-10 |
| T-DB02 (confirmação idempotente, 20 conexões) | packages/db/tests/draft-review-h030.dbtest.mjs:233 | #43 Revisão e confirmação expressa (Aguardando aprovação) | F. Corrigido no fixture na 2a passada da #43 (rodada 41). Reexecutar | Se passar, o item sai da lista. Nome repetido em request-publish-h031.dbtest.mjs:196 (#44, risco R2) |
| CA-4 (CHECKs do ponto permanente, 6 casos) | packages/db/tests/geo-geocode-point.dbtest.mjs:121 a :151 | H-021 (68-DESENHO-H021); candidato #34 | B: CHECK de migração diferente no DEV, ou A: ponto de teste residual | Ler a migração aplicada e a restrição no DEV (leitura) |
| T-CA10 (linhas antigas de match_point; desfazer e refazer) | packages/db/tests/geo-match-point.dbtest.mjs:576 | H-0xx; candidato #35 | A ou B. Este teste desfaz e refaz migração no DEV, o que deixa o DEV alterado se for interrompido | Verificar estado da migração de match_point antes e depois. Maior risco de resíduo |
| Timeout de 5 s em T-H013-03 (rodada 41) | NÃO VERIFICADO: o nome não aparece em packages/db/tests; pode estar em apps/api/tests | H-013 | E (instabilidade sob carga) | Confirmar se pertence ao db:test. Se não pertencer, sai do escopo e vai para a Issue da API |

Regra de atribuição: a atribuição é por arquivo, não pelo nome do teste (ver R2).

## 5. Fluxos

F1. Preparação (sem alterar o DEV)
1. Ler `quadro-status.md`. Confirmar que nenhum cartão em Desenvolvimento ou QA está usando o DEV no momento. No snapshot de 2026-11-12, são #44 e #119 (Desenvolvimento) e #141 e #50 (QA). Confirmar de novo na hora da execução.
2. Confirmar que nenhum processo de carga ou remoção de demonstração está rodando (`packages/db/scripts/demo-load.mjs` falha com 40P01 se rodar junto).
3. Registrar o estado de demonstração do DEV com `pnpm db:demo:load -- --dry-run` (sem gravar). Anotar a contagem.
4. Registrar a contagem de linhas com marcador de teste (`@example.test`, linhas com ano 2099) e de linhas sem marcador nas tabelas de domínio, em leitura.

F2. Linha de base, em série e por arquivo
1. Listar os 64 arquivos `packages/db/tests/*.dbtest.mjs` (contagem verificada: 64).
2. Para cada arquivo, em ordem alfabética: `node --test --test-concurrency=1 packages/db/tests/<arquivo>` com limite de 300 s. Registrar total de testes, passou, falhou, código de saída e tempo.
3. Não rodar dois arquivos ao mesmo tempo. Não rodar outro agente no DEV durante esta etapa (ver seção 6).
4. Depois da série, rodar `corepack pnpm db:test` como comando único, se o tempo permitir. Se o limite de 580 s não permitir, a execução única fica como falha conhecida de execução, e vale a série (ver P-140-3).

F3. Classificação
1. Para cada falha: nome do teste, arquivo, linha, mensagem de erro sem valores de conexão e código SQL de erro, se houver.
2. Atribuir uma categoria (A a F) e um dono (Issue de origem, confirmada pelo cabeçalho do arquivo ou pelo quadro).
3. Reproduzir a falha isolada com `--test-name-pattern="<nome>"` (suportado pelo Node 22+; NÃO VERIFICADO na versão instalada) antes de classificar como E.

F4. Reconciliação do DEV (somente após autorização P-140-1)
1. Listar resíduo candidato por marcador (`@example.test`, linhas de 2099) em modo leitura.
2. Dry-run: contar o que seria removido. Enviar a lista ao líder para autorização.
3. Remover só o que tem marcador de teste. Nunca remover linha sem marcador. Dado de demonstração é removido só pelo comando de remoção de demonstração, com dry-run antes.
4. Recontar. As contagens do passo 4 de F1 devem bater, exceto pelo resíduo removido.

F5. Migração (categoria B)
1. Comparar as migrações aplicadas (tabela de histórico do executor do repositório) com `supabase/migrations`, em leitura.
2. Não usar `npx supabase db push`, porque ele usa outro histórico e a conta deu 403 (rodada 56, decisão 157). Não usar o MCP do Supabase.
3. Se houver divergência, a correção de histórico depende de decisão (P-140-6). Não corrigir por inferência.

F6. Correção (categorias C e F, dentro desta Issue)
1. Ajustar só o fixture ou a expectativa, com referência à decisão que a sustenta.
2. Cada ajuste vai em commit separado, com o caminho do arquivo e a decisão no texto.
3. Limite de 3 tentativas e 2 ciclos de correção, conforme AGENTS.md.

F7. Bug real (categoria D) e instabilidade (categoria E)
1. Categoria D: abrir ou indicar a Issue de origem. Não corrigir código de produção aqui.
2. Categoria E: registrar a medição (tempo, carga) e a rodada isolada. Não aumentar tempo limite para esconder a falha sem decisão.

F8. Fechamento
1. Rodar `corepack pnpm db:test` como comando único, se possível. Registrar contagem e código de saída.
2. Atualizar a Issue #140 com a tabela, a contagem final e o resumo em linguagem simples.
3. Mover #140 para Aguardando aprovação somente depois de confirmar a coluna no quadro. Conclusão é decisão humana.

## 6. Regras de execução no DEV

- R-DEV-1: nenhum outro agente usa o banco DEV durante a execução. Motivo: deadlock 40P01, descrito no cabeçalho de `demo-load.mjs` e na decisão 78. Verificar no quadro no início de F2 e em cada retomada.
- R-DEV-2: não rodar carga ou remoção de demonstração durante `db:test`.
- R-DEV-3: testes que usam COMMIT real precisam de limpeza no `finally`. Se o processo for morto (timeout), a limpeza pode não rodar e deixar resíduo. Depois de cada arquivo com timeout, rodar a contagem de F1 passo 4.
- R-DEV-4: a conexão com o DEV vem do `.env.local` ou do ambiente. Nenhum valor de conexão, senha ou chave aparece em log, saída ou commit. Não usar `grep` recursivo que possa imprimir o `.env.local`.
- R-DEV-5: a rotação de senha do DEV (decisão 150) está pendente. Ver P-140-8.

## 7. Critérios de aceite (testáveis)

Todos os comandos abaixo são PowerShell, porque o repositório roda no Windows.

- CA-01 Inventário completo. A tabela da seção 4 (ou a tabela final) tem uma linha por falha da linha de base. Prova: contagem de linhas da tabela igual à contagem de falhas da linha de base.
- CA-02 Arquivos. Antes da execução: `(Get-ChildItem packages/db/tests -Filter *.dbtest.mjs).Count` retorna 64. Se o número mudar, a Issue registra o novo número.
- CA-03 Linha de base por arquivo. Para os 64 arquivos, há um registro com total, passou, falhou e código de saída. Código de saída de cada arquivo registrado; nada é declarado verde sem código 0.
- CA-04 Falhas sem classificação. Falhas da linha de base menos falhas classificadas = 0.
- CA-05 Correção do T-DB02 (#43). `node --test --test-concurrency=1 --test-name-pattern="T-DB02" packages/db/tests/draft-review-h030.dbtest.mjs` retorna código 0, com 0 testes em "not ok" na saída TAP.
- CA-06 Resíduo. A contagem de linhas com marcador de teste (passo 4 de F1) depois da execução é igual à de antes, ou a diferença foi removida com autorização e dry-run registrados.
- CA-07 Dado não sintético intacto. Contagem de linhas sem marcador nas tabelas de domínio igual antes e depois (diferença 0).
- CA-08 Demonstração. O registro mostra o estado de demonstração antes da execução (dry-run do F1, passo 3). Nenhuma carga ou remoção de demonstração no intervalo da execução (conferido pelo quadro e pelo horário do log).
- CA-09 Resultado final. Uma das duas condições:
  - (a) `corepack pnpm db:test` retorna código 0, sem falhas; ou
  - (b) o código de saída não é 0, e cada falha restante tem: categoria, Issue de origem aberta, motivo e data. A Issue #140 não declara "verde" nesse caso.
- CA-10 Sem segredo no log. Os logs salvos não têm valor de conexão. Verificação: `Select-String -Path <log> -Pattern "postgres(ql)?://"` retorna 0 linhas.
- CA-11 Commit restrito. Antes de qualquer commit: `git diff --cached --stat` lista só os arquivos da Issue. Para este refino: só `docs/factory/111-REFINO-TRIAGEM-DBTEST.md`.
- CA-12 Fila confirmada. O registro de F1 passo 1 mostra a lista do quadro na hora da execução, sem outro agente no DEV.

## 8. Casos de borda

- B1. Teste que demora mais de 10 minutos. O limite de 580 s já foi visto antes. A execução é feita por arquivo (F2), com limite de 300 s por arquivo. Um arquivo que passa de 300 s é dividido com `--test-name-pattern`, e o resultado é registrado por parte.
- B2. Teste que deixa resíduo. Testes com COMMIT real: `draft-review-h030` (20 conexões, T-DB02) é confirmado. Outros candidatos (concorrência de login, concorrência de papéis, concorrência de aprovação dupla, concorrência de desafio H-013) são NÃO VERIFICADO: a lista vem do nome dos arquivos, não de leitura do código.
- B3. Dados de demonstração. Se o DEV tiver demonstração carregada (#129), testes que contam linhas (catálogo, listas de administração) podem falhar sem bug. O estado é registrado antes (CA-08). Remover a demonstração só se uma falha depender dela (P-140-2).
- B4. Migração que muda durante a execução. Se o DEV receber migração no meio da triagem, o estado de F5 é refeito.
- B5. Execução concorrente. Duas execuções de `db:test` no mesmo DEV não são permitidas (40P01).
- B6. Falha que só aparece na execução completa. Pode ser ordem ou estado deixado por outro arquivo. Esta falha é registrada como categoria A ou E, com a sequência de arquivos.
- B7. Nomes repetidos. T-DB02, D-01 e D-10 aparecem em mais de um arquivo. A atribuição é por arquivo (R2).
- B8. Relógio. Testes com relógio fixo (2099) podem falhar se o DEV tiver dado com prazo vencido. Registrar a data da execução.

## 9. Riscos

- R1. Classificação sem execução. Esta seção 4 são hipóteses. A tabela final só vale com a linha de base de F2.
- R2. Colisão de identificadores. T-DB02 existe em `draft-review-h030` (#43) e em `request-publish-h031` (#44). D-01 e D-10 também se repetem. Mitigação: atribuição por arquivo.
- R3. DEV compartilhado. Agentes em Desenvolvimento e QA podem usar o mesmo banco. Mitigação: R-DEV-1 e CA-12.
- R4. Remoção indevida de dado. Mitigação: marcador obrigatório, dry-run, autorização (P-140-1), recontagem (CA-07).
- R5. Declarar verde sem ter rodado. Mitigação: CA-09 exige código de saída; "NÃO VERIFICADO" quando faltar.
- R6. Vazamento de segredo em log. Já houve incidente (decisão 150). Mitigação: CA-10 e R-DEV-4.
- R7. Histórico de migração divergente (`db:migrate` × `npx supabase db push`). A decisão 157 está pendente desde a rodada 40. Mitigação: F5 e P-140-6.
- R8. Timeout do ambiente de execução (580 s). Mitigação: F2 por arquivo.
- R9. Demonstração muda contagens. Mitigação: CA-08 e B3.
- R10. Esta etapa não tem shell. Não há como rodar `gh`, `git` nem `db:test` a partir deste agente. A execução precisa de um agente com shell.

## 10. Perguntas abertas (para o líder consolidar; este agente não pergunta ao usuário)

P-140-1. Autorizar a remoção de linhas de teste residuais no DEV, somente com marcador de teste, após dry-run aprovado pelo líder?
- Alternativas: (a) sim, com dry-run e recontagem; (b) não, só registrar o resíduo e limpar com rollback nos testes; (c) limpar só pelo comando de demonstração.
- Recomendação: (a). AGENTS.md proíbe exclusão por inferência, e a regra permanente cobre só a demonstração. Sem autorização explícita, a execução para em F4.

P-140-2. Os dados de demonstração ficam carregados durante a triagem?
- Alternativas: (a) manter e registrar o estado; (b) remover antes da linha de base e recarregar depois.
- Recomendação: (a). Remover só se uma falha depender da contagem de demonstração (B3). A regra permanente já autoriza carga e remoção no DEV, mas não junto com o `db:test`.

P-140-3. Como rodar o `db:test` sem passar o limite de 580 s?
- Alternativas: (a) série por arquivo (F2), mais um comando único se couber; (b) comando único em segundo plano, com log em arquivo e consulta posterior; (c) aceitar só a série e registrar que não houve execução única.
- Recomendação: (a) como base, e (b) se o ambiente permitir. Registrar explicitamente qual foi usada.

P-140-4. Alterar fixture ou expectativa de teste dentro da #140?
- Alternativas: (a) sim, só para fixture ou expectativa já aceita por decisão registrada; (b) não, abrir Issue própria para cada caso.
- Recomendação: (a) para F e C com decisão de suporte; (b) para qualquer caso que mude comportamento de produção.

P-140-5. Aceitar a atribuição de falha por arquivo, dado que nomes como T-DB02, D-01 e D-10 se repetem?
- Recomendação: sim. Registrar sempre o arquivo junto com o nome.

P-140-6. Qual é o executor oficial de migração para o DEV?
- Alternativas: (a) `corepack pnpm db:migrate`, formalizado; (b) `npx supabase`, conforme a regra geral, com a conta que hoje dá 403.
- Recomendação: (a), como a decisão 157 propõe. Sem essa decisão, toda falha de categoria B fica sem correção.

P-140-7. O critério de conclusão aceita falhas conhecidas (CA-09 caminho b) ou exige zero falha?
- Recomendação: aceitar caminho (b) só para falhas com Issue de origem aberta e motivo registrado. Zero falha é o alvo.

P-140-8. A rotação de senha do DEV (decisão 150, pendente) deve acontecer antes da execução?
- Alternativas: (a) rotacionar antes, porque a execução usa a mesma credencial; (b) executar e rotacionar depois.
- Recomendação: (a), por causa do risco de vazamento já registrado. Decisão do usuário, mas a triagem pode ser adiada sem bloquear outros cartões.

P-140-9. Confirmar o texto da Issue #140.
- O líder deve colar ou conferir o objetivo e a lista de falhas da Issue, porque este refino usou o log de decisões como fonte.

## 11. Dependências

- Decisão 150 (rotação da senha do DEV): pendente. Relacionada a P-140-8.
- Decisão 157 (executor de migração): pendente. Relacionada a P-140-6 e R7.
- Correção do T-DB02 da #43 (fixture): já aplicada na 2a passada da #43. Precisa ser reexecutada (CA-05).
- Cartões em Desenvolvimento e QA que usam o DEV: #44, #119, #141, #50 (snapshot de 2026-11-12). Dependem do barril de `packages/db/src/index.ts`, pedido ao usuário (rodada 56). Não bloqueiam esta Issue, mas bloqueiam a execução se estiverem usando o DEV.
- Issues de origem para bugs reais (categoria D): a abrir ou indicar durante a triagem.
- Ambiente de execução com shell, `gh`, `git` e Node 22+ (NÃO VERIFICADO na máquina).
- Próxima coluna após este refino: Arquitetura. Não pular para Desenvolvimento.
