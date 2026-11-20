-- Desfaz 20261120420000_audit_add_runbook_exercise_action.sql (H-114, S8). EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento. Tira a migracao do registro. A acao do catalogo fica (eventos ja
-- gravados dependem dela; o catalogo nao e apagado, como no rollback 20261120400000).
begin;

delete from ops.schema_migration where version = '20261120420000';

commit;
