-- Desfaz 20261111220000_admin_create_rbac.sql (H-102). EXECUCAO MANUAL e consciente: so em banco de
-- desenvolvimento. Remove as tabelas de papel, convite e sessao admin (com o que existir nelas), as
-- funcoes novas e apaga os pedidos de aprovacao sem alvo (criados so por convite de Superadmin), para
-- restaurar a regra NOT NULL de subject_user_id. Restaura a funcao de reserva e o gatilho de voto da
-- migracao 20261111190000. As acoes de auditoria admin.* ficam inativas (eventos ja gravados dependem
-- delas e nao podem ser apagados). Tira a migracao do registro.
begin;
drop function if exists private.admin_invite_activate(text, timestamptz);
drop function if exists private.admin_invite_record_code_failure(text, timestamptz);
drop function if exists private.admin_invite_mark_waiting(text, uuid, timestamptz);
drop function if exists private.admin_invite_lookup(text, timestamptz);
drop function if exists private.admin_invite_issue(uuid, text, text, text, bytea, text, text[], uuid, uuid, text, timestamptz);
drop function if exists private.admin_email_is_reserved(text, text);
drop function if exists private.admin_role_revoke(uuid, uuid, text, timestamptz);
drop function if exists private.admin_role_grant(uuid, uuid, text, uuid, timestamptz);
drop function if exists private.admin_self_grant_denied_record(uuid, text);
drop function if exists private.admin_approval_vote(uuid, uuid, timestamptz);
drop function if exists private.admin_approval_open(uuid, text, uuid, text, uuid, timestamptz);
drop function if exists private.admin_session_purge(timestamptz);
drop function if exists private.admin_session_revoke(text, timestamptz);
drop function if exists private.admin_session_open(uuid, uuid, text, timestamptz);
drop function if exists private.admin_guard(text, timestamptz);
drop function if exists private.admin_has_permission(uuid, text);
drop table if exists app.admin_session;
drop table if exists app.admin_invite;
drop table if exists app.admin_user_role;
drop table if exists app.admin_role_permission;
drop table if exists app.admin_permission;
drop table if exists app.admin_role;

-- Restaura a funcao de reserva da migracao 20261111190000 (um argumento; so conta administrativa).
create or replace function private.admin_email_is_reserved(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
      from app.app_user u
      join app.admin_staff s on s.user_id = u.id
     where u.email = p_email
  ), false)
$$;

-- Restaura o gatilho de voto da migracao 20261111190000 (aprovador so precisa estar ativo).
create or replace function private.approval_vote_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_req app.approval_request%rowtype;
begin
  select * into v_req from app.approval_request r where r.id = new.approval_request_id;
  if not found then
    raise exception 'aprovacao_inexistente' using errcode = '23503';
  end if;
  if v_req.status <> 'pendente' then
    raise exception 'aprovacao_nao_pendente' using errcode = '23514';
  end if;
  if new.approver_id = v_req.requested_by or new.approver_id = v_req.subject_user_id then
    raise exception 'aprovacao_propria' using errcode = '42501';
  end if;
  if not exists (
    select 1 from app.admin_staff s where s.user_id = new.approver_id and s.status = 'ativo'
  ) then
    raise exception 'aprovador_nao_ativo' using errcode = '42501';
  end if;
  return new;
end
$$;

grant execute on function private.admin_email_is_reserved(text) to app_system;
revoke all on function private.admin_email_is_reserved(text) from public, anon, authenticated, service_role, app_api;

delete from app.approval_vote
 where approval_request_id in (select id from app.approval_request where subject_user_id is null);
delete from app.approval_request where subject_user_id is null;
alter table app.approval_request alter column subject_user_id set not null;

update audit.action_catalog set active = false where action like 'admin.%';
delete from ops.schema_migration where version = '20261111220000';
commit;
