-- Desfaz 20261113290000_contact_revoke_trigger_execute.sql (Issue 46): devolve o EXECUTE padrao (PUBLIC).
begin;

grant execute on function private.contact_consent_bu() to public;
grant execute on function private.contact_recusa_apagar() to public;
grant execute on function private.contact_reveal_log_bu() to public;
grant execute on function private.service_request_phone_au() to public;

delete from ops.schema_migration where version = '20261113290000';

commit;
