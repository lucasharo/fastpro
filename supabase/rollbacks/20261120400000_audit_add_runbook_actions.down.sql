-- Desfaz 20261120400000_audit_add_runbook_actions.sql (H-114, S4). EXECUCAO MANUAL e consciente: so em
-- banco de desenvolvimento. Tira a migracao do registro. A acao admin.session.revoked fica no catalogo
-- (eventos ja gravados dependem dela; o catalogo nao e apagado, como no rollback 20261111280000).
begin;

delete from ops.schema_migration where version = '20261120400000';

commit;
