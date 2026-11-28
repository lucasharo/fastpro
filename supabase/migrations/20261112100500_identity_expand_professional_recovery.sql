-- H-016 | Elegibilidade, reenvio do link, recuperacao de senha, ativacao de cliente que vira profissional,
-- /me e troca de senha do profissional (docs/factory/33-DESENHO-H016.md §4, §5.2, §6, §8; 67-DESENHO-H016.md
-- §6 e §8; CA-H016-05, 09, 15 a 17, 20 a 23). Idempotente (create or replace).
-- Desfazer: supabase/rollbacks/20261112100500_identity_expand_professional_recovery.down.sql.
-- Nenhuma tabela nova e nenhuma linha alterada. Mesma postura de 400000: nenhum privilegio para PUBLIC,
-- anon, authenticated ou service_role; so app_system executa as funcoes. Tempo: p_now informado pelo chamador.
-- Desafios de recuperacao e de ativacao vivem 15 min (mesmo prazo do link de verificacao, [PROPOSTA]).

-- 1. Elegibilidade (CA-H016-05, CA-H016-22). Guarda unica para os triggers de H-031 e H-058 --------------------
create or replace function private.is_email_verified(p_user_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from app.app_user u where u.id = p_user_id and u.email_verified_at is not null)
$$;

-- Pode publicar e aceitar: conta ativa, e-mail verificado e verificacao 'aprovada' (33 §8). Nao depende de
-- sessao: a checagem vale para chamada direta de API, porque roda no banco.
create or replace function private.professional_eligible(p_user_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from app.app_user u
      join app.professional_profile p on p.user_id = u.id
     where u.id = p_user_id
       and u.status = 'ativo'
       and u.email_verified_at is not null
       and p.verification_status = 'aprovada')
$$;

-- 2. Estado do profissional para GET /v1/professional/me (CA-H016-10, CA-H016-21). Nulo sem perfil. ---------
create or replace function private.professional_me(p_user_id uuid)
returns table (out_auth_user_id uuid, out_email text, out_email_verified boolean, out_status text, out_active boolean)
language sql
stable
set search_path = ''
as $$
  select u.auth_user_id,
         u.email,
         u.email_verified_at is not null,
         p.verification_status,
         u.status = 'ativo'
    from app.app_user u
    join app.professional_profile p on p.user_id = u.id
   where u.id = p_user_id
$$;

-- 3. Desafio de e-mail: reenvio do link de verificacao e pedido de recuperacao ou de ativacao ------------------
-- Um link vivo por (e-mail, proposito): o novo substitui o anterior (33 §2.3). Vazio quando nao se aplica
-- (conta inexistente, inativa, ja verificada, sem perfil, etc.): o chamador responde igual nos dois casos.
--   professional_verify   : perfil profissional e e-mail ainda nao verificado (reenvio, CA-H016-09).
--   password_reset        : perfil profissional, verificado ou nao (recuperacao, CA-H016-15).
--   professional_activate : cliente verificado, sem perfil (cliente que vira profissional, 33 §3.1).
create or replace function private.professional_challenge_create(
  p_email text,
  p_email_hash text,
  p_purpose text,
  p_challenge_id uuid,
  p_token_hash text,
  p_now timestamptz)
returns table (out_user_id uuid, out_auth_user_id uuid, out_email text)
language plpgsql
set search_path = ''
as $$
declare
  v_user app.app_user%rowtype;
  v_profissional boolean;
begin
  if p_email is null or p_email_hash is null or p_challenge_id is null or p_token_hash is null or p_now is null
     or p_purpose is null
     or p_purpose not in ('professional_verify', 'password_reset', 'professional_activate') then
    raise exception 'professional_entrada_invalida' using errcode = '22023';
  end if;

  select * into v_user from app.app_user u where u.email = p_email;
  if not found or v_user.status <> 'ativo' then
    return;
  end if;
  v_profissional := exists (select 1 from app.professional_profile p where p.user_id = v_user.id);

  if p_purpose = 'professional_verify' and (not v_profissional or v_user.email_verified_at is not null) then
    return;
  end if;
  if p_purpose = 'password_reset' and not v_profissional then
    return;
  end if;
  if p_purpose = 'professional_activate' and (v_profissional or v_user.email_verified_at is null) then
    return;
  end if;

  update app.auth_challenge c
     set invalidated_at = p_now,
         invalid_reason = 'substituido'
   where c.email_hash = p_email_hash
     and c.purpose = p_purpose
     and c.consumed_at is null
     and c.invalidated_at is null;

  insert into app.auth_challenge (id, email_hash, purpose, token_hash, code_hmac, user_id,
                                  expires_at, created_at, attempts)
  values (p_challenge_id, p_email_hash, p_purpose, p_token_hash, null, v_user.id,
          p_now + interval '15 minutes', p_now, 0);

  return query select v_user.id, v_user.auth_user_id, v_user.email;
end;
$$;

-- 4. Leitura do link de recuperacao ou de ativacao, sem consumir (GET e checagem antes do Auth) ---------------
create or replace function private.password_reset_peek(p_token_hash text, p_now timestamptz)
returns table (out_user_id uuid, out_auth_user_id uuid, out_email text, out_purpose text)
language sql
stable
set search_path = ''
as $$
  select c.user_id, u.auth_user_id, u.email, c.purpose
    from app.auth_challenge c
    join app.app_user u on u.id = c.user_id
   where c.token_hash = p_token_hash
     and c.purpose in ('password_reset', 'professional_activate')
     and c.consumed_at is null
     and c.invalidated_at is null
     and c.expires_at > p_now
     and u.status = 'ativo'
$$;

-- 5. Consumo do link (uso unico e atomico). Marca o e-mail como verificado se estava nulo; na ativacao cria o
-- perfil pendente; revoga todas as sessoes (D-H016-6). Vazio para link inexistente, usado, vencido ou substituido.
create or replace function private.password_reset_consume(p_token_hash text, p_now timestamptz)
returns table (out_user_id uuid, out_email text, out_purpose text)
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid;
  v_purpose text;
begin
  if p_token_hash is null or p_now is null then
    raise exception 'professional_entrada_invalida' using errcode = '22023';
  end if;

  update app.auth_challenge c
     set consumed_at = p_now
   where c.token_hash = p_token_hash
     and c.purpose in ('password_reset', 'professional_activate')
     and c.consumed_at is null
     and c.invalidated_at is null
     and c.expires_at > p_now
  returning c.user_id, c.purpose into v_user, v_purpose;
  if v_user is null then
    return;
  end if;

  update app.app_user u
     set email_verified_at = coalesce(u.email_verified_at, p_now)
   where u.id = v_user;

  if v_purpose = 'professional_activate' then
    insert into app.professional_profile (user_id, verification_status, created_at, updated_at)
    values (v_user, 'pendente', p_now, p_now)
    on conflict (user_id) do nothing;
  end if;

  update app.app_session s
     set revoked_at = p_now
   where s.user_id = v_user
     and s.revoked_at is null;

  return query select u.id, u.email, v_purpose from app.app_user u where u.id = v_user;
end;
$$;

-- 6. Troca de senha logado (CA-H016-20): revoga as outras sessoes e mantem a atual -------------------------
create or replace function private.professional_sessions_revoke_others(
  p_user_id uuid,
  p_keep_session_id uuid,
  p_now timestamptz)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_linhas integer;
begin
  if p_user_id is null or p_keep_session_id is null or p_now is null then
    raise exception 'professional_entrada_invalida' using errcode = '22023';
  end if;
  update app.app_session s
     set revoked_at = p_now
   where s.user_id = p_user_id
     and s.id <> p_keep_session_id
     and s.revoked_at is null;
  get diagnostics v_linhas = row_count;
  return v_linhas;
end;
$$;

-- 7. Grants: so app_system executa as funcoes novas (padrao de 400000) -----------------------------------------
revoke all on function
  private.is_email_verified(uuid),
  private.professional_eligible(uuid),
  private.professional_me(uuid),
  private.professional_challenge_create(text, text, text, uuid, text, timestamptz),
  private.password_reset_peek(text, timestamptz),
  private.password_reset_consume(text, timestamptz),
  private.professional_sessions_revoke_others(uuid, uuid, timestamptz)
from public, anon, authenticated, service_role;

grant execute on function
  private.is_email_verified(uuid),
  private.professional_eligible(uuid),
  private.professional_me(uuid),
  private.professional_challenge_create(text, text, text, uuid, text, timestamptz),
  private.password_reset_peek(text, timestamptz),
  private.password_reset_consume(text, timestamptz),
  private.professional_sessions_revoke_others(uuid, uuid, timestamptz)
to app_system;
