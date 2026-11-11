-- Desfaz 20261111170000_identity_create_rate_limits.sql (H-015). EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento. Remove as funcoes novas e a tabela ops.code_lock (com os bloqueios
-- que existirem) e tira a migracao do registro. Nao toca em ops.rate_counter nem nas funcoes de H-011.
begin;
drop function if exists private.rate_purge(timestamptz);
drop function if exists private.auth_code_attempt(uuid, text, text, text, integer, timestamptz, text, text, integer, integer);
drop function if exists private.auth_challenge_request(uuid, text, text, text, text, bytea, bytea, uuid, text, timestamptz, text, text, text, integer, integer, integer);
drop function if exists private.rl_hit(text, integer, timestamptz);
drop function if exists private.rl_check(text, integer, integer, integer, timestamptz);
drop table if exists ops.code_lock;
delete from ops.schema_migration where version = '20261111170000';
commit;
