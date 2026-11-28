# Desenho 182 — API publicada dentro do projeto fastpro-web (Issue #158)

- **Issue:** #158 `[E0] Publicar a API dentro do projeto fastpro-web na Vercel (somente preview)` · **Workflow:** WF-03 · **Etapa:** Arquitetura.
- **EXEC-ID:** EXEC-ARQ2-158-20261121 · **Repositório:** `D:\projetos\fastpro`, branch `feature/init` · **Data:** 2026-11-21.
- **Entradas:** `181-REFINO-API-NO-FASTPRO-WEB.md` (PO; perguntas 990 a 994 adotadas pelo líder), `177-DESENHO-AMBIENTE-DEV.md` (§5, §7, F8), `44-ROTEIRO-H009.md` (§2 a §4), ADR-018.
- **Natureza:** somente documento. Nenhum código, quadro, `11-DECISOES.md`, `.env.local`, Vercel ou GitHub foi alterado. Nenhum valor de credencial foi lido ou impresso.
- **Etiquetas:** `[VERIFICADO]` lido no repositório nesta rodada · `[DECIDIDO]` decisão deste desenho · `[NÃO VERIFICADO]` depende da plataforma ou de leitura que esta etapa não fez (a etapa de release confirma).

---

## 1. Achados verificados (resolvem A-158-1 e as recomendações 1 a 4 do refino)

| Ref. | Achado |
|---|---|
| A-1 | `[VERIFICADO]` `apps/api/package.json` exporta só `"."` (`dist/index.js`); `src/index.ts` reexporta `handleRequest`, `routePath` etc., **não** o handler da Vercel. O handler é `apps/api/src/vercel.ts` (`export default async function vercelHandler(req, res)`), compilado por `tsc` (`rootDir: src`, `outDir: dist`) para `apps/api/dist/vercel.js` e `vercel.d.ts` (o `dev-local` do desenho 177 já importa `apps/api/dist/vercel.js`). |
| A-2 | `[VERIFICADO]` Hoje não existe nenhum arquivo em `apps/web/api/` (Glob vazio). `apps/api/api/index.ts` é só `export { default } from '../src/vercel.js'` (exemplo estrutural do H-009, projeto `fastpro-api` vazio). |
| A-3 | `[VERIFICADO]` `routePath` (`app.ts:274`) remove o prefixo `/api` quando existe; as duas formas (`/api/v1/...` e `/v1/...`) chegam à mesma rota. Portanto catch-all e rewrite funcionam com o mesmo handler, sem mudar a API. |
| A-4 | `[VERIFICADO]` `apps/web/vercel.json` não tem `regions`, `functions`, `buildCommand`, `outputDirectory` nem `rewrites`. `apps/api/vercel.json` tem `regions: ["gru1"]` e `functions."api/index.ts".maxDuration: 300`. |
| A-5 | `[VERIFICADO]` Raiz: `build` = `turbo run build`; `turbo.json` tem `build.dependsOn: ["^build"]`, `outputs: ["dist/**"]`. `apps/web` build = `copy-tokens && build-fotos-envio && build-situacao && tsc` (gera `public/tokens.css` e `public/fotos-envio.js`, que estão no `.gitignore`: **o build precisa rodar na Vercel**, mesmo para a web estática). `dist/` também é ignorado: o handler só existe depois do build da API. |
| A-6 | `[VERIFICADO]` `scripts/check-workspace-deps.mjs` só proíbe `packages/*` dependerem de `apps/*`; `apps/web -> apps/api` é permitido. `.vercel/` e `.env.*` estão no `.gitignore`. Não há `.vercelignore`. |
| A-7 | `[VERIFICADO]` `eslint.config.mjs` já cobre `apps/*/api/**` (regra `no-console`). `apps/web/tsconfig.json` inclui só `src`: um arquivo em `api/` **não** é checado por tipos hoje. |
| A-8 | `[VERIFICADO]` Teste estático existente: `apps/web/tests/vercel-entrada.test.ts` lê `../vercel.json` e confere os cabeçalhos; é o modelo para o novo teste. Na `vercel.json` da web o CSP já usa `connect-src 'self'`: chamada `/api/...` na mesma origem é permitida sem alteração. |
| A-9 | `[VERIFICADO]` Cookies `__Host-fp_ident`, `__Host-fp_draft`, `__Host-fp_sess`. Rotas exigem `Origin` igual à origem de `SITE_URL`. Na Vercel `VERCEL_ENV=preview`: o provedor real do Mapbox (`publish-composicao.ts`) só liga com `VERCEL_ENV` ausente ou `development`; no preview ele **nunca liga** (nenhuma cota consumida). |
| A-10 | `[VERIFICADO]` As duas rotas da prova montam só com: catálogo = `DATABASE_URL_APP_API`, `CATALOG_RATE_HMAC_KEY` (>= 32), `SITE_URL`; sessão = `DATABASE_URL_APP_SYSTEM`, `SITE_URL`. Sem as demais variáveis as outras rotas ficam 404 (fechadas por padrão) e `/api/tick` responde 401 sem `JOBS_TICK_SECRET`. |

---

## 2. Decisões

**D-1. Entrada pública do handler `[DECIDIDO]`.** Acrescentar em `apps/api/package.json` a entrada `"./vercel": { "types": "./dist/vercel.d.ts", "default": "./dist/vercel.js" }` e manter `"."`. A função da web usa `export { default } from '@fastpro/api/vercel';`. Sem caminho relativo entre pacotes. Alternativa rejeitada: importar `../../api/src/vercel.js` (arquivo-fonte `.ts` de outro pacote; fora do rastreio de dependências, sem build ordenado). Observação: `apps/api/vercel.json` e `apps/api/api/index.ts` ficam intactos (CA-158-03); `package.json` da API muda apenas em `exports`.

**D-2. Função catch-all `[DECIDIDO]`.** Arquivo `apps/web/api/[...caminho].ts` com a linha de D-1. A Vercel resolve `api/[...x].ts` em projeto sem framework e casa `/api/v1/catalog/service-search` e `/api/health` (um ou mais segmentos); o caminho nu `/api` não casa (não é necessário: `/api/health` é o healthcheck). `req.url` chega com o caminho original e o `routePath` já trata o prefixo. **Plano B** (só se o preview der 404 em `/api/...`): trocar o arquivo por `apps/web/api/index.ts` e acrescentar a `vercel.json` `"rewrites": [{ "source": "/api/(.*)", "destination": "/api" }]`; `[NÃO VERIFICADO]` se o `req.url` mantém o caminho original, mas `routePath` aceita as duas formas. O plano B conta como nova tentativa (limite de 3 por etapa).

**D-3. `apps/web/vercel.json` `[DECIDIDO]`.** Manter `cleanUrls`, `headers` e `redirects` byte a byte e acrescentar:
```
"framework": null,
"regions": ["gru1"],
"buildCommand": "cd ../.. && npx turbo run build --filter=@fastpro/web...",
"outputDirectory": "public",
"functions": { "api/**/*.ts": { "maxDuration": 300 } }
```
Razões: (a) `regions` e `maxDuration` migram de `apps/api/vercel.json` (a chave passa de `api/index.ts` para o glob `api/**/*.ts`, que cobre `[...caminho].ts` e o plano B); (b) `buildCommand` versionado: o filtro `@fastpro/web...` constrói a web **e** suas dependências (`@fastpro/api`, `db`, `domain`, `email`) na ordem do `turbo` (`^build`), gerando `apps/api/dist/vercel.js` antes de a Vercel empacotar a função; (c) `outputDirectory: "public"` e `framework: null` fixam a saída estática que a web já usa (`public/`, inclusive os arquivos gerados no build). Comandos de instalação: **não** definir `installCommand`; a Vercel detecta pnpm pelo `pnpm-lock.yaml` da raiz. Fallback se o `packageManager` (`pnpm@10.34.9`) não for aceito: variável de build `ENABLE_EXPERIMENTAL_COREPACK=1` no escopo Preview. `[NÃO VERIFICADO]` que o plano gratuito aceita `maxDuration: 300`; se o build recusar, cair para `60` (opção 994c) dentro das 3 tentativas e registrar. As chaves extras (`framework`, `buildCommand`, `outputDirectory`) vão além do que o refino listou (E2): são consequência de A-5; a release confirma na leitura R0 se o projeto já tem os mesmos valores, e o PO é informado no relatório.

**D-4. Dependência `[DECIDIDO]`.** `apps/web/package.json` ganha `"@fastpro/api": "workspace:*"` em `devDependencies` (build ordenado e rastreio de `pg`, `sharp`, `@vercel/functions` pela Vercel via o symlink do workspace). `pnpm-lock.yaml` muda junto (esperado). Sem ciclo: a API não depende da web.

**D-5. Checagem de tipos da função `[DECIDIDO]`.** Novo `apps/web/tsconfig.funcoes.json` (extends `@fastpro/config/tsconfig.base.json`, `noEmit`, `include: ["api"]`, `types: ["node"]`, sem `rootDir`) e script `typecheck` da web passa a rodar `tsc -p tsconfig.json --noEmit && tsc -p tsconfig.funcoes.json --noEmit`. Sem isso o arquivo em `api/` só seria checado pelo compilador da Vercel, no envio. Se o `tsconfig.base` não permitir resolver `@fastpro/api/vercel` (ex.: `moduleResolution`), ajustar só o `tsconfig.funcoes.json`; não alterar o base.

**D-6. `.vercelignore` na raiz `[DECIDIDO]`.** Conteúdo: `.env*`, `docs`, `supabase`, `backups`, `**/test-results`. Reduz o envio pela CLI e garante que arquivos de segredo não sobem (o `.gitignore` já cobre `.env.*`, mas a CLI também lê `.vercelignore`). Não ignorar `scripts/`, `packages/` nem `apps/`.

**D-7. Variáveis só no escopo Preview, mínimo necessário `[DECIDIDO]` (pergunta 991).** Menos do que a lista do 177 §7.4 ("mesmos nomes da seção 5"), por menor privilégio: o preview só precisa das duas rotas da prova. Nomes: `DATABASE_URL_APP_API`, `DATABASE_URL_APP_SYSTEM`, `CATALOG_RATE_HMAC_KEY`, `SITE_URL`. Opcional, só para ligar o resto no futuro (fora desta Issue): `JOBS_TICK_SECRET`, `SESSION_COOKIE_SECRET`, `AUTH_CHALLENGE_KEY`, `PEPPER_EMAIL_HMAC`, `PEPPER_CODE_HMAC`, `PEPPER_IP_HMAC`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `APP_ENV`. As URLs de banco usam os logins `fastpro_dev_api` e `fastpro_dev_system` (menor privilégio, desenho 177 §3), nunca `DATABASE_URL_MIGRATIONS`. Nada em Production nem Development (P5). Sem `EMAIL_*`, `RESEND_*`, `MAPBOX_*`, `MERCADO_PAGO_*`. Valores só por CLI/MCP, a partir do `.env.local`, sem eco (ver R2).

**D-8. `SITE_URL` do preview `[DECIDIDO]` (pergunta 992).** Variável `SITE_URL` com escopo Preview **restrito à branch `feature/init`** (`vercel env add SITE_URL preview feature/init`), valor `https://<endereço estável da branch>`, sem barra final. Origem esperada = a do `Origin` enviado pelo `curl`. Se a Vercel não gerar endereço estável de branch para envios por CLI `[NÃO VERIFICADO]`, **parar e devolver ao líder** a escolha entre (a) integração Git do projeto (exige autorização própria, roteiro 44 §2 item 3) e (b) um alias `.vercel.app` fixo para o preview (`vercel alias set`, que não é domínio nem alias de produção, mas precisa de autorização do líder por tocar em alias). O envio por deployment com URL própria não serve (a URL só é conhecida depois do envio; `SITE_URL` não fecharia).

**D-9. Proteção de acesso `[DECIDIDO]` (pergunta 993).** Manter a proteção padrão da Vercel para previews (login Vercel). A prova usa o "Protection Bypass for Automation" (segredo guardado em `.env.local` com nome `VERCEL_AUTOMATION_BYPASS_SECRET`, enviado no cabeçalho `x-vercel-protection-bypass`, nunca impresso) ou `npx vercel curl`. `[NÃO VERIFICADO]` se o plano gratuito oferece uma dessas duas formas. Se nenhuma existir, a release registra "prova de preview não executável com proteção" e devolve ao líder a decisão entre desligar a proteção só durante a prova (e religar) ou adiar; nunca deixa o preview aberto sem registrar. O cabeçalho `X-Robots-Tag: noindex` e o `no-store` já existem.

**D-10. Cookies e HTTPS `[DECIDIDO]`.** Sem mudança de código. O preview é HTTPS e as respostas vêm da mesma origem da web: `__Host-` (Secure, Path=/, sem Domain) é satisfeito. O happy path não cria cookie (CA-158-06 condicional, "não exercido" se não houver `Set-Cookie`). Cabeçalhos da `vercel.json` (`/(.*)`) também passam a valer em `/api/*`; a prova R3 confere que a resposta do catálogo mantém o `Cache-Control` próprio da API.

**D-11. Envio `[DECIDIDO]` (pergunta 990).** Só `vercel deploy` **sem** `--prod`, sem `--environment`, sem `--target production` e sem `--prebuilt` (o build local em Windows produz binário do `sharp` para a plataforma errada; o build tem de ocorrer na Vercel). Disparado pela raiz do repositório com o projeto já vinculado. Regra de parada do roteiro 44 §4 vale para toda resposta da Vercel; o agente factory-release nunca envia produção.

---

## 3. Estrutura de arquivos

| Arquivo | Ação |
|---|---|
| `apps/api/package.json` | `exports` ganha `./vercel` (só isso) |
| `apps/web/package.json` | `devDependencies` + `@fastpro/api`; script `typecheck` |
| `pnpm-lock.yaml` | atualizado pelo `pnpm install` |
| `apps/web/api/[...caminho].ts` | novo (1 linha de reexport) |
| `apps/web/tsconfig.funcoes.json` | novo |
| `apps/web/vercel.json` | `framework`, `regions`, `buildCommand`, `outputDirectory`, `functions` (resto intacto) |
| `.vercelignore` | novo (raiz) |
| `apps/web/tests/api-hospedagem.test.ts` | novo (estático + handler pela entrada pública) |
| `apps/api/vercel.json`, `apps/api/api/index.ts` | **intactos** |
| `.env.example` | sem alteração (nenhum nome novo de variável de aplicação; `VERCEL_AUTOMATION_BYPASS_SECRET` é de ferramenta, fica só no `.env.local`; se `check:env` exigir, acrescentar o nome sem valor) |

---

## 4. Fatias de Dev (curtas, provas locais)

Raiz `D:\projetos\fastpro`, branch `feature/init`, Node 22, `corepack pnpm`. Registrar na Issue comando, contagem e código de saída. Sem envio, sem rede além do `pnpm install`. Ordem: S1, S2, S3, S4. Não iniciar antes de #156 ter as fatias locais verdes (R-158-08).

**S1 Entrada pública e dependência (CA-158-01 parcial).** `apps/api/package.json` (`./vercel`), `apps/web/package.json` (dependência), `corepack pnpm install` (lockfile).
Provas: `corepack pnpm --filter @fastpro/api build` -> `0`; `ls apps/api/dist/vercel.js apps/api/dist/vercel.d.ts` -> existem; `cd apps/web && node -e "import('@fastpro/api/vercel').then(m=>console.log(typeof m.default))"` -> `function`; `corepack pnpm check:deps` -> `0`; `git diff --stat` sem `apps/api/vercel.json` nem `apps/api/api/index.ts` (CA-158-03).

**S2 Função catch-all e checagem de tipos (CA-158-01).** `apps/web/api/[...caminho].ts`, `apps/web/tsconfig.funcoes.json`, script `typecheck`.
Provas: `corepack pnpm --filter @fastpro/web typecheck` -> `0` (cobre `src` e `api`); `corepack pnpm --filter @fastpro/web lint` -> `0`.

**S3 Configuração da hospedagem e teste (CA-158-02).** `apps/web/vercel.json`, `.vercelignore`, `apps/web/tests/api-hospedagem.test.ts`.
O teste confere, em Vitest sem rede: (1) `regions` igual a `["gru1"]`, `functions["api/**/*.ts"].maxDuration` igual a `300`, `buildCommand` contém `turbo run build --filter=@fastpro/web...`, `outputDirectory` é `public`; (2) o glob `api/**/*.ts` casa o arquivo `api/[...caminho].ts` (verificação simples por prefixo e sufixo) e o arquivo existe com exatamente o reexport de `@fastpro/api/vercel`; (3) `apps/api/package.json` tem `exports["./vercel"]` e `apps/web/package.json` tem `@fastpro/api` como `workspace:*`; (4) `headers` e `redirects` permanecem: os testes existentes (`vercel-entrada.test.ts` e demais) continuam verdes e o `git diff` de `vercel.json` só tem linhas adicionadas (`git diff --numstat apps/web/vercel.json` com removidas = 0); (5) `.vercelignore` contém `.env*`; (6) **handler pela entrada pública:** `import('@fastpro/api/vercel')`, sobe `node:http` na porta `0` com o `default` e confere `GET /api/health` -> `200` e `POST /api/v1/catalog/service-search` sem variáveis -> `404` (rota fechada, nenhum banco acessado); sem variáveis de ambiente de segredo no teste.
Provas: `corepack pnpm --filter @fastpro/web test` -> `0` com o novo arquivo; **simulação local do comando de build da Vercel:** `cd apps/web && sh -c "$(node -p "require('./vercel.json').buildCommand")"` -> `0` (confirma a ordem do `turbo` e a existência de `apps/api/dist/vercel.js` e `apps/web/public/tokens.css` ao final); `git diff --numstat apps/web/vercel.json` -> campo de removidas `0`.

**S4 Fechamento local.** `corepack pnpm check:secrets` -> `0`; `git grep -nE "postgres(ql)?://[^[:space:]]+:[^[:space:]@]+@" -- . ":!.env.local"` -> `1` (CA-158-10); `corepack pnpm check:env` -> `0`; `corepack pnpm --filter @fastpro/api typecheck` -> `0`; `git diff --stat` revisado. `check:all` completo fica para a rodada final (CA-158-12), não por tarefa.

**Fatia de verificação do preview (a cargo do agente factory-release, após S1 a S4 e aprovação do Code Review).** Nunca produção. Cada comando passa pela regra de parada do roteiro 44 §4. Sem valor de credencial em log, comentário ou arquivo versionado; saídas em arquivo fora do repositório.
- **R0 Leitura, sem escrita (P3).** Projeto `fastpro-web` por CLI/MCP: pasta raiz do projeto (esperada `apps/web`, com "incluir arquivos fora da raiz"), versão do Node (22.x), `Production Branch` diferente de `feature/init`, lista de deployments (se **nenhum** existir, o primeiro envio pode ser tratado como produção: **parar** e devolver ao líder), ausência de integração Git com produção automática, `fastpro-api` sem deployments, estado da proteção (D-9), uso atual do plano para a linha de base (CA-158-11; `[NÃO VERIFICADO]` quais medidas o plano gratuito mostra). Qualquer resultado que indique produção ou `first_deployment_production`: parar, não enviar, registrar a resposta literal.
- **R1 Variáveis (CA-158-09, P5).** Gravar os 4 nomes de D-7 no escopo Preview (`SITE_URL` restrito à branch `feature/init`), com o valor lido do `.env.local` e entregue por entrada padrão (`node --env-file=.env.local -e "process.stdout.write(process.env.NOME)" | npx vercel env add NOME preview [feature/init]`; confirmar sintaxe e a marcação de variável sensível com `--help`). `SITE_URL` recebe o endereço estável da branch (D-8). Prova: `npx vercel env ls` com nomes e escopos, nenhum em Production ou Development.
- **R2 Envio (CA-158-08).** `npx vercel deploy` (sem `--prod`, sem `--prebuilt`). Registrar o destino lido da resposta e do `vercel ls`/inspeção: `preview`, sem alias de produção, sem domínio. Máximo de 3 tentativas técnicas por etapa; se o build recusar `maxDuration`, usar 60; se o catch-all não resolver (404), aplicar o plano B de D-2; se o pnpm não for aceito, `ENABLE_EXPERIMENTAL_COREPACK=1` (Preview).
- **R3 Prova do caminho feliz (CA-158-04, 05, 06, 07).** `curl --form-string`/`--data` com `Origin` = origem de `SITE_URL` e o segredo de bypass (D-9) lido sem eco: `POST /api/v1/catalog/service-search` com `{"q":"eletri"}` -> `200`, lista sem `seed_key`, `council_body`, `regulation_source`, `moderation_sensitive`, `version`, `updated_by_ref` (mesma verificação da F6 do 177; semente do catálogo conferida antes); `POST /api/v1/auth/session` com `{}` e sem cookie -> `401`, diferente de `404`, sem `Set-Cookie` (depende de #156 F5b); contraprova sem `Origin` -> 4xx. `GET /api/health` -> `200`. Se houver `Set-Cookie`, conferir `__Host-`, `Secure`, `Path=/`, sem `Domain`; caso contrário registrar "não exercido". Conferir que a resposta do catálogo mantém o `Cache-Control` da API.
- **R4 Uso (CA-158-11, 994).** Medir o uso antes (R0) e depois; se qualquer medida passar de 80% do teto mostrado, parar e avisar o líder.
- **R5 Registro.** Resultado de R0 a R4 na Issue (comando, destino, códigos HTTP, nomes e escopos de variáveis), sem valores. A fatia R não faz limpeza destrutiva: remoção do deployment só por pedido do titular.

---

## 5. Pré-condições

1. **#156** com F0 a F6 e F5b verdes localmente (a sessão só responde após F5b). Esta Issue não termina sozinha.
2. **Autorização do envio de preview** registrada como adotada pelo líder (990), sob o roteiro 44 §4. Vetável pelo dono. Registro cabe ao líder em `11-DECISOES.md` (esta etapa não alterou o arquivo).
3. **R0 concluído sem sinal de produção** (P3). O envio não começa antes disso.
4. Banco DEV com os logins `fastpro_dev_api` e `fastpro_dev_system` criados (F3 de #156); semente do catálogo conferida.
5. Projeto `fastpro-web` já vinculado localmente (`.vercel/`, ignorado pelo git); `npx vercel` autenticado pelo dono (token só em ambiente, nunca em texto).

## 6. Riscos

| Ref. | Risco | Mitigação |
|---|---|---|
| R-182-01 | Envio tratado como produção (projeto sem deployment, branch de produção, Git ligado). | R0, regra de parada, nenhum `--prod`. |
| R-182-02 | Catch-all não resolve em projeto sem framework (404). | Plano B (D-2); prova R3. |
| R-182-03 | Pacote da função grande (`sharp`, binários Linux, `pg`) ou rastreio do workspace falha. | Build remoto (sem `--prebuilt`); tamanho registrado em R2; função só com variáveis mínimas; ajustar `functions.includeFiles` só se o rastreio falhar (nova tentativa). |
| R-182-04 | `maxDuration: 300` ou `regions` recusados no plano gratuito. | Fallback `60`; região única `gru1` já usada no spike. |
| R-182-05 | `pnpm@10.34.9` ou cadeia `turbo` não resolvidos no build da Vercel. | S3 simula o `buildCommand` localmente; fallback `ENABLE_EXPERIMENTAL_COREPACK=1`. |
| R-182-06 | Sem endereço estável de branch, `SITE_URL` não fecha e todas as rotas dão 403. | D-8: parar e devolver ao líder; sem alias ou Git sem autorização. |
| R-182-07 | Proteção do preview impede a prova (sem bypass no plano gratuito). | D-9: registrar e devolver ao líder; nunca deixar aberto sem registro. |
| R-182-08 | Pooler em modo transação perde estado de sessão (R-177-01) e a rota do catálogo falha só na nuvem. | R3 distingue falha de banco de falha de rota; usar a porta de sessão para o preview se necessário (decisão do líder). |
| R-182-09 | Cabeçalhos globais da web (`/(.*)`) alteram respostas da API. | S3 não altera os cabeçalhos; R3 confere `Cache-Control` e `Content-Type`. |
| R-182-10 | `tsconfig.funcoes.json` conflita com a resolução do `tsconfig.base`. | Ajustar só o arquivo novo (D-5); limite de 2 ciclos de correção. |
| R-182-11 | Uso do plano gratuito (build, invocação, banda). | R4 e parada em 80%. |
| R-182-12 | Credencial em evidência ou log. | Entrada padrão sem eco, `check:secrets`, `.vercelignore`, evidências só com nomes. |

## 7. Dúvidas para o líder (sem pergunta ao usuário)

Nenhuma bloqueia o Desenvolvimento local (S1 a S4). Para a fatia R, ficam registradas como possíveis devoluções, não perguntas abertas: (1) se a Vercel não gerar endereço estável de branch para envio por CLI (D-8), o líder escolhe entre Git do projeto e alias fixo `.vercel.app`; recomendação: alias fixo `.vercel.app` só do preview, com autorização do líder; (2) se o plano gratuito não oferecer bypass de proteção (D-9), o líder escolhe entre desligar a proteção só durante a prova ou adiar a prova remota; recomendação: adiar a prova remota e manter a proteção. Também informar ao PO que `buildCommand`, `outputDirectory` e `framework` entram na `vercel.json` além do que o refino listou (D-3).
