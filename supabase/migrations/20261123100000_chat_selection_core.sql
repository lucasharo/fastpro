-- Ciclo central (decisao do dono, 2026-11-23): o cliente ve quem aceitou, conversa por texto e escolhe um
-- profissional; o profissional conversa com o cliente. Base do backlog E7 (H-065, H-066) e E8 (H-074, H-076).
-- Tabelas continuam fechadas (RLS forcada, sem politicas); tudo passa por funcoes security definer do papel
-- app_system, que conferem a participacao de quem chama. Mensagens seguem imutaveis.

-- 1. Pedido guarda o aceite escolhido.
alter table app.service_request add column if not exists selected_acceptance_id uuid references app.acceptance (id) on delete restrict;
alter table app.service_request add column if not exists selected_at timestamptz;

alter table app.service_request drop constraint if exists service_request_selecao_consistente;
alter table app.service_request add constraint service_request_selecao_consistente
  check ((selected_acceptance_id is null) = (selected_at is null)
         and (status <> 'selecionado' or selected_acceptance_id is not null));

-- 2. Mensagem humana: so por private.message_send (que confere membro e estado). O gatilho deixa de recusar
-- a humana e passa a conferir a forma minima; a escrita continua sem grant direto para qualquer papel.
create or replace function private.message_guard_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'humana' and (new.body_text is null or new.client_message_id is null) then
    raise exception 'mensagem_humana_incompleta' using errcode = '23514';
  end if;
  return new;
end
$$;

-- 3. Participacao: o usuario e o cliente dono ou o profissional da conversa.
create or replace function private.conversation_member(p_conversation_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.conversation c
     where c.id = p_conversation_id
       and (c.customer_user_id = p_user_id or c.professional_id = p_user_id)
  )
$$;

-- 4. Interessados do pedido (so o dono). Nome publico do profissional, nunca e-mail, telefone ou documento.
create or replace function private.request_acceptances_owner(p_request_id uuid, p_customer_id uuid)
returns table (out_acceptance_id uuid, out_professional_name text, out_professional_slug text, out_slot_no smallint,
  out_status text, out_accepted_at timestamptz, out_conversation_id uuid, out_conversation_state text,
  out_selected boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, coalesce(p.public_name, 'Profissional'), p.slug, a.slot_no, a.status, a.accepted_at,
         c.id, c.state, (r.selected_acceptance_id = a.id)
    from app.service_request r
    join app.acceptance a on a.request_id = r.id
    left join app.professional_profile p on p.user_id = a.professional_id
    left join app.conversation c on c.acceptance_id = a.id
   where r.id = p_request_id
     and r.customer_user_id = p_customer_id
   order by a.slot_no
$$;

-- 5. Conversas do usuario (cliente ou profissional), da mais recente para a mais antiga.
create or replace function private.conversation_list_for_user(p_user_id uuid)
returns table (out_conversation_id uuid, out_request_id uuid, out_service_name text, out_papel text,
  out_other_name text, out_state text, out_request_status text, out_selected boolean,
  out_last_kind text, out_last_event text, out_last_body text, out_last_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, r.id, s.name,
         case when c.customer_user_id = p_user_id then 'cliente' else 'profissional' end,
         case when c.customer_user_id = p_user_id then coalesce(p.public_name, 'Profissional') else r.first_name end,
         c.state, r.status, (r.selected_acceptance_id = c.acceptance_id),
         m.kind, m.system_event, m.body_text, m.created_at
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

-- 6. Mensagens de uma conversa (so membros; quem nao e membro recebe zero linhas).
create or replace function private.conversation_messages_for_user(p_conversation_id uuid, p_user_id uuid)
returns table (out_message_id uuid, out_kind text, out_mine boolean, out_body text, out_event text,
  out_created_at timestamptz, out_state text, out_other_name text, out_service_name text, out_request_id uuid,
  out_papel text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.kind, (m.sender_user_id = p_user_id), m.body_text, m.system_event, m.created_at, c.state,
         case when c.customer_user_id = p_user_id then coalesce(p.public_name, 'Profissional') else r.first_name end,
         s.name, r.id,
         case when c.customer_user_id = p_user_id then 'cliente' else 'profissional' end
    from app.conversation c
    join app.service_request r on r.id = c.request_id
    join app.service s on s.id = r.service_id
    left join app.professional_profile p on p.user_id = c.professional_id
    join app.message m on m.conversation_id = c.id
   where c.id = p_conversation_id
     and (c.customer_user_id = p_user_id or c.professional_id = p_user_id)
   order by m.created_at, m.id
   limit 500
$$;

-- 7. Envio de mensagem de texto. Idempotente por (conversa, remetente, client_message_id).
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

-- 8. Selecao (H-074) e troca entre participantes previos (H-076). So o dono; so aceite ativo do proprio pedido.
-- Pedido concluido ou cancelado nao muda. Conversas continuam como estao (H-075).
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

revoke all on function
  private.conversation_member(uuid, uuid),
  private.request_acceptances_owner(uuid, uuid),
  private.conversation_list_for_user(uuid),
  private.conversation_messages_for_user(uuid, uuid),
  private.message_send(uuid, uuid, uuid, text, timestamptz),
  private.request_select(uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;

grant execute on function private.request_acceptances_owner(uuid, uuid) to app_system;
grant execute on function private.conversation_list_for_user(uuid) to app_system;
grant execute on function private.conversation_messages_for_user(uuid, uuid) to app_system;
grant execute on function private.message_send(uuid, uuid, uuid, text, timestamptz) to app_system;
grant execute on function private.request_select(uuid, uuid, uuid, timestamptz) to app_system;
