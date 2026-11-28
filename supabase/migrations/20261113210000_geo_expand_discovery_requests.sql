-- Issue 36 (H-023) | Descoberta por raio e online nacional (docs/factory/97-DESENHO-H023.md, §3 e §4).
-- Expansao pura: duas funcoes novas em private e uma guarda de pre-requisito. Nenhuma tabela, coluna, indice ou dado e criado.
-- Idempotente. Desfazer: supabase/rollbacks/20261113210000_geo_expand_discovery_requests.down.sql.
-- So app_system executa private.discover_requests. Sem rota e sem guarda de elegibilidade aqui (Issue 68, H-055).
-- Origem da busca: centro da celula da base (match_lon/match_lat), nunca exact_point (decisao 103, CA-09).

-- 0. Guarda de pre-requisito: H-031 (service_request, professional_service, service) e H-036 (professional_area).
--    Funcoes plpgsql nao validam tabelas na criacao; sem esta guarda o erro apareceria so na chamada.
do $$
declare
  v_encontradas integer;
begin
  select count(*) into v_encontradas
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
   where a.attnum > 0
     and not a.attisdropped
     and (n.nspname, c.relname, a.attname) in (
       ('app', 'service_request', 'id'),
       ('app', 'service_request', 'service_id'),
       ('app', 'service_request', 'status'),
       ('app', 'service_request', 'acceptance_deadline_at'),
       ('app', 'service_request', 'geocode_point_id'),
       ('app', 'professional_service', 'professional_id'),
       ('app', 'professional_service', 'service_id'),
       ('app', 'professional_service', 'modality'),
       ('app', 'professional_area', 'professional_id'),
       ('app', 'professional_area', 'geocode_point_id'),
       ('app', 'professional_area', 'radius_m'),
       ('app', 'service', 'id'),
       ('app', 'service', 'regulated'),
       ('app', 'geocode_point', 'match_lon'),
       ('app', 'geocode_point', 'match_lat'),
       ('app', 'geocode_point', 'match_cell'),
       ('app', 'geocode_point', 'match_grid_version'));
  if v_encontradas <> 17 then
    raise exception 'discover_pre_requisito_ausente';
  end if;
end
$$;

-- 1. Consulta interna: regra de casamento (presencial por raio; online sem raio quando nao regulamentado).
--    Sem base (p_base_lon nulo), so o ramo online e avaliado. Nunca le exact_point nem devolve coordenada.
create or replace function private.discover_scan(
  p_professional_id uuid,
  p_base_lon        double precision,
  p_base_lat        double precision,
  p_radius_m        integer,
  p_limit           integer,
  p_after_group     smallint,
  p_after_key       integer,
  p_after_id        uuid,
  p_now             timestamptz default now())
returns table (out_request_id uuid, out_cursor_group smallint, out_cursor_key integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_professional_id is null or p_limit is null or p_limit < 1 or p_limit > 200 or p_now is null
     or (p_after_group is null) <> (p_after_key is null)
     or (p_after_group is null) <> (p_after_id is null)
     or (p_after_group is not null and (p_after_group not in (0, 1) or p_after_key < 0))
     or (p_base_lon is null) <> (p_base_lat is null)
     or (p_base_lon is not null and not (p_base_lon between -75 and -33 and p_base_lat between -35 and 7)) then
    raise exception 'discover_parametro_invalido' using errcode = '22023';
  end if;
  if p_base_lon is not null and (p_radius_m is null or p_radius_m < 5000 or p_radius_m > 100000) then
    raise exception 'discover_raio_invalido' using errcode = '22023';
  end if;

  return query
  with serv as (
    select ps.service_id,
           bool_or(ps.modality = 'presencial')                   as pres,
           bool_or(ps.modality = 'online' and not s.regulated)   as onl
      from app.professional_service ps
      join app.service s on s.id = ps.service_id
     where ps.professional_id = p_professional_id
     group by ps.service_id),
  g0 as (
    select r.id as rid, round(d.dist)::integer as k
      from private.match_janela(p_base_lon, p_base_lat, p_radius_m) w
      join app.geocode_point g
        on g.match_grid_version = 1
       and g.match_cell between w.out_cell_lo and w.out_cell_hi
       and g.subject_kind = 'request'
       and g.state = 'ok'
      join app.service_request r on r.geocode_point_id = g.id
      join serv on serv.service_id = r.service_id and (serv.pres or serv.onl)
     cross join lateral (
       select 2 * 6371008.8 * asin(least(1::float8, sqrt(
                power(sin(radians(g.match_lat - p_base_lat) / 2), 2)
              + cos(radians(p_base_lat)) * cos(radians(g.match_lat)) * power(sin(radians(g.match_lon - p_base_lon) / 2), 2)
              ))) as dist) d
     where d.dist <= p_radius_m
       and r.status = 'publicado'
       and p_now < r.acceptance_deadline_at),
  g1 as (
    select r.id as rid, 0 as k
      from serv
      join app.service_request r on r.service_id = serv.service_id
     where serv.onl
       and r.status = 'publicado'
       and p_now < r.acceptance_deadline_at
       and r.id not in (select g0.rid from g0))
  select u.rid, u.grp::smallint, u.k
    from (select g0.rid, 0 as grp, g0.k from g0
          union all
          select g1.rid, 1 as grp, g1.k from g1) u
   where p_after_group is null
      or (u.grp, u.k, u.rid) > (p_after_group::integer, p_after_key, p_after_id)
   order by u.grp, u.k, u.rid
   limit p_limit;
end
$$;

-- 2. Entrada: a unica que um papel recebe. Busca a base vigente do profissional e chama a consulta interna.
--    Profissional sem base: origem nula (so o ramo online). Profissional inexistente: vazio, sem erro.
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

-- 3. Privilegios: so app_system executa a entrada. A consulta interna nao tem execute para ninguem alem do dono.
revoke all on function private.discover_scan(uuid, double precision, double precision, integer, integer, smallint, integer, uuid, timestamptz)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;

revoke all on function private.discover_requests(uuid, integer, smallint, integer, uuid)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;

grant execute on function private.discover_requests(uuid, integer, smallint, integer, uuid) to app_system;
