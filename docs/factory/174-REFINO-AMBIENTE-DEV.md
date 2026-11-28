# Refino 174 — Ambiente DEV executável (Issue #156)

- **Issue:** #156 `[E0] Ambiente DEV executável: papéis de login da API, chaves DEV, script dev local e rotas respondendo` · **Workflow:** WF-03 (Feature) · **Etapa:** Product Owner.
- **EXEC-ID:** EXEC-PO-156-20261121 (subagente Claude, registrado pelo líder; prioridade máxima).
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-21.
- **Natureza:** somente documento. Nenhum código, migração, banco, `.env.local`, quadro ou `11-DECISOES.md` foi alterado. Nenhum valor do `.env.local` foi lido ou impresso; só nomes de variáveis.
- **Etiquetas:** `[DECIDIDO]` decisão registrada · `[VERIFICADO]` lido no repositório · `[PROPOSTA]` deste refino, a validar · `[AMBIGUIDADE]` fontes conflitantes ou lacuna · `[NÃO VERIFICADO]` não confirmado nesta rodada.

---

## 0. Fontes e limitações

Fontes lidas:
- `D:\Fabrica\AGENTS.md`, `roles/factory-product-owner.md`, `docs/factory/158-REFINO-H058.md` (somente como modelo de formato).
- `supabase/README.md` (integral); `.env.example` (integral, só nomes); `.gitignore`; `scripts/check-env-example.mjs`; `package.json` da raiz, `apps/api/package.json`, `apps/web/package.json`; `apps/api/src/composicao.ts` (integral); `apps/api/src/catalog/compose.ts` (integral).
- Por Grep: migrações `20261110120000_platform_create_baseline.sql`, `20261111200000_catalog_create_service_catalog.sql`, `20261111250000_catalog_public_list_function.sql`; `session-route.ts`; `catalog-route.ts`; composições de `requests/`, `contact/`, `drafts/`, `media/`, `identity-docs/`, `geo/`, `privacy/`.

Não lido nesta rodada `[NÃO VERIFICADO]`: `vercel.json`; ponto de entrada da função da API (que injeta as fábricas de pool); `session-route.ts` integral (corpo da validação); `drafts/compose.ts` (valores das constantes); `catalog/fabrica-pg.ts` e `catalog/pool-pg.ts`; `packages/email/src/env.ts`; scripts de `packages/db/scripts/`; estado real do banco DEV (papéis, versão do Postgres, seed do catálogo).

Limitação de fonte: a Issue #156 no GitHub não foi lida por comando de rede. O escopo foi reconstruído a partir da descrição do líder e do código.

Consulta de fila: a verificação de que #156 está na fila do quadro (`docs/factory/quadro-status.md`) é condição para o início do trabalho; o resultado consta do relatório ao líder, não deste documento.

---

## 1. Problema verificado

- `[VERIFICADO]` As rotas da API só existem quando a composição recebe as variáveis **e** as fábricas de pool. `apps/api/src/composicao.ts:267-268` devolve a pendência "fabrica do pool da busca (ainda nao montada na funcao)" quando as variáveis estão completas, mas a fábrica não foi injetada. Por isso, **variáveis no `.env.local` não bastam**: o ponto de entrada precisa passar `fabricaCatalogo`, `abrirClienteApi`, `abrirClienteSistema`, `fabricaRascunho` e `abrirConexaoDedicada` (`composicao.ts:124-144`). `[NÃO VERIFICADO]` se o ponto de entrada atual já as injeta. Se não injeta, o escopo inclui o adaptador local de pool (`catalog/fabrica-pg.ts` e `catalog/pool-pg.ts`).
- `[VERIFICADO]` A lista de variáveis do líder está **incompleta** para a rota de busca. `catalog/compose.ts:9-13` e `composicao.ts:105-109` exigem, além de `DATABASE_URL_APP_API`, a chave `CATALOG_RATE_HMAC_KEY` (mínimo 32 caracteres) e `SITE_URL`. Sem elas, a rota segue 404.
- `[AMBIGUIDADE A-1]` O pedido fala em `/api/v1/*`, mas o código declara rotas como `/v1/...` (`catalog/catalog-route.ts:1`: `POST /v1/catalog/service-search`; `session-route.ts:30`: `SESSION_CONVERT_PATH = '/v1/auth/session'`). O prefixo `/api` provavelmente vem de uma reescrita do Vercel (`vercel.json`, não lido). A ponte local deve reproduzir essa mesma reescrita.
- `[VERIFICADO]` A rota de sessão é **POST** (`session-route.ts:2`: `POST /v1/auth/session`; resposta de negação única, sem `Set-Cookie`, linha 172). Um GET não serve como prova de "rota respondendo".
- `[VERIFICADO]` Os papéis `app_api` e `app_system` são `NOLOGIN`, `NOINHERIT` e sem senha (`migrations/20261110120000_platform_create_baseline.sql:71-75`; `supabase/README.md:24`). `app_api` tem `NOBYPASSRLS`; `app_system` tem `BYPASSRLS`. Login e senha são "passo manual fora das migrações" (`supabase/README.md:47-49`), com usuário de pooler no formato `papel.<ref>`.
- `[VERIFICADO]` Não existe script `dev` na raiz (`package.json`), nem em `apps/api/package.json` ou `apps/web/package.json`. A API não tem servidor local: os testes montam o aplicativo com `node:http` (`apps/api/tests/app.test.ts:19-26`). A web é estática, com build (`apps/web/package.json`, script `build`), sem servidor de desenvolvimento.

---

## 2. Objetivo

Permitir que a API e a web rodem no computador local apontando para o banco DEV, com:
1. papéis de login dedicados de menor privilégio, membros de `app_api` e `app_system`, sem alterar as proteções existentes;
2. chaves DEV geradas no `.env.local`, sem commit;
3. `.env.example` documentando os nomes, sem valores;
4. script `dev` oficial no repositório (web estática e API em `localhost`);
5. `POST /v1/auth/session` e `POST /v1/catalog/service-search` respondendo localmente (prefixo confirmado na pergunta 972 ou em A-1).

Ambiente: somente desenvolvimento. Nada de produção, deploy, domínio ou Vercel de produção. O desbloqueio do preview da API é consequência, não entregável.

---

## 3. Escopo

**E1. Papéis de login DEV (banco DEV, via `npx supabase`).**
- Criar dois papéis com `LOGIN`: um para `app_api` e outro para `app_system`, com nomes com sufixo de DEV (ex.: `fastpro_dev_api`, `fastpro_dev_system`; nomes finais na Arquitetura).
- Atributos do login: `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOBYPASSRLS`, `NOREPLICATION`. O `BYPASSRLS` continua só em `app_system`.
- Membership: `GRANT app_api TO <login_api> WITH INHERIT TRUE` e `GRANT app_system TO <login_system>` com INHERIT. Por causa do `NOINHERIT` dos papéis base, o login precisa herdar os privilégios sem depender de `SET ROLE`. `[PROPOSTA]` a validar na versão do Postgres do DEV (opção de membership com INHERIT exige PostgreSQL 16 ou superior, `[NÃO VERIFICADO]`).
- Nenhum login pode ser membro do outro papel de aplicação (ex.: `<login_api>` não é membro de `app_system`).
- Senha gerada pela fábrica, gravada somente no `.env.local` (`DB_PASSWORD_APP_API`, `DB_PASSWORD_APP_SYSTEM`, `DATABASE_URL_APP_API`, `DATABASE_URL_APP_SYSTEM`). Nunca em migração, em arquivo versionado, em log ou no chat.
- Execução: `npx supabase` (CLI). Não usar o servidor MCP do Supabase, não usar Docker. `[PROPOSTA]` SQL ad hoc via CLI, sem arquivo de migração (migração com senha é proibida). Um arquivo de desfazer (`DROP ROLE`) pode ir em `supabase/rollbacks/`, sem senha.
- Conexão: pelo pooler do Supabase, conforme `supabase/README.md:47-49`. `[AMBIGUIDADE]` se o pooler em modo transação aceita o padrão de `set_config` por transação; é o teste pendente do README (S-02.5 / S-09).

**E2. Chaves DEV no `.env.local`.**
- Gerar **somente as chaves ausentes**, com aleatoriedade criptográfica (hexadecimal de no mínimo 32 bytes para as chaves com tamanho mínimo). Nunca sobrescrever um valor já preenchido.
  - Motivo: `PEPPER_*`, `DOCUMENT_HMAC_KEY`, `ADDRESS_ENC_KEY`, `PHONE_ENC_KEY` e `DATA_ENC_KEY_*` já podem ter sido usados para gravar dados DEV. Regenerá-las torna os dados ilegíveis ou quebra a busca por hash. Isso é perda irreversível de dados de DEV.
- Gerar as chaves das duas rotas e as de sessão: `CATALOG_RATE_HMAC_KEY`, `SITE_URL`, `APP_BASE_URL`, `SESSION_COOKIE_SECRET` (necessária à sessão `[NÃO VERIFICADO]` no corpo de `session-route.ts`), `AUTH_CHALLENGE_KEY` (`[NÃO VERIFICADO]` se a sessão a exige), `JOBS_TICK_SECRET`. As demais chaves de `.env.example` seguem a pergunta 972.
- **Não gerar** (ficam vazias, rota fechada por desenho):
  - `IDENTITY_DOCS_READER_KEY`: credencial de leitura de Storage real, criada no provedor; valor aleatório não funciona (`.env.example:57-59`).
  - `IDENTITY_DOCS_ENABLED`, `MEDIA_UPLOAD_ENABLED`: flags de liberação; ausentes = fechadas (`.env.example:51-55`; `media/media-composicao.ts:91`; `identity-docs/identity-doc-montagem.ts:75`).
  - `EMAIL_*`, `RESEND_*`: sem envio de e-mail em desenvolvimento (regra do projeto). O provedor de e-mail fica pendente e não bloqueia as duas rotas.
  - `MAPBOX_*` e `MAPBOX_TEMP_*`: nenhuma das duas rotas usa Mapbox (ver pergunta 971).
  - `MERCADO_PAGO_*`, `DATABASE_URL_KEEPALIVE`, `DATABASE_URL_BACKUP_READ`: fora de escopo (backup fora do projeto; keep-alive por decisão do dono).
- A `DATABASE_URL_MIGRATIONS` já existente não deve ser usada pela API (privilégio de migração).
- Gerador: script novo (Node stdlib), que lê os nomes de `.env.example`, grava só as linhas ausentes no `.env.local` e imprime somente nomes e contagens. Não imprime valor, nem tamanho de chave, nem prefixo.

**E3. `.env.example`.**
- Acrescentar somente nomes novos (sem valor) que o código lê e que ainda não estão no modelo. `[VERIFICADO]` por leitura integral: **`PROFILE_RATE_HMAC_KEY` e `DSR_EXTRATO_CHAVE_ASSINATURA` não estão em `.env.example`**. Se o código os lê com `process.env.X` literal, `check:env` falha hoje (`scripts/check-env-example.mjs:70-72`). `[NÃO VERIFICADO]` pela busca no código (a busca desta rodada não foi feita nesses nomes).
- Não colocar valor, nem exemplo de valor, nem prefixo de chave.

**E4. Script `dev` oficial.**
- Entrada na raiz: `"dev": "node scripts/dev-local.mjs"` (nome do script ainda não existe em `package.json`).
- Comportamento:
  1. Confere se `.env.local` existe e se os nomes obrigatórios estão preenchidos. Mostra só os nomes que faltam, sem valor.
  2. Carrega `.env.local` com `node --env-file` (Node 22, compatível com `engines` `>=22.14.0 <23`).
  3. Sobe a API em `127.0.0.1` (porta de API a definir na Arquitetura), com a mesma reescrita de prefixo da produção (decisão A-1), e injeta as fábricas de pool sobre `pg` (usando `DATABASE_URL_APP_API` e `DATABASE_URL_APP_SYSTEM`).
  4. Serve a web estática já compilada em `127.0.0.1` (outra porta), com o build de `apps/web`.
  5. Não envia e-mail, não chama serviço externo além do banco DEV, não grava em disco fora do `.env.local` e não imprime valores.
- O script deve falhar com código de saída diferente de zero quando faltar nome obrigatório, em vez de subir com rota 404 silenciosa.

**E5. Validação do happy path (via API, sem tela).**
- `POST /v1/auth/session` (com o prefixo do ambiente local) responde código diferente de 404 e sem `Set-Cookie`.
- `POST /v1/catalog/service-search` responde 200 com lista de serviços; o corpo não contém colunas internas (`seed_key`, `council_body`, `regulation_source`, `moderation_sensitive`, `version`, `updated_by_ref`), conforme `20261111200000` §8 e `20261111250000`.
- Esta é a única prova de QA exigida nesta Issue. A suíte completa de QA fica para o fim do trabalho.

---

## 4. Fora de escopo

- Configuração ou deploy de Vercel (preview ou produção), domínio, cobrança real, chaves de produção.
- Envio de e-mail, Resend e webhook de e-mail.
- Backup, restauração, exportação e cópia do banco (fora do projeto, decisão 151).
- Reativação de `pg_cron` ou `pg_net` (decisão do dono, `supabase/README.md:39-43`).
- Credenciais que só o provedor cria (`IDENTITY_DOCS_READER_KEY`, `DATABASE_URL_KEEPALIVE`, login de keep-alive). Ficam como pendência do dono, sem bloquear esta Issue.
- Rotas de aceite, descoberta, fotos e contato. Dependem das mesmas variáveis, mas a prova desta Issue são só as duas rotas do pedido. A subida delas fica para a Issue que as usar.
- Migração de schema, alteração de grants existentes, qualquer mudança nas proteções RLS.
- Rotação ou regeneração de chaves já existentes no DEV.

---

## 5. Riscos

| Ref. | Risco | Mitigação |
|---|---|---|
| R-156-01 | Variáveis completas, mas fábricas de pool não injetadas: a rota segue 404 (`composicao.ts:267-268`). | CA-156-07 e CA-156-08 provam status diferente de 404 com o script; E4 injeta as fábricas. |
| R-156-02 | Regenerar chaves já usadas quebra dados DEV (hash, cifra, busca por documento). | E2: só ausentes. CA-156-04 prova que a segunda execução gera zero chaves. |
| R-156-03 | Senha do login gravada em arquivo versionado, log ou chat. | `.gitignore:2-4` ignora `.env.local`; CA-156-02 (git) e `check:secrets` / `check:logs`. |
| R-156-04 | Login com privilégio excessivo (BYPASSRLS, superusuário, membership cruzada) enfraquece o RLS. | CA-156-01 (consulta em `pg_roles` e `pg_has_role`) e CA-156-09 (negação de leitura sem contexto). |
| R-156-05 | Pooler em modo transação não preserva estado de sessão. Falhas intermitentes nas rotas. | Teste de `set_config` por transação (`supabase/README.md`, pendência 1). Bloqueante para a Arquitetura. |
| R-156-06 | Prefixo `/api/v1` ≠ `/v1` (A-1): falso 404 ou rota inexistente no ambiente local. | Confirmar `vercel.json` na Arquitetura; teste de CA-156-07 e CA-156-08 com o prefixo real. |
| R-156-07 | `APP_ENV` com valor conflitante entre fontes (`.env.example:62` lista `local`; `.env.example:71` cita `development`). | Pergunta 970. |
| R-156-08 | Membership com `WITH INHERIT` exige PostgreSQL 16+ (`[NÃO VERIFICADO]`). | Consultar `select version()` via CLI antes da execução. |
| R-156-09 | Comando de SQL da CLI do Supabase pode diferir da versão instalada (`[NÃO VERIFICADO]`). | Confirmar `npx supabase --help` antes; sem comando, registrar bloqueio técnico (não usar MCP). |
| R-156-10 | Variável de chave ausente em `.env.example` (E3) quebra `check:env`. | E3 + `check:env` (CA-156-03). |
| R-156-11 | Custo de Mapbox por variável de limite. | Pergunta 971 (recomendação: não preencher). |

---

## 6. Critérios de aceite (Given / When / Then)

Todos são testáveis localmente. Os comandos são executados na raiz `D:\projetos\fastpro`, com Node 22 e pnpm via corepack. Códigos de saída são registrados na Issue (comando, contagem e código de saída).

**CA-156-01 — Papéis de login com menor privilégio.**
- **Dado** que `app_api` e `app_system` são `NOLOGIN` no banco DEV e que os logins de DEV foram criados,
- **Quando** o SQL de verificação roda pela CLI: `npx supabase db query --linked "select rolname, rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls from pg_roles where rolname in ('<login_api>','<login_system>','app_api','app_system')"`,
- **Então** `<login_api>` e `<login_system>` têm `rolcanlogin = t`, `rolsuper = f`, `rolcreaterole = f`, `rolcreatedb = f` e `rolbypassrls = f`; `app_api` tem `rolcanlogin = f` e `rolbypassrls = f`; `app_system` tem `rolcanlogin = f` e `rolbypassrls = t`;
- **E** `pg_has_role('<login_api>', 'app_system', 'USAGE')` é `f` e `pg_has_role('<login_system>', 'app_api', 'USAGE')` é `f`.
- **Prova:** código de saída `0` e saída da consulta na Issue (sem senha). `[NÃO VERIFICADO]` o nome exato do subcomando da CLI: confirmar com `npx supabase --help`.

**CA-156-02 — Senhas e URLs só no `.env.local`.**
- **Dado** que as senhas e as URLs com senha foram gravadas,
- **Quando** o repositório é varrido,
- **Então** `git check-ignore -v .env.local` sai com código `0` e aponta a regra `.env.*` (`.gitignore:3`); `git ls-files --error-unmatch .env.local` sai com código diferente de `0` (não versionado);
- **E** `git grep -nE "postgres(ql)?://[^[:space:]]+:[^[:space:]@]+@" -- . ":!.env.local"` sai com código `1` (nenhuma URL com senha em arquivo versionado);
- **E** `corepack pnpm check:secrets` sai com código `0`.

**CA-156-03 — `.env.example` só com nomes.**
- **Dado** que `.env.example` recebeu os nomes novos,
- **Quando** `corepack pnpm check:env` roda,
- **Então** sai com código `0` e imprime "check-env-example" com a contagem de nomes, sem violação de "tem valor", "duplicado" ou "ausente de .env.example";
- **E** `git grep -nE "^[A-Z][A-Z0-9_]*=.+" -- .env.example` sai com código `1` (nenhuma linha com valor).

**CA-156-04 — Chaves geradas só para o que falta.**
- **Dado** um `.env.local` com chaves já preenchidas,
- **Quando** o gerador roda duas vezes seguidas,
- **Então** a primeira execução gera somente os nomes ausentes e sai com código `0`; a segunda execução imprime "geradas: 0" e sai com código `0`;
- **E** nenhum valor preenchido antes é alterado (prova: o gerador grava no registro da execução o hash SHA-256 de cada valor preexistente antes e depois, e os hashes são iguais; o hash não contém o valor);
- **E** as chaves com tamanho mínimo passam o teste de tamanho (`node -e` imprime somente "ok" ou o nome da chave).

**CA-156-05 — Scripts de checagem continuam verdes.**
- **Dado** as alterações de E1 a E4,
- **Quando** `corepack pnpm check:all` e `corepack pnpm test:scripts` rodam,
- **Então** ambos saem com código `0`.
- **Prova:** código de saída e contagem de testes na Issue.

**CA-156-06 — Script `dev` falha sem nome obrigatório.**
- **Dado** um `.env.local` sem `DATABASE_URL_APP_API`,
- **Quando** `corepack pnpm dev` roda,
- **Então** sai com código diferente de `0`, lista só o nome faltante e não sobe servidor algum.

**CA-156-07 — Rota de busca responde localmente (happy path).**
- **Dado** que `corepack pnpm dev` está ativo, que a API escuta em `127.0.0.1` e que o banco DEV está acessível pelo pooler,
- **Quando** `curl --form-string` (ou `curl -d` com corpo JSON fixo) envia `POST /<prefixo>/v1/catalog/service-search` com um termo de busca válido `[NÃO VERIFICADO]` o formato do corpo (ver `catalog/catalog-route.ts`),
- **Então** a resposta tem código HTTP `200` (nunca `404`), corpo JSON e nenhuma das colunas internas listadas em E5.
- **Prova:** código HTTP impresso por `curl -s -o <arquivo> -w "%{http_code}"`, com o arquivo de saída fora do repositório.

**CA-156-08 — Rota de sessão responde localmente.**
- **Dado** que o script `dev` está ativo,
- **Quando** `POST /<prefixo>/v1/auth/session` é enviado sem cookie,
- **Então** a resposta tem código HTTP diferente de `404` (negação esperada, `session-route.ts:172`) e **não** tem cabeçalho `Set-Cookie`;
- **Prova:** `curl -s -D <cabecalhos> -o /dev/null -w "%{http_code}"` e busca de `Set-Cookie` nos cabeçalhos (sem resultado).

**CA-156-09 — Menor privilégio mantido no login.**
- **Dado** o login `<login_api>`,
- **Quando** tenta ler uma tabela de `app` protegida por RLS sem contexto de sessão,
- **Então** recebe zero linhas ou erro de permissão, nunca o conteúdo completo;
- **E** tenta `DROP`/`ALTER` em objeto do schema `app` e recebe erro de permissão.
- **Prova:** saída do teste pela CLI (código de saída e linha de erro esperada).

**CA-156-10 — Nenhuma configuração de produção.**
- **Dado** o `.env.local` gerado,
- **Quando** o gerador imprime o resumo,
- **Então** `APP_ENV` é verificado só pela condição "diferente de `production`" e "de um dos valores da pergunta 970", sem imprimir o valor;
- **E** nenhuma variável de Vercel de produção é definida (prova: `git diff --stat` sem alteração de configuração do Vercel).

---

## 7. Dependências confirmadas por Grep

- **D1** `apps/api/src/composicao.ts:105-109` — busca: `DATABASE_URL_APP_API`, `CATALOG_RATE_HMAC_KEY` (≥32, `:12`), `SITE_URL`.
- **D2** `apps/api/src/catalog/compose.ts:33-38` — devolve `undefined` sem as três variáveis ou sem fábrica.
- **D3** `apps/api/src/composicao.ts:124-144` e `:267-268` — fábricas de pool injetadas pelo ponto de entrada.
- **D4** `apps/api/src/composicao.ts:275-280` — caso de acesso e painel operacional exigem `DATABASE_URL_APP_SYSTEM` e fábrica SQL.
- **D5** `apps/api/src/requests/acceptance-composicao.ts:76-78` — aceite: `DATABASE_URL`, `SITE_URL`, chave do cursor (fora desta Issue).
- **D6** `apps/api/src/requests/discovery-composicao.ts:56`, `:69-77` — descoberta: `DISCOVERY_CURSOR_KEY` (fora desta Issue).
- **D7** `apps/api/src/contact/contact-composicao.ts:49`, `:67-68` — contato: `PHONE_ENC_KEY`, `SITE_URL` (fora desta Issue).
- **D8** `apps/api/src/identity-docs/identity-doc-montagem.ts:53`, `:75` — documentos: `IDENTITY_DOCS_ENABLED` com valor exato `1`; `VERCEL_ENV` de produção exige parecer.
- **D9** `apps/api/src/media/media-composicao.ts:91` — mídia: `MEDIA_UPLOAD_ENABLED` com valor exato `1`.
- **D10** `apps/api/src/geo/composicao-sugestao.ts:77-78`, `:159`, `:168` — Mapbox e `DATABASE_URL_APP_SYSTEM` (não usado pelas duas rotas).
- **D11** `apps/api/src/drafts/compose.ts:42-62` — rascunho: três constantes de nome (valores não confirmados nesta rodada).
- **D12** `apps/api/src/admin-composicao.ts:2` e `apps/api/src/app.ts:423-424` — `ADMIN_BASE_URL` e `DATABASE_URL_APP_SYSTEM` para as rotas admin e titular.
- **D13** `.env.example` — nomes confirmados por leitura integral: `APP_ENV` (:15), `ADMIN_BASE_URL` (:17), `DATABASE_URL_APP_API` (:22), `DATABASE_URL_APP_SYSTEM` (:23), `PEPPER_*` (:29-31), `CATALOG_RATE_HMAC_KEY` (:33), `DOCUMENT_HMAC_KEY` (:34), `DATA_ENC_KEY_*` (:35-36), `SESSION_COOKIE_SECRET` (:37), `JOBS_TICK_SECRET` (:38), `DRAFT_IP_HMAC_KEY` (:45), `REQUEST_PUBLISH_HMAC_KEY` (:47), `DISCOVERY_CURSOR_KEY` (:49), `IDENTITY_DOCS_READER_KEY` (:59), `SITE_URL` (:43), `ADDRESS_HASH_KEY` (:76), `ADDRESS_ENC_KEY` (:78), `PHONE_ENC_KEY` (:80), `MAPBOX_PERMANENT_*` (:73-74).
- **D14** `.env.example` — **não contém** `PROFILE_RATE_HMAC_KEY` nem `DSR_EXTRATO_CHAVE_ASSINATURA` (leitura integral, linhas 1 a 111).
- **D15** `scripts/check-env-example.mjs:24-32`, `:40-42`, `:47-48`, `:61-75` — regras: nomes sem valor, sem duplicata, `.gitignore` com `.env`, `.env.*` e `!.env.example`, e todo `process.env.X` de código (fora de `docs/` e `scripts/`) deve estar no modelo.
- **D16** `.gitignore:2-4` — `.env`, `.env.*`, `!.env.example`.
- **D17** `supabase/README.md:15-16`, `:24`, `:47-49`, `:39-43` — executor de migração por `DATABASE_URL_MIGRATIONS`; papéis `NOLOGIN` sem senha; login manual com `DB_PASSWORD_*`; pooler `papel.<ref>`; `pg_cron` e `pg_net` desativados pelo dono.
- **D18** `supabase/migrations/20261110120000_platform_create_baseline.sql:71-75` — `app_api` `NOINHERIT NOBYPASSRLS`; `app_system` `NOINHERIT BYPASSRLS`.
- **D19** `supabase/migrations/20261111250000_catalog_public_list_function.sql:13-15`, `:39-42` — `app_api` sem grant direto no catálogo; leitura pela função `private.catalog_public_list()`, com `EXECUTE` só para `app_api`. Logo, o login de `app_api` precisa herdar `EXECUTE` (E1).
- **D20** `package.json` (raiz) — não há script `dev`; `check:all` na linha 34; `engines` `>=22.14.0 <23`.
- **D21** `apps/api/package.json` e `apps/web/package.json` — sem script `dev`; web com `build` e `test:e2e`, sem servidor de desenvolvimento.
- **D22** `apps/api/tests/app.test.ts:19-26` — teste monta a API com `node:http`; é o padrão para o servidor local.
- **D23** `apps/api/src/session-route.ts:2`, `:30`, `:172` — `POST /v1/auth/session`; negação única sem `Set-Cookie`.
- **D24** `apps/api/src/catalog/catalog-route.ts:1` — `POST /v1/catalog/service-search`.
- **D25** `.env.example:57-59` — `IDENTITY_DOCS_READER_KEY` é credencial real de leitura de Storage, não chave aleatória.

---

## 8. Perguntas (numeração a partir de 970; máximo 8)

Enviadas ao líder. Nenhuma pergunta vai ao usuário neste refino. Cada item traz a recomendação do líder e o que destrava.

**970. Valor de `APP_ENV` no DEV.** O que é: um texto que diz ao sistema em que ambiente ele roda. Por que importa: as fontes dão valores diferentes (`.env.example:62` lista `local`, `.env.example:71` cita `development`); o valor errado muda o provedor de e-mail e a publicação.
- (a) `local` — aceito pela lista fechada do e-mail (`.env.example:62`). **Recomendado**, após confirmar `packages/email/src/env.ts`.
- (b) `development` — citado para o provedor de publicação (`.env.example:71`).
- (c) `test`.
- Destrava: E2 e E4 (configuração do `.env.local` e do script `dev`).

**971. Limites de Mapbox no DEV.** O que é: o número máximo de consultas de mapa que o sistema pode fazer no mês de teste. Por que importa: consumo de cota paga; as duas rotas pedidas não usam Mapbox.
- (a) Preencher com valores pequenos (ex.: 200 e 300) para o caso de endereço.
- (b) Preencher com valores maiores (ex.: 1.000 e 1.500), sem verificar a cota gratuita do provedor (`[NÃO VERIFICADO]`).
- (c) Deixar vazio: a rota de endereço fica fechada. **Recomendado**, porque não consome cota e não bloqueia as duas rotas.
- Destrava: nada nesta Issue; só a rota de endereço.

**972. Escopo das variáveis do `.env.local`.** O que é: quais chaves gerar agora. Por que importa: a lista original não inclui `CATALOG_RATE_HMAC_KEY` nem `SITE_URL`, sem as quais a busca não responde (D1).
- (a) Só as necessárias para as duas rotas e a sessão (`CATALOG_RATE_HMAC_KEY`, `SITE_URL`, `APP_BASE_URL`, `SESSION_COOKIE_SECRET`, `AUTH_CHALLENGE_KEY`, `JOBS_TICK_SECRET`, chaves de pepper e criptografia já listadas). **Recomendado**.
- (b) Todas as chaves de `.env.example` de uma vez.
- (c) Só a lista original do líder. Não basta para as rotas pedidas.
- Destrava: E2 e a validação de CA-156-07 e CA-156-08.

---

## 9. Veto (adotado pelo líder como recomendação, sem resposta exigida)

- Papéis de login com `WITH INHERIT` sobre `app_api` e `app_system`, sem `BYPASSRLS` no login (E1, CA-156-01).
- Senhas gravadas só no `.env.local`; nenhuma migração com senha (E1, CA-156-02).
- Conexão pelo pooler do Supabase; teste de `set_config` por transação antes de liberar (R-156-05).
- Gerar somente chaves ausentes; nunca regenerar valor preenchido (E2, CA-156-04).
- `IDENTITY_DOCS_READER_KEY`, flags de identidade e mídia, e todas as variáveis de e-mail ficam vazias (E2).
- Login de keep-alive e backup fora do escopo (E2, seção 4).
- SQL de login via `npx supabase` (CLI), sem MCP e sem Docker.
- `PROFILE_RATE_HMAC_KEY` e `DSR_EXTRATO_CHAVE_ASSINATURA` entram no `.env.example` somente se o código os lê (E3).

---

## 10. Pendências técnicas para a Arquitetura

1. Confirmar, em `vercel.json` e no ponto de entrada da função, o prefixo real das rotas e quais fábricas de pool já são injetadas (A-1; R-156-01).
2. Confirmar a versão do PostgreSQL do DEV e a existência do subcomando de SQL da CLI instalada (R-156-08 e R-156-09).
3. Buscar no código `PROFILE_RATE_HMAC_KEY`, `DSR_EXTRATO_CHAVE_ASSINATURA` e as três constantes de `drafts/compose.ts` (D11, D14).
4. Confirmar o corpo válido de `POST /v1/catalog/service-search` e o corpo mínimo de `POST /v1/auth/session` (CA-156-07, CA-156-08).
5. Confirmar que a semente do catálogo (`db:seed:catalog`) está carregada no DEV. Sem ela, a busca responde 200 com lista vazia, o que não prova o caminho feliz.
