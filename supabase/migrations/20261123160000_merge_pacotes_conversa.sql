-- Integracao dos pacotes A, D e E (2026-11-23). As migracoes 110000 (A), 140000 (D) e 150000 (E) recriaram as
-- mesmas funcoes em paralelo; como a do E roda por ultimo, ela apagaria o que A e D acrescentaram. Esta migracao
-- deixa a versao final com as tres partes:
--   private.conversation_list_for_user: colunas do E (nao lidas, arquivada, bloqueada) + out_acceptance_id do A.
--   private.message_send: filtro e bloqueio do E + registro no outbox do D (aviso de mensagem nova).

-- 1. Lista de conversas (A + E).
drop function if exists private.conversation_list_for_user(uuid);
create function private.conversation_list_for_user(p_user_id uuid)
returns table (out_conversation_id uuid, out_request_id uuid, out_service_name text, out_papel text,
  out_other_name text, out_state text, out_request_status text, out_selected boolean,
  out_last_kind text, out_last_event text, out_last_body text, out_last_at timestamptz,
  out_unread_count bigint, out_archived boolean, out_blocked boolean, out_acceptance_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, r.id, s.name,
         case when c.customer_user_id = p_user_id then 'cliente' else 'profissional' end,
         case when c.customer_user_id = p_user_id then coalesce(p.public_name, 'Profissional') else r.first_name end,
         c.state, r.status, (r.selected_acceptance_id = c.acceptance_id),
         m.kind, m.system_event, m.body_text, m.created_at,
         private.conversation_unread_for(c.id, p_user_id),
         private.conversation_archived_for(c.id, p_user_id),
         exists (select 1 from app.conversation_block cb where cb.conversation_id = c.id),
         c.acceptance_id
    from app.conversation c
    join app.service_request r on r.id = c.request_id
    join app.service s on s.id = r.service_id
    left join app.professional_profile p on p.user_id = c.professional_id
    left join lateral (
      select mm.kind, mm.system_event, mm.body_text, mm.created_at
        from app.message mm
       where mm.conversation_id = c.id
       order by mm.created_at desc, mm.id desc
       limit 1
    ) m on true
   where c.customer_user_id = p_user_id or c.professional_id = p_user_id
   order by coalesce(m.created_at, c.created_at) desc
   limit 100
$$;

revoke all on function private.conversation_list_for_user(uuid)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
grant execute on function private.conversation_list_for_user(uuid) to app_system;

-- 2. Envio de mensagem (E + D). Mesma assinatura e retorno.
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
  -- Pacote E: filtro e bloqueio
  if exists (select 1 from app.conversation_block cb where cb.conversation_id = p_conversation_id) then
    return query select 'conversa_bloqueada'::text, null::uuid, null::timestamptz;
    return;
  end if;
  if char_length(v_texto) < 1 or char_length(v_texto) > 4000 then
    return query select 'texto_invalido'::text, null::uuid, null::timestamptz;
    return;
  end if;
  -- E-mail e telefone brasileiro (DDD + 8 ou 9 digitos, com ou sem +55 e separadores) nao passam no chat.
  if v_texto ~* '[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}'
     or v_texto ~ '(^|\D)(\+?55[ .-]?)?\(?[0-9]{2}\)?[ .-]?9?[0-9]{4}[ .-]?[0-9]{4}(\D|$)' then
    return query select 'conteudo_nao_permitido'::text, null::uuid, null::timestamptz;
    return;
  end if;
  insert into app.message (conversation_id, kind, sender_user_id, client_message_id, body_text, state, created_at)
  values (p_conversation_id, 'humana', p_user_id, p_client_message_id, v_texto, 'enviada', p_now)
  returning id, created_at into v_id, v_em;

  -- Pacote D: outbox (uma mensagem humana = um agregado proprio, seq 1; mensagem de sistema nao passa por aqui).
  insert into ops.outbox_event (type, version, aggregate_type, aggregate_id, aggregate_seq, occurred_at, payload)
  values ('message_sent', 1, 'message', v_id, 1, p_now,
          jsonb_build_object('conversationId', p_conversation_id,
                             'senderRole', case when v_conv.customer_user_id = p_user_id
                                                then 'cliente' else 'profissional' end));

  return query select 'enviada'::text, v_id, v_em;
end
$$;

revoke all on function private.message_send(uuid, uuid, uuid, text, timestamptz)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
grant execute on function private.message_send(uuid, uuid, uuid, text, timestamptz) to app_system;
