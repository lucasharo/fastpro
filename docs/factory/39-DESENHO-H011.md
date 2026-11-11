# Desenho H-011 — Desafio de acesso do cliente (Issue #24, WF-03, Arquitetura)

- **Decisão:** APROVADO_ARQUITETURA, com 4 dúvidas não bloqueantes (§8).
- **Rastro:** 38-REFINO-H011 (CA-H011-01..18); decisões D-H011-1..8 do Orquestrador; 08 §5.1, §5.3, §12; 09 `auth_challenge`; 10 ADR-005; 25-REFINO-S01; `spikes/S-01-RESULTADO` (§5 e §8); 35-DESENHO-H092; 37-DESENHO-H093; código lido em `packages/email`, `packages/domain/src/notifications`, `packages/db/src/notifications.ts` e `supabase/migrations/20261111120000_*`.
- **Natureza:** SOMENTE documento. Nenhum código, migração, teste, chave ou e-mail foi criado ou alterado.
- **Etiquetas:** `[DECIDIDO]` decisão do Orquestrador · `[VERIFICADO]` lido no repositório · `[PROPOSTA]` deste desenho · `[DESVIO]` ajuste a 08/09 que deve ser registrado.

## 0. Fatos do repositório que moldam o desenho [VERIFICADO]

1. O envio de e-mail do H-092 **não aceita** o e-mail de acesso como está: `policy.ts` declara `acesso_login` com `params: []`; `content-guard.ts` só admite chaves `*_ref` (uuid) e `count` e **recusa** qualquer chave com `link`, `token`, `url`, `mail`. Link e código, portanto, não podem ir em `template_params` (e nunca devem ficar em tabela).
2. `ops.email_outbox.recipient_user_id` é obrigatório e o `RecipientDirectoryPort` resolve **usuário**; o cliente do desafio **ainda não tem usuário** (a conta só nasce no consumo, S-01 Q2). O banco do desafio guarda só `email_hash` (HMAC), que não permite recuperar o endereço para enviar.
3. `processOutbox` (`packages/db/src/notifications.ts`) já faz: reivindicar com lease, pular revalidação para a classe `auth`, resolver destinatário, reservar cota (corte dia 100 / mês 3.000 para `auth`), pausa de 200 ms, `provider.send`, tratar os cinco resultados. É **exportada**, então pode ser chamada direto da requisição. O job `email.send` é criado em `email_outbox_inserir` como contingência.
4. `ResendProvider` já envia no modo remetente de teste **só para o e-mail da conta** (`RESEND_ACCOUNT_RECIPIENT`) e recusa os demais; o renderizador atual (`createMinimalRenderer`) ignora `params`. Não há renderizador do e-mail de acesso.
5. `ops.rate_counter` e `ops.app_config` existem. O esquema `app` existe e está vazio; `app_user` não existe. Segredos já listados em `.env.example`: `PEPPER_EMAIL_HMAC`, `PEPPER_CODE_HMAC`, `PEPPER_IP_HMAC`.

## 1. Decisões de desenho

| # | Decisão | Motivo |
|---|---|---|
| DD-1 | **O pedido nunca consulta conta.** O trabalho é idêntico para e-mail cadastrado ou não: gerar segredos, gravar desafio, gravar saída de e-mail. Nenhuma porta de usuário existe no manipulador. | Resposta e tempo uniformes por construção (CA-H011-01/02/03), não por disfarce. |
| DD-2 | Segredos **aleatórios** (token 256 bits, código 6 dígitos por `crypto.randomInt`), guardados como `token_hash` (SHA-256) e `code_hmac`. Para poder enviar (e reenviar com segurança), o par `{token, código}` e o endereço ficam em **colunas cifradas** (AES-256-GCM) de vida curta, apagadas assim que deixam de servir. | O desenho original (hash apenas) não permite enviar nem reenviar pela fila. Cifra com vida curta atende CA-H011-13/15 (nada legível). `[DESVIO]` a 09: 3 colunas novas (§2). |
| DD-3 | **Decorador de provedor** `ChallengeEmailProvider` (implementa `EmailProviderPort`) e **diretório de destinatário** `ChallengeRecipientDirectory` (implementa `RecipientDirectoryPort`). `processOutbox` e o pipeline **não mudam**. | Mínimo impacto no H-092/H-093; segredos só existem na memória do envio. |
| DD-4 | A linha de saída usa `email_type='acesso_login'`, classe `auth`, `template_params={challenge_ref:<uuid>}` e `recipient_user_id=<id do desafio>` (uuid não colide com usuário). `dedupe_key='ac:'+<id do desafio>`. | Reaproveita fila, cota, recuo, idempotência. Única mudança no H-092: allowlist de `acesso_login` passa de `[]` para `['challenge_ref']` (o guarda continua aceitando: a chave não casa com nenhum nome proibido). |
| DD-5 | Envio "sem esperar o tick": depois de confirmar a transação, o endpoint agenda `processOutbox(d, outboxId, pacer)` **após a resposta** (porta `AfterResponsePort`; na Vercel, `waitUntil`/`after`). O job `email.send` criado junto é a contingência (o `claim` garante um só remetente). | CA-H011-04; D-H011-7. A latência da resposta não inclui o provedor. |
| DD-6 | Validação do link e do código no banco, em **funções `private.*` atômicas** (`FOR UPDATE`); o HTTP do consumo é H-012 e a tela do código é H-013. | Uso único e contador de tentativas só são seguros no banco (concorrência). |
| DD-7 | Todo "não pode usar" (inexistente, adulterado, usado, expirado, substituído, tentativas esgotadas) devolve **um só resultado** ao cliente; o motivo real só vai a métrica sem PII. | CA-H011-07..09. |
| DD-8 | Tempo do banco (`clock_timestamp()`), `p_now` opcional para testes. | Igual a H-092 (DD-4). |

## 2. Modelo do desafio [PROPOSTA; 09 `auth_challenge` com ajustes]

Migração sugerida `supabase/migrations/20261111140000_identity_create_auth_challenge.sql` + `supabase/rollbacks/…down.sql`. Esquema `app`. Idempotente. RLS habilitada e forçada, sem políticas, `revoke all` de `public/anon/authenticated/service_role`, privilégios só a `app_system` (mesma postura de H-005/H-092).

`app.auth_challenge`:

| Coluna | Tipo / regra |
|---|---|
| `id` | uuid pk, **gerado pela API** (entra no AAD da cifra) |
| `email_hash` | text, 64 hex; HMAC-SHA256(`PEPPER_EMAIL_HMAC`, e-mail normalizado). **Mesma normalização do H-016** (`trim` + minúsculas), função única em `packages/domain` |
| `purpose` | `login` \| `publish` (09) |
| `token_hash` | text, 64 hex, **único**; SHA-256 do token (256 bits aleatórios, base64url) |
| `code_hmac` | text, 64 hex; HMAC-SHA256(`PEPPER_CODE_HMAC`, `id` + `|` + código) |
| `email_enc` | bytea null; endereço cifrado. Apagado (`null`) ao consumir, invalidar ou expirar |
| `secrets_enc` | bytea null; `{token, código}` cifrados. Apagado ao entregar, consumir, invalidar ou expirar |
| `draft_id` | uuid null; só guardado, sem FK (rascunho não existe; vínculo é H-013) |
| `browser_nonce_hash` | text null; criado vazio, preenchido por H-013 |
| `ip_hmac` | text null; HMAC(`PEPPER_IP_HMAC`, IP). Guardado para H-015, **não usado** em H-011 |
| `expires_at` | timestamptz, `created_at + 15 min` (fixo, D8; não é configurável) |
| `consumed_at` | timestamptz null |
| `invalidated_at` / `invalid_reason` | timestamptz null / `substituido` \| `tentativas` \| `expirado_limpeza` |
| `delivered_at` | timestamptz null; preenchido quando o provedor aceita (impede segundo envio) |
| `attempts` | smallint 0..5, `check (attempts between 0 and 5)` |
| `created_at` | timestamptz |

- **Ativo** = `consumed_at is null and invalidated_at is null and expires_at > now`. Índice parcial único `(email_hash, purpose) where consumed_at is null and invalidated_at is null` → no máximo **um** desafio vivo por (e-mail, intenção) (08 §5.1 item 2). Índice `(email_hash, created_at)` para os limites; índice único em `token_hash`.
- **Cifra** `[PROPOSTA]`: AES-256-GCM, nonce aleatório de 12 bytes, formato `versão(1) | nonce(12) | tag(16) | texto`, AAD = `"ac1|"+id+"|"+coluna`. Chave nova `AUTH_CHALLENGE_KEY` (32 bytes, base64), lista versionada para rotação (desafio vive 15 min, então troca é simples). Ausente ou inválida = erro de configuração **sem** imprimir o valor.
- **Aleatoriedade:** token `randomBytes(32)`; código `randomInt(0, 1_000_000)` com zeros à esquerda (sem viés de módulo).
- **Link do e-mail:** `${SITE_URL}/acesso#t=<token>` (caminho fixo `/acesso`, segredo no fragmento, 08 §5.1 item 3). A página e o POST são H-012.
- **Expurgo:** job `auth.challenge.purge`, enfileirado por `dedupe_key` diária pela própria função de criação (não há agendador). Zera blobs de linhas terminais/vencidas e apaga linhas com mais de 24 h (só hashes; as 24 h cobrem a contagem horária e sinais de abuso). Substituídos têm blobs zerados na hora.

### 2.1 Funções SQL (`private.*`, `search_path=''`, `execute` só para `app_system`)

1. **`auth_challenge_create(p_id, p_email_hash, p_purpose, p_token_hash, p_code_hmac, p_email_enc, p_secrets_enc, p_draft_id, p_ip_hmac, p_min_interval, p_max_per_hour, p_now)`** → `(resultado, challenge_id, outbox_id, retry_after_seconds)`; `resultado` ∈ `criado | espera | teto`. Numa transação: `pg_advisory_xact_lock(hashtextextended(p_email_hash,0))` (serializa pedidos do mesmo e-mail) → confere intervalo e teto (§4) → invalida o desafio vivo anterior (zera blobs) → insere o novo → `private.email_outbox_inserir(p_id, 'acesso','auth','acesso_login','acesso_login', {"challenge_ref":p_id}, 'ac:'||p_id, now)` (cria o job `email.send`) → enfileira o expurgo diário.
2. **`auth_challenge_consume_link(p_token_hash, p_now)`** → `(resultado, challenge_id, purpose, email_enc, draft_id)`; `resultado` ∈ `ok | invalido`. Trava a linha; se ativa, marca `consumed_at`, zera `secrets_enc` e **devolve `email_enc` e o apaga na mesma instrução** (H-012 decifra na hora para criar o usuário, S-01 Q2). Qualquer outra situação = `invalido` (motivo interno só em métrica).
3. **`auth_challenge_verify_code(p_email_hash, p_purpose, p_code_hmac, p_max_attempts, p_now)`** → `(resultado, attempts_restantes, challenge_id, email_enc, draft_id)`; `resultado` ∈ `ok | errado | invalido`. Pega o desafio ativo do par; sem ativo = `invalido` (sem contar). Código certo = mesmo consumo do link. Errado: `attempts+1`; ao chegar a **5** o desafio é invalidado (`tentativas`) e zera blobs. O quinto erro invalida; o código certo na quinta tentativa ainda vale.
4. **`auth_challenge_mark_delivered(p_id, p_now)`** → grava `delivered_at` e zera `secrets_enc`.
5. **`auth_challenge_purge(p_now)`** → expurgo.

O código vale e morre **junto com o link** (mesma linha): usar um invalida o outro (CA-H011-11).

## 3. Fluxo do pedido (resposta uniforme)

`POST /v1/auth/challenges` com `{ email, purpose?='login', draft_id? }`.

1. Valida formato (tamanho ≤ 254, `isSafeAddress` de `@fastpro/email`, `purpose` na lista, `draft_id` uuid). Formato inválido → 422 genérico (não depende de existir conta).
2. Normaliza e calcula `email_hash`; **sempre** gera `id`, token, código, hashes, `email_enc` e `secrets_enc`.
3. Chama `auth_challenge_create` (uma transação). `espera`/`teto` → **429** com `Retry-After` e corpo `{code:'muitos_pedidos', retry_after_seconds}` (mesmo para e-mail cadastrado ou não; a contagem não olha conta, CA-H011-18).
4. `criado` → **202**, corpo fixo `{"status":"recebido"}`, cabeçalhos fixos (`Cache-Control: no-store`; sem `Set-Cookie` em H-011), e agenda o envio após a resposta (DD-5).
5. O 202 é idêntico em status, corpo e cabeçalhos para qualquer e-mail, inclusive quando o provedor está `nao_configurado`, a cota falha ou o endereço está suprimido (a saída fica pendente/descartada e o cliente nada vê).

**Tempo semelhante (D-H011-8).** A igualdade vem de DD-1 (mesmo caminho, mesma contagem de operações). Tolerância definida:
- **Porta de aceite (determinística):** com repositório em memória e `FakeClock`, a **sequência de chamadas** (leituras, escritas, cifras, HMACs, portas) é **idêntica** nos dois casos e o tempo simulado decorrido tem diferença 0; status, corpo e cabeçalhos são iguais byte a byte.
- **Medição de apoio (não bloqueia):** contra o banco de desenvolvimento, 40 pedidos por caso, em ordem alternada, e-mails sintéticos: diferença entre medianas ≤ **30 ms** e entre p95 ≤ **120 ms**. Registrar os números na Issue; se falhar por ruído de rede, vale a porta determinística.
- Não se usa pausa artificial (*sleep*) para igualar tempo: não há assimetria a esconder.

## 4. Limites e invalidação

| Regra | Valor | Onde |
|---|---|---|
| Validade | 15 min fixos | `expires_at` |
| Uso | único (link **ou** código) | `consumed_at` |
| Tentativas do código | 5 erros invalidam | `attempts`, `p_max_attempts=5` (constante) |
| Intervalo entre pedidos, mesmo e-mail | 60 s | `ops.app_config` `auth.challenge.min_interval_seconds`, faixa 10–600, padrão 60 |
| Teto por hora, mesmo e-mail | 5 | `auth.challenge.max_per_hour`, faixa 1–20, padrão 5 |
| Novo pedido | invalida o anterior (mesmo e-mail e intenção) | `invalid_reason='substituido'` (D-H011-5) |
| Por IP e global | **não** em H-011 | H-015 (a coluna `ip_hmac` já existe) |

- Contagem pelas linhas de `auth_challenge` (`created_at`) do mesmo `email_hash`, qualquer `purpose`, nos últimos 60 min; pedidos que recebem 429 **não** criam linha nem contam. `retry_after` = tempo até liberar o intervalo ou até a mais antiga da janela sair.
- Valores lidos e validados em TypeScript (padrão se ausente/inválido, como `windowSecondsFrom`) e **revalidados** na função SQL.
- Novo desafio **não revoga sessões** existentes (S-01 D6).
- Desafio cuja saída de e-mail ainda não saiu e foi substituído/expirado **não é enviado**: o decorador confere antes de chamar o provedor (§5).

## 5. Integração com o pipeline e o adaptador de e-mail

```
POST ──tx──> auth_challenge_create ──> email_outbox(auth, acesso_login, ac:<id>) + job email.send
   │                                               │
   └─ 202 ──> [após a resposta] processOutbox(outboxId)   (contingência: job email.send no tick)
                    │ claim (lease) → pula revalidação (classe auth)
                    │ directory.resolve(<id>)  = ChallengeRecipientDirectory
                    │ reserva de cota (corte 100) → pacer (200 ms)
                    │ provider.send            = ChallengeEmailProvider(inner = Resend|Mailpit)
```

- **`ChallengeRecipientDirectory`** (envolve o diretório de usuários): se o id é de desafio e há `email_enc`, decifra e devolve `ok`; desafio inativo ou sem `email_enc` → `inexistente` (a saída vira `descartado`, sem chamar o provedor); id desconhecido → delega ao diretório de usuários. Supressão (bounce) por `email_hash` entra quando `email_suppression` existir (H-093 webhook); até lá não há consulta `[NÃO VERIFICADO: tabela ainda inexistente]`.
- **`ChallengeEmailProvider`**, só para `templateKey='acesso_login'` (os demais passam direto):
  1. relê o desafio; **inativo** (usado, expirado, substituído, invalidado) → devolve `recusa_permanente('desafio_inativo')` (a saída vira `falha`, cota devolvida, nada enviado);
  2. `delivered_at` preenchido → devolve `aceito('ja_entregue')` **sem chamar o provedor** (CA-H011-06 mesmo se o provedor não deduplicar);
  3. decifra `secrets_enc`, monta `params={link, code, minutos:15}` **só em memória**, chama o provedor interno (idempotência = `dedupe_key`, já hasheada pelo H-093);
  4. `aceito` → `mark_delivered` (zera `secrets_enc`); qualquer outro resultado passa adiante inalterado.
  5. Nenhuma exceção carrega valores: erros viram códigos (`desafio_inativo`, `segredo_indisponivel`, `configuracao_cifra`).
- **Renderizador** `createAuthAwareRenderer(base)` em `packages/email`: para `acesso_login` produz **assunto genérico** ("Seu acesso ao FastPro" `[PROPOSTA]`) e texto com **somente**: link, código de 6 dígitos, prazo de 15 min e "ignore esta mensagem se não foi você" (CA-H011-14). Outros templates seguem o renderizador base. Texto final: H-094/H-097.
- **Logs e registros:** `email_outbox` guarda só `challenge_ref`, `reason_code`; `job.payload_ref` guarda só o id da saída; nenhum log recebe endereço, token ou código (CA-H011-13/15). O adaptador já não os registra (H-093 CA-14).
- **Ambientes:** testes e CI usam provedor simulado; desenvolvimento usa Mailpit local (`select.ts`); produção sem domínio verificado fica `pendente` sem sair; o único envio real permitido é ao e-mail da conta (remetente de teste). **Nenhum teste de H-011 exige envio real** (D-H011-3). Cota: H-097 (D-H011-7).

### 5.1 Arquivos esperados (para o DEV)

`packages/domain/src/identity/` (normalização, regras de limite, constantes, tipos, portas `ChallengeStore`, `AfterResponsePort`, `ChallengeCrypto`); `packages/email/src/auth-renderer.ts`; `packages/db/src/challenges.ts` (store Pg, diretório, decorador, handler `auth.challenge.purge`); migração e rollback; ajuste de `policy.ts`; `AUTH_CHALLENGE_KEY` e `SITE_URL` em `.env.example` e em `scripts/check-env-example.mjs`.

## 6. Testes para o DEV (nenhum com rede real)

Setup comum bloqueia `fetch`/sockets (como T-H92-39). Provedor sempre simulado (`FakeEmailProvider` do testkit ou `FakeHttp`/`FakeSmtp` de `packages/email/tests/doubles.ts`). E-mails sintéticos `@example.test`. Valores sentinela (e-mail, token, código) são procurados em tudo que o teste puder inspecionar.

**Unidade (Vitest, sem banco, `FakeClock`)**
- T-H011-01 normalização do e-mail igual à do H-016; `email_hash` estável e distinto por e-mail; código com zeros à esquerda; 10.000 códigos cobrem a faixa sem valor fora de 000000–999999.
- T-H011-02 cifra: ida e volta; AAD errado, coluna trocada, byte adulterado e chave errada falham; dois blobs do mesmo texto diferem; chave ausente → erro de configuração **sem** o valor na mensagem.
- T-H011-03 limites: matriz de `decideChallengeLimit` (59/60 s; 4/5 pedidos em 1 h; cálculo de `retry_after`); valores de configuração fora da faixa caem no padrão.
- T-H011-04 renderizador: o texto de `acesso_login` contém link, código e prazo e **nada mais** (sem nome, endereço, telefone, valor, estado de cadastro); assunto genérico; outros templates intactos.
- T-H011-05 content-guard: `acesso_login` aceita `{challenge_ref: uuid}`, recusa qualquer outra chave, recusa `link`/`token`/`code` e valor que não seja uuid.

**Manipulador do pedido (Vitest, repositório em memória, `FakeClock`)**
- T-H011-10 e-mail "cadastrado" e "não cadastrado": mesmo status 202, mesmo corpo e cabeçalhos, **mesma sequência de chamadas ao repositório e às portas**, tempo simulado igual (CA-H011-01/03). O manipulador não recebe nenhuma porta de usuário.
- T-H011-11 nenhuma conta é criada no pedido (CA-H011-02).
- T-H011-12 429 por intervalo (59 s) e por teto (6º pedido na hora): resposta e `Retry-After` iguais para os dois tipos de e-mail; nada é enviado; o pedido barrado não conta (CA-H011-16/17/18).
- T-H011-13 formato inválido → 422 sem consultar nada; falha do provedor (`indisponivel`, `nao_configurado`, cota negada) **não muda** o 202.
- T-H011-14 após a resposta: `processOutbox` é chamado uma vez por pedido (porta `AfterResponsePort` simulada); sem ela, o job `email.send` cobre.

**Banco (`*.dbtest.mjs`, banco de desenvolvimento, dentro de transação com rollback quando possível; concorrência com várias conexões)**
- T-H011-20 criação grava `expires_at = created_at + 15 min`; `token_hash`/`code_hmac` com 64 hex; **varredura de todas as colunas e linhas** (`to_jsonb(row)::text`) em `auth_challenge`, `email_outbox`, `job`, `outbox_event`: nenhum sentinela de e-mail/token/código em claro (CA-H011-13/15).
- T-H011-21 novo pedido invalida o anterior; o link do primeiro vira `invalido`; índice único impede dois vivos (CA-H011-10); 20 pedidos simultâneos do mesmo e-mail → exatamente 1 criado + o resto 429, 1 desafio vivo.
- T-H011-22 limites com `p_now`: 60 s e 5 por hora, nas viradas exatas (59,9 s/60 s; janela móvel).
- T-H011-23 link: válido consome uma vez; segunda vez, adulterado, inexistente, expirado (15 min + 1 s) e substituído devolvem o **mesmo** `invalido`; 20 consumos simultâneos do mesmo token → 1 `ok` (CA-H011-07/08/09).
- T-H011-24 código: 4 erros e o certo → `ok`; 5 erros → invalidado, o 6º (mesmo certo) → `invalido`, nenhuma sessão; 20 tentativas simultâneas contam sem perder incremento; usar o link mata o código e vice-versa (CA-H011-11/12).
- T-H011-25 `email_outbox` criado com classe `auth`, `dedupe_key='ac:<id>'`, `template_params` só `challenge_ref`; mesmo `p_id` duas vezes não cria segunda saída.
- T-H011-26 expurgo: blobs zerados em terminal/vencido/substituído; linhas > 24 h removidas; as de < 24 h preservadas (a contagem horária continua correta).
- T-H011-27 permissões: `anon/authenticated/service_role/app_api` sem acesso a tabela e funções; `app_system` com o mínimo.

**Integração (Vitest, repositório Pg, decorador + diretório reais, provedor simulado, `FakeClock`)**
- T-H011-30 pedido → `processOutbox` → provedor simulado recebe **um** e-mail para o endereço certo com link e código que **validam** (`consume_link` e `verify_code` aceitam os valores recebidos); `delivered_at` preenchido e `secrets_enc` nulo (CA-H011-04).
- T-H011-31 prioridade: com uma linha `lembrete` e uma `auth` pendentes, a `auth` sai primeiro (`comparePriority`); o envio direto não espera o tick (nenhum `TickService` no teste).
- T-H011-32 falha após o provedor aceitar (simula queda antes de `markSent`): segunda execução **não** chama o provedor de novo (`ja_entregue`) (CA-H011-06). Segunda execução com `indisponivel` antes de entregar: reenvia **o mesmo** link e código.
- T-H011-33 desafio expirado/substituído antes do envio → `falha('desafio_inativo')`, provedor nunca chamado, cota devolvida.
- T-H011-34 `nao_configurado` e cota negada: 202 mantido, saída `pendente`/`adiado_cota`, sem perda; após os 15 min o decorador recusa o envio tardio (nenhum link vencido sai).
- T-H011-35 erros e logs do provedor/decorador, capturados, **sem** endereço, token ou código em nenhum nível (CA-H011-15).
- T-H011-36 contador de chamadas: pedido e envio **nunca** chamam `createUser`/`generateLink`/`verifyOtp` (S-01 CA-S01-14/16; só H-012).
- T-H011-37 conteúdo do e-mail capturado: só link, código, prazo e aviso; sem dado de pedido ou terceiro (CA-H011-14).
- T-H011-38 Nenhum teste faz chamada de rede e nenhum usa `RESEND_API_KEY` real.

Evidência: `corepack pnpm check:all` local; registrar comando, contagem e código de saída na Issue.

## 7. Riscos

| # | Risco | Mitigação |
|---|---|---|
| R-1 | **Negação de acesso dirigida:** quem digita o e-mail de outra pessoa 5 vezes na hora (ou a cada 60 s) a deixa em 429 e lhe manda e-mails. | Inerente a limite por e-mail e à resposta uniforme. Reduz-se com limite por IP e global em H-015 (`ip_hmac` já guardado) e com o 429 sem custo de e-mail. Aceito para o MVP; H-015 decide teto global. |
| R-2 | **Adivinhar o código:** 6 dígitos, 5 tentativas por desafio, até 5 desafios/h/e-mail ⇒ ≤ 25 palpites/h (≈ 0,0025 % por hora, ≈ 1,8 % em 30 dias de ataque contínuo a um só e-mail). | Recomendar em H-015 um contador cumulativo de erros de código por e-mail (ex.: 15 em 24 h bloqueia só o **caminho do código**; o link segue valendo, sem negar o acesso legítimo). Sinal de abuso por `invalid_reason='tentativas'`. |
| R-3 | Segredos legíveis na memória/linha cifrada: vazamento da `AUTH_CHALLENGE_KEY` + leitura do banco expõe desafios **vivos** (≤ 15 min). | Vida curta, blobs zerados na entrega/uso/expiração, chave só no servidor, rotação versionada, nunca em log nem prompt. |
| R-4 | Envio pós-resposta interrompido (função encerrada): e-mail só sai no tick (≈ 1–2 min). | Contingência por job `email.send`; aceito e documentado (08 §12; R-1 de 35). |
| R-5 | Cota (100/dia) e domínio: ataque de enchente pode gastar a cota de login. | Reserva `auth` (10/dia); teto por e-mail; H-015 teto global; H-097 comportamento sob cota. Pedido barrado por limite não consome cota. |
| R-6 | Ajuste do `policy.ts` do H-092 pode quebrar testes existentes (`acesso_login` com `params: []`). | Atualizar T-H92-03 e a política no mesmo commit; rodar a suíte do H-092. |
| R-7 | `generateLink` para e-mail inexistente e demais provas do S-01 (§7 NÃO VERIFICADO). | Fora do pedido (H-012); H-011 não chama o Supabase Auth (T-H011-36). |
| R-8 | Corrida: consumo e invalidação simultâneos. | Mesma linha, `FOR UPDATE`; testes T-H011-23/24 com várias conexões. |
| R-9 | Falha após consumir e antes de criar a sessão (H-012): o cliente precisa pedir novo desafio. | Aceito; H-012 decide se consome depois de obter a sessão. |
| R-10 | Endereço de e-mail digitado errado cria desafio e e-mail ao terceiro. | Mensagem minimalista e "ignore se não foi você"; 5/h limita o efeito. |

## 8. Dúvidas ao Orquestrador (não bloqueantes; recomendação em itálico)

1. **D-H011-9 Nova chave `AUTH_CHALLENGE_KEY`** (32 bytes) e `SITE_URL` em `.env.example`/`.env.local`. O Orquestrador gera o valor sem imprimir e registra o nome na planilha de chaves. *Recomendação: aceitar; o DEV pode gerar a chave local.*
2. **D-H011-10 Ajuste ao H-092:** allowlist de `acesso_login` passa a aceitar `challenge_ref`. *Recomendação: aceitar dentro de H-011 (mudança de uma linha e do teste).*
3. **D-H011-11 Bloqueio cumulativo do caminho do código** (R-2) fica em H-015, não em H-011. *Recomendação: aceitar e acrescentar o critério à descrição de H-015.*
4. **D-H011-12 Documentação:** atualizar 09 (`auth_challenge`: `email_enc`, `secrets_enc`, `delivered_at`, `invalidated_at`, `invalid_reason`), 08 §5.1/§12.5 (envio por saída + disparo após a resposta, no lugar de "direto na requisição") e 14 (incluir H-092 nas dependências de H-011; H-097 passa a verificar cota/degradação sobre este mecanismo). *Recomendação: aceitar.*

## 9. Plano de execução para o DEV (ordem sugerida)

1. Domínio puro (`identity`) e testes T-H011-01..05; ajuste do `policy.ts`.
2. Renderizador e testes de conteúdo (T-H011-04, 37).
3. Migração + rollback + funções SQL + testes de banco T-H011-20..27.
4. Store Pg, diretório, decorador, manipulador do pedido, expurgo; testes T-H011-10..14 e 30..38.
5. `corepack pnpm check:all` local; evidências na Issue. Fora do escopo: HTTP e página do consumo (H-012), tela e nonce do código (H-013), sessão (H-014), limites por IP/global (H-015), textos finais e cota (H-094/H-097), envio real.

## Resumo em linguagem simples

O cliente informa o e-mail e a resposta é sempre a mesma, tenha ele cadastro ou não, porque o sistema nem olha se existe cadastro nessa hora. O e-mail leva um link e um código que valem 15 minutos, funcionam uma só vez, e cinco erros de código cancelam tudo.
Os dados ficam protegidos (nada legível no banco ou nos registros) e os testes usam envio de mentira; falta só criar uma chave interna nova, sem custo, e aprovar quatro ajustes pequenos.
