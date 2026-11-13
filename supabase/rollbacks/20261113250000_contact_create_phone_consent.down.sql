-- Desfaz 20261113250000_contact_create_phone_consent.sql (Issue 46, H-033). EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento. Recusa (rollback_recusado_com_dados) se houver consentimento, registro de revelacao
-- ou telefone cifrado gravado (perderia prova e dado). Com set app.rollback_force = '1' passa.
-- Recusa tambem se o registro de revelacao ja tiver kind = 'endereco' (gravado pela Issue 121).
-- Idempotente (if exists).
begin;

do $$
begin
  if exists (select 1 from app.contact_consent)
     or exists (select 1 from app.contact_reveal_log)
     or exists (select 1 from app.service_request where phone_enc is not null)
     or exists (select 1 from app.contact_reveal_log where kind = 'endereco') then
    if coalesce(current_setting('app.rollback_force', true), '') <> '1' then
      raise exception 'rollback_recusado_com_dados' using errcode = '23514';
    end if;
  end if;
end
$$;

drop trigger if exists service_request_phone_au on app.service_request;
drop function if exists private.service_request_phone_au();

drop trigger if exists contact_reveal_log_truncate on app.contact_reveal_log;
drop trigger if exists contact_reveal_log_bd on app.contact_reveal_log;
drop trigger if exists contact_reveal_log_bu on app.contact_reveal_log;
drop trigger if exists contact_consent_truncate on app.contact_consent;
drop trigger if exists contact_consent_bd on app.contact_consent;
drop trigger if exists contact_consent_bu on app.contact_consent;
drop function if exists private.contact_reveal_log_bu();
drop function if exists private.contact_recusa_apagar();
drop function if exists private.contact_consent_bu();

drop function if exists private.request_phone_owner_get(uuid, uuid);
drop function if exists private.contact_owner_status(uuid, uuid);
drop function if exists private.contact_available_professional(uuid, uuid, timestamptz);
drop function if exists private.contact_reveal_phone(uuid, uuid, timestamptz);
drop function if exists private.contact_consent_revoke(uuid, uuid, uuid, timestamptz);
drop function if exists private.contact_consent_grant_professional(uuid, uuid, uuid, text, timestamptz);
drop function if exists private.request_phone_replace(uuid, uuid, bytea, timestamptz);
drop function if exists private.request_phone_attach(uuid, uuid, bytea, boolean, text, timestamptz);
drop function if exists private.request_open_for_contact(uuid, timestamptz);
drop function if exists private.request_acceptance_active(uuid, uuid);

drop table if exists app.contact_reveal_log;
drop table if exists app.contact_consent;

alter table app.service_request drop constraint if exists service_request_phone_enc_ck;
alter table app.service_request drop column if exists phone_enc;

delete from ops.schema_migration where version = '20261113250000';

commit;
