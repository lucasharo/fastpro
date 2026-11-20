-- H-099 (Issue 109) | Emissao de lembrete com o instante do marco derivado do proprio recurso (desenho 163 §4.2, item 3).
-- Substitui private.reminder_emit(text, text, uuid, timestamptz) por private.reminder_emit(text, text, uuid): o job
-- reminder.fire nao carrega o instante do marco, e o occurred_at do evento precisa ser o marco (a tolerancia e
-- decidida sobre ele). O instante sai da mesma regra da varredura: T-24h = acceptance_deadline_at - 24 h; T0 =
-- acceptance_deadline_at; T-3d = ends_at - 72 h; T0 do trial = ends_at. Aditiva em relacao a 20261120200000.
-- Desfazer: supabase/rollbacks/20261120200100_notifications_reminder_emit_mark_instant.down.sql.

drop function if exists private.reminder_emit(text, text, uuid, timestamptz);

create or replace function private.reminder_emit(
  p_subject text,
  p_marco text,
  p_resource_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text;
  v_agg text;
  v_seq bigint;
  v_mark timestamptz;
  v_id uuid;
begin
  if p_subject = 'request' and p_marco in ('t24', 't0') then
    v_type := 'reminder.request';
    v_agg := 'lembrete_pedido';
    select case when p_marco = 't24' then r.acceptance_deadline_at - interval '24 hours'
                else r.acceptance_deadline_at end
      into v_mark
      from app.service_request r
     where r.id = p_resource_id;
  elsif p_subject = 'trial' and p_marco in ('t3d', 't0') then
    v_type := 'reminder.trial';
    v_agg := 'lembrete_trial';
    select case when p_marco = 't3d' then g.ends_at - interval '72 hours' else g.ends_at end
      into v_mark
      from billing.access_grant g
     where g.id = p_resource_id
       and g.type = 'trial';
  else
    raise exception 'reminder_marco_invalido' using errcode = '22023';
  end if;
  if v_mark is null then
    return 'ignorado';
  end if;
  v_seq := case when p_marco in ('t24', 't3d') then 1 else 2 end;
  insert into ops.outbox_event (type, aggregate_type, aggregate_id, aggregate_seq, occurred_at, payload)
  values (v_type, v_agg, p_resource_id, v_seq, v_mark, jsonb_build_object('marco', p_marco))
  on conflict (aggregate_type, aggregate_id, aggregate_seq) do nothing
  returning id into v_id;
  if v_id is null then
    return 'ja_emitido';
  end if;
  return 'emitido';
end
$$;

revoke all on function private.reminder_emit(text, text, uuid) from public, anon, authenticated, service_role, app_api;
grant execute on function private.reminder_emit(text, text, uuid) to app_system;
