-- Desfaz 20261111250000_catalog_public_list_function.sql (H-018). EXECUCAO MANUAL, so em dev.
-- Restaura as politicas, a view e os grants de coluna de app_api da migracao 20261111200000.
-- ATENCAO: reabre o conflito com o guarda "sem politicas" de H-003 (platform.dbtest).
begin;
drop function if exists private.catalog_public_list();
grant select (id, name, position, active) on app.service_group to app_api;
grant select (id, group_id, name, modality, regulated, active) on app.service to app_api;
grant select (service_id, term, active) on app.service_synonym to app_api;
create policy catalog_group_public_read on app.service_group for select to app_api using (active);
create policy catalog_service_public_read on app.service for select to app_api using (
  active and exists (select 1 from app.service_group g where g.id = group_id and g.active));
create policy catalog_synonym_public_read on app.service_synonym for select to app_api using (
  active and exists (select 1 from app.service s where s.id = service_id and s.active
    and exists (select 1 from app.service_group g where g.id = s.group_id and g.active)));
create or replace view app.catalog_public with (security_invoker = true) as
select g.id as group_id, g.name as group_name, g.position as group_position,
       s.id as service_id, s.name as service_name, s.modality as modality, s.regulated as regulated
  from app.service s join app.service_group g on g.id = s.group_id
 where g.active and s.active;
grant select on app.catalog_public to app_api;
delete from ops.schema_migration where version = '20261111250000';
commit;
