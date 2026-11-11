# Desenho H-010 — Backup manual e keep-alive (Issue #23, WF-03, Architect)

- **Rastro:** 27-REFINO-H010 (BK-01..BK-10, KA-01..KA-08, Q1..Q7); 08-ARQUITETURA §16.2 (D), §16.7, §17; 10-ADRS ADR-020; 11-ARQ R-08, R-32, D-01; 17-CHECKLIST B-39, B-44; 24-DESENHO-H008 (rota separada, `CRON_SECRET`); spikes/S-02 (papel atual com `rolbypassrls = true`; host direto só IPv6, alcançável desta máquina) e S-10 (S10-2); supabase/README e `packages/db/scripts` (executor `pg` fixado, `.env.local` lido por código).
- **Natureza:** SOMENTE documento. Nada foi executado: nenhum dump, conexão ao banco, download, papel, conta ou agendamento foi criado. Os itens abaixo são desenho para o DEV.
- **Inspeção local feita:** `pg_dump`, `psql`, `docker` e `supabase` CLI **não** estão no PATH desta máquina (busca por `pg_dump.exe` em C: e D: com 5 níveis ficou sem resultado; busca parcial). Existem: Node 22 e `pg@8.23.1` do monorepo, Python 3.13 (sem `psycopg`), `openssl 3.5` e `gpg 2.4` (do Git for Windows), `tar`.
- **Etiquetas:** `[DECIDIDO]` fixado pelo Orquestrador · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]` sem teste ou fonte oficial lida.
- **Decisão:** ver §6.

---

## 0. Decisões de partida

| # | Decisão | Origem |
|---|---|---|
| D1 | Keep-alive em execução **manual** a cada no máximo 5 dias até a H-009 (Vercel) existir; depois, cron diário da Vercel em rota própria | [DECIDIDO] (Q1c, com (a) definitivo) |
| D2 | Backup semanal e antes de migração destrutiva; 4 semanais locais mais as anteriores a migrações destrutivas; **sem apagamento automático** | [DECIDIDO] (Q2, Q3) |
| D3 | Storage fora do backup | [DECIDIDO] (Q4) |
| D4 | Papel de leitura; nunca `service_role`; nunca o papel `postgres` da migração | [DECIDIDO] (Q5) |
| D5 | Chave de cifragem fora do disco de trabalho; custódia final é decisão do usuário, **pendente** | [DECIDIDO] (Q7) |
| D6 | Esta história só trata de **dado sintético**. Backup com dado real fica bloqueado até a D5 ser resolvida | 27 §0; [PROPOSTA] |

---

## 1. Procedimento de exportação do banco de desenvolvimento

### 1.1 Ferramenta

A máquina não tem `pg_dump` nem Docker, e `supabase db dump` depende de Docker (README do `supabase/` registra "sem Docker"). Alternativas avaliadas:

| Opção | Resultado | Avaliação |
|---|---|---|
| **A. Binários portáteis do PostgreSQL** (arquivo ZIP oficial, só extrair numa pasta de ferramentas fora do repositório; sem instalador, sem PATH global, sem serviço) | `pg_dump` e `pg_restore` oficiais, formato custom, snapshot consistente | **Recomendada** [PROPOSTA] |
| B. Script Node com `pg` e `COPY ... TO STDOUT` | Sem download, mas esquema teria de ser reconstruído das migrações (perde desvios manuais, papéis, ACL) e vira ferramenta própria a manter | Contingência só de dados [PROPOSTA] |
| C. `supabase db dump` | Exige Docker | Recusada |
| D. Instalar PostgreSQL global | Fora da restrição ("sem instalar nada global") | Recusada |

Regras da opção A:
- Versão do `pg_dump` **igual ou maior** que a do servidor (pg_dump recusa servidor mais novo). O DEV consulta `show server_version` com o papel de leitura **antes** de escolher o ZIP e registra só o número principal. [NÃO VERIFICADO: versão atual do servidor e o endereço de download; ambos são lidos de fonte oficial pelo DEV.]
- O ZIP é baixado de fonte oficial do PostgreSQL, o SHA-256 conferido contra o publicado pelo fornecedor, e a pasta fica em local de ferramentas **fora do repositório** (nome da variável: `PG_TOOLS_DIR`; sem valor nos documentos). O procedimento falha se a ferramenta não existir ou se a versão for menor que a do servidor.
- Nenhum binário entra no Git.

### 1.2 Papel de leitura

Hoje o único login que existe é o da migração (`postgres`, com `rolbypassrls` e `CREATE`); usá-lo para backup viola Q5. Desenho [PROPOSTA]:

- **Papel `app_backup_reader`**, criado pela mesma convenção dos papéis `app_*` (migração com `create role ... nologin`, idempotente) e **com login e senha definidos num passo manual fora da migração** (mesma pendência já registrada no README para `app_api`/`app_system`). Atributos: `nosuperuser nocreatedb nocreaterole`, `bypassrls`, `default_transaction_read_only = on`, `statement_timeout` e `idle_in_transaction_session_timeout` moderados.
- **Por que `bypassrls`:** as tabelas dos schemas do produto têm RLS **forçada**. Um papel sem `bypassrls` ou faz o `pg_dump` falhar (comportamento padrão, seguro) ou, com `--enable-row-security`, exporta **só as linhas visíveis** e o backup sai incompleto sem aviso. Por isso `--enable-row-security` é **proibido** no procedimento, e a combinação "papel sem bypass" é coberta por teste (T-BK-08). O `bypassrls` do `postgres` já foi comprovado no S-02, e `create role ... bypassrls` já funciona nas migrações existentes (papel `app_system`); [NÃO VERIFICADO] que o painel permita o `grant` de leitura abaixo.
- **Privilégios:** `usage` nos schemas exportados e `select` em todas as tabelas e sequências existentes, concedidos explicitamente por schema (alternativa: membro de `pg_read_all_data`, se o plano permitir o grant [NÃO VERIFICADO]). **Sem** `insert/update/delete/truncate`, sem `create`, sem `execute` em funções de escrita. Sem acesso a `auth`, `storage`, `vault`.
- **Lembrete de migração futura:** tabelas novas precisam de `select` para o `app_backup_reader`. O teste T-BK-09 (§3) compara a lista de tabelas do catálogo com a lista exportada e falha se uma tabela de domínio ficar de fora. Isso evita "backup verde com tabela faltando".
- **Conexão:** `DATABASE_URL_BACKUP_READ` (nova variável; só o nome vai ao `.env.example` e ao `check:env`). Conexão **direta** (porta 5432, IPv6, já alcançável desta máquina, S-02). O pooler em modo transação **não** serve para `pg_dump`; modo sessão serviria se o IPv6 falhar [NÃO VERIFICADO]. O procedimento só aceita o projeto de desenvolvimento registrado (BK-09): o identificador esperado vem de variável local `BACKUP_EXPECTED_DB_REF` (nome apenas) e a execução recusa se o destino não coincidir.
- A senha **não** vai em argumento de linha de comando (ficaria visível em listagem de processos). O orquestrador a repassa ao `pg_dump` pelas variáveis de ambiente do processo filho (`PGHOST`, `PGUSER`, `PGPASSWORD` etc.), lidas em memória de `DATABASE_URL_BACKUP_READ`. Nenhuma é impressa; erros reduzidos a código, como já faz `packages/db/scripts/lib/env.mjs`.

### 1.3 Escopo exportado (BK-01)

- **Incluídos:** `app`, `billing`, `audit`, `ops`, `private` (esquemas do produto) e `extensions` (para recriar `postgis`, `pg_trgm`, `unaccent`, `citext`, `btree_gist`, com `--extension`). Dados de todas as tabelas de domínio, inclusive `ops.schema_migration` (dá a versão do esquema exportado) e a cadeia de `audit` (o hash encadeado é parte do dado).
- **Excluídos (lista fixa no manifesto):** `auth`, `storage` (objetos e metadados), `vault`, `realtime`, `graphql`, `graphql_public`, `pgsodium`, `supabase_*`, `cron`, `net`, `pg_*` e `information_schema`. As migrações atuais não têm chave estrangeira para `auth` nem `storage` (verificado por busca nos `.sql`), então a exclusão não quebra a integridade. Se uma migração futura criar essa dependência, o teste T-BK-09 acusa.
- **Papéis não são exportados** pelo `pg_dump`: a restauração recria `app_api`, `app_system` e `app_backup_reader` pela migração-base antes de restaurar. O dump preserva as ACLs (sem `--no-acl`) e os donos são mapeados na restauração (`--no-owner` na restauração, não na exportação). Registrar isso no procedimento.
- **Formato:** `pg_dump -Fc` (custom, comprimido), com `--no-password`, `--lock-wait-timeout`, sem `--enable-row-security`.

### 1.4 Fluxo (um comando manual)

Orquestrador proposto: `packages/db/scripts/backup.mjs` (Node, `pg` já fixado; sem dependência nova), com subcomandos `export`, `verify`, `status`. [PROPOSTA]

1. **Pré-checagens:** destino fora do repositório (BK-05); `PG_TOOLS_DIR` válido e versão suficiente; alvo é o projeto esperado (BK-09); papel de leitura confirmado por `select` em `pg_roles` e `has_table_privilege` (sem escrita). Qualquer falha encerra sem tocar em nada.
2. **Snapshot consistente:** abre sessão `REPEATABLE READ, READ ONLY`, chama `pg_export_snapshot()`, mantém a sessão aberta.
3. **Contagens:** nessa mesma sessão, `count(*)` exato de cada tabela de domínio (lista derivada do catálogo nos schemas incluídos, excluindo tabelas pertencentes a extensões). Dado sintético: custo irrelevante.
4. **Dump:** `pg_dump --snapshot=<id> -Fc` com a lista de schemas, em fluxo (stdout), **sem texto claro em disco**.
5. **Hash do texto claro:** SHA-256 calculado durante o fluxo e guardado em memória.
6. **Cifragem em fluxo:** `gpg --symmetric --cipher-algo AES256` (padrão OpenPGP com verificação de integridade MDC), frase-senha **lida do terminal sem eco no momento da execução** ou do arquivo apontado por `BACKUP_PASSPHRASE_FILE` quando o operador a mantiver em mídia removível. A frase-senha não é gravada no disco de trabalho nem no manifesto; só o **nome** `BACKUP_PASSPHRASE` aparece nos documentos. Saída em `*.partial` na pasta de backups.
7. **Verificação (BK-02), antes de promover o artefato:**
   (a) SHA-256 do arquivo cifrado;
   (b) decifra em fluxo e confere SHA-256 do texto claro com o do passo 5 (a frase-senha é pedida de novo ou reutilizada da memória da mesma execução);
   (c) `pg_restore --list` do conteúdo: todas as tabelas de domínio do catálogo aparecem;
   (d) `pg_restore --data-only -f -` e contagem de linhas de cada bloco `COPY ... \.`; confere com as contagens do passo 3, tabela a tabela.
   Se o `pg_restore` não aceitar a leitura em fluxo, o passo usa arquivo temporário numa pasta temporária **fora do repositório**, removido em `finally`.
8. **Promoção:** só se tudo passou, o `*.partial` é renomeado para `fastpro-dev-AAAAMMDDTHHMMSSZ.dump.gpg`, e o manifesto é gravado (BK-03).
9. **Falha em qualquer etapa:** apaga o `*.partial` e arquivos temporários, grava registro `falha` com etapa e data (sem mensagem do driver) e **não toca** em exportações anteriores. Exportação válida mais recente continua sendo a referência.

### 1.5 Manifesto, retenção, periodicidade

- **Manifesto** (JSON ao lado do artefato, **fora do repositório**): `exec_id`, data/hora UTC, resultado, etapa de falha (se houver), versão do servidor e do `pg_dump`, lista de schemas incluídos e excluídos, `ultima_migracao` (maior `version` de `ops.schema_migration`), contagem por tabela, SHA-256 do cifrado e do texto claro, nome do arquivo, nome (nunca valor) da chave/frase `BACKUP_PASSPHRASE`, e `motivo` (`semanal` ou `pre-migracao-destrutiva`). Sem host, usuário, senha ou identificador do projeto.
- **Pasta de destino:** `BACKUP_DIR` (nome apenas), obrigatoriamente fora de `D:\projetos\fastpro` e de qualquer repositório Git (o orquestrador resolve o caminho real, segue links simbólicos e consulta `git rev-parse` para recusar pasta versionada). Segunda cópia em outro meio é recomendável (ADR-020 diz "2 cópias") [PROPOSTA]; não é critério desta história.
- **Retenção (D2):** o orquestrador **nunca apaga**. O subcomando `status` lista o que excede 4 semanais (ignorando os de motivo `pre-migracao-destrutiva`) e o operador remove manualmente, com ação explícita (AGENTS, item 5).
- **Periodicidade (BK-07/BK-08):** `status` imprime a idade da última exportação válida e "VENCIDO" se passaram 7 dias. Antes de aplicar migração destrutiva (B-44), `status --para-migracao` verifica se existe exportação válida **posterior** à última alteração de esquema (`ultima_migracao` do manifesto igual à atual); o `db:migrate` não é alterado nesta história, então o gate é **procedimento do operador e item do checklist de PR**, não bloqueio automático [PROPOSTA; automatizar é melhoria futura]. RPO de até 7 dias, aceito pelo H3 (08 §17).

### 1.6 Chave de cifragem (D5)

- A frase-senha fica **fora do disco de trabalho**: cofre de senhas do usuário ou mídia removível sob controle dele. Na rodada de teste com dados sintéticos, uma frase-senha descartável é aceitável e fica registrada como tal.
- **Alternativa de chave pública** (`gpg --encrypt`, a chave privada fica só com o usuário): ganho é que a máquina de trabalho nunca possui a chave de decifragem. Custo: o passo 7(b) não pode decifrar na execução; passa a ser conferido só no ensaio de restauração (H-119), e a verificação imediata fica limitada a hash do cifrado, `gpg --list-packets` e contagens capturadas. É uma troca entre BK-02(b) e a custódia; ver dúvida Q-D1.
- Perdida a chave, o backup é inútil: a custódia final é pendência de decisão do usuário antes de dado real (27 Q7).

---

## 2. Keep-alive

### 2.1 O que é

Uma consulta **de leitura** feita ao banco de desenvolvimento uma vez por dia, para que o projeto gratuito (que pausa após 1 semana de inatividade, ADR-020) registre atividade real. Não cria tabela, linha, log, agenda nem objeto. O resultado (data, hora, ok/falha, etapa da falha) fica **fora do banco**: em arquivo local de registro fora do repositório (execução manual) e, depois, nos logs da função na Vercel (execução agendada).

### 2.2 Consulta e papel

- **Papel `app_keepalive`** (mesma convenção: criado por migração `nologin`, login e senha em passo manual): sem `bypassrls`, `default_transaction_read_only = on`, **sem nenhum grant em tabela**. Variável: `DATABASE_URL_KEEPALIVE` (nome apenas). Em vez de reaproveitar o papel de backup (que lê tudo), o papel de keep-alive tem o mínimo.
- **Consulta:** `select 1` e leitura de catálogo (`select count(*) from pg_catalog.pg_namespace`). Não depende de tabela do produto, portanto não quebra quando o esquema muda. Conexão pelo pooler de transação, igual ao caminho que a API usará (valida o caminho real; modo e endereço do pooler [NÃO VERIFICADO], S-02/S-09).
- **[NÃO VERIFICADO]** se conexão + consulta ao catálogo contam como "atividade" para a política de pausa do Supabase. Nenhum documento lido nesta sessão afirma isso. O critério KA-07 (conferir o status do projeto depois de 7 dias) é o que decide. **Plano B** se o KA-07 falhar: acrescentar uma chamada HTTP simples à API do projeto (Data API, com a chave pública), ainda sem escrita. A decisão volta ao Architect.

### 2.3 Execução manual agora (D1)

Comando proposto: `pnpm db:keepalive` (script `packages/db/scripts/keepalive.mjs`), que:
1. lê `DATABASE_URL_KEEPALIVE` do ambiente ou do `.env.local` (mesma lógica de `env.mjs`, sem imprimir valores);
2. abre conexão, executa a consulta, fecha;
3. acrescenta uma linha a `KEEPALIVE_LOG` (arquivo fora do repositório): `AAAAMMDDTHHMMSSZ ok` ou `... falha etapa=<conectar|consultar|timeout>`;
4. sai com código diferente de zero em falha, **sem tentar de novo** além do limite de 3 do AGENTS (3 tentativas com pausa curta, depois encerra);
5. imprime a idade da última execução ok e avisa quando passou de 4 dias.

Cadência: **a cada no máximo 5 dias** (margem de 2 dias sobre os 7 de pausa), mesma data fixa do operador (por exemplo, segunda e sexta). Isto é uma rotina de mão: se o operador esquecer por 7 dias, o projeto pausa. É um risco aceito e registrado (§4). **Não** se cria agenda do Windows, tarefa agendada, conta ou CI nesta etapa.

### 2.4 Execução agendada (depois da H-009, caminho definitivo)

- Rota própria `GET /internal/keepalive` na API, **separada** da rota de tick (24-DESENHO-H008), protegida por `Authorization: Bearer <CRON_SECRET>` (nome apenas). Sem o segredo: negação e **nenhuma conexão** ao banco (KA-05). Comparação em tempo constante.
- Vercel Cron diário (Hobby: 1/dia, ±59 min). Independente de `pg_cron` e do tick (KA-06). Reutiliza a mesma consulta e o mesmo papel `app_keepalive`.
- Nada disso é implementado agora (BLQ-EXEC). O script manual e a rota compartilham a função de consulta para o DEV não duplicar lógica.

---

## 3. Testes de aceite para o DEV (banco de desenvolvimento)

Todos usam o banco de desenvolvimento com dado sintético. Nenhum imprime valor de variável.

| ID | Cobre | Teste | Passa quando |
|---|---|---|---|
| T-BK-01 | BK-06 | `pnpm check:secrets` (e `--history`) após criar scripts, doc e `.env.example`; busca adicional por `postgres://`, `postgresql://`, `PGPASSWORD=` com valor e por trechos de dump | Zero achados; `.env.example` ganha só os **nomes** `DATABASE_URL_BACKUP_READ`, `DATABASE_URL_KEEPALIVE`, `BACKUP_DIR`, `BACKUP_EXPECTED_DB_REF`, `BACKUP_PASSPHRASE_FILE`, `PG_TOOLS_DIR`, `KEEPALIVE_LOG`; `check:env` passa |
| T-BK-02 | BK-06 | Rodar `export` e depois `git status --porcelain` e `git ls-files` | Nenhum arquivo novo versionável (manifesto, log, dump e temporários fora do repositório); `*.dump*`, `*.gpg`, `backups/` no `.gitignore` por segurança |
| T-BK-03 | BK-01, BK-02, BK-10 | `export` completo com o papel de leitura | Artefato `.gpg` promovido; manifesto com schemas incluídos/excluídos, `ultima_migracao`, contagens, 2 hashes; `verify` passa (a, b, c, d) |
| T-BK-04 | BK-02(b) | Alterar 1 byte do artefato cifrado e rodar `verify` | Falha (hash do cifrado e/ou MDC do gpg); artefato marcado inválido |
| T-BK-05 | BK-03 | Provocar falha: (i) papel de leitura com senha errada; (ii) `PG_TOOLS_DIR` inválido; (iii) interromper o `pg_dump` no meio; (iv) forçar divergência de contagem num teste | Em todos: nenhum arquivo promovido, `*.partial` removido, registro `falha` com etapa e data, **a exportação válida anterior permanece intacta** (hash igual antes e depois) |
| T-BK-06 | BK-04 | Decifrar com frase-senha errada e sem frase-senha; procurar a frase-senha em manifesto, logs e dump | Decifragem falha; frase-senha ausente em qualquer arquivo |
| T-BK-07 | BK-05 | `export` com `BACKUP_DIR` dentro de `D:\projetos\fastpro`, em subpasta versionada, e por link simbólico para dentro | Recusa antes de qualquer conexão; nada gravado. Teste positivo com pasta externa. Gerar uma 5ª exportação não apaga nenhuma antiga; `status` lista o excedente |
| T-BK-08 | BK-01, D4 | Com um papel de teste **sem** `bypassrls`: tentar o `pg_dump` (sem `--enable-row-security`) numa tabela com RLS forçada | Falha (não exporta parcial). Verificar também que o orquestrador **não** contém `--enable-row-security` (teste estático) |
| T-BK-09 | BK-01 | Comparar tabelas de domínio do catálogo (nos schemas incluídos) com a lista do dump e o manifesto | Idênticas; criar tabela temporária em transação de teste (rollback) sem `select` ao papel de leitura e ver o `export` falhar com tabela ausente |
| T-BK-10 | BK-09 | Apontar o orquestrador para um destino com `BACKUP_EXPECTED_DB_REF` diferente | Recusa antes do `pg_dump` |
| T-BK-11 | D4, BK-01 | Consulta de privilégios do papel de leitura: sem `insert/update/delete/truncate/create`; tentar `create table` e `insert` com ele em transação com rollback | Negado nos dois |
| T-BK-12 | BK-07, BK-08 | `status` com exportação de 8 dias e com `ultima_migracao` defasada | Mostra "VENCIDO" e "defasada para migração" |
| T-KA-01 | KA-02, KA-03 | Antes e depois de 3 execuções do `db:keepalive`: contagens de todas as tabelas, lista de objetos de esquema, `has_table_privilege` de `app_keepalive` | Contagens e objetos idênticos; sem privilégio em tabela; nenhuma tabela de heartbeat ou log criada |
| T-KA-02 | KA-03 | Com `app_keepalive`, tentar `insert` e `create` em transação com rollback | Negado |
| T-KA-03 | KA-04 | Rodar com a senha errada e com host inalcançável | Registra `falha etapa=conectar`, sai com código diferente de zero, no máximo 3 tentativas, nada gravado no banco, nenhuma credencial no registro |
| T-KA-04 | KA-02 | Inspecionar o `KEEPALIVE_LOG` e a saída | Só data, hora, ok/falha, etapa |
| T-KA-05 | KA-07 | Conferir no painel o status do projeto após 7 dias de execuções manuais a cada ≤ 5 dias | Ativo, não pausado. **Único** teste que mostra o efeito real; fora do CI; resultado registrado na Issue, sem inventar |

Fora desta história: restauração completa em banco limpo e monitores I-xx (H-119/D-01), rota Vercel e cron (H-009 + `CRON_SECRET`; testes KA-01, KA-05, KA-06 ficam para quando existir), backup do Storage.

---

## 4. Riscos e limites

| Risco | Tratamento |
|---|---|
| Backup nunca restaurado pode estar quebrado | Aqui só integridade (hash, listagem, contagens). Restauração testada é H-119; ajustar a referência a D-01 no 14-BACKLOG (27 Q6) |
| Chave/frase-senha perdida | Custódia fora do disco, decisão do usuário pendente (D5). Bloqueia dado real |
| Backup parcial "verde" por RLS forçada | Papel com `bypassrls`, `--enable-row-security` proibido, T-BK-08, T-BK-09 |
| Tabela nova sem `select` ao papel de leitura | T-BK-09 acusa; checklist de PR de migração |
| Esquecimento do operador (keep-alive manual a cada 5 dias; backup semanal) | `status` e aviso no script; sem automação nesta fase. Pausa do projeto e RPO de 7 dias são risco aceito pelo H3 |
| Keep-alive pode não contar como atividade | KA-07 decide; plano B por HTTP à API do projeto |
| Painel pode negar `grant` de leitura ou `bypassrls` ao papel novo | Comprovado só para criar papel `bypassrls` (precedente `app_system`); resto [NÃO VERIFICADO]. Contingência: usar papel já existente restrito e registrar a exceção |
| IPv6 direto só alcança esta máquina | Adequado ao backup manual local. CI/Vercel exigiriam pooler em modo sessão [NÃO VERIFICADO] |
| Texto claro em memória e (se `pg_restore` exigir) em temporário fora do repositório | Só dado sintético; temporário removido em `finally`; sem texto claro em disco no caminho normal |
| Binário portátil baixado da internet | SHA-256 conferido contra o oficial; fora do repositório; versão registrada no manifesto |
| `pg_dump` com versão diferente do servidor | Pré-checagem recusa se menor |
| Limites: dado real, Storage, restauração automatizada, backup automático, rotação de chave e expurgo em cópias (L1) | Fora; reavaliar no gatilho de upgrade (ADR-020) |
| Senha do papel de leitura em `.env.local` | Já ignorado pelo Git; mesma prática de `DATABASE_URL_MIGRATIONS`; rotacionar se o arquivo vazar |

---

## 5. Contrato de entrega para o DEV (resumo)

Arquivos propostos: `packages/db/scripts/backup.mjs` (+ libs), `packages/db/scripts/keepalive.mjs`, scripts `db:backup`, `db:keepalive` no `package.json`, migração `supabase/migrations/<ts>_platform_create_backup_keepalive_roles.sql` com rollback manual em `supabase/rollbacks/` (papéis `nologin`, grants de leitura, sem senha), `.env.example` (somente nomes), `.gitignore` (padrões de dump), `docs/factory/procedimento-backup.md` (procedimento escrito, sem valores). Evidências na Issue: manifestos de uma exportação válida e de uma inválida provocada; saídas de T-BK-01 a T-BK-12 e T-KA-01 a T-KA-04; T-KA-05 após 7 dias. A migração de papéis não é destrutiva (apenas cria). Nenhuma alteração em `db:migrate`. Sem push de segredo, sem agendamento, sem conta.

---

## 6. Decisão e dúvidas

**Decisão: AJUSTES_NECESSARIOS** (de baixo custo). O desenho é aprovável na direção, mas depende de três respostas do Orquestrador antes do DEV começar. Nenhuma bloqueia o desenho.

**Dúvidas ao Orquestrador (numeração local):**

- **Q-D1 — Frase-senha ou chave pública?** Recomendação: frase-senha (gpg simétrico), lida na hora e guardada fora do disco, porque permite o passo BK-02(b) completo. Alternativa: chave pública, custódia melhor, mas a decifragem passa ao ensaio de restauração (H-119). Precisa de escolha do usuário junto com a custódia (27 Q7).
- **Q-D2 — Autorização para o DEV baixar os binários portáteis do PostgreSQL** (ZIP oficial, fora do repositório, sem instalador). É download de ferramenta, não conta nem instalação global. Alternativa: contingência B (só dados por `COPY`) com perda de fidelidade de esquema. Recomendação: autorizar A.
- **Q-D3 — Criar os papéis `app_backup_reader` e `app_keepalive` no banco de desenvolvimento** (papel de banco, não conta externa) e a definição de senha (passo manual do usuário/DEV, igual à pendência do README). Recomendação: autorizar, em migração não destrutiva.
- **Q-D4 — Gate de migração destrutiva:** nesta história é procedimento e item de checklist (sem alterar `db:migrate`). Recomendação: aceitar; automatizar numa história futura.

---

## Resumo em linguagem simples

A cópia de segurança será feita com a ferramenta oficial do PostgreSQL em versão portátil, por um usuário do banco que só lê, e sai cifrada e conferida (hash e contagem de linhas) numa pasta fora do projeto; se algo falhar, a cópia boa anterior continua intacta. O "banco sempre ativo" é uma leitura simples feita à mão a cada no máximo 5 dias por um usuário sem acesso às tabelas, até a Vercel existir; só a observação por 7 dias mostra se isso realmente evita a pausa.
