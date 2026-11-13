-- Desfaz 20261113230000_requests_expand_location_visibility.sql (Issue 45, H-032, M1). EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento. Recusa (rollback_recusado_com_dados) se houver pedido sem texto em claro (o dado so
-- existe cifrado). Com linha que tem os dois campos, so passa com set app.rollback_force = '1' (padrao da Issue 44).
-- Restaura a funcao de imutabilidade da Issue 44 (definicao de 20261113010000). Idempotente (if exists).
begin;

do $$
begin
  if exists (select 1 from app.service_request where address_text is null) then
    raise exception 'rollback_recusado_com_dados' using errcode = '23514';
  end if;
  if exists (select 1 from app.service_request where address_text_enc is not null)
     and coalesce(current_setting('app.rollback_force', true), '') <> '1' then
    raise exception 'rollback_recusado_com_dados' using errcode = '23514';
  end if;
end
$$;

drop function if exists private.request_address_backfill_set(uuid, bytea);
drop function if exists private.request_address_legacy_list(integer);
drop function if exists private.request_detail_professional(uuid, uuid, timestamptz);
drop function if exists private.request_visibility_guard(uuid, timestamptz);
drop function if exists private.request_owner_get(uuid, uuid);
drop function if exists private.request_publish_commit_enc(uuid, uuid, text, text, text, integer, uuid, boolean, timestamptz, uuid, bytea, text);

drop trigger if exists service_request_endereco_bu on app.service_request;
drop function if exists private.service_request_endereco_bu();

create or replace function private.service_request_imutaveis_bu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.id, new.customer_user_id, new.service_id, new.geocode_point_id, new.published_at, new.acceptance_deadline_at)
     is distinct from
     (old.id, old.customer_user_id, old.service_id, old.geocode_point_id, old.published_at, old.acceptance_deadline_at)
     or (new.origin_draft_id is distinct from old.origin_draft_id and new.origin_draft_id is not null)
     or new.first_name is distinct from old.first_name
     or new.urgency is distinct from old.urgency
     or new.description is distinct from old.description
     or new.address_text is distinct from old.address_text then
    raise exception 'pedido_campo_imutavel' using errcode = '23514';
  end if;
  return new;
end
$$;

alter table app.service_request drop constraint if exists service_request_endereco_presente_ck;
alter table app.service_request drop constraint if exists service_request_public_label_ck;
alter table app.service_request drop constraint if exists service_request_endereco_enc_ck;
alter table app.service_request alter column address_text set not null;
alter table app.service_request drop column if exists public_label;
alter table app.service_request drop column if exists address_text_enc;

delete from ops.schema_migration where version = '20261113230000';

commit;
