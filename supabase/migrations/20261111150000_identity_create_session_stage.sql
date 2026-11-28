-- H-012 | Usuario do cliente e etapa de identificacao (docs/factory/46-DESENHO-H012.md, secoes 3 e 4).
-- Idempotente. Desfazer: supabase/rollbacks/20261111150000_identity_create_session_stage.down.sql.
-- Postura igual a H-011: RLS habilitada e forcada, sem politicas, nenhum privilegio para
-- PUBLIC/anon/authenticated/service_role. So app_system recebe privilegios minimos.
-- O banco guarda so o hash (SHA-256) do segredo do cookie; o valor nunca e gravado.
-- H-012 grava somente stage='identificacao'. A conversao para 'ativa' e da H-014.
-- Nenhuma rota de recurso aceita a etapa de identificacao (regra da API, 46 §3).

-- 1. app.app_user (cliente; H-016 estende com profissional) -----------------------------------------
create table if not exists app.app_user (
  id                 uuid primary key,
  email              text not null unique
                       check (email = lower(email) and char_length(email) between 3 and 254),
  auth_user_id       uuid not null unique,
  status             text not null default 'ativo' check (status in ('ativo', 'bloqueado')),
  email_verified_at  timestamptz,
  created_at         timestamptz not null
);

comment on table app.app_user is
  'Usuario (H-012/H-016). Sem senha. email_verified_at nunca e alterado para usuario existente.';

-- 2. app.app_session (46 §3; H-014 estende a conversao para a sessao de 7 dias) -----------------------
create table if not exists app.app_session (
  id                  uuid primary key,
  user_id             uuid not null references app.app_user (id),
  stage               text not null check (stage in ('identificacao', 'ativa')),
  secret_hash         text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  challenge_id        uuid not null unique,
  purpose             text not null check (purpose in ('login', 'publish')),
  draft_id            uuid,
  created_at          timestamptz not null,
  expires_at          timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at          timestamptz,
  constraint app_session_identificacao_15min
    check (stage <> 'identificacao' or expires_at = created_at + interval '15 minutes'),
  constraint app_session_teto_absoluto check (absolute_expires_at >= expires_at)
);

create index if not exists app_session_user_idx on app.app_session (user_id);
create index if not exists app_session_expires_idx on app.app_session (expires_at);

comment on table app.app_session is
  'Sessao do cliente (H-012 abre a etapa de identificacao; H-014 converte). Guarda so o hash do segredo.';

-- 3. Usuario por e-mail (busca) ---------------------------------------------------------------------
create or replace function private.app_user_find(p_email text)
returns table (out_user_id uuid, out_status text)
language sql
stable
set search_path = ''
as $$
  select u.id, u.status from app.app_user u where u.email = p_email
$$;

-- 4. Criacao idempotente do usuario (46 §4, passo 2). Mesmo e-mail ou mesmo usuario do Auth: a
-- linha existente volta, sem alterar email_verified_at (R-3). out_criado indica insercao nova.
create or replace function private.app_user_ensure(
  p_email text, p_auth_user_id uuid, p_now timestamptz)
returns table (out_user_id uuid, out_status text, out_criado boolean)
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
  values (gen_random_uuid(), p_email, p_auth_user_id, 'ativo', p_now, p_now)
  on conflict do nothing
  returning id into v_id;

  if v_id is not null then
    return query select v_id, 'ativo'::text, true;
    return;
  end if;

  return query
    select u.id, u.status, false
      from app.app_user u
     where u.email = p_email;
end
$$;

-- 5. Abertura da etapa de identificacao (46 §3). Um desafio gera no maximo uma etapa (challenge_id
-- unico). Devolve o id da etapa, ou nulo se o desafio ja tinha etapa.
create or replace function private.app_session_open_stage(
  p_session_id uuid, p_user_id uuid, p_challenge_id uuid, p_purpose text, p_draft_id uuid,
  p_secret_hash text, p_now timestamptz)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into app.app_session (
    id, user_id, stage, secret_hash, challenge_id, purpose, draft_id,
    created_at, expires_at, absolute_expires_at)
  values (
    p_session_id, p_user_id, 'identificacao', p_secret_hash, p_challenge_id, p_purpose, p_draft_id,
    p_now, p_now + interval '15 minutes', p_now + interval '7 days')
  on conflict (challenge_id) do nothing
  returning id into v_id;
  return v_id;
end
$$;

-- 6. Expurgo das etapas de identificacao vencidas (46 §3). Devolve quantas linhas saíram.
create or replace function private.app_session_purge(p_now timestamptz)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_removidos integer;
begin
  delete from app.app_session s
   where s.stage = 'identificacao' and s.expires_at <= p_now;
  get diagnostics v_removidos = row_count;
  return v_removidos;
end
$$;

-- 7. Postura de acesso (igual H-011) -----------------------------------------------------------------
alter table app.app_user enable row level security;
alter table app.app_user force row level security;
alter table app.app_session enable row level security;
alter table app.app_session force row level security;

revoke all on app.app_user, app.app_session from public, anon, authenticated, service_role;
grant usage on schema app to app_system;
grant select, insert, update, delete on app.app_user, app.app_session to app_system;

revoke all on function
  private.app_user_find(text),
  private.app_user_ensure(text, uuid, timestamptz),
  private.app_session_open_stage(uuid, uuid, uuid, text, uuid, text, timestamptz),
  private.app_session_purge(timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function
  private.app_user_find(text),
  private.app_user_ensure(text, uuid, timestamptz),
  private.app_session_open_stage(uuid, uuid, uuid, text, uuid, text, timestamptz),
  private.app_session_purge(timestamptz)
  to app_system;
