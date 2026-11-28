-- Issue 124 (H-115, CAT-06) | Revoga o EXECUTE de PUBLIC, anon e authenticated nas funcoes de gatilho
-- private.dsr_* (retornam trigger). O padrao do Postgres concede EXECUTE a PUBLIC; a funcao nao e
-- SECURITY DEFINER, mas nao deve ser chamavel por papeis de cliente. O gatilho continua disparando:
-- o privilegio de EXECUTE e checado so ao criar o gatilho. Nenhuma funcao e alterada, so grants.
-- Idempotente. Nao toca funcoes da Issue 120 (H-111). Desfazer:
-- supabase/rollbacks/20261120300000_authorization_revoke_dsr_trigger_execute.down.sql.

revoke all on function private.dsr_case_event_refuse_mutation() from public, anon, authenticated;
revoke all on function private.dsr_case_guard() from public, anon, authenticated;
revoke all on function private.dsr_case_insert_guard() from public, anon, authenticated;
revoke all on function private.dsr_case_refuse_delete() from public, anon, authenticated;
revoke all on function private.dsr_download_token_guard() from public, anon, authenticated;
revoke all on function private.dsr_export_guard() from public, anon, authenticated;
revoke all on function private.dsr_registro_refuse_delete() from public, anon, authenticated;
revoke all on function private.dsr_step_up_grant_guard() from public, anon, authenticated;
