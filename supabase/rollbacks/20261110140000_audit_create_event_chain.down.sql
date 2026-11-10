-- Desfaz 20261110140000_audit_create_event_chain.sql. EXECUCAO MANUAL e consciente: so em banco de
-- desenvolvimento. APAGA toda a auditoria (audit_event, chain_head, action_catalog) -- em producao
-- isto e proibido. Nao usa CASCADE. Remova antes migracoes posteriores que dependam destes objetos.
-- DROP TABLE nao dispara os triggers de bloqueio; por isso o rollback e possivel ao dono.
begin;
delete from ops.schema_migration where version = '20261110140000';
drop function if exists private.audit_append(text, text, text, text, uuid, jsonb, jsonb, text, uuid);
drop function if exists private.audit_verify_chain(bigint, bigint);
drop table if exists audit.audit_event;
drop table if exists audit.chain_head;
drop table if exists audit.action_catalog;
drop function if exists audit.tg_event_seal();
drop function if exists audit.tg_head_guard();
drop function if exists audit.tg_block_mutation();
drop function if exists private.audit_row_hash(smallint, bigint, uuid, timestamptz, text, text, text, text, uuid, jsonb, jsonb, text, uuid, text);
drop function if exists private.audit_canonical_state(jsonb);
drop function if exists private.audit_state_is_valid(jsonb);
drop function if exists private.audit_keys_are_clean(text[]);
drop function if exists private.audit_key_is_forbidden(text);
-- Devolve o estado anterior: a migracao concedeu uso destes esquemas.
revoke usage on schema private from app_api;
revoke usage on schema audit from app_system;
commit;
