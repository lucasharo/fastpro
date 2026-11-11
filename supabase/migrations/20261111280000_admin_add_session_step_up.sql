-- H-102 (ajuste para H-073, #83) | Confirmacao recente do segundo fator na sessao admin
-- (docs/factory/60-DESENHO-H073.md §4, itens 1 e 3). Idempotente.
-- Desfazer: supabase/rollbacks/20261111280000_admin_add_session_step_up.down.sql (manual, so em dev).
-- Depende de 20261111220000_admin_create_rbac (admin_session, admin_guard, admin_session_open).
-- Postura igual: RLS forcada e sem politicas; so app_system executa as funcoes novas.
-- Versao 20261111280000: posterior a 20261111270000 (de outra tarefa, ja aplicada no banco de dev).

-- 1. Marca da ultima prova do segundo fator (TOTP). O login ja exige TOTP, entao nasce igual a aal2_at.
alter table app.admin_session add column if not exists totp_at timestamptz;
update app.admin_session set totp_at = aal2_at where totp_at is null;
alter table app.admin_session alter column totp_at set not null;

comment on column app.admin_session.totp_at is
  'Ultima prova do segundo fator nesta sessao (H-073). So avanca; a janela de 30 min e lida no banco.';

-- 2. Sessao nova ja nasce com totp_at = agora (o login acabou de exigir TOTP) -----------------------
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

  insert into app.admin_session (id, user_id, secret_hash, aal2_at, totp_at, created_at, expires_at)
  values (p_session_id, p_user_id, p_secret_hash, p_now, p_now, p_now, p_now + interval '8 hours');

  perform private.audit_append('admin:' || p_user_id::text, 'admin', 'admin.session.opened',
    'admin_session', p_session_id, '{}'::jsonb, '{"status":"aberta"}'::jsonb, null, null);
  return true;
end
$$;

-- 3. Guarda devolve totp_at junto com papeis e permissoes (troca de tipo de retorno: drop e recria) --
drop function if exists private.admin_guard(text, timestamptz);

create function private.admin_guard(p_secret_hash text, p_now timestamptz)
returns table (out_user_id uuid, out_roles text[], out_permissions text[], out_totp_at timestamptz)
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
                order by rp.permission_code),
         s.totp_at
    from app.admin_session s
    join app.admin_staff st on st.user_id = s.user_id and st.status = 'ativo'
   where s.secret_hash = p_secret_hash
     and s.revoked_at is null
     and s.aal2_at is not null
     and s.expires_at > p_now
     and exists (select 1 from app.admin_user_role r
                  where r.user_id = s.user_id and r.revoked_at is null)
$$;

-- 4. Acao de auditoria da confirmacao (chaves sem dado pessoal) ---------------------------------------
insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('admin.session.step_up', 'admin_session', false,
   array['status'], 'Confirmacao recente do segundo fator na sessao admin (H-073, 60 §4)')
on conflict (action) do nothing;

-- 5. Dados da conta da sessao, para o login de confirmacao (e-mail e identificador do provedor) -------
-- So devolve linha para sessao valida (mesmas regras da guarda). O e-mail nunca vai para a auditoria.
create or replace function private.admin_session_subject(p_secret_hash text, p_now timestamptz)
returns table (out_user_id uuid, out_email text, out_auth_user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select s.user_id, u.email, u.auth_user_id
    from app.admin_session s
    join app.admin_staff st on st.user_id = s.user_id and st.status = 'ativo'
    join app.app_user u on u.id = s.user_id
   where s.secret_hash = p_secret_hash
     and s.revoked_at is null
     and s.expires_at > p_now
     and exists (select 1 from app.admin_user_role r
                  where r.user_id = s.user_id and r.revoked_at is null)
$$;

-- 6. Confirmacao: so avanca totp_at (nunca recua) e audita na MESMA transacao (60 §4 item 1 e 4) ------
-- Devolve false se a sessao nao e valida (a API responde 404, como a guarda). Se a auditoria falhar,
-- a marca nao avanca (a transacao inteira desfaz).
create or replace function private.admin_step_up(p_secret_hash text, p_now timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session app.admin_session%rowtype;
begin
  if p_secret_hash is null or p_secret_hash !~ '^[0-9a-f]{64}$' or p_now is null then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;

  select s.* into v_session
    from app.admin_session s
   where s.secret_hash = p_secret_hash
     and s.revoked_at is null
     and s.expires_at > p_now
     and exists (select 1 from app.admin_staff st where st.user_id = s.user_id and st.status = 'ativo')
     and exists (select 1 from app.admin_user_role r where r.user_id = s.user_id and r.revoked_at is null)
   for update;
  if not found then
    return false;
  end if;

  if v_session.totp_at < p_now then
    update app.admin_session set totp_at = p_now where id = v_session.id;
  end if;

  perform private.audit_append('admin:' || v_session.user_id::text, 'admin', 'admin.session.step_up',
    'admin_session', v_session.id, '{}'::jsonb, '{"status":"confirmada"}'::jsonb, null, null);
  return true;
end
$$;

-- 7. Privilegios (igual as migracoes anteriores de H-102) -------------------------------------------
revoke all on function
  private.admin_guard(text, timestamptz),
  private.admin_session_open(uuid, uuid, text, timestamptz),
  private.admin_session_subject(text, timestamptz),
  private.admin_step_up(text, timestamptz)
  from public, anon, authenticated, service_role, app_api;

grant execute on function
  private.admin_guard(text, timestamptz),
  private.admin_session_open(uuid, uuid, text, timestamptz),
  private.admin_session_subject(text, timestamptz),
  private.admin_step_up(text, timestamptz)
  to app_system;
