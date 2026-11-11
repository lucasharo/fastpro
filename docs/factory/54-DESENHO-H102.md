# Desenho H-102 — RBAC e MFA no admin (Issue #111, WF-03, Arquitetura)

- **Decisão:** APROVADO_ARQUITETURA, com 5 dúvidas não bloqueantes (§9).
- **Rastro:** 53-REFINO-H102 (CA-H102-01..11); decisões D-H102-1..9 do Orquestrador; 08 §4.2, §5.2, §13; 09 §3.12; 10 ADR-012; 11 R-21, T-08; 46-DESENHO-H012 (padrões de consumo por POST, etapa de sessão, RLS, cabeçalhos); 26/S-08-RESULTADO (MFA TOTP gratuito, `VERIFICADO`); código lido (somente leitura): migrações `20261110140000_audit_create_event_chain`, `20261111150000_identity_create_session_stage`, `20261111170000_identity_create_rate_limits`; `packages/db/src/challenges-crypto.ts`, `audit.ts`.
- **Natureza:** documento. Nenhum código, migração, teste, convite, conta, chave ou e-mail foi criado.
- **Etiquetas:** `[DECIDIDO]` Orquestrador · `[VERIFICADO]` lido no repositório · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]` depende de prova em desenvolvimento com usuário sintético.

## 0. Fatos do repositório e princípio [VERIFICADO]

1. Existem `app.app_user` (com `auth_user_id` único), `app.app_session` (etapa e hash do segredo), `audit.audit_event` com `private.audit_append(actor_ref, actor_role, action, object_type, object_id, before, after, reason, correlation)` e catálogo `audit.action_catalog` (ação nova = migração; chaves de estado sem `email`, `token`, `secret`, `name`...; valores `[A-Za-z0-9_.:-]` até 64), `private.rl_check/rl_hit` (limites, H-015), `PEPPER_EMAIL_HMAC` e `AUTH_CHALLENGE_KEY` (AES-256-GCM) no `.env.example`. **Não existem** `admin_staff`, papéis, aprovações, `approval_*`, rota `/v1/admin/*`.
2. **Princípio:** as credenciais (senha e fator TOTP) ficam no Supabase Auth (TOTP gratuito, S-08); **a autoridade é do banco do FastPro**: sessão, papel, convite e aprovação são lidos do banco a cada requisição, nunca de token. O navegador do admin guarda **só** um cookie opaco nosso; nenhum JWT do Supabase vai ao navegador. O "aal2" é verificado no login e gravado na sessão (`aal2_at`); **não existe sessão aal1 persistida**.

## 1. Modelo de dados (migração `admin_*`, RLS forçada, sem políticas, `revoke all` de `public/anon/authenticated/service_role/app_api`, acesso só por funções `private.admin_*` a `app_system`, como em 46 §3)

| Tabela | Colunas e regras |
|---|---|
| `app.admin_staff` | `user_id` pk → `app_user.id`; `status` `pendente_mfa\|ativo\|desativado`; `origin` `convite\|bootstrap`; `invited_by` → `admin_staff.user_id` (obrigatório se `origin='convite'`); `mfa_enrolled_at`; `created_at`; `status_changed_at`. Linha **existe desde o início da ativação** (`pendente_mfa`) e vira `ativo` só com o TOTP confirmado. |
| `app.admin_role` / `admin_permission` / `admin_role_permission` | Semente (D-H102-8, BK-11 a): papéis `superadmin, verificacao, moderador, financeiro, suporte, auditor`. Permissões de 08 §13: `verification.review, moderation.decide, finance.refund.request, finance.refund.approve, support.completion.correct, audit.read, catalog.manage, admin.role.manage, case.open_sensitive`. Mapa `[PROPOSTA]`: verificacao→`verification.review`; moderador→`moderation.decide`; financeiro→`finance.refund.request`+`finance.refund.approve`; suporte→`support.completion.correct`+`case.open_sensitive`; auditor→`audit.read`; superadmin→`admin.role.manage`+`catalog.manage`. **Superadmin não herda as demais** (segregação, RF-145). Permissões de H-103+ entram por migração das próprias histórias. |
| `app.admin_user_role` | `id`, `user_id` → `admin_staff`, `role_code`, `granted_by` (→ staff; nulo só no bootstrap/convite inicial, com `grant_origin`), `granted_at`, `approval_request_id`, `revoked_by`, `revoked_at`. Índice único parcial `(user_id, role_code) where revoked_at is null`. Linhas nunca apagadas. Trigger: `granted_by <> user_id` (autoconcessão negada também na tabela). |
| `app.admin_invite` | `id`, `kind` `ativacao\|reenrolamento`, `email_hmac` (HMAC com `PEPPER_EMAIL_HMAC`), `email_enc` (AES-GCM com `AUTH_CHALLENGE_KEY`, AAD `admin_invite\|id\|email_enc`; **apagado ao sair do estado ativo**), `token_hash` (SHA-256; token de 256 bits, nunca gravado), `role_codes text[]` (≥1 em `ativacao`), `invited_by`, `approval_request_id`, `state` `emitido\|aguardando_totp\|usado\|invalidado`, `attempts smallint` (código TOTP, máx. 5), `user_id` (preenchido no passo 1), `created_at`, `expires_at = created_at + 72 h` (check exato, D-H102-3), `used_at`. Único parcial `(email_hmac) where state in ('emitido','aguardando_totp')`: **um convite vivo por e-mail**; reemitir invalida o anterior na mesma transação. |
| `app.admin_session` | `id`, `user_id` → `admin_staff`, `secret_hash` (SHA-256 de 256 bits; valor nunca gravado), `aal2_at not null`, `created_at`, `expires_at` com **check `= created_at + interval '8 hours'`** (D-H102-4), `revoked_at`. Sem coluna de renovação: **não há janela deslizante**. Índices em `user_id` e `expires_at`. Expurgo das vencidas pela função `private.admin_session_purge` (`security definer`; sem DELETE para `app_system`). **Pendente:** a função ainda não tem agendamento (job diário); fica para H-009 ou um job de manutenção. |
| `app.approval_request` / `approval_vote` | **Mínimo para D-H102-5/6; H-105 estende** (acrescenta `action_type` por migração). `approval_request`: `id`, `action_type` `papel_superadmin\|mfa_reenroll`, `subject_user_id` (**opcional**: nulo no convite de Superadmin, em que o alvo ainda não existe; `solicitante ≠ alvo` vale quando há alvo), `detail_code` (papel), `requested_by`, `required_approvals smallint = 1` (solicitante + 1 aprovador = **duas pessoas distintas**, `[PROPOSTA]`), `status` `pendente\|aprovada\|rejeitada\|expirada\|consumida`, `expires_at` (24 h), `consumed_at`. `approval_vote`: único `(approval_request_id, approver_id)`; trigger `approver_id <> requested_by` e aprovador `Superadmin` ativo e `<> subject_user_id`. Aprovação é **de uso único** (`consumida` na mesma transação da ação). |

- **Segurança do banco:** todas as funções `security definer`, `set search_path = ''`, `execute` só a `app_system` (`app_api` sem acesso direto às tabelas; a API usa a conexão de sistema, como a H-012). `audit_event` continua só por `audit_append`.
- **Desvios reais desta entrega (revisão da #111; verificados no banco):** `app_system` **sem DELETE** em `admin_user_role`, `admin_invite` e `admin_session` (migração corretiva `20261111240000`, porque a `20261111220000` já estava aplicada); a expiração da sessão é removida só por `private.admin_session_purge` (função `security definer`). `admin_invite` não tem coluna `origin`: a origem sai de `invited_by` nulo (bootstrap). `approval_request.subject_user_id` opcional (ver linha acima).
- **Consulta de H-012 (D-H102-7):** `private.admin_email_is_reserved(p_email, p_email_hmac)` (revisão: e-mail em claro para `app_user` e HMAC para o convite vivo) verdadeira se existe `admin_staff` (qualquer status) para o `app_user` do e-mail **ou** convite vivo para o e-mail. H-012 (`ensureCustomer`) passa a chamá-la e devolve `link_invalido` (46 §4, item 1). **Entrega em duas migrações:** (1) `admin_create_staff` com `admin_staff` + a função (destrava H-012 já); (2) o restante.
- **Perfil proibido:** o convite é recusado (resposta explícita ao Superadmin, `email_indisponivel`) se já existe `app_user` com o e-mail (admin usa e-mail próprio; D-H102-11). O gatilho que impede `customer_profile`/`professional_profile` para `admin_staff` (09 §3.1) nasce junto das tabelas de perfil (H-016); H-102 deixa a chamada pronta e um teste pendente marcado.

## 2. Convite e ativação com TOTP (CA-H102-01, 02, 05)

**Emissão** `POST /v1/admin/invites` `{email, role_codes[]}` (permissão `admin.role.manage`): normaliza o e-mail; recusa `email_indisponivel`; grava o convite (72 h) e uma **auditoria** `admin.invite.issued` na mesma transação; enfileira o e-mail pelo pipeline de conta (H-092), com o segredo cifrado no job e apagado depois do envio (padrão de H-011). Em desenvolvimento o e-mail vai ao Mailpit; **sem envio real**. Papel `superadmin` no convite exige `approval_request` `papel_superadmin` aprovada para aquele convite (D-H102-5). A resposta não devolve o token.

**Link** `${ADMIN_BASE_URL}/convite#t=<token>`: mesmo padrão de 46 §1/§5 (GET estático sem efeito, token só no fragmento e no corpo do POST, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'`, `Origin` conferida).

**Passo 1** `POST /v1/admin/auth/invite/start` `{token, password}`: hash do token, uma chamada à função (trava `FOR UPDATE`); estado `emitido|aguardando_totp` e não vencido, senão **400 `convite_invalido`** uniforme (inexistente, vencido, usado, invalidado: mesmo corpo e cabeçalhos, sem `Set-Cookie`). Política de senha `[PROPOSTA]`: 12 a 128 caracteres, sem regras de composição, diferente do e-mail. Efeito: `AdminAuthPort.createUserWithTotpEnrollment(email, password)` (Auth admin `createUser` com `email_confirm`, `mfa.enroll` TOTP) → `app_user` + `admin_staff(pendente_mfa)` (idempotente, reaproveita tentativa abandonada e remove fator não verificado antes) → convite `aguardando_totp`. Resposta: segredo/URI `otpauth` **exibidos uma vez**; o FastPro não os guarda.
**Passo 2** `POST /v1/admin/auth/invite/confirm` `{token, password, code}`: `signIn` + verificação do código no Auth; erro soma `attempts` (5 → convite `invalidado`, Superadmin reemite). Sucesso, **em uma transação**: `admin_staff.status='ativo'`, `mfa_enrolled_at`, papéis do convite em `admin_user_role` (`granted_by = invited_by`), convite `usado` (e `email_enc` apagado), auditoria `admin.account.activated` e `admin.role.granted` por papel. **Não abre sessão**: a pessoa faz login (§3).
- **`reenrolamento`** (D-H102-6; §5.3) usa os mesmos dois passos; no passo 1 troca a senha e remove os fatores antigos.
- **Sem auto-cadastro (CA-H102-01):** não há rota de cadastro; o `app_user` de admin só nasce no passo 1 de um convite vivo; link de cliente para e-mail reservado → `link_invalido` (H-012).
- Convite gasto é o convite do passo 2; falha entre os passos não gasta o convite, mas a validade de 72 h segue correndo.

## 3. Login e sessão admin de 8 h (CA-H102-05, 06, 07, 08)

`POST /v1/admin/auth/login` `{email, password, code}` (um único pedido; não há estado intermediário):
1. Limites de H-015 (`rl_check/rl_hit`): 5 falhas por 15 min por `HMAC(e-mail)` e 20 por IP; excedido → 429 `muitas_tentativas` (vale também para e-mail inexistente).
2. `AdminAuthPort.signInWithPasswordAndTotp` → `{authUserId}`: `signInWithPassword`, fator TOTP verificado, `challengeAndVerify`, confere o claim `aal = aal2`, **descarta os tokens** e encerra a sessão do Supabase (`signOut`, melhor esforço). `[NÃO VERIFICADO: caminho completo no servidor com usuário sintético; prova em desenvolvimento]`.
3. Mapeia `authUserId` → `app_user` → `admin_staff.status='ativo'` **e** pelo menos um papel ativo. Qualquer falha (e-mail inexistente, não é admin, senha, código, sem papel, `pendente_mfa`) → **401 `credenciais_invalidas`** uniforme.
4. Sucesso: `admin_session` (8 h absolutas), cookie `__Host-fp_admin=<segredo>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`, sem `Domain`; auditoria `admin.session.opened` (falhas vão a métrica sem PII, não à cadeia). Várias sessões simultâneas permitidas; `POST /v1/admin/auth/logout` revoga a sessão atual.
- **Guarda:** a cada requisição, **uma** consulta `private.admin_guard(secret_hash, permission, now)` junta sessão (não revogada, não vencida, `aal2_at` não nulo) → `admin_staff` ativo → papéis ativos → permissão. **Nada vem do cookie além do segredo.** Revogar papel ou desativar tem efeito na requisição seguinte (CA-H102-08). Vencida às 8 h absolutas: nova entrada com senha e código.
- **Origem e cookies próprios (CA-H102-07):** o guarda só lê `__Host-fp_admin` e só a tabela `admin_session`; cookies de cliente/profissional (`app_session`) nunca são consultados aqui. Mutações exigem `Content-Type: application/json`, `Origin` = `ADMIN_BASE_URL` (senão 403 `origem_invalida`, sem efeito) e `Sec-Fetch-Site` same-origin; sem CORS. **Ressalva (revisão da #111):** a Origem inválida vale como 403 `origem_invalida` só em rota pública ou em rota não pública com sessão e papel válidos; sem sessão ou papel válido a resposta é 404, mesmo com Origin inválida (§4).
- A tela descobre o estado por `GET /v1/admin/auth/session` (rota pública do prefixo `auth`): `{"autenticado":false}` ou `{"autenticado":true,"papeis":[...],"expira_em":...}`.

## 4. Respostas 404 e 403 (D-H102-2; CA-H102-03, 04)

Toda rota `/v1/admin/*` (exceto `/v1/admin/auth/*`) declara **uma permissão** no registro do `packages/access-matrix` (fonte única, gera os testes de T-08). Rota sem declaração = inexistente.

| Situação | Resposta |
|---|---|
| Sem cookie, sessão inválida/vencida/revogada, sessão de outro domínio, staff `pendente_mfa`/`desativado`, **sem papel ativo** | **404** com corpo e cabeçalhos **idênticos** ao 404 de rota inexistente (sem `WWW-Authenticate`, sem pista) |
| Sessão aal2 válida e papel ativo, mas sem a permissão da rota | **403** `{"code":"permission_denied"}`; nada é alterado, **checagem na API e no banco** (a função de cada operação revalida a permissão; FA-031) |
| Tentativa de autoconcessão | **403** `permission_denied` + auditoria registrada (§5) |
| Origem inválida | **403** `origem_invalida`, sem efeito, **em rota pública ou em rota não pública com sessão e papel válidos**. **Sem sessão ou papel válido, 404** mesmo com Origin inválida: sessão e papel são decididos antes da Origin (revisão da #111) |

- **Efeito sobre CA-H102-05/06 (D-H102-10):** os códigos 401 `mfa_enrollment_required`/`mfa_required` deixam de existir nas rotas de recurso: sem aal2 não há sessão, logo a resposta é o 404 acima; os 401 ficam em `auth/login` (`credenciais_invalidas`). **Nenhuma rota de recurso devolve 401**: o único 401 do admin é `credenciais_invalidas` em `/v1/admin/auth/login` (revisão da #111). QA testa a consequência (sem dado, sem tela) e a **ausência de qualquer caminho que crie sessão sem `aal2_at`**.
- Todas as respostas admin: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. O guarda é o mesmo para qualquer permissão (tempo comparável entre as causas de 404).

## 5. Troca e revogação de papel; reenrolamento de MFA (CA-H102-09, 10, 11; D-H102-5, 6)

### 5.1 Concessão `POST /v1/admin/staff/{userId}/roles` `{role_code, approval_request_id?}` (permissão `admin.role.manage`)
`private.admin_role_grant(actor, target, role, approval_id, now)`, tudo em **uma transação**: ator ativo com a permissão; `target <> actor` (senão erro `ADM01`); papel existe e não está ativo no alvo; se `role='superadmin'`: exige `approval_request` `papel_superadmin` aprovada, não consumida, `subject=target`, solicitante = ator → marca `consumida`; insere `admin_user_role`; **`audit_append` por último** (`admin.role.granted`: `actor_ref`=user id, `actor_role`=papel que deu a permissão, estado `status:inativo→ativo`, `role_code`, `approval_request_id`). Qualquer erro, inclusive da auditoria, desfaz tudo (CA-H102-10). Catálogo de ações novo em migração: `admin.invite.issued`, `admin.account.activated`, `admin.role.granted`, `admin.role.revoked`, `admin.role.self_grant_denied`, `admin.session.opened`, `admin.mfa.reenroll_requested`, `admin.mfa.reenroll_completed`, `admin.bootstrap.invite_issued` (chaves permitidas sem dado pessoal; papéis como `financeiro:suporte`).
- **Autoconcessão (CA-H102-11):** a função lança `ADM01` e a transação desfaz; o **manipulador da API grava depois, em transação própria**, `admin.role.self_grant_denied` (a tentativa fica registrada mesmo com o desfazer). Se essa gravação falhar, a resposta continua 403 e a falha vai a métrica.
### 5.2 Revogação `DELETE /v1/admin/staff/{userId}/roles/{role_code}`
Imediata, sem aprovação (D-H102-5): preenche `revoked_by/at`, audita `admin.role.revoked`. Regra: **não revoga o último Superadmin ativo** (`ADM02`). Revogar todos os papéis equivale a desativar o acesso (guarda devolve 404 na requisição seguinte; sessões vencem sozinhas).
### 5.3 Reenrolamento de MFA (R-21) — **pendente nesta entrega**: sem rotas, sem funções de reenrolamento e sem `--reenrolar-mfa` (ver §6 e §8)
`POST /v1/admin/staff/{userId}/mfa-reenroll-requests` abre `approval_request` `mfa_reenroll` (solicitante Superadmin ≠ alvo); **outro Superadmin ≠ solicitante e ≠ alvo** aprova (`admin.mfa.reenroll_requested` ao abrir e `…_completed` ao final). Na aprovação, em uma transação: alvo `pendente_mfa`, sessões do alvo revogadas, convite `reenrolamento` emitido (§2) e `approval` consumida. Papéis do alvo permanecem. Para menos de dois Superadmins disponíveis além do alvo, vale o procedimento local do §6 (D-H102-11).

## 6. Primeiro Superadmin (D-H102-9)

`packages/db/scripts/admin-bootstrap.mjs`, executado **localmente por quem tem a conexão do banco**; sem rota HTTP, sem endpoint, sem chave de serviço do Auth. Entrada: e-mail novo (sem `app_user`). Efeito: emite um **convite de ativação** `superadmin` (`invited_by` nulo; a conta criada na ativação recebe `origin='bootstrap'` em `admin_staff`, não no convite; 72 h) e imprime o link **uma vez no terminal** (não grava em arquivo nem em log); a ativação segue o fluxo normal do §2 (senha e TOTP pelo usuário). Auditoria `admin.bootstrap.invite_issued` com `actor_ref='system:bootstrap'`, `actor_role='system'`, na mesma transação.
- **Travas (entregues):** somente `APP_ENV=local` (ambiente de desenvolvimento); recusa antes de qualquer conexão se o host do banco não for o confirmado por `--confirmar-host <host>`; recusa se faltar `PEPPER_EMAIL_HMAC`, `AUTH_CHALLENGE_KEY` ou `ADMIN_BASE_URL`; sem `--reemitir`, recusa se já há convite vivo para o e-mail; reemissão (`--reemitir`) invalida o convite vivo do mesmo e-mail; modo `--modo continuidade` (flag real do script; o padrão é `--modo primeiro`) só quando há **exatamente 1** Superadmin ativo, para criar o **segundo** (dupla aprovação precisa de duas pessoas; D-H102-11); o banco recusa com `ADM10` nos demais casos e no máximo 2 Superadmins.
- **Desvios desta revisão (registrados aqui):** não há `--producao-explicito`: o script não roda em produção em nenhum caso; **não há `--reenrolar-mfa` nesta entrega** (pendente, §5.3 e §8).
- A senha nunca passa pelo script. Valores do `.env.local` nunca são impressos.

## 7. Testes para o DEV (offline; banco de desenvolvimento; sem rede e sem envio real)

Setup bloqueia `fetch`/sockets (como T-H012). `AdminAuthPort` simulado em memória (nunca o Auth real); e-mails `@example.test`; sentinelas de e-mail, senha, token, segredo TOTP e cookie varridas em logs, erros e todas as colunas (`to_jsonb(row)::text`). TOTP de teste por **vetores do RFC 6238** (relógio falso).

**Unidade / manipulador (Vitest)**
- T-H102-01 convite: expirado (72 h + 1 s), usado, invalidado, inexistente e malformado → mesmo 400 `convite_invalido` byte a byte, sem `Set-Cookie`, uma chamada ao repositório. Papel `superadmin` sem aprovação válida → recusado. E-mail com `app_user` → `email_indisponivel`.
- T-H102-02 ativação: passo 1 não consome o convite; passo 2 com código errado 5× → `invalidado`; código certo → staff `ativo`, papéis exatos do convite, **nenhuma sessão aberta**. Reenvio invalida o anterior (CA-H102-02).
- T-H102-03 login: e-mail inexistente, não-admin, `pendente_mfa`, sem papel, senha errada, código errado → **mesmo** 401 `credenciais_invalidas`; 6ª falha → 429; sucesso: cookie com `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`, sem `Domain`, valor não derivado de dado do Auth; tokens do Auth descartados (CA-H102-05/06).
- T-H102-04 guarda: sem cookie, cookie de cliente, sessão vencida às 8 h, revogada, sem papel → 404 idêntico ao de rota inexistente; papel sem permissão → 403 `permission_denied` e **nenhum efeito**; mutações sem `Origin` correta → 403 `origem_invalida` sem efeito **somente com sessão e papel válidos ou em rota pública**; sem sessão ou papel válido, 404 mesmo assim (revisão da #111). Uma consulta ao repositório por requisição.
- T-H102-05 matriz: para cada rota do registro de `access-matrix` × cada papel, resposta esperada (200/403/404); rota fora do registro → 404 (CA-H102-04). Auditor tentando aprovar estorno → 403.
- T-H102-06 autoconcessão → 403 e `admin.role.self_grant_denied` gravado; segundo Superadmin concede `superadmin` com aprovação válida → ok; aprovação vencida, reaproveitada ou com solicitante = aprovador → recusada.
- T-H102-07 logs/erros sem e-mail, senha, token, segredo ou cookie; `token` e `password` na lista de campos proibidos de `@fastpro/observability`.

**Banco (`*.dbtest.mjs`, várias conexões, rollback ou limpeza sintética)**
- T-H102-20 RLS forçada e privilégios: `anon/authenticated/service_role/app_api` sem acesso; `app_system` só por função; trigger de autoaprovação e de `granted_by <> user_id`.
- T-H102-21 concessão e revogação com auditoria **na mesma transação**: falha forçada da auditoria (ação inativa no catálogo) → papel inalterado e nenhum evento; UPDATE/DELETE em `audit_event` negados (CA-H102-09/10). Estado do evento sem dado pessoal.
- T-H102-22 revogação tem efeito na **próxima** chamada de `admin_guard` (CA-H102-08); não revoga o último Superadmin.
- T-H102-23 concorrência: 20 `invite/start` e 20 `confirm` simultâneos do mesmo token → exatamente 1 ativação; 20 votos/consumos da mesma aprovação → exatamente 1 efeito; um convite vivo por e-mail.
- T-H102-24 `admin_session`: `expires_at = created_at + 8 h` (check); sessão sem `aal2_at` impossível.
- T-H102-25 `admin_email_is_reserved`: verdadeira para staff (qualquer status) e convite vivo, falsa depois de `invalidado/usado` sem staff; H-012 passa a negar link de cliente (teste em T-H012-05).
- T-H102-26 varredura de todas as colunas após ativação completa: sem sentinela de e-mail em claro fora de `app_user.email` e do `email_enc` do convite ainda vivo (apagado ao usar).
- T-H102-27 script de bootstrap (processo filho, banco de dev): cria um convite e audita; segunda execução recusada; `--modo continuidade` só com 1 ativo; sem `--confirmar-host` recusa; nada impresso do `.env.local`. **Estado (parcial):** recusas em processo filho e lógica pura em `packages/db/tests/admin-bootstrap.test.mjs`; `--modo continuidade` com 1 ativo e recusa do segundo convite vivo verificados no banco em `admin-rbac.dbtest.mjs`; a emissão real e a segunda execução do script contra o banco de desenvolvimento são **NAO VERIFICADO** (não executadas para não gravar convite real).

**Prova em desenvolvimento (uma vez, usuário sintético, sem e-mail):** `createUser`, `mfa.enroll`/`challengeAndVerify` no servidor, claim `aal`, remoção de fator e `signOut`. Se falhar, o desenho cai para o caminho alternativo: verificação do TOTP em código próprio (RFC 6238, `node:crypto`), segredo cifrado com `AUTH_CHALLENGE_KEY`; a porta e todos os testes permanecem.

Evidência: `corepack pnpm check:all` local; comando, contagem e código de saída na Issue.

### 7.1 Arquivos esperados
`packages/domain/src/admin/` (política de senha, códigos de resposta, registro de rotas/permissões, portas `AdminAuthPort`, `AdminRepository`); `packages/access-matrix/src/` (matriz papel×permissão×rota e gerador de testes); `packages/db/src/admin.ts` (repositório Pg, manipuladores); migrações `AAAAMMDDHHMMSS_admin_create_staff.sql` e `…_admin_create_rbac.sql` + rollbacks; `packages/db/scripts/admin-bootstrap.mjs`; rotas em `apps/api/src/admin-routes.ts`; telas mínimas de convite/login em `apps/admin` (console por papel é H-103). Ordem: (1) migração `admin_staff` + função de reserva (destrava H-012); (2) domínio e T-H102-01..07; (3) restante do banco e T-H102-20..26; (4) rotas e telas; (5) script e T-H102-27; (6) prova em desenvolvimento.

## 8. Riscos

| # | Risco | Mitigação |
|---|---|---|
| R-1 | Fluxo servidor do Supabase (login+MFA sem guardar tokens) não comprovado. | Porta + prova em desenvolvimento; plano B de TOTP próprio, sem mudar contrato. |
| R-2 | Perda do dispositivo MFA (R-21) com poucos Superadmins: a dupla aprovação exige duas pessoas além do alvo. | `--reenrolar-mfa` **não entregue** nesta revisão (pendente). Mitigação atual: manter ≥ 3 Superadmins quando houver equipe; sem procedimento de recuperação até a entrega. |
| R-3 | Um Superadmin mal-intencionado revoga os demais (revogação imediata). | Aceito (D-H102-5); toda revogação audita; não revoga o último; concessão de Superadmin exige dupla. |
| R-4 | Esquecimento de senha sem fluxo próprio. | Mesmo caminho do reenrolamento (aprovação dupla; troca a senha); limitação aceita no MVP. |
| R-5 | Brute force de senha e de código TOTP. | Limites H-015 + 5 códigos por convite + limites do Auth; 429 uniforme. |
| R-6 | Corrida: cliente criado com o e-mail do convite entre emissão e ativação. | `admin_email_is_reserved` em H-012; convite recusa e-mail com `app_user`; teste pendente do gatilho de perfil em H-016. |
| R-7 | 404 uniforme dificulta suporte/diagnóstico (sessão vencida parece "rota inexistente"). | `GET /v1/admin/auth/session` informa o estado; métrica por causa sem PII. |
| R-8 | Link de convite exposto em e-mail/Mailpit. | 72 h, uso único, fragmento, 256 bits, `email_enc` apagado; envio real só no lançamento. |
| R-9 | Cookie `__Host-` exige mesma origem de página e API (R-5 de 46). | Projeto admin com reescrita `/api/*`; prova na implantação (H-009). |
| R-10 | Aprovações mínimas duplicam o desenho de H-105. | Tabelas compatíveis (08 §13); H-105 só amplia `action_type`. |

## 9. Dúvidas ao Orquestrador (não bloqueantes; recomendação em itálico)

1. **D-H102-10 Ajuste de CA-H102-05/06:** sem aal2 não há sessão; rotas de recurso devolvem 404 (D-H102-2) e os 401 ficam só em `auth/login`. *Recomendação: aceitar e corrigir o texto dos CA no refino.*
2. **D-H102-11 Segundo Superadmin e recuperação:** script com `--modo continuidade` (cria o 2º Superadmin quando há 1 ativo) e `--reenrolar-mfa` local (esta última fora desta entrega); aprovação dupla = solicitante + 1 aprovador. *Recomendação: aceitar.*
3. **D-H102-12 E-mail de admin dedicado:** convite recusado se o e-mail já tem `app_user`. *Recomendação: aceitar.*
4. **D-H102-13 Fonte de credenciais:** Supabase Auth guarda senha/TOTP, mas sessão e aal2 vivem na tabela do FastPro (sem JWT no navegador); atualizar 08 §5.2/§13 e ADR-012 (PROPOSTA) e 09 §3.12 (tabelas acima). *Recomendação: aceitar.*
5. **D-H102-14 Entrega em duas migrações:** `admin_staff` + `admin_email_is_reserved` primeiro (destrava H-012), restante depois. *Recomendação: aceitar.*

## Resumo em linguagem simples

Só entra na área administrativa quem recebe um convite válido por 72 horas, escolhe uma senha e confirma um código no celular; a sessão dura 8 horas e não é renovada. Quem não tem papel não vê nada (a resposta é a de página inexistente), papel insuficiente é barrado e toda troca de papel fica registrada.
O primeiro administrador é criado por um comando local, e os testes usam serviços de mentira, sem rede nem e-mail real; faltam cinco aprovações pequenas.
