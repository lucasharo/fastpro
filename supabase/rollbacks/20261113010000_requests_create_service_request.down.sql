-- Desfaz 20261113010000_requests_create_service_request.sql (H-031, Issue #44). EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento. Guarda: com pedido ou aviso de duplicidade gravado, aborta com
-- rollback_recusado_com_dados, a menos que a sessao informe set app.rollback_force = '1' (perda de pedido de
-- usuario so de proposito, como o rollback da H-036). Nao toca request_draft, geocode_point, ops.idempotency_key,
-- auditoria ja gravada nem a #43. Idempotente (if exists).
begin;

do $$
begin
  if coalesce(current_setting('app.rollback_force', true), '') <> '1'
     and (exists (select 1 from app.service_request) or exists (select 1 from app.duplicate_ack)) then
    raise exception 'rollback_recusado_com_dados' using errcode = '23514';
  end if;
end
$$;

drop function if exists private.request_publish_commit(uuid, uuid, text, text, text, integer, uuid, boolean, timestamptz);
drop function if exists private.request_publish_begin(uuid, uuid, text, text, text, integer, text, text, timestamptz);
drop function if exists private.request_publish_abort(uuid, text, text);
drop function if exists private.request_publish_key_done(uuid, text, integer, text, timestamptz, integer);
drop function if exists private.request_publish_recusa(uuid, app.request_draft, integer, timestamptz);
drop function if exists private.request_publish_missing(app.request_draft);
drop function if exists private.request_publish_limits();
drop function if exists private.request_publish_cfg_int(jsonb, text, integer, integer, integer);

drop trigger if exists service_request_sem_delete_bd on app.service_request;
drop trigger if exists service_request_imutaveis_bu on app.service_request;
drop trigger if exists service_request_ponto_bi on app.service_request;
drop function if exists private.service_request_sem_delete_bd();
drop function if exists private.service_request_imutaveis_bu();
drop function if exists private.service_request_ponto_bi();

drop index if exists app.media_asset_pedido_idx;
alter table app.media_asset drop column if exists request_id;

drop table if exists app.duplicate_ack;
drop table if exists app.service_request;

delete from ops.app_config where key = 'publish.limits' and version = 1;

delete from audit.action_catalog c
 where c.action = 'request.published' and c.object_type = 'service_request'
   and not exists (select 1 from audit.audit_event e where e.action = 'request.published');

delete from ops.schema_migration where version = '20261113010000';

commit;
