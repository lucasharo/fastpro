-- H-115 (Issue 124), CAT-06: a funcao de gatilho private.dsr_step_up_code_guard, criada pela migracao
-- 20261120600000, ficou executavel por PUBLIC, anon e authenticated. Revoga o EXECUTE, como a 20261120300000 fez
-- com as funcoes dsr_* de gatilho. Somente grants: nenhuma tabela, funcao ou dado e alterado.
revoke all on function private.dsr_step_up_code_guard() from public, anon, authenticated;
