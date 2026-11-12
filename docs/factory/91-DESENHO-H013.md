# H-013 — Desenho: código de 6 dígitos, nonce de navegador e anexação do rascunho

- **Issue:** #26 "[E1] Código de 6 dígitos e nonce" · **Workflow:** WF-03 (Arquitetura) · **Data:** 2026-11-12 · **Papel:** Software Architect
- **Decisão:** `APROVADO_ARQUITETURA`, com dúvidas não bloqueantes (§9). Somente documento: nenhum código, migração ou teste foi criado ou executado.
- **Rastro:** 90-REFINO-H013 (CA-01 a CA-14); 11-DECISOES rodada 22, decisões 65 a 69 (não reabertas); 74-DESENHO-H025; 86-DESENHO-H097 §7; 90-DESENHO-H030 §1.1 (contrato exigido da #26); 39-DESENHO-H011; 46-DESENHO-H012; 08 §5.1; 09 `request_draft`.
- **Código lido:** `apps/api/src/challenge-verify-route.ts`, `challenge-request-route.ts`, `consume-route.ts`, `drafts/draft-route.ts`, `drafts/draft-hash.ts`; `packages/db/src/challenges.ts` (`requestChallenge`, `verifyChallengeCode`, `PgChallengeStore`), `challenge-consume.ts`; `packages/domain/src/draft/request-draft.ts` (cookie); migrações `20261111140000` (`auth_challenge`, `consume_link`, `verify_code`), `20261111170000` (`auth_code_attempt`, `rl_check`), `20261111440000` (`request_draft`); `apps/web/public/acesso.*`, `tokens.css`, `vercel.json`.
- **Etiquetas:** `[DECIDIDO]` aprovado em documento · `[VERIFICADO]` conferido no repositório nesta data · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]` sem fonte ou depende de prova.

## 0. Situação encontrada

- `[VERIFICADO]` `private.auth_code_attempt` já devolve, no ramo `ok`, `out_challenge_id`, `out_email_enc` e `out_draft_id`, mas o adaptador `PgChallengeStore.attemptCode` descarta tudo menos `resultado` e `retryAfterSeconds`. A rota `/verify` hoje confirma o código e **não** abre a etapa de identificação nem anexa rascunho.
- `[VERIFICADO]` `auth_challenge.browser_nonce_hash` existe (64 hex, nula) e nenhuma função a grava. `POST /v1/auth/challenges` não lê cookie.
- `[VERIFICADO]` `consumeChallenge` (link) faz: consumo atômico, decifra o e-mail, `garantirConta`, `openStage`, `Set-Cookie __Host-fp_ident`. É exatamente o "mesmo passo posterior" que o código precisa (CA-11).
- `[VERIFICADO]` `request_draft` tem a chave de posse `browser_nonce_hash = SHA-256 do cookie __Host-fp_draft` (índice único parcial para rascunho vivo) e **não** tem `email`, `first_name` nem marca de confirmação. O rascunho vivo do cookie já é achado por hash, sem id.
- `[VERIFICADO]` O erro 5 do código já invalida o desafio em SQL (`attempts >= p_max_attempts`, `CHALLENGE_MAX_CODE_ATTEMPTS = 5`); o limite por e-mail (15 erros em 24 h) e por IP (50 por hora) já existe em `auth_code_attempt` (H-015). **Nada disso é reescrito**; a #26 prova o caminho HTTP completo.
- `[VERIFICADO]` As funções do desafio rodam como `app_system`; as de rascunho rodam como `app_api`; `app_system` não tem privilégio em `app.request_draft`. Logo, a anexação precisa de função `security definer` com `search_path` vazio, com `execute` para `app_system`.
- `[VERIFICADO]` 90-DESENHO-H030 §1.1 exige da #26 as colunas `first_name`, `email` e `email_verified_at` (nomes de 09) e a gravação do nome e do e-mail no rascunho. Este desenho usa exatamente esses nomes (a decisão 68 "campo de data" = `email_verified_at`).
- `[VERIFICADO]` Última migração existente: `20261112120500`; último rollback: `20261112120500_geo_expand_match_point.down.sql`. Nenhum arquivo maior, nem não rastreado, em `supabase/`.

## 1. Contratos

Todas as respostas: `Cache-Control: no-store`, `Content-Type: application/json; charset=utf-8`, sem CORS, corpo de erro com `code` fixo e sem eco da entrada.

### 1.1 Pedido de acesso — `POST /v1/auth/challenges` (alteração pequena da #107)
- `[DECIDIDO]` decisão 66: o nonce é o cookie `__Host-fp_draft`. A rota lê `Cookie`, extrai o segredo com `draftSecretFromCookie` (cookie malformado ou repetido = ausente) e calcula `browserNonceHash = SHA-256(segredo)` (hex de 64). Sem cookie: `null`.
- Corpo, status, cabeçalhos e limites da #107 **não mudam** (202 `{"status":"recebido"}`; 422 `pedido_invalido`; 429 uniforme). O corpo `draft_id` continua aceito, mas **nunca** é fonte de posse nem usado para anexar (R-10).
- `requestChallenge(deps, body, clientIp, ctx?: { browserNonceHash?: string | null })`. Depois de `resultado = 'criado'` e **antes** de `dispatch.schedule(...)`, se `browserNonceHash` não é nulo: `store.bindNonce(challengeId, browserNonceHash, nowMs)` (nova porta opcional de `ChallengeStore`, SQL `private.draft_bind_challenge`, §2.3).
- Falha em `bindNonce` **não** muda a resposta (202): registra a métrica de código fixo `nonce_vinculo_falha` e segue. Falha fecha para o lado seguro: sem nonce no desafio, nada é anexado.
- `[PROPOSTA]` Ordem importa: gravar o nonce antes do envio faz com que nenhum código chegue ao cliente de um desafio sem nonce, exceto em falha. O trabalho é igual para qualquer e-mail (cadastrado ou não); a regra de conta não cadastrada da #107 (F-1, pendente) deve manter `bindNonce` na mesma sequência (R-6).

### 1.2 Verificação do código — `POST /v1/auth/challenges/verify` `[DECIDIDO]` decisão 69
- Entrada: JSON `{ "email": string, "code": "dddddd", "purpose"?: "login" | "publish" }`, até 2.048 bytes; cabeçalho `Cookie` opcional (`__Host-fp_draft`).
- Ordem fixa `[PROPOSTA]`: (1) `checkConsumeHeaders` (Origin e Sec-Fetch-Site da `SITE_URL`, `Content-Type: application/json`) **antes** de ler o corpo, porque a rota agora abre uma etapa de identificação e emite cookie (mesmo rigor de `/consume`; 403/415 com os códigos de `checkConsumeHeaders`); (2) corpo limitado; (3) `verifyChallengeCode`. Exige ajustar os testes da #107, que hoje não enviam `Origin` (risco R-13).
- Respostas:

| Status | Corpo | Quando | Cabeçalhos extras |
|---|---|---|---|
| 200 | `{"status":"codigo_ok"}` | código certo; desafio consumido; etapa aberta | `Set-Cookie: __Host-fp_ident=…` (o mesmo `identCookieHeader` do link) |
| 422 | `{"code":"codigo_invalido"}` | errado, inexistente, expirado, usado, substituído, invalidado, formato ruim | nenhum (mesmos cabeçalhos nos seis casos) |
| 429 | corpo de `rateLimited('codigo', n)` | bloqueio por e-mail (15 erros/24 h) ou por IP (50/h) | `Retry-After` |
| 503 | `{"code":"acesso_indisponivel"}` | falha nossa depois do consumo (decifra, conta, etapa), igual ao link (D-H012-4) | nenhum |
| 403/415 | como `/consume` | Origin ou tipo inválido; nada foi lido nem consumido | nenhum |

- O 200 **não** informa se houve anexação (CA-08, D-H013-7). O corpo e os cabeçalhos são idênticos com e sem rascunho.
- Mudanças de código: `AttemptCodeInput` ganha `browserNonceHash: string | null`; `AttemptCodeResult` do ramo `ok` ganha `challengeId`, `emailEnc`, `draftId`, `attached` (booleano só para métrica); `attemptCode` chama `private.auth_code_attempt_attach` (§2.4); `VerifyChallengeDeps` ganha `access` (o subconjunto de `ConsumeDeps`: contas, etapas, decifra, segredo, id); `ChallengeHttpResponse` ganha `setCookie?`.

### 1.3 Consumo do link — `POST /v1/auth/challenges/consume` (alteração pequena da #25) `[DECIDIDO]` decisão 65
- Contrato público **igual** (200 `{"status":"identificado"}` + `Set-Cookie`; 400 `link_invalido`; 503; 413/422/403/415 como hoje). A rota passa a ler o cookie do rascunho e a repassar `browserNonceHash` a `consumeChallenge`.
- `PgConsumeRepository.consumeLink` chama `private.auth_challenge_consume_link_attach` (§2.4) no lugar de `consume_link`. A resposta não revela a anexação.

### 1.4 Função compartilhada de conclusão `[DECIDIDO]` decisões 65 e CA-11
- Extrair de `consumeChallenge` o trecho posterior ao consumo (decifra → `garantirConta` → `openStage` → `identCookieHeader`) para `concluirAcesso(deps, link, nowMs)` em `challenge-consume.ts`. O link e o código chamam a mesma função: um só caminho de conta e de etapa; o código não tem caminho próprio de sessão. A conversão da etapa em sessão continua em `POST /v1/auth/session` (H-014), chamada pela página, sem novo clique.
- A anexação é **uma só função SQL** (`private.draft_attach_challenge`, §2.2), chamada por dentro dos dois embrulhos transacionais. Não existe cópia da regra em TypeScript.
- Helper único `draftNonceHashFromRequest(req)` em `apps/api/src/drafts/draft-nonce.ts`: cookie → SHA-256 ou `null`. Usado nas três rotas (`/challenges`, `/verify`, `/consume`).

### 1.5 Identificação do rascunho — `PUT` e `GET /v1/drafts/current/identity` `[DECIDIDO]` decisão 67
- Rota nova, ao lado das de H-025 (`isDraftRoute` passa a reconhecê-la); mesma ordem fixa de H-025: Origin/Sec-Fetch-Site → Content-Type (PUT) → cookie (formato; ausente = 404 sem banco) → corpo → limite → função no banco. É o ponto que 90-DESENHO-H030 dúvida 1 pede (opção a).
- `PUT` corpo JSON até 2 KB, **só** `first_name` e `email` (outra chave: 422 `campo_desconhecido`; corpo sem chaves: 422 `vazio`):
  - `first_name`: após aparar e normalizar (NFC), 2 a 60 caracteres, só letras Unicode (`\p{L}`), espaço, apóstrofo e hífen, começando por letra; senão 422 `nome_invalido` `[PROPOSTA]`.
  - `email`: `normalizeChallengeEmail` + `EMAIL_SHAPE_RE` (as mesmas funções do pedido), até 254; senão 422 `email_invalido`.
- `PUT` 200: `{ "first_name": string, "email": string, "email_verified": boolean }`. `GET` 200: o mesmo formato; rascunho vivo sem identificação devolve `{ "first_name": null, "email": null, "email_verified": false }`. 404 (corpo e cabeçalhos iguais ao de H-025) para sem cookie, malformado, de outro navegador, vencido, descartado ou publicado. Nunca devolve `email_hmac`, `browser_nonce_hash`, `ip_hmac`.
- Efeitos do `PUT`: grava `first_name`, `email`, `email_hmac = HMAC(PEPPER_EMAIL_HMAC, email)` (o **mesmo** HMAC de `auth_challenge.email_hash`). Se o e-mail mudou: `email_verified_at = null` e, se o status era `aguardando_email`, volta a `aberto`. Se o e-mail é o mesmo: confirmação mantida.
- Limites: reaproveita os de salvamento de H-025 (60 por 60 s por rascunho, 120 por 60 s por IP-HMAC; 429 com `Retry-After`). Escrever e-mail aqui **não** envia e-mail (o envio é do `POST /challenges`, com os limites de H-015).
- Os campos `email` e `first_name` continuam **proibidos** no `PATCH /v1/drafts/current` de H-025 (422 `campo_desconhecido`), conforme 90-DESENHO-H030 linha 105.
- Fluxo da tela de pedido (#43), para registro: `PUT identity` → `POST /v1/auth/challenges` (`purpose: "publish"`, mesmo e-mail) → código em `/verify` ou link em `/consume` → `GET /v1/drafts/current/review` (da #43) lê `email_verified_at`.

## 2. Dados

### 2.1 Migração por expansão `[PROPOSTA]`
- **Arquivo:** `supabase/migrations/20261112130000_draft_expand_identity_attach.sql`. **Rollback:** `supabase/rollbacks/20261112130000_draft_expand_identity_attach.down.sql`. Número conferido nesta data (último `20261112120500`). O DEV reconfere ao começar e, se houver migração maior, renomeia o par mantendo o mesmo nome; a migração da #43 (90-DESENHO-H030 §3) deve ter prefixo maior que esta.
- **Colunas** (todas anuláveis e sem padrão: nenhuma reescrita da tabela, nenhum dado existente muda, o código antigo ignora-as): em `app.request_draft`, `first_name text`, `email text`, `email_hmac text`, `email_verified_at timestamptz`.
- **Restrições:** `first_name` com `char_length between 2 and 60`; `email` com `char_length between 3 and 254` e igual a `lower(btrim(email))`; `email_hmac ~ '^[0-9a-f]{64}$'`; `num_nulls(email, email_hmac) in (0, 2)` (andam juntos); `email_verified_at is null or email is not null`. Sem coordenada.
- **Índice:** nenhum novo (acesso sempre pela chave `browser_nonce_hash`). Postura de privilégios da tabela inalterada (RLS forçada, sem acesso direto).
- **Reversibilidade e implantação:** expansão pura. Ordem de implantação: migração → código. O código antigo continua válido com as colunas novas (nulas) e com as funções antigas (`consume_link`, `auth_code_attempt`, `draft_*`), que **não** são alteradas nem removidas. Rollback: remove as funções e restrições novas, depois as quatro colunas (perde-se só e-mail/nome/confirmação do rascunho, descartável por natureza), `delete from ops.schema_migration where version = '20261112130000'`; idempotente (`if exists`); execução manual só em desenvolvimento. Teste do rollback no padrão de `draft-rollback-h025.dbtest.mjs`.
- **Dado pessoal `[PROPOSTA]`:** `email` e `first_name` ficam em claro no rascunho (09 `request_draft` e a revisão da #43 precisam exibi-los); a tabela já tem RLS forçada e acesso só por função; o expurgo é por TTL (H-110, lacuna aceita em 74 §6). `email_hmac` existe porque a comparação com `auth_challenge.email_hash` tem de acontecer dentro do banco, na mesma transação do consumo, e o pepper nunca chega ao banco; alternativa rejeitada: decifrar `email_enc` fora do banco e comparar em TypeScript, que quebraria a atomicidade do consumo + anexação.

### 2.2 Anexação — `private.draft_attach_challenge(p_challenge_id uuid, p_cookie_hash text, p_now timestamptz) returns boolean`
`security definer`, `set search_path = ''`, `execute` só para `app_system`, revogada de `public/anon/authenticated/service_role`. Chamada **somente** de dentro dos dois embrulhos (§2.4), na mesma transação do consumo. Regra, em um único `UPDATE … WHERE` sobre o rascunho, depois de travar a linha do desafio e a do rascunho:
1. `p_cookie_hash` não nulo.
2. O desafio `p_challenge_id` está consumido (`consumed_at is not null`) e `browser_nonce_hash = p_cookie_hash` (nonce gravado no pedido, §1.1). Desafio sem nonce: `false`.
3. O rascunho é o de `browser_nonce_hash = p_cookie_hash`, com `status in ('aberto','aguardando_email')` e `expires_at > p_now` (posse pelo cookie, nunca por id), `FOR UPDATE`.
4. `rascunho.email_hmac = desafio.email_hash` (e-mail conferido, CA-07/08).
5. Efeito: `email_verified_at = p_now`, `status = 'aberto'`, `updated_at = p_now`. Retorna `true`. Qualquer condição falha: nenhuma linha muda, retorna `false`, sem erro.
- Ordem de travas fixa: linha do desafio (já travada pelo consumo) → linha do rascunho. O `PUT identity` trava só o rascunho, então não há ciclo.
- Idempotente: um segundo consumo do mesmo desafio não ocorre (uso único); mesmo que chamada de novo, reescreve o mesmo estado.

### 2.3 Vínculo do nonce — `private.draft_bind_challenge(p_challenge_id uuid, p_cookie_hash text, p_now timestamptz) returns boolean`
`security definer`, `search_path` vazio, `execute` para `app_system`. (1) `update app.auth_challenge set browser_nonce_hash = p_cookie_hash where id = p_challenge_id and browser_nonce_hash is null and consumed_at is null and invalidated_at is null`. (2) Se o rascunho vivo do cookie tem `email_hmac = auth_challenge.email_hash` e `email_verified_at is null`: `status = 'aguardando_email'` (única transição para esse valor; CA-09 "antes da confirmação, aguardando_email"). Retorna se gravou o nonce. O segredo em claro nunca chega ao banco; só o SHA-256.

### 2.4 Embrulhos transacionais (funções novas; as antigas ficam)
- `private.auth_code_attempt_attach(<mesmos 10 parâmetros de auth_code_attempt>, p_cookie_hash text)`: chama `private.auth_code_attempt`; se `out_resultado = 'ok'`, chama `draft_attach_challenge(out_challenge_id, p_cookie_hash, p_now)`; devolve as colunas de `auth_code_attempt` mais `out_attached boolean`. Uma função, uma transação: se a anexação lançar erro, o consumo desfaz (o código volta a valer, o cliente pode tentar de novo; a resposta é 503), e os erros de código (`errado`) seguem gravando contador e `code_lock` como hoje (não passam pela anexação).
- `private.auth_challenge_consume_link_attach(p_token_hash text, p_now timestamptz, p_cookie_hash text)`: idem com `consume_link`; devolve as colunas dele mais `out_attached`.
- `execute` para `app_system` (como `auth_code_attempt`); `revoke` de `public/anon/authenticated/service_role`.

### 2.5 Funções de identificação (papel `app_api`, como as de H-025)
- `private.draft_identity_get(p_hash text, p_now timestamptz)` e `private.draft_identity_set(p_hash text, p_now timestamptz, p_first_name text, p_email text, p_email_hmac text)`; `security definer`, `search_path` vazio, `execute` só para `app_api`, tempo `p_now` informado. `set` aplica a regra de §1.5 sob `FOR UPDATE` do rascunho e devolve `first_name`, `email`, `email_verified`; zero linhas = 404.

## 3. Cinco erros e limites `[DECIDIDO]` D8, 05 linha 91, 39 §2.1, 50 (H-015)

- **Cinco erros invalidam o desafio:** cada código errado soma 1 em `attempts` (travado por `FOR UPDATE`); no quinto, `invalidated_at` e `invalid_reason = 'tentativas'`, `email_enc` e `secrets_enc` zerados. Depois disso, o código certo recebe 422 `codigo_invalido` (não há desafio vivo). O quinto erro responde 422 igual aos demais (nada revela que foi o último). A tela não mostra tentativas restantes.
- **Interação com o bloqueio por e-mail:** o padrão é 15 erros em 24 h (`CODE_ERROR_LIMIT_DEFAULT`), então os cinco erros de um desafio ocorrem **antes** do bloqueio (429 só vem do 16º erro na janela, ou do 50º pedido de código por IP na hora). O teste do caso usa e-mail e IP novos e limites padrão, e prova também o caso inverso: com `erroCodigoDia` no mínimo (5), o quinto erro produz bloqueio e o código certo seguinte devolve 429 com `Retry-After`, nunca 200.
- **Limites reaproveitados sem alteração (CA-04):** por e-mail (erros 15/24 h com bloqueio 15 min, 1 h, 24 h) e por IP (50/h); o 429 não depende de o e-mail ter conta, e tem o mesmo corpo. Chaves só como HMAC. Pedido de acesso: 60 s/5 por hora por e-mail, 20/h por IP, global 30/h e 80/dia (H-015).
- **Link e código são a mesma linha (CA-05):** os dois embrulhos marcam `consumed_at` e zeram `secrets_enc`; o que vier depois, por qualquer via, é inválido.

## 4. Posse pelo cookie e anexação (CA-06 a CA-09)

- A posse do rascunho é **só** o cookie `__Host-fp_draft` (`HttpOnly; Secure; SameSite=Strict; Path=/`). O rascunho é achado por `browser_nonce_hash = SHA-256(cookie)`; nenhum id vindo do cliente decide a anexação. Sem segundo cookie (decisão 66).
- Anexação ocorre se, e somente se, as quatro condições de §2.2 valem na mesma transação: mesmo navegador do pedido (nonce do desafio = nonce do consumo), rascunho vivo desse navegador, e-mail do rascunho = e-mail do desafio, desafio consumido agora. Outro navegador (sem cookie ou com outro): sem nonce igual, não anexa; ainda assim a sessão nasce nele (08 §5.1 item 5) e a resposta é a mesma (CA-08).
- Trocar o e-mail do rascunho depois de pedir o acesso faz o HMAC deixar de bater: não anexa. Trocar depois de anexar zera `email_verified_at` (§1.5).
- Estados: `aberto` → (pedido com e-mail conferindo) `aguardando_email` → (consumo) `aberto` com `email_verified_at` preenchida. Nenhum status novo e nenhuma mudança no `check` de status (decisão 68).

## 5. Tela do código `[DECIDIDO]` decisão 69, `[PROPOSTA]` detalhes

**Entregáveis:** `apps/web/public/codigo.html` (rota `/codigo`, página própria para uso isolado), `codigo.css`, `codigo.js` (módulo `montarCodigo(raiz, { email?, purpose, aoConfirmar })`, reutilizável pela etapa "Confira seu e-mail" da #43; a #43 só embute o módulo e cuida do passo e da revisão). Entradas em `vercel.json` para `/codigo` com o mesmo bloco de cabeçalhos de `/pedido` (`no-store`, `no-referrer`, CSP `default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; …`). Sem estilo ou script embutido (CSP).

**Comportamento**
- Campo de e-mail (`type="email"`, `autocomplete="email"`) só quando o módulo não recebe o e-mail; campo do código: `type="text"`, `inputmode="numeric"`, `autocomplete="one-time-code"`, `maxlength="6"`, `pattern="[0-9]{6}"` (não usa `type="number"`). Colar com espaços ou traço é aceito: o script mantém só dígitos, até 6.
- Botão "Confirmar código" desabilitado até haver 6 dígitos e durante o envio (`aria-busy`); duplo clique não envia duas vezes. Botão "Pedir novo código" chama `POST /api/v1/auth/challenges` (limites de H-015; 429 mostra o tempo de `Retry-After` em texto fixo, sem contagem regressiva falada).
- `POST /api/v1/auth/challenges/verify` (mesma origem, prefixo `/api` como em `acesso.js`). 200 → texto "Código confirmado." → `POST /api/v1/auth/session` (como o link) → `aoConfirmar()`; na página isolada, a mensagem final é a de `acesso.js`.
- Nada sensível fica no navegador: e-mail e código só em memória do script, nunca em URL, `localStorage`, `sessionStorage`, cookie ou `console`.

**Mensagens (texto fixo)**
- 422: "Código incorreto ou vencido. Confira e tente de novo." (igual para os seis casos). Depois de três erros seguidos na tela: acrescenta "Se não funcionar, peça um novo código." Nunca mostra tentativas restantes nem o limite.
- 429: "Muitas tentativas. Aguarde alguns minutos e tente de novo."
- 503 ou rede: "Não foi possível confirmar agora. Tente de novo em instantes."
- 403/415 (Origin/tipo): mesma mensagem de 503 (não expõe motivo).

**Acessibilidade (WCAG 2.2 AA)**
- Rótulo visível `<label for>` "Código de 6 dígitos" (não só placeholder); instrução associada por `aria-describedby`. Erro em `<p id="erro" role="alert">` (anunciado uma vez, ao aparecer); progresso e sucesso em `role="status"`. Campo recebe `aria-invalid="true"` no erro e o foco volta a ele. O erro não depende só de cor (texto + `--color-error-text` sobre `--color-error-background`, contraste conferido por token).
- Teclado completo (Tab/Shift+Tab, Enter envia, sem armadilha); foco visível de 3 px com `--color-brand` e deslocamento de 2 px (contraste de componente ≥ 3:1 sobre `--color-background` e `--color-surface`); ordem de foco igual à visual; `lang="pt-BR"`; título único da página.
- Alvos ≥ 44 px (campo `--input-height` 52 px; botão `--button-height-md` 48 px); fonte ≥ 16 px (evita ampliação automática no iOS); espaçamento por `--space-*`.

**Responsividade**
- Coluna única, `max-width` 480 px centralizada, `padding` por token, sem largura fixa em px: sem rolagem horizontal em 320 px e com zoom de 200 % (reflow, WCAG 1.4.10); botão em largura total em < 768 px (`--breakpoint-tablet`). Cores só por tokens EDS de `tokens.css` (sem hexadecimal solto).
- Leitor de tela: a prova automatizada (axe) não substitui teste humano; pendente de testador, sem declarar conformidade.

## 6. Testes e critérios verificáveis

Padrão do repositório `[VERIFICADO]`: `*.test.ts` (unidade e rota, em memória, com a rede bloqueada), `*.dbtest.mjs` (Postgres real efêmero, nunca dublê), teste estático de migração e navegador real (Playwright). Tudo local, sem rede, e-mail `@example.test`, provedor `FakeEmailProvider`, relógio fixo, linhas de 2099 no banco. Evidência na Issue #26: comando, contagem e código de saída de `corepack pnpm check:all` e `db:test` (sem declarar CI verde).

| ID | Tipo | Prova | CA |
|---|---|---|---|
| T-H013-01 | dbtest + HTTP | Pedido com cookie: `auth_challenge.browser_nonce_hash` = SHA-256 do segredo (64 hex); sem cookie, nulo; cookie malformado, nulo; o segredo em claro não está em nenhuma coluna nem linha de log; falha forçada de `bindNonce` mantém 202 | CA-06, CA-13 |
| T-H013-02 | dbtest | `draft_bind_challenge`: grava só se o nonce está nulo e o desafio vivo; rascunho com e-mail conferindo vai a `aguardando_email`; com e-mail diferente, status intacto | CA-06, CA-09 |
| T-H013-03 | HTTP + dbtest | Código certo em `/verify`: 200 `codigo_ok`, `Set-Cookie __Host-fp_ident`, `consumed_at` preenchido, `secrets_enc`/`email_enc` nulos; segundo envio do mesmo código: 422 | CA-01, CA-11 |
| T-H013-04 | HTTP | Seis casos (errado, inexistente, expirado por relógio, já usado, substituído, invalidado): 422 `codigo_invalido` com corpo e cabeçalhos byte a byte iguais; formato ruim (5 dígitos, letras): mesmo 422 | CA-02 |
| T-H013-05 | HTTP + dbtest | Cinco códigos errados (e-mail e IP novos, limites padrão): cinco 422 idênticos; `attempts = 5`, `invalid_reason = 'tentativas'`; o código certo depois: 422; o link do mesmo desafio depois: 400 `link_invalido` | CA-03, CA-05 |
| T-H013-06 | HTTP + dbtest | Com `erroCodigoDia = 5`: quinto erro bloqueia o e-mail; código certo seguinte: 429 com `Retry-After`, nunca 200 | CA-03, CA-04 |
| T-H013-07 | HTTP | 429 por e-mail e por IP: mesmo corpo para e-mail com conta e sem conta; `Retry-After` presente; o limite não revela qual regra barrou | CA-04 |
| T-H013-08 | dbtest | Link consumido primeiro: o código passa a 422; código primeiro: o link passa a 400 (mesma linha) | CA-05 |
| T-H013-09 | dbtest | Anexação feliz pelo código e pelo link (duas execuções): mesmo cookie do pedido, e-mail do rascunho = e-mail do desafio ⇒ `email_verified_at` = relógio, `status = 'aberto'`; outras colunas do rascunho intactas | CA-07, CA-09 |
| T-H013-10 | dbtest | Não anexa e retorna o mesmo 200 em: outro cookie; sem cookie; desafio sem nonce; rascunho de e-mail diferente (HMAC); rascunho vencido, descartado ou publicado; rascunho sem e-mail. Em todos, nenhuma coluna do rascunho muda e o corpo/cabeçalhos do 200 são iguais ao caso feliz | CA-08 |
| T-H013-11 | dbtest | Posse: com dois rascunhos vivos (A e B), consumo com o cookie de A só altera A; `draft_id` do corpo do pedido apontando para B não altera B | CA-07, R-10 |
| T-H013-12 | dbtest | Atomicidade: se `draft_attach_challenge` lança erro (função forçada a falhar), o consumo desfaz (`consumed_at` nulo, código segue valendo) e a resposta é 503 | CA-07, R-1 |
| T-H013-13 | dbtest | Colunas: `email`, `first_name`, `email_hmac`, `email_verified_at` existem e aceitam nulo; restrições de tamanho, de e-mail normalizado e `num_nulls`; nenhuma coluna `lat|lon|point|geom` nova; RLS forçada e sem privilégio para `anon/authenticated/service_role/PUBLIC/app_api/app_system` na tabela | CA-10 |
| T-H013-14 | HTTP + dbtest | `PUT identity`: grava nome e e-mail; `email_hmac` = `challengeHmacHex(pepper, email)` = `auth_challenge.email_hash` do pedido do mesmo e-mail (invariante); trocar o e-mail zera `email_verified_at` e volta `aguardando_email` a `aberto`; mesmo e-mail mantém; chave extra, vazio, nome e e-mail inválidos: 422 sem gravar; cookie ausente/malformado/de outro navegador: 404 uniforme sem tocar o banco quando malformado | CA-10, CA-09 |
| T-H013-15 | HTTP | `PATCH /v1/drafts/current` com `email` ou `first_name` segue 422 `campo_desconhecido`; resposta de H-025 não ganha campos; `GET identity` nunca devolve `email_hmac` nem nonce | CA-10, CA-13 |
| T-H013-16 | HTTP | `/verify` abre a etapa pela **mesma** `concluirAcesso` do link (dublê de conta e de etapa chamados na mesma sequência); falha de conta/etapa: 503 `acesso_indisponivel` sem detalhe; o código não cria sessão própria | CA-11 |
| T-H013-17 | HTTP | Cabeçalhos de `/verify`: Origin ou Sec-Fetch-Site inválido ⇒ 403 e nada lido nem consumido; sem `application/json` ⇒ 415; corpo acima de 2.048 bytes ⇒ 422 uniforme | CA-13, R-13 |
| T-H013-18 | varredura | Dados sintéticos com sentinelas (e-mail, código, token, nonce, IP): nenhuma tabela, resposta, métrica ou linha de log contém as sentinelas; `Cache-Control: no-store` em todas as respostas das rotas desta história | CA-13 |
| T-H013-19 | dbtest, várias conexões | **Concorrência de erros:** 4 códigos errados simultâneos ⇒ `attempts = 4` exato, desafio vivo; 20 simultâneos ⇒ `attempts = 5` (nunca 6; a restrição `attempts between 0 and 5` não dispara), `invalid_reason = 'tentativas'`, nenhum `ok` | CA-14 |
| T-H013-20 | dbtest, várias conexões | **Uso único:** 20 códigos corretos simultâneos do mesmo desafio ⇒ exatamente 1 `ok`, 19 `invalido`, anexação exatamente 1 vez; 20 consumos mistos (10 link + 10 código) ⇒ 1 `ok` | CA-14, CA-05 |
| T-H013-21 | dbtest, várias conexões | **Anexação x edição:** consumo e `PUT identity` com outro e-mail em paralelo (20 rodadas): resultado final é sempre consistente (ou anexado com e-mail conferindo, ou não anexado); nunca `email_verified_at` preenchida com e-mail diferente do desafio | CA-07, R-2 |
| T-H013-22 | estático | Migração e rollback: par com mesmo nome, número maior que o último, `if not exists`/`if exists`, `search_path` vazio nas funções novas, `revoke` de `public/anon/authenticated/service_role`, `execute` só para os papéis do desenho; aplicar duas vezes (idempotência) e desfazer deixam o esquema anterior (padrão de `draft-rollback-h025.dbtest.mjs`) | CA-10 |
| T-H013-23 | regressão | Suítes de H-011, H-012, H-014, H-015, H-025 e H-097 sem regressão; os testes da `/verify` da #107 ajustados apenas para enviar Origin/Content-Type e para aceitar o `Set-Cookie` | todos |
| T-H013-24 | unidade (DOM simulado) | `codigo.js`: só dígitos até 6; botão desabilitado até 6 dígitos e durante o envio; uma só chamada por clique; mensagens fixas por status; nada em `localStorage`/`sessionStorage`/URL/`console`; foco volta ao campo no erro | CA-12 |
| T-H013-25 | navegador (Playwright + axe) | `/codigo` em 320 px e com zoom de 200 %: sem rolagem horizontal; teclado completo; foco visível; `role="alert"` anunciado uma vez; axe sem violação crítica ou séria; cores só por token. Leitor de tela: **pendente de testador humano**, sem declarar conformidade | CA-12 |

**Critério de saída:** 100 % de T-H013-01 a T-H013-25 verdes (T-H013-25 menos o item de leitor de tela, registrado como pendente); suítes anteriores sem regressão; nenhuma tabela nova.

## 7. Riscos

| ID | Risco | Mitigação |
|---|---|---|
| R-1 | Consumo concluído e anexação perdida (código gasto, rascunho sem confirmação) | Anexação dentro da mesma transação do consumo (embrulho único); erro desfaz tudo e responde 503; teste T-H013-12 |
| R-2 | Corrida entre anexação e troca de e-mail | Travas em ordem fixa (desafio → rascunho); comparação do HMAC sob `FOR UPDATE`; T-H013-21 |
| R-3 | Terceiro digita o e-mail alheio no rascunho dele | A sessão nasce onde o POST ocorre; sem o mesmo cookie nada anexa; publicar exige revisão e confirmação expressa na sessão (08 §5.1 item 5) |
| R-4 | Roubo do cookie do rascunho | `HttpOnly; Secure; SameSite=Strict`, 256 bits, só o SHA-256 no banco; ainda assim anexar exige o código/link do e-mail |
| R-5 | Adivinhar o código para abrir sessão (agora o código abre a etapa) | 1 em 10^6 por tentativa; no máximo 5 tentativas por desafio, 15 erros/24 h por e-mail com bloqueio progressivo e 50/h por IP; probabilidade por desafio ≤ 5×10^-6 |
| R-6 | Pendência F-1 da #107 (conta não cadastrada não recebe e-mail) muda a sequência de gravação do pedido | `bindNonce` roda na mesma posição e para qualquer e-mail; teste de uniformidade da #107 (T-H097-07) estendido para cobrir `bindNonce` |
| R-7 | Enumeração por tempo ou resposta no `/verify` | Mesmo trabalho com e sem desafio (já existente); 422 único; 200 igual com e sem anexação; o cookie só altera o que é do próprio navegador |
| R-8 | E-mail e nome em claro no rascunho | RLS forçada, acesso só por função, `no-store`, fora de log e de métrica, expurgo por TTL (H-110, lacuna aceita 74 §6); revisar na abertura ao público |
| R-9 | Implantação em duas etapas (código antigo e novo) | Expansão pura; funções antigas intactas; ordem migração → código; rollback testado |
| R-10 | `draft_id` do corpo (não confiável) usado como posse | Ignorado na anexação; T-H013-11 |
| R-11 | Scanner de e-mail consome o link antes do cliente | Inalterado: o link só é consumido por POST iniciado por clique (46); o código só é lido por humano |
| R-12 | Desafio sem nonce (pedido sem cookie) | Fecha para o lado seguro: nada anexa; o cliente confirma o e-mail e a #43 pede nova confirmação |
| R-13 | `/verify` agora emite cookie de identificação sem checar Origin | `checkConsumeHeaders` antes de ler o corpo (§1.2); `SameSite=Strict`; exige ajuste dos testes da #107 |
| R-14 | Falha de `bindNonce` deixa rascunho em `aberto` | Só rótulo de estado; a confirmação depende de `email_verified_at`, não do status |

## 8. Ordem de implementação e arquivos

1. Migração, rollback e testes T-H013-01/02/09 a 13/19 a 22 (banco). 2. Domínio e `packages/db`: `AttemptCodeInput/Result`, `bindNonce`, `concluirAcesso`, embrulhos nos repositórios Pg; T-H013-03 a 08, 16, 23. 3. API: `draft-nonce.ts`, leitura do cookie nas três rotas, `/verify` com cabeçalhos e `Set-Cookie`, rota `identity` e `isDraftRoute`; T-H013-14, 15, 17, 18. 4. Web: `codigo.html/.css/.js`, `vercel.json`; T-H013-24, 25. 5. Documentos: 08 §5.1 e 09 (já ajustados por este desenho). Arquivos tocados: os de §1 a §5, mais composição (`PEPPER_EMAIL_HMAC` na composição das rotas de rascunho). Nenhum arquivo de `service_request`, fotos ou geocodificação muda.

## 9. Dúvidas ao Orquestrador (não bloqueantes, com recomendação)

1. **Origin/Content-Type em `/verify` (R-13).** Alternativas: (a) exigir como em `/consume` (recomendado: a rota passa a emitir cookie e abrir etapa); (b) manter sem. Exige ajustar os testes da #107.
2. **Faixa do primeiro nome (2 a 60, letras, espaço, apóstrofo e hífen).** Recomendação: aceitar e ajustar após o ensaio; nomes com um caractere ou com dígitos serão recusados.
3. **`email_hmac` no rascunho** (coluna a mais que o refino listou). Recomendação: aceitar; é o que permite anexar na mesma transação sem expor o pepper ao banco.
4. **Rota `/codigo` isolada além do módulo reutilizável.** Recomendação: aceitar; a #43 usa o módulo e a página isolada serve de saída de emergência e de alvo do teste de acessibilidade.
5. **Onde o prazo do rascunho conta após anexar.** O rascunho não renova o prazo ao anexar (7 dias da última edição). Recomendação: aceitar; a #43 salva antes de revisar.

## 10. Correções de documento feitas com este desenho

- `08-ARQUITETURA.md` §5.1: item 4 passa a dizer `POST /v1/auth/challenges/verify` (não `/consume`) e item 5 passa a dizer que o nonce é o cookie `__Host-fp_draft` (decisões 66 e 69, D-H013-1).
- `09-MODELO-DADOS.md` `request_draft`: acrescenta `email_hmac?` e `email_verified_at?`.

## Resumo em linguagem simples

O cliente poderá digitar o código de 6 números que recebe por e-mail, em vez de abrir o link. Se acertar, entra do mesmo jeito que entraria pelo link. Se errar cinco vezes, aquele código deixa de valer e é preciso pedir outro. O pedido que o cliente começou a preencher só fica "confirmado" se ele estiver no mesmo navegador em que pediu o acesso e o e-mail for o mesmo; em outro aparelho ele entra, mas o pedido não é vinculado. O desenho também inclui a tela para digitar o código, pensada para celular, teclado e leitor de tela. Foi conferido por leitura do código e dos documentos; nada foi construído ou testado ainda. Falta construir e testar, e não há decisão pendente do dono do produto.
