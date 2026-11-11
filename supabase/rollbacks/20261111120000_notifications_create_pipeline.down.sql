-- Desfaz 20261111120000_notifications_create_pipeline.sql (H-092). EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento. Remove o gatilho de despacho, os jobs dos kinds do pipeline, as
-- funcoes e as quatro tabelas (ops.notification_item, ops.notification_cooldown, ops.email_outbox,
-- ops.external_quota). Nao usa CASCADE: se algo depender destes objetos, o desfazer para (erro explicito).
begin;
delete from ops.schema_migration where version = '20261111120000';
drop trigger if exists outbox_event_enfileira_despacho on ops.outbox_event;
delete from ops.job where kind in ('outbox.dispatch', 'notification.flush', 'email.send');
drop function if exists private.outbox_event_enfileira_despacho();
drop function if exists private.email_outbox_ajustar_itens(uuid, jsonb);
drop function if exists private.email_outbox_encerrar(uuid, text, text, boolean);
drop function if exists private.email_outbox_reagendar(uuid, text, integer, timestamptz, text, boolean);
drop function if exists private.email_outbox_marcar_enviado(uuid, text, text, timestamptz);
drop function if exists private.email_outbox_claim(uuid, timestamptz);
drop function if exists private.notification_flush_commit(uuid, text, text, timestamptz, uuid[], jsonb, text, jsonb, integer, timestamptz);
drop function if exists private.notification_flush_begin(uuid, text, text, timestamptz);
drop function if exists private.notification_ingest(uuid, text, text, uuid, timestamptz, text, text, jsonb, text, integer, timestamptz);
drop function if exists private.email_quota_registrar_alerta(smallint, smallint, timestamptz);
drop function if exists private.email_quota_release(timestamptz);
drop function if exists private.email_outbox_reservar_cota(uuid, integer, integer, timestamptz);
drop function if exists private.notification_flush_agendar(uuid, text, text, timestamptz);
drop function if exists private.email_outbox_inserir(uuid, text, text, text, text, jsonb, text, timestamptz);
drop function if exists private.email_outbox_enfileirar_envio(uuid, timestamptz);
drop function if exists private.notification_epoch_us(timestamptz);
drop table if exists ops.notification_item;
drop table if exists ops.notification_cooldown;
drop table if exists ops.email_outbox;
drop table if exists ops.external_quota;
commit;
