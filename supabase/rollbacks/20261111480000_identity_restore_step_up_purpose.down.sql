-- Desfaz 20261111480000_identity_restore_step_up_purpose.sql (H-014). EXECUCAO MANUAL e consciente: so em
-- banco de desenvolvimento. Remove os desafios de step-up (o estado de 400000 nao os aceita), restaura os
-- CHECKs de 400000 e tira a migracao do registro.
begin;
delete from app.auth_challenge where purpose = 'step_up';
alter table app.auth_challenge drop constraint if exists auth_challenge_usuario_por_proposito;
alter table app.auth_challenge add constraint auth_challenge_usuario_por_proposito
  check (purpose in ('login', 'publish') or user_id is not null);
alter table app.auth_challenge drop constraint if exists auth_challenge_codigo_por_proposito;
alter table app.auth_challenge add constraint auth_challenge_codigo_por_proposito
  check ((purpose in ('login', 'publish')) = (code_hmac is not null));
alter table app.auth_challenge drop constraint if exists auth_challenge_purpose_check;
alter table app.auth_challenge add constraint auth_challenge_purpose_check
  check (purpose in ('login', 'publish', 'professional_verify', 'password_reset', 'professional_activate'));
delete from ops.schema_migration where version = '20261111480000';
commit;
