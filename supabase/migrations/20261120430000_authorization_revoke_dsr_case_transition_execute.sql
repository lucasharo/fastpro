-- Issue 124 (H-115), CAT-06 remanescente (decisao 1 do lider, 2026-11-20).
-- private.dsr_case_transition_allowed(text, text) e funcao boolean sem gatilho e sem SECURITY DEFINER.
-- Revoga o EXECUTE concedido a PUBLIC, anon e authenticated. app_api e app_system tinham o EXECUTE
-- por herança de PUBLIC; recebem a concessao explicita para manter o acesso que ja tinham.
revoke execute on function private.dsr_case_transition_allowed(text, text) from public, anon, authenticated;
grant execute on function private.dsr_case_transition_allowed(text, text) to app_api, app_system;
