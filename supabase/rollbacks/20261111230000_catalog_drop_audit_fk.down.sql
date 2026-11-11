-- Desfaz 20261111230000_catalog_drop_audit_fk.sql (H-018). EXECUCAO MANUAL, so em dev.
-- ATENCAO: recriar as chaves reabre o conflito com o TRUNCATE de audit.audit_event (T-05 de H-006).
begin;
alter table app.catalog_revision add constraint catalog_revision_audit_fk foreign key (audit_event_id)
  references audit.audit_event (id) on delete restrict;
alter table app.catalog_seed_run add constraint catalog_seed_run_audit_fk foreign key (audit_event_id)
  references audit.audit_event (id) on delete restrict;
delete from ops.schema_migration where version = '20261111230000';
commit;
