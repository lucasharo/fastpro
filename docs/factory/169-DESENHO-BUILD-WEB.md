# 169 - Desenho: build do web quebra por stub de node:crypto incompleto (Issue #152)

- Issue: #152. Workflow: WF-04 (Bugfix). Etapa: Arquitetura. EXEC-ID: EXEC-ARQ-152-20261120.
- Repo: D:/projetos/fastpro, branch feature/init. Entrada: `docs/factory/168-REFINO-BUILD-WEB.md` (decisoes 930 a 932 adotadas pelo lider: alternativa (a), teste em `apps/web/tests`, CA-04 obrigatorio).
- Nenhum codigo foi alterado nesta etapa.

## 1. Causa (confirmada por leitura)

- `apps/web/scripts/build-fotos-envio.mjs` (linhas 21-32) troca `node:crypto` por um stub com 3 exports: `createHash`, `createHmac`, `timingSafeEqual`.
- Imports estaticos de `node:crypto` em `packages/domain/dist` (Grep, 3 arquivos):
  - `acceptance/acceptance-rules.js:4` -> `createHash`
  - `request/publish.js:4` -> `createHash`, `createHmac`, `timingSafeEqual`
  - `discovery/discovery-cursor.js:8` -> `createCipheriv`, `createDecipheriv`, `hkdfSync`, `randomBytes` (desde a #68)
- O esbuild valida os nomes importados na resolucao, antes do tree-shaking, e por isso falha mesmo que o cursor nao seja chamado. As linhas de `dist` que citam `node:crypto` em comentario (`request-draft.js`, `challenge.js`, `discovery-cursor.js:3`) nao sao imports.
- Caminho do cursor ate o bundle: `fotos-entrada.ts` -> `reduzir-foto.ts` -> `@fastpro/domain` (barrel `dist/index.js` -> `export * from './discovery/index.js'` -> `discovery-cursor.js`). `packages/domain/package.json` tem `"sideEffects": false`, entao o esbuild deve descartar o modulo nao usado (H1 provavel, nao verificada: o Dev prova no CA-04).

## 2. Solucao

Alternativas:
- **A. Acrescentar as 4 funcoes ao stub + teste de regressao.** Menor mudanca, mantem o desenho de #44/#141. ESCOLHIDA (decisao 930).
- B. Gerar o stub a partir dos imports reais do `dist` em cada build. Elimina a classe de erro, mas torna o build dependente de parse de texto e esconde quando um modulo de servidor entra no navegador. Evolucao futura, fora desta Issue.
- C. Tirar o cursor do grafo do bundle (importar subpasta do dominio em vez do barrel). Mexe na estrutura de import do dominio; so se H1 falhar no CA-04 (decisao 932).

Para o teste enxergar a mesma lista que o build usa (sem duplicar), a lista de nomes sai do script para um modulo compartilhado:

- Novo `apps/web/scripts/stub-node-crypto.mjs`, exportando:
  - `NOMES_STUB_NODE_CRYPTO`: array congelado com os 7 nomes (ordem alfabetica): `createCipheriv`, `createDecipheriv`, `createHash`, `createHmac`, `hkdfSync`, `randomBytes`, `timingSafeEqual`.
  - `conteudoStubNodeCrypto()`: devolve o texto ESM do stub gerado a partir do array.
- `build-fotos-envio.mjs` passa a importar `conteudoStubNodeCrypto` e usa no `onLoad` (loader `js`). O resto do script nao muda.

## 3. Contrato do stub

- Exporta exatamente os 7 nomes de `NOMES_STUB_NODE_CRYPTO`, como `export const <nome> = falha;`.
- `falha` lanca `new Error("node:crypto indisponivel no navegador")` (mesma mensagem de hoje; CA-03), nunca retorna valor.
- So imports estaticos com chaves de `node:crypto` sao cobertos. Nao ha `default` nem namespace no stub.
- Regra de manutencao: novo nome importado de `node:crypto` por qualquer arquivo de `packages/domain/dist` exige acrescentar o nome em `NOMES_STUB_NODE_CRYPTO` (o teste obriga).

## 4. Desenho do teste de regressao

Arquivo: `apps/web/tests/fotos-envio-stub-crypto.test.ts` (vitest, roda no `test` do web; nao depende do bundle gerado).

1. **Localizar o dist.** `DIST = ../../../packages/domain/dist` relativo ao teste. Se `DIST/index.js` nao existir, o teste **falha** (lanca erro com a instrucao `corepack pnpm --filter @fastpro/domain build`); nunca `skip` (R3).
2. **Funcao `importsNodeCrypto(pasta)`** (no proprio teste, parametrizada pela pasta para o ensaio negativo): percorre `pasta/**/*.js` recursivamente (inclui `dist/**`; ignora `.d.ts`, `.map`), le cada arquivo, remove comentarios `//` de linha inteira e `/* */`, e aplica a regex de import estatico:
   `/\b(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*(['"])(?:node:)?crypto\2/g`
   - Para cada especificador separado por virgula, pega o nome antes de `as` (nome importado, ignorando alias) e remove `type `.
   - Retorna `Map<nome, arquivo[]>`.
   - Forma nao suportada (`import * as x`, `import x from`, `import 'node:crypto'`, ou `require('crypto')`/`import('node:crypto')`) sobre `node:crypto` ou `crypto`: o teste **falha** pedindo revisao manual, porque o stub nao cobre `default`/namespace e o filtro do plugin so casa `^node:crypto$` (o especificador sem prefixo `crypto` nao seria interceptado).
3. **Caso principal (CA-05, positivo).** `faltantes = importados.filter(n => !NOMES_STUB_NODE_CRYPTO.includes(n))`. Espera `[]`; a mensagem de falha lista **todos** os nomes faltantes com o arquivo de origem (R4). Verificacao de sanidade: o conjunto importado e nao vazio e contem `createHash` e `randomBytes` (garante que a regex achou algo; hoje deve achar 7 nomes distintos: createHash, createHmac, timingSafeEqual, createCipheriv, createDecipheriv, hkdfSync, randomBytes).
4. **Caso negativo (CA-05).** Cria pasta temporaria (`mkdtemp` em `os.tmpdir()`) com um `.js` falso `import { createHash, naoExisteNoStub } from 'node:crypto';`, chama `importsNodeCrypto` e a mesma comparacao, e espera exatamente `['naoExisteNoStub']`. Segundo caso: forma `import * as c from 'node:crypto'` e `import { randomBytes } from 'crypto'` sao sinalizadas como nao suportadas. Limpa a pasta no `afterAll`.
5. **Comportamento do stub (CA-03).** Pega `conteudoStubNodeCrypto()`, transforma com `esbuild.transform(texto, { format: 'cjs', loader: 'js' })` (esbuild ja e devDependency do web), executa com `new Function('exports', codigo)` e, para cada nome de `NOMES_STUB_NODE_CRYPTO`: confirma que existe como funcao e que chama-la lanca `Error` com mensagem `node:crypto indisponivel no navegador`. Tambem confirma que o conjunto de exports e igual ao array (sem extras).
6. **CA-04 (cursor fora do bundle).** Incluido no mesmo arquivo ou, de preferencia, em `describe` proprio: `beforeAll` gera o bundle com `execFileSync(node, build-fotos-envio.mjs)` (mesmo padrao de `fotos-envio-estatico.test.ts`) e confirma 0 ocorrencias de `cur1|`, `fastpro-discovery-cursor-v1`, `cursor-aead` e `aes-256-gcm` em `public/fotos-envio.js`. Se falhar, acionar a alternativa C (decisao 932) antes de seguir.

Ensaio manual do CA-05 (evidencia na Issue): remover `randomBytes` de `NOMES_STUB_NODE_CRYPTO`, rodar o teste (deve falhar citando `randomBytes` e `discovery/discovery-cursor.js`), restaurar.

## 5. Fatia unica de Dev

Arquivos: criar `apps/web/scripts/stub-node-crypto.mjs`; editar `apps/web/scripts/build-fotos-envio.mjs` (trocar o literal do stub por `conteudoStubNodeCrypto()` e atualizar o comentario H-031/#152); criar `apps/web/tests/fotos-envio-stub-crypto.test.ts`. Nao alterar `packages/domain`, `apps/api`, nem a logica do cursor. Se alguma alteracao de `package.json` for necessaria, nao ha (esbuild ja e dependencia).

Provas (todas locais, com comando, contagem e codigo de saida registrados na Issue):

1. `corepack pnpm --filter @fastpro/domain build` (pre-requisito, saida 0).
2. `node apps/web/scripts/build-fotos-envio.mjs` -> saida 0, mensagem `fotos-envio.js publicado em apps/web/public (N bytes)`, arquivo existente (CA-01).
3. Busca no bundle: 0 ocorrencias de `cur1|`, `fastpro-discovery-cursor-v1`, `cursor-aead`, `aes-256-gcm` (CA-04), ex.: `grep -c -E "cur1\||fastpro-discovery-cursor-v1|cursor-aead|aes-256-gcm" apps/web/public/fotos-envio.js` (esperado 0; grep sai 1 com contagem 0).
4. `corepack pnpm --filter @fastpro/web exec vitest run tests/fotos-envio-stub-crypto.test.ts` -> verde (CA-03, CA-05), mais o ensaio manual do item acima.
5. `corepack pnpm --filter @fastpro/web exec vitest run tests/fotos-envio-estatico.test.ts tests/fotos-envio-paridade.test.ts` -> verdes (CA-06 parcial; a suite completa do web fica para o QA final).
6. `corepack pnpm --filter @fastpro/web build` -> saida 0 (CA-02) e `corepack pnpm --filter @fastpro/web lint` e `typecheck` -> saida 0.

## 6. Riscos

- R1. Nome novo em `node:crypto` no dominio: o teste falha com a lista completa (mitigado). Imports dinamicos (`import('node:crypto')`) e `require` so sao sinalizados pela regra de "forma nao suportada" se a regex os achar; hoje o dominio nao os usa.
- R2. Cursor entrar no bundle (H1 nao verificada): o tree-shaking depende de `sideEffects: false` ja presente no dominio; se o CA-04 falhar, usar a alternativa C com nova rodada de Arquitetura.
- R3. Teste depende de `dist` construido: falha explicita, nao `skip`; o script `test` do web ja exige o dist para gerar o bundle.
- R4. Regex sobre texto pode errar em formatacao incomum de import multilinha: a regex usa `[^}]*` e aceita quebras de linha; o caso negativo cobre uma lista multilinha.
- R5. Teste de bundle (item 6) acrescenta uma geracao de bundle (~segundos) a mais ao `test`; aceitavel, mesmo padrao dos testes existentes.
- R6. Pre-condicao externa: o quadro mostra a #152 em Backlog no refino; o lider deve movê-la pelas colunas em ordem (PO -> Arquitetura -> Desenvolvimento). Nao alterei o quadro.
