-- H-014 | Restaura o proposito 'step_up' em app.auth_challenge depois da migracao 20261111400000 (QA de banco:
-- o desafio de step-up nao gravava). Idempotente. Desfazer: supabase/rollbacks/20261111480000_identity_restore_step_up_purpose.down.sql.
-- Expand puro: so recria CHECKs. As constraints recriadas incluem 'step_up' e mantem o significado do desenho:
--   - step_up tem codigo de 6 digitos (code_hmac obrigatorio), como login e publish (310000);
--   - step_up nao tem user_id (o desafio pertence a sessao, session_id; 310000).
-- Nao altera migracoes aplicadas.

-- 1. Proposito aceito (310000 o incluiu; 400000 o perdeu ao recriar o CHECK) --------------------------
alter table app.auth_challenge drop constraint if exists auth_challenge_purpose_check;
alter table app.auth_challenge add constraint auth_challenge_purpose_check
  check (purpose in ('login', 'publish', 'step_up', 'professional_verify', 'password_reset', 'professional_activate'));

-- 2. Codigo de 6 digitos para login, publicacao e step-up; propositos do profissional nao tem codigo ----
alter table app.auth_challenge drop constraint if exists auth_challenge_codigo_por_proposito;
alter table app.auth_challenge add constraint auth_challenge_codigo_por_proposito
  check ((purpose in ('login', 'publish', 'step_up')) = (code_hmac is not null));

-- 3. Propositos sem usuario do profissional: login, publicacao e step-up (o step-up pertence a sessao) --
alter table app.auth_challenge drop constraint if exists auth_challenge_usuario_por_proposito;
alter table app.auth_challenge add constraint auth_challenge_usuario_por_proposito
  check (purpose in ('login', 'publish', 'step_up') or user_id is not null);
