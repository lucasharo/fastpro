# Desenho H-016 (síntese e ajustes ao schema real) — Cadastro e login do profissional (Issue #29, WF-03, Architect)

- **Relação com 33-DESENHO-H016:** o desenho completo (384 linhas, `APROVADO_ARQUITETURA`) já existe e continua válido. Este documento é a síntese curta para o DEV e **registra os ajustes** que a leitura das migrações reais (até `20261111260000`) exige. Onde houver conflito, **este documento prevalece sobre 33 apenas nos itens da seção 6**.
- **Natureza:** somente documento. Nada de código, migração, usuário, e-mail ou GitHub foi alterado.
- **Etiquetas:** `[DECIDIDO]` (D-H016-1..7, do Orquestrador, registradas em 32/33) · `[VERIFICADO]` (lido nesta sessão em arquivo) · `[PROPOSTA]` (deste desenho) · `[NÃO VERIFICADO]` (sem teste nem fonte lida nesta sessão).
- **Fontes lidas:** 14-BACKLOG (H-016, linha 107), 10-ADRS (ADR-006), 04-PRD (RF-045), 08 §5.2 e §5.3, 09 §3.1 e §3.3, 33-DESENHO-H016, migrações `140000`, `150000`, `170000`. Nota: `05-CRITERIOS-ACEITE.md` **não contém RF-045** `[VERIFICADO]`; os critérios vêm de 32-REFINO-H016 (CA-H016-01..22).

## 1. Fluxo (Supabase Auth com e-mail verificado)

1. **Cadastro** `POST /v1/auth/professional/register {email, password}` `[DECIDIDO]`: valida política (mín. 8 caracteres, teto 72 bytes `[PROPOSTA]`), aplica limites, cria o usuário no Auth por chave secreta no servidor (`admin.createUser`), cria `app_user` (`email_verified_at` nulo) e `professional_profile` (`verification_status='pendente'`), grava desafio de verificação e enfileira o e-mail. Resposta sempre `202` igual (anti-enumeração, 08 §5.3).
2. **Verificação** `[DECIDIDO D-H016-2]`: link no fragmento da URL, 15 min, uso único; o GET só mostra botão; o `POST …/verification/confirm` consome de forma atômica e grava `app_user.email_verified_at`. Link inválido, expirado ou usado devolve o mesmo `410`.
3. **Login** `POST /v1/auth/professional/login`: bloqueio progressivo é contado **antes** de conferir a senha; `signInWithPassword` no servidor; cria `app_session` de 7 dias absolutos `[DECIDIDO D-H016-5]`. Sem e-mail verificado, a sessão é restrita a concluir a verificação `[DECIDIDO D-H016-3]`.
4. **Regra de ouro** `[DECIDIDO, backlog H-016]`: sem e-mail verificado **e** aprovação humana, nada é publicado nem aceito. Guarda única `ProfessionalEligibility` mais função SQL `private.is_email_verified` para os triggers de H-031/H-058.
5. **Recuperação e troca de senha** entram nesta história `[DECIDIDO D-H016-1]`; ambas encerram as demais sessões `[DECIDIDO D-H016-6]`.
6. **Login social fora do MVP web** `[DECIDIDO ADR-006 A]`. A fase mobile depende de S-07 e SD-13 `[NÃO VERIFICADO]`.

## 2. Contratos de rota (comportamento obrigatório; nomes ajustáveis pelo DEV)

| Rota | Sucesso | Erros |
|---|---|---|
| `POST /v1/auth/professional/register` | `202` uniforme | `422` (campo), `429` + `Retry-After` |
| `POST /v1/auth/professional/verification/resend` | `202` uniforme | `429` |
| `POST /v1/auth/professional/verification/confirm` | `204` | `410 link_invalid` |
| `POST /v1/auth/professional/login` | `200` + cookie `__Host-` HttpOnly | `401 invalid_credentials`, `403 account_unavailable`, `429` |
| `POST /v1/auth/password/recovery` / `reset` | `202` / `204` | `429`; `410`, `422` |
| `POST /v1/auth/step-up` | `204` | `401`, `429` |
| `POST /v1/professional/password/change` | `204` | `401 step_up_required`, `403 email_not_verified` |
| `GET /v1/professional/me` | `200 {email_verified, verification:{status, explanation_code}}` | `401` |

Nenhuma resposta ou log contém senha, token, e-mail em claro nem token do Auth.

## 3. Dados: somente o que existe em 09 (ou já migrado)

- `app_user` (09 §3.1) `[VERIFICADO]` já migrado (`150000`): `id`, `email`, `auth_user_id` único, `status`, `email_verified_at`. **Sem alteração.** Fonte de verdade de "e-mail verificado" é `app_user.email_verified_at`, nunca `auth.users.email_confirmed_at` `[PROPOSTA DD-2]`.
- `professional_profile` (09 §3.3) `[VERIFICADO]` **ainda sem migração** (só aparece em `140000_audit`). H-016 cria o mínimo: `user_id` (PK/FK `app_user`), `verification_status` (padrão `pendente`), `verified_at`, `suspended_at`, `suspension_reason`. Demais colunas (nome público, `slug`, CPF/CNPJ) são de H-035/H-036 por expansão. O papel `app_api` não grava as colunas de status (impede autoaprovação).
- `auth_challenge` (09 §3.1) e `app_session` (09 §3.1): ver ajustes da seção 6.
- Bloqueio progressivo: **reutilizar `ops.code_lock` e `ops.rate_counter`** (já migrados em `170000`) em vez da tabela nova `ops.login_throttle` de 33 §2.4 `[PROPOSTA]`; ver seção 6, item C.
- Nenhuma outra tabela. `ops.app_config` já existe e guarda os parâmetros (33 §2.6).

## 4. Riscos de segurança

| Risco | Tratamento |
|---|---|
| Enumeração de e-mail (resposta, tempo, `429`, contadores) | Resposta `202` única, piso de tempo, contadores por HMAC do e-mail existam ou não; teste de mediana de tempo (diferença ≤ 60 ms) |
| Senha | Política no servidor; nunca em log; hash só no Auth; troca exige step-up de 30 min; recuperação por link e não por pergunta |
| Pré-sequestro de conta | Cadastro sobre e-mail **verificado** nunca altera credencial; sobre não verificado substitui a senha e revoga sessões |
| Cadastro público do Auth aberto: `disable_signup=false` `[VERIFICADO em 33 §1.2]` | Desligar no painel (passo manual do dono) e teste `T-H016-CFG` |
| Login direto no Auth contorna o bloqueio progressivo (hook de senha só em Teams) | Residual aceito se Q-1 for aceita: a API só vale sessão com `app_session` |
| Sessão | Cookie `__Host-`, HttpOnly, Secure, SameSite=Lax; `expires_at` e `revoked_at` lidos do banco a cada requisição; 7 dias sem renovação deslizante; refresh do Auth só no servidor |
| Link de e-mail lido por scanner | Segredo no fragmento; GET sem efeito; consumo por POST |
| RLS | `professional_profile`, `code_lock` e tabelas novas com RLS habilitada e forçada, sem política para `anon`/`authenticated`; acesso só por funções `SECURITY DEFINER` com `set search_path=''` concedidas a `app_system` (padrão de `170000`) |
| Negação de serviço do login (atacante gasta tentativas da vítima) | Teto de 15 min; recuperação não é bloqueada pela espera |
| Auth e Postgres não são uma transação só | Ordem Auth→banco, compensação, expurgo de órfãos e teste de reconciliação |
| Cota de e-mail (100/dia) | Limites por e-mail e IP, classe `auth` com reserva; sem domínio nenhum e-mail real sai `[VERIFICADO em S-11]` |

## 5. Testes T-04 e critérios verificáveis

Camadas (sem Docker, D-H016-7): **U** unidade (Vitest); **B** banco de desenvolvimento em transação com rollback (`*.dbtest.mjs`); **A** Auth de desenvolvimento com usuários sintéticos removidos em `finally` (`pnpm test:auth-dev`, fora do `check:all`); **S** estático. A matriz completa T-H016-01..22, CFG, AUTH-01..04, S01, REC e MIG está em 33 §12.3. Critérios mínimos de aceite para o DEV registrar na Issue (comando, contagem, código de saída):

1. Cadastro novo cria `app_user` não verificado + `professional_profile` `pendente`; e-mail existente devolve resposta idêntica (mediana de tempo ≤ 60 ms de diferença em 30 repetições).
2. Link: GET não consome; 20 POST simultâneos geram 1 sucesso; expira aos 15 min; inválido/usado/expirado devolvem o mesmo `410`.
3. Bloqueio: 4 falhas sem espera; 5ª gera 30 s; teto 15 min; senha correta durante a espera ainda recebe `429`; 50 tentativas concorrentes geram no máximo 4 verificações reais.
4. Não verificado: toda rota de profissional fora da lista permitida devolve `403 email_not_verified` e **nada é criado**; `ProfessionalEligibility` nega os 5 estados não aprovados.
5. Sessão: `expires_at − created_at = 7 dias`; uso no 6º dia não prorroga; após 7 dias, `401`.
6. Troca/recuperação de senha: requisição com `sid` anterior recebe `401` na hora; senha antiga deixa de valer.
7. Nenhuma senha, token ou e-mail em claro em logs, respostas ou erros forçados; nenhuma chamada do código a `signUp`, `resetPasswordForEmail`, `resend`, `signInWithOtp`.
8. `verification_status` não é gravável pelo `app_api`; nenhuma política para `anon`/`authenticated`; migração sobe do zero e tem `down`.

## 6. Ajustes ao schema real (conflitos entre 33 e as migrações) `[VERIFICADO]`

- **A. `auth_challenge`** (`140000`): `purpose in ('login','publish')`, `code_hmac not null`, `email_hash` e `expires_at = created_at + 15 min` por constraint. 33 §2.3 propõe novos `purpose` e `code_hmac` nulo. H-016 precisa **relaxar a constraint por expand** (`professional_verify`, `password_reset`, `professional_activate`; `code_hmac` nulo só para eles) e acrescentar `user_id`. Os campos `invalidated_at`/`invalid_reason` já existem: usar `invalid_reason='substituido'` em vez da coluna nova `superseded_at` de 33 `[PROPOSTA]`. O valor 15 min já está garantido.
- **B. `app_session`** (`150000`): exige `challenge_id` **não nulo e único**, `purpose in ('login','publish')` e `stage in ('identificacao','ativa')`. A afirmação de 33 §2.5 ("sem coluna nova") **não vale**: login por senha não tem desafio. Opções: (1) tornar `challenge_id` anulável com `purpose` ampliado para `password` (recomendada, uma só tabela de sessão); (2) criar o desafio sintético por login (artifício, rejeitado). Também guardar `auth_session_id` (refresh no servidor) e `recent_auth_at` conforme 33 §5.1 e 08 §5.4; a conversão de H-014 (`180000`) precisa suportar sessão nascida já `ativa`.
- **C. `ops.code_lock`** (`170000`): já tem `key_hmac`, `strikes`, `locked_until`. Reutilizar com uma chave de prefixo distinto (`login:<hmac>`) em vez de `ops.login_throttle`; o cálculo da espera (30 s dobrando até 15 min) é parâmetro de `ops.app_config` `[PROPOSTA]`. Se o DEV preferir tabela própria, justificar na Issue.
- **D. Ordem de entrega:** a sessão exige H-012/H-014 (concluídas nas migrações `150000`/`180000`) `[VERIFICADO nas migrações]`; manter S-01 e H-093 (Mailpit) como dependências de prova do CA-H016-06 `[NÃO VERIFICADO se Mailpit está instalado]`.

## 7. Dúvidas não bloqueantes (numeração provisória; o líder renumera)

1. **Risco residual de login direto no Auth (sem hook de senha no plano gratuito).** Aceitar com monitoramento e senha mínima de 8 mais lista local? Recomendação: **sim**; alternativas (plano Teams ou hash próprio) fogem do orçamento e do ADR-006.
2. **Link de verificação abre sessão?** Recomendação: **não**; o link prova o e-mail, não a senha.
3. **Aceite dos termos e da privacidade no cadastro.** Não consta nos CA. Recomendação: história própria antes de qualquer dado real (`[PENDENTE JURÍDICO]` L2).
4. **Troca de e-mail do profissional.** Sem RF. Recomendação: fora de H-016; o guarda de step-up fica pronto.
5. **Sessão por senha (seção 6, item B).** Recomendação: opção 1, relaxar `app_session.challenge_id` por expand, com teste de que a sessão de cliente continua igual.
6. **RF novos.** O PRD cobre só RF-045; recuperação de senha, sessão do profissional e limites de login não têm RF (achado do PO). Recomendação: o PO abrir RF antes da implementação.

## Resumo em linguagem simples

O profissional cria conta com e-mail e senha, confirma o e-mail por um link que vale 15 minutos e só funciona uma vez, e entra com a senha. Depois de 5 erros seguidos o sistema o faz esperar, e a espera cresce até 15 minutos. Quem esqueceu a senha recebe um link para trocá-la, e a troca encerra os outros acessos. Enquanto o e-mail não for confirmado e uma pessoa não aprovar o cadastro, o profissional não publica nem aceita trabalho. Já existia um desenho completo; este documento resume e aponta onde ele precisa ser ajustado ao que já foi construído. Depende do dono: desligar o cadastro aberto do serviço de contas.
