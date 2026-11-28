# 121 — Refino de Product Owner da Issue #151: remover backup, restauração e exportação de dados do escopo

- **Issue:** #151 — [E15] Remover backup, restauração e exportação de dados do escopo do projeto
- **Workflow:** WF-03, etapa Product Owner (refino)
- **Data:** 2026-11-13
- **Origem da decisão:** `docs/factory/11-DECISOES.md`, Rodada 73: backup de dados não faz parte do projeto, em nenhum ambiente, porque nunca foi discutido (decisão do usuário).
- **Natureza desta entrega:** SOMENTE documento. Não foram alterados documentos existentes, o quadro, código, scripts, migrações ou testes. Nenhum comando foi executado contra banco, nenhum dado foi apagado, nenhuma tabela foi criada ou alterada, e o Mapbox não foi chamado.
- **Situação no quadro (verificada em `docs/factory/quadro-status.md`):** #151 está em "Product Owner (2)" (linha 91), na fila. #128 e #145 estão em "Descartado" (linhas 186 e 187). #23 está em "Concluído" (linha 139). #126 e #130 estão em "Backlog" (linhas 73 e 75).

---

## 1. Objetivo

Registrar, de forma rastreável, tudo o que nos documentos ativos trata de backup de dados, restauração de dados e exportação de dados como parte do projeto, e propor para cada ocorrência uma ação: remover, reescrever, ou marcar como superada mantendo o histórico das decisões. Também inventariar, só para leitura, o que já existe em código, scripts, migrações e testes, sem alterar nada, para que o usuário decida depois.

## 2. Escopo e fora de escopo

**Dentro do escopo (desta etapa de refino):**
- Inventário de documentos ativos e de histórico que citam backup, restauração ou exportação de dados.
- Ação proposta por arquivo e seção.
- Impacto nas Issues #128, #145, #126, #130 e #23.
- Inventário somente leitura de código, scripts, migrações e testes de backup.
- Critérios de aceite testáveis (CA-H151-01 em diante), riscos e perguntas ao líder (numeradas a partir de 349).

**Fora de escopo (nesta etapa e nesta Issue de refino):**
- Apagar ou alterar qualquer documento existente. As ações abaixo serão aplicadas na etapa de Desenvolvimento, depois da aprovação deste refino.
- Remover código, scripts (`db:backup`), migrações, papéis de banco (`app_backup_reader`), testes (`backup-roles.dbtest.mjs`, `T-BK-09`, `backup.test.mjs`, `backup-static.test.mjs`) ou arquivos de exportação. Esses itens ficam como estão até decisão do usuário (ver seção 6 e perguntas 351 e 352).
- Qualquer operação contra o banco de desenvolvimento ou de produção, inclusive `npx supabase` e `db:status`.
- Mover cartões no quadro. O líder fará a movimentação.
- Alterar o papel `app_keepalive`, o procedimento de keep-alive, ou o teste de keep-alive. Esses itens não são backup e continuam no escopo do projeto.

## 3. Premissas e fatos verificados

1. A decisão da Rodada 73 retira de 14-BACKLOG, 12-TODO, 08 (§17 e §16.7), 09 (RC-11 e §9), 10-ADRS (ADR-020 e SD-17), 11-ARQ-RISCOS-E-TESTES (R-08, R-17, R-32, D-01) e 17-CHECKLIST as referências a backup, restauração e exportação. Este inventário também encontrou ocorrências em 16-MANIFESTO-ISSUES, 18-PLANO-QA, 19-PLANO-TECNICO-DEV, 13-VERIFICACAO-SERVICOS e 10-RELATORIO-INGESTAO, que a decisão não listou (ver seção 4).
2. A Rodada 73 proíbe nesta etapa apagar dados, criar ou alterar tabelas, e rodar qualquer coisa contra banco. Também determina que o código de backup não é tocado agora.
3. `app_keepalive` e o procedimento de keep-alive (H-010, #23, D-04) não são backup. Continuam no projeto.
4. A migração `supabase/migrations/20261110180000_platform_create_backup_keepalive_roles.sql` cria, no mesmo arquivo, o papel de backup e o papel de keep-alive. Está aplicada e não deve ser editada. Qualquer remoção futura exige migração nova e compensatória, aplicada com `npx supabase`, e não pode derrubar `app_keepalive`.
5. As migrações `20261110190000_platform_default_privileges_backup_reader.sql` e as migrações posteriores listadas na seção 6.2 citam `app_backup_reader` em grants e revokes. Por isso, derrubar o papel sem migração de compensação quebraria a ordem de aplicação. Não é uma ação desta etapa.
6. O inventário de documentos foi feito com a ferramenta de busca do Claude Code (equivalente ao `git grep -i "backup\|restaura\|exporta"` em `docs`), não com `git grep` literal. A lista completa de arquivos com correspondência está na seção 4.5.

---

## 4. Inventário por arquivo e seção (somente documentos)

Legenda das ações: **REMOVER** (apagar a linha ou seção, por ser exclusivamente de backup); **REESCREVER** (manter o item e tirar a parte de backup); **SUPERADO** (manter o texto e marcar como "superado pela Rodada 73", sem apagar, porque é histórico de decisão); **MANTER** (falso positivo ou fato que não é backup de dados); **PERGUNTA** (decisão humana ou jurídica; não agir sem resposta).

### 4.1 Documentos vivos (requisitos, backlog, plano, checklist)

| Arquivo | Linha(s) | Trecho (resumo) | Ação proposta | Observação |
|---|---|---|---|---|
| `14-BACKLOG.md` | 39 | Gate M4: "backup" entre as condições | REESCREVER | Retirar "backup" da lista. Pergunta 356. |
| `14-BACKLOG.md` | 96 | H-010 "Keep-alive diário e backup manual (dump criptografado)"; BK-7 | REESCREVER | Manter só keep-alive (ver 4.1.1). Demais referências a `12-TODO` #1 e ao D-01 saem. |
| `14-BACKLOG.md` | 165 | H-054: condição "backup" do gate de cobrança | REESCREVER | Retirar "backup" da condição. Pergunta 356. |
| `14-BACKLOG.md` | 269 | H-114: "reconciliação pós-restauração (MP e e-mail), periodicidade do backup"; depende de H-010 e H-119 | REESCREVER | Manter runbook de incidente. Tirar "pós-restauração" e "periodicidade do backup". Retirar dependência de H-119. |
| `14-BACKLOG.md` | 279 | H-119: "Restauração de backup..." (RTO ≤ 8 h, D-01, D-02) | REMOVER | História inteira deixa de existir no backlog. Ver impacto na #128. |
| `14-BACKLOG.md` | 281 | H-121: gate de release com "backup" | REESCREVER | Retirar "backup" do checklist. Pergunta 356. |
| `14-BACKLOG.md` | 301 | BLQ-JUR L5 (evidências): "WCAG, testes, backup e observabilidade" | REESCREVER | Retirar "backup". |
| `14-BACKLOG.md` | 341 | BK-7: periodicidade do backup manual | REMOVER | Decisão deixa de existir. |
| `14-BACKLOG.md` | 266 | H-111 (direitos do titular: acesso, correção, eliminação) | MANTER | Não é backup. Ver pergunta 349 (exportação do titular). |
| `12-TODO.md` | 5 (item 1) | Periodicidade do backup manual do Supabase gratuito | REESCREVER | Marcar item como "Removido pela Rodada 73". Não renumerar: a numeração "12-TODO #1" é citada em vários documentos. Pergunta 357. |
| `16-MANIFESTO-ISSUES.md` | 63 | Issue 21 (H-010) "[E0] Keep-alive e backup manual" | REESCREVER | Título passa a "Keep-alive". Referência ao ADR-020 e R-08 fica, sem backup. |
| `16-MANIFESTO-ISSUES.md` | 232 | Issue 125 (H-114) "Objetivo: incidente e pós-restauração"; dependências H-010, H-119 | REESCREVER | Tirar "pós-restauração" e as dependências de H-010 e H-119. |
| `16-MANIFESTO-ISSUES.md` | 242 | "130 \| H-119 \| Teste de restauração de backup" | REMOVER | Ver pergunta 354: o número 130 no manifesto conflita com o quadro (ver 6.1). |
| `18-PLANO-QA.md` | 47 | Nível 15 "Recuperação": restauração de dump sintético e reconciliação de Storage | REMOVER | Linha só de restauração. |
| `18-PLANO-QA.md` | 59 | A4: "sem backup" na lista de limites do Supabase Free | REESCREVER | Manter pausa e limites; tirar "sem backup". Ver pergunta 355. |
| `18-PLANO-QA.md` | 99 | Suíte da MVP em ensaio (M3): "D-01; D-02"; critério "restauração testada" | REESCREVER | Tirar D-01, D-02 e "restauração testada". |
| `18-PLANO-QA.md` | 276 | Critério "Recuperação": D-01 e D-02 com dump restaurado | REMOVER | Linha inteira. |
| `18-PLANO-QA.md` | 292 | L5 Evidências "backup" | REESCREVER | Tirar "backup" e "D-01". |
| `18-PLANO-QA.md` | 302 | TL-3 "Backup manual com periodicidade definida e restauração testada" | REMOVER | Linha inteira. |
| `19-PLANO-TECNICO-DEV.md` | 156 | 0.12 H-010 "[P] keep-alive + backup manual" | REESCREVER | Manter só keep-alive. |
| `19-PLANO-TECNICO-DEV.md` | 207 | Gate M4 (bloqueado): "backup" | REESCREVER | Tirar "backup". Pergunta 356. |
| `19-PLANO-TECNICO-DEV.md` | 462 | V-10 "Supabase Free: pausa em 1 semana e sem backup"; mitigação backup manual, H-119 | REESCREVER | Manter pausa e keep-alive. Tirar "sem backup" e as mitigações de backup e de H-119. |
| `19-PLANO-TECNICO-DEV.md` | 483 | Diretrizes: "BK-7 (b) backup semanal e antes de migração destrutiva" | REMOVER | Diretriz deixa de existir. |
| `19-PLANO-TECNICO-DEV.md` | 285 | "exportando o handler do Express" | MANTER | Falso positivo: exportação de código. |
| `17-CHECKLIST-REVISAO.md` | 131 | B-53: gate de lançamento ignorado "(... backup, tarifas MP ...)" | REESCREVER | Retirar "backup" da lista. Pergunta 356. |
| `17-CHECKLIST-REVISAO.md` | 383 | Gate M4: "Itens de H-054 e H-121: ... backup ..." | REESCREVER | Retirar "backup". Pergunta 356. |
| `08-ARQUITETURA.md` | 470 | §16.7 item 7: Supabase Free "sem backup (recomendado supabase db dump)"; mitigação "backup manual periódico (12-TODO #1)" | REESCREVER | Manter pausa, limites e keep-alive. Tirar a mitigação de backup. Pergunta 355. |
| `08-ARQUITETURA.md` | 478 | Título §17 "Ambientes, migrações, backup e recuperação" | REESCREVER | Novo título: "Ambientes e migrações". |
| `08-ARQUITETURA.md` | 480 | Migrações: "reversão = nova migração compensatória ou restauração" | REESCREVER | Tirar "ou restauração"; ficar só "nova migração compensatória". |
| `08-ARQUITETURA.md` | 481 | "Backup/recuperação (resumo; testes em 11 §9)": RPO, RTO, cópias criptografadas, expurgo e backups, teste trimestral | REMOVER | Parágrafo inteiro. |
| `08-ARQUITETURA.md` | 482 | "Reprocessamento pós-restauração: webhooks do MP e e-mails são reconciliados; jobs são idempotentes" | REESCREVER | Manter só "jobs são idempotentes". Tirar "pós-restauração". |
| `08-ARQUITETURA.md` | 479 | Ambientes: "local (Supabase CLI + Docker ...)" | MANTER | Não é backup. Observação fora de escopo: a regra do projeto diz "não usar Docker". Ver pergunta 358. |
| `08-ARQUITETURA.md` | 18, 31, 38 | Rodada 8 e H3 (backup manual periódico) | SUPERADO | Manter como histórico; acrescentar "superado pela Rodada 73". |
| `08-ARQUITETURA.md` | 238 | "conversas anteriores restauradas se permitido" | MANTER | Falso positivo: restauração de conversa, não de dados. |
| `09-MODELO-DADOS.md` | 229 | Tabela de classes de dados: linha "Backups \| destino de backup \| ... \| RC-11" | REMOVER | Linha inteira. |
| `09-MODELO-DADOS.md` | 244 | RC-11 "Backups: rotação, sobrescrever, [PENDENTE JURÍDICO] L1" | REESCREVER | Marcar "RC-11 removida (Rodada 73)" sem renumerar. Pergunta 357. |
| `09-MODELO-DADOS.md` | 249 | §9 Supabase Free: "sem backup" na lista de limites | REESCREVER | Tirar "sem backup". Pergunta 355. |
| `11-ARQ-RISCOS-E-TESTES.md` | 198 | R-08 "Supabase gratuito: pausa de projeto, sem backup gerenciado (H3 aceito)"; mitigação backup manual | REESCREVER | Manter o risco de perda de dados como risco aceito pelo usuário (Rodada 73), sem mitigação de backup. Pergunta 350. |
| `11-ARQ-RISCOS-E-TESTES.md` | 207 | R-17 "Backup contém dados excluídos" | SUPERADO | Não se aplica sem backup. Manter registro. |
| `11-ARQ-RISCOS-E-TESTES.md` | 222 | R-32 "Backup manual atrasado ou perdido" | SUPERADO | Manter registro. |
| `11-ARQ-RISCOS-E-TESTES.md` | 29 | Resumo de revisão: "R-08/R-10/R-11 revistos ... backup manual" | SUPERADO | Histórico de revisão. |
| `11-ARQ-RISCOS-E-TESTES.md` | 317–318 | §9 Plano de recuperação: RPO (exports semanais) e RTO ≤ 8 h | REMOVER | Metas deixam de existir. |
| `11-ARQ-RISCOS-E-TESTES.md` | 322 | D-01 "Restauração do banco a partir do backup lógico" | REMOVER | |
| `11-ARQ-RISCOS-E-TESTES.md` | 323 | D-02 "Restauração de objetos (Storage)" | REMOVER | |
| `11-ARQ-RISCOS-E-TESTES.md` | 324 | D-03 "Pós-restauração: webhooks e e-mails" | REMOVER | Ver pergunta 349 se parte da reconciliação deve ficar. |
| `11-ARQ-RISCOS-E-TESTES.md` | 325 | D-04 "Projeto pausado/indisponível: retomar, keep-alive" | MANTER | Keep-alive continua. |
| `11-ARQ-RISCOS-E-TESTES.md` | 326–328, 330 | D-05 (migração), D-06 (segredos), D-07 (admin), D-09 (incidente) | MANTER | Não são backup. |
| `11-ARQ-RISCOS-E-TESTES.md` | 329 | D-08 "Exclusão do titular × backups" | REMOVER | Depende de backup. Ver pergunta 349 para o titular. |
| `11-ARQ-RISCOS-E-TESTES.md` | 331 | "Teste de restauração: antes do lançamento e periodicamente" | REMOVER | |
| `10-ADRS.md` | 149 | Bloco de decisão de retenção: "Backups: rotação definida pelo jurídico" | SUPERADO | Manter; a frase perde efeito com a RC-11 removida. |
| `10-ADRS.md` | 194 | ADR-020 "Supabase backups: VERIFICADO sem backup no Free; backup diário só no Pro; recomendado supabase db dump; mitigação backup manual + teste de restauração" | REESCREVER | Manter o fato de plataforma como nota de fornecedor. Mitigação de backup sai. Pergunta 355. |
| `10-ADRS.md` | 203 | ADR-020 "Armazenamento de backup manual (H3)" | SUPERADO | Manter como histórico. |
| `10-ADRS.md` | 217 | ADR-020 §20.1: gatilho obrigatório "(a) backup e recuperação adequados"; "(H3 ... backup manual)" | REESCREVER | Retirar (a) do gatilho e a frase de H3, com a nota "superado pela Rodada 73". Pergunta 356. |
| `10-ADRS.md` | 237 | SD-17 "ADIADA (Rodada 8 nº 18): backup manual (periodicidade, responsável, destino) vai para 12-TODO.md" | SUPERADO | Marcar SD-17 como "superada pela Rodada 73"; não apagar. |
| `10-ADRS.md` | 13, 18, 21, 25, 31 | Notas de rodadas: ADR-020 e backup manual | SUPERADO | Histórico. Não alterar o texto; a nota de rodada nova registra a mudança. |
| `13-VERIFICACAO-SERVICOS.md` | 25, 40, 43 | Fatos de fornecedor: "Supabase (... backup ...)"; "Sem backup no Free" | MANTER | Verificação de fato do fornecedor, não requisito. Ver pergunta 355. |
| `10-RELATORIO-INGESTAO.md` | 88 | L5: "WCAG, testes, backup e observabilidade" | SUPERADO | Relatório histórico de ingestão. |
| `15-RASTREABILIDADE.md` | — | Sem correspondência | MANTER | Sem ação. |

#### 4.1.1 Nota sobre o keep-alive

Os trechos de H-010 (14-BACKLOG 96, 16-MANIFESTO 63, 19-PLANO 156), do Gate (17, 19), de 08 §16.7 e de 11 §9 misturam keep-alive e backup. A ação é sempre tirar só a parte de backup e manter o keep-alive, que é o que o projeto continua fazendo (`app_keepalive`, `packages/db/scripts/keepalive.mjs`, teste `keepalive.test.mjs`).

### 4.2 Documentos de decisão e histórico (não apagar)

| Arquivo | Ação | Motivo |
|---|---|---|
| `11-DECISOES.md` (linhas 58, 375, 383 "decisão 147", 608, 669, 692, 694, 718, 724) | SUPERADO (somente com nova rodada) | Registro append-only. Não editar linhas antigas. A Rodada 73 já registra a decisão. Cada rodada nova que aplicar as remoções deve citar esta #151. |
| `112-TRIAGEM-DBTEST-LINHA-DE-BASE.md`, `111-REFINO-TRIAGEM-DBTEST.md` | SUPERADO | Triagem histórica de `backup-roles.dbtest.mjs` e de `T-BK-09`. Manter. |
| `117-REFINO-REMOCAO-HISTORICO-ACESSO.md`, `118-DESENHO-REMOCAO-HISTORICO-ACESSO.md` | MANTER | Tratam de remover `ops.media_access_daily`, não de backup de dados. Só citam a lista de exceções do backup; a ação é coordenar com a #145, que está em Descartado. |
| `119-REFINO-H119.md` (66 ocorrências) | SUPERADO | Refino de #128 (H-119, restauração). Marcar como "superado pela Rodada 73; #128 removida do escopo". Pergunta 351 para a parte de código. |
| `120-DESENHO-H046.md`, `105-DESENHO-H110.md`, `110-DESENHO-H031.md`, `107-DESENHO-H037.md`, `104-DESENHO-MIDIA-COMPOSICAO.md`, `103-REFINO-H110.md`, `101-DESENHO-H017.md`, `114-DESENHO-H045.md`, `84-REFINO-H120.md`, `82-DESENHO-H109.md`, `79-REFINO-H109.md`, `77-REFINO-H107.md`, `75-DESENHO-H035.md`, `73-REFINO-H108.md`, `68-DESENHO-H021.md`, `62-REFINO-H104.md`, `59-DESENHO-H094.md`, `55-REFINO-H020.md`, `45-REFINO-H012.md`, `46-DESENHO-H012.md`, `39-DESENHO-H011.md`, `40-SPIKE-S09-DESENHO.md`, `33-DESENHO-H016.md`, `31-REFINO-S09.md`, `30-REFINO-S03.md`, `28-DESENHO-H010.md` (40 ocorrências), `27-REFINO-H010.md` (35 ocorrências), `26-REFINO-S08.md`, `24-DESENHO-H008.md`, `23-DESENHO-H006.md`, `22`, `97`, `98`, `99`, `96`, `88` | MANTER com nota | Refinos e desenhos de histórias já feitas. São registro de desenho. Não alterar. Os que tratam de backup (27, 28, 119) recebem nota "superado pela Rodada 73". Os demais citam "backup" só como exceção de tabela ou papel e não precisam de nota, salvo na revisão de código (seção 6). |
| `spikes/S-04-RESULTADO.md`, `spikes/S-08-RESULTADO.md`, `spikes/S-09-RESULTADO.md` | MANTER | Resultados de spike, histórico. |
| `README.md` da pasta factory e `quadro-status.md`, `quadro-dados.js` | MANTER no momento | `quadro-status.md` é a fonte do quadro e só o líder move cards. `quadro-dados.js` tem uma ocorrência e não foi lido nesta etapa: confirmar na etapa de Desenvolvimento. |

### 4.3 Documentos fora da pasta `docs/factory` (produto)

| Arquivo | Linha(s) | Trecho (resumo) | Ação proposta |
|---|---|---|---|
| `README.md` (raiz do repositório) | 92–107 | Seção "Banco de desenvolvimento": keep-alive (consulta de leitura) e "cópias de segurança feitas à mão"; "O que o backup faz"; comandos `alter role app_backup_reader ...` e `alter role app_keepalive ...` | REESCREVER: manter keep-alive e o comando de `app_keepalive`. Remover a parte de backup, de cópia de segurança e de `app_backup_reader`. Não alterar agora, por ser código-fonte de documentação do produto; a alteração entra na etapa de Desenvolvimento. |
| `supabase/README.md` | 62, 67 | Papel `app_backup_reader` e teste `backup-roles.dbtest.mjs` | REESCREVER na etapa de Desenvolvimento, conforme a decisão 351. |
| `.env.example` | (ocorrência sem linha lida) | Possível variável de backup | Conferir na etapa de Desenvolvimento. |
| `.gitignore` | (ocorrência sem linha lida) | Padrões de arquivo de dump (`*.dump`, `*.gpg`, `backups/`) conforme o desenho 28 | MANTER até decisão 351. Padrões de proteção não causam dano. |

### 4.4 Falsos positivos (não tratar como backup)

- `05-CRITERIOS-ACEITE.md` linha 209: "conversas anteriores restauradas" (restauração de conversa no pedido).
- `06-CATALOGO-PROPOSTO.md` linhas 45, 149, 560, 688: "restauração de taco", "restauração de bolsa", "consultoria de importação/exportação" (serviços do catálogo).
- `08-ARQUITETURA.md` linha 238: "restauradas se permitido".
- `19-PLANO-TECNICO-DEV.md` linha 285: "exportando o handler".
- Testes de `D-02b` em `audit.dbtest.mjs` e em outros: o código "D-02b" é um teste de auditoria, não o D-02 do plano de recuperação. Não remover pelo número.

### 4.5 Arquivos com ocorrência fora de `docs` (somente lista)

A busca completa com o termo "backup" achou arquivos em `packages/db/tests`, `packages/domain`, `apps/api/tests`, `apps/web` e `supabase/rollbacks`. A maioria provavelmente cita o papel `app_backup_reader` em listas de revoke ou o termo "exporta" em código comum. Essa classificação ficou para a etapa de inventário de código (seção 6), porque exige leitura de cada arquivo e não foi feita nesta etapa.

---

## 5. Impacto nas Issues

| Issue | Estado no quadro | Impacto | Ação |
|---|---|---|---|
| **#151** | Product Owner (fila) | Esta Issue. Este refino é a entrega da etapa. | Líder move para Arquitetura após leitura. Não mover por conta própria. |
| **#128** (H-119, teste de restauração de backup) | Descartado (removida do escopo, not planned) | Sai do backlog a história inteira. Depende de #126 (suíte de concorrência), mas essa dependência deixa de existir. Os 17 critérios do refino 119 e as perguntas 333 a 342 perdem efeito, conforme a Rodada 73. | Nenhuma ação extra no quadro. Refino 119 marcado como superado. |
| **#145** (media_asset fora do backup, T-BK-09) | Descartado (removida do escopo) | A falha T-BK-09 deixa de ser "falha conhecida com Issue". Passa a depender da decisão 351/352 sobre o código de backup. Hoje o `db:test` continua reprovando esse teste. | Registrar na Issue de código, quando houver. |
| **#126** (suíte de concorrência e falha) | Backlog | Perde a dependência de #128. Não há referência a backup no texto da Issue encontrado nos documentos ativos. | Nenhuma alteração de conteúdo. Verificar no GitHub na etapa de Arquitetura. |
| **#130** (Gate de release do MVP web, pelo quadro) | Backlog | O gate cita "backup" (H-121, B-53, Gate M4). Com a decisão, a condição sai do gate. Pergunta 354 sobre o número. | Retirar "backup" do gate, com decisão do usuário (pergunta 356). |
| **#23** (keep-alive e backup manual, H-010) | Concluído | A entrega existente inclui `backup.mjs`, papel `app_backup_reader` e testes. O keep-alive continua válido. Concluído é decisão humana e não deve ser reaberto automaticamente. | Não reabrir. A parte de backup vira código a remover, na Issue de código (pergunta 353). |

### 5.1 Dependências a retirar nos documentos

- H-114 depende de H-010 e H-119 (14-BACKLOG linha 269). H-119 sai. H-010 continua só para keep-alive.
- H-054 depende de H-010 (linha 165). Depois da remoção, a dependência fica só com o keep-alive, se a condição sobreviver.
- Em 16-MANIFESTO linhas 232 e 242 há dependências de H-119. Retirar.

---

## 6. Inventário somente leitura: código, scripts, migrações e testes

Nenhum item abaixo foi alterado. Recomendação para todos: **deixar como está até o usuário decidir** (perguntas 351 e 352).

### 6.1 Itens confirmados por busca

| Item | Local | Situação | Recomendação |
|---|---|---|---|
| Script `db:backup` | `package.json` linha 23: `node packages/db/scripts/backup.mjs` | Existe | Deixar. Remover junto com o script, na Issue de código. |
| Script de backup | `packages/db/scripts/backup.mjs` | Existe | Deixar. |
| Biblioteca de backup | `packages/db/scripts/lib/backup.mjs` | Existe | Deixar. |
| Biblioteca de exportação | `packages/db/scripts/lib/export.mjs` | Existe | Deixar. Conferir se é usada só pelo backup antes de remover. |
| Testes de backup | `packages/db/tests/backup.test.mjs`, `packages/db/tests/backup-static.test.mjs` | Existem | Deixar. |
| Teste de papéis | `packages/db/tests/backup-roles.dbtest.mjs` | Existe. Inclui `T-BK-09` (falha com `app.media_asset`, #145), `T-BK-11` e `T-KA-02` (keep-alive) | Deixar. Ao remover, separar o teste de keep-alive antes; não apagar o arquivo inteiro. |
| Papel `app_backup_reader` e grants | Migração `supabase/migrations/20261110190000_platform_default_privileges_backup_reader.sql` e migrações `20261110180000`, `20261111370000`, `20261111440000`, `20261112120000`, `20261112120500`, `20261112160000`, `20261112190000`, `20261112220000`, `20261112230000` (listadas pela busca) | Existem e estão aplicadas | Não editar migrações aplicadas. Qualquer remoção do papel exige migração nova e compensatória, aplicada com `npx supabase`. |
| Papel `app_keepalive` | Mesma migração `20261110180000` | Existe | Manter. |
| Keep-alive | `packages/db/scripts/keepalive.mjs`, `packages/db/scripts/lib/keepalive.mjs`, `packages/db/tests/keepalive.test.mjs` | Existem | Manter. Não é backup. |
| Decisão 147 | `11-DECISOES.md` linha 383: papel de backup não lê `professional_area`, `professional_area_history` e `professional_service`; "o procedimento de backup deve tratar essas tabelas" | Registro histórico | Não editar. Com a remoção do backup, a decisão 147 perde efeito. Registrar nova rodada quando a remoção for aprovada. |
| Exceções do backup | `backup-roles.dbtest.mjs` (lista de exceções, incluindo `ops.media_access_daily` e `app.identity_document`, conforme 112 e 117) | Existe | Decidir junto com a remoção (pergunta 352). |

### 6.2 Riscos de remoção de código (para a Issue futura)

- Derrubar `app_backup_reader` sem migração de compensação quebra a ordem das migrações que dão grants e revokes a esse papel.
- `20261110180000` cria backup e keep-alive juntos: a remoção não pode tirar `app_keepalive`.
- `backup-roles.dbtest.mjs` tem `T-KA-02` (keep-alive). Apagar o arquivo derruba o teste de keep-alive.
- `T-BK-09` falha hoje. Se o teste for removido sem decisão, o `db:test` fica verde por apagamento, não por correção. Essa decisão precisa ser explícita (pergunta 352).

---

## 7. Critérios de aceite (testáveis)

Os critérios valem para a etapa de Desenvolvimento que aplicar esta decisão. Para este refino, a verificação é a conferência do próprio documento e do inventário.

- **CA-H151-01.** Dado o conjunto de documentos ativos (`docs/factory/*.md` fora de histórico, e `README.md` da raiz), quando se roda `git grep -n -i "backup" -- docs README.md`, então toda ocorrência restante aparece na lista de exceções desta etapa (seção 4.2, 4.3 e 4.4), com motivo escrito. Teste: comparar o resultado com a seção 4.
- **CA-H151-02.** Dado `14-BACKLOG.md`, quando lido, então H-119 não existe mais; BK-7 não existe mais; H-010 aparece somente como keep-alive; H-114, H-054 e H-121 não citam backup; H-111 continua igual.
- **CA-H151-03.** Dado `12-TODO.md`, quando lido, então o item 1 aparece com a marca "Removido pela Rodada 73" e os demais itens conservam o mesmo número.
- **CA-H151-04.** Dado `08-ARQUITETURA.md`, quando lido, então o §17 não tem o título "backup e recuperação", não tem RPO, RTO nem o parágrafo "Backup/recuperação"; o §16.7 não cita backup como mitigação; a frase "ou restauração" não aparece em §17.
- **CA-H151-05.** Dado `09-MODELO-DADOS.md`, quando lido, então a tabela de classes não tem a linha "Backups"; RC-11 aparece como "removida (Rodada 73)" e os demais números de classe não mudam; §9 não cita "sem backup".
- **CA-H151-06.** Dado `10-ADRS.md`, quando lido, então ADR-020 não cita backup como mitigação nem como gatilho; SD-17 está marcada como "superada pela Rodada 73" e o texto original continua presente.
- **CA-H151-07.** Dado `11-ARQ-RISCOS-E-TESTES.md`, quando lido, então §9 não tem RPO, RTO, D-01, D-02, D-03 (parte de restauração), D-08 nem a linha de teste de restauração; D-04 (keep-alive) e D-05 a D-07 e D-09 permanecem; R-08 descreve o risco aceito pelo usuário, sem mitigação de backup; R-17 e R-32 aparecem como superados.
- **CA-H151-08.** Dado `17-CHECKLIST-REVISAO.md`, quando lido, então B-53 e a linha Gate M4 não citam "backup".
- **CA-H151-09.** Dado `16-MANIFESTO-ISSUES.md`, `18-PLANO-QA.md` e `19-PLANO-TECNICO-DEV.md`, quando lidos, então não há linha de backup ou restauração como requisito, critério ou gate; as linhas de keep-alive permanecem.
- **CA-H151-10.** Dado o `README.md` da raiz e `supabase/README.md`, quando lidos, então não há seção de "cópia de segurança" nem instrução de `app_backup_reader`, e a instrução de `app_keepalive` continua.
- **CA-H151-11.** Dado o diff da etapa de Desenvolvimento, quando conferido com `git diff --name-only`, então nenhum arquivo de `packages/`, `apps/`, `supabase/`, nem `package.json` foi alterado nesta Issue (o código de backup fica para a decisão 351).
- **CA-H151-12.** Dado o registro da etapa, quando conferido, então não há evidência de comando contra banco, de criação ou alteração de tabela, nem de chamada ao Mapbox.
- **CA-H151-13.** Dado o quadro, quando conferido, então #128 e #145 continuam em Descartado; #23 continua em Concluído sem reabertura; #126 e #130 não foram movidas por esta etapa.
- **CA-H151-14.** Dado H-111 e RF-140, quando lidos, então continuam iguais, enquanto a pergunta 349 não for respondida.
- **CA-H151-15.** Dado o keep-alive (H-010 parte keep-alive, D-04, `app_keepalive`), quando conferido, então continua descrito e sem alteração de comportamento.
- **CA-H151-16.** Dado qualquer documento de histórico que cite backup (11-DECISOES, 10-ADRS, 112, 119 e refinos), quando lido, então o texto original continua presente; somente foi acrescentada a marca de superação com referência à Rodada 73 e à #151.

---

## 8. Riscos

- **R-151-01 — Perda de dados sem backup.** O projeto continua no plano gratuito do Supabase, que não tem backup. A remoção pode apagar a percepção de risco. Mitigação: registrar o risco como aceito pelo usuário na Rodada 73 (pergunta 350), em R-08 e no ADR-020.
- **R-151-02 — Código de backup segue ativo.** `db:backup`, o papel `app_backup_reader` e os testes continuam existindo até a Issue de código. Mitigação: pergunta 351 e Issue própria.
- **R-151-03 — Remoção do papel quebra migrações.** Ver 6.2. Mitigação: nunca editar migração aplicada; migração compensatória com `npx supabase`.
- **R-151-04 — Keep-alive removido por engano.** A migração `20261110180000` cria os dois papéis. Mitigação: CA-H151-15 e revisão do diff.
- **R-151-05 — Teste de restauração removido sem decisão.** `T-BK-09` pode ser apagado para ficar verde. Mitigação: pergunta 352 e CA-H151-11.
- **R-151-06 — Remoção excessiva por busca.** Termos como "restaurada", "exportação" e "exporta" aparecem em textos que não são backup. Mitigação: seção 4.4 e CA-H151-01.
- **R-151-07 — Gate mais fácil de cumprir.** Tirar "backup" dos gates de lançamento e cobrança reduz as condições de lançamento. Mitigação: confirmação explícita do usuário (pergunta 356) e registro na rodada que aprovar.
- **R-151-08 — Exportação do titular confundida com backup.** A LGPD prevê direitos do titular (acesso, correção, eliminação e, em outros casos, portabilidade). Esses direitos não são backup e não podem sair do projeto por esta Issue. Mitigação: pergunta 349 e CA-H151-14.
- **R-151-09 — Número da #130 divergente.** O manifesto diz 130 = H-119 (teste de restauração); o quadro diz 130 = Gate de release, e 128 = teste de restauração. Mitigação: pergunta 354, verificação no GitHub pelo líder.
- **R-151-10 — Observação fora de escopo.** 08 §17 cita Docker como ambiente, contra a regra do projeto. Não tratar nesta Issue. Pergunta 358.

---

## 9. Perguntas ao líder (numeração contínua a partir de 349)

Todas as perguntas são para o líder, que as consolida. Não são para o usuário, salvo quando indicado. Cada uma traz a recomendação.

- **349. Exportação e acesso do titular (LGPD).** A #151 diz "exportação de dados". Os documentos têm só `dsr_case` com acesso, correção e eliminação (H-111, RF-140, 09 §3.8). Não há "portabilidade" nos documentos. *Alternativas:* (a) a #151 remove apenas backup e exportação de cópia do banco; direitos do titular ficam; (b) a #151 remove também a exportação ao titular. *Recomendação:* (a). Direitos do titular não são backup e dependem de análise jurídica (L1, L2). Esta decisão destrava CA-H151-14 e a eventual revisão do D-03.
- **350. Aceite do risco de perda de dados.** *Alternativas:* (a) manter R-08 reescrito como risco aceito pelo usuário, sem mitigação de backup; (b) remover R-08 por completo. *Recomendação:* (a), porque a perda sem backup continua real no plano gratuito e precisa constar no registro. Pergunta direcionada ao usuário apenas se o líder não encontrar o aceite já registrado na Rodada 73.
- **351. Código de backup.** Remover `db:backup`, `backup.mjs`, `lib/backup.mjs`, `lib/export.mjs`, os testes de backup, o papel `app_backup_reader` (via migração compensatória) e os grants. *Alternativas:* (a) Issue de código própria, depois do aval do PO, mantendo `app_keepalive`; (b) deixar o código até nova decisão. *Recomendação:* (a), em Issue separada, sem tocar migrações aplicadas.
- **352. Teste T-BK-09 e exceções.** *Alternativas:* (a) remover o teste junto com o código (apenas o teste de backup, preservando `T-KA-02`); (b) manter o teste até a Issue de código. *Recomendação:* (a), na mesma Issue da pergunta 351, sem fazer o `db:test` passar por apagamento sem registro.
- **353. Reabrir #23?** #23 está em Concluído, com keep-alive e backup. *Alternativas:* (a) não reabrir; a parte de backup vira Issue de código (pergunta 351); (b) reabrir. *Recomendação:* (a). Concluído é decisão humana e o keep-alive segue válido.
- **354. Número da #130.** O manifesto diz "130 = H-119 (teste de restauração)", mas o quadro tem #128 como teste de restauração e #130 como Gate de release. *Recomendação:* o líder confere no GitHub antes de editar 14-BACKLOG e 16-MANIFESTO. Não é pergunta ao usuário.
- **355. "Sem backup" nas listas de limites do Supabase Free.** Aparece em 08, 09, 10-ADRS, 13, 18 e 19. *Alternativas:* (a) tirar das listas de requisitos e manter como fato de fornecedor em 13; (b) tirar de todos os documentos. *Recomendação:* (a).
- **356. Gates de lançamento e cobrança sem backup.** A condição "backup" sai de H-054, H-121, B-53, Gate M4, ADR-020 §20.1 e da linha do gate (#130). *Alternativas:* (a) retirar a condição; (b) manter a condição com a nota de que não é mais exigida pelo projeto. *Recomendação:* (a), desde que o usuário confirme. Pergunta ao usuário somente se a confirmação não estiver na Rodada 73.
- **357. Numeração preservada.** Itens removidos (12-TODO #1, RC-11, D-01 a D-03, D-08, H-119) ficam marcados e não são renumerados. *Recomendação:* não renumerar, porque há referências cruzadas em vários documentos.
- **358. Docker em 08 §17.** Conflita com a regra do projeto (não usar Docker). *Alternativas:* (a) tratar em Issue própria de documentação; (b) corrigir junto com esta #151. *Recomendação:* (a), para não misturar escopos. Encaminhar ao Architect.

---

## 10. Próximo passo sugerido (para o líder)

1. Confirmar a #130 no GitHub (pergunta 354) e as perguntas 349 a 358.
2. Após as respostas, mover #151 para Arquitetura, respeitando a ordem de colunas.
3. Na etapa de Desenvolvimento, aplicar as ações da seção 4 apenas em documentos (CA-H151-01 a CA-H151-10 e CA-H151-12 a CA-H151-16), sem tocar código, migrações ou testes (CA-H151-11).
4. Abrir Issue própria para o código de backup (pergunta 351), sem reabrir #23.
