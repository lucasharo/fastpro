-- Desfaz a 20261120610000: restaura o EXECUTE padrao de PUBLIC (somente para reverter; nao usar em producao).
grant execute on function private.dsr_step_up_code_guard() to public, anon, authenticated;
