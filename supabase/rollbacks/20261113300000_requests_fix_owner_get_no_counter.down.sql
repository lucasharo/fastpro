-- Desfaz 20261113300000_requests_fix_owner_get_no_counter.sql (Issue 45): restaura a funcao com out_acceptances_count
-- da 20261113230000 (mesmo corpo) e devolve o EXECUTE padrao (PUBLIC) ao gatilho service_request_endereco_bu.
begin;

drop function if exists private.request_owner_get(uuid, uuid);

create function private.request_owner_get(p_user uuid, p_request_id uuid)
returns table (out_id uuid, out_status text, out_service_id uuid, out_service_name text, out_urgency text,
  out_description text, out_first_name text, out_address_text text, out_address_enc bytea, out_public_label text,
  out_published_at timestamptz, out_deadline_at timestamptz, out_acceptances_count integer)
language plpgsql
stable
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
begin
  if p_user is null or p_request_id is null then
    raise exception 'leitura_entrada_invalida' using errcode = '22023';
  end if;
  return query
    select r.id, r.status::text, r.service_id, s.name::text, r.urgency::text, r.description, r.first_name,
           r.address_text, r.address_text_enc, r.public_label, r.published_at, r.acceptance_deadline_at,
           r.acceptances_count
      from app.service_request r
      join app.service s on s.id = r.service_id
     where r.id = p_request_id
       and r.customer_user_id = p_user;
end
$$;

revoke all on function private.request_owner_get(uuid, uuid)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
grant execute on function private.request_owner_get(uuid, uuid) to app_system;

grant execute on function private.service_request_endereco_bu() to public;

delete from ops.schema_migration where version = '20261113300000';

commit;
