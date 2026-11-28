-- Desfaz 20261111270000_notifications_email_alert_levels.sql (H-094). EXECUCAO MANUAL, so em dev.
-- Restaura a funcao da migracao 20261111120000 (retorno void, sem validacao de faixa). Nenhuma
-- linha de ops.external_quota e apagada.
begin;
drop function if exists private.email_quota_registrar_alerta(smallint, smallint, timestamptz);

create function private.email_quota_registrar_alerta(
  p_nivel_dia smallint,
  p_nivel_mes smallint,
  p_now timestamptz default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_dia date := (v_now at time zone 'UTC')::date;
  v_mes date := date_trunc('month', v_now at time zone 'UTC')::date;
begin
  update ops.external_quota q
     set alert_level = greatest(q.alert_level, p_nivel_dia),
         alerted_at = case when p_nivel_dia > q.alert_level then v_now else q.alerted_at end
   where q.service = 'email' and q.period = 'dia_utc' and q.period_start = v_dia;
  update ops.external_quota q
     set alert_level = greatest(q.alert_level, p_nivel_mes),
         alerted_at = case when p_nivel_mes > q.alert_level then v_now else q.alerted_at end
   where q.service = 'email' and q.period = 'mes' and q.period_start = v_mes;
end
$$;

revoke all on function private.email_quota_registrar_alerta(smallint, smallint, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function private.email_quota_registrar_alerta(smallint, smallint, timestamptz)
  to app_system;

delete from ops.schema_migration where version = '20261111270000';
commit;
