-- H-013 (Issue #26) | Codigo de 6 digitos, nonce do navegador e anexacao do rascunho (docs/factory/91-DESENHO-H013.md, §2).
-- Expansao pura: colunas anulaveis e funcoes novas. As funcoes antigas (consume_link, auth_code_attempt,
-- draft_*) nao mudam nem saem. Idempotente. Desfazer: supabase/rollbacks/20261112130000_draft_expand_identity_attach.down.sql.
-- Ordem de implantacao: esta migracao -> codigo. Sem coordenada, sem indice novo.
-- Posse do rascunho: so o cookie __Host-fp_draft (SHA-256 em browser_nonce_hash). Nenhum id vindo do cliente decide.

-- 1. Colunas de identificacao do rascunho. Anulaveis e sem padrao: a tabela nao e reescrita.
alter table app.request_draft
  add column if not exists first_name        text,
  add column if not exists email             text,
  add column if not exists email_hmac        text,
  add column if not exists email_verified_at timestamptz;

-- 2. Restricoes (drop + add, para repetir sem erro).
alter table app.request_draft drop constraint if exists request_draft_first_name_tamanho;
alter table app.request_draft add constraint request_draft_first_name_tamanho
  check (first_name is null or char_length(first_name) between 2 and 60);

alter table app.request_draft drop constraint if exists request_draft_email_normalizado;
alter table app.request_draft add constraint request_draft_email_normalizado
  check (email is null or (char_length(email) between 3 and 254 and email = lower(btrim(email))));

alter table app.request_draft drop constraint if exists request_draft_email_hmac_formato;
alter table app.request_draft add constraint request_draft_email_hmac_formato
  check (email_hmac is null or email_hmac ~ '^[0-9a-f]{64}$');

alter table app.request_draft drop constraint if exists request_draft_email_par;
alter table app.request_draft add constraint request_draft_email_par
  check (num_nulls(email, email_hmac) in (0, 2));

alter table app.request_draft drop constraint if exists request_draft_verificado_com_email;
alter table app.request_draft add constraint request_draft_verificado_com_email
  check (email_verified_at is null or email is not null);

-- 3. Vinculo do nonce ao desafio no momento do pedido (CA-06, CA-09). So grava se o nonce esta nulo e o
--    desafio esta vivo. Rascunho vivo do mesmo navegador com o mesmo e-mail e ainda nao confirmado vai a
--    aguardando_email. O segredo em claro nunca chega ao banco: so o SHA-256 do cookie.
create or replace function private.draft_bind_challenge(
  p_challenge_id uuid,
  p_cookie_hash text,
  p_now timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email_hash text;
begin
  if p_challenge_id is null or p_cookie_hash is null or p_now is null then
    raise exception 'draft_entrada_invalida' using errcode = '22023';
  end if;

  update app.auth_challenge c
     set browser_nonce_hash = p_cookie_hash
   where c.id = p_challenge_id
     and c.browser_nonce_hash is null
     and c.consumed_at is null
     and c.invalidated_at is null
     and c.expires_at > p_now
  returning c.email_hash into v_email_hash;
  if not found then
    return false;
  end if;

  update app.request_draft r
     set status = 'aguardando_email', updated_at = p_now
   where r.browser_nonce_hash = p_cookie_hash
     and r.status = 'aberto'
     and r.expires_at > p_now
     and r.email_hmac = v_email_hash
     and r.email_verified_at is null;

  return true;
end
$$;

-- 4. Anexacao do rascunho ao desafio consumido (CA-07, CA-08, CA-09). Chamada somente de dentro dos dois
--    embrulhos transacionais (§2.4), na mesma transacao do consumo. Uma linha muda ou nenhuma; sem erro.
--    Ordem de travas fixa: desafio (ja travado pelo consumo) -> rascunho.
create or replace function private.draft_attach_challenge(
  p_challenge_id uuid,
  p_cookie_hash text,
  p_now timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email_hash text;
  v_draft_id uuid;
begin
  if p_challenge_id is null or p_cookie_hash is null or p_now is null then
    return false;
  end if;

  -- Desafio consumido e do mesmo navegador do pedido (nonce gravado em draft_bind_challenge).
  select c.email_hash into v_email_hash
    from app.auth_challenge c
   where c.id = p_challenge_id
     and c.consumed_at is not null
     and c.browser_nonce_hash = p_cookie_hash
   for update;
  if not found then
    return false;
  end if;

  -- Rascunho vivo do mesmo navegador, travado. Posse pelo cookie, nunca por id vindo do corpo.
  select r.id into v_draft_id
    from app.request_draft r
   where r.browser_nonce_hash = p_cookie_hash
     and r.status in ('aberto', 'aguardando_email')
     and r.expires_at > p_now
   for update;
  if not found then
    return false;
  end if;

  update app.request_draft r
     set email_verified_at = p_now, status = 'aberto', updated_at = p_now
   where r.id = v_draft_id
     and r.email_hmac = v_email_hash;

  return found;
end
$$;

-- 5. Embrulhos transacionais (§2.4). Chamam a funcao antiga e, so no ramo 'ok', a anexacao. Uma funcao, uma
--    transacao: erro na anexacao desfaz o consumo (o codigo ou o link continuam valendo; resposta 503).
create or replace function private.auth_code_attempt_attach(
  p_challenge_id uuid,
  p_email_hash text,
  p_purpose text,
  p_code_hmac text,
  p_max_attempts integer,
  p_now timestamptz,
  p_ip_key text,
  p_email_key text,
  p_ip_limit integer,
  p_err_limit integer,
  p_cookie_hash text)
returns table (out_resultado text, out_attempts_restantes integer, out_challenge_id uuid,
               out_email_enc bytea, out_draft_id uuid, out_retry_after integer, out_attached boolean)
language plpgsql
set search_path = ''
as $$
declare
  v_r record;
  v_anexou boolean := false;
begin
  select * into v_r
    from private.auth_code_attempt(p_challenge_id, p_email_hash, p_purpose, p_code_hmac, p_max_attempts,
      p_now, p_ip_key, p_email_key, p_ip_limit, p_err_limit) a;

  if v_r.out_resultado = 'ok' then
    v_anexou := private.draft_attach_challenge(v_r.out_challenge_id, p_cookie_hash, p_now);
  end if;

  return query select v_r.out_resultado, v_r.out_attempts_restantes, v_r.out_challenge_id,
                      v_r.out_email_enc, v_r.out_draft_id, v_r.out_retry_after, v_anexou;
end
$$;

create or replace function private.auth_challenge_consume_link_attach(
  p_token_hash text,
  p_now timestamptz,
  p_cookie_hash text)
returns table (out_resultado text, out_challenge_id uuid, out_purpose text,
               out_email_enc bytea, out_draft_id uuid, out_attached boolean)
language plpgsql
set search_path = ''
as $$
declare
  v_r record;
  v_anexou boolean := false;
begin
  select * into v_r from private.auth_challenge_consume_link(p_token_hash, p_now) l;

  if v_r.out_resultado = 'ok' then
    v_anexou := private.draft_attach_challenge(v_r.out_challenge_id, p_cookie_hash, p_now);
  end if;

  return query select v_r.out_resultado, v_r.out_challenge_id, v_r.out_purpose,
                      v_r.out_email_enc, v_r.out_draft_id, v_anexou;
end
$$;

-- 6. Identificacao do rascunho (§2.5), papel app_api. Leitura: zero linhas = 404. Escrita: aplica a regra de
--    §1.5 sob FOR UPDATE. E-mail trocado zera a confirmacao; e-mail igual mantem.
create or replace function private.draft_identity_get(p_hash text, p_now timestamptz)
returns table (out_first_name text, out_email text, out_email_verified boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select r.first_name, r.email, (r.email_verified_at is not null)
    from app.request_draft r
   where r.browser_nonce_hash = p_hash
     and r.status in ('aberto', 'aguardando_email')
     and r.expires_at > p_now
$$;

create or replace function private.draft_identity_set(
  p_hash text,
  p_now timestamptz,
  p_first_name text,
  p_email text,
  p_email_hmac text)
returns table (out_first_name text, out_email text, out_email_verified boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r app.request_draft%rowtype;
  v_mudou boolean;
begin
  if p_hash is null or p_now is null or p_first_name is null or p_email is null or p_email_hmac is null then
    raise exception 'draft_entrada_invalida' using errcode = '22023';
  end if;

  select * into v_r
    from app.request_draft r
   where r.browser_nonce_hash = p_hash
     and r.status in ('aberto', 'aguardando_email')
     and r.expires_at > p_now
   for update;
  if not found then
    return;
  end if;

  v_mudou := v_r.email_hmac is distinct from p_email_hmac;

  update app.request_draft r
     set first_name = p_first_name,
         email = p_email,
         email_hmac = p_email_hmac,
         email_verified_at = case when v_mudou then null else r.email_verified_at end,
         status = case when v_mudou and r.status = 'aguardando_email' then 'aberto' else r.status end,
         updated_at = p_now
   where r.id = v_r.id;

  return query select r.first_name, r.email, (r.email_verified_at is not null)
                 from app.request_draft r
                where r.id = v_r.id;
end
$$;

-- Privilegios: nenhuma funcao nova para PUBLIC, anon, authenticated ou service_role.
-- app_system: vinculo, anexacao e os dois embrulhos (o desafio e do papel de sistema).
-- app_api: so a identificacao do rascunho (leitura e escrita do proprio rascunho pelo cookie).
revoke all on function
  private.draft_bind_challenge(uuid, text, timestamptz),
  private.draft_attach_challenge(uuid, text, timestamptz),
  private.auth_code_attempt_attach(uuid, text, text, text, integer, timestamptz, text, text, integer, integer, text),
  private.auth_challenge_consume_link_attach(text, timestamptz, text),
  private.draft_identity_get(text, timestamptz),
  private.draft_identity_set(text, timestamptz, text, text, text)
  from public, anon, authenticated, service_role;

grant execute on function
  private.draft_bind_challenge(uuid, text, timestamptz),
  private.draft_attach_challenge(uuid, text, timestamptz),
  private.auth_code_attempt_attach(uuid, text, text, text, integer, timestamptz, text, text, integer, integer, text),
  private.auth_challenge_consume_link_attach(text, timestamptz, text)
  to app_system;

grant execute on function
  private.draft_identity_get(text, timestamptz),
  private.draft_identity_set(text, timestamptz, text, text, text)
  to app_api;
