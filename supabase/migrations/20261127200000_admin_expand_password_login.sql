-- Entrada do admin por e-mail e senha (decisao do dono, 2026-11-27; substitui o codigo de 6 digitos no e-mail de
-- 20261124100000). Sem autocadastro: um admin so nasce pela tela de Equipe (private.admin_staff_create, permissao
-- admin.role.manage) ou direto no banco pelo script local packages/db/scripts/admin-dev.mjs.
-- O banco guarda so o hash scrypt (calculado na API ou no script); a senha em claro nunca chega ao banco.
-- Desfazer: supabase/rollbacks/20261127200000_admin_expand_password_login.down.sql (manual, so em dev).

-- 1. Credencial da conta admin ------------------------------------------------------------------------
create table if not exists app.admin_credential (
  user_id       uuid primary key references app.admin_staff (user_id) on delete cascade,
  password_hash text not null
                check (password_hash ~ '^scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$[A-Za-z0-9_-]{22,}\$[A-Za-z0-9_-]{43,}$'),
  updated_at    timestamptz not null
);

comment on table app.admin_credential is
  'Hash scrypt da senha do admin. Nunca a senha em claro. A API le so por private.admin_password_lookup.';

alter table app.admin_credential enable row level security;
alter table app.admin_credential force row level security;
revoke all on app.admin_credential from public, anon, authenticated, service_role, app_api, app_system, app_backup_reader;

-- Sem segundo fator na entrada: a conta ativa nao depende mais de mfa_enrolled_at.
alter table app.admin_staff drop constraint if exists admin_staff_ativo_com_mfa;

-- 2. Hash para a conferencia: so conta ativa, na equipe ativa e com papel. Sem linha = entrada recusada.
create or replace function private.admin_password_lookup(p_email text)
returns table (out_user_id uuid, out_password_hash text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, c.password_hash
    from app.app_user u
    join app.admin_staff s on s.user_id = u.id and s.status = 'ativo'
    join app.admin_credential c on c.user_id = u.id
   where lower(u.email) = lower(btrim(p_email))
     and u.status = 'ativo'
     and exists (select 1 from app.admin_user_role r where r.user_id = u.id and r.revoked_at is null)
   limit 1
$$;

-- 3. Limite de tentativas (H-015: janela de 15 min, balde de 1 min). A vaga e reservada ANTES de conferir a senha,
-- sob trava, para que pedidos simultaneos nao passem do teto; o acerto devolve a vaga. Chaves ja chegam em HMAC.
create or replace function private.admin_login_reserve(
  p_email_key text, p_ip_key text, p_email_limit integer, p_ip_limit integer, p_now timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('fastpro:admin_login:' || p_ip_key, 0));
  perform pg_advisory_xact_lock(hashtextextended('fastpro:admin_login:' || p_email_key, 0));
  if not (select c.out_ok from private.rl_check(p_email_key, 900, 60, p_email_limit, p_now) c)
     or not (select c.out_ok from private.rl_check(p_ip_key, 900, 60, p_ip_limit, p_now) c) then
    return false;
  end if;
  perform private.rl_hit(p_email_key, 60, p_now);
  perform private.rl_hit(p_ip_key, 60, p_now);
  return true;
end
$$;

create or replace function private.admin_login_release(p_email_key text, p_ip_key text, p_now timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  update ops.rate_counter
     set count = count - 1
   where key_hmac in (p_email_key, p_ip_key)
     and window_start = to_timestamp((floor(extract(epoch from p_now) / 60) * 60)::double precision)
     and count > 0
$$;

-- 4. Cadastro de admin pela tela de Equipe. Conta propria (nunca reaproveita conta de cliente ou profissional,
-- H-017). Superadmin fica fora: continua exigindo dupla aprovacao ou o script local. Devolve 'ok',
-- 'permissao_negada', 'papel_invalido' ou 'email_indisponivel'. Auditoria na mesma transacao.
insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('admin.account.created', 'admin_staff', false,
   array['status'], 'Conta administrativa cadastrada por outro admin, com senha')
on conflict (action) do nothing;

create or replace function private.admin_staff_create(
  p_actor uuid, p_email text, p_password_hash text, p_roles text[], p_now timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_user  uuid := gen_random_uuid();
  v_role  text;
begin
  if p_actor is null or p_email is null or p_password_hash is null or p_now is null then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  if not private.admin_has_permission(p_actor, 'admin.role.manage') then
    return 'permissao_negada';
  end if;
  if coalesce(cardinality(p_roles), 0) = 0
     or 'superadmin' = any (p_roles)
     or cardinality(p_roles) <> (select count(*) from app.admin_role r where r.code = any (p_roles)) then
    return 'papel_invalido';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('fastpro:admin_create:' || v_email, 0));
  if exists (select 1 from app.app_user u where lower(u.email) = v_email) then
    return 'email_indisponivel';
  end if;

  insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
  values (v_user, v_email, gen_random_uuid(), 'ativo', p_now, p_now);
  insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at, created_at, status_changed_at)
  values (v_user, 'ativo', 'convite', p_actor, null, p_now, p_now);
  insert into app.admin_credential (user_id, password_hash, updated_at)
  values (v_user, p_password_hash, p_now);

  perform private.audit_append('admin:' || p_actor::text, 'superadmin', 'admin.account.created',
    'admin_staff', v_user, '{}'::jsonb, '{"status":"ativo"}'::jsonb, null, null);
  foreach v_role in array p_roles loop
    insert into app.admin_user_role (id, user_id, role_code, granted_by, grant_origin, granted_at)
    values (gen_random_uuid(), v_user, v_role, p_actor, 'concessao', p_now);
    perform private.audit_append('admin:' || p_actor::text, 'superadmin', 'admin.role.granted',
      'admin_staff', v_user, '{"status":"inativo"}'::jsonb,
      jsonb_build_object('status', 'ativo', 'role_code', v_role), null, null);
  end loop;
  return 'ok';
end
$$;

revoke all on function
  private.admin_password_lookup(text),
  private.admin_login_reserve(text, text, integer, integer, timestamptz),
  private.admin_login_release(text, text, timestamptz),
  private.admin_staff_create(uuid, text, text, text[], timestamptz)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
grant execute on function private.admin_password_lookup(text) to app_system;
grant execute on function private.admin_login_reserve(text, text, integer, integer, timestamptz) to app_system;
grant execute on function private.admin_login_release(text, text, timestamptz) to app_system;
grant execute on function private.admin_staff_create(uuid, text, text, text[], timestamptz) to app_system;

-- 5. Fim da entrada por codigo no e-mail ---------------------------------------------------------------
drop function if exists private.admin_code_issue(text, text, timestamptz);
drop function if exists private.admin_code_verify(text, text, uuid, text, timestamptz);
drop table if exists app.admin_login_code;
