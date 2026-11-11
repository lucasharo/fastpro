-- H-094 | Alertas de cota do e-mail em 70% e 85% (docs/factory/59-DESENHO-H094.md §2.2 e §2.3).
-- Desfazer: supabase/rollbacks/20261111270000_notifications_email_alert_levels.down.sql.
-- Muda o contrato de private.email_quota_registrar_alerta: passa a devolver se o nivel SUBIU no dia
-- e no mes (o chamador so emite o evento na subida). Niveis validos 0..2 (o 3 foi retirado).
-- Drop + create: o tipo de retorno nao muda com create or replace. Nada de tabela, indice ou RLS.
-- O CHECK alert_level between 0 and 3 da tabela NAO muda (compartilhado com mapbox; 59 §2.3).

drop function if exists private.email_quota_registrar_alerta(smallint, smallint, timestamptz);

-- 8.6 Registra o nivel de alerta (0 a 2) dos contadores do dia e do mes e informa a subida.
-- Concorrencia: o SELECT ... FOR UPDATE trava a linha do periodo; a segunda transacao so le o nivel
-- ja gravado pela primeira, entao so uma subida ocorre por periodo e nivel.
create function private.email_quota_registrar_alerta(
  p_nivel_dia smallint,
  p_nivel_mes smallint,
  p_now timestamptz default null
)
returns table (
  out_dia_subiu boolean,
  out_mes_subiu boolean,
  out_nivel_dia smallint,
  out_nivel_mes smallint
)
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_dia date := (v_now at time zone 'UTC')::date;
  v_mes date := date_trunc('month', v_now at time zone 'UTC')::date;
  v_antes_dia smallint;
  v_antes_mes smallint;
  v_subiu_dia boolean := false;
  v_subiu_mes boolean := false;
  v_nivel_dia smallint := 0;
  v_nivel_mes smallint := 0;
begin
  if p_nivel_dia is null or p_nivel_dia not between 0 and 2
     or p_nivel_mes is null or p_nivel_mes not between 0 and 2 then
    raise exception 'nivel de alerta de cota fora da faixa 0 a 2' using errcode = '22023';
  end if;

  select q.alert_level into v_antes_dia
    from ops.external_quota q
   where q.service = 'email' and q.period = 'dia_utc' and q.period_start = v_dia
     for update;
  if found then
    v_subiu_dia := p_nivel_dia > v_antes_dia;
    v_nivel_dia := greatest(v_antes_dia, p_nivel_dia);
    update ops.external_quota q
       set alert_level = v_nivel_dia,
           alerted_at = case when v_subiu_dia then v_now else q.alerted_at end
     where q.service = 'email' and q.period = 'dia_utc' and q.period_start = v_dia;
  end if;

  select q.alert_level into v_antes_mes
    from ops.external_quota q
   where q.service = 'email' and q.period = 'mes' and q.period_start = v_mes
     for update;
  if found then
    v_subiu_mes := p_nivel_mes > v_antes_mes;
    v_nivel_mes := greatest(v_antes_mes, p_nivel_mes);
    update ops.external_quota q
       set alert_level = v_nivel_mes,
           alerted_at = case when v_subiu_mes then v_now else q.alerted_at end
     where q.service = 'email' and q.period = 'mes' and q.period_start = v_mes;
  end if;

  return query select v_subiu_dia, v_subiu_mes, v_nivel_dia, v_nivel_mes;
end
$$;

-- Privilegios: igual a 20261111120000 (somente app_system).
revoke all on function private.email_quota_registrar_alerta(smallint, smallint, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function private.email_quota_registrar_alerta(smallint, smallint, timestamptz)
  to app_system;
