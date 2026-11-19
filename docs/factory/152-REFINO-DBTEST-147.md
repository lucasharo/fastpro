# Refino de Product Owner — Issue #147: db:test: rollback de H-025 falha com objetos posteriores (E15)

- **Issue:** #147 `[E15] db:test: rollback de H-025 falha com objetos posteriores`
- **Épico:** `[E15] Qualidade, Tooling, Linha de Base e Integridade do Monorepo`
- **Workflow:** WF-03 (Feature / Engenharia / Qualidade)
- **Etapa:** Product Owner (primeira coluna do quadro)
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`
- **Data:** 2026-11-19
- **EXEC-ID:** não atribuído (execução direta de refino)
- **Natureza:** SOMENTE DOCUMENTO. Nenhum código de produção, fixture de teste, migração, comando DDL/DML contra banco de dados ou alteração no quadro Kanban foi realizado nesta etapa.
- **Etiquetas de rastreabilidade:**
  - `[DECIDIDO]` decisão aprovada pelo usuário ou líder, com número ou rodada em `11-DECISOES.md`
  - `[VERIFICADO]` inspecionado diretamente no repositório, nos testes ou no quadro
  - `[PROPOSTA]` recomendação deste refino para o Arquiteto e Desenvolvedor
  - `[NÃO VERIFICADO]` item não inspecionado nesta rodada

---

## 0. Fontes e limitações

### Fontes consultadas no repositório
1. `docs/factory/11-DECISOES.md`:
   - Decisões estruturais canônicas do usuário:
     - Decisão 44 e 45: fluxo de branches sempre em `feature/init`, sem Docker, uso do Supabase na nuvem (plano gratuito), segredos estritamente em `.env.local` [DECIDIDO].
     - Decisão 148 (Rodada 39, linha 384): autorização da triagem das falhas do `db:test`; abertura da Issue #140 [E15] no Backlog [DECIDIDO].
     - Rodada 39 (linha 375): registro inicial das falhas no banco DEV compartilhado [DECIDIDO].
     - Rodada 56 (linha 578): retomada da triagem #140 sem agentes concorrentes no DEV [DECIDIDO].
     - Rodada 57 (linhas 581-590): refino da triagem #140 (`111-REFINO-TRIAGEM-DBTEST.md`) [DECIDIDO].
     - Rodada 59 (linhas 608-609): série completa rodada 3; catalogação das falhas conhecidas com Issue de origem (decisão 266), criando a Issue **#147 (rollback H-025 fora de ordem)** no Backlog ao lado de #145 e #146 [DECIDIDO].
     - Rodada 61 (linha 641): confirmação de que as falhas conhecidas #145, #146 e #147 estavam devidamente isoladas e não bloqueavam novas histórias [DECIDIDO].
     - Rodada 65 (linhas 668-675): acompanhamento do DEV; registro de falhas conhecidas restantes (backup-roles T-BK-09 na #145 e draft-rollback D-10 testes 2 e 3 na #147); consolidação da regra de que testes em banco compartilhado devem usar isolamento adequado [DECIDIDO].
     - Rodadas 71 e 72 (linhas 717-731): entrega de correções da #140; `draft-rollback-h025` permaneceu registrado como falha da Issue #147 [DECIDIDO].
     - Rodada 73 (linhas 723-725): autorização do usuário retirando backup de dados do projeto; fechamento das Issues #128 e #145 como descontinuadas (not planned); criação da Issue #151 documental [DECIDIDO].
     - Rodada 74 (linhas 727-732): proibição estrita de Mapbox real, permitindo unicamente provedores simulados e mocks [DECIDIDO].
     - Rodada 139 e 140: prefixos de migração paralelos e conclusão de issues pelo usuário [DECIDIDO].
2. `docs/factory/112-TRIAGEM-DBTEST-LINHA-DE-BASE.md`:
   - Linhas 72, 125: `draft-rollback-h025.dbtest.mjs` com 3 testes, 1 passa, 2 falham deterministicamente [VERIFICADO].
   - Linha 137: `D-10`: falha em `draft-request-h025.dbtest.mjs` (teste 17) e em `draft-rollback-h025.dbtest.mjs` (testes 2 e 3) [VERIFICADO].
   - Linhas 159-160 (Tabela 6, itens 16 e 17): `draft-rollback-h025.dbtest.mjs` falha com "não é possível remover app.request_draft: outros objetos dependem dela"; classificado provisoriamente como categoria C (ordem de desfazer) ou D [VERIFICADO].
   - Linha 226 (Seção 11.1, itens 16-17): Categoria definitiva **C (ordem de desfazer)**: "Desfazer H-025 com o banco na cabeça falha (2BP01): dependem de request_draft a FK media_asset_draft_id_fkey (H-026) e service_request_origin_draft_id_fkey, além de trigger e índices (Q4). O teste desfaz fora da ordem das migrações. NÃO corrigido: exige desfazer as migrações posteriores dentro da transação; falha conhecida. Origem: #38" [VERIFICADO].
   - Linha 250 (Seção 12.1): `D-10 (draft-rollback-h025)` não corrigido na triagem básica por exigir tratamento de ordem ou isolamento de rollback, virando a Issue #147 [VERIFICADO].
   - Linha 290 (Tabela 12.3): registro formal de `draft-rollback-h025.dbtest.mjs` (saída 1, 3 testes, 1 passa, 2 falham, D-10 testes 2 e 3, código 2BP01) [VERIFICADO].
   - Linha 338 (Tabela 12.4): Issue #147 com decisão pendente: "desfazer em ordem reversa, ou tratar o rollback como não suportado" [VERIFICADO].
   - Linha 345 e 371: confirmação de que #147 é uma das falhas remanescentes da suíte `db:test` [VERIFICADO].
3. `docs/factory/111-REFINO-TRIAGEM-DBTEST.md`:
   - Linha 66: análise inicial de D-10 em `draft-rollback-h025.dbtest.mjs` [VERIFICADO].
   - Taxonomia de categorias: A (resíduo no DEV), B (migração pendente/incompleta), C (expectativa/ordem de teste), D (defeito real de produto), E (tempo/timeout), F (fixture dependente de semente) [VERIFICADO].
4. Arquivos de teste e código no repositório:
   - `packages/db/tests/draft-rollback-h025.dbtest.mjs`: arquivo do teste com os três subtestes (teste 1 estático, teste 2 aplicação e rollback completo, teste 3 idempotência de rollback e reaplicação) [VERIFICADO].
   - `supabase/migrations/20261111440000_draft_create_request_draft.sql`: migração original de criação de `app.request_draft` e suas funções [VERIFICADO].
   - `supabase/rollbacks/20261111440000_draft_create_request_draft.down.sql`: script de reversão que executa `drop table if exists app.request_draft;` sem `CASCADE` [VERIFICADO].
   - `packages/db/tests/verification-rollback.dbtest.mjs`: teste de rollback de referência que implementa detecção de condições de bloqueio (`bloqueadoPorDados`) e skip documentado quando o banco não permite o ciclo completo [VERIFICADO].
   - `packages/db/tests/notifications-rollback.dbtest.mjs`: teste de rollback de pipeline sem dependências posteriores [VERIFICADO].
5. Especificação funcional e de arquitetura:
   - `docs/factory/71-REFINO-H025.md`: refino funcional original do rascunho sem conta [VERIFICADO].
   - `docs/factory/74-DESENHO-H025.md`: desenho técnico (§2 Dados, §4 Critério D-10 sobre idempotência de migração e reversibilidade) [VERIFICADO].
   - `docs/factory/quadro-status.md`: posicionamento oficial da Issue #147 na coluna Product Owner [VERIFICADO].

### Limitações declaradas `[NÃO VERIFICADO]`
- Nenhum comando de rede externa ou consulta ao GitHub via `gh` foi executado. O contexto da Issue #147 foi integralmente extraído das decisões registradas em `11-DECISOES.md` e nos relatórios de triagem da fábrica.
- Nenhum comando SQL (DDL, DML, migração ou modificação direta) foi executado contra o banco DEV durante esta etapa estritamente documental.
- Nenhum arquivo de código de teste ou de produção foi alterado neste turno.
- Não há utilização de Docker, Mapbox real, envio de e-mails reais nem ferramentas de backup de banco de dados.

---

## 1. Verificação de fila e dependências reais no quadro

- `[VERIFICADO]` O quadro oficial em `docs/factory/quadro-status.md` lista a Issue **#147** (`[E15] db:test: rollback de H-025 falha com objetos posteriores`) na coluna **Product Owner (5)**.
- `[VERIFICADO]` **Dependências reais conferidas no quadro:**
  - A história funcional de origem **H-025 (#38, Rascunho de pedido sem conta)** já foi integralmente desenvolvida, revisada e aprovada; a migração `20261111440000_draft_create_request_draft.sql` está aplicada no banco DEV e a tabela `app.request_draft` está plenamente ativa em produção e desenvolvimento.
  - As histórias posteriores que adicionaram dependências sobre `app.request_draft` já foram entregues e migradas:
    - **H-026 (#39, Quarentena de fotos):** migração `20261112120000_media_create_asset_quarantine.sql` (FK `media_asset_draft_id_fkey`).
    - **H-030 (#43, Revisão e confirmação de rascunho):** migrações `20261112130000_draft_expand_identity_attach.sql` e `20261112150000_draft_expand_review_confirmation.sql` (colunas `first_name`, `email`, `confirmed_at`, `content_rev`, restrições e funções com parâmetro `app.request_draft`).
    - **H-029 (#42, Galeria de fotos):** migração `20261112190000_media_expand_photo_order.sql` (coluna `photo_rev` e gatilho `request_draft_confirmation_guard`).
    - **H-110 (#119, Expurgo operacional):** migração `20261112230000_ops_create_operational_purge.sql` (funções de limpeza referenciando `app.request_draft`).
    - **H-031 (#44, Publicação de pedido):** migração `20261113010000_requests_create_service_request.sql` (FK `service_request_origin_draft_id_fkey` e funções `request_publish_*` recebendo `app.request_draft` como tipo de parâmetro).
  - A Issue **#140 (Triagem do db:test)** concluiu o saneamento das 22 falhas originais, isolando as falhas remanescentes em Issues específicas do épico E15:
    - **#145:** removida e fechada pela descontinuação de backup (Rodada 73, Decisão 351).
    - **#146 (T-H018-13 semente ausente):** isolada em `catalog-service.dbtest.mjs`, independente de #147.
    - **#149 (check:all vermelho):** isolada em checagens estáticas de repositório, independente de #147.
  - A Issue #147 é uma tarefa técnica de **integridade e postura de testes de banco (Categoria C - Ordem de Desfazer)**. Ela **não depende** de nenhuma outra história funcional aberta nem de novas alterações de esquema, estando plenamente apta para execução imediata no fluxo WF-03.

---

## 2. Objetivo

Sanear de forma definitiva a suíte de testes `draft-rollback-h025.dbtest.mjs` no pacote `packages/db`, eliminando a falha determinística com erro PostgreSQL `2BP01` (`cannot drop table app.request_draft because other objects depend on it`), permitindo que a suíte passe integralmente com **código de saída 0** no ambiente DEV da nuvem e em pipelines de CI, estabelecendo uma postura arquitetural segura, reproduzível e alinhada com as melhores práticas de banco de dados para testes de rollback de migrações estruturais históricas.

Para alcançar este objetivo, o refino estabelece:
1. **Reconhecimento da Realidade Relacional de Migrações:** Uma migração histórica intermediária (`20261111440000`) que cria uma entidade central (`app.request_draft`) não pode ter sua tabela removida isoladamente quando o banco de dados já possui mais de 60 migrações posteriores ativas, incluindo chaves estrangeiras (`app.media_asset`, `app.service_request`), tipos de linha em assinaturas de funções PL/pgSQL e gatilhos.
2. **Preservação da Segurança do Arquivo de Rollback:** O arquivo oficial de reversão `supabase/rollbacks/20261111440000_draft_create_request_draft.down.sql` **não deve ser alterado com `CASCADE`**. A recusa do PostgreSQL em remover a tabela (`2BP01`) é um comportamento de segurança desejado que protege o banco de dados contra deleções acidentais em cascata de dados e esquemas de outras histórias.
3. **Comprovação Ativa dos Requisitos de Segurança e Idempotência (D-10):**
   - O teste deve continuar validando estaticamente a integridade do script de rollback (remoção de begin/commit, funções e registros).
   - O teste deve comprovar que a migração UP (`20261111440000`) é **idempotente** ao ser reaplicada sobre o banco existente dentro de uma transação desfeita (`ROLLBACK`).
   - O teste deve validar ativamente que o script `.down.sql` é barrado com `2BP01` diante de dependentes posteriores (prova de proteção relacional), ou aplicar uma **guarda de pré-condição** (padrão adotado em `verification-rollback.dbtest.mjs`) que pula (`t.skip`) o ciclo destrutivo completo de remoção/reaplicação quando objetos dependentes estiverem presentes, documentando explicitamente o motivo.
4. **Isolamento Transacional e Inocuidade no DEV:** Todas as operações do teste continuarão encapsuladas em blocos com `ROLLBACK` incondicional, assegurando que nenhuma modificação física ou resíduo permaneça no banco de dados compartilhado.
5. **Fechamento Verde da Suíte:** O arquivo `packages/db/tests/draft-rollback-h025.dbtest.mjs` alcançará **código de saída 0** em sua execução.

---

## 3. Escopo e Fora de Escopo

### Dentro do escopo
1. **Reestruturação do arquivo `packages/db/tests/draft-rollback-h025.dbtest.mjs`:**
   - Manter a verificação estática do arquivo de rollback `20261111440000_draft_create_request_draft.down.sql` (validação de begin/commit, presença de drops de funções e remoção de `ops.schema_migration`).
   - Implementar função de inspeção de dependências no banco (`dependentesPosteriores()`), verificando se existem chaves estrangeiras ou funções externas apontando para `app.request_draft`.
   - Adicionar subteste de **idempotência da migração UP**, comprovando que reexecutar `20261111440000_draft_create_request_draft.sql` em transação sobre o banco já migrado não lança erro e mantém a estrutura intacta.
   - Adicionar subteste de **proteção relacional do script DOWN**, comprovando que o PostgreSQL recusa a destruição cega da tabela com código `2BP01` quando existirem dependências de outras histórias (como H-026 e H-031).
   - Condicionar a execução do ciclo completo de DROP da tabela e reaplicação (`t.skip`) à ausência de dependentes posteriores, registrando com clareza rastreável: `"Ciclo completo de rollback de H-025 pendente de banco na versão 20261111440000: o ambiente atual possui migrações posteriores dependentes (H-026, H-030, H-031)"`.
2. **Garantia de Isolamento Transacional:**
   - Assegurar que todas as consultas e comandos executados pelo teste utilizem `begin` e `rollback` incondicional, garantindo que o banco de dados DEV não sofra qualquer alteração de estado.
3. **Execução e Comprovação Local:**
   - Executar `node --test --test-concurrency=1 packages/db/tests/draft-rollback-h025.dbtest.mjs` e comprovar encerramento com código de saída 0.

### Fora do escopo
1. **Alteração na migração de produção `20261111440000_draft_create_request_draft.sql`:** A migração já está aplicada no DEV e congelada em conformidade com as regras da fábrica.
2. **Adição de cláusula `CASCADE` no arquivo `20261111440000_draft_create_request_draft.down.sql`:** Proibido adicionar `CASCADE` ao `drop table app.request_draft`, pois isso violaria a segurança do banco em caso de rollback manual, apagando involuntariamente tabelas filhas e funções criadas por histórias posteriores.
3. **Desfazer migrações posteriores no DEV:** Proibido reverter migrações de H-026, H-029, H-030, H-031 ou H-110, seja no banco físico ou em scripts de teste.
4. **Criação de novas migrações de banco:** A Issue #147 trata exclusivamente da integridade e assertividade de um teste de banco existente (Categoria C).
5. **Alterações em outras suítes de teste de banco:** Arquivos como `verification-rollback.dbtest.mjs`, `notifications-rollback.dbtest.mjs` ou `draft-request-h025.dbtest.mjs` não devem ser alterados.
6. **Uso de Docker, Supabase local ou MCP do Supabase:** Proibição estrita conforme decisões canônicas do projeto.
7. **Integrações externas:** Nenhum uso de Mapbox real, envio de e-mail real ou código de backup.

---

## 4. Regras do Projeto e Restrições Inegociáveis

- **Branch única de trabalho:** Todo o trabalho deve ser desenvolvido na branch `feature/init`.
- **Sem Docker:** Utilização exclusiva do projeto Supabase na nuvem (plano gratuito) para o ambiente DEV.
- **Segredos protegidos:** Nenhuma credencial, URL com senha ou chave de API deve ser impressa em logs, relatórios ou versionada no git; leitura estrita de `.env.local`.
- **Sem Mapbox real:** Nenhuma chamada ao serviço real da Mapbox; provedores simulados e fakes apenas (Rodada 74).
- **Sem e-mail real:** Provedores de notificação reais desativados ou simulados.
- **Sem backup de dados:** Código e documentação de backup descontinuados conforme Decisão do Usuário na Rodada 73 (Issue #151). Proibido recriar papéis ou dependências de backup.
- **Ambiente DEV compartilhado:** Testes de banco executam em um banco compartilhado na nuvem. Todo teste destrutivo ou de esquema deve rodar estritamente dentro de transação temporária com `ROLLBACK` incondicional, sem persistir nenhuma alteração física.
- **Proibição de alteração em migrações aplicadas:** Conforme estabelecido na Rodada 59 e na Decisão 266, migrações com checksum gravado em `ops.schema_migration` no DEV não podem ser editadas.
- **Não adulteração de scripts de rollback com `CASCADE` perigoso:** Arquivos `.down.sql` de tabelas fundamentais não devem adotar `DROP ... CASCADE` irrestrito para mascarar dependências de histórias posteriores.

---

## 5. Análise da Causa Raiz e Fundamentação Técnica

### 5.1 O que ocorre no teste atual
O teste `packages/db/tests/draft-rollback-h025.dbtest.mjs` foi escrito originalmente durante a implementação de H-025 (migração `20261111440000`).
Naquele momento do ciclo de vida do projeto, `app.request_draft` era a tabela mais recente do banco, e nenhuma outra história havia sido implementada ainda.
O teste continha os seguintes passos dentro de uma transação:
```javascript
await client.query(MIGRACAO); // reaplica 20261111440000
await registrarSeFaltar();
...
await client.query(DESFAZER); // executa drop table if exists app.request_draft;
```
Com a evolução natural do produto, mais de 60 migrações foram adicionadas e aplicadas ao banco DEV. Diversas dessas migrações criaram dependências diretas sobre `app.request_draft`:
1. `app.media_asset` possui a restrição `CONSTRAINT media_asset_draft_id_fkey FOREIGN KEY (draft_id) REFERENCES app.request_draft(id) ON DELETE RESTRICT` (H-026).
2. `app.service_request` possui a restrição `CONSTRAINT service_request_origin_draft_id_fkey FOREIGN KEY (origin_draft_id) REFERENCES app.request_draft(id) ON DELETE SET NULL` (H-031).
3. A função `private.request_publish_missing(p_draft app.request_draft)` depende diretamente do tipo de linha da tabela `app.request_draft` (H-031).
4. A função `private.request_publish_recusa(uuid, app.request_draft, integer, timestamptz)` depende do tipo de linha da tabela `app.request_draft` (H-031).
5. O gatilho `request_draft_confirmation_guard` está vinculado à tabela `app.request_draft` (H-029).

Ao executar `drop table if exists app.request_draft;` (sem `CASCADE`) no comando `DESFAZER`, o PostgreSQL detecta as dependências ativas e aborta imediatamente o comando:
```
error: cannot drop table app.request_draft because other objects depend on it
code: '2BP01'
```
Isso causava a falha dos testes 2 e 3 do arquivo `draft-rollback-h025.dbtest.mjs`.

### 5.2 Princípio de Engenharia: Rollback em Bancos Relacionais
Em engenharia de banco de dados, o rollback de migrações segue o princípio **LIFO (Last In, First Out)**:
- Para reverter a migração #15 em um banco de dados de produção ou desenvolvimento, é obrigatório reverter previamente, em ordem estritamente inversa, todas as migrações posteriores (#80, #79, ..., #16) que dependam direta ou indiretamente dela.
- Tentar remover uma tabela mãe intermediária enquanto tabelas filhas existem viola a integridade referencial do modelo relacional.
- Adicionar `CASCADE` no script `.down.sql` de H-025 seria uma violação severa de boas práticas de segurança, pois um administrador que executasse o rollback de H-025 em produção destruiria instantaneamente, sem aviso, as tabelas de fotos (`media_asset`) e pedidos (`service_request`).

### 5.3 O Precedente de `verification-rollback.dbtest.mjs`
O repositório já possui uma solução padrão estabelecida para esse problema em `packages/db/tests/verification-rollback.dbtest.mjs`:
- O teste divide a validação de rollback em subtestes claros:
  1. **Idempotência do UP:** Reaplicar a migração sobre o banco atual é testado e aprovado.
  2. **Validação de Guarda/Recusa:** O teste valida que o script de reversão é bloqueado ou recusado quando as condições de segurança do banco assim o exigirem.
  3. **Ciclo Completo Condicional:** Se o banco possui dados ou dependências que impedem a reversão segura, o ciclo completo de DROP/reaplicação é pulado (`t.skip`) com um motivo explícito, documentando que a reversão completa de uma história intermediária requer banco descartável/isolado naquele ponto da história.
  4. O arquivo de teste roda e retorna **código de saída 0**.

---

## 6. Atores, Pré-condições e Fluxo de Execução

### Atores
- **Runner de Testes de Banco (`db:test` / Node.js 22 Test Runner):** Processo que orquestra os testes no monorepo.
- **Cliente PostgreSQL (`pg.Client`):** Conexão autenticada ao Supabase DEV via `packages/db/scripts/lib/env.mjs`.
- **Banco de Dados PostgreSQL (DEV Supabase Nuvem):** Hospeda as migrações e o esquema relacional do FastPro.

### Pré-condições
1. O banco DEV possui as migrações de H-025 (`20261111440000`), H-026 (`20261112120000`), H-030 (`20261112130000`/`150000`), H-029 (`20261112190000`) e H-031 (`20261113010000`) aplicadas.
2. A conexão do teste opera sob usuário com permissões administrativas de DDL/DML na sessão temporária do teste.
3. O arquivo de migração e de rollback de H-025 existem em `supabase/migrations/` e `supabase/rollbacks/`.

### Fluxo de Execução do Teste Reformulado
1. **Subteste 1 (Estático):**
   - Lê `20261111440000_draft_create_request_draft.down.sql`.
   - Assegura que o arquivo possui `begin;` e `commit;`.
   - Remove as linhas de controle de transação para execução em transação de teste.
   - Assegura que contém `drop table if exists app.request_draft` e as quatro funções em `private.draft_*`.
2. **Subteste 2 (Idempotência da Migração UP):**
   - Abre uma transação (`BEGIN`).
   - Executa o conteúdo SQL de `20261111440000_draft_create_request_draft.sql`.
   - Valida que a execução é concluída sem erro (graças ao uso de `CREATE TABLE IF NOT EXISTS` e `CREATE OR REPLACE FUNCTION`).
   - Valida que `app.request_draft` continua existindo e com suas funções ativas.
   - Executa `ROLLBACK`.
3. **Subteste 3 (Proteção Relacional contra DROP Fora de Ordem):**
   - Inspeciona o catálogo do PostgreSQL (`pg_constraint` e `pg_depend`) para verificar se existem dependentes posteriores de `app.request_draft`.
   - No banco DEV (onde existem `media_asset`, `service_request`, etc.), executa o script de rollback `DESFAZER` dentro de uma transação com `SAVEPOINT`.
   - Valida que o PostgreSQL rejeita a instrução com o código de erro **`2BP01`** (`cannot drop table app.request_draft because other objects depend on it`).
   - Comprova que a integridade relacional do banco está protegida contra remoção inadvertida da tabela base.
   - Executa `ROLLBACK`.
4. **Subteste 4 (Ciclo Completo de Rollback e Reaplicação - Condicional):**
   - Inspeciona se existem dependentes posteriores.
   - Se existirem dependentes posteriores (caso do ambiente DEV na cabeça do branch): invoca `t.skip('Ciclo completo de rollback de H-025 requer banco na versão 20261111440000; DEV possui migrações posteriores dependentes (H-026, H-030, H-031)')`.
   - Se NÃO existirem dependentes posteriores (em um banco efêmero isolado na versão da migração): executa o script `DESFAZER`, valida que a tabela e funções foram removidas e o registro em `ops.schema_migration` excluído; em seguida reaplica a migração UP e valida que o estado foi recomposto com perfeição.
   - Executa `ROLLBACK` incondicional no bloco `finally`.
5. **Resultado da Suíte:**
   - Todos os testes executados passam com sucesso e o teste condicional é ignorado de forma limpa.
   - Código de saída do processo: **0**.

---

## 7. Critérios de Aceite (Given / When / Then) com Prova de Cada Um

### CA-147-01: Verificação estática do arquivo de rollback
- **Given:** O arquivo `supabase/rollbacks/20261111440000_draft_create_request_draft.down.sql` no repositório.
- **When:** O teste inspeciona estaticamente seu conteúdo.
- **Then:** O teste comprova que o arquivo original possui `begin;` e `commit;`, que a remoção das linhas de controle gera SQL sem begin/commit, que contém `drop table if exists app.request_draft` (sem `CASCADE`), contém os drops das quatro funções de rascunho (`draft_get`, `draft_create`, `draft_patch`, `draft_discard`) e contém a exclusão do registro de versão `'20261111440000'` em `ops.schema_migration`.
- **Prova:** Asserções de regex e substring executadas no Subteste 1 passando sem erro.

### CA-147-02: Idempotência de reaplicação da migração UP sobre banco migrado
- **Given:** O banco de desenvolvimento já possui a migração `20261111440000` aplicada.
- **When:** O teste executa o script completo da migração UP dentro de uma transação temporária.
- **Then:** A execução ocorre sem nenhum erro de SQL, a tabela `app.request_draft` permanece íntegra, e as funções `private.draft_*` permanecem válidas e acessíveis.
- **Prova:** `await client.query(MIGRACAO)` executa com sucesso; asserções confirmam `to_regclass('app.request_draft') is not null`.

### CA-147-03: Prova ativa da proteção relacional contra DROP indevido (Código 2BP01)
- **Given:** O banco DEV possui tabelas e funções de histórias posteriores (`app.media_asset`, `app.service_request`, `request_publish_*`) que referenciam `app.request_draft`.
- **When:** O script `DESFAZER` (que executa `drop table if exists app.request_draft;` sem `CASCADE`) é executado dentro de transação de teste.
- **Then:** O PostgreSQL recusa o comando lançando exceção com código de erro `2BP01`, comprovando que o banco de dados impede a destruição acidental da tabela raiz sem que suas dependentes tenham sido previamente desfeitas.
- **Prova:** `await assert.rejects(client.query(DESFAZER), (err) => err.code === '2BP01')`.

### CA-147-04: Guarda de pré-condição e skip documentado do ciclo completo em banco evoluído
- **Given:** A suíte de teste está rodando no banco compartilhado de desenvolvimento onde existem migrações posteriores ativas.
- **When:** O teste avalia a viabilidade de executar o ciclo destrutivo completo de DROP e reaplicação da tabela base.
- **Then:** O teste detecta a existência de dependentes posteriores e aciona `t.skip` com justificativa técnica rastreável, sem falhar o processo e sem deixar resíduos.
- **Prova:** O runner do Node.js exibe `# SKIP Ciclo completo de rollback de H-025 requer banco na versão 20261111440000...` e não contabiliza falha.

### CA-147-05: Execução do ciclo completo em ambiente isolado/efêmero
- **Given:** A suíte está rodando em um banco de dados de teste isolado onde não existem migrações posteriores a H-025.
- **When:** O teste executa o ciclo completo de UP, DOWN e reaplicação.
- **Then:** O script DOWN remove com sucesso a tabela e funções de rascunho, e a reaplicação do UP restaura o esquema de H-025 com perfeição.
- **Prova:** O bloco condicional executa integralmente caso a consulta de dependentes retorne falso.

### CA-147-06: Inocuidade e isolamento transacional no banco DEV
- **Given:** A execução de todos os testes de `draft-rollback-h025.dbtest.mjs`.
- **When:** Qualquer subteste é concluído (seja com sucesso, rejeição controlada ou erro).
- **Then:** A transação é finalizada com `ROLLBACK` incondicional, assegurando que o estado do banco DEV antes e depois do teste permaneça idêntico, sem criação ou exclusão de nenhuma linha, tabela ou privilégio.
- **Prova:** Asserção de comparação de estado `assert.deepEqual(depois, antes)` após o encerramento das transações.

### CA-147-07: Suíte `draft-rollback-h025.dbtest.mjs` 100% verde
- **Given:** O arquivo `packages/db/tests/draft-rollback-h025.dbtest.mjs` no repositório.
- **When:** Executado via `node --test --test-concurrency=1 packages/db/tests/draft-rollback-h025.dbtest.mjs`.
- **Then:** O comando encerra com **código de saída 0**, reportando zero testes falhos.
- **Prova:** Saída do runner com `# pass >= 2`, `# fail 0`, `# exit code 0`.

---

## 8. Riscos e Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| **R-01: Adulteração inadvertida do script de rollback com `CASCADE`** | Quebra grave de segurança em produção; se alguém rodar o rollback de H-025 manualmente, todas as tabelas e funções posteriores de mídia e pedidos seriam destruídas silenciosamente. | O refino proíbe formalmente qualquer edição em `20261111440000_draft_create_request_draft.down.sql`. A recusa com erro `2BP01` deve ser tratada como comportamento seguro e esperado no teste. [DECIDIDO] |
| **R-02: Execução de DDL com `COMMIT` no banco DEV compartilhado** | Corrupção física do banco DEV, destruindo tabelas de outras histórias ou travando conexões concorrentes. | Todas as instruções SQL do teste rodam dentro de transações com `ROLLBACK` incondicional em bloco `finally`, sem nenhum `COMMIT` intermediário. [VERIFICADO] |
| **R-03: Consulta frágil de dependentes posteriores no catálogo** | Falso positivo ou falso negativo ao verificar se existem dependentes de `app.request_draft`. | Utilizar consulta padrão e determinística no catálogo do PostgreSQL via `pg_constraint` (filtrando `confrelid = 'app.request_draft'::regclass`) e `pg_depend` para funções dependentes do tipo de linha da tabela. [PROPOSTA] |
| **R-04: Testes concorrentes executando no banco DEV durante a execução do dbtest** | Obtenção de lock exclusivo de DDL na tabela `app.request_draft` colidindo com operações de leitura/escrita de outros testes. | A execução de DDL no teste dentro da transação desfeita é breve (poucos milissegundos). Recomenda-se definir `SET LOCAL lock_timeout = '5s'` dentro da transação do teste para falhar rapidamente em caso de contenção. [PROPOSTA] |

---

## 9. Perguntas ao Líder com Alternativas e Recomendação

### Pergunta 800: Estratégia Arquitetural para o Teste de Rollback Frente a Dependentes Posteriores
- **Contexto:** O teste `draft-rollback-h025.dbtest.mjs` tenta executar `drop table if exists app.request_draft;` em um banco DEV que já possui mais de 60 migrações posteriores (H-026, H-030, H-031 etc.) dependendo diretamente dessa tabela.
- **Alternativa A (Recomendada):** Adotar o padrão estabelecido no repositório por `verification-rollback.dbtest.mjs`: validar a idempotência da migração UP, comprovar ativamente a proteção relacional do script DOWN (que recusa a deleção com código `2BP01`), e condicionar o ciclo completo de DROP/reaplicação à ausência de dependentes posteriores, usando `t.skip` com justificativa explícita quando executado no ambiente compartilhado DEV.
- **Alternativa B:** Tentar reverter manualmente todas as migrações posteriores em ordem reversa dentro da transação do teste.
- **Alternativa C:** Alterar o script de rollback `20261111440000_draft_create_request_draft.down.sql` para incluir a cláusula `CASCADE`.
- **Recomendação:** **Alternativa A.** A Alternativa B cria um acoplamento inviável e frágil com mais de 10 histórias subsequentes, quebrando a cada nova migração adicionada ao projeto. A Alternativa C é perigosa e inaceitável em banco de dados, pois destrói silenciosamente tabelas de produção de outras histórias em caso de rollback manual. A Alternativa A segue o precedente já aprovado em QA para a história H-039 (`verification-rollback`).

---

### Pergunta 801: Preservação Estrita do Arquivo de Rollback de Produção sem `CASCADE`
- **Contexto:** O arquivo `supabase/rollbacks/20261111440000_draft_create_request_draft.down.sql` contém a instrução `drop table if exists app.request_draft;`.
- **Alternativa A (Recomendada):** Manter o arquivo `.down.sql` rigorosamente intocado, sem `CASCADE`, confirmando que o objetivo do teste é validar a segurança e a integridade da migração histórica, sem afrouxar proteções relacionais do PostgreSQL.
- **Alternativa B:** Inserir `CASCADE` no arquivo `.down.sql`.
- **Recomendação:** **Alternativa A.** Migrações e rollbacks de histórias já homologadas são imutáveis e não devem sofrer alterações que comprometam a segurança relacional do produto.

---

### Pergunta 802: Validação Ativa da Proteção Relacional (Código 2BP01) como Critério de Aceite
- **Contexto:** Ao tentar rodar o `.down.sql` contra um banco com objetos posteriores, o PostgreSQL gera o erro `2BP01`.
- **Alternativa A (Recomendada):** Incluir no teste uma asserção explícita que comprove que o PostgreSQL dispara o erro `2BP01` ao tentar executar o `.down.sql` na presença de dependentes posteriores. Isso transforma uma falha não tratada em uma prova de segurança relacional ativa.
- **Alternativa B:** Não testar o comportamento do `.down.sql` diante de dependentes, limitando-se a dar `skip` em todo o bloco de rollback caso existam dependentes.
- **Recomendação:** **Alternativa A.** Agrega valor real de garantia de qualidade (QA), comprovando que o banco de dados está devidamente configurado com chaves estrangeiras restritivas que impedem a deleção acidental de dados estruturais.

---

### Pergunta 803: Comprovação Explícita da Idempotência da Migração UP
- **Contexto:** O critério de aceite original D-10 de H-025 exige que a migração seja idempotente (reaplicar sobre banco já migrado não gera erro).
- **Alternativa A (Recomendada):** Incluir um subteste dedicado que execute `await client.query(MIGRACAO)` sobre o banco atual dentro de transação temporária com rollback, validando que comandos `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION` e `CREATE INDEX IF NOT EXISTS` reexecutam de forma 100% limpa.
- **Alternativa B:** Remover a validação de idempotência do arquivo de rollback.
- **Recomendação:** **Alternativa A.** Mantém a conformidade estrita com o critério D-10 da arquitetura de H-025, garantindo que reexecuções de migração (por exemplo em rotinas de deploy contínuo) não quebrem o ambiente.

---

### Pergunta 804: Formato da Mensagem de Commit para o Desenvolvimento
- **Contexto:** O desenvolvimento da Issue #147 implementará a correção exclusivamente em `packages/db/tests/draft-rollback-h025.dbtest.mjs`.
- **Alternativa A (Recomendada):** Adotar o padrão canônico da fábrica: `test(E15): draft-rollback-h025 valida idempotencia, protecao relacional 2BP01 e guarda (#147)`.
- **Alternativa B:** Mensagem genérica `fix(db): corrige teste de rollback h025`.
- **Recomendação:** **Alternativa A.** Assegura rastreabilidade direta com o épico E15 e a Issue #147 no histórico do repositório.

---

## 10. Próximos Passos Sugeridos

1. O líder/Orquestrador adota formalmente as recomendações das **Perguntas 800 a 804**.
2. A Issue #147 avança para a etapa de **Arquitetura (WF-03)**, onde o especialista em Arquitetura elaborará o desenho técnico (`153-DESENHO-DBTEST-147.md`) detalhando a estrutura exata do código de teste a ser implementado.
3. Na etapa de **Desenvolvimento**, o desenvolvedor ajustará o arquivo `packages/db/tests/draft-rollback-h025.dbtest.mjs` aplicando as validações de idempotência, proteção relacional 2BP01 e guarda condicional.
4. Seguem-se as etapas de **Code Review** e **QA (via agy)**, comprovando a saída verde (código 0) e encerrando de forma definitiva a pendência da Issue #147.
