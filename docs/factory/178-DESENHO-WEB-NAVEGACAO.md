# Desenho 178: navegação ligando as telas num fluxo a partir da inicial (Issue #155)

- **Issue:** #155 `[E16] Navegação ligando as telas existentes num fluxo a partir da inicial` · **Workflow:** WF-03 · **Etapa:** Arquitetura · **EXEC-ID:** EXEC-ARQ-155-20261121
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init` · **Data:** 2026-11-21 · **Entrada:** `173-REFINO-WEB-NAVEGACAO.md` (PO), decisões 960 a 966 adotadas pelo líder; desenhos irmãos `175-DESENHO-WEB-INICIAL.md` (#153) e `176-DESENHO-WEB-ENTRADA.md` (#154).
- **Natureza:** somente documento. Nenhum código, quadro, `11-DECISOES.md` ou commit foi alterado.
- **Etiquetas:** `[V]` verificado por leitura nesta rodada · `[NV]` não verificado, vira verificação obrigatória na fatia indicada · `[ADOTADA]` decisão do líder, vetável · `[AD]` decisão deste desenho, vetável · `[CORREÇÃO]` o refino 173 divergia do código.

---

## 1. Resumo para o líder

1. **Dev só começa depois de #153 e #154.** Este desenho declara os pontos de integração (seção 6) em vez de repetir o que elas entregam: o link "Entrar" da inicial, os blocos `fp:cabecalho`/`fp:rodape` vazios das telas de entrada, o `<main id="conteudo">` e a lista de retorno seguro.
2. **Quatro correções ao refino 173, vindas do código `[V]`:**
   - O cookie de sessão é `__Host-fp_sess` (HttpOnly, o navegador não o lê), não `fastpro_session`. Logo **a guarda de sessão é feita por uma chamada à API** (401 ou 403 = sem sessão), nunca lendo cookie (AD-155-03).
   - O parâmetro de retorno é `?voltar=` e a função é `destinoSeguro` de `entrada-comum.js` (#154, AD-154-07); o refino dizia `?retorno=` (AD-155-04).
   - `profissional-perfil.js` e `.css` **não são** a tela "serviços, base e raio": são o renderizador do **perfil público** (H-043). A edição de serviços, base e raio existe só como API (`GET/PUT /v1/professional/profile/services` e `/area`, H-036), sem tela. Ver D-1.
   - `/profissional` é um redirecionamento 307 para `/profissional/entrar` (#154, AD-154-09); não é página.
3. **Sem framework e sem injeção por JavaScript.** Cabeçalho e rodapé são HTML repetido em cada arquivo, mantido igual por um script pequeno de sincronização (`--check` no teste) e conferido por teste estático (AD-155-01).
4. **Telas novas:** `painel`, `profissional-situacao`, `profissional-perfil` (leitura, D-1), `404`. Todas com cabeçalho e rodapé comuns, tokens do EDS, sem cor literal.
5. **Prova ponta a ponta:** um cenário Playwright + axe, com a **API simulada por `route`** (padrão `pedido-h030.spec.ts`). Enquanto a #156 não ligar a API local, não há prova com API real; a Issue não pode dizer que há (R-1).
6. **Dúvidas ao líder** (todas com recomendação, nenhuma enviada ao usuário): seção 11.

---

## 2. Inventário real `[V]`

- `apps/web/public`: `index.html` (provisória; #153 a substitui), `acesso.*`, `codigo.*`, `fotos.html/.js/.css/fotos-envio.js` (gerado), `pedido.html/.js/.css/pedido-logica.js/pedido-revisao.js`, `pedido/revisao.html`, `profissional-documento.*`, `profissional-documentos.*`, `profissional-perfil.js/.css` (sem HTML), `profissional-situacao.js` (sem HTML, sem CSS), `address-field.js`, `tokens.css` (gerado, não editar).
- `apps/web/vercel.json`: `cleanUrls: true`, cabeçalhos globais e blocos por rota (`/acesso`, `/pedido`, `/pedido/(.*)`, `/pedido/revisao`, `/codigo`, `/codigo/(.*)`, `/fotos`, `/profissional-documento`). **Sem** bloco para `/profissional-documentos`, **sem** `redirects` e **sem** `rewrites` (o encaminhamento de `/api/*` é da #156, `[V]` em 176 L-5). Todos os blocos usam CSP `default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` (a de `/fotos` acrescenta o Supabase e `img-src blob:`).
- Nenhuma página tem `<header>`, `<nav>` ou `<footer>` (todas têm `<main>`); o `<main>` das existentes tem ids próprios usados por JS/CSS (`pedido-raiz`, `documentos`, ...).
- Testes: Vitest (`vitest.config.ts` exclui `tests/e2e`); `@playwright/test ^1.65.0` e `@axe-core/playwright ^4.14.0` já são devDependencies do web `[V]`; `playwright.config.ts` usa `baseURL http://fastpro.test`, projeto `chromium`, sem servidor (as páginas saem de `public` por `route`); modelo: `tests/e2e/pedido-h030.spec.ts` (serve `.html/.js/.css`, simula a API por `route`, aborta outra origem, exige lista vazia de requisições externas). Scripts do web: `test` (copia tokens, builda `fotos-envio`, `vitest run`) e `test:e2e`. `[NV]` se o Chromium está instalado nesta máquina (S0).
- Rotas da API reais para guarda e telas `[V]`: `GET /v1/requests` (lista do dono; ordem: método, parâmetros só `cursor`, cookie ausente = **401** `{code:'sessao_necessaria'}`; corpo 200 `{items, nextCursor}`; itens com as chaves `PANEL_ITEM_KEYS` de `@fastpro/domain`); `GET /v1/professional/verificacao` (200 `{estado, motivo?, explicacao?, decididoEm?, recurso:{situacao}}`; 401); `GET /v1/professional/profile` (`{publicName, slug, documentType, verification}`); `GET /v1/professional/profile/services` (`{services:[{serviceId,name,regulated,active,modalities}]}`); `GET /v1/professional/profile/area` (`{configured:false}` ou `{configured:true, addressLabel, radiusKm, since, changesRemaining, nextChangeAt}`). No navegador todas são `/api/v1/...`, mesma origem.
- `build-fotos-envio.mjs` mostra o precedente de empacotar `@fastpro/domain` para o navegador com **esbuild** (devDependency gratuita, decisão 194) e `stub-node-crypto.mjs` para o `node:crypto` do domínio.

---

## 3. Decisões

### 3.1 Adotadas pelo líder (refino 173), com o efeito no desenho

| Nº | Decisão | Efeito |
|---|---|---|
| 960 B | Cliente: `/` → `/pedido` → `/fotos` → `/pedido/revisao` → (ao publicar, sem sessão) entrada → volta à revisão → confirmação expressa → `/painel` | S4. Hoje `pedido.js` vai direto à revisão (`CAMINHOS.paginaRevisao`, `pedido.js:265` `[V]`); passa a ir a `/fotos`; `/fotos` ganha "Continuar" para a revisão. |
| 961 B | Profissional: `/profissional/entrar` → `/profissional-documentos` → `/profissional-situacao` → `/profissional-perfil` (só depois da aprovação) | Subnavegação de 3 itens; guarda do perfil (AD-155-06). |
| 962 A | Tela mínima `/painel` sobre a API da #47 | S5. |
| 963 A | `profissional-documentos` oficial; `profissional-documento` redireciona (sem apagar arquivo) | Redirecionamento 307 em `vercel.json` (AD-155-08). |
| 964 A | Criar as páginas de situação e perfil | S6; com a ressalva D-1 sobre o perfil. |
| 965 A | Exceção controlada: um cenário feliz em navegador + axe, local | S7. |
| 966 A | Rascunho guardado por 7 dias | Só verificação (S0/S4): constante do domínio deve ser 7 dias `[NV]`; divergência é reportada, não corrigida aqui. |

### 3.2 Decisões deste desenho `[AD]`

| Nº | Decisão | Motivo |
|---|---|---|
| AD-155-01 | **Cabeçalho, rodapé e subnavegação em HTML repetido**, entre marcadores `<!-- fp:cabecalho -->…<!-- /fp:cabecalho -->`, `<!-- fp:rodape -->…<!-- /fp:rodape -->` e `<!-- fp:subnav -->…<!-- /fp:subnav -->` (os mesmos marcadores que a #154 deixa vazios). Fonte única do texto em `scripts/navegacao-blocos.mjs`; `scripts/sincronizar-navegacao.mjs` grava os blocos nos arquivos (modo `--check` só confere). O teste chama o modo `--check`. | V1 do refino (sem framework nem JS de injeção) com proteção contra deriva; é ferramenta de desenvolvimento, não parte do produto. |
| AD-155-02 | **Tabela única de rotas** `ROTAS` em `public/navegacao-logica.js` (rota, arquivo, área `publica`/`cliente`/`profissional`, item de menu atual, `retornavel`). Teste exige que todo `.html` de `public` esteja na tabela e todo item da tabela exista. | Evita página sem navegação e link para rota inexistente (CA-NAV-09). |
| AD-155-03 | **Guarda de sessão por sonda de API**, não por cookie: `HttpOnly` impede leitura. Regra: **401 ou 403 = sem sessão do papel certo → redireciona** para a entrada da área; 200 ou 404 = sessão válida (404 de "ainda sem registro" não é falta de sessão); rede ou 5xx = estado "indisponível" com "Tentar de novo", sem liberar dado. Conteúdo protegido começa com `hidden` no HTML e só é revelado depois da resposta. | Sem rota "quem sou eu" (176 L-4). 403 cobre a exclusividade de papéis (#30). |
| AD-155-04 | **Retorno = `?voltar=<caminho>`** com `destinoSeguro` de `entrada-comum.js` (#154). A lista fixa vive lá; a #155 só **acrescenta** `/painel`, `/profissional-documentos`, `/profissional-situacao`, `/profissional-perfil`. Teste de paridade: todo item `retornavel` de `ROTAS` está na lista. | Uma única lista; evita duas funções de retorno (RN-NAV-12). |
| AD-155-05 | **Entradas por área:** cliente sem sessão → `/entrar?voltar=<rota>`; profissional sem sessão → `/profissional/entrar?voltar=<rota>`. `/acesso` e `/codigo` continuam as páginas que consomem link e código (#154), não são destino de guarda. | Alinha com 176 §4.1 e 5.3. |
| AD-155-06 | **Perfil só depois da aprovação:** `/profissional-perfil` consulta `GET /v1/professional/verificacao`; se `estado` não for o estado aprovado, `location.replace('/profissional-situacao')`. A função pura `perfilLiberado(estado)` é testada contra a constante do domínio (`ESTADOS_PUBLICOS_VERIFICACAO`, valor exato `[NV]`, fixado na S1). | RN-NAV-08. |
| AD-155-07 | **Salto para o conteúdo:** o primeiro item focável é `<a class="pular" href="#conteudo">Pular para o conteúdo</a>`, dentro do bloco `fp:cabecalho`. Telas novas usam `<main id="conteudo">`. Telas existentes cujo `<main>` tem id em uso (JS, CSS ou teste) **mantêm o id** e recebem como primeiro filho `<span id="conteudo" tabindex="-1"></span>`. | Não quebra `pedido-raiz`, `documentos` e semelhantes; o bloco do cabeçalho fica idêntico em todas. |
| AD-155-08 | **Redirecionamento do documento duplicado:** `redirects` em `vercel.json`, `{ "source": "/profissional-documento", "destination": "/profissional-documentos", "permanent": false }` (307). Arquivos `profissional-documento.*` ficam; os testes atuais deles seguem lendo o arquivo. | Decisão 963 A. Redirecionamentos têm precedência sobre arquivos. |
| AD-155-09 | **Cabeçalho não fixo** (`position: static`) e navegação **sempre visível, com quebra de linha** em 320 px. Sem menu escondido. | WCAG 2.4.11 (foco não oculto), 1.4.10 (reflow), V2. |
| AD-155-10 | **Logo é texto** "FastPro" (sem imagem). Sem recurso externo; CSP não muda. | Simples e acessível. |
| AD-155-11 | **Perfil do profissional nesta Issue = leitura** do próprio perfil (nome, serviços ativos, base e raio) com `GET` das três rotas; a edição (PUT) fica fora. Ver D-1. | A tela de edição não existe; criar seria outra história. |
| AD-155-12 | **Situação reaproveita `renderizarSituacao`** (existente) alimentado pelo `construirTela` do domínio, empacotado por esbuild em `public/situacao-bundle.js` (gerado, ignorado pelo git, igual ao `fotos-envio.js`), com o stub de `node:crypto` já existente. Destinos de botão (`tela.acao.destino`) passam por uma lista fixa de rotas internas. | `renderizarSituacao` recebe um view-model, não a resposta da API `[V]`. |
| AD-155-13 | **Testes sem rede real:** `fetch` falso nos testes de página (padrão `node:vm` do repo) e `route` no Playwright. | API local ainda em 404 (#156). |

---

## 4. Mapa de rotas

Origem: `ROTAS` (AD-155-02). "Item" = item do menu principal marcado com `aria-current="page"`.

| Rota | Arquivo | Área | Item | Origem | Situação |
|---|---|---|---|---|---|
| `/` | `index.html` | pública | Início | #153 | #155 só insere blocos (6.1) |
| `/pedido` | `pedido.html` | pública | Pedir um serviço | existente | recebe blocos; avança para `/fotos` (S4) |
| `/fotos` | `fotos.html` | pública | Pedir um serviço | existente | recebe blocos; "Continuar" para a revisão; "Voltar" para `/pedido` |
| `/pedido/revisao` | `pedido/revisao.html` | pública | Pedir um serviço | existente | recebe blocos; "Voltar" para `/fotos`; sessão expirada (S4) |
| `/entrar` | `entrar.html` | pública | Entrar | #154 | recebe blocos |
| `/acesso`, `/codigo` | `acesso.html`, `codigo.html` | pública | Entrar | existente/#154 | recebem blocos |
| `/painel` | `painel.html` | cliente | Meus pedidos | **nova** | S5; guarda por 401 da lista |
| `/profissional` | (redirect 307) | — | — | #154 | não é página |
| `/profissional/entrar`, `/cadastro`, `/recuperar`, `/verificar`, `/redefinir` | `profissional/*.html` | pública | Sou profissional | #154 | recebem blocos |
| `/profissional-documentos` | `profissional-documentos.html` | profissional | (subnav) Documento | existente | recebe blocos, subnav e guarda |
| `/profissional-documento` | `profissional-documento.html` | — | — | existente | redireciona (AD-155-08); mantém o arquivo; **fora** da tabela de navegação, com exceção explícita `semNavegacao` no teste |
| `/profissional-situacao` | `profissional-situacao.html` | profissional | (subnav) Situação | **nova** | S6b |
| `/profissional-perfil` | `profissional-perfil.html` | profissional | (subnav) Perfil | **nova** | S6c; só após aprovação |
| `/404` | `404.html` | pública | nenhum | **nova** | S3 |

Nenhuma rota administrativa aparece em `ROTAS` nem em links (RN-NAV-06; o teste varre `href` por `/admin`).

Diagrama (cliente, decisão 960 B):

```
[/] -> [/pedido] -> [/fotos] -> [/pedido/revisao] --(sem sessão ao publicar)--> [/entrar?voltar=/pedido/revisao]
                                       |                                              |  (link/código: /acesso, /codigo)
                                       |<-------------------------------------------- volta à revisão (rascunho preservado)
                                       v confirmação expressa
                                   [publicado] -> [/painel]
```

Profissional (961 B):
`/profissional/entrar` → `/profissional-documentos` → `/profissional-situacao` → `/profissional-perfil` (antes da aprovação: redireciona para a situação).

---

## 5. Componentes compartilhados

### 5.1 Blocos HTML (texto final em `navegacao-blocos.mjs`)

Cabeçalho (dentro de `fp:cabecalho`, logo depois de `<body>`):

```html
<!-- fp:cabecalho -->
<a class="pular" href="#conteudo">Pular para o conteúdo</a>
<header class="fp-cab">
  <a class="fp-logo" href="/">FastPro</a>
  <nav aria-label="Principal">
    <ul class="fp-menu">
      <li><a href="/">Início</a></li>
      <li><a href="/pedido">Pedir um serviço</a></li>
      <li><a href="/painel">Meus pedidos</a></li>
      <li><a href="/entrar">Entrar</a></li>
      <li><a href="/profissional/entrar">Sou profissional</a></li>
    </ul>
  </nav>
</header>
<!-- /fp:cabecalho -->
```

Subnavegação (só nas três telas do profissional e em `/profissional-documentos`, dentro de `fp:subnav`, depois do cabeçalho):
`<nav class="fp-sub" aria-label="Passos do profissional">` com `Documento` → `/profissional-documentos`, `Situação` → `/profissional-situacao`, `Perfil` → `/profissional-perfil`.

Rodapé (`fp:rodape`, depois do `</main>`): `<footer class="fp-rod"><nav aria-label="Rodapé">` com `Início`, `Pedir um serviço`, `Sou profissional`. **Sem** link de Termos (V6), **sem** o aviso "apenas conecta", sem contadores, sem contatos de terceiros (RN-NAV-05, 11).

Regras:
- `header` e `footer` são filhos diretos de `body` (landmarks `banner` e `contentinfo`). Três `nav` com `aria-label` distintos.
- O script marca `aria-current="page"` **somente** no item da página atual (coluna "Item"); páginas sem item (404, `/acesso` etc. conforme a tabela) ficam sem marca. Na subnavegação, o item atual idem.
- Títulos no padrão `FastPro - <tela>` (V7), conferidos pelo teste.

### 5.2 Estilo

`public/navegacao.css`, carregado depois de `/tokens.css` em todas as páginas. Só `var(--...)` do EDS (cores, `--space-*`, `--font-*`, `--button-height-md` para altura mínima dos alvos); `:focus-visible` com `var(--color-primary)`; `flex-wrap: wrap` no menu; `.pular` visível ao receber foco (sem `display:none`); `prefers-reduced-motion` sem animação. `var()` não vale em `@media`: literal do breakpoint com comentário citando o token (padrão de 175 R-6). Conferir `check:hex` e `check:typography` na S2 `[NV]` para convenções de fonte.

### 5.3 Módulos JavaScript (ES, sem dependências, mesma origem)

| Arquivo | Papel |
|---|---|
| `navegacao-logica.js` | Puro, sem DOM: `ROTAS`; `montarEntrada(area, caminhoAtual)` (`/entrar` ou `/profissional/entrar` com `?voltar=` só se a rota estiver na lista); `decidirSonda(status)` → `liberar` (200, 404), `entrar` (401, 403), `indisponivel` (demais e falha de rede); `perfilLiberado(estado)`; `DESTINOS_SITUACAO` (lista fixa de destinos de botão). |
| `guarda-sessao.js` | Visão: lê `data-area` e `data-sonda` do `<main>`, chama a sonda (`fetch` same-origin, `credentials`, `cache: 'no-store'`, `redirect: 'error'`, `referrerPolicy: 'no-referrer'`, como `chamar()` de `pedido.js`), aplica `decidirSonda`, revela o conteúdo ou navega por `location.replace`. Estados: carregando (`aria-busy`, texto "Verificando seu acesso…"), indisponível (texto + "Tentar de novo"). Sem log, sem armazenamento, sem `innerHTML`. Usado por `profissional-documentos` (sonda `GET /api/v1/professional/verificacao`); `painel`, `situacao` e `perfil` fazem a própria chamada e reutilizam as funções puras. |
| `painel.js`, `profissional-situacao-pagina.js`, `profissional-perfil-pagina.js` | Visão de cada tela nova (seção 7). Os nomes com `-pagina` evitam colidir com os `.js` existentes `profissional-situacao.js` e `profissional-perfil.js`, que continuam só renderizadores. |

Textos novos ficam em constantes (`NAV_TEXTOS`), sem jargão; nada de "token", "API", "UUID".

---

## 6. Pontos de integração com #153 e #154 (não duplicar)

### 6.1 Com a #153 (inicial)

- `index.html` é **exclusivo da #153**. A #155 só o edita depois dela, e apenas para: inserir os três blocos, o skip link e `id="conteudo"` (ou o sentinela da AD-155-07), e `<link rel="stylesheet" href="/navegacao.css">`. A #153 não escreve cabeçalho nem rodapé.
- **Conflito a resolver na S2:** a #153 (175/171, decisão 944) proíbe link de entrar/cadastro **na inicial** (CA-W21) enquanto a #154 (176 §5.3) pede `<a href="/entrar">Entrar</a>` no topo de `index.html`. Com o cabeçalho comum, "Entrar" passa a existir no `<header>`, que fica **fora de `<main>`**. Ação: se a #153/#154 deixaram um "Entrar" provisório no topo de `index.html`, a S2 o remove (o do cabeçalho o substitui, mesmo rótulo e mesmo `href`, e o teste da #154 continua verdadeiro); se o teste CA-W21 da #153 varre o arquivo inteiro, a S2 o restringe a `<main>` (edição mínima de teste de outra Issue, registrada na Issue #155).
- Contrato de passagem inicial → pedido (`POST/PATCH /drafts`, `location.assign('/pedido')`) é da #153. A #155 só o prova na navegação (CA-NAV-01).
- `<main id="inicio-raiz">` da #153: usa o sentinela da AD-155-07.

### 6.2 Com a #154 (entrada)

- As telas novas da #154 já trazem `<main id="conteudo">` e os marcadores `fp:cabecalho`/`fp:rodape` **vazios**: a #155 preenche, não recria.
- `DESTINO_PROFISSIONAL` em `entrada-comum.js` (AD-154-02) passa de `/profissional-documentos` para o destino final definido pela decisão 961 B. Pela ordem do fluxo, **continua `/profissional-documentos`** (documentos vêm antes da situação); a situação é o destino depois de o documento ser enviado (botão de `profissional-documentos`, S6a). Portanto **a constante não muda**; registrar na Issue.
- Lista `destinoSeguro` ampliada (AD-155-04): edição de uma linha em `entrada-comum.js`, **depois** da #154 concluída; teste de paridade em `navegacao-logica.test.ts`.
- `acesso.html`, `acesso.js`, `codigo.html` já são alterados pela #154: a #155 vem **depois** (ordem fixa, 176 §5.3). `vercel.json` é alterado pelas duas e pela #153: serializar merges e inserir cada bloco em posição distinta; `redirects` pode já existir (#154, `/profissional`): acrescentar o item, nunca recriar a chave.
- O cabeçalho comum usa exatamente `Entrar` → `/entrar` e `Sou profissional` → `/profissional/entrar` (176 §5.3 c).

---

## 7. Telas novas e guardas

### 7.1 `/painel` (S5)

`painel.html` + `painel.js` + `painel.css`, `<main id="conteudo" data-area="cliente" aria-busy="true">`.
- Chamada: `GET /api/v1/requests` (mesma origem; primeira página sem `cursor`). **Sem** sondagem separada: o 401 da própria lista é a guarda.
- Estados: carregando (`role="status"`, "Carregando seus pedidos…"); 200 com itens (lista `ul`, um `li` por pedido, campos conforme `PANEL_ITEM_KEYS` `[NV]` fixados na S1 por teste de paridade com `@fastpro/domain`; datas e rótulos de estado formatados por funções puras; sempre `textContent`); 200 vazio (mensagem com ação "Pedir um serviço" → `/pedido`, texto `[texto pendente AMB-03]` sem inventar, ver D-4); `nextCursor` → botão "Carregar mais" (cursor opaco, só no corpo ou na consulta `?cursor=`, nunca registrado); 401/403 → `location.replace(montarEntrada('cliente','/painel'))`; 429/5xx/rede → "Não foi possível carregar agora." + "Tentar de novo" (dados já exibidos permanecem).
- Sem detalhe do pedido (não existe tela): itens sem link. Sem telefone, e-mail, endereço completo ou foto (RN-NAV-11).
- Cabeçalho HTTP: bloco `/painel` em `vercel.json` (no-store, noindex, CSP padrão).

### 7.2 `/profissional-situacao` (S6b)

`profissional-situacao.html` + `profissional-situacao-pagina.js` + `profissional-situacao.css` (novo; o `.js` existente não tem CSS), mais `situacao-bundle.js` gerado (AD-155-12).
- Fluxo: `GET /api/v1/professional/verificacao` → 401/403 = entrar (`/profissional/entrar?voltar=/profissional-situacao`); 200 → `construirTela(...)` → `renderizarSituacao(raiz, tela)`; 404 = "sem documento enviado ainda" com link "Enviar documento" → `/profissional-documentos` (texto próprio mínimo, sem inventar motivo; AMB-03). O botão da `acao.destino` navega só para destinos da lista fixa.
- Subnavegação e guarda iguais às demais telas do profissional.
- `[NV]` entrada exata de `construirTela` e valores de `estado`: leitura em `professional-verification-screen.ts` na S1; teste de paridade fixa.

### 7.3 `/profissional-perfil` (S6c)

`profissional-perfil.html` + `profissional-perfil-pagina.js`, reutilizando o `profissional-perfil.css` existente só se as classes servirem (`[NV]`; senão um `profissional-perfil-pagina.css` novo).
- Guarda: sonda `GET /api/v1/professional/verificacao`; sem sessão → entrar; `!perfilLiberado(estado)` → `/profissional-situacao`.
- Conteúdo: `GET /profile`, `GET /profile/services`, `GET /profile/area`; mostra nome público, serviços ativos, base (`addressLabel`) e raio (`radiusKm`, 5 a 100 km); `configured:false` = "Base e raio ainda não definidos" (sem botão de edição, ver D-1). Sem coordenadas (a API não as envia).

### 7.4 `/profissional-documentos` e redirecionamento (S6a)

Recebe blocos, subnavegação e `guarda-sessao.js` (conteúdo `hidden` até a sonda). Depois do envio do documento, mostra o link "Ver situação" → `/profissional-situacao` (acréscimo mínimo na marcação; sem tocar a lógica do controlador, que tem testes). `/profissional-documento` redireciona (AD-155-08).

### 7.5 `/404` (S3)

`404.html`, `<title>FastPro - Página não encontrada</title>`, `noindex`, blocos comuns, `<main id="conteudo">` com título "Não encontramos essa página" e dois links: "Ir para o início" e "Pedir um serviço". Caminhos de ativos absolutos (`/tokens.css`, `/navegacao.css`) para funcionar em qualquer URL. Sem script. `[NV]` a hospedagem estática servir `404.html` com status 404 (comportamento da Vercel para saída estática): confirmar na configuração existente; o teste local do Playwright serve `404.html` para caminho desconhecido com status 404.

### 7.6 Sessão expirada na publicação e "Voltar" (S4)

- `pedido/revisao`: 401 na confirmação → não publica; mensagem "Sua sessão terminou. Entre de novo para publicar. Seu pedido continua guardado." e link "Entrar de novo" → `/entrar?voltar=/pedido/revisao`; ao voltar, a revisão recarrega o rascunho (`GET /drafts/current/review`) e exige **nova** confirmação expressa (CA-NAV-06). `[NV]` o tratamento atual de 401 em `pedido-revisao.js`/`pedido.js`: S4 lê e ajusta o mínimo.
- "Voltar": link em `/fotos` (para `/pedido`) e em `/pedido/revisao` (para `/fotos`); "Editar" da revisão continua apontando `/pedido#...` e o rascunho mantém o mesmo cookie (identificador) porque o servidor o guarda.
- Pedido já publicado: voltar à revisão mostra "Pedido publicado" e não reenvia (idempotência da #44, já existente).
- Tela de confirmação de publicação: informar que a pessoa deve voltar ao FastPro para ver as respostas (FA-001, decisão 10), com link para `/painel`; `[NV]` se já existe texto equivalente (S4 conferirá e só acrescentará o link).

---

## 8. Cabeçalhos HTTP (`vercel.json`)

Blocos novos, com a mesma política dos existentes (no-store, no-referrer, noindex, nosniff, `X-Frame-Options: DENY`, CSP padrão com `connect-src 'self'`): `/painel`, `/profissional-documentos`, `/profissional-situacao`, `/profissional-perfil`. Para `404`, os cabeçalhos globais bastam. `redirects`: `/profissional-documento` (AD-155-08). Nenhum domínio externo, nenhum script ou estilo inline (a CSP `style-src 'self'` exige tudo em arquivo), nenhum `style=`.

---

## 9. Provas e fatias de Desenvolvimento (curtas)

Cada fatia termina com `corepack pnpm --filter @fastpro/web test` verde (e a suíte de cada tela alterada) e registra comando, contagem e código de saída na Issue. Sempre rodar também os testes das outras Issues já existentes de `apps/web` (regressão). Nada de GitHub Actions como evidência.

**S0. Pré-condições e linha de base (sem código).** Conferir #153 e #154 em Aguardando aprovação ou concluídas; #152 e #149; `corepack pnpm check:all` (se vermelho, registrar o que falha e por quê); `corepack pnpm --filter @fastpro/web test` e `typecheck`/`lint`; `playwright --version` e se o Chromium está instalado (`corepack pnpm exec playwright install chromium`, gratuito); listar por Grep os `id` dos `<main>` e onde são usados; constante de TTL do rascunho no domínio `[NV]` (7 dias, 966). Prova: saída dos comandos.

**S1. Lógica e contratos (`navegacao-logica.js`, `tests/navegacao-logica.test.ts`).** `ROTAS`, `montarEntrada`, `decidirSonda`, `perfilLiberado`, `DESTINOS_SITUACAO`. Ler `professional-verification-screen.ts`/`types` e `PANEL_ITEM_KEYS` e fixar em teste: valor aprovado de `estado`, chaves dos itens. Testes: `decidirSonda` (200, 404, 401, 403, 429, 500, falha de rede); `montarEntrada` (rota da lista, rota fora da lista, valor com `//`, `http:`, `javascript:`); paridade das rotas `retornavel` com a lista de `entrada-comum.js` (leitura de texto); TTL 7 dias se exportado. Cobre CA-NAV-05 (decisão), 08, 16.

**S2. Blocos comuns e estilo (`navegacao.css`, `scripts/navegacao-blocos.mjs`, `scripts/sincronizar-navegacao.mjs`, `tests/navegacao-estatico.test.ts`).** Escrever os blocos (5.1), aplicar às páginas existentes e às da #153/#154, em lotes (primeiro `acesso`/`codigo`, depois `pedido`/`fotos`/`revisao`, depois `index` e as de profissional), rodando a suíte do web a cada lote para pegar testes que dependam da estrutura do HTML. Teste estático: (a) blocos idênticos entre arquivos depois de remover `aria-current="page"`; (b) exatamente um `aria-current` por bloco, no item da tabela; (c) `href`, `src` e `action` internos existem como arquivo (regras de `cleanUrls`: `x`, `x.html`, `x/index.html`) ou em `redirects`; sem `/admin`; (d) nenhum "apenas conecta", "vaga", "onda" ou contador nos blocos; (e) `lang`, `title` no padrão `FastPro - …`, `<main>` único com `id="conteudo"` ou sentinela; (f) todo `.html` de `public` está em `ROTAS`; (g) `navegacao.css` carregada depois de `tokens.css`; sem `style=`, sem `<style>`, sem script inline; (h) `sincronizar-navegacao --check` sem diferença. Rodar `check:hex` e `check:typography`. Cobre CA-NAV-02, 09, 10, 14.

**S3. 404 e `vercel.json`.** `404.html`; blocos de cabeçalhos da seção 8; redirect do documento. Teste estático novo `tests/navegacao-vercel.test.ts` (lê o JSON: blocos presentes, CSP com `default-src 'none'`, redirect 307). Cobre CA-NAV-15 (estática) e a decisão 963.

**S4. Encadeamento do cliente.** `pedido.js`: destino passa a `/fotos`; `fotos.html`/`fotos.js`: "Continuar" para `/pedido/revisao` e "Voltar"; revisão: "Voltar" e o tratamento do 401 (7.6) com link ao `/painel` depois de publicar. Atualizar os testes existentes que fixam o destino antigo (`pedido-h030-estatico.test.ts`, `pedido-logica.test.ts`, `fotos-page.test.ts`, e2e `pedido-h030.spec.ts` `[NV]` quais), **somente nessas asserções**, registrando cada uma na Issue. Testes novos (`tests/navegacao-cliente.test.ts`, vm + `fetch` falso): destino após pedido, "Continuar" de fotos, 401 na confirmação não publica e mostra a mensagem, link de entrada com `?voltar=/pedido/revisao`. Cobre CA-NAV-04 (parte), 06.

**S5. `/painel`.** Arquivos da 7.1; teste `tests/painel-page.test.ts` (vm, `fetch` falso): carregando, lista, vazio, `nextCursor`, 401/403 redireciona e **nada é revelado**, 429/5xx/rede com "Tentar de novo", `textContent` apenas, sem dados de contato. Cobre CA-NAV-05, RN-NAV-03.

**S6a. Profissional: guarda, subnavegação, documentos.** `guarda-sessao.js`; aplicação em `profissional-documentos.html`; link "Ver situação"; testes `tests/guarda-sessao.test.ts` (liberar, entrar, indisponível, conteúdo oculto até a resposta, destino `?voltar`). **S6b.** Situação (7.2), script de build e `.gitignore` do bundle, `tests/profissional-situacao-pagina.test.ts`. **S6c.** Perfil (7.3), `tests/profissional-perfil-pagina.test.ts` (redireciona antes da aprovação, mostra após, `configured:false`, 401). Cobre CA-NAV-08.

**S7. Navegador e acessibilidade (Playwright + axe).**
- `tests/e2e/apoio-navegacao.ts` (servir `public` com `cleanUrls` e `404.html`, API simulada com estado "sessão", aborto e registro de qualquer origem externa; **cópia curta** do padrão de `pedido-h030.spec.ts`, sem editá-lo).
- `tests/e2e/navegacao.spec.ts`: **um** teste com `test.step` (exceção 965 A, escopo da QA final): cliente `/` → busca → `/pedido` (campos preenchidos) → `/fotos` → `/pedido/revisao` → publicar sem sessão → entrada → volta com dados → confirmar → `/painel` mostra o pedido publicado; profissional `/profissional/entrar` → `/profissional-documentos` → situação → perfil (aprovado simulado). Em cada passo: axe WCAG 2.2 AA sem violação, primeiro Tab no "Pular para o conteúdo", foco visível e fora do cabeçalho, alvos de 24 px; reflow a 320 px (sem rolagem horizontal, itens do menu visíveis).
- `tests/e2e/navegacao-erros.spec.ts` (só Dev e Review): 404 com blocos comuns e links; link de acesso inválido mostra a opção "Digitar o código"; rota protegida sem sessão não mostra dado; sessão expirada na publicação.
- Cobre CA-NAV-01, 03, 04, 05, 06, 07, 08, 11, 12, 13, 15.
- **Limite honesto:** com a API simulada, o "estado do pedido conferido pela API" do CA-NAV-03 é a resposta simulada. Prova com API real fica pendente de #156 e dos serviços do ambiente de desenvolvimento; o relatório da Issue diz isso explicitamente.

**S8. Fechamento.** `check:hex`, `check:typography`, `check:logs`, `check:secrets`, `check:all`, `--filter @fastpro/web` `typecheck`, `lint`, `test`, `test:e2e`; relatório axe anexado; lista de testes de outras Issues tocados; pendências (D-1, D-2, #156) registradas.

### Matriz critério → prova

| Critério | Prova | Fatia |
|---|---|---|
| CA-NAV-01 inicial → pedido | e2e feliz | S7 |
| CA-NAV-02 blocos comuns | estático + e2e | S2, S7 |
| CA-NAV-03 fluxo do cliente | e2e feliz (API simulada) | S4, S7 |
| CA-NAV-04 voltar sem perder dados | e2e + `navegacao-cliente` | S4, S7 |
| CA-NAV-05 rota protegida | `painel-page` + e2e | S5, S7 |
| CA-NAV-06 sessão expirada | `navegacao-cliente` + e2e erros | S4, S7 |
| CA-NAV-07 link inválido | e2e erros (tela da #154) | S7 |
| CA-NAV-08 fluxo do profissional | `guarda-sessao`, situação, perfil + e2e | S6, S7 |
| CA-NAV-09 sem link quebrado/admin | estático | S2 |
| CA-NAV-10 sem texto proibido | estático | S2 |
| CA-NAV-11 a 13 axe, teclado, 320 px | e2e + axe | S7 |
| CA-NAV-14 cores por token | `check:hex` | S2, S8 |
| CA-NAV-15 rota inexistente | estático + e2e erros | S3, S7 |
| CA-NAV-16 retorno seguro | `navegacao-logica.test.ts` (+ testes da #154) | S1 |

---

## 10. Arquivos e riscos

**Criados:** `public/navegacao.css`, `navegacao-logica.js`, `guarda-sessao.js`, `painel.html/.js/.css`, `profissional-situacao.html`, `profissional-situacao-pagina.js`, `profissional-situacao.css`, `profissional-perfil.html`, `profissional-perfil-pagina.js`, `404.html`; `src/situacao-entrada.ts`; `scripts/navegacao-blocos.mjs`, `sincronizar-navegacao.mjs`, `build-situacao.mjs`; testes `navegacao-logica`, `navegacao-estatico`, `navegacao-vercel`, `navegacao-cliente`, `painel-page`, `guarda-sessao`, `profissional-situacao-pagina`, `profissional-perfil-pagina` (`.test.ts`); `tests/e2e/apoio-navegacao.ts`, `navegacao.spec.ts`, `navegacao-erros.spec.ts`.

**Editados:** os `.html` existentes (blocos, links de voltar/continuar, `<main>`), `pedido.js` (um destino), `fotos.js` ou `fotos.html` (continuar), `pedido-revisao.js` (401 e link ao painel) `[NV]`, `entrada-comum.js` (uma lista), `apps/web/package.json` (scripts de build/test para o bundle da situação), `.gitignore` (bundle), `vercel.json` (blocos e `redirects`), asserções pontuais de testes existentes (S4, S2).

**Não tocar:** `packages/tokens`, `tokens.css`, `apps/api`, `packages/domain`, `packages/db`, `packages/contracts`, `11-DECISOES.md`, quadro, arquivos `profissional-documento.*` (só redirecionados), `profissional-perfil.js` e `profissional-situacao.js` existentes (renderizadores).

| Nº | Risco | Mitigação |
|---|---|---|
| R-1 | API local em 404 (#156): navegação com dados reais não pode ser provada. | `fetch`/`route` simulados em tudo; prova real marcada como pendente na Issue, nunca como feita. |
| R-2 | Testes existentes dependem da estrutura do HTML (título, `<main>`, destino após pedido). | Lotes na S2 com a suíte do web a cada lote; só asserções pontuais alteradas e registradas. |
| R-3 | Conflitos de arquivo com #153/#154 (`index.html`, `acesso.html`, `codigo.html`, `vercel.json`, `entrada-comum.js`). | Ordem fixa #153, #154, #155; merges serializados; edição mínima; `redirects` acrescentado, não recriado. |
| R-4 | `/profissional-documentos` hoje não exige sessão no HTML; ocultar até a sonda pode esconder a tela se a sonda falhar. | Estado "indisponível" com "Tentar de novo"; só 401/403 redirecionam (AD-155-03). |
| R-5 | Sonda do profissional pode devolver 404 ("sem caso ainda") ou 403 (papel errado): tratar 404 como válido e 403 como sem sessão. | Teste de `decidirSonda`; confirmar o comportamento real das rotas na S1 (leitura). |
| R-6 | `construirTela` do domínio arrasta `node:crypto` para o bundle. | Reusar `stub-node-crypto.mjs` e o teste de regressão do stub; mesmo precedente do `fotos-envio`. |
| R-7 | `Cache-Control: no-store` impede restauração de formulário no botão Voltar do navegador em alguns casos. | Rascunho está no servidor; ao recarregar a tela o dado volta (CA-NAV-04 provado pelos links, não pela restauração do navegador). |
| R-8 | Sem botão "Sair" (`POST /v1/auth/logout` existe). | Fora do escopo; D-2. |
| R-9 | Cabeçalho com cinco itens a 320 px pode quebrar em várias linhas. | `flex-wrap`, alvos mínimos de tokens; e2e a 320 px com reflow. |
| R-10 | Prazo do rascunho (966) ser diferente de 7 dias no domínio `[NV]`. | S0 confere; se divergir, relatar ao líder, não alterar domínio nesta Issue. |
| R-11 | Menu "Entrar" visível mesmo com sessão (as páginas são estáticas e não sabem da sessão). | Aceito nesta entrega; o item não causa dano (leva à entrada). Melhoria depende de rota "quem sou eu" (176 L-4). |

---

## 11. Dúvidas ao líder (nenhuma enviada ao usuário; adotar a recomendação se não houver veto)

- **D-1. Perfil do profissional.** O que existe hoje não é uma tela de edição de serviços, base e raio; é só a API (H-036) e um renderizador do perfil público. *Opções:* (a) **página de leitura nesta Issue e a edição como Issue nova (recomendada)**; (b) criar também os formulários de serviços e de base com raio aqui (cresce a Issue: catálogo, endereço `professional_base`, regras de troca limitada); (c) retirar `/profissional-perfil` do fluxo. *Destrava:* S6c.
- **D-2. Botão "Sair".** A API de saída existe, mas a decisão 960 a 966 não o cita. *Opções:* (a) **fora desta Issue, registrar como pendência (recomendada)**; (b) incluir item "Sair" na subnavegação e em `/painel`. *Destrava:* só o fechamento; não bloqueia.
- **D-3. Registro das correções** (cookie `__Host-fp_sess`, `?voltar=` no lugar de `?retorno=`, `/profissional` como redirect, `profissional-perfil.js` como renderizador público): registrar em `11-DECISOES.md` como "adotadas pelo líder". *Recomendação:* sim. *Destrava:* nada, é registro.
- **D-4. Texto do estado vazio do painel e da situação sem documento.** Sem texto aprovado (AMB-03). *Opções:* (a) **mensagem mínima neutra com a ação, marcada como provisória e fácil de trocar em `NAV_TEXTOS` (recomendada)**; (b) esperar o texto do dono. *Destrava:* S5 e S6b.
- **D-5. Conflito "Entrar" na inicial** (6.1): confirmar que o cabeçalho comum resolve (a) **sim, e o teste CA-W21 da #153 é restrito a `<main>` (recomendada)**, ou (b) o cabeçalho omite "Entrar" na inicial. *Destrava:* S2.
- **D-6. Prova real do ponta a ponta.** Só depois da #156. *Recomendação:* a Issue vai a QA com a prova simulada e a pendência declarada; o líder decide se aguarda a #156 antes de pedir aprovação.

---

## 12. Pré-condições para o Dev

1. #153 e #154 concluídas ou em Aguardando aprovação, com seus testes verdes (`index.html`, `entrada-comum.js`, marcadores e `<main id="conteudo">` das telas de entrada existem).
2. #152 resolvida (build do web) e `check:all` conhecido (#149): se estiver vermelho, o Dev registra o que falha e prova com os checks restritos aos arquivos da #155.
3. Chromium do Playwright instalado localmente (gratuito, fora do repositório).
4. Decisões 960 a 966 registradas e D-1 a D-6 respondidas ou adotadas pelo líder.
5. Todo `.html`/`.css`/`.js` novo só usa tokens (sem cor literal); nenhuma credencial, nenhum e-mail enviado, nenhum dado real no banco.
6. Escopo de ambiente: só desenvolvimento. Sem produção, sem domínio, sem backup.

## 13. Fontes lidas nesta etapa

`D:\Fabrica\AGENTS.md`, `roles/factory-software-architect.md`; `docs/factory/173`, `175`, `176`; `apps/web/package.json`, `vercel.json`, `playwright.config.ts`, `vitest.config.ts`, `public/*.html` (inventário e trechos de `index`, `pedido/revisao`, `profissional-documentos`), `profissional-situacao.js`, `profissional-perfil.js`, `scripts/build-fotos-envio.mjs`, `tests/e2e/pedido-h030.spec.ts`; `apps/api/src/requests/list-route.ts`, `professional-offering-route.ts`, cabeçalhos de `professional-verification-route.ts`, `professional-profile-route.ts`, `session-route.ts`; `package.json` raiz (scripts `check:*`). Não lidos por inteiro (`[NV]` tratados nas fatias): `construirTela` e `PANEL_ITEM_KEYS`, `fotos.html`, `pedido-revisao.js`, `entrada-comum.js` (ainda inexistente), testes existentes de página.
