-- Desfaz supabase/migrations/20261123140000_notifications_core_cycle.sql (Pacote D).
-- Restaura message_send e request_select exatamente como estavam na 20261123100000 e remove o gatilho e as
-- funcoes de leitura do ciclo. Nao apaga linhas ja gravadas em ops.outbox_event (sao historico do outbox).

drop trigger if exists service_request_cancelado_outbox on app.service_request;
drop function if exists private.request_cancel_enfileira_evento();
drop function if exists private.cycle_request_view(uuid);
drop function if exists private.cycle_active_professionals(uuid);
drop function if exists private.cycle_conversation_view(uuid);

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
  return query select 'enviada'::text, v_id, v_em;
end
$$;

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
  return query select 'selecionado'::text, p_acceptance_id, p_now;
end
$$;
