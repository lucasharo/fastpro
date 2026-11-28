-- Console admin (decisao do dono, 2026-11-24): moderacao de denuncias do chat e de avaliacoes, auditoria recente e
-- equipe. A API confere a permissao pela guarda (private.admin_guard) antes de chamar estas funcoes; toda decisao
-- vai para a auditoria (private.audit_append). Funcoes so para app_system.

-- 1. Denuncias: decisao do moderador.
alter table app.chat_report drop constraint if exists chat_report_status_check;
alter table app.chat_report add constraint chat_report_status_check check (status in ('aberto', 'resolvido', 'descartado'));
alter table app.chat_report add column if not exists decided_at timestamptz;
alter table app.chat_report add column if not exists decided_by uuid references app.app_user (id) on delete restrict;
alter table app.chat_report drop constraint if exists chat_report_decisao_consistente;
alter table app.chat_report add constraint chat_report_decisao_consistente
  check ((status = 'aberto') = (decided_at is null) and (decided_at is null) = (decided_by is null));

-- 2. Avaliacoes: o moderador pode ocultar (sai do perfil publico e da media).
alter table app.review add column if not exists hidden_at timestamptz;
alter table app.review add column if not exists hidden_by uuid references app.app_user (id) on delete restrict;
alter table app.review drop constraint if exists review_ocultacao_consistente;
alter table app.review add constraint review_ocultacao_consistente check ((hidden_at is null) = (hidden_by is null));

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
    left join app.review rv on rv.professional_id = a.user_id and rv.hidden_at is null
   where a.user_id is not null
   group by a.user_id
$$;

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
     and rv.hidden_at is null
   order by rv.published_at desc, rv.id desc
   limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

-- 3. Listas e decisoes do console.
create or replace function private.admin_reports_list(p_status text)
returns table (out_id uuid, out_reason text, out_text text, out_status text, out_created_at timestamptz,
  out_decided_at timestamptz, out_service_name text, out_reporter_role text, out_conversation_state text)
language sql
stable
security definer
set search_path = ''
as $$
  select cr.id, cr.reason, cr.body_text, cr.status, cr.created_at, cr.decided_at, s.name,
         case when cr.reporter_user_id = c.customer_user_id then 'cliente' else 'profissional' end,
         c.state
    from app.chat_report cr
    join app.conversation c on c.id = cr.conversation_id
    join app.service_request r on r.id = c.request_id
    join app.service s on s.id = r.service_id
   where p_status is null or cr.status = p_status
   order by cr.created_at desc
   limit 200
$$;

create or replace function private.admin_report_decide(p_report_id uuid, p_admin_user uuid, p_decision text, p_now timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_decision not in ('resolvido', 'descartado') then
    return 'decisao_invalida';
  end if;
  select status into v_status from app.chat_report where id = p_report_id for update;
  if not found then
    return 'nao_encontrado';
  end if;
  if v_status <> 'aberto' then
    return 'ja_decidido';
  end if;
  update app.chat_report set status = p_decision, decided_at = p_now, decided_by = p_admin_user where id = p_report_id;
  perform private.audit_append('admin:' || p_admin_user::text, 'moderador', 'moderation.report.decided',
    'chat_report', p_report_id, jsonb_build_object('status', 'aberto'), jsonb_build_object('status', p_decision), null, null);
  return 'ok';
end
$$;

create or replace function private.admin_reviews_list(p_limit integer)
returns table (out_id uuid, out_rating smallint, out_comment text, out_reply_text text, out_published_at timestamptz,
  out_hidden boolean, out_professional_name text, out_service_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select rv.id, rv.rating, rv.comment, rv.reply_text, rv.published_at, (rv.hidden_at is not null),
         coalesce(p.public_name, 'Profissional'), s.name
    from app.review rv
    join app.service_request r on r.id = rv.request_id
    join app.service s on s.id = r.service_id
    left join app.professional_profile p on p.user_id = rv.professional_id
   order by rv.published_at desc, rv.id desc
   limit least(greatest(coalesce(p_limit, 100), 1), 200)
$$;

create or replace function private.admin_review_visibility(p_review_id uuid, p_admin_user uuid, p_hide boolean, p_now timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_oculta boolean;
begin
  select hidden_at is not null into v_oculta from app.review where id = p_review_id for update;
  if not found then
    return 'nao_encontrado';
  end if;
  if v_oculta = p_hide then
    return 'sem_mudanca';
  end if;
  update app.review
     set hidden_at = case when p_hide then p_now else null end,
         hidden_by = case when p_hide then p_admin_user else null end
   where id = p_review_id;
  perform private.audit_append('admin:' || p_admin_user::text, 'moderador',
    case when p_hide then 'moderation.review.hidden' else 'moderation.review.shown' end,
    'review', p_review_id, jsonb_build_object('visivel', (not v_oculta)::text),
    jsonb_build_object('visivel', (not p_hide)::text), null, null);
  return 'ok';
end
$$;

create or replace function private.admin_audit_recent(p_limit integer)
returns table (out_seq bigint, out_at timestamptz, out_actor_ref text, out_actor_role text, out_action text,
  out_object_type text, out_object_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select e.seq, e.at, e.actor_ref, e.actor_role, e.action, e.object_type, e.object_id
    from audit.audit_event e
   order by e.seq desc
   limit least(greatest(coalesce(p_limit, 100), 1), 200)
$$;

create or replace function private.admin_staff_list()
returns table (out_user_id uuid, out_email text, out_status text, out_roles text[], out_since timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.user_id, u.email, s.status,
         array(select r.role_code from app.admin_user_role r where r.user_id = s.user_id and r.revoked_at is null
                order by r.role_code),
         s.created_at
    from app.admin_staff s
    join app.app_user u on u.id = s.user_id
   order by s.created_at desc
   limit 200
$$;

revoke all on function
  private.admin_reports_list(text),
  private.admin_report_decide(uuid, uuid, text, timestamptz),
  private.admin_reviews_list(integer),
  private.admin_review_visibility(uuid, uuid, boolean, timestamptz),
  private.admin_audit_recent(integer),
  private.admin_staff_list()
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
grant execute on function private.admin_reports_list(text) to app_system;
grant execute on function private.admin_report_decide(uuid, uuid, text, timestamptz) to app_system;
grant execute on function private.admin_reviews_list(integer) to app_system;
grant execute on function private.admin_review_visibility(uuid, uuid, boolean, timestamptz) to app_system;
grant execute on function private.admin_audit_recent(integer) to app_system;
grant execute on function private.admin_staff_list() to app_system;
