# Desenho de Arquitetura — Issue #149: check:all vermelho no repositório (E15)

- **Issue:** #149 `[E15] check:all vermelho no repositório (hex, secrets, logs, boundaries, typography)`
- **Workflow:** WF-03, etapa Arquitetura. **EXEC-ID:** EXEC-ARQ-149-20261119
- **Repositório/branch:** `D:\projetos\fastpro`, `feature/init`. **Data:** 2026-11-19
- **Entrada:** `docs/factory/150-REFINO-CHECKALL.md` (CA-149-01..10, perguntas 800 a 808)
- **Natureza:** SOMENTE DOCUMENTO. Nenhum código, verificador, quadro ou `11-DECISOES.md` foi alterado. Nenhum comando de banco. Sem Docker, Mapbox real, e-mail real ou backup.
- **Etiquetas:** `[VERIFICADO]` medido agora no repositório; `[PROPOSTA]` decisão de desenho para o DEV.

---

## 1. Linha de base medida `[VERIFICADO]`

Cada `pnpm check:*` foi executado separadamente (somente leitura), saída de cada um em arquivo temporário do scratchpad. Todos terminam com código 1.

| Check | Violações | Observação |
|---|---|---|
| `check:hex` | **20** | Todas as 20 linhas são comentários citando número de Issue (`#105`, `#108`, `#109`, `#114`, `#118`, `#140`, `#141`). Falso positivo puro. |
| `check:typography` | **2** | `apps/web/public/codigo.css:7` (`system-ui`) e `:30` (`font-weight: 600`). Violação real. |
| `check:boundaries` | **3** | Só arquivos em `packages/domain/tests/` com `node:fs`. Nenhum em `packages/domain/src/`. |
| `check:logs` | **15** | Amostra de 8 das 15 linhas conferida: todas são caminho/rota (`/console/...`, `admin-console-route.js`, `console-state`, `'./console.js'`, `ADMIN_CONSOLE_MENU_PATH`). Nenhum `console.<método>` real. |
| `check:secrets` | **71** (o refino dizia 70; a 71ª é o próprio `150-REFINO` linha 306) | Ver decomposição abaixo. |

Decomposição de `check:secrets` (71): 39 referências a `service_role` (5 em código de produção da composição da API, 4 em testes da API, 30 em `packages/db/tests/`); 27 atribuições a nome sensível (3 constantes de rota `*_PATH`, 1 regex `TOKEN_RE`, 3 `RESEND_API_KEY`, 2 `SUPABASE_SECRET_KEY`, 1 `NEXT_PUBLIC_..._PUBLISHABLE_KEY`, 1 `PEPPER_IP_HMAC: undefined`, 5 `PEPPER_*`/`key_hmac` em teste da API, 4 `key_hmac = any($1...)` em dbtest, 2 `PEPPER_*` em dbtest, 2 `pepperEmail/pepperCode` com `randomBytes`, 2 `dedupe_key` em SQL, 1 prosa `HMAC:` em doc); 4 URLs `postgres://usuario:senha@host/db` (2 testes da API, 112 linha 207, 150 linha 306); 1 `Bearer` com chave sintética (`packages/email/tests/professional-mail.test.ts:153`).

### Origem por arquivo (via `git log --diff-filter=A`) `[VERIFICADO]`

| Grupo | Arquivos | História/Issue de origem (commit de criação) |
|---|---|---|
| hex | `apps/api/src/vercel.ts` (H-009 `c2dbe4e`; hoje com modificação local não commitada de outro agente) | H-009; comentários E3/#141 |
| hex | `packages/db/tests/approval-dual-h105*`, `ops-panel-h108`, `retention-h109`, `retention-*`, `backup-roles`, `catalog-*`, `draft-request-h025`, `geo-*` | H-105 (#114), H-108 (#117), H-109 (#118), H-025, H-022 (#35), triagem #140 |
| typography | `apps/web/public/codigo.css` (`0abc22f`) | H-013 (#26) |
| boundaries | `packages/domain/tests/role-exclusivity.test.ts` (`ad1de6e`), `h097-cota-login.test.ts` (`c675234`), `eligibility-professional-access.test.ts` (`f68fce3`) | H-017, H-097 (#107), H-042 |
| logs | `apps/admin/src/app/console/**`, `apps/admin/src/app/page.tsx` (`49eed7a`), `packages/domain/src/admin/{console,index,routes}.ts` (`b50bf38`), `apps/api/src/app.ts:33` | H-103 (#112) |
| secrets (service_role, produção) | `apps/api/src/identity-docs/identity-doc-montagem.ts` (`81c15f9`), `apps/api/src/professional-composicao.ts` (`42c2130`) | H-037 (#50), H-016 |
| secrets (rotas) | `professional-password-route.ts` (`10ef92a`), `professional-recovery-route.ts` (`e33c995`) | H-016 |
| secrets (e-mail) | `packages/email/src/professional-mail.ts` e `tests/professional-mail.test.ts` (`e7608a6`) | H-016 |
| secrets (testes API) | `h013-codigo-banco.test.ts` (`edcd90c`), `h097-ca08-ponta-a-ponta.test.ts` (`9f326a4`), `identity-docs-montagem.test.ts` (`9a55eb8`), `professional-composicao.test.ts` (`42c2130`) | H-013 (#26), H-097 (#107), H-037 (#50), H-016 |
| secrets (dbtests) | `h013-provas-banco`, `challenge-concorrencia-h013` (`edcd90c`), `h097-tempo-uniforme` (`9146d0f`), `ops-purge-h110` (`1ee98cd`), `retention-h109` (`df02c06`), demais testes de migração em `packages/db/tests/` | H-013, H-097, H-110 (#119), H-109 (#118) |
| secrets (docs) | `131-REFINO-H040.md` (`a88111b`), `112-TRIAGEM...md` (`758ee6f`), `150-REFINO-CHECKALL.md` | #53, #140, #149 |

---

## 2. Decisões (perguntas 800 a 808): todas ADOTADAS PELO LÍDER com a recomendação do PO

Nenhuma decisão enfraquece o verificador sem contrapartida: onde a recomendação do PO era ampla demais, o desenho a **estreita** (marcado "refinamento do arquiteto"), sempre mantendo ou aumentando o rigor.

| # | Decisão | Status | Refinamento do arquiteto |
|---|---|---|---|
| 800 | Corrigir `check:hex` no verificador (Alternativa A) | **adotada pelo líder** | Ignorar apenas correspondência `#` + 3 ou 4 dígitos **só decimais** (`#\d{3,4}`) **quando aparece depois de um marcador de comentário** (`//`, `/*`, `*` inicial) na mesma linha. Hex com letra (`#fff`, `#a1b2c3`), 6 ou 8 dígitos, e qualquer `#ddd` fora de comentário continuam reprovados. |
| 801 | Limitar a proibição de I/O a `packages/domain/src/` (A) | **adotada pelo líder** | Testes de domínio continuam proibidos de importar `apps/*`; só `IO_MODULES` deixa de valer em `packages/domain/tests/`. |
| 802 | Corrigir `check:logs` no verificador (A) | **adotada pelo líder** | Neutralizar a palavra `console` apenas dentro de **literais de string com forma de caminho** (precedida de `/` ou `-`, ou seguida de `-` ou `/`) e fora de interpolação `${...}`. Não adotar "excluir `/` e `-` do lookbehind" (abriria `x ? 0 :-console.log(1)`). |
| 803 | Liberar `service_role` em testes de banco (A) | **adotada pelo líder** | `packages/db/tests/` por prefixo (testes de privilégio de papel); para a API, **arquivos exatos** e não o diretório: `apps/api/src/identity-docs/identity-doc-montagem.ts`, `apps/api/src/professional-composicao.ts`, `apps/api/tests/identity-docs-montagem.test.ts`, `apps/api/tests/professional-composicao.test.ts`. Atribuição de valor a `SUPABASE_SECRET_KEY`/`service_role` continua verificada em qualquer lugar. |
| 804 | Ignorar nomes de rota/regex em `check:secrets` (A) | **adotada pelo líder** | Sufixos `_PATH`, `_ROUTE`, `_RE`, `_REGEX` **e** valor começando com `/` (caminho ou literal de regex). `_URL` fica **de fora** (sem violação que exija; URL pode carregar segredo). |
| 805 | Padronizar sentinelas de teste (A) | **adotada pelo líder** | Corrigir o código do teste para `dummy-...`. Para falsos positivos estruturais (SQL `key_hmac = any($1::text[])`, `dedupe_key`, `randomBytes(...)`, `undefined`/`null`) tratar no verificador com teste, porque renomear não resolve. |
| 806 | Corrigir `codigo.css` com tokens (A) | **adotada pelo líder** | `tokens.css` define `--font-family`, `--font-weight-medium/bold` e `codigo.html` já carrega `tokens.css` `[VERIFICADO]`. |
| 807 | Restringir ignore de `coverage` no ESLint (A) | **adotada pelo líder** | Usar `coverage/**` e `*/*/coverage/**` (saída gerada de `apps/x/coverage`, `packages/x/coverage`), **sem** `**/coverage/**`. `*/*/coverage/**` não casa `packages/domain/src/coverage/`. |
| 808 | Aceitar `senha` como placeholder de URL de exemplo (A, variante verificador) | **adotada pelo líder** | Acrescentar `senha@` (senha exatamente `senha`) ao lookahead da regra "URL de banco com senha". Não ignorar `docs/`. |

Não há pergunta nova ao líder.

---

## 3. Plano de correção por grupo e por arquivo

Legenda: **V** = ajustar verificador (+ teste); **C** = corrigir código/arquivo.

### G1 `check:hex` (20): V
- `scripts/check-hex.mjs`: na regra `hex`, antes de registrar, se `match[0]` casa `^#\d{3,4}$` e o índice do match está depois de `//`, `/*` ou de um `*` de abertura de linha, ignorar. Demais padrões inalterados. Nenhum dos 20 arquivos é editado (isso evita tocar `vercel.ts`, que tem edição local de outro agente, e os dbtests compartilhados).
- Conferir que `backup-roles.dbtest.mjs:113` (comentário citando #140) também fica verde. Não alterar o teste de backup (fora de escopo desta Issue).

### G2 `check:typography` (2): C
- `apps/web/public/codigo.css:7` `font-family: system-ui, sans-serif;` para `font-family: var(--font-family);`
- `apps/web/public/codigo.css:30` `font-weight: 600;` para `font-weight: var(--font-weight-medium);` (500; mantém peso de rótulo).
- Nenhum arquivo de verificador muda. Risco visual baixo (Roboto já é a fonte do EDS).

### G3 `check:boundaries` (3): V
- `scripts/check-module-boundaries.mjs`: condição do I/O passa a `pkg[1] === 'domain' && file.startsWith('packages/domain/src/') && IO_MODULES.test(spec)`. Regra "package não importa apps" permanece para todos os arquivos.
- Os 3 testes de `packages/domain/tests/` não são editados.

### G4 `check:logs` (15): V
- `scripts/check-logs.mjs`: antes de aplicar `CONSOLE`, aplicar função `semCaminhos(line)` que substitui `console` por `_` somente dentro de literais `'...'`, `"..."`, `` `...` `` quando, no conteúdo literal e fora de `${...}`, `console` está imediatamente após `/` ou `-` ou imediatamente antes de `-` ou `/`. Regex `CONSOLE` e a regra de `globalThis.console` ficam inalteradas.
- Cobre: `redirect('/console')`, `revalidatePath('/console/catalogo')`, `` `/console/${t.id}` ``, `'../../../console-state'`, `'./admin-console-route.js'`, `'./console.js'`, `'/v1/admin/console/menu'`.
- Nenhum arquivo de produção editado. O DEV confirma que as 15 linhas ficam verdes por execução, não por amostra.

### G5 `check:secrets` (71): V + C

G5a (verificador, `scripts/check-secrets.mjs`):
1. `SERVICE_ROLE_ALLOWED` ganha `packages/db/tests/` e os 4 arquivos exatos da API (ver decisão 803). Elimina 39 achados.
2. Assignments: se nome termina em `_PATH|_ROUTE|_RE|_REGEX` e valor começa com `/`, ignorar (elimina 3 rotas + `TOKEN_RE`).
3. `PLACEHOLDER` ganha `undefined|null` e chamadas geradoras `random(?:Bytes|UUID)\(`; e parâmetro SQL `any\(\$\d` (elimina `PEPPER_IP_HMAC: undefined`, `pepperEmail/Code`, `key_hmac = any($1::text[])` x8).
4. Nome-exceção `dedupe_key` (chave de deduplicação de fila, não segredo) ignorada em atribuição (2 achados).
5. Lookahead da regra de URL de banco aceita `senha@` (elimina 4 achados, inclusive 112:207 e 150:306).

G5b (código/arquivos, valores sentinela, sem mudar semântica do teste):
- `apps/api/tests/h013-codigo-banco.test.ts:27-29` e `packages/db/tests/h013-provas-banco.dbtest.mjs:17-18`: prefixo `'pepper-...'` para `'dummy-pepper-...'`.
- `apps/api/tests/h097-ca08-ponta-a-ponta.test.ts:87`: `RESEND_API_KEY: CHAVE_API` para valor literal `'dummy-chave-api'` (a constante é referência a identificador; o scanner não distingue de segredo sem `dummy`).
- `apps/api/tests/identity-docs-montagem.test.ts:21` e `professional-composicao.test.ts:16-17,24`: valores `dummy-...` (SUPABASE_SECRET_KEY, NEXT_PUBLIC_..._PUBLISHABLE_KEY, RESEND_API_KEY).
- `packages/email/tests/professional-mail.test.ts:125,153`: chave para `dummy-chave-sintetica` e a asserção do cabeçalho passa a template `` `Bearer ${CHAVE}` `` (o literal `Bearer dummy-chave-sintetica` teria 21 caracteres e ainda dispararia a regra Bearer >= 20).
- `docs/factory/131-REFINO-H040.md:129`: reescrever "com o mesmo HMAC: exatamente um" para "com o mesmo HMAC, exatamente um" (prosa com dois-pontos virou par chave/valor).
- `112-TRIAGEM...md:207` e `150-REFINO...md:306`: nenhuma edição (resolvidos por G5a item 5).

### G6 ESLint: C
- `eslint.config.mjs` linha 6: trocar `'**/coverage/**'` por `'coverage/**'` e `'*/*/coverage/**'`. Rodar `pnpm eslint packages/domain/src/coverage packages/domain/tests/coverage-*.test.ts`; corrigir o que aparecer (somente lint, sem mudar regra).

---

## 4. Ordem de execução em fatias pequenas (um commit por fatia, `git add` por caminho, `fix(E15): ... (#149)`)

1. **F1 tipografia** (G2): 1 arquivo CSS. Prova: `check:typography` = 0.
2. **F2 fronteiras** (G3): script + teste. Prova: `check:boundaries` = 0.
3. **F3 hex** (G1): script + teste. Prova: `check:hex` = 0.
4. **F4 logs** (G4): script + teste. Prova: `check:logs` = 0.
5. **F5 secrets, verificador** (G5a): script + testes. Prova: restam só sentinelas do G5b.
6. **F6 secrets, sentinelas e doc** (G5b): edições de teste/doc. Prova: `check:secrets` = 0 e as suítes tocadas passam.
7. **F7 ESLint** (G6). Prova: `eslint` na pasta de cobertura = 0 e `pnpm lint` = 0.
8. **F8 gate final:** `corepack pnpm check:all`, `test:scripts`, `lint`, `typecheck`, `test` (unitários que cobrem os arquivos de teste editados), `git status` mostrando `supabase/migrations/` intocado e sem `.env.local`. Registrar comando, contagem e código de saída na Issue.

Cada fatia re-executa `pnpm test:scripts` antes do commit; F1 a F5 não dependem entre si e podem ser reordenadas.

---

## 5. Riscos

| ID | Risco | Mitigação |
|---|---|---|
| A-1 | Edições concorrentes: `apps/api/src/vercel.ts` já tem modificação local não commitada (outro agente). Issues #51 (E4 certificações), #68 (E6 descoberta) e #120 (E13 dsr_case) tendem a tocar `apps/api/src/`, `packages/db/tests/`, `apps/api/tests/` e testes de migração. | Plano evita editar `vercel.ts` e dbtests (hex e service_role são tratados no verificador). Arquivos editados são poucos e de linha única; `git add` por caminho, `git diff --cached --stat` antes do commit, nunca `git add -A`. Se um dos arquivos de G5b estiver modificado por outra Issue, aplicar a edição só nas linhas indicadas e commitar com `git add -p`; se não for possível isolar, adiar essa linha e registrar. |
| A-2 | Novas Issues (#51/#68/#120) criarem novos achados enquanto #149 corre (ex.: novos `service_role` em `packages/db/tests/` já cobertos; novas sentinelas em `apps/api/tests/` não). | F8 reexecuta `check:all` no fim; se surgirem achados novos fora do escopo, listar e não alargar exceção. |
| A-3 | Enfraquecimento do `check:secrets`/`check:logs`. | Todas as exceções são por forma (sufixo + `/`, `senha@`, literal de caminho) e cada uma tem teste negativo que deve continuar reprovando. Padrões de chave real (privada, JWT, GitHub, Resend, sb_secret, Bearer) intocados. |
| A-4 | `check:logs`: parser de literal ingênuo (aspas dentro de template, escapes). | Escopo restrito a literais de uma linha; casos ambíguos continuam sendo reprovados (falha segura). Teste com `${console.log(1)}` dentro de template. |
| A-5 | Hex em comentário: `#123` (cor) em comentário deixa de ser reprovado. | Aceito: comentário não aplica cor; 6/8 dígitos e hex com letra em comentário continuam reprovados. |
| A-6 | ESLint passar a ver `packages/domain/src/coverage` revela erros de lint. | F7 dedicada; corrigir só o lint reportado. |
| A-7 | Renomear sentinelas muda comportamento de teste (peppers de teste de banco). | Valores são arbitrários; rodar os testes unitários tocados e os `db:test` correspondentes só se o ambiente DEV já estiver em uso padrão (sem criar dados novos). |

---

## 6. Matriz de testes

Novos casos em `scripts/__tests__/checks.test.mjs` (padrão existente: `fixture(files)` + `check(script, files, expectFail, match)`). Cada exceção tem par positivo (passa) e negativo (continua reprovando).

| CA | Verificador | Deve passar (exit 0) | Deve continuar reprovando |
|---|---|---|---|
| CA-149-02 | hex | `// (#105)` e `/** E3 (#141): ... */` em `.ts`; `// Issue #1234` | `color: #fff`; `// cor #a1b2c3`; `const c = '#123'` (fora de comentário); `#12345678` |
| CA-149-03 | boundaries | `packages/domain/tests/x.test.ts` com `import 'node:fs'` | `packages/domain/src/x.ts` com `node:fs`; `packages/domain/tests/x.test.ts` importando `apps/api` |
| CA-149-04 | logs | `redirect('/console')`; `` `/console/${id}` ``; `import './admin-console-route.js'`; `'../console-state'` | `console.log(x)`; `const c = console`; `` `${console.log(1)}` ``; `x ? 0 :-console.log(1)`; `globalThis.console.log(1)` |
| CA-149-05 | secrets | `service_role` em `packages/db/tests/a.dbtest.mjs` e nos 4 arquivos exatos; `X_PATH = '/v1/a/password'`; `TOKEN_RE = /^[a-z]{43}$/`; `key_hmac = any($1::text[])`; `dedupe_key = 'a-1'`; `P: undefined`; `postgres://usuario:senha@host/db`; valores `dummy-...` | `service_role` em `apps/api/src/outro.ts`; `SUPABASE_SECRET_KEY = 'abcdef123456'` em `packages/db/tests/`; `X_PATH = 'abc12345secret'` (sem `/`); `postgres://u:s3cr3tReal@h/db`; chave privada, JWT, `sb_secret_...`, `Bearer` com 20+ caracteres literais |
| CA-149-01 | typography | `codigo.css` com tokens | `font-family: system-ui`; `font-weight: 600` (testes existentes preservados) |
| CA-149-07 | eslint | `pnpm eslint packages/domain/src/coverage packages/domain/tests/coverage-*.test.ts` = 0 | pasta `apps/x/coverage/` gerada continua ignorada |
| CA-149-06/08 | agregado | `corepack pnpm check:all` = 0; `pnpm test:scripts` = 0; `pnpm lint`; `pnpm typecheck` | |
| CA-149-09/10 | higiene | `git diff --cached` sem segredo real; `supabase/migrations/` sem alteração; sem `Dockerfile`/`docker-compose` | |

**Critério de saída do DEV:** os cinco checks individuais com contagem 0 e `check:all` com código 0, evidência (comando, contagem, código de saída) comentada na Issue #149, sem declarar CI verde.
