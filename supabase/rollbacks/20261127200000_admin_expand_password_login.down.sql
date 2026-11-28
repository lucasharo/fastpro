-- Desfaz 20261127200000_admin_expand_password_login (manual, so em dev). As senhas se perdem. Depois deste script,
-- reaplique 20261124100000_admin_email_code_login.sql para voltar a entrada por codigo.
drop function if exists private.admin_staff_create(uuid, text, text, text[], timestamptz);
drop function if exists private.admin_login_release(text, text, timestamptz);
drop function if exists private.admin_login_reserve(text, text, integer, integer, timestamptz);
drop function if exists private.admin_password_lookup(text);
drop table if exists app.admin_credential;
-- Contas ativas sem segundo fator impedem a regra antiga: marca antes de recriar.
update app.admin_staff set mfa_enrolled_at = status_changed_at where status = 'ativo' and mfa_enrolled_at is null;
alter table app.admin_staff add constraint admin_staff_ativo_com_mfa check (status <> 'ativo' or mfa_enrolled_at is not null);
