-- Pacote D (H-095, H-096, H-098) | E-mails de aviso do ciclo central: aceite, mensagem, selecao e cancelamento.
-- Aditiva e idempotente. Reaproveita o pipeline existente (ops.outbox_event -> outbox.dispatch -> notification_item
-- -> cooldown -> ops.email_outbox -> email.send). Nenhuma tabela nova e nenhum CHECK novo: as categorias selecao e
-- cancelamento ja existem em ops.email_outbox e ops.notification_item (20261111120000).
-- Eventos gravados aqui (payload so com ids e papel, sem texto, sem e-mail, sem nome):
--   message_sent       (agregado message, seq 1, um por mensagem humana)
--   request_selected   (agregado service_request, seq sequencial sob o lock do pedido)
--   request_cancelled  (agregado service_request, gatilho em app.service_request)
-- O evento work_accepted ja e gravado por private.acceptance_create (20261120310000); nada muda ali.
-- Desfazer: supabase/rollbacks/20261123140000_notifications_core_cycle.down.sql.

-- 1. Leitura minima para as regras (sem e-mail, sem texto de mensagem, sem documento) -------------------------
create or replace function private.cycle_request_view(p_request_id uuid)
returns table (out_request_id uuid, out_customer_user_id uuid, out_status text,
  out_selected_professional_id uuid, out_service_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.customer_user_id, r.status::text, sa.professional_id, s.name
    from app.service_request r
    join app.service s on s.id = r.service_id
    left join app.acceptance sa on sa.id = r.selected_acceptance_id
   where r.id = p_request_id
$$;

create or replace function private.cycle_active_professionals(p_request_id uuid)
returns table (out_professional_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select a.professional_id
    from app.acceptance a
   where a.request_id = p_request_id
     and a.status = 'ativo'
   order by a.slot_no
$$;

create or replace function private.cycle_conversation_view(p_conversation_id uuid)
returns table (out_request_id uuid, out_customer_user_id uuid, out_professional_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select c.request_id, c.customer_user_id, c.professional_id
    from app.conversation c
   where c.id = p_conversation_id
$$;

-- 2. Gatilho de cancelamento: status vira 'cancelado' -> evento request_cancelled ----------------------------
-- O UPDATE ja segura o lock da linha do pedido; o max+1 do aggregate_seq fica serializado com o aceite e a selecao.
create or replace function private.request_cancel_enfileira_evento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seq bigint;
begin
  if new.status = 'cancelado' and old.status is distinct from new.status then
    select coalesce(max(e.aggregate_seq), 0) + 1 into v_seq
      from ops.outbox_event e
     where e.aggregate_type = 'service_request'
       and e.aggregate_id = new.id;

    insert into ops.outbox_event (type, version, aggregate_type, aggregate_id, aggregate_seq, occurred_at, payload)
    values ('request_cancelled', 1, 'service_request', new.id, v_seq, clock_timestamp(),
            jsonb_build_object('requestId', new.id));
  end if;
  return null;
end
$$;

drop trigger if exists service_request_cancelado_outbox on app.service_request;
create trigger service_request_cancelado_outbox
  after update of status on app.service_request
  for each row execute function private.request_cancel_enfileira_evento();

-- 3. Envio de mensagem (substitui a versao da 20261123100000; assinatura, retorno e comportamento iguais) ------
create or replace function private.message_send(p_conversation_id uuid, p_user_id uuid, p_client_message_id uuid,
  p_body text, p_now timestamptz)
returns table (out_outcome text, out_message_id uuid, out_created_at timestamptz)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  v_conv app.conversation%rowtype;
  v_texto text := btrim(coalesce(p_body, ''));
  v_id uuid;
  v_em timestamptz;
begin
  select * into v_conv from app.conversation c where c.id = p_conversation_id for share;
  if not found or (v_conv.customer_user_id <> p_user_id and v_conv.professional_id <> p_user_id) then
    return query select 'nao_encontrada'::text, null::uuid, null::timestamptz;
    return;
  end if;
  select m.id, m.created_at into v_id, v_em
    from app.message m
   where m.conversation_id = p_conversation_id and m.sender_user_id = p_user_id
     and m.client_message_id = p_client_message_id and m.kind = 'humana';
  if found then
    return query select 'repetida'::text, v_id, v_em;
    return;
  end if;
  if v_conv.state <> 'ativa' or v_conv.restricted_reason is not null then
    return query select 'somente_leitura'::text, null::uuid, null::timestamptz;
    return;
  end if;
  if char_length(v_texto) < 1 or char_length(v_texto) > 4000 then
    return query select 'texto_invalido'::text, null::uuid, null::timestamptz;
    return;
  end if;
  insert into app.message (conversation_id, kind, sender_user_id, client_message_id, body_text, state, created_at)
  values (p_conversation_id, 'humana', p_user_id, p_client_message_id, v_texto, 'enviada', p_now)
  returning id, created_at into v_id, v_em;

  -- Pacote D: outbox
  -- Uma mensagem humana = um agregado proprio (seq 1), sem disputa de seq. Mensagem de sistema nao passa por aqui.
  insert into ops.outbox_event (type, version, aggregate_type, aggregate_id, aggregate_seq, occurred_at, payload)
  values ('message_sent', 1, 'message', v_id, 1, p_now,
          jsonb_build_object('conversationId', p_conversation_id,
                             'senderRole', case when v_conv.customer_user_id = p_user_id
                                                then 'cliente' else 'profissional' end));

  return query select 'enviada'::text, v_id, v_em;
end
$$;

-- 4. Selecao (substitui a versao da 20261123100000; assinatura, retorno e comportamento iguais) ---------------
create or replace function private.request_select(p_request_id uuid, p_customer_id uuid, p_acceptance_id uuid,
  p_now timestamptz)
returns table (out_outcome text, out_selected_acceptance_id uuid, out_selected_at timestamptz)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  v_req app.service_request%rowtype;
  v_acc app.acceptance%rowtype;
  v_seq bigint;
begin
  select * into v_req from app.service_request r where r.id = p_request_id for update;
  if not found or v_req.customer_user_id <> p_customer_id then
    return query select 'nao_encontrado'::text, null::uuid, null::timestamptz;
    return;
  end if;
  if v_req.status not in ('publicado', 'selecionado') then
    return query select 'estado_invalido'::text, v_req.selected_acceptance_id, v_req.selected_at;
    return;
  end if;
  select * into v_acc from app.acceptance a where a.id = p_acceptance_id and a.request_id = p_request_id;
  if not found or v_acc.status <> 'ativo' then
    return query select 'aceite_invalido'::text, v_req.selected_acceptance_id, v_req.selected_at;
    return;
  end if;
  if v_req.selected_acceptance_id = p_acceptance_id then
    return query select 'sem_mudanca'::text, v_req.selected_acceptance_id, v_req.selected_at;
    return;
  end if;
  update app.service_request
     set status = 'selecionado', selected_acceptance_id = p_acceptance_id, selected_at = p_now,
         version = version + 1
   where id = p_request_id;

  -- Pacote D: outbox
  -- Aggregate do pedido com seq sequencial sob o lock 'for update' acima (mesmo padrao do work_accepted).
  select coalesce(max(e.aggregate_seq), 0) + 1 into v_seq
    from ops.outbox_event e
   where e.aggregate_type = 'service_request'
     and e.aggregate_id = p_request_id;

  insert into ops.outbox_event (type, version, aggregate_type, aggregate_id, aggregate_seq, occurred_at, payload)
  values ('request_selected', 1, 'service_request', p_request_id, v_seq, p_now,
          jsonb_build_object('requestId', p_request_id, 'acceptanceId', p_acceptance_id));

  return query select 'selecionado'::text, p_acceptance_id, p_now;
end
$$;

-- 5. Privilegios: funcoes novas so para app_system; gatilho sem execucao direta por papel algum -------------
revoke all on function
  private.cycle_request_view(uuid),
  private.cycle_active_professionals(uuid),
  private.cycle_conversation_view(uuid),
  private.request_cancel_enfileira_evento()
  from public, anon, authenticated, service_role, app_api, app_backup_reader;

grant execute on function
  private.cycle_request_view(uuid),
  private.cycle_active_professionals(uuid),
  private.cycle_conversation_view(uuid)
  to app_system;
