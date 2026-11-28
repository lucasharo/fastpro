-- H-018 | Remove as chaves estrangeiras de app.catalog_revision e app.catalog_seed_run para audit.audit_event.
-- Motivo: a chave estrangeira impede TRUNCATE de audit.audit_event antes do gatilho AU001 (guarda
-- T-05 de H-006 em audit.dbtest.mjs). O vinculo continua unico (audit_event_id unique em cada tabela).
-- Idempotente. Desfazer: supabase/rollbacks/20261111230000_catalog_drop_audit_fk.down.sql (manual, so em dev).
alter table app.catalog_revision drop constraint if exists catalog_revision_audit_fk;
alter table app.catalog_seed_run drop constraint if exists catalog_seed_run_audit_fk;
