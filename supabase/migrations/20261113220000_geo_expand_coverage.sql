-- Issue 37 (H-024) | Cobertura booleana sem contagem (docs/factory/99-DESENHO-H024.md, §2 a §6; 94-REFINO-H024.md).
-- Expansao: cinco funcoes puras da regra de descoberta, uma funcao de existencia (para na primeira base elegivel),
-- uma entrada com limite de consultas e cache de 5 min, um indice parcial de bases e uma tabela de cache sem concessao.
-- Nenhuma tabela de origem, coluna ou dado e alterado. Idempotente.
-- Caminho de reserva da 99 §3 NAO adotado nesta entrega: private.discover_scan (Issue 36) fica intacta; a paridade
-- entre as duas regras e comprovada no teste de banco (T-C02). Desfazer: supabase/rollbacks/20261113220000_geo_expand_coverage.down.sql.
-- Resposta publica so "com" ou "sem" (CA-01, CA-02). Erros com texto fixo e sem log (CA-12). Nenhuma coordenada de exact_point.

-- 0. Guarda de pre-requisito: tabelas, colunas e funcoes das Issues 31 a 36 (e do contador H-015).
--    Funcoes plpgsql nao validam tabelas na criacao; sem esta guarda o erro apareceria so na chamada.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('app', 'service_request', 'id'),
      ('app', 'service_request', 'customer_user_id'),
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
      ('app', 'geocode_point', 'subject_kind'),
      ('app', 'geocode_point', 'state'),
      ('app', 'geocode_point', 'match_lon'),
      ('app', 'geocode_point', 'match_lat'),
      ('app', 'geocode_point', 'match_cell'),
      ('app', 'geocode_point', 'match_grid_version'),
      ('ops', 'rate_counter', 'key_hmac'),
      ('ops', 'rate_counter', 'window_start'),
      ('ops', 'rate_counter', 'count')
    ) as v(esquema, tabela, coluna)
  loop
    if not exists (
      select 1
        from pg_attribute a
        join pg_class cl on cl.oid = a.attrelid
        join pg_namespace n on n.oid = cl.relnamespace
       where n.nspname = r.esquema
         and cl.relname = r.tabela
         and a.attname = r.coluna
         and a.attnum > 0
         and not a.attisdropped)
    then
      raise exception 'coverage_pre_requisito_ausente';
    end if;
  end loop;

  if to_regprocedure('private.match_janela(double precision, double precision, integer)') is null
     or to_regprocedure('private.rl_check(text, integer, integer, integer, timestamp with time zone)') is null
     or to_regprocedure('private.rl_hit(text, integer, timestamp with time zone)') is null
     or to_regprocedure('private.professional_eligible(uuid)') is null
     or to_regprocedure('private.discover_scan(uuid, double precision, double precision, integer, integer, smallint, integer, uuid, timestamp with time zone)') is null then
    raise exception 'coverage_pre_requisito_ausente';
  end if;
end
$$;

-- 1. Regra de casamento em cinco funcoes puras (sem banco). Sao a unica copia desta regra usada pela cobertura.
--    Sem "set search_path" e sem "security definer", para o planejador poder incorporar a funcao (99 §3).
create or replace function private.discovery_dist_m(
  p_lon1 double precision, p_lat1 double precision, p_lon2 double precision, p_lat2 double precision)
returns double precision
language sql
immutable
as $$
  select 2 * 6371008.8 * asin(least(1::float8, sqrt(
           power(sin(radians(p_lat2 - p_lat1) / 2), 2)
         + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lon2 - p_lon1) / 2), 2))))
$$;

create or replace function private.discovery_open(p_status text, p_deadline timestamptz, p_now timestamptz)
returns boolean
language sql
immutable
as $$
  select p_status = 'publicado' and p_now < p_deadline
$$;

create or replace function private.discovery_mod_pres(p_modality text)
returns boolean
language sql
immutable
as $$
  select p_modality = 'presencial'
$$;

create or replace function private.discovery_mod_onl(p_modality text, p_regulated boolean)
returns boolean
language sql
immutable
as $$
  select p_modality = 'online' and not p_regulated
$$;

create or replace function private.discovery_serves(
  p_pres boolean, p_onl boolean, p_has_base boolean, p_dist_m double precision, p_radius_m integer)
returns boolean
language sql
immutable
as $$
  select p_onl or (p_pres and p_has_base and p_dist_m <= p_radius_m)
$$;

-- 2. Indice parcial de bases do profissional (o de Issue 35 cobre so pedidos). Sem GiST (decisao 57).
create index if not exists geocode_point_match_cell_base_idx
  on app.geocode_point (match_grid_version, match_cell) include (id, match_lon, match_lat)
  where subject_kind = 'professional_base' and state = 'ok' and match_cell is not null;

-- 3. Cache de cinco minutos: so o booleano, por (servico, grade, celula). Sem pedido, profissional ou cliente.
create table if not exists ops.coverage_cache (
  service_id         uuid     not null,
  match_grid_version smallint not null,
  match_cell         integer  not null,
  covered            boolean  not null,
  computed_at        timestamptz not null,
  constraint coverage_cache_pkey primary key (service_id, match_grid_version, match_cell)
);
comment on table ops.coverage_cache is
  'Cache de cinco minutos da cobertura booleana (Issue 37, H-024). So o booleano por servico e celula; sem concessao a papel algum.';
alter table ops.coverage_cache enable row level security;
alter table ops.coverage_cache force row level security;
revoke all on ops.coverage_cache from public, anon, authenticated, service_role, app_api, app_backup_reader, app_system;

-- 4. Existencia: para na primeira base elegivel. Nunca conta (CA-03). Le so match_*, nunca exact_point nem geography (CA-05).
--    Dois ramos, como a descoberta: online sem base; presencial com base dentro da janela de 100 km, cada uma com o proprio raio.
create or replace function private.coverage_exists(
  p_service_id uuid,
  p_lon        double precision,
  p_lat        double precision,
  p_now        timestamptz default now())
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_existe boolean;
begin
  if p_service_id is null or p_lon is null or p_lat is null or p_now is null
     or not (p_lon between -75 and -33 and p_lat between -35 and 7) then
    raise exception 'coverage_parametro_invalido' using errcode = '22023';
  end if;

  -- BEGIN-COVERAGE-SQL
  select exists (
    select 1 from (
      select ps.professional_id
        from app.professional_service ps
        join app.service s on s.id = ps.service_id
       where ps.service_id = p_service_id
         and private.discovery_mod_onl(ps.modality, s.regulated)
         and private.professional_eligible(ps.professional_id)
      union all
      select pa.professional_id
        from private.match_janela(p_lon, p_lat, 100000) w
        join app.geocode_point g
          on g.match_grid_version = 1
         and g.match_cell between w.out_cell_lo and w.out_cell_hi
         and g.subject_kind = 'professional_base'
         and g.state = 'ok'
        join app.professional_area pa on pa.geocode_point_id = g.id
        join app.professional_service ps
          on ps.professional_id = pa.professional_id
         and ps.service_id = p_service_id
        join app.service s on s.id = ps.service_id
       where private.discovery_serves(
               private.discovery_mod_pres(ps.modality),
               private.discovery_mod_onl(ps.modality, s.regulated),
               true,
               private.discovery_dist_m(g.match_lon, g.match_lat, p_lon, p_lat),
               pa.radius_m)
         and private.professional_eligible(pa.professional_id)
    ) c
    limit 1
  ) into v_existe;
  -- END-COVERAGE-SQL

  return coalesce(v_existe, false);
end
$$;

-- 5. Contador por chave: conferencia e incremento numa so sequencia, com trava por chave. So conta o aceito.
create or replace function private.coverage_take(p_key text, p_limit integer, p_now timestamptz)
returns boolean
language plpgsql
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  v_ok boolean;
begin
  perform pg_advisory_xact_lock(hashtext('coverage_rate'), hashtext(p_key));
  select c.out_ok into v_ok from private.rl_check(p_key, 3600, 60, p_limit, p_now) c;
  if not coalesce(v_ok, false) then
    return false;
  end if;
  perform private.rl_hit(p_key, 60, p_now);
  return true;
end
$$;

-- 6. Entrada: a unica que um papel recebe. Ordem: parametros; limite por IP; pedido do dono e aberto;
--    limites do dono e do pedido; cache; calculo. Resultado so 'com', 'sem', 'limite' ou 'indisponivel'.
create or replace function private.coverage_for_request(
  p_request_id   uuid,
  p_customer_id  uuid,
  p_ip_key       text,
  p_now          timestamptz default now(),
  p_lim_ip       integer default 60,
  p_lim_customer integer default 60,
  p_lim_request  integer default 20)
returns table (out_result text)
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  v_lon     double precision;
  v_lat     double precision;
  v_celula  integer;
  v_grade   smallint;
  v_servico uuid;
  v_cache   boolean;
  v_cobre   boolean;
begin
  if p_request_id is null or p_customer_id is null or p_now is null or p_ip_key is null
     or p_ip_key !~ '^[0-9a-f]{64}$'
     or p_lim_ip is null or p_lim_ip not between 1 and 10000
     or p_lim_customer is null or p_lim_customer not between 1 and 10000
     or p_lim_request is null or p_lim_request not between 1 and 10000 then
    raise exception 'coverage_parametro_invalido' using errcode = '22023';
  end if;

  -- Limite por IP (antes de qualquer leitura de pedido).
  if not private.coverage_take(
       encode(sha256(convert_to('coverage_ip|' || p_ip_key, 'UTF8')), 'hex'), p_lim_ip, p_now) then
    return query select 'limite'::text;
    return;
  end if;

  -- Pedido do dono e aberto, com celula. Alheio, inexistente, encerrado ou sem celula: 'indisponivel'.
  select g.match_lon, g.match_lat, g.match_cell, g.match_grid_version, r.service_id
    into v_lon, v_lat, v_celula, v_grade, v_servico
    from app.service_request r
    join app.geocode_point g on g.id = r.geocode_point_id
   where r.id = p_request_id
     and r.customer_user_id = p_customer_id
     and g.subject_kind = 'request'
     and g.state = 'ok'
     and g.match_cell is not null
     and private.discovery_open(r.status, r.acceptance_deadline_at, p_now);
  if not found then
    return query select 'indisponivel'::text;
    return;
  end if;

  -- Limites do dono e do pedido.
  if not private.coverage_take(
       encode(sha256(convert_to('coverage_customer|' || p_customer_id::text, 'UTF8')), 'hex'), p_lim_customer, p_now) then
    return query select 'limite'::text;
    return;
  end if;
  if not private.coverage_take(
       encode(sha256(convert_to('coverage_request|' || p_request_id::text, 'UTF8')), 'hex'), p_lim_request, p_now) then
    return query select 'limite'::text;
    return;
  end if;

  -- Cache valido por menos de cinco minutos.
  select c.covered into v_cache
    from ops.coverage_cache c
   where c.service_id = v_servico
     and c.match_grid_version = v_grade
     and c.match_cell = v_celula
     and c.computed_at <= p_now
     and p_now - c.computed_at < interval '5 minutes';
  if found then
    return query select case when v_cache then 'com' else 'sem' end::text;
    return;
  end if;

  -- Calculo pelo centro da celula do pedido; grava o booleano; limpeza de no maximo 50 linhas antigas.
  v_cobre := private.coverage_exists(v_servico, v_lon, v_lat, p_now);

  insert into ops.coverage_cache (service_id, match_grid_version, match_cell, covered, computed_at)
  values (v_servico, v_grade, v_celula, v_cobre, p_now)
  on conflict (service_id, match_grid_version, match_cell)
  do update set covered = excluded.covered, computed_at = excluded.computed_at;

  delete from ops.coverage_cache k
   using (
     select x.service_id, x.match_grid_version, x.match_cell
       from ops.coverage_cache x
      where x.computed_at < p_now - interval '1 hour'
      limit 50
        for update skip locked) antigas
   where k.service_id = antigas.service_id
     and k.match_grid_version = antigas.match_grid_version
     and k.match_cell = antigas.match_cell;

  return query select case when v_cobre then 'com' else 'sem' end::text;
end
$$;

-- 7. Privilegios. A entrada so para app_system. A existencia, o contador e as cinco funcoes puras sem execute para papel algum
--    (chamadas pelo dono da entrada). Mesmo padrao da descoberta (Issue 36).
revoke all on function private.discovery_dist_m(double precision, double precision, double precision, double precision)
  from public, anon, authenticated, service_role, app_api, app_backup_reader, app_system;
revoke all on function private.discovery_open(text, timestamptz, timestamptz)
  from public, anon, authenticated, service_role, app_api, app_backup_reader, app_system;
revoke all on function private.discovery_mod_pres(text)
  from public, anon, authenticated, service_role, app_api, app_backup_reader, app_system;
revoke all on function private.discovery_mod_onl(text, boolean)
  from public, anon, authenticated, service_role, app_api, app_backup_reader, app_system;
revoke all on function private.discovery_serves(boolean, boolean, boolean, double precision, integer)
  from public, anon, authenticated, service_role, app_api, app_backup_reader, app_system;
revoke all on function private.coverage_exists(uuid, double precision, double precision, timestamptz)
  from public, anon, authenticated, service_role, app_api, app_backup_reader, app_system;
revoke all on function private.coverage_take(text, integer, timestamptz)
  from public, anon, authenticated, service_role, app_api, app_backup_reader, app_system;

revoke all on function private.coverage_for_request(uuid, uuid, text, timestamptz, integer, integer, integer)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
grant execute on function private.coverage_for_request(uuid, uuid, text, timestamptz, integer, integer, integer)
  to app_system;
