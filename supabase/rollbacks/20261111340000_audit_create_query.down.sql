-- Desfaz 20261111340000_audit_create_query.sql (H-104, #113). EXECUCAO MANUAL e consciente: so em
-- banco de desenvolvimento. Remove a funcao de consulta, os dois indices e tira a migracao do registro.
-- A acao audit.queried so sai do catalogo se nao houver nenhum evento dela (FK restrict); se houver,
-- fica no catalogo, como nas acoes access_case.* (eventos ja gravados dependem dela).
begin;

drop function if exists private.audit_query(uuid, text, timestamptz, timestamptz, text, text, uuid, bigint, int, timestamptz);

drop index if exists audit.audit_event_action_idx;
drop index if exists audit.audit_event_at_idx;

delete from audit.action_catalog c
 where c.action = 'audit.queried' and c.object_type = 'audit_query'
   and not exists (select 1 from audit.audit_event e where e.action = 'audit.queried');

delete from ops.schema_migration where version = '20261111340000';

commit;
