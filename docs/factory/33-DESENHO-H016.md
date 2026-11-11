# Desenho H-016 — Cadastro e login do profissional (Issue #29, WF-03, Architect)

- **Rastro:** 32-REFINO-H016 (CA-H016-01..22, D-H016-1..7); 08 §4, §5.1 a §5.4, §12, §15; 10 ADR-002, ADR-005, ADR-006, ADR-014, ADR-022; 09 §3.1, §3.3, §3.11; spikes/S-01-RESULTADO e 25-REFINO-S01 (sessão, hook, revogação); spikes/S-11-RESULTADO (e-mail sem domínio); 23-DESENHO-H006 e 28-DESENHO-H010 (padrão de papéis e de teste na nuvem); supabase/migrations 120000 a 190000 (`ops.rate_counter`, `private.*`, papéis `app_api`/`app_system`).
- **Natureza:** SOMENTE documento. Nenhum código, migração, usuário, e-mail ou configuração foi criado ou alterado. Houve uma única leitura de verificação (item 1.2).
- **Etiquetas:** `[DECIDIDO]` decisão do Orquestrador (D-H016-1..7) · `[DELEGADO]` ADR-005, ADR-006, S-01 · `[PROPOSTA]` deste desenho · `[VERIFICADO]` observado nesta sessão · `[NÃO VERIFICADO]` sem teste nem fonte lida nesta sessão.
- **Decisão:** ver §14.

---

## 0. Decisões de partida e decisões de desenho

| # | Decisão | Origem |
|---|---|---|
| D-H016-1 | Recuperação de senha entra em H-016 | [DECIDIDO] |
| D-H016-2 | Link de verificação: 15 min, uso único, consumo por POST | [DECIDIDO] |
| D-H016-3 | Login com e-mail não verificado abre sessão só para concluir a verificação | [DECIDIDO] |
| D-H016-4 | Senha mínima de 8 caracteres; espera progressiva a partir de 5 falhas | [DECIDIDO] |
| D-H016-5 | Sessão do profissional = mesmo `app_session`, 7 dias absolutos | [DECIDIDO] |
| D-H016-6 | Troca ou recuperação de senha encerra as demais sessões | [DECIDIDO] |
| D-H016-7 | Sem Docker; testes de autenticação rodam no banco e no Auth de **desenvolvimento na nuvem** | [DECIDIDO] |
| DD-1 | **Os e-mails de verificação e de recuperação são nossos**, não do Supabase Auth: desafio próprio (`auth_challenge`), enviado pelo `EmailProviderPort` (Mailpit em dev). O Auth nunca envia e-mail neste fluxo. Motivo: o Auth está na nuvem e não alcança um Mailpit local; o SMTP padrão dele envia 2 e-mails/h só à equipe (S-01 §2) e o SMTP via Resend exige domínio (S-11 §5). Mantém o padrão de link no fragmento, GET sem efeito e POST de consumo (ADR-005 §5.1). | [PROPOSTA] |
| DD-2 | **Fonte de verdade de "e-mail verificado" é `app.app_user.email_verified_at`**, nunca `auth.users.email_confirmed_at`. O Auth cria o usuário já confirmado (`email_confirm: true`) porque a recusa dele a contas "não confirmadas" impediria o login restrito de D-H016-3. | [PROPOSTA] |
| DD-3 | **Uma credencial de senha só é criada ou trocada com prova de controle do e-mail** (consumo de desafio) ou, para conta ainda **não verificada**, pelo próprio cadastro. Cadastro sobre e-mail já verificado nunca altera credencial (§3). | [PROPOSTA] |
| DD-4 | Bloqueio progressivo **conta antes de verificar a senha** e zera no sucesso (fecha a rajada concorrente). A chave é o HMAC do e-mail, exista ou não a conta. | [PROPOSTA] |
| DD-5 | H-016 **reutiliza** o serviço de sessão de H-012/H-014 (criar, validar, revogar, "sair de todos"); não cria segundo mecanismo. | [PROPOSTA] |

---

## 1. Fronteira: o que é do Supabase Auth e o que é nosso

### 1.1 Tabela de responsabilidades

| Tema | Supabase Auth | Nosso (API + Postgres) |
|---|---|---|
| Identidade (e-mail, `sub`) | `auth.users` guarda a credencial | `app.app_user` liga por `auth_user_id`; é a cópia canônica de domínio do e-mail normalizado (09 §3.1) |
| Senha | Guarda o hash e confere a senha (`signInWithPassword`, `admin.updateUserById`) | Valida a **política** antes de enviar (tamanho, lista local); **nunca** guarda, loga ou devolve a senha |
| E-mail verificado | Só transporta `email_confirmed_at = true` | `app_user.email_verified_at` (DD-2) |
| Cadastro | `admin.createUser` (chave secreta, só no servidor) | Fluxo, anti-enumeração, limites, perfil profissional |
| Link de verificação / recuperação | Não usado (DD-1) | `auth_challenge`: 256 bits, hash, 15 min, uso único, POST |
| Envio de e-mail | Não envia (nenhuma chamada que dispare e-mail é permitida: `signUp`, `resetPasswordForEmail`, `resend`, `signInWithOtp`) | `EmailProviderPort` + `email_outbox`; Mailpit em dev, classe `auth` na cota (ADR-022) |
| Bloqueio progressivo por conta | **Não existe** no Free (só limite por IP) | `ops.login_throttle` + `ops.rate_counter` (ADR-014) |
| Sessão de 7 dias absolutos, revogação por `sid` | Emite access/refresh; Free **não** limita duração (S-01 §2) | `app_session` (H-012/H-014); checada em **toda** requisição |
| Refresh token | Emite e renova | Fica **no servidor**; nunca no navegador (S-01 §8, Q7) |
| Papel (profissional, cliente, admin) | Não decide | `app_user` + `professional_profile` + guardas da API |
| Aprovação humana | Não sabe | `verification_status` (H-039); aqui só o estado inicial |
| Login social | Pode, mas desligado | Fora do MVP web (ADR-006 A; CA-H016-14) |

### 1.2 Configuração do projeto Auth de desenvolvimento (passo manual, fora do código)

Leitura feita em 2026-11-11 em `GET /auth/v1/settings` do projeto de desenvolvimento, com a chave pública, sem imprimir segredos: `disable_signup = false` e `mailer_autoconfirm = false` **[VERIFICADO]**. Ou seja, **hoje o cadastro público do Auth está aberto**: qualquer pessoa com a chave pública criaria usuário direto, sem passar por nossos limites, verificação ou perfil.

Ajustes exigidos antes de a H-016 fechar (painel; o dono executa ou autoriza, como na H-008):
1. **Desligar o cadastro público** (`disable_signup = true`). `admin.createUser` continua funcionando.
2. `jwt_expiry` = 900 s e repasse de IP `Sb-Forwarded-For` (S-01 §5, D4); já previstos para H-014.
3. Tamanho mínimo de senha do Auth = 8, para não ficar abaixo da nossa regra (a nossa continua sendo a primeira barreira).
4. Provedores sociais desligados (Google, Apple, qualquer outro).
5. "Sessão única por usuário" desligada (Pro mesmo; irrelevante no Free).

Prova obrigatória e repetível (teste T-H016-CFG): ler `/auth/v1/settings` e falhar se `disable_signup` for `false` ou se algum provedor externo além de e-mail estiver ligado.

Limite conhecido do Free **[VERIFICADO na doc oficial em 2026-11-11]**: o gancho de **verificação de senha** (que bloquearia tentativa direta) é de Teams/Enterprise; Free e Pro só têm Custom Access Token, Send Email e Before User Created. Consequência no risco R-H016-2.

---

## 2. Modelo de dados

Referência: 09 §3.1 e §3.3. Nomes e tipos são lógicos; as constraints, não.

### 2.1 Quem cria o quê

`app_user`, `app_session` e `auth_challenge` pertencem a H-011/H-012/H-014 (clientes). **H-016 só expande** (migração `AAAAMMDDHHMMSS_identity_create_professional_account.sql`, idempotente, com `rollbacks/*.down.sql`). Se a H-016 chegar antes, cria as três com o mínimo da 09 §3.1 usando `create table if not exists`, sem mudar o contrato abaixo.

### 2.2 Sem duplicar identidade

```
auth.users (Supabase)           app.app_user                    app.professional_profile
  id (sub) ────────────────────── auth_user_id (único, sem FK)
  email, hash da senha            id (uuid)  ◄──────────────────── user_id (PK/FK app_user.id)
  email_confirmed_at (ignorado)   email (normalizado, único)       verification_status (default 'pendente')
                                  email_verified_at (verdade)      verified_at, suspended_at, suspension_reason
                                  status (ativo|bloqueado)         created_at, updated_at
```

- **Sem chave estrangeira para `auth.users`** (o backup exclui o esquema `auth`, 28 §1.3; a restauração e a ordem de criação não dependem dele). A integridade é garantida por teste de reconciliação (§12, T-H016-REC) e pelo job de expurgo de órfãos (§3.2).
- `professional_profile` guarda **só o que é do profissional**. Nada de e-mail, senha ou nome do Auth. CPF/CNPJ, nome público, `slug` e serviços chegam por expand em H-035/H-036 (09 §3.3). O perfil nasce na hora do cadastro, com `verification_status = 'pendente'` (CA-H016-01, CA-H016-21).
- A mesma pessoa pode ser cliente e profissional (08 §5.2): é **o mesmo `app_user`** e o mesmo usuário do Auth. Ver DD-3 e §3.2 (caso "cliente que vira profissional").
- **Trigger/guarda de coluna:** o papel `app_api` não tem `UPDATE` em `verification_status`, `verified_at`, `suspended_at`; só a função de decisão (H-039) o altera (impede autoaprovação). Testado.
- `professional_profile` e `app_user` têm RLS habilitada e forçada, sem política para `anon`/`authenticated`; leitura do profissional é só pela API, com view de colunas explícitas (08 §4.2).
- O vínculo `app_user.email` ↔ Auth: o e-mail só muda por fluxo nosso com step-up e por uma operação que atualiza os dois lados e é reconciliada. **A troca de e-mail não está nesta história** (§13, Q-4).

### 2.3 `auth_challenge` (expand)

- Novos valores de `purpose`: `professional_verify`, `password_reset`, `professional_activate`. `code_hmac`, `draft_id` e `browser_nonce_hash` ficam nulos para estes (não há código de 6 dígitos nem rascunho).
- Nova coluna `user_id uuid` (obrigatória para os três novos propósitos) e `superseded_at timestamptz`.
- `token_hash` = SHA-256 do segredo de 256 bits; o segredo nunca é gravado. `expires_at = created_at + 15 min` (parâmetro `auth.challenge.ttl_seconds`, 900, tanto para verificação quanto para recuperação).
- Único parcial `(user_id, purpose) WHERE consumed_at IS NULL AND superseded_at IS NULL`: **um desafio pendente por usuário e finalidade**; novo desafio marca o anterior como `superseded_at` na mesma transação.
- Consumo atômico (uso único mesmo sob concorrência):
  `UPDATE ... SET consumed_at = now() WHERE token_hash = $1 AND consumed_at IS NULL AND superseded_at IS NULL AND expires_at > now() RETURNING id, user_id, purpose`.
- Expurgo técnico por TTL (RC-09), junto com os desafios de cliente.

### 2.4 `ops.login_throttle` (novo)

`key_hmac text PK` (HMAC do e-mail normalizado com `PEPPER_EMAIL_HMAC`, 64 hex como em `rate_counter`), `failures int`, `last_failure_at`, `locked_until`, `updated_at`. RLS habilitada e forçada; `revoke all` de `public/anon/authenticated/service_role`; acesso somente por funções `private.login_throttle_*` `SECURITY DEFINER`, `set search_path = ''`, concedidas a `app_system` (mesmo padrão de `private.job_*` e `private.idempotency_*`, migração 130000 §8). Expurgo: linhas sem falha há 24 h.

### 2.5 `app_session`

Sem coluna nova. `method` do login (`password` | `challenge`) pode ir em `amr` já previsto pelo S-01; `recent_auth_at = now()` no login por senha (satisfaz o step-up de 30 min, CA-H016-20). **Nível de acesso é derivado, não armazenado**: `access_level = email_verified_at IS NULL ? 'verification_only' : 'full'` (P5; a sessão passa a `full` quando a verificação é confirmada, sem novo login).

### 2.6 Parâmetros (`ops.app_config`, todos [PROPOSTA]; nada semeado pela migração, os padrões ficam no código até a primeira escrita)

| Chave | Padrão | Observação |
|---|---|---|
| `auth.challenge.ttl_seconds` | 900 | D-H016-2 |
| `auth.password.min_length` | 8 | D-H016-4 |
| `auth.login.free_failures` | 4 | a 5ª falha já gera espera |
| `auth.login.wait_base_seconds` / `wait_cap_seconds` | 30 / 900 | espera = `min(base × 2^(f−5), cap)` para `f ≥ 5` |
| `auth.login.reset_after_seconds` | 86400 | zera o contador após 24 h sem falha |
| `auth.login.ip_window_seconds` / `ip_max` | 900 / 30 | falhas+tentativas por `ip_hmac`, qualquer e-mail |
| `auth.register.email_per_hour` / `ip_per_hour` | 3 / 10 | RF-040 |
| `auth.mail.min_interval_seconds` | 60 | reenvio de verificação e recuperação |
| `auth.mail.email_per_hour` / `ip_per_hour` | 5 / 20 | reenvio e recuperação |
| `auth.consume.ip_per_15min` | 30 | POST de consumo de link |
| `auth.response_floor_ms` | 400 | tempo mínimo de resposta de cadastro, login e pedidos de e-mail |

Sequência de espera pelos padrões: falha 5 → 30 s, 6 → 60 s, 7 → 2 min, 8 → 4 min, 9 → 8 min, 10 em diante → 15 min.

---

## 3. Cadastro

`POST /v1/auth/professional/register` com `{email, password}`. Resposta **única** em qualquer caminho válido: `202 {"status":"accepted"}`.

### 3.1 Passos

1. **Validação (antes de qualquer consulta):** e-mail normalizado (09 §1), ≤ 254; senha: ≥ 8 caracteres, **≤ 72 bytes UTF-8** (limite do bcrypt, `[NÃO VERIFICADO]` no Auth atual), sem caracteres de controle, diferente do e-mail e fora de uma lista local de senhas comuns (arquivo versionado, ~1.000 itens, grátis). Falha → `422` com o campo (`password` ou `email`) e sem criar nada (CA-H016-03). Esta resposta não depende de a conta existir.
2. **Limites** por HMAC do e-mail e do IP (`auth.register.*`); excesso → `429` com `Retry-After`. Conta mesmo para e-mail inexistente.
3. **Busca** `app_user` por e-mail, e bifurca:

| Situação do e-mail | O que acontece (resposta e tempo iguais) |
|---|---|
| **Inexistente** | `admin.createUser({email, password, email_confirm:true})` → transação nossa: `app_user` (`email_verified_at` nulo), `professional_profile` (`pendente`), desafio `professional_verify`, item do `email_outbox` (modelo "confirme seu e-mail") |
| **Existe, não verificado, com perfil profissional** | Senha **substituída** por `admin.updateUserById` (vale a do último cadastro: fecha o pré-sequestro por quem cadastrou antes), desafios anteriores `superseded`, todas as sessões revogadas, novo desafio `professional_verify` e e-mail |
| **Existe, verificado, com perfil profissional** | **Nenhuma credencial muda** (DD-3). Desafio `password_reset` e e-mail "você já tem cadastro; se foi você, defina uma nova senha aqui" |
| **Existe, verificado, sem perfil profissional (cliente)** | Nenhuma credencial muda. Desafio `professional_activate` e e-mail "confirme para criar seu perfil de profissional". O consumo define a senha, cria `professional_profile` (`pendente`) e revoga as demais sessões (§6) |
| **Admin ou `status='bloqueado'`** | Nada é criado nem enviado (H-017, 08 §5.2). Resposta e tempo iguais, por piso de tempo e por trabalho equivalente |

4. **Piso de tempo** (`auth.response_floor_ms`) e mesmo volume de trabalho em todos os ramos (CA-H016-02). O teste mede a diferença das medianas (§12).

### 3.2 Compensação (Auth e Postgres não são uma transação só)

- Ordem: Auth primeiro, depois a transação nossa. Se a transação falhar, apagar o usuário do Auth em melhor esforço e devolver `503`; sem resposta 202 falsa.
- `createUser` com `email_exists` e **sem** `app_user`: usuário órfão no Auth (falha anterior). Recuperar o `id` pela resposta de `admin.generateLink` (que devolve o usuário sem enviar e-mail, S-01 §2) **[NÃO VERIFICADO]**; plano B: consulta SQL de leitura à `auth.users` por papel de serviço **[NÃO VERIFICADO]**; plano C: apagar e recriar. A prova decide (T-H016-AUTH-03).
- Corrida de dois cadastros do mesmo e-mail: a unicidade de `app_user.email` serializa; o perdedor segue o ramo "existente".
- Job de expurgo (junto do H-008): `app_user` não verificado sem desafio pendente há mais de 7 dias é removido com o usuário do Auth e o perfil (`[PROPOSTA]`, sem dado real; vira regra de retenção RC-02 quando o jurídico definir, 09 §8).

### 3.3 Cadastro e termos

O aceite dos termos de uso no cadastro **não consta** nos CA-H016. Não é inventado aqui; ver Q-3.

---

## 4. Verificação de e-mail

1. O e-mail leva `APP_BASE_URL/profissional/verificar#t=<segredo>` (segredo no **fragmento**; a página responde `Cache-Control: no-store`, `Referrer-Policy: no-referrer`).
2. **GET não tem efeito** (CA-H016-07): a página só mostra o botão "Confirmar e-mail". Scanners de e-mail que fazem GET, mesmo executando JS sem clicar, não consomem o link.
3. O clique envia `POST /v1/auth/professional/verification/confirm {token}`:
   - Consome o desafio de forma atômica (§2.3). Sucesso: `email_verified_at = now()` (se nulo), `204`. **Não abre sessão**: o profissional entra com a senha.
   - Expirado, usado, substituído ou inexistente: **o mesmo** `410 {"code":"link_invalid"}`, sem distinguir, e a tela oferece reenvio (CA-H016-08).
4. **Reenvio:** `POST /v1/auth/professional/verification/resend {email}` (público) ou sem corpo, com a sessão restrita. Sempre `202` uniforme. Intervalo mínimo e tetos por e-mail e IP (`auth.mail.*`); excesso → `429` com `Retry-After` (CA-H016-09). Se a conta não existe ou já está verificada, não envia nada (resposta e tempo iguais).
5. Consumir **qualquer** desafio (verificação, recuperação ou ativação) prova controle do e-mail e define `email_verified_at` se estava nulo.
6. Em dev e CI o e-mail vai **somente** ao Mailpit (I-27, CA-H016-06); ver §10.

---

## 5. Login, bloqueio progressivo e sessão restrita

`POST /v1/auth/professional/login {email, password}`.

### 5.1 Sequência

1. Validação de forma (não revela existência). Senha acima de 72 bytes → mesma falha de credencial (sem `422` específico).
2. **Limite por IP** (`auth.login.ip_*`): excesso → `429` com `Retry-After`.
3. **Bloqueio por e-mail (DD-4)**, em uma chamada atômica `private.login_throttle_begin(key_hmac)`:
   - Se `locked_until > now()` → `429` com `Retry-After = locked_until − now()`, **sem verificar a senha** (nem a correta passa durante a espera, CA-H016-12). Vale igual para e-mail inexistente.
   - Senão, incrementa `failures` de forma otimista, calcula `locked_until = now() + espera(failures)` e devolve; **a tentativa já nasce contada**, então 100 pedidos simultâneos recebem 4 verificações e 96 recusas por espera.
4. `signInWithPassword` no servidor (chave pública do projeto, sem persistir sessão). Falha de credencial **ou** e-mail inexistente → `401 {"code":"invalid_credentials"}`, mesma mensagem, mesmo tempo (piso de `auth.response_floor_ms`) (CA-H016-11). `429` do próprio Auth (limite por IP, R-H016-3) vira `429` nosso com `Retry-After`.
5. Sucesso: `private.login_throttle_reset(key_hmac)` (apaga a linha). Mapeia `auth_user_id → app_user`. Sem `app_user` (órfão), admin ou `status='bloqueado'` → `403 {"code":"account_unavailable"}` genérico (só quem acertou a senha o vê). Cria a sessão por `SessionService.create` (DD-5):
   `app_session` com `expires_at = now() + 7 dias` **absolutos**, `recent_auth_at = now()`, `auth_session_id = session_id` do Auth; tokens do Auth ficam no servidor; o navegador recebe só o cookie da sessão (HttpOnly, Secure, `SameSite=Lax`, prefixo `__Host-`), igual ao cliente (S-01 §8).
6. Resposta: `200` com `{access_level, email_verified, verification:{status, explanation_code}}` (CA-H016-10, RF-053).

### 5.2 Sessão restrita (D-H016-3, CA-H016-13)

`access_level = verification_only` enquanto `email_verified_at` for nulo. Rotas permitidas (matriz em `packages/access-matrix`): `GET /v1/professional/me`, reenvio da verificação, `logout`, `logout-all`, step-up. **Todo o resto de profissional** responde `403 {"code":"email_not_verified"}` na camada de guarda da API, antes do serviço (CA-H016-05). O estado vem do banco a cada requisição, nunca do token.

### 5.3 Pontos finos

- Sucesso zera o contador; falha mantém. O contador também decai após 24 h sem falha.
- Quem acerta a senha **depois** da espera entra normalmente. A espera não se estende por tentativas recusadas durante ela (não conta tentativa bloqueada), para limitar o ataque de negação de serviço contra a vítima (R-H016-6).
- A recuperação de senha **não** é bloqueada pela espera do login, e um consumo bem-sucedido zera o contador.
- Logs: só o código do evento e os 8 primeiros hex do HMAC; **nunca** e-mail, IP, senha ou token (P8, H-007).

---

## 6. Recuperação e troca de senha

### 6.1 Recuperação (D-H016-1, CA-H016-15 a 17)

1. `POST /v1/auth/password/recovery {email}` → `202` uniforme sempre. Limites e piso de tempo como em §4.4. Existindo `app_user` profissional: desafio `password_reset` (substitui o pendente) e e-mail. Conta **não verificada**: o mesmo `password_reset` (o consumo também verifica o e-mail, §4.5). Inexistente, admin ou bloqueado: nada enviado. Excesso → `429` (CA-H016-17).
2. A página `#t=<segredo>` mostra o formulário da nova senha (GET sem efeito).
3. `POST /v1/auth/password/reset {token, new_password}`. Transação única:
   - Trava a linha do desafio (`FOR UPDATE`), valida política da senha (`422` mantém o link válido).
   - `admin.updateUserById(auth_user_id, {password})` dentro do prazo curto do pedido (timeout de 5 s). Falha → rollback, o link continua válido, `503`.
   - Marca `consumed_at`, define `email_verified_at` se nulo, **revoga todas as sessões** do usuário (`app_session.revoked_at`, D-H016-6), zera `login_throttle`, enfileira o e-mail informativo "sua senha foi alterada" (classe `auth`), e (se `professional_activate`) cria o `professional_profile`.
   - Link inválido, expirado ou usado → `410 link_invalid` único.
   - Não abre sessão.
4. Se o commit falhar depois de o Auth ter trocado a senha, o link pode ser usado de novo uma vez; só quem tem o link (dono do e-mail) o faz. Risco aceito e registrado (R-H016-9).

### 6.2 Troca de senha logado e step-up (CA-H016-20)

- `POST /v1/auth/step-up {password}`: confere a senha com o mesmo caminho e **o mesmo limite** do login (§5.1, passos 2 a 4) e atualiza `app_session.recent_auth_at`. Janela de 30 min (`[DELEGADO]`, 08 §5.4).
- `POST /v1/professional/password/change {new_password}`: exige `recent_auth_at` ≤ 30 min, senão `401 step_up_required`. Aplica a política, `admin.updateUserById`, revoga **as outras** sessões (mantém a atual), envia o e-mail informativo. Sessão restrita (e-mail não verificado) não troca senha.
- A **troca de e-mail** não existe nesta história (Q-4); o guarda de step-up fica pronto para ela.

### 6.3 Como a revogação funciona sem rota admin no Auth

Os refresh tokens do Auth ficam só no servidor, atados a `app_session`. Revogar `app_session` (checado em toda requisição, S-01 D2) já derruba o acesso e impede qualquer renovação; o refresh do Auth fica órfão e inútil. `signOut` do Auth é chamado quando houver o JWT (defesa em profundidade). Remoção de linhas de `auth.sessions` por SQL fica **[NÃO VERIFICADO]** (S-01 §7) e não é requisito.

---

## 7. Regras de sessão do profissional (resumo)

- Mesmo `app_session` do cliente; **7 dias absolutos**, sem prorrogação pelo uso (CA-H016-18, S-01 D3); só o token de acesso (900 s) renova, serializado por `sid` (S-01 D5).
- Expirar não altera dados de negócio (S-01 D7, CA-H016-18): só `app_session`.
- "Sair" revoga a atual; "sair de todos" revoga todas (CA-H016-19, H-014). Novo login não revoga as anteriores (S-01 D6), exceto por troca/recuperação de senha (D-H016-6).
- Papel e nível de acesso vêm do banco em cada requisição (`app.principal_type='professional'`, `app.aal`, `app.sid` por `set_config(..., true)`, 08 §4.2).
- Um token do Auth obtido **fora** da API (login direto na URL pública do Auth) não tem `app_session` e é recusado pela API (R-H016-2).

---

## 8. Antes da aprovação humana (CA-H016-21, CA-H016-22, CA-H016-05)

- `GET /v1/professional/me` devolve códigos, não texto: `{email_verified, verification:{status:'pendente', explanation_code:'human_review_no_deadline'}}`. A tela explica "revisão por pessoa, meta de 2 dias úteis, não é promessa" (RF-050).
- **Guarda única** `ProfessionalEligibility` (função pura no `packages/domain`, usada pela API e testável): `allowed` só se `email_verified_at IS NOT NULL` **e** `verification_status = 'aprovada'` (acesso comercial e suspensões entram em H-042/H-045). Qualquer outro estado → negado e **nada é criado**. H-016 entrega a função, a linha na matriz de acesso e os testes de unidade; H-042 e H-058 ligam o resultado às rotas reais.
- Defesa em profundidade (P2): função SQL `private.is_email_verified(user_id)` para os triggers de publicação e de aceite (H-031, H-058) usarem. Os triggers são dessas histórias; a H-016 entrega a função e o teste dela.
- Os testes de ponta a ponta de "aceitar por API direta" (CA-H016-22) usam um **controlador de teste** em `packages/testkit` (as rotas reais ainda não existem) e passam a rotas reais quando H-031/H-058 chegarem; os testes ficam como regressão em H-042.

---

## 9. Contrato resumido de API (comportamento obrigatório; nomes de rota podem mudar com a revisão do DEV)

| Rota | Sucesso | Erros |
|---|---|---|
| `POST /v1/auth/professional/register` | `202` uniforme | `422` campo; `429` + `Retry-After` |
| `POST /v1/auth/professional/verification/resend` | `202` uniforme | `429` + `Retry-After` |
| `POST /v1/auth/professional/verification/confirm` | `204` | `410 link_invalid` |
| `POST /v1/auth/professional/login` | `200` + cookie de sessão | `401 invalid_credentials`; `403 account_unavailable`; `429` + `Retry-After` |
| `POST /v1/auth/password/recovery` | `202` uniforme | `429` + `Retry-After` |
| `POST /v1/auth/password/reset` | `204` | `410 link_invalid`; `422` senha |
| `POST /v1/auth/step-up` | `204` | `401 invalid_credentials`; `429` |
| `POST /v1/professional/password/change` | `204` | `401 step_up_required`; `422`; `403 email_not_verified` |
| `GET /v1/professional/me` | `200` estado | `401` |
| `POST /v1/auth/logout`, `/logout-all` | `204` | (H-014) |

Todas as respostas de erro usam um corpo de código estável, sem eco de e-mail, senha ou token. Nenhuma resposta traz `hashed_token`, `email_otp`, `action_link` ou token do Auth.

---

## 10. E-mail

- Modelos novos (versionados, em português simples): `professional_verify`, `password_reset`, `professional_activate`, `password_changed`. Conteúdo mínimo: sem dados pessoais além do endereço de destino; o link é a única parte sensível e nunca vai a log.
- Todos pela classe **`auth`** do `email_outbox`, com `dedupe_key` por desafio e envio direto na requisição com a fila como contingência (08 §12.5). Em cota apertada passam na frente (reserva `auth`, ADR-022).
- **Mailpit:** hoje não há `mailpit` no PATH desta máquina **[VERIFICADO]** e o adapter Mailpit é da H-093. A H-016 define o uso da **porta**; a prova de CA-H016-06 exige o adapter Mailpit e o próprio Mailpit rodando. Mailpit tem binário único para Windows, sem Docker **[NÃO VERIFICADO]**; instalá-lo é tarefa de H-093 (ver §13).
- Teste automático de CI e de unidade: dublê de captura da `EmailProviderPort` (sem rede). Teste manual/de integração: Mailpit.
- Abuso: o cadastro e a recuperação enviam e-mail a endereços escolhidos por terceiros (risco de spam e de consumo da cota de 100/dia): limites por e-mail e IP, `dedupe_key`, teto diário `auth.mail.daily_cap` `[PROPOSTA]` e desafio anti-bot condicional (SD-05) se o teto for atingido.

---

## 11. Riscos

| # | Risco | Tratamento |
|---|---|---|
| R-H016-1 | **Cadastro público do Auth aberto** (`disable_signup=false` [VERIFICADO]) permite criar usuário fora do nosso fluxo | Desligar (passo manual §1.2) e teste T-H016-CFG |
| R-H016-2 | **Login direto no Auth** contorna o bloqueio progressivo (gancho de senha é Teams/Enterprise) | Residual aceito: a API só aceita sessão com `app_session`, então o token direto não vale nada nela; o Auth mantém limite por IP; senha mínima de 8 mais lista local; monitorar volume de `/token` no painel do Auth. Sem hook, não é possível fechar por completo no Free. Mitigação futura: plano Teams ou verificação de senha própria. Pede ciência do Orquestrador (Q-1) |
| R-H016-3 | Limite do Auth por IP vira limite global (chamadas saem do servidor) | `Sb-Forwarded-For` habilitado (S-01 R1); `429` do Auth vira `429` nosso; medir |
| R-H016-4 | Enumeração por resposta, tempo, `429` ou e-mail diferente | Respostas e piso de tempo iguais; contadores independem da existência; medição no teste |
| R-H016-5 | Pré-sequestro de conta (atacante cadastra o e-mail da vítima antes) | DD-3: cadastro sobre não verificado substitui a senha; sobre verificado não altera; consumo revoga sessões. Resto: atacante que cadastra de novo **depois** da vítima e antes de ela clicar. Efeito pequeno: nada é liberado sem aprovação humana, e o e-mail avisa "se não foi você, ignore" |
| R-H016-6 | Negação de serviço do login (atacante gasta as tentativas da vítima) | Teto de 15 min, espera não se estende durante o bloqueio, recuperação não é bloqueada |
| R-H016-7 | Cota de e-mail (100/dia) esgotada por cadastros e recuperações | Limites, teto diário, classe `auth` com reserva, SD-05 condicional |
| R-H016-8 | Auth e Postgres sem transação única (órfãos) | Ordem Auth→banco, compensação, expurgo e reconciliação (§3.2, T-H016-REC) |
| R-H016-9 | Link reutilizável se o commit falhar após o Auth trocar a senha | Janela mínima, só o dono do e-mail; registrado |
| R-H016-10 | Teste na nuvem polui o Auth/banco de desenvolvimento e bate no limite por IP | Usuários sintéticos com prefixo, execução serial, limpeza em `finally`, orçamento de chamadas, trava de projeto (§12.2) |
| R-H016-11 | `email_exists`, `generateLink` sem envio e comportamento do hook são hipóteses da doc | T-H016-AUTH-*; se falharem, plano B do §3.2 |
| R-H016-12 | Senha acima de 72 bytes truncada ou recusada pelo Auth [NÃO VERIFICADO] | Teto de 72 bytes na validação, teste dedicado |
| R-H016-13 | Aceite dos termos e base legal no cadastro não estão nos CA | Q-3; `[PENDENTE JURÍDICO]` L2 |
| R-H016-14 | Mailpit fora do PATH e adapter da H-093 ainda inexistente | Dependência registrada (§13); dublê para CI |

---

## 12. Testes para o DEV

### 12.1 Camadas

| Camada | Onde roda | Conteúdo |
|---|---|---|
| **U** unidade | Vitest, sem rede nem banco | política de senha; cálculo da espera; derivação de `access_level`; `ProfessionalEligibility`; máquina de estados do desafio com `AuthGatewayPort` falso e `EmailProviderPort` de captura |
| **B** banco de dev (`*.dbtest.mjs`, padrão existente) | Postgres do projeto de **desenvolvimento**, em transação com rollback | constraints, RLS, grants, único parcial do desafio, consumo atômico sob concorrência, `login_throttle` sob concorrência, coluna protegida, reconciliação |
| **A** Auth de dev (`*.authtest.mjs`, **novo**) | Auth do projeto de **desenvolvimento** | contrato real com usuários sintéticos |
| **S** estático | Vitest | proibição de chamadas que enviam e-mail; ausência de segredo e senha em log |

Docker não é usado (D-H016-7). Mailpit só no teste manual de CA-H016-06.

### 12.2 Regras da camada A (Auth na nuvem)

- Usuários `h016-<execução>-<n>@sintetico.test`, criados por `admin.createUser`; todos removidos em `finally` (Auth e linhas nossas), mesmo na falha.
- Trava de projeto (como `BACKUP_EXPECTED_DB_REF`, 28 §1.2): variável com o identificador esperado; recusa executar se a URL não coincidir. Nenhuma chave é impressa.
- Execução **serial**, orçamento de ≤ 40 chamadas ao Auth por rodada (limite por IP do Free; S-01 §2). Nenhuma chamada que envie e-mail do Auth (T-H016-S01 garante).
- Fica **fora** do `check:all` padrão; comando separado `pnpm test:auth-dev`, que o DEV executa e registra na Issue (comando, contagem, código de saída). Os testes B e U entram no `check:all`.

### 12.3 Matriz CA → teste

| Teste | Camada | Cobre |
|---|---|---|
| T-H016-01 cadastro novo: `app_user` (não verificado), `professional_profile` `pendente`, desafio e e-mail na captura | U+B+A | CA-01 |
| T-H016-02 e-mail existente: mesma resposta; diferença das medianas de tempo ≤ 60 ms em 30 repetições (verificado, não verificado, inexistente, admin, bloqueado); e-mails e contadores equivalentes | U+A | CA-02 |
| T-H016-03 senha curta, > 72 bytes, igual ao e-mail, da lista: `422` no campo, nada criado | U | CA-03 |
| T-H016-04 senha, token e e-mail ausentes de logs, respostas e mensagens de erro (inclui falha forçada) | S+U | CA-04 |
| T-H016-05 profissional não verificado: toda rota fora da lista permitida → `403 email_not_verified`, nada criado; `ProfessionalEligibility` nega para os 5 estados não aprovados | U+B | CA-05, CA-22 |
| T-H016-06 verificação chega ao Mailpit local; nenhum envio externo; `EMAIL_PROVIDER` de dev ≠ Resend | manual+U | CA-06 |
| T-H016-07 GET da página não consome; POST consome; uso único sob 20 POST concorrentes (1 sucesso); expiração aos 15 min com relógio injetado | U+B | CA-07 |
| T-H016-08 expirado, usado, substituído, desconhecido → o mesmo `410 link_invalid` | U+B | CA-08 |
| T-H016-09 reenvio: intervalo mínimo, tetos por e-mail e IP → `429` com `Retry-After`; mesmo comportamento para e-mail inexistente | U+B | CA-09, CA-17 |
| T-H016-10 login correto verificado: sessão de 7 dias, `access_level=full` | A | CA-10, CA-18 |
| T-H016-11 senha errada × e-mail inexistente: corpo, status e tempo equivalentes | A+U | CA-11 |
| T-H016-12 progressivo: 4 falhas sem espera; 5ª → 30 s; 6ª → 60 s; teto 15 min; senha correta durante a espera → `429`; após a espera entra e zera; **50 tentativas concorrentes** → no máximo 4 verificações reais; e-mail inexistente se comporta igual; decaimento após 24 h | U+B | CA-12 |
| T-H016-13 login não verificado: sessão `verification_only`; rotas restritas negadas; após `confirm` vira `full` sem novo login | A+U | CA-13 |
| T-H016-14 tela e rotas de login sem Google/Apple; provedores externos desligados | S+CFG | CA-14 |
| T-H016-15 recuperação: resposta única, e-mail só para conta existente, não verificada também | U+A | CA-15 |
| T-H016-16 reset: link vira inválido, senha antiga falha, nova entra, **todas as outras sessões revogadas** (requisição com `sid` antigo → 401 na hora), contador zerado, e-mail informativo; falha do Auth no meio → link continua válido | U+B+A | CA-16, D-H016-6 |
| T-H016-17 excesso de recuperações → `429` | U+B | CA-17 |
| T-H016-18 sessão: `expires_at − created_at = 7 dias`; uso no 6º dia não muda `expires_at`; 7 dias e 1 min → 401 sem alterar dados | U+B | CA-18 |
| T-H016-19 sair e sair de todos (reuso dos testes de H-014 com profissional) | B | CA-19 |
| T-H016-20 step-up: > 30 min → `401 step_up_required` na troca de senha; step-up com senha errada conta no mesmo limite do login; troca mantém a sessão atual e revoga as outras | U+B | CA-20 |
| T-H016-21 `GET /me` de conta nova verificada devolve `pendente` e código de explicação | U | CA-21 |
| T-H016-22 `verification_status` não é gravável pelo `app_api`; sem política para `anon`/`authenticated` | B | segurança CA-21/22 |
| T-H016-CFG `/auth/v1/settings`: `disable_signup=true`, só e-mail ligado | A | R-1 |
| T-H016-AUTH-01 `signInWithPassword` com `email_confirm:true` funciona | A | DD-2 |
| T-H016-AUTH-02 token obtido direto no Auth (sem `app_session`) → `401` em rota da API | A | R-2 |
| T-H016-AUTH-03 `email_exists` e recuperação do `id` do órfão (ou plano B) | A | §3.2 |
| T-H016-AUTH-04 `admin.updateUserById(password)` e a senha antiga deixa de valer | A | §6.1 |
| T-H016-S01 nenhum uso de `signUp`, `resetPasswordForEmail`, `resend`, `signInWithOtp`, `generateLink` com envio no código da API | S | DD-1 |
| T-H016-REC todo `app_user` profissional tem usuário no Auth e o inverso (relatório de órfãos) | A | R-8 |
| T-H016-MIG migração sobe do zero; catálogo: RLS habilitada e forçada em `professional_profile` e `login_throttle` | B | H-003 |

### 12.4 Evidência

O DEV registra na Issue, para cada camada: comando, contagem e código de saída; a configuração lida em `/auth/v1/settings` (apenas os campos de interesse); medianas de tempo do T-H016-02; e a lista de usuários sintéticos criados e removidos. Nenhum valor de `.env.local`, token ou senha entra no relatório.

---

## 13. Dependências, ajustes de backlog e dúvidas ao Orquestrador

**Dependências que o DEV precisa respeitar (ajuste ao quadro):**
1. **H-014 (e H-012) antes do login:** a sessão do profissional usa o `SessionService`. O backlog lista só H-003 e S-11; precisa incluir **S-01, H-012 e H-014** (achado 1 do PO). Se o Orquestrador preferir não esperar, a H-016 pode ser entregue em duas partes: (a) cadastro, verificação e recuperação (sem sessão), (b) login e troca de senha depois de H-014.
2. **H-093 (Mailpit):** o adapter Mailpit e o próprio Mailpit são pré-requisito para CA-H016-06; sem eles a prova ficaria só no dublê. Incluir H-093 (ao menos o adapter de dev) em Dep. ou antecipá-lo.
3. **Prova pendente do S-01** (criação real de sessão, `sid` por hook, revogação) vale também aqui; os testes da camada A repetem o necessário.
4. **Passo manual do dono:** desligar o cadastro público do Auth de dev e demais ajustes do §1.2.

**Dúvidas (numeração provisória Q-H016-n):**
- **Q-1 (ciência, não bloqueia):** aceitar o risco residual R-H016-2 (login direto no Auth fora do bloqueio progressivo, sem gancho de senha no Free)? Alternativas: (a) aceitar com monitoramento e senha forte (recomendado, MVP sem dado real); (b) exigir plano Teams (fora do orçamento); (c) desistir da senha do Auth e verificar hash próprio (muda ADR-006/stack). Recomendação: **(a)**.
- **Q-2:** o consumo do link de verificação **não** abre sessão (o profissional digita a senha em seguida). Alternativa: abrir sessão no consumo (parecido com o cliente). Recomendação: **não abrir**, porque o link prova o e-mail, não a senha, e evita sessão por link de e-mail encaminhado.
- **Q-3:** aceite de termos e política de privacidade no cadastro não está nos CA; confirmar se entra na H-016 ou em história própria (`[PENDENTE JURÍDICO]` L2). Recomendação: história própria, antes de qualquer dado real.
- **Q-4:** troca de e-mail do profissional não tem RF nem história. Recomendação: fora de H-016; o guarda de step-up fica pronto e o CA-H016-20 é provado com a troca de senha.
- **Q-5:** lembrete de que o PRD ainda não tem RF para recuperação de senha, sessão do profissional e limites de login (achados 2 e 3 do PO). Recomendação: o PO abrir RF novos antes da implementação.

---

## 14. Decisão

**APROVADO_ARQUITETURA** para a H-016, com as condições de ordem do §13 (itens 1, 2 e 4) registradas como ajuste ao quadro, não como mudança de desenho. Nenhuma alteração de stack, nenhum componente novo fora da stack, nenhuma conta ou serviço pago. O desenho mantém Supabase Auth para a identidade e senha, e põe nosso o que o plano gratuito não oferece: e-mail dos links, bloqueio progressivo, sessão de 7 dias e guarda de estado.

## Resumo em linguagem simples

O profissional cria a conta com e-mail e senha, confirma o e-mail por um link que vale 15 minutos e só funciona uma vez, e entra com a senha; depois de 5 erros seguidos o sistema o faz esperar, e a espera cresce a cada erro. Quem esqueceu a senha recebe um link para trocar, e a troca encerra os outros acessos; até uma pessoa aprovar o cadastro, ele não oferece trabalho.
Para isso funcionar, o dono precisa desligar o cadastro aberto do serviço de contas (hoje está aberto) e o login dependerá do trabalho de sessão e de e-mail local, ainda não feitos.
