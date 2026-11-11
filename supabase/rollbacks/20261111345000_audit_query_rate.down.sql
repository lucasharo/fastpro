-- Desfaz 20261111345000_audit_query_rate.sql (H-104, #113). EXECUCAO MANUAL e consciente: so em banco de
-- desenvolvimento. Remove a funcao do limite de consultas e tira a migracao do registro. O contador
-- (ops.rate_counter) e compartilhado com o H-015 e nao e apagado aqui.
begin;

drop function if exists private.audit_query_rate_take(uuid, timestamptz, int, int);

delete from ops.schema_migration where version = '20261111345000';

commit;
