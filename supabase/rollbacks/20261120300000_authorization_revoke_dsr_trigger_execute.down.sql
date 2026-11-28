-- Desfaz 20261120300000_authorization_revoke_dsr_trigger_execute.sql (Issue 124): devolve o EXECUTE padrao (PUBLIC).
begin;

grant execute on function private.dsr_case_event_refuse_mutation() to public;
grant execute on function private.dsr_case_guard() to public;
grant execute on function private.dsr_case_insert_guard() to public;
grant execute on function private.dsr_case_refuse_delete() to public;
grant execute on function private.dsr_download_token_guard() to public;
grant execute on function private.dsr_export_guard() to public;
grant execute on function private.dsr_registro_refuse_delete() to public;
grant execute on function private.dsr_step_up_grant_guard() to public;

delete from ops.schema_migration where version = '20261120300000';

commit;
