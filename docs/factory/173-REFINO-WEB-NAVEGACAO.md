# Refino 173: navegação ligando as telas existentes (Issue #155)

- **Issue:** #155 `[E16] Navegação ligando as telas existentes num fluxo a partir da inicial` · **Workflow:** WF-03 (Feature) · **Etapa:** Product Owner.
- **EXEC-ID:** EXEC-PO-155-20261121 (informado pelo líder).
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-21.
- **História:** não identificada no backlog lido (`[NÃO VERIFICADO]`). A Issue pertence ao Épico E16.
- **Natureza:** somente documento. Nenhum código, teste, banco, quadro ou `11-DECISOES.md` foi alterado.
- **Pré-condições de fila:** #153 (página inicial com busca, refino 171 ainda inexistente) e #154 (telas de entrada, refino 172 ainda inexistente). Dev só fecha #155 depois delas.
- **Etiquetas:** `[DECIDIDO]` decisão do dono ou do líder, com número · `[VERIFICADO]` lido no repositório ou no quadro · `[PROPOSTA]` deste refino, a validar · `[AMBIGUIDADE]` fonte conflitante ou lacuna · `[NÃO VERIFICADO]` não confirmado nesta rodada.

---

## 0. Fontes e limitações

Fontes lidas:
- `D:\Fabrica\AGENTS.md`, `roles/factory-product-owner.md`.
- `docs/factory/quadro-status.md` (atualizado em 2026-11-20, rodada 145).
- `docs/factory/03-JORNADAS.md` (J1 cliente, J2 profissional).
- `docs/factory/04-PRD.md`: trechos de navegação, pedido, rascunho, sessão e acesso (RF-001, RF-010, RF-012, RF-018 a RF-020, RF-025, RF-025a, RF-027, RF-037 a RF-041, RF-046, RF-051, RF-052, RF-062, RF-090, RF-105, RF-136, RF-148).
- `docs/factory/08-ARQUITETURA.md`: fluxo do pedido do visitante (§5.1), estados do rascunho (tabela de entidades), fotos em quarentena no rascunho.
- `docs/factory/05-CRITERIOS-ACEITE.md` (FA-001 e a confirmação pós-publicação, decisão 10).
- `docs/factory/158-REFINO-H058.md` (modelo de sumário), `docs/factory/11-DECISOES.md` (só para conferir a numeração livre, a partir de 960).
- `packages/tokens/src/tokens.ts` (EDS: papéis de cor, tipografia, espaçamento, raios, alturas de botão).
- `apps/web/public/` (inventário de arquivos e varredura de `href`, `<title>`, `<main>`, `<header>`, `<nav>`, `<footer>`).
- `package.json` raiz (scripts `check:all`, `check:hex`, `lint`, `test`, `db:test`; `vitest` 5.1.0 em dependências de desenvolvimento).

Limitações:
- `[NÃO VERIFICADO]` O RF-043 (revisão e confirmação expressa) não foi lido diretamente nesta rodada; a referência usa a Issue #43, concluída no quadro.
- `[NÃO VERIFICADO]` O conteúdo HTML detalhado de cada tela não foi lido; o inventário veio de nomes de arquivo, títulos e links. Componentes e marcação ficam para o Architect e o DEV.
- `[VERIFICADO]` Não existe arquivo HTML para `profissional-perfil` (há `.js` e `.css`) nem para `profissional-situacao` (há só `.js`).
- `[VERIFICADO]` Nenhuma página pública tem `<header>`, `<nav>` ou `<footer>`. Todas têm `<main>`.
- `[NÃO VERIFICADO]` Playwright e axe-core não aparecem no `package.json` raiz. Podem estar em `apps/web`; o DEV confirma. Se faltarem, a instalação é gratuita e fica a cargo do Architect.
- `[AMBIGUIDADE]` O RF-020 (pedido sem profissional elegível) e o texto de "sem vaga" (Jornadas, J2) não têm texto aprovado. Este refino não inventa texto: usa o marcador `[texto pendente AMB-03]`.
- `[NÃO VERIFICADO]` Como o servidor local e a hospedagem mapeiam `/pedido` para `pedido.html` (URLs limpas). O DEV confirma na configuração gratuita já existente.

---

## 1. Verificação de fila

- `[VERIFICADO]` #155 está na coluna **Product Owner** do quadro. #153 e #154 também estão em Product Owner, sem refino. Portanto nenhuma das três está pronta para Dev.
- `[VERIFICADO]` Já concluídas e reaproveitadas pela navegação: #38 (rascunho sem conta), #39 a #42 (fotos, redução, pré-visualização), #43 (revisão e confirmação expressa), #44 (publicação idempotente), #47 (painel do cliente na sessão do dono, API `private.request_list_owner`), #30 (exclusividade de papéis), #33 (autocomplete de endereço).
- `[VERIFICADO]` Bloqueios de qualidade que afetam a prova deste refino:
  - #152 (build do web quebra por stub de `node:crypto`) está em **Aguardando aprovação**. Sem build funcionando, não há prova de navegação.
  - #149 (`check:all` vermelho) está em **Desenvolvimento**. Dev precisa de `check:all` verde localmente, ou de registro explícito do que ainda falha.
- `[VERIFICADO]` Sobreposição: #127 (acessibilidade WCAG 2.2 AA com evidência, Backlog) e #130 (gate de release do MVP web, Backlog). #155 entrega a parte de navegação e de acessibilidade das telas que ela liga; a evidência geral segue com #127.

---

## 2. Objetivo

Transformar as telas que já existem em um percurso navegável, com cabeçalho, navegação principal e rodapé comuns, começando na inicial e levando o cliente até o painel dele, e levando o profissional da entrada até a situação da verificação.

Resultado esperado para o dono: uma pessoa que abre o site consegue ir da busca até o pedido publicado, e um profissional consegue ir do cadastro até a situação da sua conta, sem digitar endereços manualmente. Nenhuma tela nova de negócio é criada por esta Issue, exceto o painel mínimo e a página 404 (decisões 962 e 964; 404 em V3).

---

## 3. Mapa de telas e rotas

Rotas são as URLs que o usuário vê. Arquivos são os atuais em `apps/web/public`.

| Rota | Arquivo atual | Tela | Papel no fluxo | Situação no repositório | Origem |
|---|---|---|---|---|---|
| `/` | `index.html` | Início com busca de serviço e endereço | Entrada do visitante | Existe, provisória (título "pre-visualizacao"); substituída pela #153 | J1.1; #153 |
| `/pedido` | `pedido.html`, `pedido.js`, `pedido.css` | Pedir um serviço (serviço, local, urgência, descrição) | Passo 1 do cliente | Existe; já envia para a revisão (`pedido.js`) | RF-010, RF-012 |
| `/fotos` | `fotos.html`, `fotos.js`, `fotos-envio.js`, `fotos.css` | Fotos do pedido (até 5, opcionais) | Passo do cliente; posição conforme decisão 960 | Existe | RF-025, RF-027 |
| `/pedido/revisao` | `pedido/revisao.html`, `pedido-revisao.js`, `pedido-logica.js` | Revisar e confirmar o pedido | Passo do cliente | Existe; já tem links "Editar" para `/pedido#...` e links ocultos para `/acesso` e `/pedido` | RF-043 (#43 concluída) |
| `/acesso` | `acesso.html`, `acesso.js` | Confirmar acesso pelo link enviado ao e-mail | Desafio de acesso do cliente | Existe; conteúdo definido pela #154 | RF-037 a RF-041; J1.4 |
| `/codigo` | `codigo.html`, `codigo.js`, `codigo.css` | Digitar o código de 6 dígitos | Alternativa ao link (mesmo navegador) | Existe; conteúdo definido pela #154 | RF-037; 08 §5.1 |
| `/painel` | (nenhum) | Meus pedidos, somente os da sessão | Destino final do cliente | **NÃO existe**; API pronta (#47) | RF-038; J1.12; decisão 962 |
| `/404` | (nenhum) | Página de rota inexistente | Qualquer rota | **NÃO existe** | `[PROPOSTA]` V3 |
| `/profissional` | (nenhum) | Entrada do profissional: cadastro e login | Entrada do profissional | **NÃO existe**; conteúdo definido pela #154 | J2.1; #154 |
| `/profissional-documentos` | `profissional-documentos.html`, `.js`, `.css` | Documento de identidade | Passo do profissional | Existe | RF-046, RF-052; J2.2 |
| `/profissional-documento` | `profissional-documento.html`, `.js`, `.css` | Cadastro do documento | Duplicata provável de `/profissional-documentos` | Existe; decisão 963 | `[AMBIGUIDADE]` |
| `/profissional-situacao` | (só `profissional-situacao.js`) | Situação da verificação | Passo do profissional | **HTML NÃO existe**; decisão 964 | J2.3; #54 |
| `/profissional-perfil` | (só `profissional-perfil.js` e `.css`) | Perfil: serviços, base e raio (5 a 100 km) | Passo do profissional, depois da aprovação | **HTML NÃO existe**; decisão 964 | RF-051; J2.4 |

Fora da navegação pública: qualquer rota administrativa. Nenhuma página pública ou profissional tem link para área administrativa (RN-NAV-06; RF-148).

---

## 4. Escopo e fora de escopo

**Dentro do escopo**
1. Cabeçalho, navegação principal e rodapé comuns em todas as telas da tabela da seção 3 que existirem (V1).
2. Subnavegação do profissional com os três passos (documento, situação, perfil), na ordem da decisão 961.
3. Encadeamento do fluxo do cliente, da inicial ao painel, na ordem da decisão 960.
4. Estados de navegação: sessão ausente, sessão expirada, link inválido, rota inexistente, voltar, rascunho preservado.
5. Retorno seguro após o login (somente caminhos internos da lista).
6. Página 404 simples, com cabeçalho comum (V3).
7. Telas `/painel`, `/profissional-situacao` e `/profissional-perfil`, somente se a decisão 962 e a 964 forem aprovadas nas opções recomendadas.
8. Provas automatizadas: links, texto proibido, acessibilidade e um cenário feliz de ponta a ponta (seção 8).

**Fora do escopo**
- Conteúdo, layout e textos de `/` (busca) e de `/acesso`, `/codigo` e `/profissional` (entrada): #153 e #154.
- Textos de estados vazios e de "sem profissional" (RF-020, AMB-03; "sem vaga" na J2): dependem de decisão humana; não são inventados.
- Páginas de Termos e privacidade (#122, #135): o rodapé só recebe o link quando a página existir (V6).
- Telas de chat (E7), seleção (E8), avaliação (E10), cobrança e planos (E5): não entram na navegação desta Issue.
- Telas de administração (RF-148): nenhuma ligação com a navegação pública.
- Framework novo, roteador de aplicação, gerador de páginas ou build de template. O projeto segue com HTML, CSS e JavaScript estáticos.
- Alterações de cor fora de `packages/tokens` (regra de `check:hex`).
- Backup, exportação de dados e qualquer ação de produção, domínio ou deploy. Fora do escopo do projeto.
- Mapa: não muda. O uso de Mapbox continua restrito ao campo de endereço já existente.

---

## 5. Fluxos e estados

### 5.1 Cliente (decisão 960)

Opção recomendada **B**: `/` → `/pedido` → `/fotos` → `/pedido/revisao` → (ao publicar, sem sessão) `/acesso` → `/codigo` (alternativa) → volta à revisão → confirmação expressa → publicado → `/painel`.

Por que B: a pessoa revisa o pedido já com as fotos à vista, e o e-mail só é pedido no momento de publicar, o que combina com RF-012 (pedido pode ser preenchido antes de autenticar) e com o caminho de link ou código de RF-037.

Alternativas (ver seção 10):
- **A (texto do dono):** `/` → `/pedido` → `/pedido/revisao` → `/fotos` → `/acesso` → `/codigo` → `/painel`. Exige que as fotos sejam anexadas depois da revisão; a revisão precisa então mostrar as fotos depois de adicionadas.
- **C (desenho da arquitetura §5.1):** `/` → `/pedido` → `/fotos` → `/acesso` → `/codigo` → `/pedido/revisao` → publicado → `/painel`. Exige e-mail antes de revisar.

Após publicar, a tela de confirmação informa que o cliente deve voltar ao FastPro para ver as respostas (FA-001 e decisão 10), com link para `/painel`.

### 5.2 Profissional (decisão 961)

Opção recomendada **B** (segue a jornada J2): `/profissional` (cadastro ou login) → `/profissional-documentos` → `/profissional-situacao` → `/profissional-perfil`.

- O perfil (serviços, base e raio) só é editado depois da aprovação (J2.4). Antes da aprovação, `/profissional-perfil` redireciona para `/profissional-situacao`.
- Alternativas: **A** (texto do dono): perfil → documentos → situação. **C**: entrada → documentos → perfil → situação, com perfil editável antes da aprovação.

Subnavegação: três itens com `aria-current="page"` no item atual. Só aparece com sessão de profissional.

### 5.3 Sessão ausente, expirada e retorno

- **Sessão ausente em rota protegida** (`/painel`, `/profissional-*`, publicação): a página não mostra dado algum. O visitante vai para a entrada correspondente (`/acesso` para cliente; `/profissional` para profissional), com retorno interno (`?retorno=/painel`). Após entrar, volta ao retorno. Cookie de sessão: `fastpro_session`.
- **Sessão expirada no meio do fluxo** (ex.: clique em publicar): o pedido **não** é publicado. A tela mostra "Sua sessão terminou. Entre de novo para publicar. Seu pedido continua guardado." com a ação "Entrar de novo", que leva a `/acesso` com retorno a `/pedido/revisao`. Publicar só acontece com nova confirmação expressa.
- **Link de acesso inválido, expirado ou já usado:** mensagem neutra, que não confirma se o e-mail existe (RF-039). Oferece "Digitar o código" para `/codigo`, mantendo o rascunho. Limite de tentativas: texto a definir (RF-040, `[texto pendente]`).
- **Retorno seguro:** aceita só caminhos internos de uma lista fixa de rotas. Qualquer outro valor é ignorado e a pessoa vai à tela padrão da sua área.

### 5.4 Voltar e rascunho preservado

- Cada passo tem o link "Voltar" para o passo anterior. O botão "voltar" do navegador também funciona. Os dois preservam os campos.
- "Editar" na revisão abre o passo correspondente (`/pedido#...`) e volta à revisão sem perder nenhum outro campo.
- O rascunho fica guardado no servidor com prazo de guarda (estados `aberto`, `aguardando_email`, `publicado`, `descartado`, conforme 08, tabela de entidades). Ao mudar de tela, o identificador do rascunho é o mesmo. Fotos já enviadas continuam na quarentena do rascunho (08, §fotos).
- Pedido publicado: voltar à revisão mostra o estado "Pedido publicado" e não envia de novo (publicação idempotente, #44). Nenhum segundo pedido é criado.
- Prazo de guarda do rascunho: decisão 966. Não é prazo legal (09, RC-09).

### 5.5 Estados de tela

| Estado | Comportamento obrigatório |
|---|---|
| Carregando | Indicador acessível (texto e `aria-busy`); sem tela em branco. |
| Vazio | Mensagem com ação. Texto a definir (`[texto pendente AMB-03]`). |
| Erro de rede | Mensagem clara, botão "Tentar de novo", dados preservados. |
| Sessão ausente | Ver 5.3. |
| Sessão expirada | Ver 5.3. |
| Link inválido | Ver 5.3. |
| Rota inexistente | `/404` com links para Início e Pedir um serviço, e cabeçalho comum (CA-NAV-15). |

### 5.6 Diagrama de navegação do cliente (recomendado)

```
[/]  --busca-->  [/pedido]  --avança-->  [/fotos]  --avança-->  [/pedido/revisao]
                                                                    |
                                       (sem sessão, ao publicar)    v
                                             [/acesso] <--> [/codigo]
                                                                    |
                                                  (sessão ativa)    v
                                  [/pedido/revisao] --confirmação expressa--> [publicado]
                                                                                    |
                                                                                    v
                                                                              [/painel]
```

---

## 6. Regras de negócio

| Ref. | Regra | Fonte | Como a navegação atende |
|---|---|---|---|
| RN-NAV-01 | Visitante navega sem conta até a revisão do pedido. | RF-001, RF-012; J1.1 | Telas de `/` a `/pedido/revisao` não pedem login. |
| RN-NAV-02 | Confirmação de acesso só acontece no momento de publicar (ou de abrir painel), no caminho recomendado. | RF-037 a RF-041; decisão 960 | Ver 5.1 e 5.3. |
| RN-NAV-03 | O painel mostra só os pedidos da sessão do dono. | RF-038; FA-003 | `/painel` sem sessão não exibe dado; API já filtra por dono (#47). |
| RN-NAV-04 | Link ou código inválido não revela se o e-mail existe. | RF-039 | Mensagem neutra em `/acesso` e `/codigo`. |
| RN-NAV-05 | Navegação não mostra contadores, vagas, ondas nem o aviso "FastPro apenas conecta" (fora dos Termos). | RF-018, RF-066; decisão 22; RF-078 | Teste estático (CA-NAV-10). |
| RN-NAV-06 | Nenhuma página pública ou profissional linka área administrativa. | RF-148; 08 (admin por convite) | Teste estático (CA-NAV-09). |
| RN-NAV-07 | Telas do profissional exigem sessão de profissional; sem ela, vão para `/profissional`. | `[PROPOSTA]`; #30 (exclusividade de papéis, concluída, `[NÃO VERIFICADO]` no detalhe) | CA-NAV-08. |
| RN-NAV-08 | Perfil profissional só é editado depois da aprovação, no caminho recomendado. | J2.3 e J2.4; decisão 961 | Redirecionamento para `/profissional-situacao` antes da aprovação. |
| RN-NAV-09 | Link para Termos e privacidade só existe quando a página existir. | #122, #135 (Backlog) | Rodapé sem o link enquanto não houver página (V6). |
| RN-NAV-10 | Texto de estado não aprovado não é inventado. | AMB-03; J2 "sem vaga" | Marcador `[texto pendente]`. |
| RN-NAV-11 | Telefone e e-mail de terceiros não aparecem em telas de navegação. | RF-136; I-16 | Nenhum dado de contato em cabeçalho, rodapé ou painel mínimo. |
| RN-NAV-12 | Redirecionamento de retorno aceita só caminho interno da lista fixa. | `[PROPOSTA]` (segurança de navegação) | CA-NAV-16. |

---

## 7. Critérios de aceite (Given / When / Then)

Todos os critérios são testáveis. Caminhos de erro (CA-NAV-07, 15, 16) são provados no ciclo de Dev e Review. A QA de fim executa só o caminho feliz (regra de QA; ver decisão 965).

- **CA-NAV-01 (Inicial leva ao pedido).**
  - **Dado** um visitante em `/` com serviço e endereço preenchidos na busca (contrato da #153),
  - **Quando** envia a busca,
  - **Então** chega a `/pedido` com serviço e endereço já preenchidos, sem perder o que foi digitado.
  - *Prova:* Playwright, cenário feliz; verificação dos campos.

- **CA-NAV-02 (Cabeçalho e rodapé comuns).**
  - **Dado** qualquer tela da seção 3 que exista,
  - **Quando** é carregada,
  - **Então** tem um cabeçalho (landmark de banner) com logo e navegação principal com os mesmos itens e na mesma ordem, um rodapé (landmark de contentinfo) e o item da tela atual com `aria-current="page"`.
  - *Prova:* teste estático compara o bloco de cabeçalho e de rodapé entre os arquivos; Playwright confirma a presença em tempo de execução.

- **CA-NAV-03 (Fluxo do cliente ponta a ponta, caminho feliz).**
  - **Dado** um visitante sem conta com dados válidos,
  - **Quando** segue a sequência da decisão 960 (recomendada: `/` → `/pedido` → `/fotos` → `/pedido/revisao` → acesso → código → publicação → `/painel`),
  - **Então** cada passo abre a tela esperada, o pedido aparece como publicado em `/painel` e a tela de publicação informa que o cliente deve voltar ao FastPro para ver as respostas.
  - *Prova:* um único cenário Playwright (caminho feliz) e conferência do estado do pedido pela API.

- **CA-NAV-04 (Voltar sem perder dados).**
  - **Dado** um pedido preenchido em `/pedido`,
  - **Quando** avança até `/pedido/revisao`, usa "Editar" em um item e volta à revisão,
  - **Então** todos os campos mantêm os valores e o rascunho mantém o mesmo identificador.
  - *Prova:* Playwright.

- **CA-NAV-05 (Rota protegida sem sessão).**
  - **Dado** que não há cookie `fastpro_session`,
  - **Quando** o visitante abre `/painel`,
  - **Então** vai para `/acesso` com retorno interno a `/painel`, e nenhum dado de pedido aparece antes do login; após entrar, volta a `/painel`.
  - *Prova:* Playwright (cenário feliz de retorno) e verificação de que a resposta sem sessão não traz dados.

- **CA-NAV-06 (Sessão expirada na publicação).**
  - **Dado** uma revisão preenchida e uma sessão expirada,
  - **Quando** a pessoa clica em publicar,
  - **Então** o pedido não é publicado, a tela mostra a mensagem de sessão encerrada com a ação "Entrar de novo", e após entrar volta à revisão com os dados preservados; a publicação só ocorre com nova confirmação expressa.
  - *Prova:* teste de Dev e Review (caminho de erro); API confirma que nenhum pedido foi publicado sem confirmação.

- **CA-NAV-07 (Link inválido com alternativa de código).**
  - **Dado** um link de acesso inválido, expirado ou já usado,
  - **Quando** o visitante abre `/acesso`,
  - **Então** vê mensagem neutra (sem confirmar se o e-mail existe) e a opção "Digitar o código", que leva a `/codigo` mantendo o rascunho.
  - *Prova:* teste de Dev e Review (caminho de erro).

- **CA-NAV-08 (Fluxo do profissional, caminho feliz).**
  - **Dado** um profissional com sessão,
  - **Quando** percorre a subnavegação na ordem da decisão 961,
  - **Então** cada item abre a tela correspondente; sem sessão de profissional, `/profissional-*` vai para `/profissional`; antes da aprovação, `/profissional-perfil` vai para `/profissional-situacao`.
  - *Prova:* Playwright (caminho feliz) e teste estático de rotas.

- **CA-NAV-09 (Sem links quebrados e sem link administrativo).**
  - **Dado** todas as páginas de `apps/web/public`,
  - **Quando** o teste estático lê todos os `href`, `src` e `action` internos,
  - **Então** cada destino existe como arquivo ou como rota declarada, e nenhum link aponta para área administrativa.
  - *Prova:* teste de Vitest estático no pacote do web, rodado localmente.

- **CA-NAV-10 (Sem texto proibido na navegação).**
  - **Dado** o cabeçalho, a subnavegação e o rodapé,
  - **Quando** o teste estático procura o aviso "apenas conecta" (fora dos Termos), contadores, "vagas" e "onda",
  - **Então** nenhum texto aparece nesses blocos.
  - *Prova:* teste de Vitest estático.

- **CA-NAV-11 (Acessibilidade WCAG 2.2 AA).**
  - **Dado** cada tela da seção 3 que exista,
  - **Quando** o axe-core roda com as regras WCAG 2.2 AA,
  - **Então** não há violação, e o primeiro item focável é o link "Pular para o conteúdo", que leva ao `main`.
  - *Prova:* Playwright com axe-core; relatório anexado à Issue.

- **CA-NAV-12 (Teclado e foco).**
  - **Dado** qualquer tela com navegação,
  - **Quando** a pessoa usa só Tab, Shift+Tab e Enter,
  - **Então** todos os links e botões são alcançados em ordem lógica, o foco é visível e não fica oculto por cabeçalho fixo (WCAG 2.4.7 e 2.4.11), e os alvos têm pelo menos 24 CSS px (WCAG 2.5.8).
  - *Prova:* Playwright.

- **CA-NAV-13 (Responsivo a 320 px).**
  - **Dado** uma largura de 320 CSS px,
  - **Quando** a tela é carregada,
  - **Então** não há rolagem horizontal, todos os itens principais da navegação estão visíveis (sem menu escondido, V2) e o texto pode ser ampliado sem perder conteúdo (WCAG 1.4.10).
  - *Prova:* Playwright em viewport de 320 px e axe.

- **CA-NAV-14 (Cores somente por tokens).**
  - **Dado** os arquivos novos ou alterados,
  - **Quando** `check:hex` roda localmente,
  - **Então** a saída tem código 0 e nenhuma cor literal aparece fora de `packages/tokens`.
  - *Prova:* `corepack pnpm check:hex` (código de saída e contagem registrados na Issue).

- **CA-NAV-15 (Rota inexistente).**
  - **Dado** uma URL que não existe,
  - **Quando** é aberta,
  - **Então** mostra `/404` com cabeçalho comum e links para Início e Pedir um serviço, sem erro técnico visível.
  - *Prova:* Playwright (caminho de erro, Dev e Review).

- **CA-NAV-16 (Retorno seguro).**
  - **Dado** um parâmetro de retorno,
  - **Quando** o valor não está na lista fixa de rotas internas (inclui endereço externo ou caminho desconhecido),
  - **Então** o valor é ignorado e a pessoa vai à tela padrão da sua área.
  - *Prova:* teste unitário da função de retorno.

---

## 8. Provas e matriz de testes

| Prova | Ferramenta | Critérios | Quando roda |
|---|---|---|---|
| Links, rotas e blocos comuns | Vitest estático (já existe na raiz, 5.1.0) | CA-NAV-02, 09, 10, 16 | Dev e Review, local |
| Cores | `corepack pnpm check:hex` | CA-NAV-14 | Dev e Review, local |
| Caminho feliz de ponta a ponta | Playwright, um cenário | CA-NAV-01, 03, 04, 05, 08 | QA de fim, local (decisão 965) |
| Caminhos de erro | Playwright, Dev e Review | CA-NAV-06, 07, 15 | Dev e Review, local |
| Acessibilidade | axe-core com Playwright | CA-NAV-11, 12, 13 | Dev e Review; QA de fim no caminho feliz |
| Build do web | `corepack pnpm` local | Pré-condição para todos | Dev, antes de qualquer prova |

Regras de execução:
- Tudo roda localmente (regra de builds e testes locais). Nenhum resultado de GitHub Actions é declarado como evidência.
- A evidência de cada etapa é o comando, a contagem e o código de saída registrados na Issue.
- Nenhum teste grava dado real no banco. Quando a prova usa pedido, usa o ambiente de desenvolvimento autorizado e registra os identificadores de teste.

---

## 9. Dependências

- **#153 (página inicial com busca, pré-condição):** a rota `/` e o contrato de passagem de serviço e endereço para `/pedido` são definidos pelo refino 171 (inexistente). **Dev não fecha #155 antes da #153.**
- **#154 (telas de entrada, pré-condição):** as rotas `/profissional` e o conteúdo de `/acesso` e `/codigo` são definidos pelo refino 172 (inexistente). **Dev não fecha #155 antes da #154.**
- **#152 (build do web quebrado):** em Aguardando aprovação. Sem build, não há prova de navegação. Dev confirma se já foi resolvida antes de começar.
- **#149 (`check:all` vermelho):** em Desenvolvimento. Dev confirma que `check:all` passa localmente ou registra o que ainda falha e por quê.
- **#47 (painel do cliente, API):** concluída. `/painel` consome `private.request_list_owner`. Architect confirma o contrato da tela.
- **#43, #42, #38, #33, #30:** concluídas. Pedido, revisão, fotos e rascunho já existem; esta Issue só os liga.
- **#127 (WCAG 2.2 AA com evidência) e #130 (gate de release):** Backlog. #155 entrega parte da evidência; o restante fica com elas.
- **#122 e #135 (Termos e aviso "apenas conecta"):** Backlog. Rodapé sem link enquanto não existirem (V6).
- **Playwright e axe-core:** `[NÃO VERIFICADO]` no pacote do web. Se faltarem, a instalação é gratuita (regra de ferramentas gratuitas). Decisão do Architect.
- **Mapeamento de URLs limpas:** `[NÃO VERIFICADO]`. Dev confirma na configuração local e de hospedagem gratuita existentes.
- **Decisões 960 a 966 (seção 10):** a ordem final das telas, o painel, os documentos duplicados, as telas sem HTML, a prova de navegação e o prazo do rascunho precisam estar definidos antes de Architect e Dev.

Dependência de fila: #155 não deve avançar para Arquitetura antes da entrega de #153 e #154, ou de decisão explícita do líder para desbloquear a parte de navegação compartilhada (cabeçalho, rodapé, estados, rotas comuns).

---

## 10. Perguntas numeradas (960 a 966)

Estas perguntas são para o líder consolidar. Nenhuma foi enviada ao usuário. Cada uma traz a recomendação; se o líder aceitar a recomendação, ela entra em `11-DECISOES.md` como "adotada pelo líder" e pode ser vetada depois.

**960. Ordem das telas do cliente (fotos e confirmação de acesso).**
- (a) É a ordem em que a pessoa passa pelas telas até publicar o pedido.
- (b) Por que importa: define em que momento a pessoa precisa dar o e-mail. Errar gera retrabalho ou tela sem sentido. Risco de não responder: a Arquitetura e o texto do dono ficam em conflito.
- (c) Opções:
  - **A (texto do dono):** pedido → revisão → fotos → acesso → código → painel.
  - **B (recomendada):** pedido → fotos → revisão → acesso e código só ao publicar → painel.
  - **C (desenho da arquitetura, §5.1):** pedido → fotos → acesso → código → revisão → painel.
- (d) Destrava: CA-NAV-03, a tabela de rotas e o refino 171.

**961. Ordem das telas do profissional.**
- (a) É a ordem dos passos depois do cadastro ou do login.
- (b) Por que importa: o perfil (serviços, base e raio) só faz sentido depois da aprovação. Risco de não responder: o perfil pode ser preenchido antes da análise, ou a situação aparece tarde demais.
- (c) Opções:
  - **A (texto do dono):** perfil → documentos → situação.
  - **B (recomendada, segue a jornada J2):** entrada → documentos → situação → perfil (depois da aprovação).
  - **C:** entrada → documentos → perfil → situação, com o perfil editável antes da aprovação.
- (d) Destrava: CA-NAV-08 e a subnavegação.

**962. A tela "Meus pedidos" (`/painel`) ainda não existe.**
- (a) É a tela onde o cliente vê os próprios pedidos depois de entrar.
- (b) Por que importa: é o último passo do fluxo do cliente. Sem ela, o fluxo termina numa tela sem destino. Risco de não responder: o fluxo não fecha.
- (c) Opções:
  - **A (recomendada):** criar uma tela mínima "Meus pedidos" nesta Issue, usando a API já pronta (#47).
  - **B:** destino provisório que mostra só a confirmação de publicação.
  - **C:** tirar o painel do fluxo até outra Issue.
- (d) Destrava: `/painel`, CA-NAV-03 e CA-NAV-05.

**963. Há duas telas de documento do profissional.**
- (a) `profissional-documentos` (Documento de identidade) e `profissional-documento` (Cadastro do documento) parecem ter a mesma função.
- (b) Por que importa: a pessoa pode cair em uma tela duplicada, com dados diferentes. Risco de não responder: a subnavegação fica ambígua.
- (c) Opções:
  - **A (recomendada):** `profissional-documentos` é a tela oficial; `profissional-documento` redireciona para ela, sem apagar arquivo.
  - **B:** manter as duas com papéis diferentes, definidos pelo PO.
  - **C:** apagar uma. Não recomendada: exclusão só com decisão explícita.
- (d) Destrava: subnavegação e CA-NAV-08.

**964. Duas telas do profissional existem só como JavaScript e CSS.**
- (a) `profissional-situacao` e `profissional-perfil` não têm página HTML.
- (b) Por que importa: sem a página, o fluxo do profissional não fecha. Risco de não responder: ou a Issue cresce sem aviso, ou o fluxo fica incompleto.
- (c) Opções:
  - **A (recomendada):** criar as duas páginas nesta Issue, aproveitando o JavaScript e o CSS que já existem.
  - **B:** criar só a situação agora e deixar o perfil para outra Issue.
  - **C:** deixar as duas fora do fluxo até a #154.
- (d) Destrava: `/profissional-situacao`, `/profissional-perfil` e CA-NAV-08.

**965. Prova de navegação em tela versus a regra de QA.**
- (a) A regra do projeto diz que a QA de fim só executa o caminho feliz, via API, sem testar tela. O dono pediu a navegação ponta a ponta com navegador (Playwright) e acessibilidade com axe, que são provas de tela.
- (b) Por que importa: sem uma exceção explícita, a prova de tela fica fora da QA e a acessibilidade não tem evidência. Risco de não responder: ou o critério fica sem prova, ou a regra de QA é quebrada sem registro.
- (c) Opções:
  - **A (recomendada):** exceção controlada: um único cenário feliz em navegador, mais axe, rodados localmente; a QA de fim executa só esse cenário.
  - **B:** provar só por API e teste estático. A acessibilidade fica sem evidência de tela.
  - **C:** só teste estático; a acessibilidade vai para a #127.
- (d) Destrava: CA-NAV-03, 11, 12 e 13 e a matriz da seção 8.

**966. Prazo de guarda do pedido em preenchimento.**
- (a) Por quanto tempo o pedido fica guardado se a pessoa sair antes de publicar.
- (b) Por que importa: se o prazo for curto, a pessoa perde o que digitou; se for longo, o servidor guarda rascunhos abandonados. Risco de não responder: o comportamento de voltar ao rascunho fica indefinido. O PRD marca esse prazo como `[PROPOSTA]` (RF-019), e não é prazo legal (09, RC-09).
- (c) Opções:
  - **A (recomendada):** 7 dias, igual à janela de sessão (RF-038).
  - **B:** 24 horas.
  - **C:** 30 dias.
- (d) Destrava: 5.4, CA-NAV-04 e CA-NAV-06.

### Veto (adotadas pelo líder como recomendação; não exigem resposta)

- **V1.** Cabeçalho e rodapé repetidos em cada HTML, sem framework e sem injeção por JavaScript. Um teste estático garante que sejam idênticos.
- **V2.** Navegação principal visível em telas pequenas, sem menu escondido.
- **V3.** Página `/404` simples e nova (`404.html`).
- **V4.** Item "Meus pedidos" sempre visível. Sem sessão, leva a `/acesso` com retorno.
- **V5.** Retorno após o login só para caminhos internos de lista fixa.
- **V6.** Rodapé sem link para Termos enquanto #122 e #135 não entregarem a página.
- **V7.** Títulos no padrão "FastPro - <tela>" (hoje há variação, como "pre-visualizacao").
- **V8.** Nenhuma tela de administração linkada a partir da navegação pública.
- **V9.** Cores somente por tokens (`check:hex`).

---

## 11. Resumo para o líder

- #155 está refinada no nível de Product Owner, em Product Owner no quadro. **Não pode avançar para Dev** antes de #153 e #154 (refinos 171 e 172 ainda não existem).
- Ordem do cliente: três opções (960). Ordem do profissional: três opções (961). O texto do dono e o desenho da arquitetura divergem nesse ponto.
- Três telas não existem (`/painel`, `/profissional-situacao`, `/profissional-perfil`); uma duplicata de documento precisa de decisão (963).
- A prova de navegação com navegador conflita com a regra de QA; decisão 965.
- Pré-condições técnicas fora desta Issue: #152 (build do web) e #149 (`check:all`).
- Nenhum arquivo além deste foi criado ou alterado. Quadro, `11-DECISOES.md` e código não foram tocados.
