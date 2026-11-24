-- Entrada do admin por codigo de 6 digitos no e-mail (decisao do dono, 2026-11-24; substitui, por ora, o desenho de
-- senha + TOTP do H-102, que nunca chegou a ser construido na interface). So a equipe ativa com papel recebe codigo.
-- O banco guarda so o hash do codigo, preso ao usuario; 5 tentativas por codigo; validade de 10 minutos; pedir um
-- codigo novo invalida os anteriores. Com o codigo certo, abre a sessao admin pela funcao ja existente
-- (private.admin_session_open, 8 horas, com auditoria).

create table if not exists app.admin_login_code (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references app.app_user (id) on delete cascade,
  code_hash   text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  attempts    smallint not null default 0 check (attempts between 0 and 5),
  created_at  timestamptz not null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  constraint admin_login_code_validade check (expires_at = created_at + interval '10 minutes')
);

create index if not exists admin_login_code_usuario on app.admin_login_code (user_id, created_at desc);

alter table app.admin_login_code enable row level security;
alter table app.admin_login_code force row level security;
revoke all on app.admin_login_code from public, anon, authenticated, service_role, app_api, app_backup_reader;

-- 1. Emite o codigo para quem e da equipe ativa com papel. Devolve o id do usuario (para o envio) ou null
-- (e-mail desconhecido, fora da equipe ou sem papel: a rota responde igual, sem revelar nada).
create or replace function private.admin_code_issue(p_email text, p_code_hash text, p_now timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if p_email is null or p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' or p_now is null then
    return null;
  end if;
  select u.id into v_user
    from app.app_user u
    join app.admin_staff s on s.user_id = u.id and s.status = 'ativo'
   where lower(u.email) = lower(btrim(p_email))
     and u.status = 'ativo'
     and exists (select 1 from app.admin_user_role r where r.user_id = u.id and r.revoked_at is null)
   limit 1;
  if v_user is null then
    return null;
  end if;
  update app.admin_login_code set used_at = p_now where user_id = v_user and used_at is null;
  insert into app.admin_login_code (user_id, code_hash, created_at, expires_at)
  values (v_user, p_code_hash, p_now, p_now + interval '10 minutes');
  return v_user;
end
$$;

-- 2. Confere o codigo e, se certo, abre a sessao admin. Resultado: 'ok', 'invalido' ou 'bloqueado'.
create or replace function private.admin_code_verify(
  p_email text, p_code_hash text, p_session_id uuid, p_secret_hash text, p_now timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_codigo app.admin_login_code%rowtype;
begin
  if p_email is null or p_code_hash is null or p_session_id is null or p_secret_hash is null or p_now is null then
    return 'invalido';
  end if;
  select u.id into v_user from app.app_user u where lower(u.email) = lower(btrim(p_email)) and u.status = 'ativo' limit 1;
  if v_user is null then
    return 'invalido';
  end if;
  select * into v_codigo
    from app.admin_login_code c
   where c.user_id = v_user and c.used_at is null and c.expires_at > p_now
   order by c.created_at desc
   limit 1
   for update;
  if not found then
    return 'invalido';
  end if;
  if v_codigo.attempts >= 5 then
    return 'bloqueado';
  end if;
  if v_codigo.code_hash <> p_code_hash then
    update app.admin_login_code set attempts = attempts + 1 where id = v_codigo.id;
    return case when v_codigo.attempts + 1 >= 5 then 'bloqueado' else 'invalido' end;
  end if;
  update app.admin_login_code set used_at = p_now where id = v_codigo.id;
  if not private.admin_session_open(p_session_id, v_user, p_secret_hash, p_now) then
    return 'invalido';
  end if;
  return 'ok';
end
$$;

revoke all on function
  private.admin_code_issue(text, text, timestamptz),
  private.admin_code_verify(text, text, uuid, text, timestamptz)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
grant execute on function private.admin_code_issue(text, text, timestamptz) to app_system;
grant execute on function private.admin_code_verify(text, text, uuid, text, timestamptz) to app_system;
grant execute on function private.admin_session_revoke(text, timestamptz) to app_system;
