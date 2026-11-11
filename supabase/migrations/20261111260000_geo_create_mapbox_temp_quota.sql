-- H-020 | Reserva atomica da cota mensal do geocodificador temporario (docs/factory/56-DESENHO-H020.md,
-- §4.2). Idempotente. Desfazer: supabase/rollbacks/20261111260000_geo_create_mapbox_temp_quota.down.sql.
-- So adiciona uma funcao. Reutiliza ops.external_quota (criada em 20261111120000); nao cria tabela.
-- Invocador: app_system (BYPASSRLS), como as funcoes de limite de taxa (20261111170000).
-- Os tetos vem da aplicacao (variaveis de ambiente validadas) e sao revalidados aqui. O teto nunca
-- passa de 99.000 (abaixo das 100.000 gratuitas). Tempo: p_now informado pelo chamador.

-- Reserva uma consulta do mes (UTC). Conta tambem as que falharem depois (conservador, §4.2).
-- Ordem: garante a linha do mes; UPDATE condicionado a used < hard_limit (atomico, sem leitura
-- depois escrita). Alerta de aviso: uma vez por mes (alert_level 0 -> 1). Teto atingido: alert_level
-- 2 uma vez, breaker_state 'aberto'. O UPDATE condicionado impede used > hard_limit (CHECK da tabela).
create or replace function private.mapbox_temp_quota_take(
  p_now timestamptz,
  p_soft_limit integer,
  p_hard_limit integer)
returns table (out_ok boolean, out_novo_alerta boolean, out_used integer)
language plpgsql
set search_path = ''
as $$
declare
  v_service constant text := 'mapbox_geocoding_temp';
  v_start date;
  v_used integer;
  v_marca integer;
begin
  if p_now is null or p_soft_limit is null or p_hard_limit is null
     or p_soft_limit < 0 or p_hard_limit < 1 or p_soft_limit > p_hard_limit
     or p_hard_limit > 99000 then
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
    -- Teto atingido: marca o nivel 2 uma unica vez no mes e reporta o uso atual.
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

revoke all on function private.mapbox_temp_quota_take(timestamptz, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function private.mapbox_temp_quota_take(timestamptz, integer, integer)
  to app_system;
