-- Issue 47 (H-034) | Desfaz 20261113430000_requests_expand_customer_panel.sql: remove a funcao de lista e o indice novo.
-- Sem recusa por dados: a migracao nao cria nem altera dado. O indice antigo (customer_user_id, status) permanece.
begin;

drop function if exists private.request_list_owner(uuid, timestamptz, timestamptz, uuid, integer);
drop index if exists app.service_request_cliente_recente_idx;

delete from ops.schema_migration where version = '20261113430000';

commit;
