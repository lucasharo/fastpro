-- Desfaz 20261121110000_draft_create_rate_limit_functions.sql (Issue 156). EXECUCAO MANUAL, so em dev.
-- Remove so as duas funcoes privadas do limite de taxa do rascunho; private.rl_check/rl_hit ficam como estao.
begin;
drop function if exists private.draft_rate_check(text, integer, integer, integer, timestamptz);
drop function if exists private.draft_rate_hit(text, integer, timestamptz);
delete from ops.schema_migration where version = '20261121110000';
commit;
