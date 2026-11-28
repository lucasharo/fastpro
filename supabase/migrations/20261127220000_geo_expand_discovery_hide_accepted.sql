-- Pedido ja aceito sai de "Pedidos da regiao" (pedido do dono, 2026-11-27): discover_scan passa a ignorar pedidos com
-- aceite do proprio profissional, em qualquer situacao (a vaga ja foi usada). Resto da funcao igual a 20261113210000;
-- mesma assinatura, entao os privilegios continuam.

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
       and p_now < r.acceptance_deadline_at
       and not exists (select 1 from app.acceptance a where a.request_id = r.id and a.professional_id = p_professional_id)),
  g1 as (
    select r.id as rid, 0 as k
      from serv
      join app.service_request r on r.service_id = serv.service_id
     where serv.onl
       and r.status = 'publicado'
       and p_now < r.acceptance_deadline_at
       and not exists (select 1 from app.acceptance a where a.request_id = r.id and a.professional_id = p_professional_id)
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
