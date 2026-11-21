# Refino #154 — Telas de entrada: cliente (link/código) e profissional (cadastro e login)

- **Issue:** #154 `[E16] Telas de entrada: cliente (link/código) e profissional (cadastro e login)` · **Workflow:** WF-03 (Feature) · **Etapa:** Product Owner · **EXEC-ID:** EXEC-PO-154-20261121
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init` · **Data:** 2026-11-21
- **Natureza:** somente documento. Nenhum código, teste, banco, quadro ou `11-DECISOES.md` foi alterado.
- **Etiquetas:** `[DECIDIDO]` decisão do dono ou do líder, com número · `[VERIFICADO]` lido no repositório ou no quadro · `[PROPOSTA]` deste refino, a validar · `[AMBIGUIDADE]` fonte conflitante ou lacuna · `[NÃO VERIFICADO]` não confirmado nesta rodada.

---

## 0. Fontes e limitações

Fontes lidas:
- `docs/factory/03-JORNADAS.md` (J1.4, J1.12, J2.1, J2.5 e variações de acesso e cadastro).
- `docs/factory/04-PRD.md` (RF-012, RF-035 a RF-041, RF-045, RF-048 a RF-050, RF-122, RF-160 a RF-164).
- `docs/factory/05-CRITERIOS-ACEITE.md` (FA-002, FA-003, FA-004, FA-029 cenários de cota, FA-034).
- `docs/factory/quadro-status.md` (seção Product Owner, linhas 66 a 75; #154 consta nessa coluna).
- `apps/web/public`: `acesso.html`, `acesso.js`, `codigo.html`, `codigo.js`, `tokens.css` (linhas 1 a 80), `pedido/revisao.html` (link oculto para `/acesso`).
- `apps/api/src`: constantes de caminho das rotas (busca por `_PATH =`).
- `docs/factory/158-REFINO-H058.md` (apenas o modelo de sumário).

Limitações `[NÃO VERIFICADO]`:
- A rota de **cadastro e de login por senha do profissional** não foi identificada pela busca de constantes de caminho. Os candidatos `professional-route.ts` e `professional-account-route.ts` não foram lidos. Bloqueia os critérios CA-154-14 e CA-154-15.
- A rota `POST /v1/auth/challenges/consume`, chamada por `acesso.js`, não apareceu nas constantes de caminho. Confirmar antes do desenvolvimento.
- Contratos de corpo e resposta de `password/recovery`, `password/reset` e `professional/verification/resend` não foram lidos.
- Testes existentes em `apps/web` (vitest/jsdom e Playwright com axe) não foram verificados. A seção 6 indica a prova a criar ou confirmar.
- O texto original da Issue #154 no GitHub não foi lido (ambiente local). O escopo foi reconstruído a partir da jornada, do PRD e do quadro.
- O quadro lista #152 (`build do web quebra`, linha 197 de `quadro-status.md`). A seção onde ela está não foi confirmada.
- Contraste de cor calculado à mão para um par de cores (ver seção 7). A medição oficial é `packages/tokens/scripts/report-contrast.mjs`, ainda não rodada.

---

## 1. Objetivo

Dar ao visitante e ao profissional telas de entrada que possam ser alcançadas a partir da página inicial e que cumpram a jornada:
- **Cliente:** pede acesso com o e-mail e entra pelo link ou pelo código de 6 dígitos enviado ao e-mail. Não cria senha.
- **Profissional:** cria conta com e-mail e senha, confirma o e-mail e entra com e-mail e senha.

Situação encontrada (verificado):
- As páginas `/acesso` e `/codigo` existem, mas nenhuma página pública aponta para elas. A busca por links `href="/acesso"` e `href="/codigo"` só encontrou um link oculto em `pedido/revisao.html`.
- A página `/acesso` não tem como pedir um novo acesso: diz "Peça um novo acesso", sem link.
- Não existe tela de entrada nem de cadastro do profissional na pasta `apps/web/public`.

---

## 2. Escopo

**Dentro desta Issue:**
- **E1.** Página `/entrar` do cliente: campo de e-mail, pedido de acesso, mensagem igual para qualquer e-mail, e link para digitar o código em `/codigo`.
- **E2.** Ajustes em `/acesso`: link "Pedir novo acesso" (que leva a `/entrar`) nos casos de link inválido, expirado ou já usado. A página hoje não carrega a folha de estilos dos tokens; passa a carregar.
- **E3.** Ajustes em `/codigo`: links "Voltar" e "Pedir novo código" (leva a `/entrar`); folha de estilos já carregada.
- **E4.** Link "Entrar" no topo da página inicial, apenas o link (ver Pergunta 950).
- **E5.** Profissional: página de entrada (e-mail e senha), página de cadastro (e-mail e senha), link "Esqueci minha senha" e confirmação do e-mail por código após o cadastro.
- **E6.** Estados e textos de cada tela (seção 4), em português simples.
- **E7.** Links entre as telas de entrada: entrada ↔ código ↔ acesso, e cliente ↔ profissional.

**Fora de escopo:**
- Login com Google ou Apple (decisão D9, pendência S-07, aplicativo móvel em #133). Não aparece nem como botão desabilitado (Pergunta 956).
- Aplicativo móvel (#131, #133).
- Navegação completa a partir da inicial (#155). Só o link de E4 entra aqui.
- Página inicial e busca de serviço (#153).
- Upload e verificação de documentos (#48, #49 e as telas `profissional-documento*`). Não são alterados.
- Login administrativo e autenticação em dois fatores do administrador.
- Regras de aceite (#72 a #76), chat (#77 a #82) e e-mails de conteúdo (#105, #106, #108).
- Criação de API nova. Esta entrega usa rotas existentes. Se faltar rota de cadastro ou de login do profissional, vira item de Arquitetura, não de Produto.
- Backup, produção, domínio e cobrança real.

---

## 3. Atores e pré-condições

- **Visitante:** pessoa sem conta, que chega pela página inicial ou pelo link do e-mail.
- **Cliente:** recebe por e-mail um link (válido por 15 minutos, usado uma vez) ou um código de 6 dígitos (também 15 minutos, uso único).
- **Profissional:** conta com e-mail e senha. Pode estar aguardando análise; a análise é feita por uma pessoa da equipe.
- **Pré-condição de ambiente:** em desenvolvimento, o e-mail só chega à conta cadastrada, pelo Resend (decisões 15 e 27; RF-122). Nenhum e-mail real sai antes do domínio verificado.

---

## 4. Fluxos e estados

### 4.1 Cliente: pedir acesso (`/entrar`, novo)

Passos: (1) abre `/entrar` pelo link da página inicial ou pelo endereço direto; (2) digita o e-mail; (3) envia; (4) vê a mensagem "Se o e-mail estiver cadastrado, enviamos um novo código." com o link "Digitar o código" (leva a `/codigo`) e a instrução "Ou abra o link que enviamos ao seu e-mail".

| Estado | O que a pessoa vê |
|---|---|
| Vazio | Título "Entrar", campo "E-mail", botão "Enviar acesso". Nenhum erro aparece antes do envio. |
| Carregando | Botão ocupado (indicado ao leitor de tela), campo preservado. Um segundo clique não envia outro pedido. |
| Enviado | Mensagem igual para e-mail cadastrado ou não (anti-enumeração). Links para `/codigo`. |
| E-mail inválido | Erro junto ao campo: "Informe um e-mail válido para pedir o código." Sem chamada de rede. |
| Muitos pedidos (limite) | "Muitos pedidos. Aguarde alguns minutos antes de pedir outro código." Botão desabilitado até a pessoa tentar de novo depois. |
| Indisponível (falha de rede ou erro do servidor) | "Não foi possível enviar agora. Tente de novo em instantes." O e-mail digitado continua no campo. |

### 4.2 Cliente: abrir o link (`/acesso`)

| Estado | O que a pessoa vê |
|---|---|
| Carregando | Botão desabilitado por cerca de 1 segundo, depois habilita. Nenhuma chamada antes do clique. |
| Pronto | "Confirme o acesso para continuar." e botão "Confirmar acesso". |
| Confirmado | "Acesso confirmado. A próxima etapa será liberada em breve." |
| Link inválido, expirado ou já usado | "Este link não pode mais ser usado. Peça um novo acesso." com link "Pedir novo acesso" (leva a `/entrar`). Sem motivo específico. |
| Sem link na address bar (página aberta sem o link) | Mesma mensagem da linha anterior; botão desabilitado. |
| Indisponível | "Não foi possível concluir o acesso agora. Peça um novo acesso em alguns minutos." |

### 4.3 Cliente: digitar o código (`/codigo`)

| Estado | O que a pessoa vê |
|---|---|
| Vazio | Campo "Código de 6 dígitos" com dica. Botão "Confirmar código" desabilitado até 6 dígitos. |
| Colado com espaços ou traços | Só os dígitos ficam no campo, até 6. |
| Confirmando | Botão ocupado e indicado ao leitor de tela. |
| Código incorreto, vencido ou já usado | Mesma mensagem para os três casos e para código inexistente: "Código incorreto ou vencido. Confira e tente de novo." Depois de 3 erros seguidos, acrescenta "Se não funcionar, peça um novo código." |
| Muitas tentativas (limite) | "Muitas tentativas. Aguarde alguns minutos e tente de novo." |
| Confirmado | "Código confirmado." e depois "Acesso confirmado. A próxima etapa será liberada em breve." |
| Indisponível | "Não foi possível confirmar agora. Tente de novo em instantes." |
| Pedir novo código | Mesmos estados de 4.1 (uniforme; limite; e-mail inválido; indisponível). |

### 4.4 Profissional: cadastro (`/profissional/cadastro`, novo)

Campos: e-mail e senha. Regra mínima de senha vem do servidor `[NÃO VERIFICADO]`; a tela mostra a regra antes do envio. Ações: "Criar conta" e link "Já tenho conta" (leva a `/profissional/entrar`).

| Estado | O que a pessoa vê |
|---|---|
| Vazio | Campos vazios, sem erro. |
| Erro de campo | Erro junto ao campo (e-mail inválido; senha fora da regra). Foco vai para o primeiro campo com erro. |
| E-mail já usado | Texto conforme Pergunta 953. Recomendação: mensagem neutra, sem confirmar se a conta existe. |
| Carregando | Botão ocupado; nenhum envio duplicado. |
| Conta criada | Vai para a confirmação do e-mail (4.4.1). Não promete data de aprovação. |
| Muitas tentativas | Mensagem de limite, como em 4.3. |
| Indisponível | "Não foi possível criar sua conta agora. Tente de novo em instantes." Dados digitados preservados, exceto a senha. |

**4.4.1 Confirmação do e-mail do profissional** (conforme Pergunta 954): campo de 6 dígitos com a mesma experiência de 4.3, na mesma tela. Ao confirmar, mostra "E-mail confirmado. Agora você pode enviar seus documentos." com link para `/profissional-documentos.html`.

### 4.5 Profissional: entrar (`/profissional/entrar`, novo)

Campos: e-mail e senha. Links: "Esqueci minha senha" (Pergunta 955) e "Criar conta" (leva a `/profissional/cadastro`).

| Estado | O que a pessoa vê |
|---|---|
| Vazio | Campos vazios. |
| Carregando | Botão ocupado. |
| Dados incorretos | "E-mail ou senha incorretos." Mesma mensagem para os dois casos, sem indicar qual campo. |
| E-mail ainda não confirmado | Leva a 4.4.1 (confirmação do e-mail) sem revelar mais que o necessário. |
| Muitas tentativas | Mensagem de limite, como em 4.3. |
| Entrou | Leva à página de situação do cadastro (`/profissional-situacao.html`). Adotado pelo refino (seção 9). |
| Indisponível | "Não foi possível entrar agora. Tente de novo em instantes." |

Sessão: 7 dias, revogável (RF-038). Não há opção "lembrar de mim" (seção 9).

---

## 5. Regras de negócio

| Ref. | Regra | Fonte |
|---|---|---|
| RN-154-01 | Entrar como cliente não cria senha. A identidade é o e-mail, confirmado pelo link ou pelo código. | RF-035; FA-002 |
| RN-154-02 | O pedido de acesso responde do mesmo jeito para e-mail cadastrado ou não cadastrado. | RF-039; FA-003 |
| RN-154-03 | Abrir o link não consome o acesso. Só a ação de confirmar na página consome. | RF-037 (D8) |
| RN-154-04 | Link e código valem 15 minutos e são de uso único. Link usado ou vencido não dá acesso e não mostra o motivo. | RF-036; RF-039 |
| RN-154-05 | Sessão de 7 dias, revogável. Pedidos e conversas aparecem só para o dono da sessão. | RF-038 |
| RN-154-06 | O token do link fica fora da barra de endereço e não vai para armazenamento local, de sessão ou cookie da tela. | Revisão de `acesso.js` (CA-H012) |
| RN-154-07 | Limites de tentativas e de pedidos mostram texto de limite, sem números internos. | RF-040; RF-039 |
| RN-154-08 | Cadastro do profissional é com e-mail e senha. Google e Apple ficam fora. | RF-045; D9 |
| RN-154-09 | A tela do profissional não promete prazo de aprovação. A análise é humana. | RF-048 (meta, não promessa) |
| RN-154-10 | Textos não mostram número de vagas, ondas ou contadores. | RF-066; RF-071 |
| RN-154-11 | Em desenvolvimento, e-mail só chega à conta cadastrada. Nenhum e-mail real sai. | Decisões 15 e 27; RF-122 |
| RN-154-12 | Pedido de link ou código tem prioridade máxima na cota de e-mail. Se a cota acabar, a resposta da tela continua igual. | RF-041; RNF-EMAIL |
| RN-154-13 | Nenhuma tela de entrada tem e-mail, telefone ou token na URL, no histórico ou no armazenamento do navegador. | RF-039; FA-030 |

---

## 6. Critérios de aceite (Given/When/Then)

Prova indicada por critério: **V** = vitest com jsdom (módulos `acesso.js`, `codigo.js` e novos módulos da tela de entrada), **P** = Playwright com axe (com teclado), **S** = teste de serviço por chamada de API (caminho feliz, conforme escopo de QA). Não há teste de tela para o caminho feliz de API.

- **CA-154-01 (entrada navegável, E4).** *Dado* um visitante na página inicial, *quando* navega só pelo teclado, *então* chega ao link "Entrar" no topo (foco visível) e o ativa para abrir `/entrar`. Prova: P.
- **CA-154-02 (pedido uniforme).** *Dado* um e-mail válido cadastrado ou não cadastrado, *quando* a pessoa envia em `/entrar`, *então* vê a mesma mensagem "Se o e-mail estiver cadastrado, enviamos um novo código." e nenhuma diferença de texto ou de tempo perceptível. Prova: V (resposta 202 simulada nos dois casos) e S.
- **CA-154-03 (e-mail inválido).** *Dado* um campo com texto sem "@", *quando* envia, *então* aparece erro junto ao campo, o foco vai ao campo e nenhuma chamada de rede acontece. Prova: V e P.
- **CA-154-04 (envio único).** *Dado* um envio em andamento, *quando* a pessoa clica de novo, *então* só um pedido é feito e o botão indica "ocupado" ao leitor de tela. Prova: V.
- **CA-154-05 (limite de pedidos).** *Dado* uma resposta de limite (429), *quando* recebida, *então* aparece "Muitos pedidos. Aguarde alguns minutos antes de pedir outro código." Prova: V.
- **CA-154-06 (link válido).** *Dado* `/acesso#t=<token>`, *quando* a página abre, *então* a barra de endereço fica em `/acesso`, nenhuma chamada é feita antes do clique e o botão habilita após cerca de 1 segundo. Prova: V (já coberto por CA-H012-01 a 03; manter) e P.
- **CA-154-07 (link expirado, usado ou inválido).** *Dado* uma confirmação recusada (400), *quando* a pessoa vê o resultado, *então* lê "Este link não pode mais ser usado. Peça um novo acesso." e o link "Pedir novo acesso" leva a `/entrar`. Prova: V e P.
- **CA-154-08 (página sem link).** *Dado* `/acesso` sem fragmento de link, *quando* abre, *então* vê a mesma mensagem da CA-154-07 e o botão fica desabilitado. Prova: V.
- **CA-154-09 (código correto).** *Dado* seis dígitos corretos em `/codigo`, *quando* confirma, *então* vê "Código confirmado." e depois "Acesso confirmado. A próxima etapa será liberada em breve." Prova: V e S.
- **CA-154-10 (código recusado sem revelar motivo).** *Dado* um código incorreto, vencido, já usado ou inexistente, *quando* confirma, *então* a mesma mensagem aparece nos quatro casos; após 3 erros seguidos, acrescenta "Se não funcionar, peça um novo código." Prova: V e S (quatro casos com a mesma resposta).
- **CA-154-11 (limite de tentativas do código).** *Dado* uma resposta de limite (429), *quando* recebida, *então* aparece "Muitas tentativas. Aguarde alguns minutos e tente de novo." Prova: V.
- **CA-154-12 (colar código).** *Dado* o texto "123 456" colado no campo, *quando* o campo é atualizado, *então* fica "123456" e o botão habilita. Prova: V.
- **CA-154-13 (saídas e voltas).** *Dado* `/acesso`, `/codigo` e `/profissional/entrar`, *quando* a pessoa usa os links, *então* consegue voltar à entrada do cliente e à página inicial sem perder o que já digitou. Prova: P.
- **CA-154-14 (login do profissional).** *Dado* e-mail ou senha incorretos, *quando* a pessoa entra, *então* lê "E-mail ou senha incorretos." sem indicar qual campo está errado. *Condicionado* à identificação da rota (seção 7). Prova: V e S.
- **CA-154-15 (cadastro do profissional).** *Dado* dados válidos, *quando* a pessoa cria a conta, *então* vai à confirmação do e-mail e nenhuma data de aprovação é prometida. *Condicionado* à rota de cadastro (seção 7) e à Pergunta 954. Prova: S e P.
- **CA-154-16 (e-mail já usado no cadastro).** *Dado* um e-mail já cadastrado, *quando* a pessoa tenta criar conta, *então* recebe o texto definido na Pergunta 953. *Condicionado* à decisão. Prova: V e S.
- **CA-154-17 (esqueci a senha).** *Dado* o link "Esqueci minha senha", *quando* a pessoa pede a redefinição com qualquer e-mail, *então* a resposta é a mesma para e-mail cadastrado ou não. *Condicionado* à Pergunta 955 e aos contratos de `password/recovery` (seção 7). Prova: V e S.
- **CA-154-18 (sem login social).** *Dado* qualquer tela de entrada, *quando* inspecionada, *então* não há botão "Entrar com Google" nem "Entrar com Apple" (ou, se a Pergunta 956 for respondida de outro modo, o texto adotado). Prova: P.
- **CA-154-19 (indisponível preserva o que foi digitado).** *Dado* uma falha de rede ou um erro do servidor, *quando* acontece, *então* aparece o texto de indisponível e o e-mail (ou os dados não sensíveis) continuam no campo. Prova: V.
- **CA-154-20 (teclado).** *Dado* as quatro telas de entrada (`/entrar`, `/acesso`, `/codigo`, `/profissional/entrar`, `/profissional/cadastro`), *quando* navegadas só pelo teclado, *então* todos os controles são alcançáveis, o foco é visível e a ordem é lógica. Prova: P.
- **CA-154-21 (leitor de tela e a11y).** *Dado* as mesmas telas, *quando* verificadas com axe nas regras WCAG 2.2 AA, *então* não há violação; cada campo tem rótulo; mensagens de erro e de estado são anunciadas (`role="alert"` ou `role="status"`). Prova: P (axe) e V (atributos). Não declarar conformidade WCAG sem essa evidência (RF-161).
- **CA-154-22 (responsivo).** *Dado* larguras de 320 px, 768 px e 1200 px, *quando* as telas abrem, *então* não há rolagem horizontal e o botão principal fica acessível sem zoom. Prova: P (checar largura do documento contra a janela).
- **CA-154-23 (tokens, sem cor fixa).** *Dado* os arquivos novos e alterados de estilo, *quando* varridos, *então* não há código de cor fixo (`#` seguido de hexadecimal) fora dos tokens; o texto do botão primário e o fundo atendem contraste de 4,5:1 medido pelo script de contraste. Prova: comando de busca de texto no diff e execução de `packages/tokens/scripts/report-contrast.mjs` (registrar a saída).
- **CA-154-24 (armazenamento e URL limpos).** *Dado* o fluxo completo de cliente (pedido, link e código), *quando* termina, *então* a URL não guarda token nem e-mail, e o armazenamento local e de sessão do navegador não guarda token nem e-mail. Prova: P.
- **CA-154-25 (e-mail só para conta cadastrada).** *Dado* o ambiente de desenvolvimento, *quando* um pedido de acesso é feito com outro e-mail, *então* nenhum e-mail sai para fora da conta cadastrada. Prova: verificação de configuração e registro na Issue (sem envio real).

---

## 7. Dependências reais

| Item | Onde (verificado por busca em `apps/api/src`) | Situação |
|---|---|---|
| Pedido de link ou código do cliente | `POST /v1/auth/challenges` (`challenge-request-route.ts`, linha 9) | `[VERIFICADO]`. Corpo usado por `codigo.js`: `{email, purpose}`. |
| Confirmação do código | `POST /v1/auth/challenges/verify` (`challenge-verify-route.ts`, linha 12) | `[VERIFICADO]`. Corpo usado: `{email, code, purpose}`. |
| Consumo do link | `POST /v1/auth/challenges/consume`, chamado por `acesso.js` | `[NÃO VERIFICADO]`. Constante de caminho não encontrada. |
| Conversão do acesso em sessão | `POST /v1/auth/session` (`session-route.ts`, linha 30) | `[VERIFICADO]`. |
| Saída e saída de todas as sessões | `POST /v1/auth/logout` e `logout-all` (`session-route.ts`, linhas 31 e 32) | `[VERIFICADO]`. Não usado nesta entrega. |
| Redefinição de senha | `POST /v1/auth/password/recovery` e `/reset` (`professional-recovery-route.ts`, linhas 21 e 22) | `[VERIFICADO]` (caminho). Contrato `[NÃO VERIFICADO]`. |
| Reenvio de confirmação do profissional | `POST /v1/auth/professional/verification/resend` (`professional-recovery-route.ts`, linha 23) | `[VERIFICADO]` (caminho). Contrato `[NÃO VERIFICADO]`. |
| Dados da conta do profissional | `GET /v1/professional/me` (`professional-account-route.ts`, linha 13) | `[VERIFICADO]`. |
| Situação da verificação | `/v1/professional/verificacao` (`professional-verification-route.ts`, linha 21) | `[VERIFICADO]`. Destino após entrar. |
| Troca de senha já logado | `/v1/professional/password/change` (`professional-password-route.ts`, linha 16) | `[VERIFICADO]`. Fora de escopo. |
| **Cadastro e login por senha do profissional** | Não identificado pela busca de constantes | `[NÃO VERIFICADO]`. Bloqueia CA-154-14 e CA-154-15. Próxima ação: ler `professional-route.ts` na Arquitetura. |
| Guarda de elegibilidade | `private.professional_access_guard` (H-042; #55) | `[VERIFICADO]` no quadro e no refino de H-058. Não é usada nas telas de entrada; só exige e-mail verificado para aceitar trabalho. |
| Telas e script atuais | `acesso.html`, `acesso.js`, `codigo.html`, `codigo.js` | `[VERIFICADO]`. `acesso.html` não carrega `tokens.css` nem CSS próprio. `codigo.html` carrega ambos. |
| Links existentes | `pedido/revisao.html` (link oculto para `/acesso`); `index.html` sem link para `/acesso` ou `/codigo` | `[VERIFICADO]` por busca. |
| Telas do profissional já existentes | `profissional-documentos.html`, `profissional-situacao.js`, `profissional-perfil.js` | `[VERIFICADO]` (existem). Conteúdo não lido. |
| Tokens | `apps/web/public/tokens.css` (gerado por `@fastpro/tokens`; não editar à mão) | `[VERIFICADO]`. Botão primário: texto `#142D4E` sobre fundo `#16A6A1`; contraste calculado à mão em cerca de 4,6:1. `[NÃO VERIFICADO]` pelo script oficial. |
| Build do web | Quadro, linha 197: `#152` (`build do web quebra`) | `[AMBIGUIDADE]`. Confirmar se está resolvida antes do Desenvolvimento. |
| Fronteira com #153 e #155 | Quadro, seção Product Owner | `[VERIFICADO]`. Só o link de E4 é desta Issue. |
| Testes em `apps/web` | Não verificado | `[NÃO VERIFICADO]`. A Arquitetura confirma a configuração de vitest/jsdom e Playwright com axe. |

---

## 8. Perguntas ao líder (numeradas a partir de 950)

Cada item diz o que é, por que importa, as opções (a recomendada está marcada) e o que destrava. O líder consolida e decide; nenhuma pergunta foi enviada ao usuário.

**950. Link "Entrar" na página inicial: quem coloca?** É o botão de texto "Entrar" no topo da página inicial que leva à tela de entrada. Sem ele, a tela continua escondida, que é a reclamação atual.
- A. **(recomendada)** Esta Issue coloca só esse link. O restante da navegação fica com #155.
- B. Fica para #155. Risco: a entrada continua inalcançável pela inicial até #155 ser concluída.
- C. Sem link na inicial; só por endereço direto. Não recomendado.
- Destrava: CA-154-01.

**951. Tela de entrada do cliente.** É a página onde a pessoa digita o e-mail para receber o link ou o código. Hoje o pedido só existe dentro da página do código.
- A. **(recomendada)** Página própria `/entrar` com campo de e-mail e link "Digitar o código".
- B. Manter só `/codigo` como entrada (já tem campo de e-mail e pedido de novo código).
- C. Só link automático, sem tela de pedido. Não recomendado: não atende a quem perdeu o e-mail.
- Destrava: seção 4.1 e CA-154-02.

**952. Entrada do profissional.** É a tela de login com e-mail e senha, separada da tela de cadastro.
- A. **(recomendada)** Páginas separadas: `/profissional/entrar` e `/profissional/cadastro`, com link entre elas.
- B. Abas na mesma página.
- C. Login do profissional por código, como o cliente. Não recomendado: o cadastro já é com senha (RF-045).
- Destrava: seções 4.4 e 4.5; CA-154-14 e CA-154-15.

**953. Cadastro com e-mail que já tem conta.** É o que a tela diz quando o profissional tenta criar conta com um e-mail já usado. Dizer "já existe conta" revela quem tem cadastro no sistema.
- A. **(recomendada)** Mensagem neutra: "Se este e-mail puder ser usado, enviamos instruções para continuar." Segue a regra de não revelar contas (RF-039).
- B. "Este e-mail já tem conta. Entre ou recupere a senha." Mais claro, mas revela quem tem conta.
- C. Só mostrar erro genérico de envio. Não recomendado: confunde quem já tem conta.
- Destrava: CA-154-16.

**954. Confirmação do e-mail do profissional após o cadastro.** É o passo em que a pessoa prova que o e-mail é dela. Sem isso, a conta não pode aceitar trabalho (exigência de e-mail verificado, H-058).
- A. **(recomendada)** Código de 6 dígitos na mesma tela, igual ao do cliente.
- B. Link no e-mail, sem campo de código.
- C. Nenhuma confirmação agora. Não recomendado: a conta fica sem poder aceitar trabalho.
- Destrava: seção 4.4.1 e CA-154-15.

**955. "Esqueci minha senha" do profissional.** É a recuperação de senha por e-mail. As rotas já existem, mas a tela não.
- A. **(recomendada)** Incluir o formulário nesta Issue, usando as rotas existentes, com resposta igual para e-mail cadastrado ou não.
- B. Só o link, com a tela em outra Issue. Risco: a pessoa fica sem saída quando esquece a senha.
- C. Não incluir nada agora. Não recomendado.
- Destrava: CA-154-17.

**956. Botão de login social (Google e Apple) nas telas de entrada.** Ainda não existe na plataforma web (decisão D9, pendência S-07). Mostrar o botão sem funcionar confunde.
- A. **(recomendada)** Não mostrar.
- B. Mostrar desabilitado com o texto "Em breve".
- C. Mostrar e mandar para outra tela. Não recomendado.
- Destrava: CA-154-18.

Observação: o líder adota a recomendação em cada item se o dono não vetar, conforme a regra de volume do `AGENTS.md`. Nenhum item acima é dinheiro, jurídico, perda de dados ou credencial que só o dono cria.

---

## 9. Adotadas pelo refino (para veto; sem resposta exigida)

- **A1.** Sessão de 7 dias sem opção "lembrar de mim" (RF-038).
- **A2.** Mensagem igual para e-mail cadastrado ou não, em toda tela de pedido de acesso (RF-039).
- **A3.** Após entrar, o profissional vai para `/profissional-situacao.html`.
- **A4.** Nenhuma data de aprovação é prometida na tela do profissional (RF-048).
- **A5.** Ajuda ao cliente depois de 3 erros seguidos no código (valor já existente em `codigo.js`).
- **A6.** Textos sem jargão e sem número de vagas ou ondas (RN-154-10).
- **A7.** Nenhum e-mail real sai em desenvolvimento (RN-154-11).

---

## 10. Próximo passo

- Fronteira de E4 confirmada pela Pergunta 950 antes do Desenvolvimento.
- Arquitetura: ler `professional-route.ts` e `professional-account-route.ts` e confirmar as rotas de `[NÃO VERIFICADO]` da seção 7. Confirmar a rota de consumo do link.
- Cartão `#154` permanece em Product Owner até o líder registrar a decisão e mover o cartão, conforme a ordem de colunas.
