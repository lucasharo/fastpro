# Desenho: página inicial com busca de serviço e endereço (Issue #153)

- **Issue:** #153 `[E16] Página inicial com busca de serviço e endereço que leva ao pedido` · **Workflow:** WF-03 · **Etapa:** Arquitetura · **EXEC-ID:** EXEC-ARQ-153-20261121
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init` · **Entrada:** `171-REFINO-WEB-INICIAL.md` (PO, perguntas 940 a 947)
- **Natureza:** somente documento. Nenhum código, quadro, 11-DECISOES ou commit foi alterado.
- **Etiquetas:** `[V]` verificado por leitura nesta rodada · `[NV]` não verificado (vira verificação obrigatória na fatia indicada) · `[ADOTADA]` decisão do líder, vetável.

---

## 1. Decisões (adotadas a recomendação marcada no refino)

| Nº | Decisão | Situação |
|---|---|---|
| 940 | Passagem ao pedido: **criar/atualizar o rascunho no servidor e navegar para `/pedido`** (opção A). Sem URL, sem armazenamento do navegador. | [ADOTADA] |
| 941 | Já existe rascunho na sessão com outro serviço: **avisar e pedir confirmação** antes de substituir (opção B). Desenho em §5.3. | [ADOTADA] |
| 942 | Continuar exige **serviço escolhido da lista** (opção A). Texto livre não vira serviço. | [ADOTADA] |
| 943 | **Sem categorias** na inicial; ficam para #155 (opção A). | [ADOTADA] |
| 944 | **Sem link de entrar/cadastro** na inicial; ficam para #154 (opção A). | [ADOTADA] |
| 945 | Frase de apoio: "Diga o serviço e onde ele será feito. Na próxima tela você descreve o pedido." (opção A). | [ADOTADA] |
| 946 | Contexto de endereço: **`request_draft`** (opção A); sem mudança na API. Confirmado: `ADDRESS_CONTEXTS = ['request_draft','professional_base']` em `packages/domain/src/geo/address-suggest.ts` [V]. | [ADOTADA] |
| 947 | Preview depende de #152, cujo código já está no repo; **sem ação nesta Issue**. | [ADOTADA] |

Decisões de arquitetura novas (desta etapa):

| Nº | Decisão | Motivo |
|---|---|---|
| A-1 | **Sem framework novo.** HTML, JS (módulo ES) e CSS estáticos, no padrão de `pedido.html`/`pedido.js`. | Padrão do repo [V]; sem build extra. |
| A-2 | **Lógica pura separada da visão**: `inicio-logica.js` (sem DOM, testável) e `inicio.js` (liga DOM e rede). Reutiliza `criarControladorBusca`, `PEDIDO_TEXTOS`, `PEDIDO_BUSCA_MIN`, `mountAddressField`, `apiRequest`, `ADDRESS_MIN_CHARS`, `ADDRESS_MAX_CHARS` sem copiá-los. | Evita duplicar regra; menor conflito. |
| A-3 | **Sem `<style>` nem atributo `style` inline**: CSS só em `/inicio.css` (a CSP das páginas é `style-src 'self'`). Sem script inline. | CSP de `/pedido` [V]. |
| A-4 | **`/` ganha bloco próprio em `vercel.json`** com a mesma política de `/pedido` (CSP `default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`). Mantém `<meta name="robots" content="noindex">`. | Mesmo nível de proteção do pedido; preview continua noindex. |
| A-5 | **Fluxo de criação em três ramos** (§5.3), usando só rotas existentes. Não há cabeçalho de idempotência nas rotas de rascunho [V]: a deduplicação é pelo cookie do rascunho. | Evita criar rascunhos duplicados e perda de dados. |
| A-6 | **`<form>` com `novalidate` e `action` ausente**; envio interceptado por JS. Sem JS, o formulário não envia nada (CSP `form-action 'none'`) e um `<noscript>` mostra: "Ative o JavaScript para continuar." | Resolve §5.6 do refino. |
| A-7 | Testes do web usam **fake do `fetch`** (a API local responde 404 em `/api/v1/*` por falta de variáveis, Issue #156). Nenhum teste desta Issue depende de API real. | Pedido do líder. |

---

## 2. Estado atual do repo [V]

- `apps/web/public/`: `index.html` (provisória, sem CSS/JS), `pedido.html`, `pedido.js`, `pedido-logica.js`, `address-field.js`, `pedido.css`, `tokens.css` (copiado de `packages/tokens` por `scripts/copy-tokens.mjs`; **não editar**), `acesso.*`, `codigo.*`, `fotos.*`, `profissional-*`.
- `apps/web/vercel.json`: `cleanUrls: true`; cabeçalhos globais (nosniff, Referrer-Policy, X-Frame-Options) e blocos por rota (`/acesso`, `/pedido`, `/pedido/(.*)`, `/codigo`, `/fotos`, `/profissional-documento`). **Não há bloco para `/`** e não há `rewrites` neste arquivo. A raiz é servida pelo `index.html` estático da pasta `public`. [NV] como `/api/*` é roteado em produção/preview (função `apps/api/src/vercel.ts` existe); a inicial só usa caminhos relativos `/api/v1/...`, como `pedido.js`.
- Testes do web: `vitest` (`apps/web/vitest.config.ts`, exclui `tests/e2e`) e `playwright` com `@axe-core/playwright` (`playwright.config.ts`, `baseURL http://fastpro.test`; as páginas são servidas por `route` do próprio teste, sem porta, sem rede; modelo: `tests/e2e/pedido-h030.spec.ts`). Scripts: `test` (copia tokens, builda fotos-envio, `vitest run`) e `test:e2e`. Testes de página existentes (`acesso-page.test.ts`, `codigo-page.test.ts`) rodam o script do navegador em `node:vm` com DOM simulado, e testes estáticos leem arquivos (`address-pedido-csp.test.ts`, `pedido-h030-estatico.test.ts`). [NV] se `jsdom` está instalado; o desenho **não** depende dele (ver fatia 2).
- `check:*` na raiz: `check:hex` (varre `.html`, `.css`, `.js`; nomes de cor CSS também), `check:typography`, `check:logs`, `check:secrets`, `check:env`, `check:boundaries`, `check:all`.

---

## 3. Contratos reais das chamadas [V]

Todas são **mesma origem**, `credentials: 'same-origin'`, `cache: 'no-store'`, `redirect: 'error'`, `referrerPolicy: 'no-referrer'`, `Content-Type: application/json` nas escritas, exatamente como `chamar()` em `pedido.js`. O navegador envia `Origin`/`Sec-Fetch-Site` automaticamente; a API rejeita origem diferente de `SITE_URL` com 403 `origem_invalida`. Sem CORS.

### 3.1 Busca de serviço
- `POST /api/v1/catalog/service-search`, corpo `{ "q": string }` (somente `q`, máx. 1 KB; termo 2..80 caracteres, validado antes de qualquer custo) (`apps/api/src/catalog/catalog-route.ts`).
- Resposta 200 `{ status: 'ok', items: [{ service_id, service_name }] }` ou `{ status: 'vazio' }`; 429 limite; demais = erro. É o que `criarControladorBusca` já interpreta (`resultado`, `sem_resultado`, `limite`, `erro`, `curto`) [V]. `PEDIDO_BUSCA_MIN = 2`, atraso 300 ms.
- Não há cabeçalho de idempotência (é consulta).

### 3.2 Sugestão de endereço
- `POST /api/v1/geo/address-suggest`, corpo `{ q, context: 'request_draft' }` (1 KB). Já encapsulada por `mountAddressField` + `apiRequest(fetch)`; mínimo 3, máximo 120, atraso 300 ms. Interruptor desligado = texto livre sem erro (E-E5). O navegador nunca fala com Mapbox.

### 3.3 Rascunho (`apps/api/src/drafts/draft-route.ts`, `packages/domain/src/draft/request-draft.ts`)
- Cookie do rascunho: `__Host-` (sem Domain), HttpOnly, Secure, SameSite=Strict, Path=/. Definido pelo servidor em `Set-Cookie` (201 no POST). O JS **não lê nem escreve cookie**; o navegador o reenvia sozinho.
- `GET /api/v1/drafts/current`: 200 com a visão do rascunho `{ service_id, service?, address_text, urgency, description, ... }`; 404 sem cookie/sem rascunho (sem ir ao banco quando sem cookie).
- `POST /api/v1/drafts`: corpo com chaves permitidas `service_id`, `address_text`, `urgency`, `description` (todas opcionais; chave desconhecida = 422); 8 KB; `Content-Type` JSON obrigatório (415 se não). Cria e devolve **201** com `Set-Cookie`; com cookie válido já existente o serviço devolve 200 (`draft-service.ts` linhas ~152-189) [NV] se faz mesclagem ou apenas devolve o atual: **a fatia 1 lê `postDraft` antes de codar** e, enquanto isso, o desenho **não depende** desse ramo (usa PATCH quando já há rascunho).
- `PATCH /api/v1/drafts/current`: mesmo corpo parcial; 200 com a visão; 404 se não existe.
- Códigos de erro do corpo: 422 (`urgencia_invalida`, campo inválido), 413, 415, 403, 429 (limite), 503 `indisponivel`.
- A inicial **envia só `service_id` e `address_text`**. Urgência e descrição ficam para `/pedido`.

### 3.4 Contratos compartilhados
`packages/contracts/src` tem `catalog.ts` e `public-profile.ts` [V]; o corpo do rascunho vive em `@fastpro/domain`. O JS estático do navegador **não importa pacotes**; as constantes de limite vêm de `address-field.js` e `pedido-logica.js` (mesma origem). A paridade com a API é provada por teste (§8, fatia 1).

---

## 4. Estrutura da página e componentes

`/` (`apps/web/public/index.html`), uma coluna, `main` com `max-width` do conteúdo (720 px acima de `--breakpoint-tablet`; 560 px como `pedido.css` se preferir; Dev usa os tokens de espaço, sem px de cor).

```
<main id="inicio-raiz" aria-busy="false">
  <h1>FastPro</h1>
  <p>Diga o serviço e onde ele será feito. Na próxima tela você descreve o pedido.</p>
  <p id="estado" role="status" aria-live="polite"></p>          // erros/avisos da página
  <form id="formulario" novalidate>
    campo serviço  : label "Qual serviço você precisa?" + input#servico (combobox/listbox) + ul#servico-lista + p#servico-aviso(status) + p#servico-erro
    campo endereço : label "Onde o serviço será feito?" + input#endereco + ul#endereco-lista + p#endereco-aviso + p#endereco-erro
    bloco#substituir (hidden): confirmação do rascunho existente (§5.3)
    button#continuar type=submit "Continuar"
  </form>
  <noscript>Ative o JavaScript para continuar.</noscript>
</main>
<script type="module" src="/inicio.js">
```

Componentes (arquivos e responsabilidades):

| Arquivo | Papel |
|---|---|
| `index.html` | Marcação acima; `lang="pt-BR"`, `meta viewport`, `meta robots noindex`, `<title>FastPro - Início</title>`, links para `/tokens.css` e `/inicio.css`. |
| `inicio.css` | Estilo só com `var(--...)` de `tokens.css` (cores, `--space-*`, `--input-height`, `--button-height-md`, `--radius-button`, `--font-family`, `--font-weight-bold`); foco visível; `var()` não vale dentro de `@media`: usar o valor literal do breakpoint, com comentário citando `--breakpoint-tablet` (conferir `check:typography`/`check:hex` na fatia 2). Sem hex, sem nome de cor, sem `rgb()`. |
| `inicio-logica.js` | Funções puras: `validarCampos({servicoId, endereco})` (devolve lista de erros E-01, E-02, E-03 na ordem serviço, endereço); `decidirCriacao({atual, servicoId})` (`criar`/`atualizar`/`confirmar`, ver §5.3); `INICIO_TEXTOS` (E-07, aguarde, serviço escolhido, confirmação). Importa `PEDIDO_TEXTOS` e `ADDRESS_*` de `/pedido-logica.js` e `/address-field.js`; sem DOM. |
| `inicio.js` | Visão: `chamar()` (cópia mínima do helper de `pedido.js`, ou importação se for extraído em `rede.js`; **decisão: copiar o helper de 15 linhas**, para não tocar `pedido.js` e evitar conflito com #154/#155), renderização da lista de serviço por `textContent`, `mountAddressField(..., context: 'request_draft')`, submissão, foco no primeiro erro, navegação `location.assign('/pedido')`. |

Acessibilidade do combobox de serviço: o `pedido.html` atual usa `type=search` + `ul` sem papéis de combobox para serviço [V]. A inicial deve ter o mesmo padrão do endereço (`role=combobox`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, `role=listbox`/`option`, Setas/Enter/Esc), pois CA-W14 exige Setas e Enter na lista. Dev implementa em `inicio.js` um pequeno adaptador de teclado sobre a lista renderizada (opções `li role=option` com `id` por posição); **não** altera `address-field.js`.

---

## 5. Estados e fluxo

### 5.1 Campo de serviço
Estados E-S0 a E-S6 do refino §5.2, com textos de `PEDIDO_TEXTOS` quando existirem [V]: `buscaSemResultado` ("Não encontramos esse serviço. Tente outra palavra."), `buscaFalhou` ("Não foi possível buscar agora. Tente de novo."), `muitasTentativas` ("Muitas tentativas. Aguarde um instante e tente de novo."). Textos novos só em `INICIO_TEXTOS`: "Buscando serviços…", "Serviço escolhido.". Digitar depois de escolher **zera o `servicoId`** (como `pedido.js`).

### 5.2 Campo de endereço
Estados E-E0 a E-E5 já cobertos por `mountAddressField`; sem código novo. Falha da sugestão não bloqueia o continuar (CA-W12).

### 5.3 Continuar (ramos) e API indisponível
1. Valida localmente (E-01, E-02, E-03). Falhou: erros por campo (`aria-invalid`, `aria-describedby`), foco no primeiro campo com erro, nenhuma requisição (CA-W04, CA-W13).
2. Botão desabilitado, rótulo "Aguarde…", `aria-busy="true"`.
3. `GET /api/v1/drafts/current`:
   - **404** → `POST /api/v1/drafts` `{ service_id, address_text }`. 201/200 → `location.assign('/pedido')`.
   - **200** e o rascunho **não tem descrição, urgência nem outro serviço** (ou o `service_id` é o mesmo) → `PATCH /api/v1/drafts/current` `{ service_id, address_text }` → navegar.
   - **200** com `service_id` diferente **e** rascunho com descrição ou urgência preenchida → mostrar bloco de confirmação (decisão 941): "Você já tem um pedido em andamento. Trocar o serviço mantém a descrição? " Botões "Trocar e continuar" (PATCH, mantém descrição e urgência) e "Voltar ao pedido que já existe" (`location.assign('/pedido')` sem alterar). Foco vai ao título do bloco; mensagem em região viva.
   - **Outro status ou falha de rede** (inclui **404 da rota por API fora do ar**, ver abaixo) → ver estado de erro.
4. Qualquer falha após o passo 2: reabilita o botão, mantém os dois campos, mostra E-07 em `#estado` (`role=status`) e **não navega** (CA-W08, RN-W-10).

**API indisponível (Issue #156).** Hoje `/api/v1/*` pode responder 404 sem JSON válido. Distinção obrigatória:
- Em `GET /drafts/current`, 404 **com corpo JSON da API** (resposta uniforme `draftNotFound`) significa "sem rascunho". 404 **sem corpo JSON** (HTML/vazio da plataforma) ou `corpo === null` significa **API indisponível**. Dev usa `chamar()` que devolve `corpo` nulo quando não é JSON [V] e trata `status 404 && corpo === null` como indisponível, **não** como "sem rascunho" (evita um POST que também falharia sem explicar).
- Estado: E-07 com texto "Não foi possível continuar agora. Seus dados estão aqui; tente de novo." e botão "Tentar de novo" é o próprio "Continuar". Busca de serviço com 404/erro cai em E-S4. Sem laço de repetição automática.
- [NV] o formato exato do corpo do 404 uniforme (`draftNotFound`, `draft-service.ts`): a fatia 1 lê e fixa em teste.

### 5.4 Erro de página
Sem JS, `<noscript>` com a mensagem; o formulário não envia. Sem estado de carregamento de dados (página estática).

---

## 6. Acessibilidade (WCAG 2.2 AA)

- Rótulos visíveis; ordem de foco serviço, lista, endereço, lista, Continuar.
- Mensagens em `role=status`/`aria-live=polite`; erros ligados por `aria-describedby`; foco no primeiro campo inválido (2.4.3, 3.3.1); sem roubo de foco em estados de busca.
- Alvos: botões e campos com `min-height: var(--button-height-md)`/`var(--input-height)` (acima de 24 px, 2.5.8); itens da lista com altura de toque equivalente.
- Foco visível `:focus-visible` com `var(--color-primary)` (como `pedido.css`); contraste só por tokens claro/escuro; `prefers-reduced-motion`: sem animação.
- Responsivo: sem rolagem horizontal em 360 px (`overflow-wrap: anywhere` em títulos e itens; `box-sizing: border-box`; `width: 100%`).
- Prova: axe nos dois temas e em duas larguras (fatia 4).

---

## 7. Segurança e privacidade

- **Sem PII em URL**: navegação para `/pedido` sem consulta nem fragmento; `location.assign('/pedido')` literal. Teste: URL final igual a `/pedido`.
- **Sem armazenamento do navegador**: nada em `localStorage`, `sessionStorage`, `indexedDB` nem `document.cookie` (o cookie é do servidor, HttpOnly).
- **Sem log**: nenhum `console.*`, nenhum envio de telemetria; erros não incluem texto digitado. (`check:logs` deve passar.)
- **Sem `innerHTML`/`eval`**; texto sempre por `textContent`; sem script/estilo inline (CSP).
- **Provedor de mapa**: nenhuma chamada a domínio externo; `connect-src 'self'`. Sem chave no navegador.
- Texto livre do endereço (máx. 120) vai só no corpo do `POST`/`PATCH`, nunca em URL nem em mensagem de erro.
- **Sem e-mail** disparado nesta tela (RF-012). Sem campos de identidade.
- Nenhum segredo, token ou UUID exibido; o `service_id` fica só em variável de módulo (memória), sem atributo `data-*` e sem texto no DOM.

---

## 8. Fatias de Desenvolvimento (curtas, cada uma com testes e provas)

Cada fatia termina com `corepack pnpm --filter @fastpro/web test` verde e os `check:hex`, `check:typography`, `check:logs` da fatia verdes. Tudo com **fake do `fetch`**.

**Fatia 1: lógica pura e leitura do contrato** (`inicio-logica.js`, `tests/inicio-logica.test.ts`)
- Ler `postDraft` e `draftNotFound` em `apps/api/src/drafts/draft-service.ts` e fixar os pontos [NV] de §3.3 e §5.3.
- Implementar `validarCampos`, `decidirCriacao`, `INICIO_TEXTOS`.
- Testes: serviço ausente (E-01), endereço vazio/curto (E-02), endereço >120 (E-03), ordem dos erros, 3 ramos de `decidirCriacao`, ramo de confirmação só com serviço diferente + descrição/urgência, paridade de constantes com `address-field.js` e com o limite do endereço do domínio (`parseAddress`, 120). Textos sem "grátis", "barato", "promoção", "R$", "API", "token", "UUID" (CA-W20).
- Prova: vitest, contagem e código de saída.

**Fatia 2: marcação, estilo e visão** (`index.html`, `inicio.css`, `inicio.js`, `tests/inicio-page.test.ts`)
- Marcação conforme §4; `inicio.css` só com tokens; `inicio.js` liga DOM, busca (`criarControladorBusca`), `mountAddressField` (`request_draft`), teclado da lista de serviço, escolha, erros e foco.
- Testes (padrão `node:vm` com DOM simulado dos testes `acesso-page`/`codigo-page`, ou `jsdom` se existir): CA-W01 (título, campos, sem "Sem conteúdo de produto"), CA-W02, CA-W03, CA-W04 (zero requisições de criação), CA-W05 (URLs chamadas só `/api/v1/...` mesma origem), CA-W09, CA-W10, CA-W11, CA-W12, CA-W21 (ausência de e-mail/nome/senha/links de entrar/cadastro), CA-W19 (espiões nos armazenamentos).
- Prova: vitest.

**Fatia 3: continuar, rascunho e navegação** (`inicio.js`, `tests/inicio-continuar.test.ts`)
- Ramos de §5.3 com fake do `fetch` sequencial: 404 JSON → POST → navega (CA-W06, CA-W07: corpo exatamente `{service_id, address_text}`, `Content-Type` JSON, `credentials: same-origin`); 200 → PATCH; confirmação 941; falha 5xx/rede mantém campos e não navega (CA-W08); `404` sem JSON = API indisponível com E-07 e sem POST; botão desabilitado e `aria-busy` durante o envio; clique duplo = uma só criação; `location.assign` chamado com `/pedido` literal (CA-W19).
- Prova: vitest.

**Fatia 4: cabeçalhos, navegador, acessibilidade e checagens** (`vercel.json`, `tests/inicio-estatico.test.ts`, `tests/e2e/inicio.spec.ts`)
- Adicionar bloco `source: "/"` em `vercel.json` (A-4). Teste estático novo (não edita `address-pedido-csp.test.ts`): `/` tem CSP com `connect-src 'self'`, `default-src 'none'`, `style-src 'self'`, `X-Robots-Tag: noindex`, `meta robots` no `index.html`, e `index.html` sem `style=`, sem `<style>`, sem script inline.
- Playwright (modelo `pedido-h030.spec.ts`, API simulada por `route`, qualquer outra origem abortada): CA-W14 (teclado completo), CA-W15/CA-W13 (axe, rótulos, foco no erro), CA-W16 (axe nos temas claro/escuro), CA-W17 (360 e 1280 px, sem rolagem horizontal, alvos), CA-W12 (rede da rota de endereço bloqueada), navegação até `/pedido` com URL sem parâmetros.
- Rodar `check:hex`, `check:typography`, `check:logs`, `check:secrets` e, por fim, `check:all` (se ainda vermelho por #149, registrar que as falhas restantes não vêm de arquivos desta Issue, com a saída dos checks restritos a esses arquivos).
- Prova: vitest + `test:e2e` (contagens e códigos de saída) na Issue.

**Fatia 5 (curta, opcional por tempo): ligação ao preview**: conferir `GET /` retornando a inicial no build do web (depende de #152, CA-W22) por um teste de leitura do `dist`/`public` ou verificação manual registrada. Sem alteração de código.

---

## 9. Arquivos que serão tocados

**Criados:** `apps/web/public/inicio.css`, `apps/web/public/inicio.js`, `apps/web/public/inicio-logica.js`, `apps/web/tests/inicio-logica.test.ts`, `apps/web/tests/inicio-page.test.ts`, `apps/web/tests/inicio-continuar.test.ts`, `apps/web/tests/inicio-estatico.test.ts`, `apps/web/tests/e2e/inicio.spec.ts`.

**Editados:** `apps/web/public/index.html` (**exclusivo desta Issue**; #155 depende de #153 e só edita `index.html` depois dela, como o líder determinou), `apps/web/vercel.json` (só um bloco novo `source: "/"`, inserido antes de `/acesso`; possível conflito de mesclagem com #154 se ela também inserir blocos: serializar o merge ou inserir em posição distinta).

**Não tocar:** `pedido.js`, `pedido.html`, `pedido-logica.js`, `address-field.js`, `pedido.css`, `tokens.css`, `packages/tokens`, `apps/api`, `packages/domain`, `packages/contracts`, `acesso.*`, `codigo.*`, testes existentes, `11-DECISOES.md`, quadro.

---

## 10. Riscos

| Nº | Risco | Mitigação |
|---|---|---|
| R-1 | API local 404 por falta de variáveis (#156): a tela não pode ser provada com API real agora. | Fake do `fetch` em todos os testes; 404 sem JSON tratado como indisponível (§5.3); ponta a ponta fica na suíte QA final, depois de #156. |
| R-2 | Comportamento de `POST /drafts` com cookie existente [NV]. | Fatia 1 lê `postDraft`; fluxo usa GET e PATCH quando há rascunho, POST só com 404 JSON. |
| R-3 | Conflito de `vercel.json` com #154/#155. | Mudança mínima (um bloco); Orquestrador serializa os merges; sem alteração em blocos existentes. |
| R-4 | `check:all` vermelho por #149 (hex/tipografia) pode mascarar problemas desta Issue. | Rodar os checks também filtrados aos arquivos novos e registrar a saída; não declarar `check:all` verde se não estiver. |
| R-5 | `check:typography` pode exigir convenções de tamanho de fonte [NV]. | Seguir `pedido.css` (`font-size: 16px`, `rem` em títulos) e conferir na fatia 2. |
| R-6 | `@media` não aceita `var()`. | Valor literal do breakpoint com comentário citando o token; sem cor literal. |
| R-7 | Combobox de serviço novo (teclado) pode divergir do padrão do endereço. | Mesma semântica ARIA do `address-field.js`; teste de teclado e axe (fatias 2 e 4). |
| R-8 | Substituição de rascunho (941) perder dados. | Só PATCH de `service_id`/`address_text`; descrição e urgência preservadas; confirmação quando o serviço muda e há conteúdo. |
| R-9 | Preview não atualiza sem #152 concluída. | Decisão 947: nenhuma ação aqui; a prova local vale; CA-W22 fica para depois da decisão humana sobre #152. |
| R-10 | `jsdom` possivelmente ausente [NV]. | Desenho não depende dele: padrão `node:vm` já usado no repo. |

---

## 11. Verificações que o Dev deve registrar na Issue
Comando, contagem e código de saída de: `corepack pnpm --filter @fastpro/web test`, `... typecheck`, `... lint`, `... test:e2e`, `corepack pnpm check:hex`, `check:typography`, `check:logs`, `check:secrets`, `check:all`. Sem simular resultados.

## 12. Dúvidas ao líder
Nenhuma que bloqueie. Pontos [NV] acima são verificações de Dev, não perguntas ao usuário.
