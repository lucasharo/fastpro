-- Desfaz 20261110130000_platform_create_outbox_jobs_idempotency.sql. EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento. Apaga os dados das tabelas do esqueleto (outbox, jobs,
-- idempotencia, contadores e configuracao). Nao usa CASCADE. Remova antes migracoes posteriores
-- que dependam destes objetos.
begin;
delete from ops.schema_migration where version = '20261110130000';
drop function if exists private.idempotency_complete(text, text, text, integer, text);
drop function if exists private.idempotency_begin(text, text, text, text, integer);
drop function if exists private.job_fail(uuid, text, text, integer);
drop function if exists private.job_complete(uuid, text);
drop function if exists private.job_claim(text, text, integer, integer);
drop function if exists private.job_enqueue(text, text, timestamptz, text, integer);
drop table if exists ops.app_config;
drop table if exists ops.rate_counter;
drop table if exists ops.idempotency_key;
drop table if exists ops.job;
drop table if exists ops.outbox_event;
-- O baseline (20261110120000) nao concedia uso dos esquemas a app_system; devolve o estado.
revoke usage on schema ops, private from app_system;
commit;
