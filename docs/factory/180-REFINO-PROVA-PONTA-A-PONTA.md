# Refino 180 — Prova ponta a ponta das telas contra a API local (Issue #157)

- **Issue:** #157 `[E16] Prova ponta a ponta das telas contra a API local (acesso do cliente, publicação, fotos, painel, profissional)` · **Workflow:** WF-03 (Feature) · **Etapa:** Product Owner.
- **EXEC-ID:** EXEC-PO-157-20261121 (subagente Claude, registrado pelo líder; prioridade máxima do dono).
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-21.
- **Dependência:** #156 (ambiente DEV executável, script `dev`, papéis de login e chaves). Ver seção 8, R-157-13.
- **Natureza:** somente documento. Nenhum código, migração, banco, `.env.local`, quadro ou `11-DECISOES.md` foi alterado. Nenhum valor de `.env.local` foi lido ou impresso; só nomes de variáveis. Nenhum endereço de e-mail real aparece aqui (referência por nome de variável).
- **Etiquetas:** `[DECIDIDO]` decisão registrada · `[VERIFICADO]` lido no repositório nesta rodada · `[PROPOSTA]` deste refino, a validar · `[AMBIGUIDADE]` fontes conflitantes ou lacuna · `[NÃO VERIFICADO]` não confirmado nesta rodada.

---

## 0. Fontes e limitações

Fontes lidas:
- `D:\Fabrica\AGENTS.md`, `roles/factory-product-owner.md`; `docs/factory/174-REFINO-AMBIENTE-DEV.md` (somente como modelo de formato, conforme o pedido).
- Rotas da web por Grep em `apps/web/public/*.js` e `*.html` (acesso, pedido, painel, fotos, profissional).
- Rotas da API por Grep em `apps/api/src` (cabeçalhos e constantes `*_PATH`): `challenge-request-route.ts`, `challenge-verify-route.ts`, `consume-route.ts`, `session-route.ts`, `professional-recovery-route.ts`, `professional-route.ts`, `professional-profile-route.ts`, `professional-offering-route.ts`, `professional-verification-route.ts`, `identity-docs/identity-doc-route.ts`, `media/media-route.ts`, `drafts/draft-service.ts`.
- Composições lidas integralmente: `apps/api/src/challenge-request-composicao.ts`, `apps/api/src/modules/identity/consumo-link-composicao.ts`, `apps/api/src/challenge-dispatch.ts`.
- `apps/api/vercel.json` (só `maxDuration` e região; sem reescrita de prefixo).
- Grep de `email_outbox` e de cota do Resend em `docs/factory` (PRD §6.1, `08` §12, `13-VERIFICACAO-SERVICOS.md`, `14-BACKLOG` H-094).

Não lido nesta rodada `[NÃO VERIFICADO]`: corpo de `packages/db/src/challenges.ts` (linhas 146 em diante e 594 em diante, que contêm `PgChallengeStore`, `dispatchChallengeOutbox` e `ChallengeEmailProvider`); conteúdo do e-mail gerado (se traz código ou link em claro); migrações de `ops.email_outbox` (colunas `provider_message_id`, `recipient_user_id`); corpo de `session-route.ts` (validação); corpo de `challenge-verify-route.ts` e `consume-route.ts` (respostas e cookies); `EMAIL_ENV_OBRIGATORIAS` (nomes exatos em `composicao.ts`); onde está a reescrita `/api/v1` → `/v1` (não está em `apps/api/vercel.json`; não existe `vercel.json` na raiz de `D:\projetos\fastpro`); rotas de cadastro e login profissional, fotos (`/media/photos`, `/media/photos/order`, `/media/{id}/image`), identidade do rascunho e rascunho/revisão (todas chamadas pela web, sem Grep no `apps/api/src` nesta rodada); estado real do banco DEV; limites de `RATE_LIMIT_DEFAULTS`.

Limitação de fonte: a Issue #157 no GitHub não foi lida por comando de rede. O escopo foi reconstruído a partir do pedido do líder, do quadro (`docs/factory/quadro-status.md`, linha 70, descrição da #157) e do código.

Consulta de fila: `[VERIFICADO]` no quadro local (`docs/factory/quadro-status.md`), #157 está na coluna **Product Owner** (linha 70) e #156 está em **Aguardando aprovação** (linha 192), com as pendências de rotas de telas e de preview Vercel registradas na própria linha. A confirmação da fila pelo líder consta do relatório, não deste documento.

---

## 1. Problema verificado

- `[VERIFICADO]` **A web chama o prefixo `/api/v1/...`** (ex.: `acesso.js:10-12`, `codigo.js:10-12`, `fotos.js:10-13`, `pedido.js:20-25`, `profissional-link.js:14-16`, `profissional-perfil-pagina.js:83-85`). **A API declara `/v1/...`** (`session-route.ts:30`, `challenge-request-route.ts:9`, `challenge-verify-route.ts:12`, `professional-recovery-route.ts:21-23`, `professional-route.ts:4`, `professional-profile-route.ts:26`). A reescrita entre os dois não está em `apps/api/vercel.json` `[NÃO VERIFICADO]` onde ela fica (ver pergunta 981).
- `[VERIFICADO]` **Rotas ligadas por variável e fábrica injetada.** As rotas de desafio, consumo e verificação só existem se a composição recebe as variáveis e uma fábrica de cliente SQL (`challenge-request-composicao.ts:90-92`; `consumo-link-composicao.ts:123-125`). Sem isso, respondem 404.
- `[VERIFICADO]` **Envio do código depende de despacho pós-resposta.** `challenge-dispatch.ts:2-3` e `:13`: sem a primitiva `waitUntil` (existente na Vercel), o envio imediato não acontece; a mensagem fica para o job de contingência do tick (`email.send`). No servidor local (Node) essa primitiva não existe. Consequência: sem um ajuste no script `dev` ou execução do tick, o e-mail do desafio **nunca sai** no ambiente local.
- `[VERIFICADO]` **Variáveis do pedido de login e da verificação** (nomes; valores não lidos): `DATABASE_URL_APP_SYSTEM`, `AUTH_CHALLENGE_KEY`, `PEPPER_EMAIL_HMAC`, `PEPPER_CODE_HMAC`, `PEPPER_IP_HMAC`, `SITE_URL` (`challenge-request-composicao.ts:33-40`), mais `EMAIL_ENV_OBRIGATORIAS` `[NÃO VERIFICADO]` nomes exatos. Para consumo e verificação, somam-se `SUPABASE_URL` e `SUPABASE_SECRET_KEY` (`consumo-link-composicao.ts:19-28`).
- `[AMBIGUIDADE A-2]` **`SUPABASE_URL` e `SUPABASE_SECRET_KEY` não estão na lista de #156** (nem em "gerar" nem em "não gerar"). São credenciais do próprio projeto Supabase (não aleatórias). Sem elas, a rota de consumo fica 404 (`consumo-link-composicao.ts:19-28`). Tratamento proposto na seção 3, E1.
- `[VERIFICADO]` **Caminho do código de verificação marcado como PROPOSTA.** `app.ts:57` diz "PROPOSTA" para `POST /v1/auth/challenges/verify`; `consumo-link-composicao.ts:2` diz que "o desenho ainda nao fixa o caminho". A web depende desse caminho (`codigo.js:11`, `pedido.js:25`). Se o caminho mudar, a tela quebra sem erro de build.
- `[VERIFICADO]` **Flags de liberação fechadas por padrão:** `MEDIA_UPLOAD_ENABLED` com valor `1` (`media/media-composicao.ts:91`, conforme #156 refino 174, D9) e `IDENTITY_DOCS_ENABLED` com valor `1` (`identity-docs/identity-doc-montagem.ts:53`, D8). Sem elas, as rotas de foto e de documento respondem 404 uniforme, e a prova de fotos e de documentos não é possível sem decisão (pergunta 982).
- `[VERIFICADO]` **Rotas de e-mail real.** Quatro rotas enviam e-mail a partir de um formulário: `POST /v1/auth/challenges` (link ou código), `POST /v1/auth/password/recovery` (sempre 202), `POST /v1/auth/professional/verification/resend`, e o cadastro profissional (`professional-route.ts:3`, 202 uniforme; ver A-3). Cada envio consome a cota do Resend (100/dia UTC e 3.000/mês, cada destinatário conta, `04-PRD.md:356`, `13-VERIFICACAO-SERVICOS.md:12`). `resend.dev` também conta.
- `[VERIFICADO]` **Conta de teste do Resend só recebe na conta cadastrada.** Decisão do líder (adotada): envio real pelo Resend, remetente de teste e destinatário somente `RESEND_ACCOUNT_RECIPIENT` (`04-PRD.md:56`, `04-PRD.md:351`).
- `[AMBIGUIDADE A-3]` **Rotas da web e da API: quase tudo confirmado, com três lacunas.** `[VERIFICADO]` existem na API: `POST /v1/auth/professional/register` (202 uniforme) e `POST /v1/auth/professional/login` (200 com cookie; 401, 403, 429) (`professional-route.ts:3,5`); `GET /v1/drafts/current/identity` e `PUT` (`drafts/draft-service.ts:219,233`); `GET /v1/drafts/current/review` (`draft-service.ts:256`); `GET /v1/requests` (`requests/list-route.ts:17`); `POST /v1/requests` (`requests/publish-route.ts:23`). `[VERIFICADO]` fotos: `GET /v1/media/photos`, `GET /v1/media/{id}/image`, `DELETE /v1/media/{id}` e `PUT /v1/media/photos/order` existem **só com a opção `galeria`** (`media/media-route.ts:4-5`; `media/media-gallery-service.ts:110,131,219`). **Lacunas:** (1) `GET /v1/drafts/current`, usada por `inicio-logica.js:87` e `pedido.js:20`, não apareceu no Grep desta rodada `[NÃO VERIFICADO]`; (2) a web chama `POST /api/v1/media/photos` e `POST .../photos/order` (`fotos.js:10-11`), mas a API declara `GET` e `PUT`; o método da web precisa ser confirmado; (3) se a composição passa a opção `galeria` `[NÃO VERIFICADO]`. **Divergência a confirmar na Arquitetura** (pergunta 983).
- `[VERIFICADO]` **Rotas profissionais confirmadas na API:** `PUT/GET /v1/professional/profile` (`professional-profile-route.ts:3,6,26`); `GET/PUT /v1/professional/profile/services` e `/area` (`professional-offering-route.ts:2-6,28-29`); `GET /v1/professional/verificacao` e `POST .../recurso` (`professional-verification-route.ts:2-4,21-22`); `GET/POST/DELETE /v1/professional/documents...` (`identity-doc-route.ts:2-5`); `POST /v1/auth/professional/verification/confirm` (204 ou 410, `professional-route.ts:4`); `POST /v1/auth/password/reset` (204, 410, 422, `professional-recovery-route.ts:106`).
- `[VERIFICADO]` **Corpo inválido vira 422 antes de qualquer envio** (`challenge-request-route.ts:18`; `professional-recovery-route.ts:85,95,106`). Isso permite provar que a rota existe sem disparar e-mail.
- `[VERIFICADO]` **Sessão é POST e negação sem `Set-Cookie`** (`session-route.ts:2`, `:172`). Happy path exige o cookie da etapa (`__Host-fp_ident`, `session-route.ts:2`), que vem da verificação ou do consumo `[NÃO VERIFICADO]` (corpo das rotas não lido).
- `[PROPOSTA]` **Cabeçalho `Origin`.** Rotas de verificação e de profissional recusam origem inválida (`professional-verification-route.ts:4`: 403 `origem_invalida`). O curl precisa enviar `Origin` igual a `SITE_URL` `[NÃO VERIFICADO]` em todas as rotas de escrita.

---

## 2. Objetivo

Provar, por chamadas HTTP diretas (curl ou serviço, sem tela), que as rotas que as telas do site chamam respondem no ambiente local apontando para o banco DEV, com:
1. **matriz de rotas** (seção 4) com código HTTP esperado para cada uma, sem 404 de rota ausente, exceto onde a flag fechada é o comportamento esperado e documentado;
2. **caminho feliz** do acesso do cliente (pedido de desafio, verificação, consumo, sessão), do rascunho e da publicação, das fotos (se a flag for ligada), do painel de pedidos e do profissional (cadastro, perfil, verificação, documentos se a flag for ligada);
3. **correção** somente das pontes de ambiente (prefixo, injeção de fábricas, despacho do e-mail, variáveis faltantes). Rota de produto ausente vira Issue própria, não correção nesta Issue (ver pergunta 983);
4. e-mails reais somente para a conta cadastrada, dentro do teto da seção 5.4.

Ambiente: somente desenvolvimento. Nada de produção, deploy, domínio ou Vercel de produção.

---

## 3. Escopo

**E1. Variáveis e credenciais do ambiente local (`.env.local`, sem valores impressos).**
- Verificar só a presença dos nomes da matriz (seção 4, coluna "variáveis") com `Grep` que retorne apenas nomes de arquivo, nunca a linha com valor.
- Faltantes de chave aleatória: gerar pela regra de #156 (E2), só o que falta, sem sobrescrever.
- `SUPABASE_URL` e `SUPABASE_SECRET_KEY` (A-2): `[PROPOSTA]` obter pela CLI do Supabase no projeto DEV, sem MCP e sem Docker, e gravar só no `.env.local`. Se a CLI não fornecer, registrar bloqueio técnico na Issue. Não gerar valor aleatório (não funciona).
- `RESEND_API_KEY`, nome do remetente de teste e `RESEND_ACCOUNT_RECIPIENT`: já existem (decisão do líder). Nenhum valor é impresso.
- Não ligar `EMAIL_*` além do necessário para o remetente de teste. Não ligar `MAPBOX_*` (nenhuma rota desta matriz usa Mapbox; ver #156, pergunta 971).

**E2. Ponte local do prefixo (A-1 e pergunta 981).**
- `[PROPOSTA]` O script `dev` (de #156) serve a web e a API em `127.0.0.1` e reescreve `/api/v1/*` para `/v1/*`, como a produção, depois de confirmar onde a reescrita está.
- Não alterar rotas da API para aceitar dois prefixos, salvo decisão (981).

**E3. Injeção das fábricas e despacho pós-resposta no script `dev` (A-4 nova, sustenta R-157-03).**
- `[PROPOSTA]` Injetar as fábricas de cliente SQL sobre `pg` (`abrirCliente` em `challenge-request-composicao.ts:44` e `consumo-link-composicao.ts:101`) usando `DATABASE_URL_APP_SYSTEM` e `DATABASE_URL_APP_API`.
- `[PROPOSTA]` Fornecer uma primitiva `waitUntil` local (promessa solta com tratamento de erro) para que o envio do desafio saia na hora, sem depender do tick. A alternativa é executar o job de contingência do tick por rota interna com `JOBS_TICK_SECRET`; é mais trabalho e fica para a Arquitetura.

**E4. Matriz de rotas sem 404 de rota ausente (CA-157-02).** Teste de existência com corpo `{}` (ou sem corpo), que cai em 422 antes de qualquer envio. Quando a rota exige sessão, a resposta esperada é 401 ou 403, nunca 404.

**E5. Caminho feliz com e-mail real (CA-157-03 a CA-157-07, CA-157-11 a CA-157-13).** Uma execução, no máximo quatro e-mails (seção 5.4). Confirmação do desafio pela alternativa escolhida em 980 (seção 5.3).

**E6. Evidências.** Para cada linha da matriz: comando, código HTTP impresso por `curl -s -o <arquivo> -w "%{http_code}"`, o arquivo de corpo fora do repositório e sem código ou token. Registro na Issue (comando, contagem e código de saída). Nada disso vai para o repositório.

---

## 4. Matriz de rotas

Convenção: `P` = prefixo da web `/api/v1`; a API responde em `/v1` após a ponte (E2). "Esperado" é o código de uma execução feliz. "Variáveis" são nomes. "E-mail" = envia e-mail real (consome cota). "Confirmado" = verificado nesta rodada na API.

| # | Rota (método) | Pré-condição | Esperado (happy path) | Variáveis (nomes) | E-mail | Confirmado |
|---|---|---|---|---|---|---|
| R1 | `POST /v1/auth/session` | Sem cookie | Diferente de 404; sem `Set-Cookie` (negação) | `DATABASE_URL_APP_SYSTEM`, `SITE_URL` | não | Sim (`session-route.ts:30,172`) |
| R2 | `POST /v1/auth/challenges` | Corpo válido com e-mail da conta cadastrada | 202 (confirmar); e-mail em `ops.email_outbox` com estado `enviado` | `AUTH_CHALLENGE_KEY`, `PEPPER_EMAIL_HMAC`, `PEPPER_CODE_HMAC`, `PEPPER_IP_HMAC`, `SITE_URL`, `DATABASE_URL_APP_SYSTEM`, variáveis de e-mail | **sim (1)** | Sim (`challenge-request-route.ts:9`) |
| R3 | `POST /v1/auth/challenges/verify` | Código do e-mail de R2 | 200 ou 204 (confirmar) com cookie da etapa; código errado: 4xx uniforme, não 404 | mesmas de R2 + `SUPABASE_*` se consumir | não | Sim, caminho marcado PROPOSTA (`app.ts:57`) |
| R4 | `POST /v1/auth/challenges/consume` | Token do link de R2 | 200 ou 204 (confirmar); token inválido: 410 ou 4xx uniforme | `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, mesmas de R3 | não | Sim (`consumo-link-composicao.ts:19-28`) |
| R5 | `GET /v1/drafts/current` (`P`: `/api/v1/drafts/current`) | Sessão de R3/R4 | 200 com rascunho, ou 404 com corpo JSON `nao_encontrado` (estado "sem rascunho", não rota ausente) | `DATABASE_URL_APP_API` | não | **Não** (`inicio-logica.js:87`) |
| R6 | `GET /v1/drafts/current/review` | Rascunho completo | 200 | `DATABASE_URL_APP_API` | não | Sim (`draft-service.ts:256`); web `pedido-revisao.js:17` |
| R7 | `POST /v1/drafts/current/confirm` | Rascunho completo | 200 (confirmação) | `DATABASE_URL_APP_API`, constantes de `drafts/compose.ts` | não | Sim, método (`draft-service.ts:283`) |
| R8 | `POST /v1/requests` | Rascunho confirmado e sessão | 201 com desfecho de lista fechada; sem endereço nem coordenada no corpo | `DATABASE_URL_APP_API`, `REQUEST_PUBLISH_HMAC_KEY` (`.env.example:47`) | não `[NÃO VERIFICADO]` | Sim (`publish-route.ts:23`); web `pedido-revisao.js:19` |
| R9 | `GET /v1/requests` (`P`: `/api/v1/requests`, com `?cursor=`) | Sessão do cliente | 200 com lista e cursor opcional | `DATABASE_URL_APP_API`, `DISCOVERY_CURSOR_KEY` `[NÃO VERIFICADO]` | não | Sim (`list-route.ts:17`); web `painel.js:92` |
| R10 | `POST /v1/media/uploads` | Rascunho ou pedido do dono; flag `MEDIA_UPLOAD_ENABLED=1` (982) | 201 com URL de envio de uso único; com flag fechada: 404 uniforme (esperado, documentado) | `MEDIA_UPLOAD_ENABLED`, Storage privado de DEV `[NÃO VERIFICADO]` | não | Sim (`media-route.ts:2`; `media-service.ts:96`) |
| R11 | `POST /v1/media/{id}/finalize` | Upload de R10 concluído | 200 | idem R10 | não | Sim (`media-route.ts:2`) |
| R12 | `GET /v1/media/{id}` | Foto do dono | 200 | idem R10 | não | Sim (`media-route.ts:2`) |
| R13 | `POST /v1/media/photos`, `POST /v1/media/photos/order`, `GET /v1/media/{id}/image` (`fotos.js:10-13`, `:304`) | opção `galeria` ativa (983) | Lista (`GET`), imagem (`GET .../image`) e ordem (`PUT`) em `media-gallery-service.ts`; `POST` da web a confirmar (983) | — | não | **Parcial** |
| R14 | `POST /v1/auth/professional/register` (`profissional-acesso.js:8`) | Corpo válido | 201 ou 202 (confirmar); envia e-mail de verificação | `DATABASE_URL_APP_SYSTEM`, `SITE_URL`, variáveis de e-mail | **sim (1)** | Sim (`professional-route.ts:3`: 202 uniforme) |
| R15 | `POST /v1/auth/professional/login` (`profissional-acesso.js:9`) | Conta profissional verificada | 200 ou 204 (confirmar) com cookie | `DATABASE_URL_APP_SYSTEM`, `SITE_URL` | não | Sim (`professional-route.ts:5`: 200 com cookie) |
| R16 | `POST /v1/auth/professional/verification/resend` | Conta cadastrada | 202 ou 204 (confirmar); corpo vazio: 422 | idem R14 | **sim (1)** | Sim (`professional-recovery-route.ts:23`) |
| R17 | `POST /v1/auth/professional/verification/confirm` | Token de R14 ou R16 | 204; token inválido: 410 único | idem R14 | não | Sim (`professional-route.ts:4`) |
| R18 | `POST /v1/auth/password/recovery` | Conta cadastrada | 202 sempre (resposta uniforme) | idem R14 | **sim (1)** | Sim (`professional-recovery-route.ts:21,85`) |
| R19 | `POST /v1/auth/password/reset` | Token de R18 | 204; link que não serve: 410; senha fraca: 422 | idem R14 | não | Sim (`professional-recovery-route.ts:22,106`) |
| R20 | `PUT /v1/professional/profile` | Sessão profissional | 201 `{status:"received", verification:"pending"}` | `DATABASE_URL_APP_SYSTEM`, cifra de `DATA_ENC_KEY_*` `[NÃO VERIFICADO]` | não | Sim (`professional-profile-route.ts:3`) |
| R21 | `GET /v1/professional/profile` | Sessão profissional | 200 `{publicName, slug, documentType, verification}` | idem R20 | não | Sim (`professional-profile-route.ts:6`) |
| R22 | `GET/PUT /v1/professional/profile/services` e `/area` | Sessão profissional | 200; `GET /area` com `{configured:false}` é válido | `DATABASE_URL_APP_SYSTEM` | não | Sim (`professional-offering-route.ts:2-6`) |
| R23 | `GET /v1/professional/verificacao` | Sessão profissional | 200 com `estado` e `recurso.situacao` | `DATABASE_URL_APP_SYSTEM`, `SITE_URL` | não | Sim (`professional-verification-route.ts:2`) |
| R24 | `GET /v1/professional/documents` | Sessão profissional; flag `IDENTITY_DOCS_ENABLED=1` (982) | 200 lista do dono; com flag fechada: 404 uniforme | `IDENTITY_DOCS_ENABLED`, `IDENTITY_DOCS_READER_KEY` (provedor) | não | Sim (`identity-doc-route.ts:2`) |
| R25 | `POST /v1/professional/documents/uploads`, `POST .../{id}/finalize`, `DELETE .../{id}` | idem R24 | 201, 200, 204 conforme contrato | idem R24 | não | Sim (`identity-doc-route.ts:3-5`) |

**Regra da matriz:** nenhuma linha pode retornar 404 por rota ausente. Um 404 só é aceito nas linhas com flag fechada (R10 a R12 e R24 a R25 com flag desligada) ou em `nao_encontrado` JSON de R5 (sem rascunho). Qualquer outro 404 é falha de ponte ou de rota, e vira correção ou Issue própria.

---

## 5. Critérios de aceite (Given / When / Then)

Todos são testáveis localmente, em `127.0.0.1`, com o script `dev` ativo e o banco DEV. Comandos na raiz `D:\projetos\fastpro`, Node 22 e pnpm via corepack. Corpos de arquivo ficam fora do repositório. Códigos de saída são registrados na Issue.

**Notação:** `$API` = origem local da API com a ponte (porta a definir na Arquitetura); `$SITE` = valor de `SITE_URL` (não impresso); `$CONTA` = conteúdo de `RESEND_ACCOUNT_RECIPIENT` (nunca impresso).

**CA-157-01 — Pré-condição herdada de #156.**
- **Dado** que o script `dev` está ativo e #156 passou CA-156-07 e CA-156-08,
- **Quando** `curl -s -o <arq> -w "%{http_code}" -X POST $API/api/v1/auth/session -H "Origin: $SITE"` roda,
- **Então** o código é diferente de `404` e o cabeçalho `Set-Cookie` não aparece (`curl -s -D <cab> -o /dev/null` e busca de `Set-Cookie` sem resultado).
- **Prova:** código HTTP e resultado da busca.

**CA-157-02 — Todas as rotas da matriz existem (sem 404 de rota ausente).**
- **Dado** a matriz da seção 4,
- **Quando** cada rota de escrita recebe `POST` com corpo `{}` e cada rota de leitura recebe `GET` com a sessão da prova (ou sem sessão, para ver 401/403),
- **Então** nenhuma linha responde 404 por rota ausente; rotas de escrita respondem 422 (corpo inválido), 401 ou 403 (sem sessão). Exceções: linhas com flag fechada (R10 a R12, R24 a R25) e R5 sem rascunho.
- **E** nenhum e-mail é enviado nesta etapa (corpo inválido cai em 422 antes do envio; prova: contagem de `ops.email_outbox` antes e depois sem linha nova).
- **Prova:** tabela linha a linha com código HTTP impresso e a contagem de linhas de e-mail.

**CA-157-03 — Pedido de desafio (happy path, e-mail real, conta cadastrada).**
- **Dado** que `$CONTA` é a conta cadastrada, que a cota do dia (seção 5.4) está dentro do teto e que o despacho local (E3) está ativo,
- **Quando** `POST $API/api/v1/auth/challenges` com corpo JSON `{"email":"<$CONTA>"}` (corpo fixo montado pelo script, sem imprimir o valor) e cabeçalho `Origin: $SITE`,
- **Então** a resposta é `202` (confirmar na Arquitetura), sem o código, sem o token e sem o e-mail no corpo;
- **E** existe exatamente uma linha nova em `ops.email_outbox` com destinatário da conta cadastrada e estado que chega a `enviado` em até 60 s (consulta por `dedupe_key` ou id, sem imprimir o conteúdo).
- **Prova:** código HTTP, estado final da linha e contagem `1`.

**CA-157-04 — Verificação do código (happy path).**
- **Dado** o código obtido pelo caminho escolhido em 980 (seção 5.3),
- **Quando** `POST $API/api/v1/auth/challenges/verify` com o código (corpo montado sem imprimir) e `Origin: $SITE`,
- **Então** a resposta é `200` ou `204` (confirmar), com `Set-Cookie` da etapa (`__Host-fp_ident`);
- **E** com um código errado (ex.: sequência fixa `000000` que não bate com o do e-mail), a resposta é 4xx uniforme e nunca 404.
- **Prova:** códigos HTTP das duas chamadas; presença do cookie apenas como "sim/não".

**CA-157-05 — Consumo do link (happy path alternativo).**
- **Dado** o token do link do mesmo e-mail (pela alternativa de 980),
- **Quando** `POST $API/api/v1/auth/challenges/consume` com o token,
- **Então** a resposta é `200` ou `204` (confirmar) e cria a etapa de acesso;
- **E** token inválido responde 410 ou 4xx uniforme.
- **Prova:** códigos HTTP. O token nunca vai para a Issue.

**CA-157-06 — Sessão ativa.**
- **Dado** a etapa de CA-157-04 ou CA-157-05 (cookie no cookie jar do curl, fora do repositório),
- **Quando** `POST $API/api/v1/auth/session` com o cookie e `Origin: $SITE`,
- **Então** a resposta é `200` com sessão de 7 dias e `Set-Cookie` de sessão (`session-route.ts:2`);
- **E** a mesma chamada sem cookie continua sem `Set-Cookie` (CA-157-01).
- **Prova:** código HTTP e presença de `Set-Cookie` como sim/não.

**CA-157-07 — Rascunho, revisão e confirmação (happy path).**
- **Dado** a sessão de CA-157-06,
- **Quando** `GET $API/api/v1/drafts/current` roda antes e depois de o rascunho ser preenchido pelo script (corpo com dados de teste fictícios, sem dado real),
- **Então** antes: `200` com rascunho ou `404` com corpo JSON `nao_encontrado` (nunca página HTML nem rota ausente);
- **E** depois: `GET .../review` responde `200`; `POST .../confirm` responde `200` (confirmar a forma do corpo na Arquitetura).
- **Prova:** códigos e a chave `code` quando `404`.

**CA-157-08 — Publicação e painel (happy path, sem e-mail).**
- **Dado** o rascunho confirmado de CA-157-07,
- **Quando** `POST $API/api/v1/requests` com o corpo do pedido,
- **Então** a resposta é `201` com desfecho da lista fechada (`pedido-logica.js:416`), sem endereço nem coordenada no corpo;
- **E** `GET $API/api/v1/requests` responde `200` com a lista do próprio cliente; `?cursor=` inválido responde 4xx uniforme.
- **Prova:** códigos, e busca no corpo por padrões de endereço e coordenada (sem resultado).

**CA-157-09 — Fotos (happy path, só com flag ligada).**
- **Dado** que a decisão 982 liga `MEDIA_UPLOAD_ENABLED=1` no `.env.local` de DEV e que o Storage privado de DEV responde,
- **Quando** `POST $API/api/v1/media/uploads` com metadados fictícios, depois `POST .../finalize` e `GET .../{id}`,
- **Então** `201` com URL de envio de uso único, depois `200` e `200`.
- **E** com a flag desligada, a mesma chamada responde 404 uniforme e a linha aparece como "fora da prova" (não como falha).
- **Prova:** códigos das duas situações. A imagem de teste é gerada pelo script; nenhuma foto real.

**CA-157-10 — Cadastro e entrada do profissional (happy path, e-mail real).**
- **Dado** que `$CONTA` é a conta cadastrada e que R14 existe (983),
- **Quando** `POST $API/api/v1/auth/professional/register` e depois `POST .../login` (com a verificação de CA-157-12),
- **Então** `201` ou `202` no cadastro (um e-mail de verificação, consumo de cota 1), e `200` ou `204` com cookie no login depois de verificado;
- **E** se a rota não existir na API, a linha vira falha registrada e Issue própria (não 404 aceito).
- **Prova:** códigos e contagem de e-mails.

**CA-157-11 — Recuperação de senha (happy path).**
- **Dado** que `$CONTA` é a conta cadastrada,
- **Quando** `POST $API/api/v1/auth/password/recovery` com `{"email":"<$CONTA>"}`,
- **Então** a resposta é `202` (sempre, uniforme) e uma linha nova em `ops.email_outbox` (consumo de cota 1);
- **E** `POST .../password/reset` com token inválido responde 410, com corpo vazio responde 422, e com token válido (980) responde 204.
- **Prova:** códigos e contagem.

**CA-157-12 — Reenvio e confirmação do profissional.**
- **Dado** uma conta profissional pendente,
- **Quando** `POST $API/api/v1/auth/professional/verification/resend` com `{"email":"<$CONTA>"}` e depois `POST .../verification/confirm` com o token (980),
- **Então** resend responde `202` ou `204` (confirmar) com consumo de cota 1, e confirm responde `204`; token inválido responde 410 único.
- **Prova:** códigos e contagem.

**CA-157-13 — Perfil e situação do profissional (happy path, sem e-mail).**
- **Dado** a sessão profissional de CA-157-10 ou de CA-157-04 com perfil já criado,
- **Quando** `PUT $API/api/v1/professional/profile` com corpo de teste, depois `GET .../profile`, `GET/PUT .../profile/services`, `GET/PUT .../profile/area` e `GET .../verificacao`,
- **Então** `201` no `PUT` (`received`, `pending`), `200` nos `GET` e `200` nas demais; `GET .../profile/area` com `{configured:false}` é aceito; `409` ou `503` em `area` é falha registrada.
- **E** `GET .../profile` nunca traz número de documento (`professional-profile-route.ts:6`).
- **Prova:** códigos e busca no corpo por padrão de documento (sem resultado).

**CA-157-14 — Documentos do profissional (só com flag ligada).**
- **Dado** a decisão 982 para `IDENTITY_DOCS_ENABLED`,
- **Quando** `GET $API/api/v1/professional/documents` roda com a sessão,
- **Então** `200` com lista do dono (sem caminho, sem tipo MIME, sem nome); com flag desligada: 404 uniforme, linha "fora da prova".
- **Prova:** código HTTP e busca por caminho de arquivo no corpo (sem resultado).

**CA-157-15 — Segurança do que é registrado.**
- **Dado** que a prova terminou,
- **Quando** o repositório e os arquivos de evidência são varridos,
- **Então** `corepack pnpm check:secrets` e `corepack pnpm check:logs` saem com código `0`;
- **E** `git grep -nE "postgres(ql)?://[^[:space:]]+:[^[:space:]@]+@" -- . ":!.env.local"` sai com código `1`;
- **E** nenhuma evidência contém o código de seis dígitos, o token de link, o cookie de sessão nem o valor de `$CONTA` (busca por padrão, sem resultado).
- **Prova:** códigos de saída e contagem zero.

**CA-157-16 — Teto de cota e de tentativas.**
- **Dado** a seção 5.4,
- **Quando** a prova começa,
- **Então** a prova lê o contador do dia UTC (`ops.external_quota` para `service='email'` se existir `[NÃO VERIFICADO]`; senão, contagem de linhas de `ops.email_outbox` do dia) e não inicia se o total do dia for maior ou igual a 70 (limiar de alerta de H-094, `14-BACKLOG.md:239`, `[PROPOSTA]` aplicado à prova);
- **E** a prova não repete a mesma rota de e-mail mais de uma vez por execução; repetição de 429 espera a janela do limite antes de nova tentativa.
- **Prova:** contador antes e depois, e número de tentativas por rota.

**CA-157-17 — Nenhuma configuração de produção.**
- **Dado** a prova concluída,
- **Quando** `git diff --stat` roda,
- **Então** nenhuma configuração de Vercel de produção, domínio ou deploy aparece; `APP_ENV` não é `production`.
- **Prova:** saída do `git diff --stat` e leitura de `APP_ENV` por condição (sem imprimir valor).

### 5.3 Confirmação do desafio sem abrir a caixa de entrada

Requisito: confirmar o código ou o link do e-mail de teste **sem ler a caixa de e-mail** (interface de correio) e **sem imprimir** o código, o link ou o token.

Fatos que restringem a escolha:
- `[VERIFICADO]` O código é guardado com função de hash (nome de dependência `pepperCode`, `challenge-request-composicao.ts:146-147` e `consumo-link-composicao.ts:157-158`). A tabela do desafio, portanto, **não tem o código em claro** `[NÃO VERIFICADO]` formato da coluna.
- `[VERIFICADO]` Na migração `supabase/migrations/20261111120000_notifications_create_pipeline.sql` (tabela `ops.email_outbox`, linhas 1 a 45) **não há coluna de corpo nem de código**; há `template`, `email_type`, `recipient_user_id` e `provider_message_id` (texto de 1 a 200). Então ler o outbox prova estado de envio e o identificador do provedor, não o código. **Não contar com o outbox para obter o código**, como sugeriu o líder; a alternativa A usa o `provider_message_id`. `[NÃO VERIFICADO]` se o corpo do desafio é guardado em outra tabela (`challenges.ts`, não lido).
- `[PROPOSTA]` A confirmação de cada desafio tem três partes: (1) prova de envio, pelo estado `enviado` do outbox (sem conteúdo); (2) obtenção do código ou do link; (3) prova de uso, pela rota de verificação ou consumo.

Alternativas para a parte (2), a decidir em 980:
- **A (recomendada)**: ler o conteúdo da mensagem pela API do provedor de e-mail, usando o identificador do envio guardado (`provider_message_id`, coluna confirmada na migração `20261111120000`), com a chave já presente no `.env.local`; o script extrai código e link **em memória**, sem imprimir, e grava só a contagem. Ponto de atenção: a chave de envio pode não ter permissão de leitura, e o provedor pode não manter o conteúdo de testes `[NÃO VERIFICADO]`. Esta é leitura do envio pelo provedor, não da caixa de entrada; ainda assim precisa de autorização do líder (980).
- **B**: não obter o código. Provar o envio (estado `enviado`) e as respostas negativas da verificação e do consumo (código errado, token errado, 4xx uniforme). O caminho feliz de código e de link fica marcado como "pendente de canal de teste". Não depende de nenhuma leitura de conteúdo.
- **C**: um adaptador de captura só em DEV, que guarda o corpo do e-mail num lugar local (mudança de código, decisão de Arquitetura). Contraria o envio real decidido pelo líder e exige nova Issue. Não recomendado nesta Issue.

**Alternativas rejeitadas (não usar):**
- Obter o código por força bruta contra o hash guardado (um milhão de combinações com a chave de hash do `.env.local`). Contorna o controle de segurança do desafio e não prova que o e-mail chegou. **Rejeitada.**
- Abrir a caixa de entrada pela interface do navegador ou por leitura da caixa do provedor de correio. Contraria a regra de QA sem interface e o pedido do líder. **Rejeitada.**

### 5.4 Cota de e-mail e teto da prova

- `[VERIFICADO]` 100 e-mails por dia (UTC) e 3.000 por mês, por destinatário, contando também `resend.dev` (`04-PRD.md:356`; `13-VERIFICACAO-SERVICOS.md:12`). A cota é compartilhada por todos os testes de DEV.
- `[PROPOSTA]` **Teto da prova:** no máximo 4 e-mails por execução completa (R2, R14, R16, R18 e os reenvios que reaproveitam o mesmo e-mail para o link de consumo, de verificação e de reset); no máximo uma execução completa por dia UTC.
- `[PROPOSTA]` **Corte:** não iniciar se o total do dia UTC for 70 ou mais (alerta de H-094), para deixar margem ao login de usuários.
- `[PROPOSTA]` **Reuso:** o mesmo e-mail serve de desafio, de consumo e de reset; a prova deve reaproveitar o token da mesma mensagem quando possível, para não gastar cota extra.
- Destinatário: somente o conteúdo de `RESEND_ACCOUNT_RECIPIENT`. Qualquer outro destinatário é recusado pelo script antes de chamar a API (regra do líder).

---

## 6. Fora de escopo

- Configuração ou deploy de Vercel (preview ou produção), domínio, cobrança real, chaves de produção.
- Envio para destinatário que não seja a conta cadastrada; domínio verificado; qualquer remetente real.
- Interruptor, flag ou tela para liberar e-mail (regra do projeto: sem interruptor).
- Backup, restauração, exportação ou cópia do banco (fora do projeto).
- Correção de rota de produto que não existe (R13, R14, R15 se ausentes): viram Issue própria, não correção aqui (pergunta 983).
- Teste de tela ou de interface (QA sem UI, só chamadas de API).
- Suíte completa de QA: fica para o fim do trabalho, conforme regra do projeto.
- Mapbox: nenhuma linha da matriz usa Mapbox.
- Credenciais criadas pelo provedor que não estejam no `.env.local`: viram pendência do dono, sem bloquear as linhas que não dependem delas.

---

## 7. Riscos

| Ref. | Risco | Mitigação |
|---|---|---|
| R-157-01 | Esgotar a cota do Resend (100/dia) em testes repetidos, bloqueando o login de usuários reais (decisão de R-34). | Teto de 4 e-mails por execução, uma execução por dia UTC, corte em 70 (5.4). |
| R-157-02 | Destinatário diferente da conta cadastrada gera erro do provedor ou gasta cota. | Script recusa qualquer destinatário que não seja `RESEND_ACCOUNT_RECIPIENT`. |
| R-157-03 | E-mail nunca sai no local, porque o envio pós-resposta depende de `waitUntil` que o Node não tem. | E3: primitiva local, ou execução do tick com `JOBS_TICK_SECRET`. CA-157-03 prova `enviado`. |
| R-157-04 | Código e link não são obtidos sem ler a caixa; o caminho feliz não é provado. | Decisão 980 (5.3). Sem decisão, a prova cobre só as respostas negativas (alternativa B). |
| R-157-05 | Cookie `__Host-` e origem: em `http://127.0.0.1` o navegador e o curl podem recusar cookie seguro, e rotas de escrita recusam origem diferente de `SITE_URL`. | `[NÃO VERIFICADO]`. Arquitetura confirma; curl envia `Origin` fixo; teste de CA-157-06 mostra o efeito. |
| R-157-06 | Caminho do código de verificação é PROPOSTA; mudança quebra a web sem erro de build. | CA-157-04 prova o caminho pela web (`codigo.js:11`) e pela API no mesmo teste. |
| R-157-07 | Lacunas entre web e API: `GET /v1/drafts/current` não confirmado (R5); método da ordem de fotos e opção `galeria` (R13). | 983; CA-157-02 mostra a ausência sem gastar cota. |
| R-157-08 | Flags de foto e documento fechadas: a prova fica incompleta sem decisão. | 982. Linhas fechadas aparecem como "fora da prova", não como falha. |
| R-157-09 | `SUPABASE_URL` e `SUPABASE_SECRET_KEY` ausentes do escopo de #156: consumo responde 404. | A-2 (seção 1): obter pela CLI e gravar no `.env.local`; registrar bloqueio se a CLI não tiver. |
| R-157-10 | Limite de pedidos por IP-HMAC (`RATE_LIMIT_DEFAULTS`) em execuções repetidas: 429. | Espera de janela entre execuções; contagem de tentativas (CA-157-16). Valores `[NÃO VERIFICADO]`. |
| R-157-11 | Dados de teste ficam no banco DEV (usuários, rascunhos, pedidos). | Permitido pela regra de DEV (dados de teste no Supabase DEV); marcador de teste no nome; sem remoção sem pedido. Não é backup. |
| R-157-12 | Semente do catálogo não carregada no DEV: busca e pedido sem serviço. | Herdado de #156 (pendência 5). Verificar contagem antes da prova. |
| R-157-13 | #157 depende de rotas e do script `dev` que a #156 deixou pendentes (preview Vercel e rotas das telas). Iniciar a prova inteira antes disso é começar parte bloqueada. | 985: só partes sem dependência (CA-157-02 com corpo inválido, leitura de R21 e R23 quando houver sessão) avançam; resto espera #156. |
| R-157-14 | Matriz diverge entre web e API (A-3). A prova pode dar "verde" para uma rota que a tela nunca chama, ou vermelho para rota que a tela chama. | Matriz da seção 4 é o registro; cada linha cita o arquivo da web e o da API. |

---

## 8. Perguntas (numeração a partir de 980; máximo 6)

Enviadas ao líder. Nenhuma pergunta vai ao usuário neste refino. Cada item traz a recomendação do líder e o que destrava.

**980. Como confirmar o código ou o link do e-mail de teste sem abrir a caixa de entrada.** O que é: a prova precisa do código de seis dígitos (ou do link) que o sistema mandou para a conta de teste, para continuar o acesso. Por que importa: sem isso, a prova só cobre o caminho de erro (código errado), não o caminho feliz.
- (a) **Recomendado:** ler o conteúdo da mensagem pela API do provedor de e-mail, usando o identificador do envio, processando em memória e sem imprimir o código. Riscos: a chave de envio pode não ter permissão de leitura, e testes podem não manter o conteúdo `[NÃO VERIFICADO]`.
- (b) Provar só o envio (estado `enviado`) e as respostas de erro; o caminho feliz de código e de link fica pendente de canal de teste.
- (c) Adaptador de captura só em DEV (mudança de código, nova Issue). Não recomendado nesta Issue.
- Destrava: CA-157-04, CA-157-05, CA-157-06, CA-157-10 a CA-157-12.

**981. Como o ambiente local atende o prefixo `/api/v1` que o site usa.** O que é: o site chama `/api/v1/...` e a API declara `/v1/...`; a ponte precisa traduzir. Por que importa: sem a ponte, toda a matriz responde 404 falso.
- (a) **Recomendado:** o script `dev` reescreve `/api/v1/*` para `/v1/*`, como a produção; antes, confirmar onde está a reescrita da produção (não está em `apps/api/vercel.json`).
- (b) A API aceita os dois prefixos (mudança de código na API).
- (c) O site fala com a API sem prefixo (mudança no site).
- Destrava: toda a matriz (seção 4).

**982. Ligar as flags de foto e de documento no DEV.** O que é: duas chaves de liberação que, quando desligadas, fazem as rotas de foto e de documento não existirem para o site. Por que importa: sem elas, a prova de fotos e documentos fica fora.
- (a) Fotos: **ligar** `MEDIA_UPLOAD_ENABLED=1` no DEV, se o Storage privado de DEV responder **(recomendado)**.
- (b) Documentos: **manter desligado** (`IDENTITY_DOCS_ENABLED` ausente) e registrar como "fora da prova", porque a chave de leitura do arquivo é criada no provedor e não existe `[recomendado]`.
- (c) Ligar os dois agora (exige a chave do provedor para documentos).
- Destrava: CA-157-09 e CA-157-14.

**983. Lacunas de rotas que a web chama.** O que é: a maior parte já existe na API (cadastro e entrada do profissional, identidade, revisão, listagem e publicação do pedido; fotos só com a opção `galeria`). Faltam confirmar: `GET /v1/drafts/current`, o método da ordem de fotos que a web usa, e se a opção `galeria` é ligada na composição. Por que importa: se a rota não existe, a tela quebra e a prova registra falha de produto, não de ambiente.
- (a) **Recomendado:** incluir todas na prova; o que não existir vira falha registrada e Issue própria. Nada de correção de produto nesta Issue.
- (b) Retirar as rotas não confirmadas da #157 e abrir Issue própria para elas agora.
- (c) Bloquear a #157 até a Arquitetura confirmar cada rota.
- Destrava: R5 a R8, R13 a R15 e CA-157-07, CA-157-08, CA-157-10.

**984. Teto de e-mails e corte diário da prova.** O que é: quantos e-mails reais a prova pode gastar por execução e por dia, somando com os outros testes de DEV. Por que importa: a cota diária é de 100 e-mails, compartilhada com o login de usuários reais.
- (a) **Recomendado:** até 4 e-mails por execução, uma execução por dia UTC, e não iniciar se o dia já tiver 70 ou mais.
- (b) Sem teto próprio; só o limite do provedor (risco de esgotar a cota e travar o login).
- (c) Até 2 e-mails por execução (corta cadastro profissional e recuperação de senha da prova).
- Destrava: CA-157-03, CA-157-10 a CA-157-12, CA-157-16.

**985. Ordem em relação à #156.** O que é: a #156 está em Aguardando aprovação com rotas de telas e preview Vercel marcadas como pendentes; a #157 está em Product Owner e depende dessas rotas. Por que importa: começar a prova completa antes disso gasta cota e tempo em rota que ainda não responde.
- (a) **Recomendado:** avançar só as partes sem dependência (matriz com corpo inválido, CA-157-02 sem e-mail; leitura de perfil e situação quando houver sessão) e deixar o envio de e-mail para depois que a #156 for entregue.
- (b) Aguardar a decisão humana de Concluído da #156 antes de qualquer etapa da #157.
- (c) Executar a matriz completa agora e aceitar falhas de ambiente como "pendentes".
- Destrava: início da execução da #157 (Arquitetura e DEV).

---

## 9. Veto (adotado pelo líder como recomendação, sem resposta exigida)

- E-mail real pelo Resend somente para `RESEND_ACCOUNT_RECIPIENT`; qualquer outro destinatário é recusado pelo script (5.4, R-157-02).
- Sem interruptor de e-mail; sem flag nova para liberar envio (regra do projeto).
- Nenhum valor de `.env.local` em documento, evidência ou chat; só nomes e contagens (CA-157-15).
- Nenhum código, token ou cookie em evidência (CA-157-15).
- Caminhos de força bruta e de caixa de entrada de navegador rejeitados (5.3).
- Teste sem interface; só chamadas de API (QA).
- Suíte completa de QA só no fim (regra do projeto).
- Sem Docker; Supabase só pela CLI `npx supabase` (nunca pelo MCP).
- Dados de teste no banco DEV são permitidos; backup fora do escopo.

---

## 10. Pendências técnicas para a Arquitetura

1. Confirmar onde fica a reescrita `/api/v1` → `/v1` e a porta local da API (A-1, 981).
2. Ler `packages/db/src/challenges.ts` (linhas de `PgChallengeStore` e `ChallengeEmailProvider`) e confirmar: se o corpo do e-mail é guardado, se `ops.email_outbox` tem `provider_message_id`, e a forma do hash do código (980).
3. Confirmar em `challenge-request-route.ts`, `challenge-verify-route.ts`, `consume-route.ts` e `session-route.ts` os códigos de sucesso e o formato dos corpos (R2 a R4, R6).
4. Confirmar `GET /v1/drafts/current` em `apps/api/src`; se a opção `galeria` é passada na composição (`media/media-route.ts:4-5`); e o método que a web usa para a ordem de fotos (`fotos.js:11`, `PUT` na API) (A-3, 983).
5. Confirmar `EMAIL_ENV_OBRIGATORIAS` (nomes exatos em `composicao.ts`) e as variáveis de e-mail da conta de teste (somente nomes).
6. Confirmar se a CLI do Supabase entrega `SUPABASE_URL` e `SUPABASE_SECRET_KEY` do projeto DEV sem imprimir (A-2), e se as duas já estão no `.env.local` (somente nomes).
7. Confirmar o comportamento de cookie `__Host-` e `Origin` em `http://127.0.0.1` (R-157-05).
8. Validar a primitiva local `waitUntil` ou a execução do tick (E3, R-157-03).
9. Confirmar que a semente do catálogo está carregada no DEV (R-157-12).

---

## 11. Resumo da matriz de decisões (para o líder)

- Adotada pelo líder (veto, seção 9): e-mail real só para a conta cadastrada; sem interruptor; só DEV.
- Pendentes de decisão: 980 (código sem caixa), 981 (prefixo), 982 (flags de foto e documento), 983 (rotas não confirmadas), 984 (teto de e-mails), 985 (ordem em relação à #156).
