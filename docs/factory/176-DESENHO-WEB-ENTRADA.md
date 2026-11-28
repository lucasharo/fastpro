# Desenho 176: telas de entrada do cliente e do profissional (Issue #154)

- **Issue:** #154 `[E16] Telas de entrada: cliente (link/código) e profissional (cadastro e login)` · **Workflow:** WF-03 · **Etapa:** Arquitetura · **EXEC-ID:** EXEC-ARQ-154-20261121
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init` · **Data:** 2026-11-21 · **Entrada:** `docs/factory/172-REFINO-WEB-ENTRADA.md`
- **Natureza:** somente documento. Nenhum código, quadro, `11-DECISOES.md` ou commit foi alterado.
- **Etiquetas:** `[VERIFICADO]` lido no código nesta rodada · `[LACUNA]` não existe no repositório · `[PROPOSTA]` deste desenho, sujeita a veto do líder · `[NÃO VERIFICADO]` não confirmado.

---

## 1. Resumo para o líder

1. **As rotas de cadastro e de login do profissional existem** (`professional-route.ts`, `professional-recovery-route.ts`) e a de consumo do link também (`consume-route.ts`). A pendência do refino 172 está resolvida; os contratos reais estão na seção 3. O refino errou ao dizer que a rota de consumo não existia.
2. **Conflito real com a decisão 954.** A confirmação do e-mail do profissional na API é por **link** (`POST /v1/auth/professional/verification/confirm {token}`), não por código de 6 dígitos. Não existe API de código para o profissional `[LACUNA]`. O desenho adota **link** (AD-154-01) e deixa, na seção 4.4, a fatia mínima de API caso o líder mantenha o código.
3. **A página de destino do refino (A3, `/profissional-situacao.html`) não existe**: só há `profissional-situacao.js`. O desenho usa uma constante única de destino (`/profissional-documentos`, que existe) até a #155 entregar a página (AD-154-02).
4. **Conflito entre refinos 171 e 172** sobre quem coloca o link "Entrar" na inicial. Resolvido por contrato com a #153 (seção 5.3).
5. **Há 5 telas novas e 2 ajustes**, sem framework: HTML, CSS e JS estáticos, tokens do EDS. O cabeçalho comum fica com a #155; esta Issue não escreve CSS nem JS de cabeçalho.
6. **A API local responde 404 hoje** (Issue #156). Toda prova de tela usa fake do `fetch`; 404 e falha de rede viram o mesmo estado "indisponível" na tela. A prova por serviço (S) só roda depois da #156.

---

## 2. Decisões

### 2.1 Decisões 950 a 956, adotadas pelo líder (vetáveis), com o efeito no desenho

| Nº | Decisão adotada | Efeito no desenho |
|---|---|---|
| 950 | A. Esta Issue entrega o link "Entrar" na inicial | Só como contrato com a #153, porque `index.html` é editado só por ela (5.3). |
| 951 | A. Página própria `/entrar` | Arquivo novo `entrar.html` + `entrar.js`. Reaproveita o contrato de `POST /v1/auth/challenges`. |
| 952 | A. Páginas separadas de entrada e cadastro do profissional | `/profissional/entrar` e `/profissional/cadastro`. |
| 953 | A. Mensagem neutra no cadastro | Coincide com a API: o cadastro responde 202 igual para e-mail novo e existente. O texto neutro é o único possível. |
| 954 | A. Código de 6 dígitos | **Inviável sem API nova.** Ajuste proposto em AD-154-01 (link). Aguarda o líder registrar. |
| 955 | A. "Esqueci minha senha" nesta Issue | Rotas existem. Exige também a página que recebe o link do e-mail (`/profissional/redefinir`), senão o e-mail leva a lugar nenhum. |
| 956 | A. Sem login social | Nenhum botão, nem desabilitado. Teste P confirma. |

### 2.2 Decisões deste desenho (para o líder registrar; todas vetáveis)

| Nº | Decisão | Motivo |
|---|---|---|
| AD-154-01 | **Confirmação do e-mail do profissional por link**: tela "Confira seu e-mail" depois do cadastro, mais a página `/profissional/verificar` que recebe o link (`#t=` no fragmento, clique explícito, igual a `/acesso`). Substitui 4.4.1 do refino e ajusta CA-154-15. | A rota real consome token de 43 caracteres. Código exigiria banco, e-mail e rota novos. |
| AD-154-02 | Destino depois do login com e-mail confirmado = constante `DESTINO_PROFISSIONAL` em `entrada-comum.js`, valor `/profissional-documentos`. A #155 troca o valor quando criar a página de situação. | `profissional-situacao.html` não existe. |
| AD-154-03 | Login com resposta 200 e `email_verified=false` (acesso só de verificação) **não redireciona**: mostra "Confirme seu e-mail para continuar" com botão "Reenviar link" (rota de reenvio). | A API devolve 200, não um erro, para conta sem e-mail confirmado. |
| AD-154-04 | **Sem estado entre páginas.** E-mail e senha ficam só na memória da página; nada vai para URL, `localStorage`, `sessionStorage` ou cookie. CA-154-13 ("sem perder o que digitou") vale dentro da página e no botão Voltar do navegador (restauração do próprio navegador), não por passagem de dados entre páginas. | RN-154-13 prevalece. |
| AD-154-05 | **Um estilo e um módulo comum**: `entrada.css` (campos, erros, botões, links, estados) e `entrada-comum.js` (`window.FastProEntrada`). `codigo.css` e `codigo.js` não são refatorados (têm testes e o módulo é reutilizado pela #43). | Evita regressão em H-012/H-013. Duplicação residual de ~40 linhas de CSS fica registrada como risco R-5. |
| AD-154-06 | **Qualquer resposta não prevista** (404, 5xx, 502, corpo não JSON, falha de rede) vira o estado "indisponível" da tela, sem expor status. | Cobre a API local ainda em 404 (#156). |
| AD-154-07 | Parâmetro opcional `?voltar=<caminho>` aceito só se estiver numa lista fixa de caminhos internos (`/pedido/revisao`, `/pedido`, `/`). Só lê o caminho, nunca e-mail. Usado para o link "Continuar" depois do sucesso. | Ponto de integração com a RN-NAV-12 da #155. A função é pura e testada; a #155 decide quem a chama. |
| AD-154-08 | Após 429, o botão volta a habilitar depois de `Retry-After` segundos (mínimo 5, máximo 900, padrão 30 sem cabeçalho), sem mostrar o número. | RN-154-07: texto sem número interno. |
| AD-154-09 | `/profissional` redireciona (307, em `vercel.json`) para `/profissional/entrar`. | A #155 lista `/profissional` como entrada. Evita página extra. |

---

## 3. Contratos reais `[VERIFICADO]`

Todas as chamadas do navegador usam `fetch` na **mesma origem**, caminho com prefixo `/api` (o web encaminha `/api/*` à API, que tira o prefixo), com `method: 'POST'`, `credentials: 'same-origin'`, `cache: 'no-store'`, `redirect: 'error'`, `referrerPolicy: 'no-referrer'`, `Content-Type: application/json`. Esse é o padrão já usado em `acesso.js` e `codigo.js`. O encaminhamento `/api/*` não existe em `apps/web/vercel.json` (lacuna L-5, assunto da #156).

### 3.1 Cliente

| Rota | Corpo | Respostas | Fonte |
|---|---|---|---|
| `POST /v1/auth/challenges` | `{email, purpose: 'login'}` (até 4 KB; `draft_id` opcional, não usado) | 202 igual para qualquer e-mail; 422 forma inválida; 429 limite (cabeçalhos vêm de `requestChallenge`, incluindo `Retry-After`); outro = indisponível | `challenge-request-route.ts`, `codigo.js` |
| `POST /v1/auth/challenges/verify` | `{email, code, purpose}` (até 2 KB) | 200 + `Set-Cookie` de etapa `__Host-fp_ident`; 422 `codigo_invalido` único (incorreto, vencido, usado, inexistente); 429; 403/415 por Origin ou Content-Type; 503 `acesso_indisponivel` | `challenge-verify-route.ts` |
| `POST /v1/auth/challenges/consume` | `{token}` | 200 + `Set-Cookie`; 400 link inválido (o que `acesso.js` trata); 422 `pedido_invalido`; 403/415 por Origin ou Content-Type; 503 `acesso_indisponivel` | `consume-route.ts`, `acesso.js` |
| `POST /v1/auth/session` | `{}` | 200 `{status:'autenticado'}` + cookie `__Host-fp_sess` (apaga o de etapa); 401 `acesso_expirado`; 503 | `session-route.ts` |

Origin e `Sec-Fetch-Site: same-origin` são conferidos em verify, consume e session. O navegador os envia sozinho em `fetch` da mesma origem. Os 4 contratos já são usados por `acesso.js` e `codigo.js` e não mudam.

### 3.2 Profissional

| Rota | Corpo | Respostas | Observações |
|---|---|---|---|
| `POST /v1/auth/professional/register` | `{email, password}` | **202** `{status:'accepted'}` igual para e-mail novo e existente (para conta não confirmada, a própria rota reenvia o link); **422** `{code:'campo_invalido', campo:'email'\|'password', motivo}`; **429** `{code:'muitos_pedidos', retry_after_seconds}` + `Retry-After`; **503** `{code:'service_unavailable'}`; 400/413/415 sem corpo | JSON até 4 KB. Piso de 400 ms por resposta. 422 é só de forma ou de senha fraca, nunca de existência. |
| `POST /v1/auth/professional/verification/confirm` | `{token}` (43 caracteres base64url) | **204** consumido; **410** `{code:'link_invalid'}` para qualquer link que não sirva; 503 | Token no fragmento, clique explícito. |
| `POST /v1/auth/professional/verification/resend` | `{email}` | **202** igual sempre (inclusive e-mail em forma inválida); **429** com `Retry-After`; 503 | Balde de limite próprio. |
| `POST /v1/auth/professional/login` | `{email, password}` | **200** + `Set-Cookie: __Host-fp_sess` (7 dias) e corpo `{access_level:'full'\|'verification_only', email_verified:boolean}`; **401** `{code:'invalid_credentials'}` (senha errada, e-mail inexistente e forma inválida, sem diferença); **403** `{code:'account_unavailable'}` (conta inativa, só depois de senha certa); **429** `{code:'login_temporarily_blocked'}` + `Retry-After`; 503 | 4 falhas livres por e-mail; da 5ª em diante espera de 30 s dobrando até 15 min; zera após 24 h. |
| `POST /v1/auth/password/recovery` | `{email}` | **202** igual sempre; **429** com `Retry-After`; 503 | |
| `POST /v1/auth/password/reset` | `{token, new_password}` | **204** trocada (não abre sessão); **410** `link_invalid`; **422** `{code:'campo_invalido', campo:'password', motivo}` e o link continua válido; 503 | |

**Regra de senha** (`password.ts`): mínimo 8 caracteres (por ponto de código), máximo 72 bytes em UTF-8, sem caracteres de controle, diferente do e-mail, fora da lista de senhas comuns. Motivos devolvidos: `tipo`, `curta`, `longa`, `controle`, `igual_email`, `comum`. Motivo de e-mail: `email`. Forma de e-mail aceita: `^[^\s@]+@[^\s@]+\.[^\s@]+$`.

**Cookie de sessão:** `__Host-fp_sess`, definido pelo servidor. A página nunca o lê (não há `document.cookie`).

### 3.3 Lacunas `[LACUNA]`

| Nº | Lacuna | Tratamento |
|---|---|---|
| L-1 | Não existe API de confirmação do e-mail do profissional por **código**. | AD-154-01 (link). Se o líder mantiver o código: fatia mínima de API em 4.4. |
| L-2 | `profissional-situacao.html` e `profissional-perfil.html` não existem. | AD-154-02. Nenhuma criação nesta Issue. |
| L-3 | ~~Caminhos das páginas do e-mail~~ **Resolvida `[VERIFICADO]`**: `packages/email/src/professional-mail.ts` já fixa `PROFESSIONAL_VERIFY_PATH = '/profissional/verificar'` e `PROFESSIONAL_RESET_PATH = '/profissional/redefinir'`, ambos com `#t=<token>`. Coincidem com as páginas deste desenho; nada a alterar em `packages/email`. | Há um terceiro caminho, `/profissional/ativar` (`professional_activate`, conta criada pela equipe). **Fora do escopo**: nenhuma tela é criada; registrado como pendência para a Issue que usar esse fluxo. |
| L-4 | Não há rota de "quem sou eu" do cliente para saber se já tem sessão. | Fora do escopo. O destino do cliente continua "A próxima etapa será liberada em breve." até a #155. |
| L-5 | O encaminhamento `/api/*` para a API **não existe** em `apps/web/vercel.json` (126 linhas, busca por `rewrite` e `/api` sem resultado `[VERIFICADO]`). As telas atuais (`acesso.js`, `codigo.js`) já chamam `/api/...`. | Pertence à #156 (ambiente executável). A #154 não cria o encaminhamento; trata como indisponível (AD-154-06) e registra em R-3. Se a #156 não o entregar, é a primeira coisa a faltar para S8. |

---

## 4. Mapa de páginas e arquivos

Todos em `apps/web/public/`. Sem framework. `cleanUrls: true` já está ligado, então `/entrar` serve `entrar.html`.

### 4.1 Telas

| Rota | Arquivos | Situação | Função |
|---|---|---|---|
| `/entrar` | `entrar.html`, `entrar.js` | **novo** | Cliente informa o e-mail e pede link ou código. Link "Digitar o código" (`/codigo`). Link "Sou profissional" (`/profissional/entrar`). |
| `/acesso` | `acesso.html` (ajuste), `acesso.js` (ajuste mínimo) | existe | Passa a carregar `viewport`, `tokens.css` e `entrada.css`; link "Pedir novo acesso" (`/entrar`) sempre presente no HTML; `acesso.js` só o esconde no sucesso. Não muda nenhum texto nem chamada. |
| `/codigo` | `codigo.html` (ajuste) | existe | Links "Voltar" e "Pedir novo código" (`/entrar`). `codigo.js` e `codigo.css` não mudam. |
| `/profissional/entrar` | `profissional/entrar.html`, `profissional-acesso.js` | **novo** | E-mail e senha; "Esqueci minha senha"; "Criar conta"; "Sou cliente" (`/entrar`). |
| `/profissional/cadastro` | `profissional/cadastro.html`, `profissional-acesso.js` | **novo** | E-mail e senha com regra visível; estado "Confira seu e-mail" com "Reenviar link". |
| `/profissional/verificar` | `profissional/verificar.html`, `profissional-link.js` | **novo** | Recebe o link de confirmação do e-mail. |
| `/profissional/recuperar` | `profissional/recuperar.html`, `profissional-acesso.js` | **novo** | E-mail; resposta igual sempre. |
| `/profissional/redefinir` | `profissional/redefinir.html`, `profissional-link.js` | **novo** | Recebe o link do e-mail, pede a nova senha. |
| `/profissional` | `vercel.json` | redirect | 307 para `/profissional/entrar`. |

`profissional-acesso.js` e `profissional-link.js` escolhem o comportamento por `<body data-pagina="...">` (`entrar`, `cadastro`, `recuperar`; `verificar`, `redefinir`). Cada módulo tem uma função pura exportada por `window` (como `FastProCodigo`) para teste.

### 4.2 Componentes compartilhados

- **`entrada.css`** (novo, só tokens). Classes `.entrada-pagina`, `.entrada-campo`, `.entrada-erro`, `.entrada-status`, `.entrada-acoes`, `.entrada-link`. Botão primário: `--color-button-primary-background` e `--color-button-primary-text`; secundário: `--color-button-secondary-*`. Espaços, raio, altura do botão (`--button-height-md`) e do campo (`--input-height`) dos tokens. Foco visível: `outline: 3px solid var(--color-text-primary); outline-offset: 2px`. Sem código `#hex`, sem `style=` e sem `<style>` (a CSP exige `style-src 'self'`).
- **`entrada-comum.js`** (novo, `window.FastProEntrada`), funções puras ou de borda fina:
  - `opcoesJson(corpo)`: mesmas opções de rede da seção 3.
  - `enviarJson(buscar, caminho, objeto)` devolve `{status, retryAfter, corpo}`; converte exceção ou corpo não JSON em `{status: 0}`; nunca registra nada.
  - `emailValido(texto)`: mesma forma do servidor.
  - `motivoSenha(motivo)`: texto fixo por motivo (6 motivos).
  - `esperaLimite(retryAfter)`: valor limitado (AD-154-08).
  - `destinoSeguro(valor)`: lista fixa (AD-154-07).
  - `campo(doc, {id, rotulo, tipo, autocomplete, ajuda})`, `mostrarErro(campoEl, texto)`, `limparErro`, `ocupado(botao, bool)`: criação e estado de controles com `createElement` e `textContent` (nunca `innerHTML`).
  - `DESTINO_PROFISSIONAL` (AD-154-02).
  - `TEXTOS`: todos os textos fixos das telas (um lugar só).
- **Cabeçalho, navegação e rodapé: fora desta Issue.** Cada página nova abre com os comentários `<!-- fp:cabecalho -->` e `<!-- /fp:cabecalho -->` vazios e fecha com `<!-- fp:rodape -->`/`<!-- /fp:rodape -->`, e o conteúdo é `<main id="conteudo">` (alvo do "pular para o conteúdo" da #155). A #155 preenche os blocos. Esta Issue não cria CSS nem JS de cabeçalho.

### 4.3 Cabeçalhos HTTP (`apps/web/vercel.json`)

Para `/entrar`, `/profissional/(entrar|cadastro|verificar|recuperar|redefinir)`: o mesmo bloco já usado em `/acesso` e `/pedido` (`Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, `X-Frame-Options: DENY`, CSP `default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`). Falta `img-src` e `font-src`: as telas não usam imagem nem fonte própria (a família vem do token e cai em `sans-serif`). Se a #155 incluir logotipo, ela ajusta a CSP. Os formulários usam `method="post"` e `onsubmit` por JS com `preventDefault`; sem JS a CSP bloqueia o envio, e a senha nunca vai em consulta de URL.

### 4.4 Fatia mínima de API se o líder mantiver o código de 6 dígitos (não recomendada)

Seria: `POST /v1/auth/professional/verification/code/confirm {email, code}` com o mesmo desafio de código do cliente (`purpose: 'professional_verify'`), mais o e-mail do cadastro enviando código em vez de link, mais teste de banco. Toca `@fastpro/db`, `@fastpro/email` e a rota. Estimativa maior que esta Issue inteira; deve ser Issue própria e a #154 só consumiria. Não está no desenho.

---

## 5. Estados e integração

### 5.1 Estados por tela (textos finais ficam em `TEXTOS`; os do refino 172, seção 4, prevalecem)

| Tela | Estados, na ordem de implementação | Mapa resposta para estado |
|---|---|---|
| `/entrar` | vazio, e-mail inválido (sem rede), ocupado, enviado, limite, indisponível | 202 enviado; 422 e-mail inválido; 429 limite; qualquer outro ou erro de rede indisponível |
| `/acesso` | já existe (carregando, pronto, confirmado, inválido, indisponível, sem token) | sem mudança |
| `/codigo` | já existe | sem mudança |
| `/profissional/cadastro` | vazio, erro de campo (e-mail, senha), ocupado, **confira seu e-mail**, limite, indisponível | 202 confira seu e-mail (texto neutro da decisão 953); 422 erro de campo pelo `campo` e `motivo`; 429 limite; resto indisponível |
| `/profissional/entrar` | vazio, ocupado, dados incorretos, conta indisponível, **confirme seu e-mail**, limite, indisponível, entrou | 200 e `email_verified` entrou, redireciona; 200 e não verificado confirme seu e-mail (AD-154-03); 401 dados incorretos; 403 conta indisponível; 429 limite; resto indisponível |
| `/profissional/verificar` | sem token, pronto, ocupado, confirmado, link inválido, indisponível | 204 confirmado, com link para `/profissional-documentos` e, se não houver sessão, "Entrar"; 410 link inválido com "Pedir novo link" (formulário de e-mail que chama o reenvio); resto indisponível |
| `/profissional/recuperar` | vazio, e-mail inválido, ocupado, enviado, limite, indisponível | 202 enviado (texto igual); 429 limite; resto indisponível |
| `/profissional/redefinir` | sem token, pronto, senha fraca, ocupado, trocada, link inválido, indisponível | 204 trocada e link "Entrar"; 422 senha fraca (o token continua na memória); 410 link inválido com "Pedir nova redefinição"; resto indisponível |

Detalhes:
- O token (verificar e redefinir) segue o padrão de `acesso.js`: lido do fragmento `#t=`, removido da barra com `history.replaceState`, mantido só em variável, nenhuma chamada antes do clique ou envio, botão habilitado após ~1 s na página de verificar. Na página de redefinir não há espera: o envio exige a nova senha digitada.
- Em `/profissional/cadastro` e na redefinição, a regra da senha aparece **antes do envio** ("Mínimo de 8 caracteres.") ligada ao campo por `aria-describedby`. O servidor continua a autoridade; a tela faz só a checagem de forma (vazio, curta) para poupar chamada.
- Senha nunca volta a ser preenchida depois de erro de rede. E-mail volta.
- Mostrar/ocultar senha: botão `type="button"` com `aria-pressed`; colar permitido (WCAG 3.3.8).

### 5.2 Fluxo do profissional

```
/profissional/cadastro --202--> "Confira seu e-mail" --link do e-mail--> /profissional/verificar#t=...
        ^                              |  (Reenviar link: POST resend)           |
        |                                                                 204 --> /profissional-documentos
/profissional/entrar --200 full--> DESTINO_PROFISSIONAL
        |--200 verification_only--> "Confirme seu e-mail" (Reenviar)
        |--"Esqueci minha senha"--> /profissional/recuperar --link do e-mail--> /profissional/redefinir#t=... --204--> /profissional/entrar
```

### 5.3 Integração com a #153 e a #155

- **Contrato com a #153 (página inicial).** O topo de `index.html` deve ter exatamente `<a href="/entrar">Entrar</a>` (rótulo "Entrar"). Esta Issue **não edita** `index.html`. Se a #153 já tiver sido concluída sem esse link, o Orquestrador abre uma janela serial de uma linha em `index.html` e nenhuma das duas Issues edita o arquivo em paralelo. O refino 171 (944 A) diz "fica para a #154" e o refino 172 (950 A) diz "esta Issue coloca": a leitura que fecha os dois é "esta Issue define e testa o link; a #153 hospeda".
- **Teste de integração** (`entrada-integracao-estatico.test.ts`): lê `index.html` e exige o link. Se a #153 ainda não tiver entregado, o teste entra como `it.todo` com o motivo escrito e o Orquestrador o liga quando a #153 entrar; nunca como teste que passa sem verificar.
- **Contrato com a #155 (navegação).** (a) `<main id="conteudo">` em todas as telas novas; (b) blocos `fp:cabecalho` e `fp:rodape` vazios; (c) o item "Entrar" do cabeçalho comum aponta para `/entrar`; "Sou profissional" para `/profissional/entrar`; (d) `DESTINO_PROFISSIONAL` é a única constante a trocar quando existir a página de situação; (e) `destinoSeguro` e `?voltar=` ficam a cargo da #155 para quem a chama; (f) a #155 não duplica `entrada.css`: o cabeçalho tem CSS próprio dela.
- **Conflitos de arquivo.** Esta Issue altera: `acesso.html`, `acesso.js` (2 linhas), `codigo.html`, `vercel.json`, e cria os demais. Não toca `index.html`, `pedido*`, `tokens.css`, `codigo.js`, `codigo.css`. A #155 também mexerá em `acesso.html` e `codigo.html` (cabeçalho): ordem fixa, **#154 antes**, ou serialização pelo Orquestrador.

---

## 6. Acessibilidade (WCAG 2.2 AA, evidência por teste)

- Um `<h1>` por página; `lang="pt-BR"`; `<title>` único por tela; `<meta name="viewport">`; `<main id="conteudo">`.
- Todo campo com `<label for>`; ajuda e regra por `aria-describedby`; erro em `role="alert"` junto ao campo com `aria-invalid="true"`; resultado em `role="status"`; foco vai ao primeiro campo com erro (2.4.3, 3.3.1, 3.3.3).
- Erro nunca só por cor: texto com prefixo "Erro:" além de `--color-error-text` sobre `--color-error-background` (1.4.1, 1.4.3).
- Botão ocupado: `aria-busy="true"` e `disabled`, sem trocar o texto (4.1.3).
- Autopreenchimento e gerenciador de senhas: `autocomplete="email"` (cliente), `username` (login), `current-password`, `new-password`, `one-time-code` (código); colar liberado (3.3.7, 3.3.8).
- Foco visível com 3 px e contraste 3:1 sobre o fundo (2.4.7, 2.4.11, 2.4.13); alvos de 48 px (2.5.8).
- Reflow em 320 px sem rolagem horizontal (1.4.10); `max-width: 480px` centralizado, padding por tokens; modo escuro já vem dos tokens.
- `prefers-reduced-motion`: sem animação nova.
- A conformidade só é declarada com o resultado do axe registrado (RF-161).

---

## 7. Segurança e privacidade

| Tema | Regra e prova |
|---|---|
| Anti-enumeração | Mesmo texto para 202 do pedido de acesso, do cadastro, da recuperação e do reenvio. Login: 401 único com a mesma mensagem para senha errada, e-mail inexistente e forma inválida. Teste V compara os textos exatos (`TEXTOS.*`) para os casos. A 403 `account_unavailable` só aparece depois de senha certa. |
| Sem PII em URL | E-mail e senha só em corpo JSON. `method="post"` nos formulários. Fragmento `#t=` removido de imediato. `?voltar=` só aceita caminho da lista fixa e é ignorado se tiver `@`, `?` ou `#`. |
| Sem armazenamento | Nenhuma referência a `localStorage`, `sessionStorage`, `document.cookie`, `indexedDB` nos arquivos novos (teste estático) e conferência em runtime pelo Playwright (CA-154-24). |
| Sem log | Nenhum `console.*` e nenhum `catch` que envie dado a lugar algum (teste estático). A tela não manda telemetria. |
| Sem injeção | Só `createElement`, `textContent` e atributos fixos. Nada de `innerHTML`, `insertAdjacentHTML`, `eval`. Teste estático. |
| Rede | `credentials: 'same-origin'`, `cache: 'no-store'`, `redirect: 'error'`, `referrerPolicy: 'no-referrer'`. CSP com `connect-src 'self'`. |
| Envio duplicado | Variável `enviando` e botão desabilitado; o segundo clique não chama a rede (CA-154-04). |
| Cookie | Definido só pelo servidor (`__Host-`, 7 dias). A página não o lê. |
| Senha | `type="password"`, sem eco em mensagem, sem repreencher após erro de rede, sem enviar no 422 de e-mail (a tela não guarda a senha em objeto fora do campo). |
| E-mail só para conta cadastrada em DEV | RN-154-11/CA-154-25: conferência de configuração, sem envio real (já configurado fora desta Issue). |
| Retorno aberto | `destinoSeguro` rejeita tudo fora da lista (`//`, `http:`, `javascript:`). |

---

## 8. Provas por critério de aceite

Pasta de testes: `apps/web/tests/`. Padrão existente: `vitest` com módulo executado em `node:vm` e DOM simulado, `fetch` substituído por fake (como `acesso-page.test.ts` e `codigo-page.test.ts`); não se adiciona `jsdom` (o Dev S1 confirma se já está instalado). E2E: Playwright + axe em `apps/web/tests/e2e/` seguindo `pedido-h030.spec.ts` (páginas servidas por `route`, sem rede e sem porta; Chromium local).

| CA | Prova | Teste novo (nome) |
|---|---|---|
| 154-01 | P + estático | `entrada-integracao-estatico.test.ts` (link na inicial, ver 5.3); `entrada.spec.ts` (teclado) |
| 154-02 | V | `entrar-page.test.ts` (202 para dois e-mails: mesmo texto) |
| 154-03 | V, P | `entrar-page.test.ts` (sem chamada com e-mail inválido); `entrada.spec.ts` |
| 154-04 | V | `entrar-page.test.ts`, `profissional-acesso.test.ts` (um POST só com duplo clique) |
| 154-05 | V | `entrar-page.test.ts` (429) |
| 154-06 a 08 | V | casos de `acesso-page.test.ts` existentes mantidos; novo caso do link "Pedir novo acesso" |
| 154-09 a 12 | V | `codigo-page.test.ts` existente mantido (não é alterado) |
| 154-13 | P | `entrada.spec.ts` (links entre telas, Voltar do navegador); regra AD-154-04 |
| 154-14 | V, S | `profissional-acesso.test.ts` (401, 403, 429, 200 verificado, 200 não verificado) |
| 154-15 | V, S, P | `profissional-acesso.test.ts` (202, 422 por motivo); `profissional-link.test.ts` (verificar); ajuste por AD-154-01 |
| 154-16 | V | `profissional-acesso.test.ts` (texto neutro igual) |
| 154-17 | V, S | `profissional-acesso.test.ts` (recuperar) e `profissional-link.test.ts` (redefinir: 204, 410, 422) |
| 154-18 | P | `entrada.spec.ts` (nenhum "Google" ou "Apple" no DOM das 7 telas) |
| 154-19 | V | cada teste de tela (falha de rede, 404 e 503 com e-mail preservado e senha limpa) |
| 154-20 a 22 | P | `entrada.spec.ts` (Tab em ordem, axe WCAG 2.2 AA em 320, 768 e 1200 px) |
| 154-23 | estático | `entrada-estatico.test.ts` (sem `#hex`, sem `style=`; só `var(--...)`) mais `packages/tokens/scripts/report-contrast.mjs` com a saída colada na Issue |
| 154-24 | P + estático | `entrada.spec.ts` (URL, `localStorage`, `sessionStorage` vazios depois do fluxo); `entrada-estatico.test.ts` (sem `console`, `innerHTML`, `document.cookie`) |
| 154-25 | configuração | registro na Issue; sem envio |

Teste de serviço (S, caminho feliz via API, sem tela) só quando a #156 deixar as rotas de pé: cadastro 202, login 401 e 200, recuperação 202, pedido de acesso 202. Antes disso, a prova é V com fake e o relatório diz "S pendente de #156".

---

## 9. Fatias de Desenvolvimento (curtas, em ordem)

Cada fatia termina com `corepack pnpm --filter @fastpro/web test` e `lint` e `typecheck` verdes (saída colada na Issue). `check:hex` do repositório roda no fim.

| Fatia | Entrega | Arquivos | Provas |
|---|---|---|---|
| **S1** Base | Conferir baseline de testes do web e a instalação do Playwright/Chromium; criar `entrada.css`, `entrada-comum.js`; cabeçalhos em `vercel.json` (rotas novas e `/profissional`) | `entrada.css`, `entrada-comum.js`, `vercel.json` | `entrada-comum.test.ts` (funções puras: e-mail, motivos, espera, destino seguro, opções de rede); `vercel-entrada.test.ts` (CSP e no-store das 7 rotas); `entrada-estatico.test.ts` (hex, `style=`) |
| **S2** Cliente | `/entrar`; ajustes em `/acesso` e `/codigo` | `entrar.html`, `entrar.js`, `acesso.html`, `acesso.js` (2 linhas), `codigo.html` | `entrar-page.test.ts`; `acesso-page.test.ts` e `codigo-page.test.ts` existentes devem continuar verdes sem edição |
| **S3** Cadastro | `/profissional/cadastro` e estado "Confira seu e-mail" com reenvio | `profissional/cadastro.html`, `profissional-acesso.js` (modo `cadastro`) | `profissional-acesso.test.ts` (202, 422 por motivo, 429, 503, 404, duplo clique, senha não repreenchida) |
| **S4** Login | `/profissional/entrar` | `profissional/entrar.html`, `profissional-acesso.js` (modo `entrar`) | mesmo arquivo de teste (401, 403, 429, 200 full, 200 verification_only, falha de rede) |
| **S5** Links | `/profissional/verificar` | `profissional/verificar.html`, `profissional-link.js` (modo `verificar`) | `profissional-link.test.ts` (fragmento sai da URL, sem chamada antes do clique, 204, 410, 503) |
| **S6** Recuperação | `/profissional/recuperar` e `/profissional/redefinir` | `profissional/recuperar.html`, `profissional/redefinir.html`; ampliar `profissional-acesso.js` e `profissional-link.js` | testes das duas famílias (202 igual, 429, 204, 410, 422 mantendo o token) |
| **S7** Integração e prova de tela | Links cruzados, teste do link da inicial, Playwright com axe e teclado, 3 larguras, URL e armazenamento limpos, relatório de contraste | `entrada.spec.ts`, `entrada-integracao-estatico.test.ts` | CA-154-01, 13, 18, 20 a 24; saída de `report-contrast.mjs` |
| **S8** Serviço | Caminho feliz via API real, quando a #156 liberar | script de QA (sem tela) | CA-154-02, 09, 14, 15, 17 (S) |

Ordem sugerida: S1, S2, S3, S4, S5, S6, S7, S8. S2 a S6 só dependem de S1. Só S1 mexe em `vercel.json`.

---

## 10. Riscos

| Nº | Risco | Mitigação |
|---|---|---|
| R-1 | Líder mantém o código de 6 dígitos (954 A). A API não existe. | Seção 4.4: Issue de API separada. A #154 entrega o link e fecha o resto. |
| R-2 | Conflito de arquivos com #153 (`index.html`) e #155 (`acesso.html`, `codigo.html`). | Contrato 5.3; #154 entra antes da #155; janela serial pelo Orquestrador. |
| R-3 | API local em 404 (#156): a tela só pode ser provada com fake. | AD-154-06; S8 pendente explícito; a Issue vai a QA com a prova S marcada como pendente, nunca como feita. |
| R-4 | `__Host-fp_sess` exige `Secure` e `Path=/`: em HTTP fora de `localhost` o navegador pode recusar o cookie do login do profissional. | Testar em `localhost` ou preview HTTPS; registrar na Issue. |
| R-5 | `entrada.css` repete ~40 linhas de `codigo.css`. | Aceito (AD-154-05); unificação fica para a #127 ou a #155, com os testes de H-013 como rede. |
| R-6 | Contraste do botão primário (`#142D4E` sobre `#16A6A1`, ~4,6:1 à mão). | `report-contrast.mjs` decide; se ficar abaixo de 4,5:1, usar `--color-brand` com `--color-surface` como em `codigo.css`. |
| R-7 | Bloqueio de login por e-mail (30 s dobrando até 15 min) pode travar um profissional legítimo que errou 4 vezes. | Tela mostra o limite sem número e leva a "Esqueci minha senha"; a recuperação tem balde próprio. |
| R-8 | `Cache-Control: no-store` pode impedir a restauração de formulário pelo botão Voltar em alguns navegadores. | CA-154-13 é testado só nos links da tela; a restauração do navegador é desejável, não garantida (AD-154-04). |
| R-9 | O texto de 403 "conta indisponível" revela a existência da conta a quem tem a senha certa. | Aceito: quem sabe a senha já sabe que a conta existe. |
| R-10 | Playwright e Chromium locais podem faltar na máquina. | S1 confere `playwright install chromium`; é gratuito e fora do repositório. |

---

## 11. Dúvidas para o líder (com recomendação; nenhuma enviada ao usuário)

1. **Confirmação do e-mail do profissional por link, não por código (decisão 954).** *O que é:* a API só sabe confirmar por link. *Por que importa:* sem ajuste, a tela prometeria um código que nunca chega. *Opções:* (a) **link, sem API nova (recomendada)**; (b) manter o código e abrir Issue de API (4.4). *Destrava:* S3 e S5.
2. **Destino depois do login do profissional.** *Opções:* (a) **`/profissional-documentos` por enquanto (recomendada)**, trocado pela #155; (b) esperar a página de situação. *Destrava:* S4.
3. **Quem hospeda o link "Entrar" na inicial.** *Opções:* (a) **a #153 inclui `<a href="/entrar">Entrar</a>` e a #154 testa (recomendada)**; (b) janela serial de uma linha pelo Orquestrador. *Destrava:* S7.

Todas as três são adotáveis pelo líder pela regra de volume (não são dinheiro, jurídico, perda de dados nem credencial).

---

## 12. Fontes lidas nesta etapa

`apps/api/src/professional-route.ts`, `professional-recovery-route.ts`, `consume-route.ts`, `session-route.ts`, `challenge-request-route.ts`, `challenge-verify-route.ts`; `packages/domain/src/identity/professional-auth.ts` e `password.ts`; `apps/web/public/acesso.html`, `acesso.js`, `codigo.html`, `codigo.js`, `codigo.css`, `tokens.css`; `apps/web/vercel.json` (parcial); `apps/web/package.json`, `playwright.config.ts`, lista de `apps/web/tests`; `docs/factory/172`, `173`, `171`.
