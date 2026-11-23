-- Pacote A (backlog H-061, H-077, H-078, H-080): concluir, desfazer conclusao, cancelar pedido, retirar aceite
-- e desistencia do selecionado. Todas as funcoes sao security definer, search_path vazio e so o papel app_system
-- as executa; cada uma confere o dono (cliente) ou o proprio profissional antes de mexer em qualquer linha.
--
-- Regras:
--   Concluir (cliente): so com status 'selecionado'; repetir devolve 'sem_mudanca'.
--   Desfazer conclusao (cliente): so ate 24 h depois de completed_at (limite inclusivo); depois, 'prazo_encerrado'.
--   Cancelar (cliente): so com status 'publicado' ou 'selecionado'. Todas as conversas viram somente_leitura,
--     exceto, com selecionado, a conversa do selecionado.
--   Retirar aceite (profissional): aceite 'ativo' em pedido 'publicado' ou 'selecionado'. A vaga continua consumida.
--     Se era o selecionado, e desistencia: o pedido volta para 'publicado' (sem troca automatica).
--   Em todos os casos a conversa afetada vira somente_leitura e recebe mensagem de sistema 'aceite_retirado'.
--
-- Nao altera private.acceptance_create: ela ja recusa pedido fora de 'publicado' (admissao_encerrada).

-- 1. Colunas de data. Constraints garantem que o status e a data andam juntos.
alter table app.service_request add column if not exists completed_at timestamptz;
alter table app.service_request add column if not exists cancelled_at timestamptz;

alter table app.service_request drop constraint if exists service_request_conclusao_consistente;
alter table app.service_request add constraint service_request_conclusao_consistente
  check ((status = 'concluido') = (completed_at is not null));

alter table app.service_request drop constraint if exists service_request_cancelamento_consistente;
alter table app.service_request add constraint service_request_cancelamento_consistente
  check ((status = 'cancelado') = (cancelled_at is not null));

-- 2. Lista de conversas ganha out_acceptance_id no fim (a tela do profissional precisa dele para retirar o aceite).
drop function if exists private.conversation_list_for_user(uuid);
create function private.conversation_list_for_user(p_user_id uuid)
returns table (out_conversation_id uuid, out_request_id uuid, out_service_name text, out_papel text,
  out_other_name text, out_state text, out_request_status text, out_selected boolean,
  out_last_kind text, out_last_event text, out_last_body text, out_last_at timestamptz,
  out_acceptance_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, r.id, s.name,
         case when c.customer_user_id = p_user_id then 'cliente' else 'profissional' end,
         case when c.customer_user_id = p_user_id then coalesce(p.public_name, 'Profissional') else r.first_name end,
         c.state, r.status, (r.selected_acceptance_id = c.acceptance_id),
         m.kind, m.system_event, m.body_text, m.created_at, c.acceptance_id
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

-- 3. Concluir (cliente). Codigos: concluido, sem_mudanca, nao_encontrado, estado_invalido.
create or replace function private.request_complete(p_request_id uuid, p_customer_id uuid, p_now timestamptz)
returns table (out_outcome text, out_status text, out_completed_at timestamptz)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  v_req app.service_request%rowtype;
begin
  if p_request_id is null or p_customer_id is null or p_now is null then
    raise exception 'conclusao_parametro_invalido' using errcode = '22023';
  end if;
  select * into v_req from app.service_request r where r.id = p_request_id for update;
  if not found or v_req.customer_user_id <> p_customer_id then
    return query select 'nao_encontrado'::text, null::text, null::timestamptz;
    return;
  end if;
  if v_req.status = 'concluido' then
    return query select 'sem_mudanca'::text, v_req.status, v_req.completed_at;
    return;
  end if;
  if v_req.status <> 'selecionado' then
    return query select 'estado_invalido'::text, v_req.status, null::timestamptz;
    return;
  end if;
  update app.service_request
     set status = 'concluido', completed_at = p_now, version = version + 1
   where id = p_request_id;
  return query select 'concluido'::text, 'concluido'::text, p_now;
end
$$;

-- 4. Desfazer conclusao (cliente), so ate 24 h depois de completed_at (inclusivo). Codigos: desfeito,
--    nao_encontrado, estado_invalido, prazo_encerrado. Volta para 'selecionado' com completed_at nulo.
create or replace function private.request_uncomplete(p_request_id uuid, p_customer_id uuid, p_now timestamptz)
returns table (out_outcome text, out_status text, out_completed_at timestamptz)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  v_req app.service_request%rowtype;
begin
  if p_request_id is null or p_customer_id is null or p_now is null then
    raise exception 'conclusao_parametro_invalido' using errcode = '22023';
  end if;
  select * into v_req from app.service_request r where r.id = p_request_id for update;
  if not found or v_req.customer_user_id <> p_customer_id then
    return query select 'nao_encontrado'::text, null::text, null::timestamptz;
    return;
  end if;
  if v_req.status <> 'concluido' or v_req.completed_at is null then
    return query select 'estado_invalido'::text, v_req.status, v_req.completed_at;
    return;
  end if;
  if p_now > v_req.completed_at + interval '24 hours' then
    return query select 'prazo_encerrado'::text, v_req.status, v_req.completed_at;
    return;
  end if;
  update app.service_request
     set status = 'selecionado', completed_at = null, version = version + 1
   where id = p_request_id;
  return query select 'desfeito'::text, 'selecionado'::text, null::timestamptz;
end
$$;

-- 5. Cancelar (cliente). Codigos: cancelado, sem_mudanca, nao_encontrado, estado_invalido.
--    Sem selecionado: todas as conversas do pedido ficam somente_leitura. Com selecionado: so a dele continua ativa.
create or replace function private.request_cancel(p_request_id uuid, p_customer_id uuid, p_now timestamptz)
returns table (out_outcome text, out_status text, out_cancelled_at timestamptz)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  v_req app.service_request%rowtype;
begin
  if p_request_id is null or p_customer_id is null or p_now is null then
    raise exception 'cancelamento_parametro_invalido' using errcode = '22023';
  end if;
  select * into v_req from app.service_request r where r.id = p_request_id for update;
  if not found or v_req.customer_user_id <> p_customer_id then
    return query select 'nao_encontrado'::text, null::text, null::timestamptz;
    return;
  end if;
  if v_req.status = 'cancelado' then
    return query select 'sem_mudanca'::text, v_req.status, v_req.cancelled_at;
    return;
  end if;
  if v_req.status not in ('publicado', 'selecionado') then
    return query select 'estado_invalido'::text, v_req.status, null::timestamptz;
    return;
  end if;
  update app.service_request
     set status = 'cancelado', cancelled_at = p_now, version = version + 1
   where id = p_request_id;
  update app.conversation c
     set state = 'somente_leitura'
   where c.request_id = p_request_id
     and c.state <> 'somente_leitura'
     and (v_req.selected_acceptance_id is null or c.acceptance_id <> v_req.selected_acceptance_id);
  return query select 'cancelado'::text, 'cancelado'::text, p_now;
end
$$;

-- 6. Retirar aceite (profissional, H-061) ou desistir do selecionado (H-080).
--    Codigos: retirado, desistiu, sem_mudanca, nao_encontrado, estado_invalido.
--    Ordem de bloqueio: pedido e depois aceite (mesma ordem de private.acceptance_create).
create or replace function private.acceptance_withdraw(p_acceptance_id uuid, p_professional_id uuid, p_now timestamptz)
returns table (out_outcome text, out_acceptance_id uuid, out_request_id uuid, out_status text, out_withdrawn_at timestamptz)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  v_request_id uuid;
  v_req        app.service_request%rowtype;
  v_acc        app.acceptance%rowtype;
  v_conv_id    uuid;
  v_outcome    text;
begin
  if p_acceptance_id is null or p_professional_id is null or p_now is null then
    raise exception 'retirada_parametro_invalido' using errcode = '22023';
  end if;
  select a.request_id into v_request_id
    from app.acceptance a
   where a.id = p_acceptance_id and a.professional_id = p_professional_id;
  if not found then
    return query select 'nao_encontrado'::text, null::uuid, null::uuid, null::text, null::timestamptz;
    return;
  end if;
  select * into v_req from app.service_request r where r.id = v_request_id for update;
  select * into v_acc from app.acceptance a where a.id = p_acceptance_id for update;
  if v_acc.status = 'retirado' then
    return query select 'sem_mudanca'::text, v_acc.id, v_acc.request_id, v_acc.status, v_acc.withdrawn_at;
    return;
  end if;
  if v_acc.status <> 'ativo' or v_req.status not in ('publicado', 'selecionado') then
    return query select 'estado_invalido'::text, v_acc.id, v_acc.request_id, v_acc.status, null::timestamptz;
    return;
  end if;

  if v_req.selected_acceptance_id = v_acc.id then
    -- Desistencia (H-080): pedido volta para publicado; selected_acceptance_id e selected_at nulos juntos.
    update app.service_request
       set status = 'publicado', selected_acceptance_id = null, selected_at = null, version = version + 1
     where id = v_req.id;
    v_outcome := 'desistiu';
  else
    v_outcome := 'retirado';
  end if;

  update app.acceptance
     set status = 'retirado', withdrawn_at = p_now
   where id = v_acc.id;

  update app.conversation c
     set state = 'somente_leitura'
   where c.acceptance_id = v_acc.id
  returning c.id into v_conv_id;

  insert into app.message (conversation_id, kind, sender_user_id, system_event, params, template_version,
                           dedupe_key, body_text, state, created_at)
  values (v_conv_id, 'sistema', null, 'aceite_retirado', jsonb_build_object('acceptance_id', v_acc.id), 1,
          'acceptance:' || v_acc.id::text || ':withdrawn', null, 'enviada', p_now);

  return query select v_outcome, v_acc.id, v_acc.request_id, 'retirado'::text, p_now;
end
$$;

-- 7. Privilegios: so app_system executa. Nada para public, anon, authenticated, service_role, app_api ou app_backup_reader.
revoke all on function
  private.conversation_list_for_user(uuid),
  private.request_complete(uuid, uuid, timestamptz),
  private.request_uncomplete(uuid, uuid, timestamptz),
  private.request_cancel(uuid, uuid, timestamptz),
  private.acceptance_withdraw(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;

grant execute on function private.conversation_list_for_user(uuid) to app_system;
grant execute on function private.request_complete(uuid, uuid, timestamptz) to app_system;
grant execute on function private.request_uncomplete(uuid, uuid, timestamptz) to app_system;
grant execute on function private.request_cancel(uuid, uuid, timestamptz) to app_system;
grant execute on function private.acceptance_withdraw(uuid, uuid, timestamptz) to app_system;
