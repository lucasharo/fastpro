-- Contato por WhatsApp, sem chat e sem "Escolhido" (decisao do dono, 2026-11-27).
--   Contato: o profissional com aceite ativo ve o numero enquanto o pedido nao for concluido nem cancelado (o prazo
--   de aceite deixa de fechar o contato). As demais conferencias e o registro de cada leitura continuam.
--   Conclusao: o cliente encerra um pedido publicado que tenha ao menos um aceite ativo (pedidos antigos em
--   'selecionado' continuam valendo). Desfazer volta ao estado anterior.
--   Avaliacao: o cliente escolhe, no pedido concluido, um dos profissionais que aceitaram.

create or replace function private.request_open_for_contact(p_request_id uuid, p_now timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
begin
  if p_request_id is null or p_now is null then
    raise exception 'contato_parametro_invalido' using errcode = '22023';
  end if;
  return exists (
    select 1 from app.service_request r
     where r.id = p_request_id
       and r.status not in ('concluido', 'cancelado'));
end
$$;

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
  if v_req.status not in ('publicado', 'selecionado')
     or not exists (select 1 from app.acceptance a where a.request_id = p_request_id and a.status = 'ativo') then
    return query select 'estado_invalido'::text, v_req.status, null::timestamptz;
    return;
  end if;
  update app.service_request
     set status = 'concluido', completed_at = p_now, version = version + 1
   where id = p_request_id;
  return query select 'concluido'::text, 'concluido'::text, p_now;
end
$$;

create or replace function private.request_uncomplete(p_request_id uuid, p_customer_id uuid, p_now timestamptz)
returns table (out_outcome text, out_status text, out_completed_at timestamptz)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  v_req app.service_request%rowtype;
  v_volta text;
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
  v_volta := case when v_req.selected_acceptance_id is null then 'publicado' else 'selecionado' end;
  update app.service_request
     set status = v_volta, completed_at = null, version = version + 1
   where id = p_request_id;
  return query select 'desfeito'::text, v_volta, null::timestamptz;
end
$$;

-- A versao de 5 argumentos sai para nao haver ambiguidade: o sexto argumento tem padrao nulo.
drop function if exists private.review_create(uuid, uuid, smallint, text, timestamptz);

create function private.review_create(p_request_id uuid, p_customer_id uuid, p_rating smallint, p_comment text,
                                      p_now timestamptz, p_acceptance_id uuid default null)
returns table (out_outcome text, out_review_id uuid, out_published_at timestamptz)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  v_req app.service_request%rowtype;
  v_prof uuid;
  v_texto text := nullif(btrim(coalesce(p_comment, '')), '');
  v_id uuid;
  v_em timestamptz;
begin
  select * into v_req from app.service_request r where r.id = p_request_id for update;
  if not found or v_req.customer_user_id <> p_customer_id then
    return query select 'nao_encontrado'::text, null::uuid, null::timestamptz;
    return;
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    return query select 'nota_invalida'::text, null::uuid, null::timestamptz;
    return;
  end if;
  if v_texto is not null and char_length(v_texto) > 1000 then
    return query select 'comentario_invalido'::text, null::uuid, null::timestamptz;
    return;
  end if;
  if v_texto is not null and not private.review_texto_permitido(v_texto) then
    return query select 'conteudo_nao_permitido'::text, null::uuid, null::timestamptz;
    return;
  end if;
  if exists (select 1 from app.review rv where rv.request_id = p_request_id) then
    return query select 'ja_existe'::text, null::uuid, null::timestamptz;
    return;
  end if;
  if v_req.status <> 'concluido' then
    return query select 'pedido_nao_concluido'::text, null::uuid, null::timestamptz;
    return;
  end if;
  -- Profissional informado (aceite ativo deste pedido); sem ele, vale o escolhido de pedidos antigos.
  select a.professional_id into v_prof
    from app.acceptance a
   where a.request_id = p_request_id
     and a.id = coalesce(p_acceptance_id, v_req.selected_acceptance_id)
     and (a.status = 'ativo' or a.id = v_req.selected_acceptance_id);
  if v_prof is null then
    return query select 'sem_profissional'::text, null::uuid, null::timestamptz;
    return;
  end if;
  insert into app.review (request_id, professional_id, customer_user_id, rating, comment, published_at)
  values (p_request_id, v_prof, p_customer_id, p_rating, v_texto, p_now)
  returning id, published_at into v_id, v_em;
  return query select 'criada'::text, v_id, v_em;
end
$$;

revoke all on function private.review_create(uuid, uuid, smallint, text, timestamptz, uuid)
  from public, anon, authenticated, service_role, app_api;
grant execute on function private.review_create(uuid, uuid, smallint, text, timestamptz, uuid) to app_system;

-- "Pode avaliar": ha algum profissional que aceitou (ou o escolhido de pedidos antigos).
create or replace function private.review_for_request(p_request_id uuid, p_customer_id uuid)
returns table (out_request_status text, out_has_selected boolean, out_review_id uuid, out_rating smallint,
               out_comment text, out_published_at timestamptz, out_edited_at timestamptz, out_reply_text text,
               out_replied_at timestamptz, out_prazo_encerrado boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select r.status,
         (r.selected_acceptance_id is not null
          or exists (select 1 from app.acceptance a where a.request_id = r.id and a.status = 'ativo')),
         rv.id, rv.rating, rv.comment, rv.published_at, rv.edited_at, rv.reply_text, rv.replied_at,
         case when rv.id is null then false else now() > rv.published_at + interval '7 days' end
    from app.service_request r
    left join app.review rv on rv.request_id = r.id
   where r.id = p_request_id
     and r.customer_user_id = p_customer_id
$$;
