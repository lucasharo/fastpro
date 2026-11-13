# Refino H-119 — Teste de restauração de backup (Issue #128)

> [SUPERADO em parte — Rodada 73/75, #151] A parte de backup/restauração deste documento saiu do escopo (#128 removida do escopo); o keep-alive continua válido. Texto original abaixo mantido.

- **Issue:** #128 `[E15] Teste de restauração de backup` · **História:** H-119 · **Workflow:** WF-03 (Feature/infra) · **Etapa:** Product Owner.
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-13.
- **EXEC-ID:** não atribuído (não informado pelo líder).
- **Natureza:** somente documento. Nenhum código, migração, teste, banco ou alteração no quadro. O cartão permanece em Product Owner até o líder decidir a movimentação.
- **Etiquetas:** `[DECIDIDO]` decisão do dono ou do líder, com número · `[VERIFICADO]` lido no repositório ou no quadro · `[PROPOSTA]` deste refino, a validar · `[AMBIGUIDADE]` fonte conflitante ou lacuna · `[NÃO VERIFICADO]` não confirmado nesta rodada.

---

## 0. Fontes e limitações

Fontes lidas: `D:\Fabrica\AGENTS.md`, `roles/factory-product-owner.md`, `docs/factory/quadro-status.md`, `21-ISSUES-CRIADAS.md`, `14-BACKLOG.md` (linha H-119, H-010, H-114, H-121, BK-7), `16-MANIFESTO-ISSUES.md` (linha 130), `04-PRD.md` e `05-CRITERIOS-ACEITE.md` (busca por backup, restauração, RPO, RTO: sem resultado), `11-ARQ-RISCOS-E-TESTES.md` §9 (D-01 a D-09), `08-ARQUITETURA.md` §17 e `09-MODELO-DADOS.md` (busca), `10-ADRS.md` (linhas sobre backup), `15-RASTREABILIDADE.md` (linha 280), `18-PLANO-QA.md` (linhas 47, 99, 276, 302), `11-DECISOES.md` (decisões 147, 332 e rodadas 69 e 70), `112-TRIAGEM-DBTEST-LINHA-DE-BASE.md` (item #145), `packages/db/scripts/backup.mjs` (cabeçalho e `doExport`), `packages/db/scripts/lib/backup.mjs` e `packages/db/tests/backup*.mjs` (nomes dos testes), e o modelo `113-REFINO-H045.md`.

Limitações `[NÃO VERIFICADO]`:
- O texto da Issue #128 no GitHub não foi lido. O objetivo foi reconstruído da linha H-119 do backlog e do manifesto. O líder deve conferir o texto da Issue antes da Arquitetura.
- Não foram executados testes, `db:backup`, nem consulta ao banco de desenvolvimento. O estado real do backup de referência e do destino de restauração não foi conferido.
- O formato exato do texto claro exportado (`FORMAT` em `lib/export.mjs`) e a lista de monitores I-xx executáveis em SQL não foram lidos. Ficam para a Arquitetura.
- Os requisitos de backup e recuperação não têm RF nem FA em `04-PRD.md` e `05-CRITERIOS-ACEITE.md`. A origem é `11` §9 (D-01 a D-09), `08` §17 e `18-PLANO-QA` (TL-3). Ver ambiguidade A-1.

## 1. Verificação de fila

- `[VERIFICADO]` Quadro: #128 está em "Product Owner (2)". É a única Issue da coluna desta história. Não há Issue em "Aguardando aprovação" (0).
- `[VERIFICADO]` Mapeamento H-119 → #128 em `21-ISSUES-CRIADAS.md` (linha 134) e `16-MANIFESTO-ISSUES.md` (linha 242).
- `[VERIFICADO]` Última decisão registrada: 332 (rodada 69). As perguntas deste refino começam em 333.
- `[VERIFICADO]` Dependências declaradas de H-119 no backlog: H-010 (#23), H-003 (#16) e H-117 (#126). Estado no quadro: #23 **Concluído**; #16 **Concluído**; #126 **Backlog**. Ver seção 8.

## 2. Objetivo

Provar que o backup manual de dados do banco de desenvolvimento (H-010) serve para recuperar o banco: restaurar o último export em um ambiente limpo, aplicar o esquema, comparar as contagens com o manifesto, rodar os monitores de invariantes e medir o tempo, para checar se a meta de recuperação (RTO) é cumprida.

Resultado de negócio: antes de dados reais ou pagamentos (`10-ADRS` linha "Supabase backups": "antes de dados reais ou pagamentos"), o time sabe se consegue voltar de uma perda. H-114 (runbook de recuperação) e H-121 (gate de release) dependem deste resultado.

## 3. Escopo (dentro de H-119)

1. Pré-requisito: escolher um backup de referência (`.dados.gpg` e `.manifest.json`) e verificá-lo com o comando já existente de verificação (`db:backup -- verify <manifesto>`).
2. Preparar um destino de restauração limpo e isolado (alvo na pergunta 333).
3. Aplicar o esquema pelas migrações do repositório, até a versão registrada no manifesto (pergunta 334).
4. Decifrar o export em fluxo e carregar os dados no destino, sem gravar texto claro em arquivo.
5. Conferir contagens por tabela com o manifesto e listar as tabelas excluídas do backup como lacuna declarada.
6. Rodar os monitores de invariantes I-xx no destino (lista na pergunta 335).
7. Registrar o tempo total e a idade do backup (RPO efetivo) e comparar com a meta.
8. Remover o destino temporário ao fim e registrar a remoção.
9. Registrar o resultado como evidência na Issue (comando, contagem, código de saída), sem valores de conexão.

## 4. Fora de escopo

- Qualquer uso de Docker. Não é usado nem sugerido.
- Restauração em produção, ou em qualquer banco que não seja o alvo temporário escolhido. Nenhum banco de produção é tocado.
- Escrita no banco de desenvolvimento pela restauração. Ele serve só de origem de leitura, se necessário.
- Criação, alteração ou rotação de backup automático. O backup segue manual (H-010, BK-7).
- Restauração de objetos do Storage (D-02), salvo decisão da pergunta 336.
- Reconciliação com Mercado Pago e reenvio de e-mails pós-restauração (D-03). É H-114 e H-053.
- Procedimento de exclusão do titular × backups (D-08, `[PENDENTE JURÍDICO]`).
- Alteração de migrações antigas, do papel `app_backup_reader` ou do `backup.mjs`, salvo se a própria história pedir por decisão própria.
- Envio de e-mail e qualquer chamada externa, exceto a criação de projeto de teste se a pergunta 333 escolher essa opção.

## 5. Fluxo do teste de restauração

Ator: o dono (ou o operador autorizado) executa localmente. A história não automatiza a senha.

1. **Preflight.** Confirma que o backup de referência existe, que o manifesto é legível e que `db:backup -- verify <manifesto>` sai com código 0. Se falhar, para. Nada é restaurado.
2. **Alvo.** Confirma que o destino é o alvo temporário escolhido, que está vazio e que sua identidade confere com a referência esperada. Recusa qualquer endereço que seja o banco de desenvolvimento ou de produção.
3. **Esquema.** Aplica as migrações do repositório até a versão do manifesto. Confirma migrações pendentes = 0.
4. **Dados.** Decifra o `.dados.gpg` pela frase-senha fornecida no momento (sem gravá-la) e carrega no destino, em fluxo, sem texto claro em arquivo.
5. **Conferência.** Compara contagens por tabela com o manifesto. Lista as tabelas excluídas do backup como lacuna declarada.
6. **Invariantes.** Roda os monitores I-xx no destino. Qualquer violação reprova o teste.
7. **Tempo e RPO.** Registra início e fim (UTC), tempo total e idade do backup de referência.
8. **Limpeza.** Remove o destino temporário (ou o projeto de teste) e confirma que não existe mais.
9. **Evidência.** Publica na Issue: comandos, contagens, códigos de saída, tempo, RPO efetivo, lacunas e monitores. Nenhum valor de conexão, senha ou frase.

Em qualquer falha, o fluxo para na etapa que falhou, registra a etapa, faz a limpeza e não declara restauração bem-sucedida.

## 6. Regras e invariantes

| Ref. | Regra | Fonte | Como H-119 atende |
|---|---|---|---|
| RN-H119-01 | Restauração em ambiente limpo, nunca sobre dados existentes | `11` §9 D-01 "ambiente limpo" | CA-H119-04 |
| RN-H119-02 | Critério de sucesso: invariantes sem violação e tempo ≤ RTO | `11` §9 D-01 | CA-H119-07, CA-H119-08 |
| RN-H119-03 | RPO = intervalo entre exports; RTO ≤ 8 h, provisório | `11` §9 (texto); `09` §9 | CA-H119-08, CA-H119-09; pergunta 342 |
| RN-H119-04 | Frase-senha nunca fica em arquivo; export cifrado com AES256 | `backup.mjs` (cabeçalho, `doExport`); `lib/backup.mjs` (`cifra`) | CA-H119-10 |
| RN-H119-05 | Papel de backup é só leitura | Decisão 147; `backup-roles.dbtest.mjs` (T-BK-09, T-BK-11) | Não alterado por H-119 |
| RN-H119-06 | Teste de migração contra cópia sintética | `08` §17 | CA-H119-05 (esquema por migrações) |
| RN-H119-07 | Sem Docker; execução local e evidência na Issue | `AGENTS.md`; `CLAUDE.md` do projeto | CA-H119-11 |
| RN-H119-08 | Dados de teste sintéticos e marcados | `11` §9b; `111` R6 | Restauração usa só dados sintéticos do DEV |

## 7. Critérios de aceite (testáveis)

Todos rodam localmente. A evidência é o comando, a contagem e o código de saída, publicados na Issue.

- **CA-H119-01 (pré-requisito).** Dado um backup de referência, quando `db:backup -- verify <manifesto>` roda antes de qualquer restauração, então sai com código 0. Prova: saída e código de saída. Se sair diferente de 0, o teste não começa.
- **CA-H119-02 (cifrado alterado).** Dado uma cópia do `.dados.gpg` com um byte trocado, quando a verificação roda, então falha e a restauração não inicia. Prova: reaproveita o caso T-BK-04 (`backup.test.mjs`) e registra a execução. `[PROPOSTA]`.
- **CA-H119-03 (alvo isolado).** Dado um destino com identidade diferente da esperada, ou que seja o banco de desenvolvimento ou de produção, quando a restauração começa, então recusa antes de gravar, sem flag de força. Prova: três tentativas recusadas (identidade errada, destino de desenvolvimento, destino de produção simulado por URL inválida). Não se conecta a produção para provar.
- **CA-H119-04 (destino limpo).** Dado um destino que já tem tabelas de domínio com linhas, quando a restauração começa, então recusa. Prova: tentativa recusada e contagem inalterada.
- **CA-H119-05 (esquema).** Após as migrações, o destino tem migrações pendentes = 0 e a versão aplicada é a do manifesto. Prova: `db:migrate -- status` com contagem zero de pendentes. A ordem (esquema antes ou depois dos dados) depende da pergunta 334.
- **CA-H119-06 (contagens).** Para cada tabela restaurada, a contagem no destino é igual à do manifesto (divergência zero). Tabelas excluídas do backup aparecem no relatório como lacuna declarada, nunca como sucesso. Prova: relatório de contagens com total de divergências = 0 e lista de lacunas.
- **CA-H119-07 (invariantes).** Todos os monitores I-xx da lista da pergunta 335 rodam no destino sem violação. Prova: saída por monitor. Se algum monitor não puder rodar no destino, a história registra a causa; não conta como passou.
- **CA-H119-08 (tempo e RTO).** Início e fim são registrados em UTC, e o tempo total fica ≤ 8 h `[PROPOSTA]` (pergunta 342). Prova: duas marcas de tempo e o cálculo na Issue.
- **CA-H119-09 (RPO efetivo).** A idade do backup de referência é registrada e comparada com a periodicidade decidida (pergunta 339). Prova: linha no relatório com a idade e a periodicidade.
- **CA-H119-10 (sem segredo).** Nem a URL de conexão, nem a senha, nem a frase-senha aparecem em saída, log, relatório ou arquivo. A decifragem é em fluxo, sem arquivo de texto claro. Prova: teste estático de padrões e busca por uma sentinela em toda a saída. `[PROPOSTA]`, nos moldes de `backup-static.test.mjs`.
- **CA-H119-11 (local e sem Docker).** A execução é local, sem Docker e sem CI. Prova: linha de execução na Issue com comando, contagem e código de saída.
- **CA-H119-12 (limpeza).** Ao fim, o destino temporário não existe mais. Se a limpeza falhar, o relatório registra o que sobrou. Prova: consulta de existência após a limpeza.
- **CA-H119-13 (desenvolvimento intacto).** A restauração não altera nenhuma linha do banco de desenvolvimento. Prova: contagem de linhas nas tabelas de domínio antes e depois, iguais.
- **CA-H119-14 (falha não promove).** Se qualquer etapa falha, o teste sai com código diferente de 0, registra a etapa e não declara restauração feita. Prova: caso 3 do CA-H119-03 e uma falha provocada na etapa de dados (em destino descartável).
- **CA-H119-15 (Storage, condicional).** Se a pergunta 336 for (a), o relatório declara D-02 como "não coberto nesta história". Se for (b), vale a reconciliação de `media_asset` × objetos. Prova: linha no relatório.
- **CA-H119-16 (`media_asset`, condicional).** Se a pergunta 337 não estiver decidida, o relatório declara `media_asset` como fora do backup. Se decidida em (b), a contagem e a reconciliação incluem `media_asset`. Prova: relatório. Este critério bloqueia o fechamento da história até a decisão.
- **CA-H119-17 (escopo do diff).** A entrega toca apenas scripts de teste, documentação de evidência e, se necessário, o procedimento. Não altera migrações existentes, nem o papel `app_backup_reader`, nem o quadro. Prova: lista de arquivos alterados na Issue.

## 8. Dependências

- **H-010 (#23)** — `Concluído` no quadro `[VERIFICADO]`. Entrega `packages/db/scripts/backup.mjs`, `lib/backup.mjs` e `lib/export.mjs` (cifra `gpg --symmetric --cipher-algo AES256`, manifesto com hashes e contagens, comando `verify`). Papel `app_backup_reader` por migrações `20261110180000` e `20261110190000`. Testes: `backup.test.mjs`, `backup-static.test.mjs`, `backup-roles.dbtest.mjs` (T-BK-09, T-BK-11, T-KA-02). **Não rodados nesta rodada** `[NÃO VERIFICADO]`.
- **H-003 (#16)** — `Concluído` `[VERIFICADO]`. Ambiente local e migrações versionadas.
- **H-117 (#126)** — `Backlog` `[VERIFICADO]`. Dependência **declarada** no backlog (linha 279). **Bloqueia o início** pela regra de não iniciar história que depende de outra não concluída. A razão técnica não está escrita, e o teste de restauração não parece usar a suíte de concorrência. Pergunta 338.
- **#145 (`media_asset` fora do backup)** — `Backlog` `[VERIFICADO]`. Não está na lista de dependências do backlog, mas **bloqueia parcialmente** o escopo: D-02 e a contagem de `media_asset` não fecham sem decisão (CA-H119-15 e CA-H119-16). Pergunta 337. Detalhe: a migração `20261112120000` revogou o papel de leitura de `app.media_asset`, e nenhuma decisão aceita essa exclusão (decisão 147 cobre só três tabelas de profissional) `[VERIFICADO em 112-TRIAGEM-DBTEST-LINHA-DE-BASE.md, item #145]`.
- **#150 (remoção de `ops.media_access_daily`)** — estado no quadro `[NÃO VERIFICADO]` nesta rodada. A decisão 69 diz "Desenvolvimento". Essa remoção altera a lista de exceções do backup (a tabela deixa de existir). A lista da restauração deve ser lida depois da #150.
- **#140 (triagem do db:test no DEV)** — `Desenvolvimento` `[VERIFICADO]`. Não é dependência formal. Risco de concorrência: `111` R-DEV-1 proíbe testes que escrevem no DEV junto com outro agente. A restauração só lê o DEV (CA-H119-13), mas a execução deve ser combinada com o líder.
- **Consumidores que aguardam H-119:** H-114 (#123, runbook de recuperação) e H-121 (#130, gate de release). `[VERIFICADO]` em `14-BACKLOG` (linhas 269 e 281).
- **Ondas** `[AMBIGUIDADE]`: H-119 está na Onda 5 `[VERIFICADO]`. Mesma dúvida de ordem de ondas da H-045 (decisão 278), mas aqui a dependência formal é H-117 (ainda no Backlog). Pergunta 338 cobre as duas.

## 9. Riscos

- **R1. Alvo de restauração.** O plano Free tem limite de 2 projetos ativos (`10-ADRS`, `09` §9). Um projeto temporário pode esbarrar nesse limite `[NÃO VERIFICADO]`. Mitigação: pergunta 333; alternativa de restauração só em arquivo, com menos prova.
- **R2. Frase-senha na execução.** O export usa `gpg` com frase-senha. O teste precisa dela no momento, sem gravá-la. Automação exigiria guardar o segredo, o que a fábrica não aceita. Mitigação: execução guiada pelo dono (pergunta 340).
- **R3. Storage fora do backup.** O export de H-010 é de dados. Objetos do Storage não estão no escopo de H-010. D-02 pode não ter o que restaurar. Mitigação: pergunta 336.
- **R4. `media_asset` fora do backup.** Sem a tabela, D-02 não reconcilia nada. Mitigação: pergunta 337 e #145.
- **R5. Lacunas de tabelas.** A decisão 147 diz que "o procedimento de backup (TODO 1) deve tratar essas tabelas" (localização do profissional). O teste de restauração precisa dizer como trata as lacunas, e a palavra "tratar" é ambígua. Pergunta 341.
- **R6. Lista de exceções em mudança.** #150 remove `ops.media_access_daily`; a lista de `identity_document` e outras pode mudar com #140 e #145. Mitigação: ler a lista atual no início da execução e registrar a versão usada.
- **R7. Meta não medida.** RPO e RTO são `[PROPOSTA]` e não foram medidos (`11` §9 diz isso). O teste vai medir, mas a meta pode mudar depois do primeiro resultado. Pergunta 342.
- **R8. Dados sintéticos apenas.** O banco de desenvolvimento tem dados sintéticos. O teste prova o caminho, não o volume real. Não é possível medir o tempo para o volume de produção.
- **R9. Backup do Supabase Free não é prova.** O plano Free não tem backup nativo (`10-ADRS`). O teste prova só o export manual, não o backup da plataforma.
- **R10. Concorrência com db:test.** Ver #140 em seção 8.

## 10. Ambiguidades

- **A-1. Origem dos requisitos.** Não há RF nem FA de backup e recuperação em `04-PRD` e `05-CRITERIOS-ACEITE`. A fonte é `11` §9 (D-01 a D-09), `08` §17, `09` §9 e `18-PLANO-QA` (TL-3: "restauração testada antes do M4"; linha 99: "restauração testada com dados sintéticos" como condição do M3). Recomendação: a Arquitetura registra a origem; o PO não cria RF novo sem decisão. `[AMBIGUIDADE]`.
- **A-2. Ordem entre esquema e dados.** D-01 diz "restaurar dump, aplicar migrações". O export é só de dados, então o esquema tem de vir das migrações. Pergunta 334.
- **A-3. Monitores I-xx.** `11` §9 cita "monitores I-xx" sem listar quais são executáveis em SQL no destino. Pergunta 335.
- **A-4. Periodicidade e RPO.** `14-BACKLOG` BK-7 está pendente. A recomendação (b) é semanal e antes de migração destrutiva. Pergunta 339.
- **A-5. Papel de `media_asset`.** Ver #145 e pergunta 337.
- **A-6. Relação com "Concluído".** Não há decisão humana de Concluído. A fila não tem Issue em "Aguardando aprovação".

## 11. Perguntas ao líder

Lista única, numerada a partir de 333, sem envio ao usuário. Cada item traz a recomendação do PO e a decisão que destrava.

**333. Alvo da restauração (ambiente limpo).**
- (a) Um segundo projeto Supabase gratuito, temporário, criado só para o teste e removido ao fim. Consome uma das 2 vagas do plano Free `[NÃO VERIFICADO]` se a vaga está livre.
- (b) Um banco separado dentro do projeto de desenvolvimento, com nome próprio e identidade verificada. Mais barato, mas divide a instância e os papéis com o DEV.
- (c) Só em arquivo: decifrar e conferir contagens e manifesto, sem rodar invariantes. Menos prova.
- **Recomendação:** (a), com (c) como fallback se não houver vaga. (b) não é recomendado porque divide a instância com o banco de desenvolvimento. Destrava CA-H119-03, CA-H119-12 e a ordem de execução.

**334. Ordem entre esquema e dados.**
- (a) Aplicar as migrações até a versão do manifesto, depois carregar os dados.
- (b) Carregar os dados e depois aplicar as migrações pendentes.
- **Recomendação:** (a). Com (b), o carregamento pode falhar por conflito de esquema e a prova fica menos clara. Destrava CA-H119-05.

**335. Lista de monitores I-xx que rodam no destino.**
- (a) Os monitores executáveis em SQL puro, sem serviço externo. A Arquitetura faz a lista e a publica.
- (b) Todos os I-xx, e o que não rodar vira lacuna.
- **Recomendação:** (a), com a lista publicada na Arquitetura e validada pelo PO. Destrava CA-H119-07.

**336. Restauração de Storage (D-02).**
- (a) D-02 fica fora desta história e vira história própria, porque H-010 não exporta objetos. O relatório declara a lacuna.
- (b) Incluir um export de objetos do Storage em H-010 ou nesta história. Exige decisão de espaço (Storage 1 GB, `09` §9) e de custo (free).
- **Recomendação:** (a). D-02 depende de dado que hoje não é exportado. Destrava CA-H119-15 e o escopo da seção 4.

**337. `media_asset` fora do backup (#145).**
- (a) Manter `media_asset` fora do backup, com decisão registrada, e declarar a lacuna no relatório. D-02 fica sem reconciliação.
- (b) Incluir os metadados de `media_asset` no backup. Exige decidir sobre o papel de leitura (revogado pela migração `20261112120000`) e sobre dados sensíveis, se houver.
- **Recomendação:** (b), porque D-02 precisa de `media_asset` e os metadados não são o arquivo binário. A decisão de segurança é do dono. Destrava CA-H119-16 e o fechamento de #145. Sem resposta, H-119 não fecha as contagens nem D-02.

**338. Dependência declarada de H-117 (#126, Backlog).**
- (a) Esperar #126 ser concluída antes de iniciar H-119.
- (b) Registrar exceção no backlog, como na decisão 278, porque o teste de restauração não usa a suíte de concorrência.
- **Recomendação:** (b), com nota no backlog. Mas a decisão é do líder: a dependência está escrita no backlog e a razão técnica não foi confirmada. Destrava o início e a onda da história (seção 8).

**339. Periodicidade do backup manual (BK-7) e RPO.**
- (a) Semanal.
- (b) Semanal e antes de migração destrutiva.
- (c) Diária, com automação (exige decisão e infraestrutura).
- **Recomendação:** (b), a mesma recomendação de BK-7. O RPO efetivo do teste é a idade do backup de referência e fica comparado com essa periodicidade. Destrava CA-H119-09.

**340. Como a frase-senha entra na execução.**
- (a) O dono digita a frase na execução, guiado pelo procedimento, sem armazenamento.
- (b) Arquivo de frase fora do repositório, lido apenas no momento, com caminho em variável de ambiente (já previsto em `BACKUP_PASSPHRASE_FILE`).
- **Recomendação:** (a) para a primeira execução. Se a execução for repetida, (b) é aceitável, desde que o arquivo esteja fora do repositório e não seja registrado. Destrava CA-H119-10 e a forma da evidência.

**341. Tratamento das tabelas excluídas do backup (decisão 147).**
- (a) O teste declara as tabelas excluídas como lacuna e não as conta como restauradas (CA-H119-06).
- (b) Restauração trata as tabelas de localização do profissional de forma específica (recarga ou exclusão explícita).
- **Recomendação:** (a) para esta história. A decisão 147 diz que "o procedimento de backup deve tratar essas tabelas", mas o texto não define como. Destrava CA-H119-06 e o texto de R5.

**342. Meta de RTO e RPO.**
- (a) Confirmar RTO ≤ 8 h como meta da história (`11` §9 `[PROPOSTA]`).
- (b) Fixar outra meta, com justificativa.
- **Recomendação:** (a), registrando que a meta é provisória e será revista após o primeiro resultado medido. Destrava CA-H119-08.

## 12. Próximos passos

1. Líder confirma o texto da Issue #128 no GitHub e responde as perguntas 333 a 342, em lista única.
2. Registrar as respostas em `docs/factory/11-DECISOES.md` com os mesmos números.
3. Decidir sobre #126 (338) e #145 (337) antes de a Arquitetura fechar o desenho, porque ambas afetam escopo e ordem.
4. Mover #128 para Arquitetura somente depois de confirmar a coluna no quadro. Não mover por inferência.
5. Arquitetura define o alvo, a ordem, a lista de monitores e as tabelas excluídas. Desenvolvimento só começa depois.
