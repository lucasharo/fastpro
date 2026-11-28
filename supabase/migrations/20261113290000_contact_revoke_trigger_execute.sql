-- Issue 46 (H-033) | Correcao da migracao 20261113250000 (aplicada; nao foi editada). As funcoes de gatilho novas
-- ficaram executaveis por PUBLIC (padrao do Postgres) e apareceram para app_api no teste D-02b. O gatilho dispara
-- mesmo sem EXECUTE para quem nao o criou (o privilegio e checado so ao criar o gatilho), entao so se revoga.
-- Idempotente. Desfazer: supabase/rollbacks/20261113290000_contact_revoke_trigger_execute.down.sql.

revoke all on function private.contact_consent_bu() from public, anon, authenticated, service_role, app_api, app_backup_reader, app_system;
revoke all on function private.contact_recusa_apagar() from public, anon, authenticated, service_role, app_api, app_backup_reader, app_system;
revoke all on function private.contact_reveal_log_bu() from public, anon, authenticated, service_role, app_api, app_backup_reader, app_system;
revoke all on function private.service_request_phone_au() from public, anon, authenticated, service_role, app_api, app_backup_reader, app_system;
