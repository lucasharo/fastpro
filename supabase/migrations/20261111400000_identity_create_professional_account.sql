-- H-016 | Cadastro, verificacao e login por senha do profissional (docs/factory/33-DESENHO-H016.md §2.2,
-- §2.3, §2.6, §3, §4, §5; docs/factory/67-DESENHO-H016.md §6, itens A e C). Idempotente.
-- Desfazer: supabase/rollbacks/20261111400000_identity_create_professional_account.down.sql.
-- Mesma postura de RLS e grants de 140000 a 180000: RLS habilitada e forcada, sem politicas, nenhum
-- privilegio para PUBLIC/anon/authenticated/service_role; so app_system executa as funcoes.
-- Sem senha no banco: a credencial fica no Supabase Auth (DD-2 e DD-3). Sem e-mail em claro em nenhum
-- campo novo: so HMAC do e-mail (email_hash e chave do contador) e hash SHA-256 dos segredos.
-- Tempo: relogio informado por p_now (o chamador passa o instante; testes usam valor fixo).

-- 1. Perfil do profissional (09 §3.3; so o minimo de H-016) ----------------------------------------------
-- verification_status nasce 'pendente' (CA-H016-01, CA-H016-21). So a funcao de decisao de H-039 o muda;
-- app_api nao recebe UPDATE nesta coluna (impede autoaprovacao).
create table if not exists app.professional_profile (
  user_id            uuid primary key references app.app_user (id),
  verification_status text not null default 'pendente'
                       check (verification_status in
                         ('pendente', 'em_revisao', 'aprovada', 'retida_duplicidade', 'recusada', 'suspensa')),
  verified_at        timestamptz,
  suspended_at       timestamptz,
  suspension_reason  text,
  created_at         timestamptz not null,
  updated_at         timestamptz not null,
  constraint professional_profile_suspensao_consistente
    check ((suspended_at is null) = (suspension_reason is null))
);

comment on table app.professional_profile is
  'Perfil do profissional (H-016, 09 §3.3). Sem e-mail, senha ou nome do Auth. Status so muda por H-039.';

alter table app.professional_profile enable row level security;
alter table app.professional_profile force row level security;
revoke all on app.professional_profile from public, anon, authenticated, service_role;
grant select, insert, update, delete on app.professional_profile to app_system;

-- 2. auth_challenge aceita os tres propositos novos (67 §6, item A) -------------------------------------
-- Nome do CHECK de purpose de 140000 (padrao do Postgres: <tabela>_<coluna>_check).
alter table app.auth_challenge add column if not exists user_id uuid references app.app_user (id);
alter table app.auth_challenge alter column code_hmac drop not null;
alter table app.auth_challenge drop constraint if exists auth_challenge_purpose_check;
alter table app.auth_challenge add constraint auth_challenge_purpose_check
  check (purpose in ('login', 'publish', 'professional_verify', 'password_reset', 'professional_activate'));
-- Codigo de 6 digitos so para login e publicacao; propositos novos nao tem codigo.
alter table app.auth_challenge drop constraint if exists auth_challenge_codigo_por_proposito;
alter table app.auth_challenge add constraint auth_challenge_codigo_por_proposito
  check ((purpose in ('login', 'publish')) = (code_hmac is not null));
-- Propositos novos sempre dizem a quem pertencem.
alter table app.auth_challenge drop constraint if exists auth_challenge_usuario_por_proposito;
alter table app.auth_challenge add constraint auth_challenge_usuario_por_proposito
  check (purpose in ('login', 'publish') or user_id is not null);

-- 3. Espera do login (33 §2.6): zero ate a 4a falha; 30 s na 5a, dobrando, teto de 900 s ---------------
create or replace function private.professional_login_wait(p_proximo integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when p_proximo <= 4 then 0 else least(900, 30 * power(2, p_proximo - 5))::integer end
$$;

-- 4. Cadastro (33 §3.1): conta, perfil pendente e link de 15 min. Uma transacao. ----------------------
-- O Auth ja criou o usuario (ordem Auth -> banco, 33 §3.2). resultado: criado | existente.
-- 'existente' nao muda nada: o adaptador desfaz o usuario do Auth que acabou de criar.
create or replace function private.professional_register_create(
  p_user_id uuid,
  p_auth_user_id uuid,
  p_email text,
  p_email_hash text,
  p_challenge_id uuid,
  p_token_hash text,
  p_now timestamptz)
returns table (out_resultado text)
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if p_user_id is null or p_auth_user_id is null or p_email is null or p_email_hash is null
     or p_challenge_id is null or p_token_hash is null or p_now is null then
    raise exception 'professional_entrada_invalida' using errcode = '22023';
  end if;

  insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
  values (p_user_id, p_email, p_auth_user_id, 'ativo', null, p_now)
  on conflict (email) do nothing
  returning id into v_user;
  if v_user is null then
    return query select 'existente'::text;
    return;
  end if;

  insert into app.professional_profile (user_id, verification_status, created_at, updated_at)
  values (p_user_id, 'pendente', p_now, p_now);

  -- Um link vivo por (e-mail, proposito): o novo substitui o anterior (33 §2.3).
  update app.auth_challenge c
     set invalidated_at = p_now,
         invalid_reason = 'substituido'
   where c.email_hash = p_email_hash
     and c.purpose = 'professional_verify'
     and c.consumed_at is null
     and c.invalidated_at is null;

  insert into app.auth_challenge (id, email_hash, purpose, token_hash, code_hmac, user_id,
                                  expires_at, created_at, attempts)
  values (p_challenge_id, p_email_hash, 'professional_verify', p_token_hash, null, p_user_id,
          p_now + interval '15 minutes', p_now, 0);

  return query select 'criado'::text;
end;
$$;

-- 5. Consumo do link de verificacao (33 §4): uso unico e atomico; marca o e-mail como verificado. -------
-- Devolve o usuario quando consumiu; vazio para link inexistente, usado, substituido ou vencido.
create or replace function private.professional_verify_confirm(p_token_hash text, p_now timestamptz)
returns table (out_user_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if p_token_hash is null or p_now is null then
    raise exception 'professional_entrada_invalida' using errcode = '22023';
  end if;

  update app.auth_challenge c
     set consumed_at = p_now
   where c.token_hash = p_token_hash
     and c.purpose = 'professional_verify'
     and c.consumed_at is null
     and c.invalidated_at is null
     and c.expires_at > p_now
  returning c.user_id into v_user;
  if v_user is null then
    return;
  end if;

  update app.app_user u
     set email_verified_at = coalesce(u.email_verified_at, p_now)
   where u.id = v_user;

  return query select v_user;
end;
$$;

-- 6. Bloqueio progressivo do login (33 §5.1 passo 3; 67 §6, item C) ------------------------------------
-- Contador em ops.code_lock: strikes = falhas contadas; locked_until = fim da espera; last_error_at =
-- ultima falha (zera apos 24 h). Espelha gateProfessionalLogin de @fastpro/domain (professional-auth.ts).
-- A chave e o HMAC do e-mail normalizado com um prefixo de finalidade (feito pelo adaptador).
create or replace function private.professional_login_gate(p_key text, p_now timestamptz)
returns table (out_bloqueada boolean, out_retry_after integer)
language plpgsql
set search_path = ''
as $$
declare
  v_lock ops.code_lock%rowtype;
  v_found boolean;
  v_base integer;
  v_proximo integer;
  v_espera integer;
begin
  if p_key is null or p_now is null or p_key !~ '^[0-9a-f]{64}$' then
    raise exception 'professional_entrada_invalida' using errcode = '22023';
  end if;

  select * into v_lock from ops.code_lock l where l.key_hmac = p_key for update;
  v_found := found;

  if v_found and v_lock.locked_until is not null and v_lock.locked_until > p_now then
    return query select true,
      greatest(1, ceil(extract(epoch from (v_lock.locked_until - p_now)))::integer);
    return;
  end if;

  if v_found and v_lock.last_error_at is not null
     and p_now - v_lock.last_error_at > interval '24 hours' then
    v_base := 0;
  elsif v_found then
    v_base := v_lock.strikes::integer;
  else
    v_base := 0;
  end if;
  v_proximo := v_base + 1;

  if v_proximo <= 4 then
    insert into ops.code_lock as k (key_hmac, strikes, locked_until, last_error_at, updated_at)
    values (p_key, v_proximo::smallint, null, p_now, p_now)
    on conflict (key_hmac) do update
       set strikes = excluded.strikes,
           locked_until = null,
           last_error_at = excluded.last_error_at,
           updated_at = excluded.updated_at;
    return query select false, 0;
    return;
  end if;

  v_espera := private.professional_login_wait(v_proximo);

  if v_lock.locked_until is null then
    -- Primeira barrada: a tentativa nao conta; a espera comeca agora.
    update ops.code_lock
       set locked_until = p_now + make_interval(secs => v_espera),
           updated_at = p_now
     where key_hmac = p_key;
    return query select true, v_espera;
    return;
  end if;

  -- Espera cumprida: esta tentativa passa e conta; a espera seguinte dobra.
  update ops.code_lock
     set strikes = v_proximo::smallint,
         locked_until = p_now + make_interval(secs => v_espera),
         last_error_at = p_now,
         updated_at = p_now
   where key_hmac = p_key;
  return query select false, 0;
end;
$$;

-- Login correto zera o contador (33 §5.1 passo 5).
create or replace function private.professional_login_success(p_key text)
returns void
language sql
set search_path = ''
as $$
  delete from ops.code_lock where key_hmac = p_key
$$;

-- 7. Conta pelo e-mail normalizado (33 §5.1 passo 5): ativa so se for profissional e ativo. -------------
create or replace function private.professional_account_by_email(p_email text)
returns table (out_user_id uuid, out_auth_user_id uuid, out_active boolean, out_verified boolean)
language sql
stable
set search_path = ''
as $$
  select u.id,
         u.auth_user_id,
         (u.status = 'ativo' and p.user_id is not null),
         (u.email_verified_at is not null)
    from app.app_user u
    left join app.professional_profile p on p.user_id = u.id
   where u.email = p_email
$$;

-- 8. Sessao de 7 dias por senha (33 §5.1 passo 5; 52 §1.2): nasce ativa, com prova recente agora. -------
create or replace function private.professional_session_open(
  p_session_id uuid,
  p_user_id uuid,
  p_secret_hash text,
  p_now timestamptz)
returns table (out_session_id uuid, out_absolute_expires_at timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  v_fim timestamptz := p_now + interval '7 days';
begin
  if p_session_id is null or p_user_id is null or p_secret_hash is null or p_now is null then
    raise exception 'professional_entrada_invalida' using errcode = '22023';
  end if;

  insert into app.app_session (id, user_id, stage, secret_hash, challenge_id, purpose, draft_id,
                               created_at, expires_at, absolute_expires_at, recent_auth_at, auth_method)
  values (p_session_id, p_user_id, 'ativa', p_secret_hash, null, 'password', null,
          p_now, v_fim, v_fim, p_now, 'password');

  return query select p_session_id, v_fim;
end;
$$;

-- 9. Grants: so app_system executa as funcoes novas (padrao de 170000) ---------------------------------
revoke all on function
  private.professional_login_wait(integer),
  private.professional_register_create(uuid, uuid, text, text, uuid, text, timestamptz),
  private.professional_verify_confirm(text, timestamptz),
  private.professional_login_gate(text, timestamptz),
  private.professional_login_success(text),
  private.professional_account_by_email(text),
  private.professional_session_open(uuid, uuid, text, timestamptz)
from public, anon, authenticated, service_role;

grant execute on function
  private.professional_login_wait(integer),
  private.professional_register_create(uuid, uuid, text, text, uuid, text, timestamptz),
  private.professional_verify_confirm(text, timestamptz),
  private.professional_login_gate(text, timestamptz),
  private.professional_login_success(text),
  private.professional_account_by_email(text),
  private.professional_session_open(uuid, uuid, text, timestamptz)
to app_system;
