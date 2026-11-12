-- Desfaz 20261111430000_ops_create_ops_metric_panel.sql (H-108, 117). EXECUCAO MANUAL e consciente: so em
-- banco de desenvolvimento. Remove as duas funcoes, a tabela ops.ops_metric (com o que houver nela),
-- revoga a permissao ops.panel.read do mapa e tira a migracao do registro.
begin;

drop function if exists private.ops_panel_read(timestamptz);
drop function if exists private.ops_metric_incr(text, text, timestamptz, bigint, bigint, bigint);
drop table if exists ops.ops_metric;

delete from app.admin_role_permission where permission_code = 'ops.panel.read';
delete from app.admin_permission where code = 'ops.panel.read';

delete from ops.schema_migration where version = '20261111430000';

commit;
