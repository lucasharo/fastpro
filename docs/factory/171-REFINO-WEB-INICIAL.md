# Refino web inicial: página inicial com busca de serviço e endereço (Issue #153)

- **Issue:** #153 `[E16] Página inicial com busca de serviço e endereço que leva ao pedido` · **Coluna:** Product Owner
- **Workflow:** WF-03 (Feature) · **Etapa:** Product Owner · **EXEC-ID:** EXEC-PO-153-20261121
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init` · **Data:** 2026-11-21
- **Natureza:** somente documento. Nenhum código, teste, migração, banco ou quadro foi alterado. Nenhum pedido ao usuário é feito aqui; as perguntas vão ao líder (Orquestrador).
- **Etiquetas:** `[VERIFICADO]` lido nesta rodada · `[DECIDIDO]` decisão aprovada, com número · `[PROPOSTA]` deste refino, a validar · `[NÃO VERIFICADO]` não confirmado nesta rodada (ver §10).

---

## 0. Motivo e fontes

**Motivo.** O dono viu o preview web e encontrou só a página provisória. `apps/web/public/index.html` [VERIFICADO] tem título "FastPro - pre-visualizacao", `noindex` e o texto "Pagina de pre-visualizacao. Sem conteudo de produto.". Não há busca nem caminho para o pedido.

**Fontes lidas nesta rodada:**
- `D:\Fabrica\AGENTS.md`, `roles/factory-product-owner.md`.
- `docs/factory/03-JORNADAS.md` (J1.1 a J1.4: navegar, informar serviço e local, pedir).
- `docs/factory/04-PRD.md` (RF-001, RF-002, RF-010, RF-011, RF-012, RF-013, RF-014, RF-015, RF-016, RF-018, RF-019, RF-021, RF-035, RF-036..RF-041, RF-164 e §1 de atores).
- `docs/factory/05-CRITERIOS-ACEITE.md` (FA-001 e FA-002; FA-003 só como referência de link).
- `docs/factory/158-REFINO-H058.md` (modelo de estrutura; sumário).
- `docs/factory/quadro-status.md` (rodada 145, atualizado em 2026-11-20).
- `apps/web/public/`: `index.html`, `pedido.html`, `pedido.js`, `address-field.js`, `acesso.html`, `tokens.css`, `pedido/revisao.html` (listado). `packages/tokens` (listado).

**Estado das APIs usadas pela tela (pelo quadro, `[VERIFICADO]`):**
- #32 `[E2] Autocomplete de serviço e sinônimos`: Concluído.
- #33 `[E2] Autocomplete de endereço Mapbox temporário`: Concluído.
- #38 `[E3] Rascunho de pedido sem conta`: Concluído.
- #43 `[E3] Revisão e confirmação expressa`: Concluído.

---

## 1. Objetivo

Trocar a página provisória por uma **página inicial real** em `/` (rota de `index.html`), com duas perguntas, em linguagem do dia a dia:

1. **"Qual serviço você precisa?"** (busca com sugestões do catálogo).
2. **"Onde o serviço será feito?"** (sugestões de endereço, com texto livre sempre permitido).

Ao continuar, o visitante **sai da inicial com o serviço e o endereço já levados para o pedido** (`/pedido`), sem precisar digitar de novo. Assim o dono consegue ver o caminho completo no preview: inicial → pedido.

Valor para o cliente: começar um pedido em menos de um minuto, sem login e sem senha (RF-001, RF-012, FA-001).

---

## 2. Escopo (dentro desta Issue)

1. Nova página inicial em `/`, no lugar do placeholder, com título, frase de apoio curta (texto em §9) e os dois campos.
2. Busca de serviço reaproveitando a lógica já existente de `pedido-logica.js` (`criarControladorBusca`) e a chamada `POST /api/v1/catalog/service-search` com corpo `{ q }`, como hoje em `pedido.js` [VERIFICADO].
3. Campo de endereço reaproveitando `mountAddressField` de `address-field.js` com as mesmas constantes (mínimo 3, máximo 120 caracteres, espera de 300 ms) e chamada `POST /api/v1/geo/address-suggest` [VERIFICADO].
4. Botão **"Continuar"**: valida e cria o rascunho (`POST /api/v1/drafts` com `service_id` e `address_text`), depois leva para `/pedido`. Se o rascunho não puder ser criado, a inicial permanece com os dados digitados (§6, E-07).
5. Estados vazio, carregando, erro, sem resultado e sem rede (§5).
6. Responsivo, teclado, leitor de tela e contraste (§8).
7. Preservar `noindex` enquanto o produto estiver em preview (ver pergunta 945 para o texto).

---

## 3. Fora de escopo

- **Telas de entrada** (acesso do cliente por link/código e cadastro/login do profissional): Issue #154. A inicial **não** mostra link de login nem de cadastro de profissional (ver pergunta 944).
- **Navegação entre telas** e lista de categorias na inicial: Issue #155 (ver pergunta 943). Não criar categorias nem menus aqui.
- **Revisão, envio de link e publicação do pedido:** já existem em `/pedido` e `/pedido/revisao` e não mudam aqui. E-mail não é pedido na inicial (RF-012: nome e e-mail só no envio final).
- **Fotos** (RF-025): fora da inicial.
- **Qualquer preço, promoção, prazo ou promessa de resultado** (ver §4, RN-W-07).
- **App móvel** (RF-164; Issue #131 e #132 a #133 são de outra etapa).
- **Backup, exportação e produção** (AGENTS.md, escopo de desenvolvimento).

---

## 4. Regras de negócio

| Ref. | Regra | Fonte |
|---|---|---|
| RN-W-01 | O visitante **não se autentica** na inicial. Nenhum campo de nome, e-mail, telefone ou senha aparece aqui. | RF-001, RF-012, FA-001 `[DECIDIDO]` |
| RN-W-02 | O serviço é escolhido **da lista do catálogo**. Texto livre não vira serviço. Motivo: o pedido exige o código do serviço (`service_id`), e a regra de descoberta depende dele. | RF-002, RF-010 `[DECIDIDO]`; pergunta 942 |
| RN-W-03 | O endereço aceita **texto livre**. A sugestão é opcional. O endereço preciso é privado (só o cliente e o profissional autorizado veem; a inicial não mostra mapa nem coordenada). | RF-010, RF-013 `[DECIDIDO]`; `address-field.js`: "o envio nunca depende de sugestão" `[VERIFICADO]` |
| RN-W-04 | Mapbox é chamado **somente pela própria API** (`/api/v1/geo/address-suggest`). O navegador não recebe nem exibe chave de provedor. | `address-field.js` `[VERIFICADO]`; uso de Mapbox já autorizado só para o endereço (decisão do dono) `[DECIDIDO]` |
| RN-W-05 | Nada é guardado no **armazenamento do navegador** (local ou de sessão). O rascunho fica no servidor, como hoje em `pedido.js`. | `pedido.js` ("sem armazenamento do navegador") `[VERIFICADO]` |
| RN-W-06 | Serviço e endereço **não vão na URL** (nem como parâmetro de consulta). Motivo: endereço é dado pessoal e não deve aparecer em histórico, registros de acesso ou compartilhamento de link. | RF-013, RF-120 `[PROPOSTA]` |
| RN-W-07 | Textos sem promessa de preço, sem "grátis", "barato", "promoção", "R$" e sem jargão ("API", "token", "UUID", "rascunho" pode aparecer só se for trocado por "pedido"). | Escopo do dono; quadro sem preço na inicial `[DECIDIDO]` |
| RN-W-08 | A inicial não mostra **contadores, vagas, ondas ou número de profissionais** disponíveis. | RF-018, RF-066 `[DECIDIDO]` |
| RN-W-09 | Ao continuar, a tela só cria o rascunho com serviço e endereço já validados. Se o usuário alterar o serviço depois, o rascunho é atualizado (regra de salvamento já existente em `pedido.js`). | `pedido.js` (`salvador.alterar`) `[VERIFICADO]` |
| RN-W-10 | Dados digitados na inicial **não se perdem** em erro de rede ou de servidor. | RF-019 `[PROPOSTA]` |

---

## 5. Fluxos e estados

### 5.1 Fluxo principal (happy path)

1. Visitante abre `/` (sem login). Vê título, frase de apoio, campo de serviço, campo de endereço e botão "Continuar".
2. Digita pelo menos o mínimo do serviço (regra do `criarControladorBusca`, não redefinida aqui). Aparece a lista de sugestões.
3. Escolhe um serviço da lista (clique, ou Setas + Enter). O campo mostra o nome escolhido e a lista fecha.
4. Digita o endereço (mínimo 3 caracteres). Aparece a lista de sugestões de endereço, ou ele digita sem escolher.
5. Clica em "Continuar". Se faltar serviço, o erro aparece (E-02). Se houver, a tela cria o rascunho e vai para `/pedido`.
6. Em `/pedido`, o formulário já mostra o serviço e o endereço (carregados de `GET /api/v1/drafts/current`) e o visitante completa urgência, descrição, nome e e-mail como hoje.

### 5.2 Estados do campo de serviço

| Estado | Quando | O que aparece |
|---|---|---|
| **E-S0 vazio** | Campo sem texto ou abaixo do mínimo | Nenhuma lista. Sem aviso. |
| **E-S1 carregando** | Consulta em curso | Aviso "Buscando serviços…" em região viva (`role="status"`). Campo ainda editável. |
| **E-S2 resultado** | Lista com itens | Lista de botões, um por serviço, com o nome. |
| **E-S3 sem resultado** | Consulta ok e lista vazia | "Não encontramos esse serviço. Tente outra palavra." |
| **E-S4 erro** | Falha de rede ou resposta inválida | "Não foi possível buscar agora. Tente de novo em instantes." (texto pode reaproveitar `PEDIDO_TEXTOS.buscaFalhou`, não lido nesta rodada). |
| **E-S5 limite** | Resposta de limite de uso | "Muitas buscas em pouco tempo. Aguarde um pouco." (reaproveitar `PEDIDO_TEXTOS.muitasTentativas`). |
| **E-S6 escolhido** | Serviço escolhido | Nome no campo e aviso discreto "Serviço escolhido." Lista fechada. |

### 5.3 Estados do campo de endereço

Usam os estados já definidos em `address-field.js` `[VERIFICADO]`, sem novos:

| Estado | O que aparece |
|---|---|
| **E-E0 vazio** | Sem lista. |
| **E-E1 carregando** | Lista ainda não chegou; campo editável. |
| **E-E2 lista** | Sugestões em listbox (teclado: Setas, Enter, Esc). |
| **E-E3 sem sugestão** | Campo continua válido com texto livre; sem aviso de erro. |
| **E-E4 falha** | "Não foi possível sugerir endereços agora. Digite o endereço normalmente." (mensagem neutra já existente). |
| **E-E5 texto livre** | Limite ou sugestões desligadas: campo vira só texto, sem mensagem de erro. |

### 5.4 Estados do botão "Continuar" e da passagem ao pedido

| Estado | Quando | O que aparece |
|---|---|---|
| **E-C0 pronto** | Serviço escolhido e endereço com pelo menos 3 caracteres | Botão habilitado. |
| **E-C1 faltando** | Falta serviço escolhido ou endereço | Erros por campo (E-01, E-02) e foco no primeiro campo com erro. |
| **E-C2 enviando** | Criando o rascunho | Botão desabilitado, rótulo "Aguarde…", `aria-busy="true"`. |
| **E-C3 erro ao criar** | Falha do servidor ou de rede | Mensagem: "Não foi possível continuar agora. Seus dados estão aqui; tente de novo." Campos mantidos (E-07). |
| **E-C4 sem rede** | Sem conexão | Mesma mensagem de E-C3. Campos mantidos. |

### 5.5 Erros por campo (texto exato proposto)

| Ref. | Situação | Texto |
|---|---|---|
| E-01 | Serviço não escolhido ao continuar | "Escolha um serviço da lista." |
| E-02 | Endereço vazio ou com menos de 3 caracteres ao continuar | "Informe onde o serviço será feito." |
| E-03 | Endereço com mais de 120 caracteres | "Use no máximo 120 caracteres." |
| E-07 | Falha ao criar o rascunho | "Não foi possível continuar agora. Seus dados estão aqui; tente de novo." |

### 5.6 Estados de página

- **Carregando a página:** a inicial é estática; sem estado de carregamento de dados. Os campos aparecem de imediato.
- **Erro de página:** se o script não carregar, o formulário continua visível em HTML (o `<form>` deve funcionar com envio tradicional ou mostrar a mensagem "Não foi possível abrir a página. Atualize a tela."). Decisão de implementação fica para o Arquiteto.

---

## 6. Critérios de aceite (Given / When / Then)

Cada critério tem **prova** (teste) indicada. Testes de unidade e de página usam **vitest com jsdom** (`apps/web`); testes de navegador usam **Playwright** com **axe** para acessibilidade. Os testes de fluxo ponta a ponta (API real) ficam para o fim, na suíte de QA, e só o caminho feliz.

**CA-W01: Página inicial no lugar do placeholder.**
- **Dado** um visitante sem login,
- **Quando** abre `/`,
- **Então** vê o título "FastPro", a frase de apoio, o campo "Qual serviço você precisa?", o campo "Onde o serviço será feito?" e o botão "Continuar", e **não** vê o texto "Sem conteúdo de produto".
- **Prova:** Playwright (navegador) + teste de página com vitest/jsdom que carrega a marcação.

**CA-W02: Busca de serviço com sugestões.**
- **Dado** a busca com o mínimo de caracteres atingido,
- **Quando** o serviço é digitado,
- **Então** a lista de sugestões mostra os nomes do catálogo, cada um como botão.
- **Prova:** vitest/jsdom com `fetch` simulado (retorno com 3 serviços); Playwright com API de teste.

**CA-W03: Escolha de serviço da lista.**
- **Dado** a lista aberta,
- **Quando** o visitante escolhe um item (clique ou Enter sobre item ativo),
- **Então** o campo mostra o nome escolhido, a lista fecha e o aviso "Serviço escolhido." aparece.
- **Prova:** vitest/jsdom (eventos de clique e teclado).

**CA-W04: Texto livre não vira serviço.**
- **Dado** o campo com texto digitado e nenhum item escolhido,
- **Quando** o visitante clica em "Continuar",
- **Então** aparece E-01 ("Escolha um serviço da lista.") e nenhuma requisição de criação de rascunho é feita.
- **Prova:** vitest/jsdom com contagem de chamadas de `fetch`.

**CA-W05: Sugestões de endereço pela própria API.**
- **Dado** o campo de endereço com 3 caracteres ou mais,
- **Quando** o visitante para de digitar por 300 ms,
- **Então** a página chama `POST /api/v1/geo/address-suggest` (mesma origem) e **nenhuma** chamada vai a domínio de provedor de mapa.
- **Prova:** vitest/jsdom (inspeção das URLs chamadas); Playwright com interceptação de rede.

**CA-W06: Endereço em texto livre é aceito.**
- **Dado** um endereço digitado sem escolher sugestão, com 3 a 120 caracteres,
- **Quando** o visitante clica em "Continuar" com serviço escolhido,
- **Então** o rascunho é criado com esse texto, sem exigir sugestão.
- **Prova:** vitest/jsdom (corpo da requisição `POST /api/v1/drafts`).

**CA-W07: Continuar cria o rascunho e leva ao pedido.**
- **Dado** serviço escolhido e endereço válido,
- **Quando** o visitante clica em "Continuar",
- **Então** a página envia `POST /api/v1/drafts` com `service_id` e `address_text` e, com resposta de sucesso, navega para `/pedido`, onde o serviço e o endereço aparecem preenchidos.
- **Prova:** vitest/jsdom (navegação simulada); Playwright (teste de navegação, API de teste no DEV).

**CA-W08: Erro ao criar não perde dados.**
- **Dado** serviço e endereço preenchidos,
- **Quando** a criação do rascunho falha (E-C3),
- **Então** a página **não** navega, mostra a mensagem de E-07 e mantém os dois campos com os valores digitados.
- **Prova:** vitest/jsdom com resposta de erro simulada.

**CA-W09: Sem resultado.**
- **Dado** uma consulta de serviço que retorna lista vazia,
- **Quando** a lista é exibida,
- **Então** aparece "Não encontramos esse serviço. Tente outra palavra." e nenhum item.
- **Prova:** vitest/jsdom.

**CA-W10: Erro de busca de serviço.**
- **Dado** a busca de serviço com falha de rede,
- **Quando** o visitante digita,
- **Então** aparece a mensagem de E-S4 e o campo continua editável.
- **Prova:** vitest/jsdom (rejeição simulada).

**CA-W11: Limite de uso.**
- **Dado** resposta de limite (429) na busca ou no endereço,
- **Quando** o visitante digita,
- **Então** aparece a mensagem de E-S5 (serviço) ou o campo vira texto livre sem erro (endereço, E-E5).
- **Prova:** vitest/jsdom.

**CA-W12: Sem rede no endereço não bloqueia a inicial.**
- **Dado** que as sugestões de endereço falham,
- **Quando** o visitante escolhe serviço e digita endereço,
- **Então** a mensagem neutra de E-E4 aparece e "Continuar" funciona com o texto digitado.
- **Prova:** vitest/jsdom e Playwright (rede bloqueada para a rota de endereço).

**CA-W13: Ordem e foco de erro.**
- **Dado** o clique em "Continuar" com campos faltando,
- **Quando** a validação roda,
- **Então** o foco vai para o primeiro campo com erro e os erros ficam ligados aos campos (`aria-invalid`, `aria-describedby`).
- **Prova:** Playwright + axe; vitest/jsdom.

**CA-W14: Teclado completo.**
- **Dado** apenas o teclado,
- **Quando** o visitante percorre a página,
- **Então** alcança campo de serviço, lista (Setas, Enter), campo de endereço, lista de endereço, botão "Continuar"; Esc fecha as listas; o foco é sempre visível.
- **Prova:** Playwright (`keyboard`) com verificação de foco visível.

**CA-W15: Leitor de tela.**
- **Dado** um leitor de tela,
- **Quando** o visitante muda a busca ou recebe erro,
- **Então** as mensagens de estado são anunciadas (região viva `role="status"` e `aria-live="polite"`) e cada campo tem rótulo visível.
- **Prova:** Playwright + axe (regras de rótulo e região viva) e checagem da árvore de acessibilidade. Evidência manual com leitor de tela fica registrada como lacuna se não houver leitor disponível.

**CA-W16: Contraste e temas.**
- **Dado** os temas claro e escuro (`prefers-color-scheme` e `data-theme`),
- **Quando** a página é renderizada,
- **Então** textos, bordas de campo e botões atendem WCAG 2.2 AA (texto normal 4,5:1; componentes de interface 3:1), usando só `var(--color-…)`.
- **Prova:** axe em cada tema (Playwright) e relatório de contraste do pacote `@fastpro/tokens` (`scripts/report-contrast.mjs`).

**CA-W17: Alvos de toque e responsivo.**
- **Dado** largura de 360 px e de 1280 px,
- **Quando** a página é carregada,
- **Então** não há rolagem horizontal, os botões têm pelo menos 24 × 24 px (WCAG 2.2 AA, 2.5.8) e a altura recomendada de 48 px dos tokens, e a lista de sugestões não sai da tela.
- **Prova:** Playwright em duas larguras (verificação de `scrollWidth` e tamanho dos alvos).

**CA-W18: Sem cor fixa no código.**
- **Dado** os arquivos da inicial (HTML, JS e CSS novos),
- **Quando** verificados,
- **Então** não há valor hexadecimal, `rgb()` ou nome de cor fixo; cores vêm de `tokens.css` (gerado por `@fastpro/tokens`, não editar).
- **Prova:** varredura de hexadecimal do `check:all` (ver dependência D-03) mais teste de página que verifica o estilo computado nos dois temas.

**CA-W19: Sem armazenamento no navegador e sem endereço na URL.**
- **Dado** o fluxo completo da inicial até o pedido,
- **Quando** é percorrido,
- **Então** a página não escreve em `localStorage`, `sessionStorage` nem em cookie próprio, e a URL de `/pedido` não contém serviço nem endereço.
- **Prova:** vitest/jsdom (espiões nos armazenamentos) e Playwright (URL final).

**CA-W20: Textos proibidos e jargão.**
- **Dado** todos os textos visíveis da inicial,
- **Quando** verificados,
- **Então** não aparecem "grátis", "barato", "promoção", "R$", "API", "token", "UUID", nem contadores de profissionais ou vagas.
- **Prova:** teste de texto (vitest, leitura da marcação e dos textos de erro).

**CA-W21: Sem login e sem e-mail na inicial.**
- **Dado** a inicial,
- **Quando** é inspecionada,
- **Então** não há campo de e-mail, telefone, nome, senha, link de entrada nem link de cadastro de profissional.
- **Prova:** vitest/jsdom (ausência de elementos) e Playwright.

**CA-W22: Preview.**
- **Dado** o preview publicado no ambiente de desenvolvimento,
- **Quando** o dono abre a raiz,
- **Então** vê a inicial (não o placeholder), e a página continua com `noindex`.
- **Prova:** requisição `GET /` com verificação do título e da meta `robots` (uma vez que #152 esteja resolvida, ver D-01).

---

## 7. Dependências (confirmadas nesta rodada)

| Ref. | Dependência | Estado | Como foi confirmado |
|---|---|---|---|
| D-01 | **#152** `build do web quebra` (stub de `node:crypto` sem `createCipheriv`, `createDecipheriv`, `hkdfSync` e `randomBytes`) | **Aguardando aprovação** (decisão humana para Concluído) | `[VERIFICADO]` quadro-status.md |
| D-02 | **#149** `check:all vermelho` (hex, segredos, logs, limites, tipografia) | Desenvolvimento | `[VERIFICADO]` quadro-status.md |
| D-03 | Varredura de hexadecimal do `check:all` (usada em CA-W18) | Depende de #149 | `[VERIFICADO]` título de #149 |
| D-04 | **#32** autocomplete de serviço (`POST /api/v1/catalog/service-search`) | Concluído | `[VERIFICADO]` quadro + `pedido.js` (`CAMINHOS.busca`) |
| D-05 | **#33** autocomplete de endereço (`POST /api/v1/geo/address-suggest`) | Concluído | `[VERIFICADO]` quadro + `address-field.js` (`ADDRESS_ENDPOINT`) |
| D-06 | **#38** rascunho sem conta (`POST /api/v1/drafts`, `GET /api/v1/drafts/current`, `PATCH`) | Concluído | `[VERIFICADO]` quadro + `pedido.js` (`CAMINHOS`, `salvador`) |
| D-07 | **#43** revisão e confirmação (`/pedido/revisao`) | Concluído | `[VERIFICADO]` quadro + `pedido.js` (`CAMINHOS.paginaRevisao`) |
| D-08 | Componentes reutilizados: `criarControladorBusca`, `criarControladorSalvamento`, `mountAddressField`, `apiRequest` | Existem | `[VERIFICADO]` imports de `pedido.js` |
| D-09 | Tokens CSS (`tokens.css`, gerado por `packages/tokens`) | Existe | `[VERIFICADO]` leitura do arquivo |
| D-10 | Página atual `index.html` (placeholder) | Existe; será substituída | `[VERIFICADO]` leitura |
| D-11 | #154 telas de entrada (cliente e profissional) | Product Owner | `[VERIFICADO]` quadro. Não é pré-requisito: a inicial não depende dela (CA-W21). |
| D-12 | #155 navegação entre telas | Product Owner | `[VERIFICADO]` quadro. Depende de #153 e #154; **conflito de arquivo possível**: se #155 editar `index.html`, os dois não podem rodar em paralelo. Regra das seis Issues: coordenar pelo Orquestrador. |
| D-13 | #127 evidência formal de WCAG 2.2 AA (Backlog) | Backlog | `[VERIFICADO]` quadro. Esta Issue produz evidência local (CA-W13 a CA-W17); a evidência formal do MVP fica para #127. |

**Pré-requisito real para o dono ver o resultado:** D-01 (#152). Sem o build do web montando, o preview não mostra a inicial, mesmo com o código pronto. Ação do dono: concluir #152 depois de conferir o resultado local (decisão humana, não automática).

---

## 8. Acessibilidade, teclado e responsividade (requisitos da tela)

- **Rótulos visíveis** em todos os campos, com texto da seção 5 (nada só como placeholder).
- **Combobox de serviço e endereço** com papéis `combobox` e `listbox`, `aria-expanded`, `aria-controls` e `aria-activedescendant`, como em `address-field.js` (já existe para endereço; para serviço, reaproveitar o mesmo padrão ou o que `criarControladorBusca` já usa em `pedido.js` `[VERIFICADO]` no `renderizarBusca`).
- **Ordem de foco:** serviço → lista de serviço → endereço → lista de endereço → "Continuar".
- **Mensagens de estado** em região viva, sem roubar o foco, exceto no resumo de erro ao continuar (foco no primeiro campo com erro).
- **Tamanho mínimo:** alvos de 24 × 24 px; botões na altura `--button-height-md` (48 px) ou `--input-height` (52 px) dos tokens.
- **Responsivo:** uma coluna até 768 px (`--breakpoint-tablet`); no máximo 720 px de largura de conteúdo acima disso. Sem rolagem horizontal em 360 px.
- **Temas:** claro e escuro, pelos tokens; sem cor fixa.
- **Movimento:** sem animação obrigatória; respeitar `prefers-reduced-motion` se houver transição.

---

## 9. Textos da interface (propostos, em português simples)

- Título da página: **FastPro**.
- Frase de apoio: "Diga o serviço e onde ele será feito. Na próxima tela você descreve o pedido." (pergunta 945).
- Rótulo do serviço: **Qual serviço você precisa?** (já existe em `pedido.html`).
- Rótulo do endereço: **Onde o serviço será feito?** (já existe em `pedido.html`).
- Botão: **Continuar**.
- Mensagens: as de §5.2, §5.3, §5.4 e §5.5.

Todos os textos são revisados pelo dono (linguagem simples, sem promessa de preço).

---

## 10. Itens não verificados nesta rodada

Por limite de leitura desta etapa (duas rodadas de leitura), não foram verificados:

- `[NÃO VERIFICADO]` **Rotas do back-end** (`apps/api`): que `POST /api/v1/catalog/service-search`, `POST /api/v1/geo/address-suggest`, `POST /api/v1/drafts` aceitam exatamente o corpo de `pedido.js`. Verificar por Grep no `apps/api` na etapa de Arquitetura. Se o corpo de `POST /drafts` não aceitar `service_id` e `address_text` sem campos obrigatórios extras, a pergunta 940 muda de opção.
- `[NÃO VERIFICADO]` **Textos exatos** de `PEDIDO_TEXTOS` em `pedido-logica.js` (usados em E-S4, E-S5). Os textos deste refino são propostos; ao implementar, reaproveitar os já existentes quando forem iguais.
- `[NÃO VERIFICADO]` **Ferramentas de teste** em `apps/web`: se Playwright e axe já estão instalados e se `vitest` com jsdom roda na pasta. Se não estiverem, a instalação é tarefa de DEV, sem nova Issue.
- `[NÃO VERIFICADO]` **Regra de reescrita de `/`** na hospedagem (qual arquivo serve a raiz). Verificar na Arquitetura.
- `[NÃO VERIFICADO]` **Numeração de `docs/factory/11-DECISOES.md`**: as perguntas deste refino começam em 940 conforme pedido; confirmar que 940 a 947 estão livres antes de registrar.
- `[NÃO VERIFICADO]` **Contexto de endereço** aceito pela API (`request_draft` é o usado hoje; pergunta 946).

---

## 11. Perguntas ao líder (numeradas a partir de 940)

Estas perguntas são **do líder**. Os especialistas não as enviam ao usuário. Cada uma traz a recomendação; se o líder não tiver resposta, adota a recomendação e registra como "adotada pelo líder" em `11-DECISOES.md`, para o dono vetar depois.

**940. Como a escolha da inicial chega à página do pedido?**
- Opções: (A) criar o rascunho no servidor e levar a `/pedido` [**recomendação**]; (B) passar serviço e endereço na URL; (C) guardar no navegador.
- (B) fica de fora pela RN-W-06 (endereço na URL); (C) fica de fora pela RN-W-05.
- Destrava: CA-W07 e a implementação da passagem.

**941. O que fazer quando já existe um rascunho nesta sessão e o visitante escolhe outro serviço na inicial?**
- Opções: (A) substituir sem perguntar; (B) avisar e pedir confirmação antes de substituir [**recomendação**, para não perder a descrição já digitada]; (C) manter o antigo e ignorar a escolha.
- Destrava: CA-W07 e RN-W-09.

**942. O visitante pode continuar sem escolher um serviço da lista?**
- Opções: (A) não; exige escolha da lista [**recomendação**, o pedido exige o código do serviço]; (B) aceitar texto livre e classificar depois (exige nova regra de negócio); (C) mostrar categorias no lugar.
- Destrava: CA-W04.

**943. Mostrar a lista de categorias na inicial agora?**
- Opções: (A) não; fica para a navegação da Issue #155 [**recomendação**]; (B) mostrar categorias nesta Issue; (C) link para uma página de categorias ainda não existente.
- Por que importa: a jornada J1.1 fala em navegar categorias; sem decisão, a inicial pode crescer além do escopo de #153.
- Destrava: escopo final de #153 e a fronteira com #155.

**944. A inicial tem link de "Entrar" ou de cadastro de profissional?**
- Opções: (A) não; fica para a Issue #154 [**recomendação**]; (B) mostrar link desativado; (C) link para uma tela provisória.
- Destrava: CA-W21.

**945. Qual é a frase de apoio da inicial?**
- Opções: (A) "Diga o serviço e onde ele será feito. Na próxima tela você descreve o pedido." [**recomendação**]; (B) só o nome do produto, sem frase; (C) outro texto que o dono escrever.
- Regra: sem promessa de preço ou de resultado (RN-W-07).
- Destrava: revisão de texto (§9).

**946. Qual contexto usar para as sugestões de endereço na inicial?**
- Opções: (A) reaproveitar o contexto que o pedido já usa (`request_draft`) [**recomendação**, sem mudar a API]; (B) criar um contexto novo `home`, exigindo mudança na API e cota separada; (C) sem contexto.
- Destrava: CA-W05. Se (B), a Arquitetura precisa aprovar a mudança.

**947. Concluir a Issue #152 (correção do build do web) para o preview mostrar a inicial?**
- Opções: (A) o dono conclui #152 depois de conferir o resultado local [**recomendação**]; (B) manter #152 em Aguardando aprovação e aceitar que o preview não atualize; (C) fazer a inicial sem o preview e validar só localmente.
- Estado conferido: #152 está em **Aguardando aprovação** no quadro (rodada 145).
- Destrava: CA-W22 e a visibilidade para o dono.

---

## 12. Lista de veto (adotadas pelo PO, sem resposta necessária)

- Sem campo de e-mail, telefone ou nome na inicial (RN-W-01, CA-W21).
- Endereço em texto livre aceito (RN-W-03, CA-W06).
- Sugestões de endereço só pela API própria (RN-W-04, CA-W05).
- Sem armazenamento no navegador e sem endereço na URL (RN-W-05, RN-W-06, CA-W19).
- Sem contadores ou vagas na tela (RN-W-08).
- Acessibilidade medida com axe, teclado e tamanhos de tela (CA-W13 a CA-W17).

---

## 13. Próximo passo

- Passar este refino ao **Arquiteto** (ou ao líder, para as perguntas 940 a 947) com as seções 10 e 11.
- Após a Arquitetura confirmar o item de §10, o cartão de #153 segue para Desenvolvimento pela ordem do quadro: Product Owner → Arquitetura → Desenvolvimento → Code Review → QA → Aguardando aprovação.
- Nenhum cartão foi movido. O quadro (`docs/factory/quadro-status.md`) segue como estava para #153 (Product Owner).
