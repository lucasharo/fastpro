# Desenho 183 — Prova ponta a ponta das telas contra a API local (Issue #157)

- **Issue:** #157 · **Workflow:** WF-03 · **Etapa:** Arquitetura · **EXEC-ID:** EXEC-ARQ2-157-20261121 (a execução anterior foi cortada por limite de uso e não gravou).
- **Entrada:** `180-REFINO-PROVA-PONTA-A-PONTA.md` (perguntas 980 a 985 ADOTADAS pelo líder, recomendação (a)), `177-DESENHO-AMBIENTE-DEV.md`, `179-ENTREGA-WEB-NAVEGACAO.md`, `scripts/dev-local.mjs`, `packages/email`, rotas em `apps/api/src`, chamadas em `apps/web/public/*.js`.
- **Natureza:** somente documento. Nenhum código, quadro, `11-DECISOES.md` ou `.env.local` alterado; nenhum valor lido ou impresso (só nomes). Sem commit.
- **Etiquetas:** `[VERIFICADO]` lido no repositório nesta rodada · `[DECISÃO]` deste desenho (adotada) · `[NÃO VERIFICADO]` precisa de prova na fatia indicada.
- **Nota de linguagem simples:** esta prova liga o site local ao banco de desenvolvimento e percorre, por chamadas diretas (sem tela), o caminho que o cliente e o profissional fazem. Só gasta e-mail da conta de teste do dono, dentro de um teto. Não imprime códigos, links, cookies nem endereços.

---

## 1. Achados que corrigem ou fecham o refino 180

| # | Achado | Efeito |
|---|---|---|
| F-1 | `[VERIFICADO]` `apps/api/src/app.ts:276` remove o prefixo com `pathname.replace(/^\/api(?=\/\|$)/, '')`, e `scripts/dev-local.mjs:71-77` já entrega `/api/*` ao mesmo handler da Vercel. **A ponte do prefixo (A-1, pergunta 981) já existe.** | Nenhuma reescrita nova. A prova chama `/api/v1/...` como a web. D-2. |
| F-2 | `[VERIFICADO]` `apps/api/src/vercel.ts:5,53-57` usa `waitUntil` de `@vercel/functions`, que lê o contexto em `globalThis[Symbol.for('@vercel/request-context')]` (`apps/api/node_modules/@vercel/functions/get-context.js:25`; `wait-until.js:31` chama `getContext().waitUntil?.(p)`). No Node local não há contexto: o envio pós-resposta não acontece (R-157-03 confirmado). | Ponte única no script, sem tocar no código do produto: definir esse símbolo com um `get()` que devolve `waitUntil` próprio e guardar as promessas para aguardar. D-3. A forma exata do objeto `[NÃO VERIFICADO]` até S1. |
| F-3 | `[VERIFICADO]` `GET/PATCH/DELETE /v1/drafts/current`, `POST /v1/drafts`, `GET/PUT .../identity`, `GET .../review`, `POST .../confirm` existem (`drafts/draft-route.ts:2`; `draft-service.ts:179-283`). Lacuna 1 de A-3 fechada. | R5 é rota existente; `404` com `nao_encontrado` (sem cookie ou sem rascunho) é estado, não ausência. |
| F-4 | `[VERIFICADO]` A web usa `GET` e `PUT` nas fotos (`fotos.js:305`, `:788`), iguais aos da API (`media-route.ts:4-5`). A galeria entra junto com a mídia quando `MEDIA_UPLOAD_ENABLED=1` (`composicao.ts:357-363`). Lacunas 2 e 3 de A-3 fechadas. | R13 testa `GET /media/photos`, `PUT /media/photos/order`, `GET /media/{id}/image`, `DELETE /media/{id}`. |
| F-5 | `[VERIFICADO]` O desafio e o consumo exigem `Origin` igual a `SITE_URL` e `Content-Type: application/json`; `Sec-Fetch-Site`, se enviado, deve ser `same-origin` (`packages/domain/src/identity/consume.ts:97-108`). O cookie da etapa é `__Host-fp_ident` com `Secure` (`consume.ts:117-119`). `dev-local` já sobrepõe `SITE_URL` com `http://127.0.0.1:<porta>`. | O script envia `Origin` fixo e gerencia o cookie em memória (cliente `fetch` do Node não aplica a regra de `Secure`), resolvendo R-157-05 para esta prova. A tela em navegador está fora de escopo. |
| F-6 | `[VERIFICADO]` O e-mail do desafio traz link de uso único e código de 6 dígitos no texto (`packages/email/src/auth-renderer.ts:2,39-44`); o outbox guarda `state`, `provider`, `provider_message_id` (migração `20261111120000`, linhas 14-45), nunca o corpo. O adaptador Resend (`resend.ts:128-161`) recusa qualquer destino diferente de `RESEND_ACCOUNT_RECIPIENT` quando o remetente é `onboarding@resend.dev`, e usa `fetch` global (`transports.ts:32-37`). | Código e link só saem da mensagem do provedor (alternativa 980(a)) ou, como contingência dentro do próprio processo, da chamada de saída (D-5). |
| F-7 | `[VERIFICADO]` `POST /v1/requests` responde `503 publicacao_indisponivel` antes de tocar o banco se o provedor de geocodificação não estiver configurado (`requests/publish-route.ts:30-34`). `dev-local.mjs` não lista variáveis de mapa. **O refino 180 disse que nenhuma linha usa Mapbox; para R8 isso é falso.** | A publicação depende do geocodificador de DEV (Mapbox, uso já autorizado no DEV com a chave do `.env.local`; consumo registrado na cota). Linha de falha dedicada (seção 9, G-4). Nomes exatos das variáveis `[NÃO VERIFICADO]`: Dev lê `apps/api/src/composicao.ts`/`requests/` na S5. |
| F-8 | `[VERIFICADO]` Cota: `ops.external_quota` com `service='email'`, `period='dia_utc'`, `hard_limit=100`, `soft_limit=90`, `reserved_auth=10`; `used` conta 1 por destinatário (migração `20261111120000`, linhas 93-108 e 280-300). | A leitura do dia vem dessa tabela (`used`), não da contagem do outbox. D-8. |
| F-9 | `[VERIFICADO]` `GET /v1/professional/documents` e rotas de documento só existem com `IDENTITY_DOCS_ENABLED=1` e a chave de leitura (`IDENTITY_DOCS_READER_KEY`, já no `.env.local`, decisão 982). | Ligadas só no processo da prova (D-6). |

Não verificado e tratado nas fatias: corpos exatos de `parseDraftBody`, `parseIdentityBody`, `parseConfirmBody`, `parsePublishBody` (S5); formato do link do e-mail (S4); se o mesmo e-mail pode ser cliente e profissional ao mesmo tempo (G-7); nomes das tabelas de pedido, rascunho e mídia para a limpeza (S8); permissão de leitura da chave do Resend (S4).

---

## 2. Decisões (todas adotadas pelo arquiteto; o líder pode vetar)

| Nº | Decisão | Alternativa descartada |
|---|---|---|
| **D-1** | Um script único, `scripts/prova-ponta-a-ponta.mjs`, reexecutável, com biblioteca testável em `scripts/lib/prova-*.mjs` e testes em `scripts/__tests__/prova.test.mjs` (entram em `test:scripts`). Comandos: `corepack pnpm prova:local` (matriz completa), `prova:local -- --sem-email` (só o que não gasta e-mail), `prova:local -- --etapas=P1,P3` (subconjunto), `corepack pnpm prova:limpar`. | Vários scripts soltos (perde a ordem e o controle de cota). |
| **D-2** | Sem reescrita de prefixo nova (F-1). A prova chama `/api/v1/...`. A pergunta 981 fica sem objeto. | Aceitar dois prefixos na API (mudança de produto). |
| **D-3** | O script sobe o servidor **no mesmo processo** reutilizando `iniciar()` de `scripts/dev-local.mjs` (exporta `iniciar`), em porta própria `PROVA_PORT` (padrão `3157`, para não colidir com `pnpm dev`). Antes de `iniciar`, define em `process.env` (só no processo, o `.env.local` não muda; `loadEnvFile` não sobrescreve o que já existe): `DEV_PORT=<PROVA_PORT>`, `MEDIA_UPLOAD_ENABLED=1`, `IDENTITY_DOCS_ENABLED=1`. Define `globalThis[Symbol.for('@vercel/request-context')] = { get: () => ({ waitUntil }) }` com um `waitUntil` que guarda a promessa num conjunto; o script aguarda esse conjunto esvaziar (limite de 30 s) antes de consultar o outbox. Se a forma do objeto divergir do que `getContext` espera (S1 prova), a alternativa é chamar a rota interna do tick com `JOBS_TICK_SECRET` (nome já em `.env.example:38`). | Alterar `apps/api/src/vercel.ts` (mudança de produto) ou subir processo filho (perde o gancho do D-5). |
| **D-4** | Chamadas HTTP com `fetch` do Node e **jar de cookies em memória** (nome → valor), `Origin` igual à origem local, `Content-Type: application/json`, sem `Sec-Fetch-Site`. Cookies, tokens e códigos vivem só em variáveis; nunca vão para saída, arquivo ou erro. | `curl` (jar de arquivo e cookie `Secure` em http). |
| **D-5** | Obtenção do código e do link (pergunta 980, adotada (a)): (1) provar o envio pelo `state='enviado'` e o `provider_message_id` da linha do outbox (consulta só de leitura, sem imprimir); (2) ler a mensagem com `GET https://api.resend.com/emails/{provider_message_id}` e `RESEND_API_KEY`, extrair `link` e `code` por expressão regular **em memória** e descartar o texto; chamadas espaçadas em 600 ms e no máximo 5 tentativas em 30 s. **Contingência (adotada para quando a chave só envia e a leitura devolve 401/403/404):** o mesmo processo envolve `globalThis.fetch` (instalado antes de `iniciar`) e, só para `POST https://api.resend.com/emails`, copia `text` do corpo enviado para a memória do script antes de repassar a chamada real; o e-mail continua sendo enviado de verdade. A saída registra apenas `canal=provedor` ou `canal=captura_processo`. Rejeitados (herdados do refino): força bruta contra o hash e leitura de caixa de entrada. | Adaptador de captura que substitui o envio (contraria o envio real e muda produto). |
| **D-6** | Flags de foto e documento ligadas só no processo da prova (982 adotada (a)/(c)). Se o Storage privado ou a chave de leitura não responderem, a linha vira `FORA` com o nome da dependência (não `FALHA`). | Gravar a flag no `.env.local` (persistiria a liberação). |
| **D-7** | **Teto de e-mails (984 adotada):** no máximo 4 por execução e uma execução com e-mail por dia UTC; não inicia se `used` do dia for 70 ou mais, ou se `used + 4 > hard_limit - reserved_auth`. Sem bandeira de força (mesma política do guarda de demonstração). Orçamento fixo: **E1** desafio do cliente (código → verificação); **E2** segundo desafio do cliente (link → consumo); **E3** cadastro do profissional (verificação); **E4** recuperação de senha (reset). O reenvio de verificação (R16) é provado só sem e-mail (`422` com corpo vazio e rota existente); seu sucesso com e-mail fica fora do teto e registrado como `FORA(cota)`. Se a conta profissional já estiver verificada (login `200` sem e-mail), E3 não é gasto e a etapa vira `REAPROVEITADA`. | Mais de 4 por execução. |
| **D-8** | Cota lida de `ops.external_quota` (F-8) por consulta **somente leitura** com o cliente `pg` e `DATABASE_URL_MIGRATIONS` (mesmo executor de `packages/db/scripts`; sessão `SET TRANSACTION READ ONLY`); `pg` resolvido por `createRequire` a partir de `packages/db/package.json`. Fallback: `npx supabase db query --read-only` (CLI, nunca o MCP). Mede `used` antes e depois; o consumo da execução deve ser menor ou igual a 4. | Contar linhas do outbox (não reflete reservas nem outros testes). |
| **D-9** | Destino único: antes de qualquer chamada que envie e-mail, o script confere em memória que o corpo usa `RESEND_ACCOUNT_RECIPIENT` e que `EMAIL_PROVIDER=resend`; senão sai com código 2 sem chamar a API. | Aceitar outro destino (o adaptador recusa de qualquer forma). |
| **D-10** | **Ordem do rascunho (aviso da #159):** a prova cria o rascunho (`POST /v1/drafts`) **antes** do pedido de acesso e antes da sugestão de endereço; o desafio é pedido com o cookie do rascunho para que a identificação se ligue a ele (`draftNonceHashFromRequest` em `challenge-verify-route.ts:13`, `consume-route.ts:16`). Os corpos de rascunho ficam em **uma só tabela de contrato** no script (`CONTRATO_RASCUNHO`). Se a #159 ainda não estiver integrada, o passo falha com o código `contrato_159` e a linha sai como `PENDENTE(#159)`, não `FALHA`. | Montar o rascunho depois do login (contraria a web e a #159). |
| **D-11** | **Saída só com status e nomes.** Cada linha: `ETAPA <id> <nome_fixo> <OK\|FALHA\|FORA\|PENDENTE\|PULADA\|REAPROVEITADA> http=<código> [dep=<nome_fixo>] [codigo=<chave_fixa>]`. Os campos opcionais vêm de listas fechadas no script; nenhum texto de resposta, mensagem de exceção ou valor entra na saída. Um filtro final (`assertSaidaLimpa`) recusa a linha se ela contiver o padrão de 6 dígitos, de token (base64url ≥ 32), de e-mail, de `postgres://` ou de nome de cookie com valor. Resumo final com contagens e a cota antes/depois. Código de saída: `0` tudo `OK/FORA/REAPROVEITADA`; `1` ao menos uma `FALHA` ou `PENDENTE`; `2` pré-condição recusada (ambiente, cota, destino). | Imprimir respostas para depurar (violaria CA-157-15). |
| **D-12** | Falha de produto não se corrige nesta Issue (983 adotada (a)): vira linha `FALHA`, registro na Issue e Issue própria. Só **pontes de ambiente** (ponte do `waitUntil`, variáveis, ordem, Mapbox no DEV) se corrigem aqui. Fluxo na seção 10. | Corrigir rotas de produto aqui. |
| **D-13** | **Dados sintéticos:** todo texto livre criado pela prova leva o marcador `[PROVA-157]` e o identificador da execução; ids criados são gravados num manifesto fora do repositório (`PROVA_ESTADO_DIR`, padrão `os.tmpdir()/fastpro-prova/estado.json`, só ids e datas, sem segredo). A conta de e-mail é a do dono: **nunca é apagada**. Limpeza na seção 8. | Apagar por padrão de e-mail (apagaria dados reais). |
| **D-14** | O script recusa `APP_ENV=production`, qualquer `DATABASE_URL_*` que não seja o banco DEV do `.env.local`, e `VERCEL_ENV`; não toca Vercel, domínio, deploy nem chave de produção. | — |
| **D-15** | A matriz do refino (R1 a R25) é o registro de rotas; este desenho a fecha e a ordena em etapas P0 a P9 (seção 4). Nenhuma rota é adicionada fora do que as telas chamam (983). | — |

---

## 3. Desenho do script

```
scripts/prova-ponta-a-ponta.mjs      entrada: argumentos, sequência, saída, código de saída
scripts/lib/prova-http.mjs           cliente fetch, jar de cookies, Origin, uma tentativa por chamada
scripts/lib/prova-saida.mjs          vocabulário fechado, assertSaidaLimpa, resumo
scripts/lib/prova-cota.mjs           leitura de cota/outbox somente leitura, regra D-7
scripts/lib/prova-email.mjs          guarda de destino, leitor Resend, captura do processo, extração
scripts/lib/prova-contrato.mjs       CONTRATO_RASCUNHO, corpos de profissional, marcador, manifesto
scripts/lib/prova-limpeza.mjs        geração e execução da limpeza
scripts/__tests__/prova.test.mjs     testes sem rede
```

Sequência de `main`: (1) ler argumentos; (2) `faltantes(env)` de `dev-local` mais as variáveis da prova (nomes: `AUTH_CHALLENGE_KEY`, `DRAFT_IP_HMAC_KEY`, `REQUEST_PUBLISH_HMAC_KEY`, `DISCOVERY_CURSOR_KEY`, `EMAIL_PROVIDER`, `EMAIL_FROM`, `RESEND_API_KEY`, `RESEND_ACCOUNT_RECIPIENT`, `IDENTITY_DOCS_READER_KEY`, `DATABASE_URL_MIGRATIONS`; só presença, lista de nomes ausentes na saída) — ausentes dão código 2; (3) guarda D-9 e D-14; (4) cota D-7 (se etapas com e-mail); (5) instalar gancho de captura (D-5) e contexto `waitUntil` (D-3); (6) `iniciar()`; (7) executar as etapas; (8) aguardar promessas pendentes; (9) cota depois, resumo, fechar servidor.

Regras de cada chamada: uma tentativa; `429` espera a janela do cabeçalho de retorno (máximo 65 s) e tenta de novo uma vez (cada etapa tem no máximo 3 tentativas técnicas, regra 6 do AGENTS); erro de rede vira `FALHA codigo=rede`.

---

## 4. Matriz executável (ordem fixa)

Convenção: `h` = origem local. "Não 404" = qualquer resposta diferente de 404, salvo onde dito. Os códigos de sucesso marcados `(confirmar)` são fixados na S-correspondente lendo a rota e gravados como constantes no script.

| Etapa | Nome fixo | Chamadas (todas `/api/v1`) | Esperado | E-mail |
|---|---|---|---|---|
| **P0** | `ambiente` | Pré-condições D-7, D-9, D-14; cota antes; servidor sobe; `POST /auth/session` sem cookie | Servidor sobe; sessão sem cookie: 401, sem `Set-Cookie` (CA-157-01) | 0 |
| **P1** | `existencia_sem_email` | Corpo `{}` em todas as escritas e `GET` sem sessão nas leituras da matriz: `POST /auth/challenges`, `/auth/challenges/verify`, `/auth/challenges/consume`, `/auth/professional/register`, `/auth/professional/login`, `/auth/professional/verification/resend`, `/auth/professional/verification/confirm`, `/auth/password/recovery`, `/auth/password/reset`, `/drafts/current/confirm`, `/requests`, `/media/uploads`; `GET /drafts/current`, `/drafts/current/review`, `/drafts/current/identity`, `/requests`, `/media/photos`, `/professional/profile`, `/professional/profile/services`, `/professional/profile/area`, `/professional/verificacao`, `/professional/documents` | Nenhuma `404` por rota ausente. Escritas: `422`, `401`, `403` ou `415`. Leituras sem sessão: `401` ou `403`; `GET /drafts/current` sem cookie: `404` com chave `nao_encontrado` (estado). Exceções `FORA`: mídia e documentos se a flag não ligar. Outbox sem linha nova (consulta antes/depois) (CA-157-02) | 0 |
| **P2** | `rascunho_vazio` | `POST /drafts` (corpo mínimo do `CONTRATO_RASCUNHO`); `GET /drafts/current` | Criação `201` (confirmar) com cookie do rascunho; leitura `200` | 0 |
| **P3** | `acesso_cliente` | **E1:** `POST /auth/challenges` (e-mail da conta, com cookie do rascunho) → aguardar `enviado` → ler mensagem (D-5) → `POST /auth/challenges/verify` com código errado fixo (4xx uniforme, nunca 404) e depois com o código real → `POST /auth/session` com o cookie da etapa. **E2:** novo `POST /auth/challenges` → ler link → `POST /auth/challenges/consume` com token errado (4xx/`410`) e depois com o token real → `POST /auth/session` | Pedido `202` (confirmar), sem código/token/e-mail no corpo; outbox `enviado`; verificação `200` (confirmar) com cookie da etapa (sim/não); sessão `200` com `Set-Cookie` de sessão (sim/não); consumo `200`/`204` (confirmar) (CA-157-03 a 06) | **2** |
| **P4** | `rascunho_completo` | `GET /catalog/service-search` (um serviço da semente); `PATCH /drafts/current` (serviço, urgência, descrição com `[PROVA-157]`, endereço de teste); `PUT /drafts/current/identity` (nome e e-mail da conta); `GET /drafts/current/identity`; `GET /drafts/current/review`; `POST /drafts/current/confirm` | `200` em cada (confirmar); revisão sem endereço bruto além do contrato; confirmação `200` (CA-157-07). Sem serviço na semente: `PENDENTE(semente)` | 0 |
| **P5** | `publicacao_painel` | `POST /requests` (com `Idempotency-Key` e cookies de sessão e rascunho); repetir a mesma chave; `GET /requests`; `GET /requests?cursor=` inválido | `201` com desfecho da lista fechada, sem endereço nem coordenada no corpo; repetição idempotente (mesmo desfecho, sem segundo pedido); lista `200` com o pedido da prova; cursor inválido 4xx uniforme (CA-157-08). `503 publicacao_indisponivel` → `FALHA dep=geocodificador` (G-4) | 0 |
| **P6** | `fotos` | `POST /media/uploads` (rascunho já usado em P5 ou novo rascunho de prova); envio do arquivo gerado (PNG mínimo gerado em memória) à URL de uso único; `POST /media/{id}/finalize`; `GET /media/{id}`; `GET /media/photos`; `PUT /media/photos/order`; `GET /media/{id}/image`; `DELETE /media/{id}` | `201`, envio `2xx`, `200`, `200`, `200`, `200`, `200`, `200/204` (confirmar). Flag ou Storage fora: `FORA dep=midia`/`storage` (CA-157-09) | 0 |
| **P7** | `profissional_conta` | Login prévio (`POST /auth/professional/login`): se `200`, **reaproveitar** (pula E3). Senão: **E3** `POST /auth/professional/register` → ler link → `POST .../verification/confirm` com token errado (`410`) e real (`204`) → `POST .../login`. `POST .../verification/resend` com `{}` (`422`) | Cadastro `202` (uniforme); confirmação `204`; login `200` com cookie (sim/não) (CA-157-10, 12) | **0 ou 1** |
| **P8** | `profissional_perfil` | `PUT /professional/profile` (nome público com `[PROVA-157]`); `GET` profile; `GET/PUT` services; `GET/PUT` area; `GET /professional/verificacao`; `GET /professional/documents`; `POST /professional/documents/uploads` e `finalize` e `DELETE` se a flag ligou | `201` (`received`, `pending`); `200` nos demais; `area` `{configured:false}` aceito; `GET profile` sem número de documento; documentos sem caminho/MIME/nome; `409`/`503` em `area` é `FALHA` (CA-157-13, 14) | 0 |
| **P9** | `recuperacao_senha` | **E4** `POST /auth/password/recovery` → ler link → `POST /auth/password/reset` com token errado (`410`), com `{}` (`422`), com senha fraca (`422`), com token real e senha de prova (`204`) → `POST /auth/professional/login` com a senha nova | `202` uniforme; reset `204`; login `200` (CA-157-11). A senha de prova é gerada em memória, nunca impressa, e **não é a do dono** (a conta de prova é a profissional) | **1** |
| **P10** | `fechamento` | Cota depois; varredura da saída; manifesto gravado | Consumo de e-mail menor ou igual a 4; `corepack pnpm check:secrets` e `check:logs` fora do script, na fatia S8 (CA-157-15, 16) | 0 |

Total máximo de e-mails: E1+E2+E3+E4 = 4 (3 se P7 reaproveitar). Rotas ligadas por variável que não montarem (sem fábrica ou variável) respondem `404` em P1 e viram `FALHA dep=variavel` com o nome da primeira variável ausente da lista da composição (nunca valor).

---

## 5. Controle de cota (D-7, D-8) — regras executáveis

1. Etapas com e-mail só rodam se: `used(dia_utc) < 70` e `used + 4 <= hard_limit - reserved_auth` (hoje 100 - 10 = 90).
2. O manifesto guarda a data UTC da última execução **com e-mail**; se for hoje, recusa com código 2 (`codigo=uma_por_dia`). `--sem-email` ignora essa regra.
3. Depois da execução, `used_depois - used_antes` deve ser menor ou igual a 4; se maior, linha `FALHA codigo=cota_excedida` (outro teste pode ter enviado junto; a linha registra o fato sem culpar).
4. Cota e outbox são **somente leitura**: nunca se apaga linha de `ops.email_outbox` nem se altera `ops.external_quota` (falsearia o consumo real).
5. Depois de um `429` de e-mail ou de `state='falha'` do outbox, a prova para os passos de e-mail seguintes (`PULADA dep=cota`) em vez de reenviar.

---

## 6. Dependências e variáveis (somente nomes)

- Já no `.env.local` (informado): `EMAIL_PROVIDER`, `EMAIL_FROM`, `RESEND_ACCOUNT_RECIPIENT`, `ADMIN_BASE_URL`, `IDENTITY_DOCS_READER_KEY`, `DSR_EXTRATO_CHAVE_ASSINATURA`. Presença de todas as outras é conferida em P0 (lista de ausentes), sem imprimir valor. Ausente de chave aleatória: o Dev usa `corepack pnpm dev:chaves` (já existe, não sobrescreve). `SUPABASE_URL`/`SUPABASE_SECRET_KEY` já são obrigatórias em `dev-local.mjs` (A-2 do refino fechada).
- Mapbox: nomes lidos na S5 (F-7); uso autorizado em DEV; a prova registra apenas "1 geocodificação" no resumo para o dono acompanhar a cota.
- Semente do catálogo: P4 consulta `service-search`; sem resultado vira `PENDENTE(semente)`.

---

## 7. Falhas esperadas por dependência

Classes: **A** ponte de ambiente (corrigida nesta Issue), **B** produto (Issue própria), **C** credencial ou serviço externo (pendência do dono ou de provedor), **D** cota ou limite.

| Ref. | Sintoma na saída | Causa provável | Classe | Fatia que trata | Ação |
|---|---|---|---|---|---|
| G-1 | P3 `enviado` não chega em 30 s; outbox `pendente` | Contexto `waitUntil` não aceito (F-2) | A | S1 | Corrigir o objeto de contexto; plano B: rota do tick com `JOBS_TICK_SECRET` |
| G-2 | P3 leitura do provedor `401/403/404` | Chave só de envio, ou conteúdo não retido | C→A | S4 | Cai na contingência D-5 (`canal=captura_processo`); registra o fato; sem pergunta |
| G-3 | P1 `404` em rota de e-mail/consumo/verificação | Variável ou fábrica ausente (composição devolve `undefined`) | A | S3 | Apontar o nome ausente (`dep=variavel`); gerar com `dev:chaves` ou obter pela CLI |
| G-4 | P5 `503 publicacao_indisponivel` | Geocodificador não configurado no DEV (F-7) | A/C | S5 | Expor as variáveis de mapa só no processo da prova; se faltar chave, pendência do dono (sem bloquear P6 a P10) |
| G-5 | P4 `contrato_159` ou erro 422 em `PATCH`/`PUT identity` | Contrato do rascunho em mudança (#159) | B | S5 | `PENDENTE(#159)`; reexecutar após a integração da #159; não corrigir aqui |
| G-6 | P1 `404` em fotos/documentos | Flag não ligou ou itens da mídia incompletos (nomes na composição) | A/C | S6 | `FORA dep=midia`; se for só no processo, conferir D-6; pendência do dono para Storage |
| G-7 | P7 cadastro `202` sem e-mail nem conta (mesmo e-mail já é cliente) | Regra de unicidade de e-mail entre papéis `[NÃO VERIFICADO]` | B | S7 | Registrar `FALHA dep=conflito_papel`; Issue própria; E3 não é regasto (não gasta e-mail extra) |
| G-8 | Qualquer etapa `429` | Limite por IP-HMAC em execuções repetidas | D | S3 | Esperar a janela; reduzir tentativas; nunca burlar limite |
| G-9 | P0 recusa por cota ou "uma por dia" | Cota do dia, ou execução já feita | D | S3 | Repetir só `--sem-email` ou esperar o dia UTC seguinte |
| G-10 | P4 `PENDENTE(semente)` | Catálogo não carregado no DEV | C | S5 | Carga da semente pela CLI (fora desta Issue) |
| G-11 | P6 envio à URL de uso único falha | Storage privado do DEV sem bucket ou política | C | S6 | `FORA dep=storage`; pendência do dono |
| G-12 | P8 `GET /professional/documents` `200` com campo proibido | Vazamento de metadado (CA-157-14) | B | S7 | `FALHA`; Issue própria; prioridade alta |
| G-13 | P2 `GET /drafts/current` `404` mesmo com cookie | Cookie `__Host-fp_draft` não repassado pelo jar | A | S2 | Corrigir o jar (D-4) |

---

## 8. Dados sintéticos: identificação e limpeza (D-13)

Identificação: (a) todo texto livre leva `[PROVA-157]`; (b) o manifesto guarda os ids do rascunho, do pedido, das fotos e do perfil profissional criados na execução; (c) a conta (e-mail e usuário) é do dono e fica.

`corepack pnpm prova:limpar`:
1. Recusa fora do banco DEV e com `APP_ENV=production` (mesmo guarda de D-14); sem bandeira de força.
2. Lê o manifesto; sem ele, só atua sobre linhas com o marcador `[PROVA-157]`, e imprime só contagens por tabela.
3. Remove, nesta ordem: fotos (objetos do Storage pela API do próprio produto, `DELETE /media/{id}`, e linhas), pedido de prova, rascunhos de prova, serviços e área do perfil profissional de prova. O perfil profissional e a conta **permanecem** (reaproveitados nas execuções seguintes e necessários para login); só o texto sintético do perfil volta a um valor neutro, se o contrato permitir.
4. Aplica com `npx supabase db query` (CLI, sem MCP, sem Docker) com SQL gerado por ids do manifesto e filtro `[PROVA-157]`; nomes e ordem das tabelas (pedido, rascunho, mídia) são levantados pelo Dev nas migrações na S8 `[NÃO VERIFICADO]`, e reaproveitam o padrão do guarda de demonstração do repositório se existir.
5. **Não** apaga `ops.email_outbox`, `ops.external_quota`, sessões nem desafios (histórico e consumo real); eles expiram sozinhos.
6. Prova: contagem de linhas com o marcador antes (`n`) e depois (`0`); segunda execução imprime `nada a limpar`, código `0` (idempotente).

---

## 9. Fatias de Dev (curtas, cada uma com prova)

Todas na branch `feature/init`, com comandos na raiz, saída local registrada na Issue (comando, contagem, código de saída). Cada fatia termina verde antes da próxima. Nenhuma etapa com e-mail roda antes da S4.

**S1. Ponte local (D-3).** Exportar `iniciar` já existe; criar `scripts/lib/prova-ponte.mjs` com o contexto de `waitUntil` e a ligação das flags no processo. Prova: teste unitário que instala o contexto e verifica que `waitUntil` de `@vercel/functions` guarda e executa a promessa (`corepack pnpm test:scripts` → `0`); subir o servidor de prova e `POST /api/v1/auth/session` sem cookie → diferente de `404` e sem `Set-Cookie`.

**S2. Biblioteca pura e testes.** `prova-http` (jar, `Origin`), `prova-saida` (vocabulário fechado, `assertSaidaLimpa`), `prova-cota` (regra D-7), `prova-email` (guarda D-9, extração por regex sobre texto fictício), `prova-contrato`. Prova: `corepack pnpm test:scripts` → `0`, com testes de: destino diferente recusado, linha com 6 dígitos/token/e-mail recusada, cota 69/70/87 (70 recusa, 69 aceita só se `+4 <= 90`), jar guarda e devolve cookie `__Host-` e remove em `Max-Age=0`.

**S3. Esqueleto e etapas P0 e P1 sem e-mail.** `scripts/prova-ponta-a-ponta.mjs`, scripts `prova:local` e `prova:limpar` no `package.json`, `.env.example` só se surgir nome novo (`PROVA_PORT`, `PROVA_ESTADO_DIR`; `check:env` → `0`). Prova: `corepack pnpm prova:local -- --sem-email --etapas=P0,P1` → linhas `OK` ou `FORA` conforme a matriz, nenhuma `404` de rota ausente, outbox sem linha nova (contagem antes = depois), código `0`; com uma variável removida de um arquivo de ambiente de teste → código `2` e só o nome na saída.

**S4. Acesso do cliente com e-mail (P2, P3).** Leitor do provedor e contingência D-5. Prova: com a cota dentro do teto, `prova:local -- --etapas=P0,P2,P3` → P3 `OK` com `canal=provedor` ou `canal=captura_processo`; outbox com 2 linhas novas `enviado`; cota usada +2; saída sem 6 dígitos/token (varredura); segunda execução no mesmo dia → código `2` `uma_por_dia`.

**S5. Rascunho, publicação e painel (P4, P5).** Ler as rotas e fixar `CONTRATO_RASCUNHO`; expor as variáveis de mapa só no processo (G-4). Pré-requisito: contrato final da #159; sem ele, as linhas saem `PENDENTE(#159)`. Prova: `prova:local -- --sem-email --etapas=P4,P5` precisa de sessão do cliente; como a sessão vive só em memória, P4 e P5 rodam na mesma execução que P3 (`--etapas=P2,P3,P4,P5`, 2 e-mails; antes de gastar, a fatia é provada com testes sem rede) → `201` e lista `200`, repetição idempotente, nenhuma ocorrência de endereço/coordenada no corpo, código `0` (ou `1` com `PENDENTE(#159)` registrado).

**S6. Fotos e documentos (P6, parte de P8).** Prova: `--etapas=P6` → `OK`, ou `FORA dep=storage` com o nome; flags só no processo (confirmar que `.env.local` não mudou: `git status --short` sem `.env.local` e `git check-ignore -v .env.local` → `0`).

**S7. Profissional (P7, P8, P9).** Prova: primeira execução gasta E3 e E4; segunda no dia seguinte reaproveita P7 (login `200`) e gasta só E4; `GET profile` sem número de documento; `reset` `204` e login com a senha nova.

**S8. Limpeza, varredura e registro (P10).** `prova:limpar`, testes e documentação de uso em `README`/`docs` do script. Prova: `prova:limpar` → contagens `n → 0`, segunda vez `nada a limpar` com `0`; `corepack pnpm check:secrets` → `0`; `corepack pnpm check:logs` → `0`; `git grep -nE "postgres(ql)?://[^[:space:]]+:[^[:space:]@]+@" -- . ":!.env.local"` → `1`; `corepack pnpm check:all` → `0`; execução completa única do dia (`prova:local`) com a tabela final e a cota antes/depois registradas na Issue; `git diff --stat` sem arquivo de Vercel, domínio ou deploy.

Cada fatia respeita 3 tentativas técnicas e 2 ciclos de correção (AGENTS, regra 6).

---

## 10. Fluxo para corrigir o que falhar

1. A linha `FALHA`/`PENDENTE` traz `dep=` e `codigo=` fixos. O Dev classifica pela tabela da seção 7 (A, B, C, D) e registra na Issue: etapa, código HTTP e classe, sem corpo.
2. **A (ponte de ambiente):** o Dev corrige no script ou em `scripts/dev-local.mjs` (arquivos de ambiente), roda `corepack pnpm test:scripts` e repete **só a etapa** (`--etapas=Pn`); se a etapa gasta e-mail e o orçamento do dia (D-7) já foi usado, a repetição espera o próximo dia UTC (não há bandeira de força).
3. **B (produto):** não se corrige nesta Issue. O Orquestrador abre Issue própria com a rota, o código observado e o esperado (sem valores), mantém a linha como `FALHA` no relatório final e **não marca a #157 como completa em silêncio**: a Issue vai a Aguardando aprovação com a lista explícita de falhas B (decisão de CONCLUIR ou BLOQUEAR é humana).
4. **C (credencial/serviço):** pendência registrada com o nome da dependência; as etapas que não dependem dela seguem (`PULADA`/`FORA` explícitos).
5. **D (cota/limite):** esperar a janela; nunca burlar, nunca aumentar o teto sem decisão.
6. Depois de duas correções sem sucesso na mesma etapa (regra 6), o Dev para e relata ao Orquestrador com a evidência local.
7. Cada rodada final registra: comando, contagem de linhas por status, cota antes/depois, código de saída. A evidência é local (sem GitHub Actions).

---

## 11. Riscos residuais e critérios de aceite cobertos

- CA-157-01/02: P0/P1 (S3). CA-157-03 a 06: P3 (S4). CA-157-07/08: P4/P5 (S5). CA-157-09: P6 (S6). CA-157-10 a 14: P7 a P9 (S7). CA-157-15: `assertSaidaLimpa` (S2) e varreduras (S8). CA-157-16: seção 5 (S2/S3). CA-157-17: D-14 e `git diff --stat` (S8).
- **Risco 1:** a forma do contexto do `waitUntil` ser diferente da suposta (F-2). Mitigação: S1 prova antes de gastar e-mail; plano B do tick.
- **Risco 2:** conta única do dono servir de cliente e de profissional (G-7). Mitigação: P7 detecta e registra sem gastar mais e-mail.
- **Risco 3:** e-mail só enviável uma vez por dia; uma correção de etapa com e-mail pode esperar o dia seguinte. Mitigação: S4, S5 e S7 são provadas em partes (testes sem rede e `--sem-email`) antes da execução completa.
- **Risco 4:** a contingência D-5 depende de o `fetch` global ser usado pelo adaptador (`transports.ts:33`, `fetchImpl = fetch` resolvido na criação; o gancho precisa estar instalado antes de `iniciar()`). Mitigação: teste unitário na S2 cria o transporte depois do gancho.
- **Risco 5:** Mapbox: consumo de geocodificação por execução (1) registrado na saída.

## 12. Perguntas ao líder

Nenhuma obrigatória. Itens adotados pelo arquiteto, vetáveis, já listados nas decisões: **D-5** (contingência de captura no processo se a chave do Resend não puder ler a mensagem), **D-7** (orçamento E1 a E4 e reenvio sem e-mail), **F-7** (publicação exige geocodificador de DEV, Mapbox já autorizado), **D-13** (a conta do dono nunca é apagada pela limpeza).

## 13. Handoff

Dev inicia pela S1 e S2 (sem rede e sem cota), depois S3; S4 é a primeira que gasta e-mail e só roda com a cota conferida. S5 aguarda a integração da #159 para P4. O Orquestrador mantém as etapas em ordem e não inicia S4 sem registrar a cota antes.
