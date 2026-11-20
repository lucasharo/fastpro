-- Desfaz 20261120430000: restaura o EXECUTE de PUBLIC, anon e authenticated (estado anterior ao H-115 CAT-06).
grant execute on function private.dsr_case_transition_allowed(text, text) to public, anon, authenticated;
