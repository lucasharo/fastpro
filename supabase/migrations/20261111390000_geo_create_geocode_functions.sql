-- H-021 | Funcoes da coordenada permanente (docs/factory/68-DESENHO-H021.md, §2.3, §3.2, §3.4, §5.1, §5.3).
-- Idempotente. Desfazer: supabase/rollbacks/20261111390000_geo_create_geocode_functions.down.sql.
-- Depende de 20261111370000 (app.geocode_point, app.geocode_budget) e de ops.external_quota (20261111120000).
-- Unica via de escrita das tabelas da coordenada. Sao security definer com search_path vazio; o execute
-- fica so com app_system. Tempo: p_now informado pelo chamador (relogio do servidor), para a concessao da
-- reserva e para os testes. Nenhuma funcao devolve latitude ou longitude ao chamador (§2.4, §3.3).

-- 1. Cota mensal do servico mapbox_permanent (atomica). Mesmo molde de private.mapbox_temp_quota_take,
--    com o servico proprio. Reserva uma unidade so se used < hard; aviso (nivel 1) e teto (nivel 2) uma vez por mes.
create or replace function private.mapbox_permanent_quota_take(
  p_now timestamptz,
  p_soft_limit integer,
  p_hard_limit integer)
returns table (out_ok boolean, out_novo_alerta boolean, out_used integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service constant text := 'mapbox_permanent';
  v_start date;
  v_used integer;
  v_marca integer;
begin
  if p_now is null or p_soft_limit is null or p_hard_limit is null
     or p_soft_limit < 0 or p_hard_limit < 1 or p_soft_limit > p_hard_limit then
    raise exception 'quota_entrada_invalida' using errcode = '22023';
  end if;

  v_start := date_trunc('month', p_now at time zone 'UTC')::date;

  insert into ops.external_quota (service, period, period_start, used, soft_limit, hard_limit)
  values (v_service, 'mes', v_start, 0, p_soft_limit, p_hard_limit)
  on conflict (service, period, period_start) do nothing;

  update ops.external_quota q
     set used = q.used + 1,
         soft_limit = p_soft_limit,
         hard_limit = p_hard_limit,
         breaker_state = 'fechado'
   where q.service = v_service and q.period = 'mes' and q.period_start = v_start
     and q.used < p_hard_limit
  returning q.used into v_used;

  if not found then
    update ops.external_quota q
       set breaker_state = 'aberto', alert_level = 2, alerted_at = p_now
     where q.service = v_service and q.period = 'mes' and q.period_start = v_start
       and q.alert_level < 2
    returning 1 into v_marca;

    select q.used into v_used
      from ops.external_quota q
     where q.service = v_service and q.period = 'mes' and q.period_start = v_start;

    return query select false, v_marca is not null, v_used;
    return;
  end if;

  if v_used >= p_soft_limit then
    update ops.external_quota q
       set alert_level = 1, alerted_at = p_now
     where q.service = v_service and q.period = 'mes' and q.period_start = v_start
       and q.alert_level < 1
    returning 1 into v_marca;
    return query select true, v_marca is not null, v_used;
    return;
  end if;

  return query select true, false, v_used;
end
$$;

-- 2. Reserva (§3.2, §5.2). Ordem: reutilizar; sem resultado; reserva viva em andamento; teto por pedido;
--    breaker (teto ausente ou invalido = fechado; cota no limite); chamar. Teto e cota so sao consumidos em
--    `chamar`. Em `breaker` a linha fica `aguardando` (so o hash, sem texto). A trava do orcamento do pedido
--    serializa as publicacoes simultaneas do mesmo pedido.
create or replace function private.geo_reserve(
  p_subject_kind text,
  p_subject_id uuid,
  p_hash text,
  p_now timestamptz,
  p_lease_s integer,
  p_calls_cap integer,
  p_soft_limit integer,
  p_hard_limit integer)
returns table (out_acao text, out_ref uuid, out_point_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_calls integer;
  v_row app.geocode_point%rowtype;
  v_found boolean;
  v_take record;
begin
  if p_subject_kind is null or p_subject_kind not in ('request', 'professional_base')
     or p_subject_id is null or p_hash is null or p_hash !~ '^[0-9a-f]{64}$'
     or p_now is null or p_lease_s is null or p_lease_s < 1
     or p_calls_cap is null or p_calls_cap < 0 then
    raise exception 'geo_entrada_invalida' using errcode = '22023';
  end if;

  insert into app.geocode_budget (subject_kind, subject_id, calls)
  values (p_subject_kind, p_subject_id, 0)
  on conflict (subject_kind, subject_id) do nothing;

  select b.calls into v_calls
    from app.geocode_budget b
   where b.subject_kind = p_subject_kind and b.subject_id = p_subject_id
     for update;

  select * into v_row
    from app.geocode_point g
   where g.subject_kind = p_subject_kind and g.subject_id = p_subject_id and g.address_hash = p_hash
     for update;
  v_found := found;

  if v_found and v_row.state = 'ok' then
    return query select 'reutilizar'::text, null::uuid, v_row.id;
    return;
  end if;

  if v_found and v_row.state = 'sem_resultado' then
    return query select 'sem_resultado'::text, null::uuid, null::uuid;
    return;
  end if;

  if v_found and v_row.state = 'reservado'
     and v_row.reserved_at + make_interval(secs => p_lease_s) > p_now then
    return query select 'em_andamento'::text, null::uuid, null::uuid;
    return;
  end if;

  if v_calls >= p_calls_cap then
    return query select 'teto'::text, null::uuid, null::uuid;
    return;
  end if;

  if p_soft_limit is null or p_hard_limit is null
     or p_soft_limit < 0 or p_hard_limit < 1 or p_soft_limit > p_hard_limit then
    insert into app.geocode_point (subject_kind, subject_id, address_hash, state)
    values (p_subject_kind, p_subject_id, p_hash, 'aguardando')
    on conflict (subject_kind, subject_id, address_hash)
    do update set state = 'aguardando', reserved_at = null;
    return query select 'breaker'::text, null::uuid, null::uuid;
    return;
  end if;

  select * into v_take from private.mapbox_permanent_quota_take(p_now, p_soft_limit, p_hard_limit);
  if not v_take.out_ok then
    insert into app.geocode_point (subject_kind, subject_id, address_hash, state)
    values (p_subject_kind, p_subject_id, p_hash, 'aguardando')
    on conflict (subject_kind, subject_id, address_hash)
    do update set state = 'aguardando', reserved_at = null;
    return query select 'breaker'::text, null::uuid, null::uuid;
    return;
  end if;

  update app.geocode_budget
     set calls = calls + 1
   where subject_kind = p_subject_kind and subject_id = p_subject_id;

  insert into app.geocode_point (subject_kind, subject_id, address_hash, state, reserved_at)
  values (p_subject_kind, p_subject_id, p_hash, 'reservado', p_now)
  on conflict (subject_kind, subject_id, address_hash)
  do update set state = 'reservado', reserved_at = p_now
  returning id into out_ref;

  return query select 'chamar'::text, out_ref, null::uuid;
end
$$;

-- 3. Gravacao da coordenada permanente (§2.3). Unico ponto que escreve exact_point. Exige reserva viva,
--    modo 'permanent', precisao da lista e caixa do Brasil. Devolve o identificador do ponto (= referencia).
create or replace function private.geo_store_permanent(
  p_ref uuid,
  p_mode text,
  p_lon double precision,
  p_lat double precision,
  p_precision text,
  p_now timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  if p_mode is distinct from 'permanent' then
    raise exception 'geo_modo_nao_permanente' using errcode = '22023';
  end if;
  if p_precision is null or p_precision not in ('endereco', 'rua', 'bairro', 'localidade') then
    raise exception 'geo_precisao_invalida' using errcode = '22023';
  end if;
  if not (coalesce(p_lon between -74.0 and -34.0, false)
          and coalesce(p_lat between -34.0 and 6.0, false)) then
    raise exception 'geo_ponto_fora_do_brasil' using errcode = '22023';
  end if;

  select g.state into v_state
    from app.geocode_point g
   where g.id = p_ref
     for update;
  if v_state is distinct from 'reservado' then
    raise exception 'geo_store_sem_reserva' using errcode = 'P0001';
  end if;

  update app.geocode_point
     set state = 'ok',
         exact_point = extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography,
         geocode_mode = 'permanent',
         precision = p_precision,
         geocoded_at = p_now,
         reserved_at = null
   where id = p_ref;

  return p_ref;
end
$$;

-- 4. Resposta sem endereco (§3.1, passo 3): a chamada foi paga; a linha guarda so o estado.
create or replace function private.geo_mark_no_result(p_ref uuid, p_now timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_now is null then
    raise exception 'geo_entrada_invalida' using errcode = '22023';
  end if;
  update app.geocode_point
     set state = 'sem_resultado', reserved_at = null
   where id = p_ref and state = 'reservado';
  if not found then
    raise exception 'geo_store_sem_reserva' using errcode = 'P0001';
  end if;
  return true;
end
$$;

-- 5. Falha do provedor (§3.4): apaga a reserva e devolve a unidade de teto do pedido. A cota mensal
--    NAO e devolvida (conservador, dúvida 4 do desenho).
create or replace function private.geo_release(p_ref uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_subject uuid;
begin
  select g.subject_kind, g.subject_id into v_kind, v_subject
    from app.geocode_point g
   where g.id = p_ref and g.state = 'reservado'
     for update;
  if not found then
    raise exception 'geo_store_sem_reserva' using errcode = 'P0001';
  end if;

  delete from app.geocode_point where id = p_ref;

  update app.geocode_budget
     set calls = calls - 1
   where subject_kind = v_kind and subject_id = v_subject and calls > 0;
  return true;
end
$$;

-- 6. Painel (§5.3): uso, teto, estado do breaker, nivel de alerta e linhas aguardando. A tela e de H-108.
create or replace function private.geo_panel(p_now timestamptz)
returns table (
  out_used integer,
  out_soft integer,
  out_hard integer,
  out_breaker_state text,
  out_alert_level smallint,
  out_aguardando bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start date;
  v_row record;
begin
  if p_now is null then
    raise exception 'geo_entrada_invalida' using errcode = '22023';
  end if;
  v_start := date_trunc('month', p_now at time zone 'UTC')::date;

  select q.used, q.soft_limit, q.hard_limit, q.breaker_state, q.alert_level into v_row
    from ops.external_quota q
   where q.service = 'mapbox_permanent' and q.period = 'mes' and q.period_start = v_start;

  return query select
    coalesce(v_row.used, 0),
    v_row.soft_limit,
    v_row.hard_limit,
    coalesce(v_row.breaker_state, 'fechado'),
    coalesce(v_row.alert_level, 0::smallint),
    (select count(*) from app.geocode_point g where g.state = 'aguardando');
end
$$;

-- Permissoes: so app_system chama. Nenhum outro papel (inclusive o de servico e o de API) executa.
revoke all on function private.mapbox_permanent_quota_take(timestamptz, integer, integer)
  from public, anon, authenticated, service_role, app_api;
grant execute on function private.mapbox_permanent_quota_take(timestamptz, integer, integer)
  to app_system;

revoke all on function private.geo_reserve(text, uuid, text, timestamptz, integer, integer, integer, integer)
  from public, anon, authenticated, service_role, app_api;
grant execute on function private.geo_reserve(text, uuid, text, timestamptz, integer, integer, integer, integer)
  to app_system;

revoke all on function private.geo_store_permanent(uuid, text, double precision, double precision, text, timestamptz)
  from public, anon, authenticated, service_role, app_api;
grant execute on function private.geo_store_permanent(uuid, text, double precision, double precision, text, timestamptz)
  to app_system;

revoke all on function private.geo_mark_no_result(uuid, timestamptz)
  from public, anon, authenticated, service_role, app_api;
grant execute on function private.geo_mark_no_result(uuid, timestamptz)
  to app_system;

revoke all on function private.geo_release(uuid)
  from public, anon, authenticated, service_role, app_api;
grant execute on function private.geo_release(uuid)
  to app_system;

revoke all on function private.geo_panel(timestamptz)
  from public, anon, authenticated, service_role, app_api;
grant execute on function private.geo_panel(timestamptz)
  to app_system;
