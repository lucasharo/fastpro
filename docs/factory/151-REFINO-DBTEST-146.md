# Refino de Product Owner — Issue #146: db:test T-H018-13 depende de semente ausente no DEV (E15)

- **Issue:** #146 `[E15] db:test: T-H018-13 depende de semente ausente no DEV`
- **Épico:** `[E15] Qualidade, Tooling, Linha de Base e Integridade do Monorepo`
- **Workflow:** WF-03 (Feature / Engenharia / Qualidade)
- **Etapa:** Product Owner (primeira coluna do quadro)
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`
- **Data:** 2026-11-19
- **EXEC-ID:** não atribuído (execução direta de refino)
- **Natureza:** SOMENTE DOCUMENTO. Nenhum código de produção, fixture de teste, script, migração, comando DDL/DML contra banco de dados ou alteração no quadro Kanban foi realizado nesta etapa.
- **Etiquetas de rastreabilidade:**
  - `[DECIDIDO]` decisão aprovada pelo usuário ou líder, com número ou rodada em `11-DECISOES.md`
  - `[VERIFICADO]` inspecionado diretamente no repositório, nos testes ou no quadro
  - `[PROPOSTA]` recomendação deste refino para o Arquiteto e Desenvolvedor
  - `[NÃO VERIFICADO]` item não inspecionado nesta rodada

---

## 0. Fontes e limitações

### Fontes consultadas no repositório
1. `docs/factory/11-DECISOES.md`:
   - Decisões estruturais do usuário:
     - Decisão 44 e 45: fluxo de branches sempre em `feature/init`, sem Docker, uso do Supabase na nuvem (plano gratuito), segredos estritamente em `.env.local` [DECIDIDO].
     - Decisão 148 (Rodada 39, linha 384): autorização da triagem das falhas do `db:test`, criando a Issue #140 no Backlog [DECIDIDO].
     - Rodada 39 (linha 375): registro inicial das 22 falhas no banco DEV, incluindo T-H018-11 e T-H018-13 de catálogo [DECIDIDO].
     - Rodada 56 (linha 578): retomada da triagem #140 sem agentes concorrentes no DEV [DECIDIDO].
     - Rodada 57 (linhas 581-590): refino da triagem #140 (`111-REFINO-TRIAGEM-DBTEST.md`) [DECIDIDO].
     - Rodada 59 (linhas 608-609): série completa rodada 3; catalog-service reduzido para apenas 1 falha conhecida (T-H018-13); abertura formal da Issue #146 no Backlog para tratar especificamente a semente ausente exigida por T-H018-13 [DECIDIDO].
     - Rodada 61 (linha 641): confirmação de que as falhas conhecidas #145, #146 e #147 estavam isoladas [DECIDIDO].
     - Rodada 65 (linhas 668-675): acompanhamento do DEV; catalog-service T-H018-11 e 12 corrigidos na #140; registro de que T-H018-13 segue como Issue #146; regra formal de que testes em banco compartilhado devem usar identificadores/marcadores próprios e contar apenas suas próprias linhas [DECIDIDO].
     - Rodadas 71 e 72 (linhas 717-731): entrega de correções da #140 (`catalog-service` passa 12 de 13 testes; T-H018-13 permanece como a única falha do arquivo, coberta pela Issue #146) [DECIDIDO].
     - Rodada 73 (linhas 723-725): autorização do usuário retirando backup de dados do projeto; fechamento das Issues #128 e #145 como descontinuadas (not planned); criação da Issue #151 documental [DECIDIDO].
     - Rodada 74 (linhas 727-732): proibição estrita de Mapbox real, permitindo unicamente provedores simulados e mocks [DECIDIDO].
2. `docs/factory/112-TRIAGEM-DBTEST-LINHA-DE-BASE.md`:
   - Linhas 63, 140, 155, 156: catalog-service.dbtest.mjs com 13 testes, falha determinística em T-H018-13 (erro SQL 23505 em `service_group_name_key`); classificado preliminarmente como categoria F (fixture dependente do estado do DEV) [VERIFICADO].
   - Linhas 221-223 (Seção 11.1): confirmação definitiva da Categoria F; o DEV possui a semente gravada com 25 grupos, 575 serviços e 1253 sinônimos (`catalog_seed_run = 1`); a tentativa de inserir manualmente `'Reformas e construção'` colide com o grupo `g01` da semente persistida [VERIFICADO].
   - Linhas 281, 337 (Seção 12.3 e 12.4): formalização da Issue #146 como falha conhecida da suíte `db:test`, necessitando de estratégia de fixture que isole o teste da semente do DEV [VERIFICADO].
3. `docs/factory/111-REFINO-TRIAGEM-DBTEST.md`:
   - Linha 65: análise original da falha de T-H018-13 [VERIFICADO].
   - Critérios para classificação entre fixture de teste (F), estado sujo do DEV (A), migração (B) e defeito de produto (D) [VERIFICADO].
4. Arquivos de teste e código do repositório:
   - `packages/db/tests/catalog-service.dbtest.mjs`: linhas 452 a 580 (função `aplicarSemente`, testes T-H018-11, T-H018-12 e T-H018-13) [VERIFICADO].
   - `packages/db/tests/catalog-search.dbtest.mjs`: linhas 61-71 (tratamento de semente já aplicada na busca) [VERIFICADO].
   - `supabase/migrations/20261111210000_catalog_create_seed_apply.sql`: implementação oficial da função PL/pgSQL `private.catalog_seed_apply(p_seed jsonb)` [VERIFICADO].
   - `supabase/seed/catalog/catalog.v1.json`: arquivo oficial da semente de catálogo (versão "1.0.0", 25 grupos, 575 serviços, 1253 sinônimos) [VERIFICADO].
5. Especificação funcional e de arquitetura:
   - `docs/factory/52-REFINO-H018.md` (critérios CA-01 a CA-12) [VERIFICADO].
   - `docs/factory/53-DESENHO-H018.md` (§6.2, especificação original de T-H018-13: "Conflito por nome: grupo/serviço criado à mão com o mesmo nome de um da semente; semente pula e conta skipped_conflict, sem erro") [VERIFICADO].
   - `docs/factory/quadro-status.md` (posicionamento da Issue #146 na coluna Product Owner) [VERIFICADO].

### Limitações declaradas `[NÃO VERIFICADO]`
- Nenhum comando de rede externa ou consulta ao GitHub via `gh` foi executado. O contexto da Issue #146 foi integralmente extraído das decisões registradas em `11-DECISOES.md` e nos relatórios de triagem da fábrica.
- Nenhum comando SQL (DDL, DML, migração ou consulta direta) foi executado contra o banco DEV durante esta etapa estritamente documental.
- Nenhum arquivo de código de teste ou de produção foi alterado neste turno.
- Não há utilização de Docker, Mapbox real, envio de e-mails reais nem ferramentas de backup de banco de dados.

---

## 1. Verificação de fila e dependências reais no quadro

- `[VERIFICADO]` O quadro oficial em `docs/factory/quadro-status.md` lista a Issue **#146** (`[E15] db:test: T-H018-13 depende de semente ausente no DEV`) na coluna **Product Owner (5)**.
- `[VERIFICADO]` **Dependências reais conferidas no quadro:**
  - A história funcional de origem **H-018 (#31, Catálogo com seed de 25 grupos)** já foi totalmente desenvolvida, revisada e aprovada; a migração `20261111210000_catalog_create_seed_apply.sql` está aplicada no banco DEV e o catálogo de produção encontra-se ativo.
  - A Issue **#140 (Triagem do db:test)** concluiu o saneamento das demais falhas do arquivo `catalog-service.dbtest.mjs` (que passou de 11 para 12 testes aprovados de um total de 13), isolando a falha restante exclusivamente na Issue #146.
  - As Issues correlatas do épico E15:
    - **#145:** removida do escopo e fechada (Rodada 73, descontinuação de backup), não interferindo em #146.
    - **#147 (Rollback H-025 fora de ordem):** independente de #146 (escopo em `draft-rollback-h025.dbtest.mjs`).
    - **#149 (check:all vermelho):** independente de #146 (escopo em scripts de checagem estática).
  - A Issue #146 é uma tarefa técnica de **autonomia e integridade de testes (Categoria F)**. Ela **não depende** de nenhuma outra história funcional aberta, nem de novas migrações de banco, estando plenamente apta para execução imediata no fluxo WF-03.

---

## 2. Objetivo

Sanear de forma definitiva o teste `T-H018-13` no arquivo `packages/db/tests/catalog-service.dbtest.mjs`, eliminando a falha determinística causada pelo erro PostgreSQL `23505` (`duplicate key value violates unique constraint "service_group_name_key"`), de modo que o teste passe com sucesso tanto em bancos limpos quanto em bancos compartilhados (como o DEV da nuvem) onde a semente oficial de catálogo já se encontra pré-carregada.

Para isso, o refino estabelece:
1. **Desacoplamento do estado da semente de produção:** O teste deixará de tentar reinserir o nome fixo da semente oficial (`'Reformas e construção'`) e de aplicar a semente completa de produção (`SEED` com 575 serviços já gravados em `app.catalog_seed_run`).
2. **Uso de Semente Sintética Mínima e Autocontida:** O teste passará a utilizar uma semente sintética de teste (`TEST_SEED`) com identificadores e nomes dedicados, garantindo que o teste comprove 100% da regra de negócio de detecção de conflito de nomes (`skipped_conflict`), sem colidir com as chaves únicas já existentes no DEV.
3. **Preservação do Isolamento Transacional:** Todo o teste continuará executando dentro da infraestrutura `inTx` (com `ROLLBACK` incondicional), assegurando que nenhuma alteração residual permaneça no banco de dados após a execução.
4. **Fechamento Verde da Suíte:** O arquivo `packages/db/tests/catalog-service.dbtest.mjs` alcançará **13 de 13 testes aprovados (100% verde)**.

---

## 3. Escopo e Fora de Escopo

### Dentro do escopo
1. **Reestruturação da fixture e asserções do teste `T-H018-13` em `packages/db/tests/catalog-service.dbtest.mjs`:**
   - Construir uma estrutura de semente sintética mínima (`TEST_SEED`) contendo:
     - Uma versão de semente exclusiva de teste (para não colidir com `seed_version` em `app.catalog_seed_run`).
     - Dois grupos sintéticos: um grupo alvo do conflito de nome (ex.: `'Grupo Conflito Teste H018'`) e um grupo regular para inserção bem-sucedida (ex.: `'Grupo Regular Teste H018'`).
     - Serviços sintéticos associados a ambos os grupos, permitindo testar o descarte dos serviços dependentes do grupo conflitante.
   - Inserir previamente na transação um grupo manual com o nome alvo do conflito (`seed_key = null`).
   - Invocar `private.catalog_seed_apply(TEST_SEED)`.
   - Validar que a função retorna `status: 'aplicada'`.
   - Validar que o grupo manual não recebeu `seed_key` e manteve seus valores originais intactos.
   - Validar que o grupo conflitante da semente foi pulado e seus serviços associados foram igualmente pulados e somados ao contador `skipped_conflict`.
   - Validar que o grupo e serviço sem conflito foram inseridos com sucesso (`groups_inserted = 1`, `services_inserted = 1`).
2. **Validação do isolamento em transação:**
   - Garantir que a execução de `T-H018-13` ocorra estritamente sob `inTx`, de modo que o grupo manual e os grupos/serviços sintéticos sejam integralmente desfeitos ao final pelo `ROLLBACK`.
3. **Execução e comprovação local:**
   - Executar `node --test --test-concurrency=1 packages/db/tests/catalog-service.dbtest.mjs` e comprovar a aprovação de todos os 13 testes.

### Fora do escopo
1. **Alteração na função de produção `private.catalog_seed_apply`:** O código da função PL/pgSQL na migração `20261111210000_catalog_create_seed_apply.sql` está funcionalmente perfeito e testado; o problema reside exclusivamente na fixture do teste (Categoria F).
2. **Criação de novas migrações de banco:** A correção não envolve alteração de tabelas, índices, restrições ou permissões.
3. **Remoção ou limpeza de dados do catálogo de produção no DEV:** Os 25 grupos, 575 serviços, 1253 sinônimos e o registro em `app.catalog_seed_run` devem permanecer intactos.
4. **Alteração em outras suítes de teste de banco:** Arquivos como `catalog-search.dbtest.mjs`, `catalog.dbtest.mjs` e `catalog-h107.dbtest.mjs` não devem ser alterados.
5. **Uso de Docker, Supabase local ou MCP do Supabase:** Proibição absoluta conforme decisões canônicas do projeto.
6. **Integrações externas:** Nenhum uso de Mapbox, envio de e-mail real ou código de backup.

---

## 4. Regras do Projeto e Restrições Inegociáveis

- **Branch única de trabalho:** Todo o trabalho deve ser desenvolvido na branch `feature/init`.
- **Sem Docker:** Utilização exclusiva do projeto Supabase na nuvem (plano gratuito) para o ambiente DEV.
- **Segredos protegidos:** Nenhuma credencial, URL com senha ou chave de API deve ser impressa em logs, relatórios ou versionada no git; leitura estrita de `.env.local`.
- **Sem Mapbox real:** Nenhuma chamada ao serviço real da Mapbox; chaves removidas do `.env.local` conforme Rodada 74.
- **Sem e-mail real:** Provedores de notificação reais desativados ou simulados.
- **Sem backup de dados:** Código e documentação de backup removidos ou descontinuados conforme Decisão do Usuário na Rodada 73 (Issue #151); proibido recriar dependências de backup.
- **Ambiente DEV compartilhado:** Testes de banco não devem realizar `COMMIT` em tabelas compartilhadas a menos que a concorrência real assim o exija. Em `catalog-service.dbtest.mjs`, a execução ocorre dentro de transação com `ROLLBACK` incondicional (`inTx`).
- **Proibição de asserções globais cegas:** Conforme estabelecido na Rodada 65 de `11-DECISOES.md` (linha 674), asserções de contagem em banco de dados compartilhado devem filtrar estritamente pelos identificadores ou marcadores sintéticos criados pelo próprio teste, sendo proibido asserir contagens totais absolutas (ex.: `count(*) = 25`), que sofrem interferência de dados criados por outras histórias.

---

## 5. Análise da Causa Raiz e Requisitos de Negócio

### 5.1 Causa Raiz da Falha
O teste `T-H018-13` atualmente em `packages/db/tests/catalog-service.dbtest.mjs` possui a seguinte estrutura:

```javascript
test('T-H018-13 conflito por nome: grupo criado a mao com nome da semente e pulado e contado, sem erro', () =>
  inTx(async () => {
    const manualId = randomUUID();
    await client.query(
      `insert into app.service_group (id, name, position, active) values ($1, 'Reformas e construção', 500, false)`,
      [manualId],
    );
    const r = await aplicarSemente(SEED);
    ...
```

Esse teste falha deterministamente por dois motivos correlacionados:
1. **Violação de unicidade de nome (`23505`):** A tabela `app.service_group` possui a restrição `CONSTRAINT service_group_name_key UNIQUE (name)`. Como o banco DEV já possui a semente oficial aplicada (onde o grupo `g01` se chama exatamente `'Reformas e construção'`), o comando `insert into app.service_group` falha imediatamente ao tentar inserir uma segunda linha com o mesmo nome.
2. **Curto-circuito por semente já aplicada:** Mesmo se o insert manual não falhasse, ao invocar `aplicarSemente(SEED)`, a função `private.catalog_seed_apply` verifica se o par `(seed_version, checksum)` já consta em `app.catalog_seed_run`. Como a semente oficial `catalog.v1.json` já foi gravada no DEV, a função retorna precocemente `status: 'ja_aplicada'` com contadores zerados, quebrando todas as asserções posteriores do teste (que esperavam `status: 'aplicada'` e `groups_inserted: 24`).

### 5.2 Requisito de Negócio (H-018 / CA-04 / Desenho 53 §6.2)
A regra de negócio implementada na função `private.catalog_seed_apply` estabelece que:
- Se uma semente de catálogo for aplicada em um ambiente onde já existem grupos criados manualmente por um administrador (linhas sem `seed_key`), e a semente contiver um grupo cujo nome (após normalização via `private.catalog_norm`) seja idêntico ao grupo manual:
  1. A semente **não deve falhar** com erro de chave duplicada.
  2. O grupo da semente deve ser **ignorado**, e o contador `skipped_conflict` deve ser incrementado.
  3. Os serviços da semente subordinados a esse grupo conflitante **não podem ser órfãos** (não têm grupo válido na semente) e devem ser igualmente **ignorados**, incrementando o contador `skipped_conflict`.
  4. Grupos e serviços da semente que não possuem conflito de nome devem ser **inseridos normalmente**.
  5. O registro manual do administrador deve ser **preservado intacto**, sem alteração de seus atributos e mantendo `seed_key IS NULL`.

---

## 6. Atores, Pré-condições e Fluxo de Execução

### Atores
- **Executor de Testes de Banco (`db:test` / runner do monorepo):** Processo que executa suítes de teste de integração no Node.js 22.
- **Papel de Banco `app_system`:** Papel com permissão para executar a rotina de manutenção `private.catalog_seed_apply`.
- **Banco de Dados PostgreSQL (DEV na nuvem Supabase):** Servidor de banco onde o catálogo reside.

### Pré-condições
1. O banco DEV possui as migrações até `20261111210000_catalog_create_seed_apply.sql` devidamente aplicadas.
2. O papel `current_user` da conexão do teste possui capacidade de assumir `app_system` dentro da transação via `SET LOCAL ROLE`.
3. A conexão de teste está estabelecida através da infraestrutura `connect()` de `packages/db/scripts/lib/env.mjs`.

### Fluxo de Execução do Teste T-H018-13
1. **Início da Transação:** O teste inicia uma transação exclusiva (`BEGIN`) com privilégios locais delegados via `inTx`.
2. **Definição da Semente Sintética:** O teste define uma estrutura `TEST_SEED` contendo:
   - `version: 'test-seed-conflict-h018'` (versão sintética não registrada em `catalog_seed_run`).
   - `groups`:
     - Grupo 1 (conflitante): `{ key: 'g_test_conf', name: 'Grupo Sintético Conflito H018', position: 9100 }`.
     - Grupo 2 (regular): `{ key: 'g_test_ok', name: 'Grupo Sintético Regular H018', position: 9101 }`.
   - `services`:
     - Serviço 1A (no grupo conflitante): `{ key: 's_test_c1', group_key: 'g_test_conf', name: 'Serviço Sintético C1', modality: 'online', regulated: false, active: true, synonyms: [] }`.
     - Serviço 1B (no grupo conflitante): `{ key: 's_test_c2', group_key: 'g_test_conf', name: 'Serviço Sintético C2', modality: 'online', regulated: false, active: true, synonyms: [] }`.
     - Serviço 2A (no grupo regular): `{ key: 's_test_ok1', group_key: 'g_test_ok', name: 'Serviço Sintético OK1', modality: 'online', regulated: false, active: true, synonyms: [] }`.
3. **Criação do Grupo Manual Conflitante:**
   - O teste insere diretamente em `app.service_group` um registro manual com `name = 'Grupo Sintético Conflito H018'`, `seed_key = null`, `position = 500`, `active = false` e um UUID específico `manualId`.
   - Essa inserção é bem-sucedida porque o nome sintético não existe previamente no DEV.
4. **Aplicação da Semente Sintética:**
   - O teste executa `private.catalog_seed_apply(TEST_SEED)` assumindo o papel `app_system`.
   - A função valida o JSON e constata que `TEST_SEED` não consta em `app.catalog_seed_run`.
   - Ao iterar sobre `g_test_conf`, detecta que `name_norm` coincide com o grupo manual existente; a função ignora a inserção do grupo e incrementa `v_skipped := v_skipped + 1`.
   - Ao iterar sobre `g_test_ok`, insere o grupo com sucesso e incrementa `v_groups_ins := v_groups_ins + 1`.
   - Ao iterar sobre `s_test_c1` e `s_test_c2`, constata que o grupo `g_test_conf` não foi inserido na semente (`v_gid IS NULL`); ambos os serviços são ignorados e incrementam `v_skipped := v_skipped + 2`.
   - Ao iterar sobre `s_test_ok1`, localiza o grupo `g_test_ok` recém-inserido e insere o serviço com sucesso (`v_svc_ins := v_svc_ins + 1`).
   - A função registra a execução sintética em `app.catalog_seed_run` e retorna o relatório JSON.
5. **Verificações e Asserções:**
   - O teste valida que o relatório retornou `status === 'aplicada'`.
   - Valida que `groups_inserted === 1` e `services_inserted === 1`.
   - Valida que `skipped_conflict === 3` (1 grupo conflitante + 2 serviços dependentes).
   - Consulta o grupo pelo `manualId` e certifica que `seed_key` permanece `null`, mantendo seu nome original e posição 500.
   - Certifica que o grupo `g_test_ok` foi criado com sua respectiva `seed_key`.
6. **Término e Rollback:**
   - O bloco `inTx` dispara `ROLLBACK`, desfazendo integralmente o grupo manual, os grupos e serviços sintéticos e o registro em `catalog_seed_run`.
   - O banco DEV permanece no estado exato anterior ao teste.

---

## 7. Critérios de Aceite (Given / When / Then) com Prova de Cada Um

### CA-01: Execução sem colisão de chave única em banco pré-populado
- **Given:** O banco de desenvolvimento compartilhado possui a semente oficial de produção (25 grupos, 575 serviços) previamente aplicada em `app.service_group`.
- **When:** O teste `T-H018-13` insere o registro de grupo manual preliminar dentro da transação `inTx`.
- **Then:** O comando `INSERT` é aceito sem disparar o erro PostgreSQL `23505` (`duplicate key value violates unique constraint "service_group_name_key"`).
- **Prova:** O comando executa sem lançar exceção e o objeto retornado possui o `manualId` gerado.

### CA-02: Retorno de status 'aplicada' para semente sintética não registrada
- **Given:** O banco DEV possui execuções prévias registradas em `app.catalog_seed_run`.
- **When:** A função `private.catalog_seed_apply` é invocada com o payload `TEST_SEED` sintético.
- **Then:** Como o checksum de `TEST_SEED` não existe na tabela de histórico, a função processa a carga e devolve `status = 'aplicada'` (e não `'ja_aplicada'`).
- **Prova:** `assert.equal(r.status, 'aplicada')`.

### CA-03: Contabilização exata de grupos e serviços descartados por conflito (`skipped_conflict`)
- **Given:** O grupo manual preliminar possui nome normalizado idêntico a um dos grupos de `TEST_SEED`, e esse grupo da semente possui 2 serviços associados.
- **When:** A semente sintética é processada pela rotina `catalog_seed_apply`.
- **Then:** O grupo conflitante é ignorado, os 2 serviços associados são ignorados por falta de grupo pai na semente, e o contador `skipped_conflict` registra exatamente 3 descartes (1 grupo + 2 serviços).
- **Prova:** `assert.equal(r.skipped_conflict, 3)`.

### CA-04: Inserção correta de elementos não conflitantes da semente
- **Given:** O payload `TEST_SEED` contém 1 grupo e 1 serviço sem qualquer colisão de nome ou chave com o banco.
- **When:** A carga é finalizada.
- **Then:** O relatório devolve `groups_inserted = 1` e `services_inserted = 1`.
- **Prova:** `assert.equal(r.groups_inserted, 1)` e `assert.equal(r.services_inserted, 1)`.

### CA-05: Preservação estrita dos atributos do grupo manual criado pelo administrador
- **Given:** Um grupo inserido manualmente com `id = manualId`, `name = 'Grupo Sintético Conflito H018'`, `position = 500` e `active = false`.
- **When:** O processamento da semente sintética é concluído.
- **Then:** A consulta a `app.service_group` pelo `manualId` confirma que a linha não foi sobrescrita, `seed_key` permanece estritamente `null`, `name` é mantido e `position = 500`.
- **Prova:** Asserções `assert.equal(manual.seed_key, null)`, `assert.equal(manual.name, 'Grupo Sintético Conflito H018')` e `assert.equal(manual.position, 500)`.

### CA-06: Normalização de texto no conflito de nomes
- **Given:** O grupo manual é cadastrado com variações de maiúsculas/minúsculas e acentuação em relação ao grupo da semente (ex.: manual `'GRUPO SINTETICO CONFLITO H018'` vs. semente `'Grupo Sintético Conflito H018'`).
- **When:** A função `catalog_seed_apply` compara os nomes via `private.catalog_norm`.
- **Then:** O conflito é identificado com sucesso pela igualdade da forma normalizada, ignorando a inserção redundante.
- **Prova:** Execução da detecção de conflito mesmo com variações ortográficas, atestando o funcionamento da normalização.

### CA-07: Garantia de ausência de resíduos no banco DEV (Rollback Incondicional)
- **Given:** A execução completa do teste `T-H018-13` envolvendo inserção manual, aplicação de semente sintética e asserções.
- **When:** O teste finaliza (seja com sucesso ou falha).
- **Then:** O bloco `finally` de `inTx` dispara `ROLLBACK`, garantindo que nenhuma tabela de domínio (`app.service_group`, `app.service`, `app.catalog_seed_run`, `audit.audit_event`) retenha linhas sintéticas criadas pelo teste.
- **Prova:** Consulta subsequente pelo `manualId` fora da transação retorna zero linhas.

### CA-08: Suíte de catálogo 100% verde
- **Given:** O arquivo `packages/db/tests/catalog-service.dbtest.mjs` no repositório.
- **When:** Executado via `node --test --test-concurrency=1 packages/db/tests/catalog-service.dbtest.mjs`.
- **Then:** O comando encerra com código de saída 0, registrando 13 testes executados, 13 aprovados, 0 falhas e 0 ignorados.
- **Prova:** Relatório do runner do Node.js comprovando `# pass 13` e `# fail 0`.

---

## 8. Riscos e Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| **R-01: Contenção de locks e concorrência no banco DEV compartilhado** | Intermitência ou timeout durante a execução do teste caso outros agentes ou testes estejam transacionando o catálogo. | A função `catalog_seed_apply` define internamente `set lock_timeout = '5s'`. A adoção de uma semente sintética mínima com apenas 2 grupos e 3 serviços reduz o tempo de transação para poucos milissegundos, minimizando a janela de lock. [PROPOSTA] |
| **R-02: Colisão acidental de nomes da semente sintética com dados futuros** | Falha de unicidade caso o nome escolhido para o teste coincida com novos serviços criados por outras histórias. | Utilizar prefixos estruturados e garantidos contra colisão (ex.: `'T-H018-Conflito-Grupo-' || randomUUID()`). [PROPOSTA] |
| **R-03: Quebra de asserções globais de contagem total de grupos** | Asserções do tipo `select count(*) = 25` quebram se outras histórias criarem grupos residuais (como ocorreu com resíduos da Issue #44). | Proibir asserções de contagem global irrestrita; o teste deve validar apenas a contagem relativa e a integridade dos IDs sintéticos criados por ele. [PROPOSTA] |
| **R-04: Resíduo em caso de falha antes do rollback** | Poluição do catálogo com grupos de teste. | O utilitário `inTx` já encapsula a execução em bloco `try ... finally { await client.query('rollback'); }`, garantindo o cancelamento atômico da transação em qualquer cenário de erro. [VERIFICADO] |

---

## 9. Perguntas ao Líder com Alternativas e Recomendação

### Pergunta 810: Estrutura da Semente Sintética em `T-H018-13`
- **Contexto:** Atualmente, o teste `T-H018-13` tenta usar a semente de produção `SEED` (`catalog.v1.json`, 575 serviços), colidindo com a semente que já está aplicada no DEV e falhando com erro `23505` ou `ja_aplicada`.
- **Alternativa A (Recomendada):** Construir uma estrutura sintética mínima e autocontida dentro do próprio teste (`TEST_SEED`), com 2 grupos e 3 serviços sintéticos e versão própria (ex.: `'test-h018-conflict-v1'`).
- **Alternativa B:** Tentar remover ou renomear o grupo `g01` ('Reformas e construção') e limpar `app.catalog_seed_run` dentro da transação `inTx` antes de rodar a semente completa.
- **Alternativa C:** Clonar o objeto `SEED` inteiro em memória, criar um novo grupo e serviços adicionais e rodar toda a semente de 575 serviços com novo checksum.
- **Recomendação:** **Alternativa A.** É a solução mais elegante, determinística, rápida e segura. A Alternativa B arrisca violações de chave estrangeira com pedidos ou rascunhos que possam referenciar os serviços de `g01` no DEV. A Alternativa C é desnecessariamente lenta e pesada para testar uma regra simples de descarte de grupo conflitante.

---

### Pergunta 811: Cobertura de Normalização no Conflito de Nomes
- **Contexto:** A função `catalog_seed_apply` normaliza os nomes dos grupos via `private.catalog_norm(name)` para checar duplicidade.
- **Alternativa A (Recomendada):** Fazer com que o grupo manual criado no teste tenha pequenas variações de caixa ou acentuação em relação ao grupo da semente sintética (ex.: manual `'Grupo Conflito Teste H018'` vs. semente `'grupo conflito teste h018'`), comprovando a robustez da normalização.
- **Alternativa B:** Utilizar strings perfeitamente idênticas no grupo manual e na semente sintética.
- **Recomendação:** **Alternativa A.** Reforça a fidelidade à especificação de H-018 e assegura que o teste comprove tanto o descarte quanto a insensibilidade a variações de digitação.

---

### Pergunta 812: Asserções Baseadas em Identificadores Locais em vez de Totais Globais
- **Contexto:** O teste atual possui a linha `const total = (await client.query('select count(*)::int as n from app.service_group')).rows[0].n; assert.equal(total, 25);`. Conforme registrado em `11-DECISOES.md` (Rodada 65, linha 674), asserções globais de contagem em banco compartilhado são frágeis porque testes de outras histórias podem deixar registros adicionais com marcador.
- **Alternativa A (Recomendada):** Substituir a checagem global por asserções focadas estritamente nos registros manipulados pelo teste (verificar que o grupo manual existe, que o grupo sintético regular foi inserido e que o grupo sintético conflitante da semente não foi inserido).
- **Alternativa B:** Manter uma asserção de contagem global subtraindo os grupos que não pertencem ao teste.
- **Recomendação:** **Alternativa A.** Alinha-se diretamente à diretriz consolidada da fábrica de "contar apenas as linhas do próprio teste", blindando o teste contra oscilações no ambiente compartilhado.

---

### Pergunta 813: Localização e Atribuição do Ajuste
- **Contexto:** O teste com falha é `T-H018-13` no arquivo `packages/db/tests/catalog-service.dbtest.mjs`.
- **Alternativa A (Recomendada):** Manter o teste dentro de `packages/db/tests/catalog-service.dbtest.mjs`, alterando apenas o corpo do teste `T-H018-13`, garantindo que os 13 testes do catálogo permaneçam reunidos em sua suíte original.
- **Alternativa B:** Extrair `T-H018-13` para um novo arquivo isolado `packages/db/tests/catalog-seed-conflict.dbtest.mjs`.
- **Recomendação:** **Alternativa A.** Evita fragmentação desnecessária de arquivos de teste; o arquivo `catalog-service.dbtest.mjs` passará a rodar 13/13 com código de saída 0.

---

### Pergunta 814: Formato da Mensagem de Commit no Desenvolvimento
- **Contexto:** Pela política do projeto, cada entrega de correção deve ter commit pequeno e atômico referenciando a Issue.
- **Alternativa A (Recomendada):** Adotar o padrão `test(E15): T-H018-13 usa semente sintetica para isolar conflito de nome (#146)`.
- **Alternativa B:** Adotar padrão genérico `fix(db): corrige teste de catalogo`.
- **Recomendação:** **Alternativa A.** Rastreabilidade total com o épico E15 e a Issue #146.

---

## 10. Próximos Passos Sugeridos

1. O líder/Orquestrador adota formalmente as recomendações das perguntas 810 a 814.
2. A Issue #146 avança para a etapa de **Arquitetura (WF-03)**, onde o especialista em Arquitetura elaborará o desenho técnico (`152-DESENHO-DBTEST-146.md`) contendo a estrutura de código exata da semente sintética e as asserções reformuladas.
3. Na etapa de **Desenvolvimento**, o especialista implementará a correção em `packages/db/tests/catalog-service.dbtest.mjs` e comprovará a execução local com código de saída 0.
4. Seguem-se as etapas de **Code Review** e **QA (via agy)**, fechando em definitivo a pendência da Issue #146.
