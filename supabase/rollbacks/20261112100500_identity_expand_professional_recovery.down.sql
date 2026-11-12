-- Desfaz 20261112100500_identity_expand_professional_recovery.sql. EXECUCAO MANUAL e consciente: so em banco
-- de desenvolvimento. Remove as funcoes novas e tira a migracao do registro. Nenhuma tabela e tocada.
begin;
drop function if exists private.professional_sessions_revoke_others(uuid, uuid, timestamptz);
drop function if exists private.password_reset_consume(text, timestamptz);
drop function if exists private.password_reset_peek(text, timestamptz);
drop function if exists private.professional_challenge_create(text, text, text, uuid, text, timestamptz);
drop function if exists private.professional_me(uuid);
drop function if exists private.professional_eligible(uuid);
drop function if exists private.is_email_verified(uuid);
delete from ops.schema_migration where version = '20261112100500';
commit;
