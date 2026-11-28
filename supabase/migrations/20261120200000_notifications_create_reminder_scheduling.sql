-- H-099 (Issue 109) | Agendamento dos lembretes de prazo e trial (docs/factory/163-DESENHO-H099.md §4.2).
-- Aditiva e idempotente: indices parciais, leituras minimas dos recursos, varredura que enfileira jobs
-- reminder.fire no marco exato, e emissao de um evento de outbox por marco. Sem tabela nova, sem interruptor
-- (decisao 27), sem e-mail: o envio segue o pipeline existente (outbox.dispatch, email.send, cota da classe lembrete).
-- Relogio injetado: p_now (padrao clock_timestamp()). Desfazer: supabase/rollbacks/20261120200000_notifications_create_reminder_scheduling.down.sql.

-- 1. Indices parciais para a varredura -----------------------------------------------------------------
create index if not exists service_request_publicado_prazo_idx
  on app.service_request (acceptance_deadline_at)
  where status = 'publicado';

create index if not exists access_grant_trial_ativo_fim_idx
  on billing.access_grant (ends_at)
  where type = 'trial' and status = 'ativa';

-- 2. Leitura minima do pedido (sem e-mail, endereco, descricao ou identidade de documento) ---------------
create or replace function private.reminder_request_view(p_request_id uuid)
returns table (
  request_id uuid,
  customer_user_id uuid,
  request_status text,
  acceptance_deadline_at timestamptz,
  customer_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.customer_user_id, r.status, r.acceptance_deadline_at, u.status
    from app.service_request r
    join app.app_user u on u.id = r.customer_user_id
   where r.id = p_request_id;
$$;

-- 3. Leitura minima do trial: estado derivado por commercial_access no instante p_now -------------------
create or replace function private.reminder_trial_view(p_grant_id uuid, p_now timestamptz default null)
returns table (
  grant_id uuid,
  professional_user_id uuid,
  grant_status text,
  ends_at timestamptz,
  estado text,
  user_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id,
         g.professional_id,
         g.status,
         g.ends_at,
         (select ca.estado
            from private.commercial_access(g.professional_id, coalesce(p_now, clock_timestamp())) ca),
         u.status
    from billing.access_grant g
    join app.app_user u on u.id = g.professional_id
   where g.id = p_grant_id
     and g.type = 'trial';
$$;

-- 4. Varredura: enfileira reminder.fire no instante do marco (dedupe por recurso e marco) -----------------
-- Janela: marco entre (agora - tolerancia) e (agora + 15 min). Tolerancia: 6 h (T-24h, T-3d) e 24 h (T0).
-- Pedido T-24h = acceptance_deadline_at - 24 h (igual a published_at + 144 h pela constraint de 168 h).
-- LIMIT 500 por assunto e marco; o excedente cai na varredura seguinte (a janela de tolerancia cobre).
create or replace function private.reminder_scan(p_now timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_ate timestamptz := coalesce(p_now, clock_timestamp()) + interval '15 minutes';
  v_row record;
  v_total integer := 0;
begin
  for v_row in
    select r.id, r.acceptance_deadline_at - interval '24 hours' as marco
      from app.service_request r
     where r.status = 'publicado'
       and r.acceptance_deadline_at - interval '24 hours'
           between v_now - interval '6 hours' and v_ate
     order by 2
     limit 500
  loop
    if private.job_enqueue('reminder.fire', 'reminder:request:t24:' || v_row.id::text, v_row.marco,
         'request|t24|' || v_row.id::text, 5) is not null then
      v_total := v_total + 1;
    end if;
  end loop;

  for v_row in
    select r.id, r.acceptance_deadline_at as marco
      from app.service_request r
     where r.status = 'publicado'
       and r.acceptance_deadline_at between v_now - interval '24 hours' and v_ate
     order by 2
     limit 500
  loop
    if private.job_enqueue('reminder.fire', 'reminder:request:t0:' || v_row.id::text, v_row.marco,
         'request|t0|' || v_row.id::text, 5) is not null then
      v_total := v_total + 1;
    end if;
  end loop;

  for v_row in
    select g.id, g.ends_at - interval '72 hours' as marco
      from billing.access_grant g
     where g.type = 'trial'
       and g.status = 'ativa'
       and g.ends_at - interval '72 hours' between v_now - interval '6 hours' and v_ate
     order by 2
     limit 500
  loop
    if private.job_enqueue('reminder.fire', 'reminder:trial:t3d:' || v_row.id::text, v_row.marco,
         'trial|t3d|' || v_row.id::text, 5) is not null then
      v_total := v_total + 1;
    end if;
  end loop;

  for v_row in
    select g.id, g.ends_at as marco
      from billing.access_grant g
     where g.type = 'trial'
       and g.status = 'ativa'
       and g.ends_at between v_now - interval '24 hours' and v_ate
     order by 2
     limit 500
  loop
    if private.job_enqueue('reminder.fire', 'reminder:trial:t0:' || v_row.id::text, v_row.marco,
         'trial|t0|' || v_row.id::text, 5) is not null then
      v_total := v_total + 1;
    end if;
  end loop;

  return v_total;
end
$$;

-- 5. Emissao: um evento de outbox por marco, sem PII ----------------------------------------------------
-- Agregado proprio (lembrete_pedido / lembrete_trial) e aggregate_seq fixo por marco (t24 e t3d = 1; t0 = 2):
-- o par (agregado, recurso, seq) e unico, entao reemitir o mesmo marco nao cria segundo evento.
-- Devolve 'emitido', 'ja_emitido' ou 'ignorado' (recurso inexistente ou fora do assunto).
create or replace function private.reminder_emit(
  p_subject text,
  p_marco text,
  p_resource_id uuid,
  p_mark_at timestamptz
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
  v_existe boolean;
  v_id uuid;
begin
  if p_subject = 'request' and p_marco in ('t24', 't0') then
    v_type := 'reminder.request';
    v_agg := 'lembrete_pedido';
    v_existe := exists (select 1 from app.service_request r where r.id = p_resource_id);
  elsif p_subject = 'trial' and p_marco in ('t3d', 't0') then
    v_type := 'reminder.trial';
    v_agg := 'lembrete_trial';
    v_existe := exists (select 1 from billing.access_grant g
                         where g.id = p_resource_id and g.type = 'trial');
  else
    raise exception 'reminder_marco_invalido' using errcode = '22023';
  end if;
  if not v_existe then
    return 'ignorado';
  end if;
  v_seq := case when p_marco in ('t24', 't3d') then 1 else 2 end;
  insert into ops.outbox_event (type, aggregate_type, aggregate_id, aggregate_seq, occurred_at, payload)
  values (v_type, v_agg, p_resource_id, v_seq, p_mark_at, jsonb_build_object('marco', p_marco))
  on conflict (aggregate_type, aggregate_id, aggregate_seq) do nothing
  returning id into v_id;
  if v_id is null then
    return 'ja_emitido';
  end if;
  return 'emitido';
end
$$;

-- 6. Privilegios: so o executor de sistema (app_system) chama; nenhum papel publico ou de API ----------
revoke all on function
  private.reminder_request_view(uuid),
  private.reminder_trial_view(uuid, timestamptz),
  private.reminder_scan(timestamptz),
  private.reminder_emit(text, text, uuid, timestamptz)
  from public, anon, authenticated, service_role, app_api;

grant execute on function
  private.reminder_request_view(uuid),
  private.reminder_trial_view(uuid, timestamptz),
  private.reminder_scan(timestamptz),
  private.reminder_emit(text, text, uuid, timestamptz)
  to app_system;
