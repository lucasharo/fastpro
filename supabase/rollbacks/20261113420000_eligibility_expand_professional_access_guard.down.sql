-- Issue 55 (H-042), parte A | Reversao de 20261113420000_eligibility_expand_professional_access_guard.sql.
-- Restaura a fachada com o corpo de 20261113230000 (aprovada e conta ativa, sem e-mail e sem acesso comercial),
-- restaura discover_requests de 5 argumentos com o corpo de 20261113210000 e remove a guarda nova.
-- Nao ha dado a preservar. Idempotente.

-- 1. Entrada da descoberta de 6 argumentos sai; volta a de 5 (grants so para app_system).
drop function if exists private.discover_requests(uuid, integer, smallint, integer, uuid, timestamp with time zone);

create or replace function private.discover_requests(
  p_professional_id uuid,
  p_limit           integer default 50,
  p_after_group     smallint default null,
  p_after_key       integer default null,
  p_after_id        uuid default null)
returns table (out_request_id uuid, out_cursor_group smallint, out_cursor_key integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lon   double precision;
  v_lat   double precision;
  v_raio  integer;
begin
  select g.match_lon, g.match_lat, pa.radius_m
    into v_lon, v_lat, v_raio
    from app.professional_area pa
    join app.geocode_point g on g.id = pa.geocode_point_id
   where pa.professional_id = p_professional_id
     and g.subject_kind = 'professional_base'
     and g.state = 'ok'
     and g.match_grid_version = 1;

  return query
    select d.out_request_id, d.out_cursor_group, d.out_cursor_key
      from private.discover_scan(p_professional_id, v_lon, v_lat, v_raio, p_limit,
                                 p_after_group, p_after_key, p_after_id) d;
end
$$;

revoke all on function private.discover_requests(uuid, integer, smallint, integer, uuid)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
grant execute on function private.discover_requests(uuid, integer, smallint, integer, uuid) to app_system;

-- 2. Fachada com o corpo anterior (aprovada e conta ativa).
create or replace function private.request_visibility_guard(p_professional_id uuid, p_now timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_professional_id is null or p_now is null then
    raise exception 'visibilidade_parametro_invalido' using errcode = '22023';
  end if;
  return exists (
    select 1
      from app.professional_profile p
      join app.app_user u on u.id = p.user_id
     where p.user_id = p_professional_id
       and p.verification_status = 'aprovada'
       and u.status = 'ativo');
end
$$;

revoke all on function private.request_visibility_guard(uuid, timestamptz)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
grant execute on function private.request_visibility_guard(uuid, timestamptz) to app_system;

-- 3. Remove a guarda nova.
drop function if exists private.professional_access_guard(uuid, text, timestamp with time zone);
