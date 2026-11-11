-- Desfaz 20261111280000_admin_add_session_step_up.sql (H-102 ajustado para H-073). EXECUCAO MANUAL e
-- consciente: so em banco de desenvolvimento. Remove as funcoes novas, restaura admin_guard e
-- admin_session_open com a forma anterior, remove a coluna totp_at e tira a migracao do registro.
-- A acao de auditoria admin.session.step_up fica no catalogo (eventos ja gravados dependem dela).
begin;

drop function if exists private.admin_step_up(text, timestamptz);
drop function if exists private.admin_session_subject(text, timestamptz);
drop function if exists private.admin_guard(text, timestamptz);

create function private.admin_guard(p_secret_hash text, p_now timestamptz)
returns table (out_user_id uuid, out_roles text[], out_permissions text[])
language sql
stable
security definer
set search_path = ''
as $$
  select s.user_id,
         array(select r.role_code
                 from app.admin_user_role r
                where r.user_id = s.user_id and r.revoked_at is null
                order by r.role_code),
         array(select distinct rp.permission_code
                 from app.admin_user_role r
                 join app.admin_role_permission rp on rp.role_code = r.role_code
                where r.user_id = s.user_id and r.revoked_at is null
                order by rp.permission_code)
    from app.admin_session s
    join app.admin_staff st on st.user_id = s.user_id and st.status = 'ativo'
   where s.secret_hash = p_secret_hash
     and s.revoked_at is null
     and s.aal2_at is not null
     and s.expires_at > p_now
     and exists (select 1 from app.admin_user_role r
                  where r.user_id = s.user_id and r.revoked_at is null)
$$;

create or replace function private.admin_session_open(
  p_session_id uuid, p_user_id uuid, p_secret_hash text, p_now timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_session_id is null or p_user_id is null or p_now is null
     or p_secret_hash is null or p_secret_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  if not exists (select 1 from app.admin_staff s where s.user_id = p_user_id and s.status = 'ativo')
     or not exists (select 1 from app.admin_user_role r
                     where r.user_id = p_user_id and r.revoked_at is null) then
    return false;
  end if;

  insert into app.admin_session (id, user_id, secret_hash, aal2_at, created_at, expires_at)
  values (p_session_id, p_user_id, p_secret_hash, p_now, p_now, p_now + interval '8 hours');

  perform private.audit_append('admin:' || p_user_id::text, 'admin', 'admin.session.opened',
    'admin_session', p_session_id, '{}'::jsonb, '{"status":"aberta"}'::jsonb, null, null);
  return true;
end
$$;

alter table app.admin_session drop column if exists totp_at;

revoke all on function
  private.admin_guard(text, timestamptz),
  private.admin_session_open(uuid, uuid, text, timestamptz)
  from public, anon, authenticated, service_role, app_api;
grant execute on function
  private.admin_guard(text, timestamptz),
  private.admin_session_open(uuid, uuid, text, timestamptz)
  to app_system;

delete from ops.schema_migration where version = '20261111280000';

commit;
