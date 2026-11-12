-- H-022 | Celula generalizada (~500 m) e match_point (docs/factory/88-DESENHO-H022.md, §2 a §6; decisoes 56 e 57).
-- Expansao por colunas anulaveis: nenhuma reescrita de tabela e nenhum dado de origem alterado.
-- Idempotente. Desfazer: supabase/rollbacks/20261112120500_geo_expand_match_point.down.sql.
-- Depende de 20261111370000 (app.geocode_point) e 20261111390000 (funcoes de escrita, que nao mudam).
-- O ponto exato e lido uma vez, dentro do banco, pelo gatilho; o centro da celula (match_*) e o unico dado
-- de localizacao que a consulta por distancia devolve. Nenhuma funcao nova devolve exact_point.

-- 1. Colunas do centro da celula. Anulaveis e sem padrao: a tabela nao e reescrita.
alter table app.geocode_point
  add column if not exists match_cell integer,
  add column if not exists match_lon double precision,
  add column if not exists match_lat double precision,
  add column if not exists match_grid_version smallint;

comment on column app.geocode_point.match_cell is
  'Celula da grade H-022 (linha * 65536 + coluna). Derivada de exact_point pelo gatilho; nunca informada.';
comment on column app.geocode_point.match_lon is
  'Centro da celula (longitude). Unico ponto que a consulta de profissional enxerga (H-022).';
comment on column app.geocode_point.match_lat is
  'Centro da celula (latitude). Derivado de exact_point pelo gatilho.';
comment on column app.geocode_point.match_grid_version is
  'Versao da grade que gerou match_*. Hoje so 1 (500 m). Mudar o lado da celula e versao nova.';

-- 2. CHECKs. As linhas existentes tem as colunas nulas, logo valem de imediato.
alter table app.geocode_point drop constraint if exists geocode_point_match_tudo_ou_nada;
alter table app.geocode_point add constraint geocode_point_match_tudo_ou_nada
  check (num_nulls(match_cell, match_lon, match_lat, match_grid_version) in (0, 4));

-- is not distinct from: com geocode_mode nulo a comparacao seria nula e o CHECK aceitaria (mesma licao de G-05).
alter table app.geocode_point drop constraint if exists geocode_point_match_origem;
alter table app.geocode_point add constraint geocode_point_match_origem
  check (match_cell is null or (exact_point is not null and geocode_mode is not distinct from 'permanent'));

alter table app.geocode_point drop constraint if exists geocode_point_match_dominio;
alter table app.geocode_point add constraint geocode_point_match_dominio
  check (match_cell is null or (match_lon between -75 and -33 and match_lat between -35 and 7 and match_grid_version = 1));

-- 3. Funcoes puras da grade (versao 1). Constantes em micrograus inteiros (µ° = 1e-6 grau):
--    origem LAT0 = -35 000 000, LON0 = -75 000 000; altura da linha DLAT = 4497 µ° (500,04 m).
--    Largura da linha DLON(row) = round(DLAT / cos(lat do centro da linha)); coluna = floor((lon - LON0) / DLON).
--    Chave = row * 65536 + col. Centro = meio da celula. Fronteira: floor nos dois eixos (uma celula so).

-- 3.1 Largura da linha, em micrograus de longitude.
create or replace function private.match_grid_dlon(p_row integer)
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$
  select round((4497::float8 / cos(radians(((-35000000::numeric + (p_row::numeric + 0.5) * 4497) / 1000000)::float8)))::numeric)::integer;
$$;

-- 3.2 Celula, centro e versao. Rejeita parametro nulo, versao desconhecida e fora da caixa do Brasil.
--     Mensagens fixas: nenhum valor de coordenada entra no texto do erro (CA-05).
create or replace function private.match_grid(
  p_version smallint,
  p_lon double precision,
  p_lat double precision)
returns table (out_cell integer, out_c_lon double precision, out_c_lat double precision)
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_lat_u bigint;
  v_lon_u bigint;
  v_row integer;
  v_dlon integer;
  v_col integer;
begin
  if p_version is null or p_lon is null or p_lat is null then
    raise exception 'match_parametro_invalido' using errcode = '22023';
  end if;
  if p_version <> 1 then
    raise exception 'match_versao_desconhecida' using errcode = '22023';
  end if;
  -- NaN e infinito nao passam pelo between: caem aqui.
  if not (p_lon between -74 and -34 and p_lat between -34 and 6) then
    raise exception 'match_grade_fora_do_dominio' using errcode = '22023';
  end if;

  v_lat_u := floor(p_lat::numeric * 1000000)::bigint;
  v_lon_u := floor(p_lon::numeric * 1000000)::bigint;
  v_row := floor((v_lat_u + 35000000)::numeric / 4497)::integer;
  v_dlon := private.match_grid_dlon(v_row);
  v_col := floor((v_lon_u + 75000000)::numeric / v_dlon)::integer;

  out_cell := v_row * 65536 + v_col;
  out_c_lat := ((-35000000 + v_row::numeric * 4497 + 2248.5) / 1000000)::double precision;
  out_c_lon := ((-75000000 + v_col::numeric * v_dlon + v_dlon / 2.0) / 1000000)::double precision;
  return next;
end
$$;

-- 4. Gatilho: calcula match_* a partir de exact_point e sobrescreve qualquer valor informado.
--    Roda na mesma instrucao que grava exact_point (CA-01); se o calculo falhar, a instrucao inteira falha.
create or replace function private.geocode_point_set_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_x double precision;
  v_y double precision;
  v_cell integer;
  v_lon double precision;
  v_lat double precision;
begin
  if new.exact_point is null then
    if new.match_cell is not null or new.match_lon is not null
       or new.match_lat is not null or new.match_grid_version is not null then
      raise exception 'match_sem_exact_point' using errcode = '23514';
    end if;
    return new;
  end if;

  v_x := extensions.st_x(new.exact_point::extensions.geometry);
  v_y := extensions.st_y(new.exact_point::extensions.geometry);
  select m.out_cell, m.out_c_lon, m.out_c_lat into v_cell, v_lon, v_lat
    from private.match_grid(1::smallint, v_x, v_y) m;

  new.match_cell := v_cell;
  new.match_lon := v_lon;
  new.match_lat := v_lat;
  new.match_grid_version := 1;
  return new;
end
$$;

drop trigger if exists geocode_point_match_biu on app.geocode_point;
create trigger geocode_point_match_biu
  before insert or update on app.geocode_point
  for each row execute function private.geocode_point_set_match();

-- 5. Janela de busca por faixas de chave (usa o indice; desenho §5). Pura: so numeros, sem tabela.
--    Uma faixa contigua por linha de latitude; uma coluna de folga de cada lado. Latitude da linha
--    pelo maior |lat| da faixa (cosseno menor = faixa de longitude maior, conservador).
create or replace function private.match_janela(
  p_lon double precision,
  p_lat double precision,
  p_radius_m integer)
returns table (out_cell_lo integer, out_cell_hi integer)
language sql
stable
set search_path = ''
as $$
  with b0 as (
    select (p_radius_m::float8 / 111194.93::float8) as dlat
  ),
  b1 as (
    select b0.dlat,
           (p_radius_m::float8 / (111194.93::float8 * cos(radians(greatest(abs(p_lat - b0.dlat), abs(p_lat + b0.dlat))))))
             as dlon
      from b0
  ),
  linhas as (
    select g.r::integer as r, private.match_grid_dlon(g.r::integer) as dlon_u, b1.dlon
      from b1,
           generate_series(
             greatest(0, floor((p_lat - b1.dlat + 35) * 1000000 / 4497)::integer - 1),
             least(9340, floor((p_lat + b1.dlat + 35) * 1000000 / 4497)::integer + 1)) as g(r)
  )
  select l.r * 65536 + greatest(0, floor(((p_lon - l.dlon + 75) * 1000000) / l.dlon_u)::integer - 1) as out_cell_lo,
         l.r * 65536 + least(65535, floor(((p_lon + l.dlon + 75) * 1000000) / l.dlon_u)::integer + 1) as out_cell_hi
    from linhas l;
$$;

-- 6. Consulta por distancia (primitiva para H-023). Devolve so subject_id, centro da celula e distancia
--    (esfera 6 371 008,8 m) ao centro. Nunca exact_point, endereco ou precisao.
create or replace function private.match_points_within(
  p_lon double precision,
  p_lat double precision,
  p_radius_m integer,
  p_limit integer default 500,
  p_version smallint default 1)
returns table (out_subject_id uuid, out_match_lon double precision, out_match_lat double precision, out_distance_m integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_version is null or p_version <> 1 then
    raise exception 'match_versao_desconhecida' using errcode = '22023';
  end if;
  if p_lon is null or p_lat is null or p_radius_m is null or p_limit is null
     or not (p_lon between -75 and -33 and p_lat between -35 and 7)
     or p_radius_m < 1 or p_radius_m > 100000 or p_limit < 1 or p_limit > 5000 then
    raise exception 'match_parametro_invalido' using errcode = '22023';
  end if;

  return query
  with cand as (
    select g.subject_id as sid,
           g.match_lon as mlon,
           g.match_lat as mlat,
           2 * 6371008.8 * asin(least(1::float8, sqrt(
             power(sin(radians(g.match_lat - p_lat) / 2), 2)
             + cos(radians(p_lat)) * cos(radians(g.match_lat)) * power(sin(radians(g.match_lon - p_lon) / 2), 2)
           ))) as dist
      from private.match_janela(p_lon, p_lat, p_radius_m) w
      join app.geocode_point g
        on g.match_grid_version = p_version
       and g.match_cell between w.out_cell_lo and w.out_cell_hi
     where g.subject_kind = 'request'
       and g.state = 'ok'
  )
  select c.sid, c.mlon, c.mlat, round(c.dist)::integer
    from cand c
   where c.dist <= p_radius_m
   order by round(c.dist)::integer, c.sid
   limit p_limit;
end
$$;

-- 7. Indice parcial. Cobre so pedidos ok com celula; include permite index-only scan (sem ler a tabela).
create index if not exists geocode_point_match_cell_idx
  on app.geocode_point (match_grid_version, match_cell)
  include (subject_id, match_lon, match_lat)
  where subject_kind = 'request' and state = 'ok' and match_cell is not null;

-- 8. Preenchimento das linhas existentes (CA-10). Autoatribuicao: o gatilho recalcula; nenhum dado de origem muda.
update app.geocode_point set exact_point = exact_point
 where exact_point is not null and match_cell is null;

-- 9. Contracao: uma linha ok sempre tem centro (vale apos o preenchimento acima).
alter table app.geocode_point drop constraint if exists geocode_point_match_estado;
alter table app.geocode_point add constraint geocode_point_match_estado
  check (state <> 'ok' or match_cell is not null);

-- 10. Permissoes. Funcoes da grade e janela: so app_system. Gatilho: ninguem (o dono o executa).
revoke all on function private.match_grid_dlon(integer)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
grant execute on function private.match_grid_dlon(integer) to app_system;

revoke all on function private.match_grid(smallint, double precision, double precision)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
grant execute on function private.match_grid(smallint, double precision, double precision) to app_system;

revoke all on function private.match_janela(double precision, double precision, integer)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
grant execute on function private.match_janela(double precision, double precision, integer) to app_system;

revoke all on function private.match_points_within(double precision, double precision, integer, integer, smallint)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
grant execute on function private.match_points_within(double precision, double precision, integer, integer, smallint)
  to app_system;

revoke all on function private.geocode_point_set_match()
  from public, anon, authenticated, service_role, app_api, app_system, app_backup_reader;
