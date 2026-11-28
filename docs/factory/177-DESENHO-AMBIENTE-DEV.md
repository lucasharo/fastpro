# Desenho 177 — Ambiente DEV executável (Issue #156)

- **Issue:** #156 · **Workflow:** WF-03 · **Etapa:** Arquitetura · **EXEC-ID:** EXEC-ARQ-156-20261121
- **Entrada:** `docs/factory/174-REFINO-AMBIENTE-DEV.md` (PO). Perguntas 970 a 972 ADOTADAS: `APP_ENV=local`; limites de Mapbox vazios; só as chaves das duas rotas e da sessão.
- **Escopo adicional (decidido pelo líder, adotado, vetável pelo dono):** a API passa a ser publicada como função DENTRO do projeto Vercel `fastpro-web` (mesma origem, ADR-018). Nenhum primeiro envio de produção; o projeto vazio `fastpro-api` fica como está.
- **Natureza:** somente documento. Nenhum código, quadro, `11-DECISOES.md` ou `.env.local` alterado; nenhum valor de `.env.local` lido ou impresso (só se cada nome está preenchido, vazio ou ausente).
- **Etiquetas:** `[VERIFICADO]` lido no repositório/CLI · `[DECISÃO]` deste desenho · `[NÃO VERIFICADO]` depende de prova na fatia indicada.

---

## 1. Achados que mudam o plano do refino 174

| # | Achado | Efeito |
|---|---|---|
| F-1 | `[VERIFICADO]` O ponto de entrada `apps/api/src/vercel.ts` JÁ injeta todas as fábricas (`fabricaCatalogo`, `abrirClienteApi`, `abrirClienteSistema`, `fabricaRascunho`, `abrirConexaoDedicada`) usando `catalog/fabrica-pg.ts` + `catalog/pool-pg.ts` (pool `pg`, max 2) e `sql-pool.ts`. O 404 "fábrica ainda não montada" (`composicao.ts:273-274`) não ocorre nesse caminho. | Não se escreve adaptador de pool novo. O script `dev` só precisa ligar um `node:http` ao `export default` de `apps/api/dist/vercel.js`. R-156-01 cai para "baixo". |
| F-2 | `[VERIFICADO]` `app.ts:274-278` (`routePath`) já remove o prefixo `/api` do caminho. Rotas internas são `/v1/...`; a URL pública é `/api/v1/...`. | A reescrita `/api/v1 -> /v1` NÃO é necessária no código. A ambiguidade A-1 está resolvida: o prefixo público é `/api`. |
| F-3 | `[VERIFICADO]` `apps/web/vercel.json` não tem `rewrites`; só `cleanUrls` e `headers`. `apps/api/vercel.json` tem só `regions: [gru1]` e `functions."api/index.ts".maxDuration 300`. Hoje nada encaminha `/api/*` na web. | A hospedagem na `fastpro-web` exige função em `apps/web/api/` (seção 7). |
| F-4 | `[VERIFICADO]` A web chama a API por caminho relativo (`globalThis.fetch(caminho, ...)` em `public/*.js`). | Mesma origem local reproduz a produção: um único servidor serve `public/` e `/api/*`. Sem CORS. |
| F-5 | `[VERIFICADO][DECISÃO]` Atributo de papel NÃO é herdado por membership (`LOGIN`, `SUPERUSER`, `CREATEROLE`, `BYPASSRLS` valem só para o próprio papel). Privilégios de objeto (grants, `EXECUTE` de `private.catalog_public_list()`) são herdados. Configurações de papel (`ALTER ROLE ... SET`) também NÃO são herdadas. | Corrige o refino: `fastpro_dev_system` precisa ter `BYPASSRLS` próprio para se comportar como `app_system` (a alternativa, `SET ROLE` por conexão, quebra o pooler em modo transação e exigiria mudança de código). Não é privilégio a mais: é o mesmo de `app_system`. `fastpro_dev_api` segue sem `BYPASSRLS`. CA-156-01 passa a exigir `rolbypassrls = t` só no login de sistema. As configurações de papel de `app_api`/`app_system` (`pg_db_role_setting`) são copiadas para os logins. |
| F-6 | `[VERIFICADO]` `.env.local` (só estado dos nomes): preenchidas `DATABASE_URL_MIGRATIONS`, `CATALOG_RATE_HMAC_KEY`, `SITE_URL`, `AUTH_CHALLENGE_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`. Ausentes: `DATABASE_URL_APP_API`, `DATABASE_URL_APP_SYSTEM`, `DB_PASSWORD_APP_API/SYSTEM`, `APP_ENV`, `APP_BASE_URL`, `SESSION_COOKIE_SECRET`, `JOBS_TICK_SECRET`, `PEPPER_EMAIL_HMAC`, `PEPPER_CODE_HMAC`, `PEPPER_IP_HMAC` e as demais chaves de domínio. | `CATALOG_RATE_HMAC_KEY` e `SITE_URL` já existem: o gerador NÃO as toca. O comprimento mínimo de 32 de `CATALOG_RATE_HMAC_KEY` não foi conferido (só valor, proibido ler): o gerador verifica por tamanho sem imprimir e apenas avisa "curta" por nome; não troca a chave. |
| F-7 | `[VERIFICADO]` Não há `supabase/config.toml` no repositório; a CLI instalada é a `3.2.0` e tem `supabase db query [--remote[=<ref\|branch\|url>]] [--file/-f <arquivo>] [--read-only] [<sql>]`; mudança em banco hospedado exige `--yes` (ou `SUPABASE_YES` exportada no shell). | Existe subcomando oficial para SQL, sem MCP e sem Docker. Ver decisão D-3 sobre por que a criação do login usa o executor `pg` do repositório e a CLI fica para verificação e desfazimento. |
| F-9 | `[VERIFICADO]` **A rota `POST /v1/auth/session` NÃO está montada na função.** `app.ts:538-545` só a atende se `opts.session` existir, e `vercel.ts` nunca passa `session` (busca por `session:` na API só acha o tipo e os testes). `PgSessionRepository` (`packages/db/src/session.ts:43`, recebe um `SqlClient`) existe e é usado só em testes. Logo, mesmo com banco e chaves, a sessão responde 404 hoje. | Falta código, ao contrário do que o refino supunha: fatia F5b cria `apps/api/src/session-composicao.ts` (`montarSessao(env, { abrirCliente })`) e a liga em `vercel.ts` (`...(sessao !== undefined ? { session: sessao } : {})`). Sem `proof`/`challenge` (step-up fica fora): só conversão, `logout` e `logout-all`. É a única mudança de código de API desta Issue. |
| F-10 | `[VERIFICADO]` `checkConsumeHeaders` (`packages/domain/src/identity/consume.ts:97-108`): `Origin` deve ser IGUAL à origem de `SITE_URL` (sem `Origin`, 403 `origem_invalida`); `Sec-Fetch-Site`, se enviado, deve ser `same-origin`; `Content-Type` deve ser `application/json` (senão 415). `curl` não envia `Sec-Fetch-Site`. | Os `curl` da prova enviam `Origin` e `Content-Type` explícitos. A resposta sem cookie de etapa é 401 `ACCESS_EXPIRED_BODY` (`session-route.ts:200`), não 200: é o caminho feliz possível sem uma etapa real de login. |
| F-8 | `[VERIFICADO]` Nomes lidos com `env.X` (não `process.env.X`) e ausentes de `.env.example`: `PROFILE_RATE_HMAC_KEY` (`professional-offering-composicao.ts:67`) e `DSR_EXTRATO_CHAVE_ASSINATURA` (`privacy-composicao.ts:120`). `check:env` só olha `process.env.X` literal, por isso passa hoje. | E3: entram em `.env.example` (nome sem valor) por higiene, junto aos nomes novos dos scripts desta Issue. |

---

## 2. Decisões

- **D-1 Superfície local única.** `pnpm dev` sobe UM servidor `node:http` em `127.0.0.1:3000` (porta por `DEV_PORT`): `/api/*` vai ao handler de produção (`apps/api/dist/vercel.js`, o mesmo código da Vercel) e o resto serve `apps/web/public/` com a mesma regra de `cleanUrls` e os cabeçalhos de `apps/web/vercel.json` que importarem para o teste. Justificativa: reproduz a mesma origem da ADR-018, elimina CORS e reaproveita `routePath` sem reescrita. Alternativas descartadas: dois servidores com proxy (duas origens, quebra a regra de `Origin = SITE_URL`); Vercel CLI `vercel dev` (exige conta/projeto e rede).
- **D-2 `SITE_URL` no runtime local.** `.env.local` já tem `SITE_URL` (valor não lido, provavelmente de outra origem). O script `dev` carrega `.env.local` e DEPOIS força, só no processo, `SITE_URL=http://127.0.0.1:<porta>` (e `APP_BASE_URL` se ausente). Nada é regravado no arquivo. Motivo: as rotas exigem `Origin` igual à origem de `SITE_URL`. Usar `127.0.0.1` e nunca `localhost` na prova (em Windows `localhost` pode resolver para `::1` e a origem seria outra).
- **D-3 Criação dos logins pelo executor `pg` do repositório, verificação e desfazimento pela CLI.** O SQL de criação carrega segredo. Passar senha em `npx supabase db query` a colocaria em argumento de processo ou arquivo temporário. Solução: o script calcula o verificador SCRAM-SHA-256 da senha (Node stdlib: `crypto.pbkdf2Sync`, 4096 iterações) e executa `CREATE/ALTER ROLE ... PASSWORD '<verificador>'` pelo cliente `pg` (mesmo executor de `db.mjs`, via `DATABASE_URL_MIGRATIONS`). O servidor recebe só o verificador, nunca a senha em texto, e a senha em texto nunca vai para argv, arquivo, log ou migração. A CLI `npx supabase db query --read-only` roda as consultas de prova (CA-156-01) e `--file supabase/rollbacks/dev-logins.down.sql --yes` desfaz (sem segredo nenhum nesses SQL). Alternativa descartada: `ALTER ROLE ... PASSWORD 'texto'` pela CLI (texto em argv).
- **D-4 Nomes dos logins:** `fastpro_dev_api` (membro de `app_api`) e `fastpro_dev_system` (membro de `app_system`). Sufixo `dev` evita colisão com futuros logins de produção.
- **D-5 Senhas:** 48 caracteres hexadecimais (24 bytes aleatórios, `crypto.randomBytes`), só `.env.local` (`DB_PASSWORD_APP_API`, `DB_PASSWORD_APP_SYSTEM`). Hexadecimal dispensa codificação na URL.
- **D-6 Conexão:** as URLs `DATABASE_URL_APP_API` e `DATABASE_URL_APP_SYSTEM` são derivadas por script de `DATABASE_URL_MIGRATIONS` (mesmo host, porta e banco), trocando só usuário e senha. Se o usuário atual tem sufixo de projeto (`postgres.<ref>`), o novo usuário é `fastpro_dev_api.<ref>` (formato do pooler, `supabase/README.md:47-49`). Porta mantida igual à da migração (sessão); a prova do `set_config` por transação (pendência 1 do README) é a fatia F0.2 e vale também para a porta de transação, que será a de produção.
- **D-7 Geração de chaves por grupos.** Gerador padrão cria só o grupo `rotas-minimas` (pergunta 972a). Outros grupos existem como opção explícita para as Issues seguintes, sem criar chave nenhuma agora.
- **D-8 `APP_ENV=local`** (970a), gravado só se ausente. `VERCEL_ENV` fica indefinido localmente.
- **D-9 Mapbox vazio (971c):** o gerador não preenche `MAPBOX_*`; rotas de endereço seguem fechadas por desenho.

---

## 3. Logins dedicados (desenho do SQL)

Constantes no script: `fastpro_dev_api` e `fastpro_dev_system`; nomes validados por `^[a-z_][a-z0-9_]{0,62}$` e inseridos com `format('%I')`.

Criação (idempotente, numa transação, executada só se o papel não existe):

```sql
-- $VERIF = verificador SCRAM calculado no cliente (nunca a senha em texto)
CREATE ROLE fastpro_dev_api LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 10 PASSWORD '<verificador>';
CREATE ROLE fastpro_dev_system LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS
  CONNECTION LIMIT 10 PASSWORD '<verificador>';
-- PostgreSQL >= 16 (detectado por server_version_num):
GRANT app_api    TO fastpro_dev_api    WITH INHERIT TRUE, SET FALSE;
GRANT app_system TO fastpro_dev_system WITH INHERIT TRUE, SET FALSE;
-- PostgreSQL < 16: GRANT app_api TO fastpro_dev_api; (a herança vem do INHERIT do membro)
```

Regras:
1. Nenhum login é membro do papel de aplicação alheio. `SET FALSE` impede `SET ROLE` para o papel base.
2. Copiar configuração de papel: para cada linha de `pg_db_role_setting` com `setrole = app_api` (ou `app_system`), aplicar `ALTER ROLE <login> SET <chave> = <valor>` (ex.: `statement_timeout`, `search_path`). `[NÃO VERIFICADO]` o conteúdo atual; a fatia F0.2 lista e compara.
3. Papel já existe: não recria. Testa login com a URL do `.env.local` (SELECT 1). Falha `28P01` (senha divergente) não regrava nada sozinha: o script para e sugere `--rotacionar-login` (só altera a senha dos dois logins DEV com a senha que está no `.env.local`; não afeta dados).
4. Versão do Postgres e sintaxe: lidas na execução (`show server_version_num`). `[NÃO VERIFICADO]` a versão do banco DEV.
5. Trava: reutiliza o `demo-guard.mjs` (aceita o banco DEV por padrão, recusa qualquer outro, sem flag de força) antes de qualquer DDL.

Desfazimento (`supabase/rollbacks/dev-logins.down.sql`, sem segredo, não é migração e não entra em `supabase/migrations/`):

```sql
DROP ROLE IF EXISTS fastpro_dev_api;
DROP ROLE IF EXISTS fastpro_dev_system;
```

(Os papéis não possuem objetos; a membership some junto. Executar com `npx supabase db query --remote=<url> --yes --file ...` ou pelo `--remover` do script.) Após remover, o script `dev` volta a falhar por nome obrigatório ausente.

Ordem de gravação (nunca perde a senha): (1) gera a senha e grava no `.env.local` as linhas ausentes; (2) cria/ajusta o papel; (3) testa o login; (4) imprime só "ok/falha" por login.

---

## 4. Script de provisionamento e gerador de chaves

Arquivos novos (Node stdlib; `pg` só no provisionador, que mora em `packages/db/scripts/` onde `pg` já é dependência):

| Arquivo | Papel |
|---|---|
| `scripts/lib/env-local.mjs` | Lê/escreve `.env.local` de forma segura: `lerEstado()` devolve só `{nome: preenchida\|vazia\|ausente}` e o hash SHA-256 de cada valor preenchido; `acrescentarAusentes(entradas)` regrava por arquivo temporário no mesmo diretório + `rename`, preservando linhas, comentários e quebras existentes. Nunca altera linha existente. |
| `scripts/gerar-chaves-dev.mjs` | Gera só nomes ausentes ou vazios dos grupos pedidos. Imprime só nomes e contagens. |
| `packages/db/scripts/dev-logins.mjs` | Provisiona os dois logins (seção 3), grava as 4 variáveis de banco e testa o login. Opções: `--rotacionar-login`, `--remover`, `--verificar`. |
| `supabase/rollbacks/dev-logins.down.sql` | Desfazimento. |
| `scripts/dev-local.mjs` | Servidor local (seção 6). |
| `scripts/__tests__/gerar-chaves-dev.test.mjs`, `scripts/__tests__/env-local.test.mjs`, `scripts/__tests__/dev-local.test.mjs` | Testes com `node --test` em diretório temporário (nunca no `.env.local` real). |

Scripts do `package.json` raiz (novos):
`"dev:chaves": "node scripts/gerar-chaves-dev.mjs"`, `"db:dev:logins": "node packages/db/scripts/dev-logins.mjs"`, `"predev": "node scripts/dev-prepara.mjs"` (builds, ver F5), `"dev": "node scripts/dev-local.mjs"`.

**Gerador (regras):**
- Aleatoriedade: `crypto.randomBytes(32).toString('hex')` (64 caracteres; atende o mínimo de 32).
- Só preenche nome ausente ou vazio. Nunca sobrescreve valor preenchido. Entradas derivadas (literais, não segredo): `APP_ENV=local`, `APP_BASE_URL=http://127.0.0.1:3000`.
- Prova de não regeneração: antes, calcula SHA-256 de cada valor preenchido; depois, recalcula e exige igualdade; grava os hashes (não os valores) no relatório. Segunda execução imprime `geradas: 0`.
- Saída: `geradas: N (nomes...)`, `mantidas: M`, `curtas: [nomes]` (só nome). Sem valor, tamanho ou prefixo.
- Cria o arquivo `.env.local` se não existir? Não: se não existir, falha com instrução (o dono já o tem).

---

## 5. Variáveis por origem

Rotas e variáveis `[VERIFICADO]` (código lido):

| Rota | Variáveis obrigatórias |
|---|---|
| `POST /api/v1/catalog/service-search` (`catalog/compose.ts:9-13,33-38`) | `DATABASE_URL_APP_API`; `CATALOG_RATE_HMAC_KEY` (>= 32); `SITE_URL`. Cabeçalhos: `Origin` com a origem de `SITE_URL`, `Content-Type: application/json`; corpo só `{"q": "<termo 2..80>"}`, até 1 KB. |
| `POST /api/v1/auth/session` (`session-route.ts:173-200`, `app.ts:538-540`) | Hoje NÃO montada (F-9). Após F5b: `DATABASE_URL_APP_SYSTEM` (papel `app_system`, função `private.app_session_convert`) e `SITE_URL`; corpo exatamente `{}` com `Content-Type: application/json` e `Origin` igual à origem de `SITE_URL`; cookie de etapa ausente produz 401 de acesso expirado (não 404, sem `Set-Cookie`). `[DECISÃO]` a montagem da sessão exige só esses dois nomes (o repositório de sessão não usa pepper, `AUTH_CHALLENGE_KEY` nem Supabase). Os demais nomes do consumo/verificação (`CONSUMO_LINK_ENV_OBRIGATORIAS`: `AUTH_CHALLENGE_KEY`, `PEPPER_*`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`) valem para as rotas de login por link/código (fora das duas rotas da prova), mas ficam no grupo `rotas-minimas` porque a sessão só tem sentido com o login. |

| Variável | Origem | Observação |
|---|---|---|
| `DATABASE_URL_MIGRATIONS` | já existe | Só o provisionador e `db:*` usam. A API nunca. |
| `SITE_URL`, `CATALOG_RATE_HMAC_KEY`, `AUTH_CHALLENGE_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | já existem | Não tocadas. `SITE_URL` é sobreposta só no processo do `dev` (D-2). |
| `DB_PASSWORD_APP_API`, `DB_PASSWORD_APP_SYSTEM`, `DATABASE_URL_APP_API`, `DATABASE_URL_APP_SYSTEM` | gerada pelo `db:dev:logins` | Senha aleatória; URLs derivadas (D-6). |
| `PEPPER_EMAIL_HMAC`, `PEPPER_CODE_HMAC`, `PEPPER_IP_HMAC` | gerada (`rotas-minimas`) | Lidas por `consumo-link-composicao.ts:157-161`. |
| `SESSION_COOKIE_SECRET`, `JOBS_TICK_SECRET` | gerada (`rotas-minimas`) | `JOBS_TICK_SECRET` lida em `vercel.ts:66`. |
| `APP_ENV` (`local`), `APP_BASE_URL` | gerada/derivada (literal) | Só se ausentes. |
| `DOCUMENT_HMAC_KEY`, `DATA_ENC_KEY_V1`, `DATA_ENC_KEY_ACTIVE_VERSION`, `DRAFT_IP_HMAC_KEY`, `REQUEST_PUBLISH_HMAC_KEY`, `DISCOVERY_CURSOR_KEY`, `ADDRESS_HASH_KEY`, `ADDRESS_ENC_KEY`, `PHONE_ENC_KEY`, `PROFILE_RATE_HMAC_KEY`, `DSR_EXTRATO_CHAVE_ASSINATURA`, `CRON_SECRET` | gerável, FORA da Issue (grupos `pedido`, `profissional`, `privacidade`) | Não geradas agora (972a). Para quando outras Issues exigirem. Se `DATA_ENC_KEY_ACTIVE_VERSION` for exigida, é o literal da versão, não aleatória. |
| `ADMIN_BASE_URL` | derivada, fora | Sem ela rotas admin seguem 404. |
| `IDENTITY_DOCS_READER_KEY`, `SUPABASE_*` de Storage além das existentes | credencial real que o dono fornece | Não aleatória; rota de Verificação segue fechada. |
| `IDENTITY_DOCS_ENABLED`, `MEDIA_UPLOAD_ENABLED` | flag; ausente = fechada | Não definir. |
| `EMAIL_*`, `RESEND_*` | não gerar | Sem envio em DEV. Em `.env.local` já existe `RESEND_API_KEY` (credencial do dono, não usada pelas duas rotas). |
| `MAPBOX_*` | vazio (971c) | Sem cota consumida. |
| `MERCADO_PAGO_*`, `DATABASE_URL_KEEPALIVE`, `DATABASE_URL_BACKUP_READ`, `DB_PASSWORD_APP_KEEPALIVE`, `DB_PASSWORD_APP_BACKUP_READER` | fora de escopo | Backup fora do projeto; keep-alive por decisão do dono. |

**Variáveis que o script `dev` exige (falha com código `2` listando só os nomes que faltam):** `DATABASE_URL_APP_API`, `DATABASE_URL_APP_SYSTEM`, `CATALOG_RATE_HMAC_KEY`, `SITE_URL` (ou o override), `PEPPER_EMAIL_HMAC`, `PEPPER_CODE_HMAC`, `PEPPER_IP_HMAC`, `SESSION_COOKIE_SECRET`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `APP_ENV`. A lista final é confirmada na fatia F0.1 contra a montagem do consumo (nota 1).

`.env.example` (E3, só nomes, sem valor): acrescentar `PROFILE_RATE_HMAC_KEY`, `DSR_EXTRATO_CHAVE_ASSINATURA`, `DEV_PORT`. `check:env` valida sem duplicata e sem valor.

---

## 6. Script `dev` local (`scripts/dev-local.mjs`)

1. `process.loadEnvFile('.env.local')` (Node 22). Falha com código `2` se o arquivo não existir.
2. Confere os nomes exigidos (seção 5); imprime só os que faltam; sai `2` sem subir servidor.
3. Sobrepõe `SITE_URL=http://127.0.0.1:<DEV_PORT|3000>` e `APP_BASE_URL` se ausente; força `VERCEL_ENV` indefinido; recusa iniciar se `APP_ENV` for `production` (condição "diferente de production", sem imprimir o valor).
4. `import(apps/api/dist/vercel.js)`; se o arquivo não existir, orienta `pnpm dev` (o `predev` já compila) e sai `2`.
5. Servidor `node:http` em `127.0.0.1`: caminho começando por `/api/` ou igual a `/api` vai ao handler; senão serve `apps/web/public/` (arquivo exato, depois `<nome>.html`, depois `<pasta>/index.html`; tipos `.html .js .css .svg .png .json`; bloqueia `..`; `Cache-Control: no-store`). Cabeçalhos de segurança básicos (`X-Content-Type-Options: nosniff`). 404 simples para o resto.
6. Não grava arquivo, não envia e-mail, não chama serviço além do banco DEV, não imprime valores. Log: `API e web em http://127.0.0.1:3000` e a lista de rotas ligadas/pendentes obtida do mesmo `montarIntegracoes` (só nomes de pendências, ex.: `pendencias` de `composicao.ts`) para eliminar 404 silencioso.
7. Encerra limpo em SIGINT.

`predev` (`scripts/dev-prepara.mjs`): `pnpm --filter "@fastpro/api..." build` (compila `@fastpro/db`, `domain`, `email`, `api`), `pnpm --filter @fastpro/web run copy:tokens` e `build:fotos-envio` (gera `public/tokens.css` e o envio de fotos). Falha do build interrompe o `dev`.

Teste automatizado (`dev-local.test.mjs`): sobe o servidor com um handler falso na porta `0`, confere `/api/x` -> handler, `/pedido` -> `pedido.html`, `/../.env.local` -> 404, e que falta de nome obrigatório retorna código `2` sem abrir porta.

---

## 7. Mudanças de hospedagem (API dentro de `fastpro-web`)

Só depois que o ambiente local estiver executável (fatias F0 a F6 verdes). Nenhum envio de produção; apenas preview da branch `feature/init`.

1. `apps/web/api/[...caminho].ts` (função catch-all) com `export { default } from '../../api/src/vercel.js';` (reutiliza o handler e `routePath` já remove `/api`). Catch-all atende `/api/v1/...` sem `rewrites`; se a Vercel não resolver o catch-all para o projeto sem framework, o plano B é `apps/web/api/index.ts` + `rewrites: [{ "source": "/api/(.*)", "destination": "/api" }]` (o handler recebe a URL original, `[NÃO VERIFICADO]`).
2. `apps/web/vercel.json`: acrescentar `"regions": ["gru1"]` e `"functions": { "api/**/*.ts": { "maxDuration": 300 } }` (trazidos de `apps/api/vercel.json`). Manter `headers` atuais. `apps/api/vercel.json` e `apps/api/api/index.ts` ficam como estão (o projeto `fastpro-api` vazio não é tocado; remover só por decisão futura).
3. `apps/web/package.json`: `devDependencies` + `"@fastpro/api": "workspace:*"` para o `turbo` compilar a API antes da web e a Vercel rastrear `pg`, `sharp` e `@vercel/functions`. `buildCommand` e `installCommand` do projeto `fastpro-web` conforme o monorepo (raiz do projeto `apps/web` com "incluir arquivos fora da raiz" ligado, padrão).
4. Variáveis de ambiente na Vercel (escopo Preview apenas): mesmos nomes da seção 5. Valores só pelo dono ou pelo MCP/CLI da Vercel; nunca no repositório. O preview apontaria ao banco DEV com os logins `fastpro_dev_*`, mas isto só se liga com autorização do líder e fica FORA da prova de aceite da #156.
5. Sem domínio, sem produção, sem `vercel --prod`.

Riscos de hospedagem: tamanho do pacote da função (`sharp`, binário nativo Linux); resolução de workspace no rastreio da Vercel; catch-all em projeto estático; tempo de build da cadeia `db -> domain -> email -> api`.

---

## 8. Fatias de Dev (curtas, com provas)

Todas na raiz `D:\projetos\fastpro`, branch `feature/init`, Node 22 e `corepack pnpm`. Código de saída e contagem na Issue.

**F0.1 Verificações de pré-condição (somente leitura).**
Comandos: `npx supabase --version` (esperado `3.2.0`); `npx supabase db query --remote="$(node -e "...")" --read-only "show server_version_num"` ou executar a consulta pelo `pg` do repositório sem imprimir a URL (se a CLI exigir login/link, registrar e usar o executor `pg`); `select rolname, rolcanlogin, rolbypassrls from pg_roles where rolname in ('app_api','app_system')` (esperado `f/f` e `f/t`); `select setrole::regrole, setconfig from pg_db_role_setting` (esperado: lista das configurações a copiar); conferir a montagem de `consumo-link-composicao.ts` (nota 1).
Prova: saída das consultas e confirmação da lista de variáveis exigidas.

**F1 Biblioteca e gerador de chaves.** `scripts/lib/env-local.mjs`, `scripts/gerar-chaves-dev.mjs`, testes, script `dev:chaves`, `.env.example` (3 nomes).
Provas: `corepack pnpm test:scripts` -> código `0` com os novos testes; `corepack pnpm lint:scripts` -> `0`; `corepack pnpm check:env` -> `0`; dois testes: segunda execução `geradas: 0`; hashes de valores preexistentes idênticos; `node -e` imprime só `ok` ou o nome da chave curta.

**F2 Provisionador dos logins.** `packages/db/scripts/dev-logins.mjs`, rollback, script `db:dev:logins`, testes unitários do cálculo do verificador SCRAM (vetor conhecido RFC 7677) e do derivador de URL (URL fictícia, sem valores reais).
Provas: `corepack pnpm test:scripts` -> `0`; `corepack pnpm db:dev:logins -- --verificar` antes de criar imprime `fastpro_dev_api: ausente`.

**F3 Criar os logins no DEV e gravar as variáveis.** `corepack pnpm dev:chaves` e `corepack pnpm db:dev:logins`.
Provas (CA-156-01): `npx supabase db query --remote=<url> --read-only "select rolname, rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls from pg_roles where rolname in ('fastpro_dev_api','fastpro_dev_system','app_api','app_system') order by 1"`. Esperado: `fastpro_dev_api` `t/f/f/f/f`; `fastpro_dev_system` `t/f/f/f/t`; `app_api` `f/.../f`; `app_system` `f/.../t`. E `select pg_has_role('fastpro_dev_api','app_system','USAGE'), pg_has_role('fastpro_dev_system','app_api','USAGE')` -> `f | f`; `pg_has_role('fastpro_dev_api','app_api','USAGE')` -> `t`. Segunda execução de `db:dev:logins` -> `nada a fazer`, código `0`. CA-156-02: `git check-ignore -v .env.local` -> `0`; `git ls-files --error-unmatch .env.local` -> diferente de `0`; `git grep -nE "postgres(ql)?://[^[:space:]]+:[^[:space:]@]+@" -- . ":!.env.local"` -> `1`; `corepack pnpm check:secrets` -> `0`.

**F4 Menor privilégio comprovado (CA-156-09).** Teste pelo cliente `pg` com a URL do login (sem imprimir): como `fastpro_dev_api`, `select count(*) from app.app_session` -> erro de permissão (`42501`) ou 0 linhas; `drop table app.app_session` e `alter table ... ` -> `42501`; `set role app_system` -> erro. Código de saída `0` do script de prova (`packages/db/scripts/dev-logins.mjs --verificar`).

**F5 Script `dev` e `predev`.** `scripts/dev-local.mjs`, `scripts/dev-prepara.mjs`, teste, scripts `dev` e `predev`.
Provas: `corepack pnpm test:scripts` -> `0`; com `DATABASE_URL_APP_API` removido de um `.env.local` de teste em pasta temporária, `node scripts/dev-local.mjs` -> código `2`, lista só o nome, nenhuma porta aberta (CA-156-06); `corepack pnpm check:all` -> `0`.

**F5b Montar a sessão na função (única mudança de API).** Novo `apps/api/src/session-composicao.ts` com `montarSessao(env, { abrirCliente })`: liga só com `DATABASE_URL_APP_SYSTEM` e `SITE_URL` preenchidas e fábrica de cliente; devolve `{ repo: new PgSessionRepository(cliente), siteUrl: SITE_URL, clock: { nowMs: Date.now }, newSecret: () => randomBytes(32).toString('base64url') }` (43 caracteres) e `undefined` caso contrário. `vercel.ts` passa `session` ao `handleRequest` usando `abrirClienteSistema`. Teste Vitest em `apps/api/tests/session-composicao.test.ts`: sem variáveis -> `undefined`; com variáveis e cliente falso -> opções com `newSecret()` de 43 caracteres base64url; `handleRequest` com essas opções responde 401 (não 404) a `POST /v1/auth/session` com `Origin` e corpo `{}`. Sem `proof` e sem `challenge` (step-up fora do escopo). `corepack pnpm check:boundaries` e `check:logs` seguem verdes.
Provas: `corepack pnpm --filter @fastpro/api test` -> código `0` com o novo arquivo; `corepack pnpm --filter @fastpro/api typecheck` e `lint` -> `0`; `corepack pnpm check:all` -> `0`.

**F6 Rotas respondendo no localhost (happy path, só API).** Terminal 1: `corepack pnpm dev` (esperado `API e web em http://127.0.0.1:3000`). Terminal 2, com a origem lida do ambiente do próprio script (nenhum valor é digitado nem impresso):
```
curl -s -o ../scratch/busca.json -w "%{http_code}\n" -X POST http://127.0.0.1:3000/api/v1/catalog/service-search \
  -H "Origin: http://127.0.0.1:3000" -H "Content-Type: application/json" --data '{"q":"eletri"}'
```
Esperado: `200`; o corpo é JSON com a lista de serviços e nenhuma das chaves `seed_key`, `council_body`, `regulation_source`, `moderation_sensitive`, `version`, `updated_by_ref` (`node -e` imprime `ok`). `[NÃO VERIFICADO]` que a semente do catálogo (`corepack pnpm db:seed:catalog`) já está no DEV; sem ela a resposta é `200` com lista vazia e a prova exige rodar a semente antes (comando explícito já existente; reexecução é no-op).
```
curl -s -D ../scratch/cab.txt -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:3000/api/v1/auth/session \
  -H "Origin: http://127.0.0.1:3000" -H "Content-Type: application/json" --data '{}'
```
Esperado: `401` (acesso expirado, sem cookie de etapa), diferente de `404`; `grep -ci "^set-cookie" ../scratch/cab.txt` -> `0` (CA-156-07 e CA-156-08). Contraprova da rota fechada: sem `Origin` -> código 4xx (não 200), sem `Set-Cookie`.

**F7 Fechamento.** `corepack pnpm check:all`, `test:scripts`, `lint:scripts`, `typecheck` -> `0`. Registrar na Issue comandos, contagens e códigos de saída.

Ordem de execução: F0.1, F1, F2, F3, F4, F5, F5b, F6, F7. F1 e F2 e F5b não têm arquivos em comum e são independentes; F3 depende de F1 e F2; F6 depende de F3, F5 e F5b.

**F8 (condicional, depois de F7) Hospedagem do preview.** Itens da seção 7; prova: preview da branch responde `POST /api/v1/catalog/service-search` com a mesma saída da F6. Não faz parte do aceite local da #156.

---

## 9. Riscos

| Ref. | Risco | Mitigação |
|---|---|---|
| R-177-01 | Pooler em modo transação perde estado de sessão (`set_config`). | F0.1/F6: provar com a porta usada; se falhar, o `dev` local usa a porta de sessão e o preview fica bloqueado até decisão. Pendência 1 do README. |
| R-177-02 | `BYPASSRLS` no `fastpro_dev_system` (F-5). Parece contradizer o refino. | É equivalente exato de `app_system`; confinado a login DEV; CA-156-01 ajustado; nenhum outro privilégio. |
| R-177-03 | Configuração de papel (`statement_timeout`, `search_path`) não herdada: rotas se comportariam diferente de `app_api`. | Nenhuma migração faz `ALTER ROLE app_api/app_system SET` (busca em `supabase/migrations`, `[VERIFICADO]`); o risco é baixo. Seção 3, regra 2; F0.1 lista `pg_db_role_setting`, F3 compara. |
| R-177-12 | A sessão não está montada hoje (F-9): sem F5b, a prova de `/auth/session` devolve 404 mesmo com tudo configurado. | Fatia F5b obrigatória antes da F6; teste Vitest que falha com 404. |
| R-177-13 | `PgSessionRepository` usa `private.app_session_convert`: `EXECUTE` só para o papel esperado. `[NÃO VERIFICADO]` se `app_system` tem o grant. | F0.1 consulta `has_function_privilege('app_system','private.app_session_convert(text,text,timestamptz)','EXECUTE')`; sem o grant a rota só chega a 401 antes do banco (sem cookie), então a prova de F6 não depende dele. |
| R-177-04 | `Origin` diferente de `SITE_URL` produz 4xx e falso "rota quebrada". | D-2, uso exclusivo de `127.0.0.1`. |
| R-177-05 | Falha entre gravar senha e criar papel. | Ordem de gravação da seção 3; reexecução é idempotente; `--rotacionar-login`. |
| R-177-06 | `CATALOG_RATE_HMAC_KEY` já existente com menos de 32 caracteres: rota segue 404 (`compose.ts`). | O gerador marca `curtas: [CATALOG_RATE_HMAC_KEY]` só por nome. Substituir exige decisão (a chave limita taxa, não cifra dados: risco de perda de dados é baixo) e é a única exceção à regra de nunca regenerar; vira pergunta ao líder só se ocorrer. |
| R-177-07 | Catálogo vazio no DEV: `200` com lista vazia não prova o caminho feliz. | F6 confere a semente e, se necessário, roda `db:seed:catalog`. |
| R-177-08 | Segredo em argumento, log ou arquivo temporário. | D-3 (verificador SCRAM), `check:secrets`, `check:logs`, scripts sem `console.log` de valores. |
| R-177-09 | `sharp` e workspace no pacote da função da Vercel. | Seção 7 e F8 condicional. |
| R-177-10 | `process.loadEnvFile` falha com sintaxe incomum no `.env.local`. | O teste cobre aspas e comentários; `parseEnv` de `packages/db/scripts/lib/env.mjs` é a referência de formato. |
| R-177-11 | `waitUntil` fora da Vercel não agenda envio. | Aceitável no DEV (e-mail desligado); regra do projeto: sem envio. |

---

## 10. Pendências / perguntas ao líder

Nenhuma bloqueia a Arquitetura. Adotadas como recomendação (vetáveis):
1. Logins `fastpro_dev_api` e `fastpro_dev_system`, o segundo com `BYPASSRLS` próprio (F-5).
2. Servidor local único em `127.0.0.1:3000` com `SITE_URL` forçado só no processo.
3. Criação via executor `pg` com verificador SCRAM; CLI do Supabase para verificação e desfazimento.
4. API dentro de `fastpro-web` por função catch-all, sem rewrite, só preview depois do local.
