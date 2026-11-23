-- Pacote B (2026-11-23) | Avaliacoes do servico e perfil publico do profissional (H-086, H-088, H-089).
-- Cria app.review: uma avaliacao por pedido, do cliente dono sobre o profissional do aceite escolhido
-- (app.service_request.selected_acceptance_id), e a resposta publica unica do profissional.
-- Tabela fechada: RLS habilitada e forcada, sem politicas; tudo passa por funcoes security definer do papel
-- app_system. Autor sempre "Cliente do FastPro": nenhuma funcao devolve nome, e-mail ou id do cliente.
-- Filtro minimo: comentario e resposta sem e-mail, telefone ou link (codigo conteudo_nao_permitido).
-- Estilo e grants de 20261123100000_chat_selection_core.sql. Nao aplicada no banco nesta entrega.

-- 1. Tabela de avaliacoes.
create table if not exists app.review (
  id                uuid primary key default gen_random_uuid(),
  request_id        uuid not null references app.service_request (id) on delete restrict,
  professional_id   uuid not null references app.professional_profile (user_id) on delete restrict,
  customer_user_id  uuid not null references app.app_user (id) on delete restrict,
  rating            smallint not null check (rating between 1 and 5),
  comment           text check (comment is null or char_length(comment) between 1 and 1000),
  published_at      timestamptz not null default now(),
  edited_at         timestamptz,
  reply_text        text check (reply_text is null or char_length(reply_text) between 1 and 1000),
  replied_at        timestamptz,
  created_at        timestamptz not null default now(),
  constraint review_pedido_key unique (request_id),
  constraint review_resposta_consistente check ((reply_text is null) = (replied_at is null))
);

create index if not exists review_profissional_publicado_idx
  on app.review (professional_id, published_at desc);

comment on table app.review is
  'Avaliacao de pedido concluido (H-086, H-088). Uma por pedido; editavel por 7 dias; uma resposta publica do profissional. Sem nome do cliente.';

alter table app.review enable row level security;
alter table app.review force row level security;

revoke all on app.review from public, anon, authenticated, service_role, app_api, app_backup_reader;
grant select on app.review to app_system;

-- 2. Filtro minimo de texto publico: recusa e-mail, telefone e link.
create or replace function private.review_texto_permitido(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select not (
    p_text ~* '[a-z0-9._%+-]+@[a-z0-9-]+\.[a-z]{2,}'
    or p_text ~* '(https?://|www\.)'
    or p_text ~* '[a-z0-9-]+\.(com|net|org|br|io|app|dev|info|biz)\y'
    or (p_text ~ '\d[\d\s().-]{7,}\d' and length(regexp_replace(p_text, '\D', '', 'g')) >= 10)
  )
$$;

-- 3. Profissional visivel por slug (mesma regra de private.professional_public_profile). Null se nao visivel.
create or replace function private.professional_visible_user_by_slug(p_slug text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id
    from app.professional_profile p
    join app.app_user u on u.id = p.user_id
   where p_slug ~ '^[a-z0-9][a-z0-9-]{0,99}$'
     and p.slug = p_slug
     and p.verification_status = 'aprovada'
     and p.suspended_at is null
     and u.status = 'ativo'
     and not exists (
       select 1
         from app.verification_case c
        where c.professional_id = p.user_id
          and c.status <> 'aprovada')
$$;

-- 4. Criacao (H-086). So o dono, so com pedido concluido, avalia o profissional do aceite escolhido.
create or replace function private.review_create(p_request_id uuid, p_customer_id uuid, p_rating smallint,
  p_comment text, p_now timestamptz)
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
  select a.professional_id into v_prof
    from app.acceptance a
   where a.id = v_req.selected_acceptance_id and a.request_id = p_request_id;
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

-- 5. Edicao (H-086). So o dono e ate 7 dias depois da publicacao. A resposta do profissional nao muda.
create or replace function private.review_update(p_request_id uuid, p_customer_id uuid, p_rating smallint,
  p_comment text, p_now timestamptz)
returns table (out_outcome text, out_edited_at timestamptz)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  v_rev app.review%rowtype;
  v_texto text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  select * into v_rev from app.review rv
   where rv.request_id = p_request_id and rv.customer_user_id = p_customer_id
     for update;
  if not found then
    return query select 'nao_encontrado'::text, null::timestamptz;
    return;
  end if;
  if p_now > v_rev.published_at + interval '7 days' then
    return query select 'prazo_encerrado'::text, null::timestamptz;
    return;
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    return query select 'nota_invalida'::text, null::timestamptz;
    return;
  end if;
  if v_texto is not null and char_length(v_texto) > 1000 then
    return query select 'comentario_invalido'::text, null::timestamptz;
    return;
  end if;
  if v_texto is not null and not private.review_texto_permitido(v_texto) then
    return query select 'conteudo_nao_permitido'::text, null::timestamptz;
    return;
  end if;
  update app.review
     set rating = p_rating, comment = v_texto, edited_at = p_now
   where id = v_rev.id;
  return query select 'atualizada'::text, p_now;
end
$$;

-- 6. Resposta publica unica do profissional avaliado (H-088). Nao altera a nota nem o comentario.
create or replace function private.review_reply(p_review_id uuid, p_professional_id uuid, p_reply text,
  p_now timestamptz)
returns table (out_outcome text, out_replied_at timestamptz)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  v_rev app.review%rowtype;
  v_texto text := nullif(btrim(coalesce(p_reply, '')), '');
begin
  select * into v_rev from app.review rv where rv.id = p_review_id for update;
  if not found or v_rev.professional_id <> p_professional_id then
    return query select 'nao_encontrada'::text, null::timestamptz;
    return;
  end if;
  if v_rev.reply_text is not null then
    return query select 'ja_respondida'::text, null::timestamptz;
    return;
  end if;
  if v_texto is null or char_length(v_texto) > 1000 then
    return query select 'texto_invalido'::text, null::timestamptz;
    return;
  end if;
  if not private.review_texto_permitido(v_texto) then
    return query select 'conteudo_nao_permitido'::text, null::timestamptz;
    return;
  end if;
  update app.review
     set reply_text = v_texto, replied_at = p_now
   where id = v_rev.id;
  return query select 'respondida'::text, p_now;
end
$$;

-- 7. Leitura do dono: a avaliacao do pedido e o que ainda pode ser feito. Zero linhas se nao for o dono.
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
         (r.selected_acceptance_id is not null),
         rv.id, rv.rating, rv.comment, rv.published_at, rv.edited_at, rv.reply_text, rv.replied_at,
         case when rv.id is null then false else now() > rv.published_at + interval '7 days' end
    from app.service_request r
    left join app.review rv on rv.request_id = r.id
   where r.id = p_request_id
     and r.customer_user_id = p_customer_id
$$;

-- 8. Resumo publico: media com 1 casa e quantidade. Zero linhas se o perfil nao for visivel. Sem avaliacoes: media nula.
create or replace function private.professional_rating_summary(p_slug text)
returns table (out_average numeric, out_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  with alvo as (
    select private.professional_visible_user_by_slug(p_slug) as user_id
  )
  select round(avg(rv.rating)::numeric, 1), count(rv.id)::integer
    from alvo a
    left join app.review rv on rv.professional_id = a.user_id
   where a.user_id is not null
   group by a.user_id
$$;

-- 9. Avaliacoes publicas do perfil, da mais recente para a mais antiga (limite entre 1 e 50). Sem nome do cliente.
create or replace function private.reviews_for_professional_slug(p_slug text, p_limit integer)
returns table (out_rating smallint, out_comment text, out_published_at timestamptz, out_reply_text text,
  out_replied_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select rv.rating, rv.comment, rv.published_at, rv.reply_text, rv.replied_at
    from app.review rv
   where rv.professional_id = private.professional_visible_user_by_slug(p_slug)
   order by rv.published_at desc, rv.id desc
   limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

-- 10. Avaliacoes recebidas pelo profissional logado (inclui as nao publicas: so o proprio profissional ve).
create or replace function private.reviews_for_professional(p_professional_id uuid)
returns table (out_review_id uuid, out_rating smallint, out_comment text, out_published_at timestamptz,
  out_reply_text text, out_replied_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select rv.id, rv.rating, rv.comment, rv.published_at, rv.reply_text, rv.replied_at
    from app.review rv
   where rv.professional_id = p_professional_id
   order by rv.published_at desc, rv.id desc
   limit 200
$$;

revoke all on function
  private.review_texto_permitido(text),
  private.professional_visible_user_by_slug(text),
  private.review_create(uuid, uuid, smallint, text, timestamptz),
  private.review_update(uuid, uuid, smallint, text, timestamptz),
  private.review_reply(uuid, uuid, text, timestamptz),
  private.review_for_request(uuid, uuid),
  private.professional_rating_summary(text),
  private.reviews_for_professional_slug(text, integer),
  private.reviews_for_professional(uuid)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;

grant execute on function private.review_texto_permitido(text) to app_system;
grant execute on function private.review_create(uuid, uuid, smallint, text, timestamptz) to app_system;
grant execute on function private.review_update(uuid, uuid, smallint, text, timestamptz) to app_system;
grant execute on function private.review_reply(uuid, uuid, text, timestamptz) to app_system;
grant execute on function private.review_for_request(uuid, uuid) to app_system;
grant execute on function private.professional_rating_summary(text) to app_system;
grant execute on function private.reviews_for_professional_slug(text, integer) to app_system;
grant execute on function private.reviews_for_professional(uuid) to app_system;
