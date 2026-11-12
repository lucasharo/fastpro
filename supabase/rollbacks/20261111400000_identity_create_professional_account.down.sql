-- Desfaz 20261111400000_identity_create_professional_account.sql (H-016). EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento. Remove as funcoes do profissional, o perfil, as sessoes por senha e os
-- links dos propositos novos; restaura o CHECK de purpose e a obrigatoriedade de code_hmac de 140000.
-- As linhas de app.app_user criadas pelo cadastro ficam (sao contas comuns); tira a migracao do registro.
begin;
drop function if exists private.professional_session_open(uuid, uuid, text, timestamptz);
drop function if exists private.professional_account_by_email(text);
drop function if exists private.professional_login_success(text);
drop function if exists private.professional_login_gate(text, timestamptz);
drop function if exists private.professional_verify_confirm(text, timestamptz);
drop function if exists private.professional_register_create(uuid, uuid, text, text, uuid, text, timestamptz);
drop function if exists private.professional_login_wait(integer);
delete from app.app_session where purpose = 'password';
delete from app.auth_challenge where purpose in ('professional_verify', 'password_reset', 'professional_activate');
alter table app.auth_challenge drop constraint if exists auth_challenge_usuario_por_proposito;
alter table app.auth_challenge drop constraint if exists auth_challenge_codigo_por_proposito;
alter table app.auth_challenge drop constraint if exists auth_challenge_purpose_check;
alter table app.auth_challenge add constraint auth_challenge_purpose_check
  check (purpose in ('login', 'publish'));
alter table app.auth_challenge alter column code_hmac set not null;
alter table app.auth_challenge drop column if exists user_id;
drop table if exists app.professional_profile;
delete from ops.schema_migration where version = '20261111400000';
commit;
