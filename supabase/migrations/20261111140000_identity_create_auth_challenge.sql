-- H-011 | Desafio de acesso do cliente (desenho docs/factory/39-DESENHO-H011.md, secoes 2 e 2.1).
-- Idempotente. Desfazer: supabase/rollbacks/20261111140000_identity_create_auth_challenge.down.sql.
-- Nada aqui guarda endereco, token ou codigo em claro: so hashes/HMAC e blobs cifrados (AES-256-GCM,
-- feitos na aplicacao) que sao zerados ao entregar, usar, invalidar ou expirar.
-- Postura (igual H-005 e H-092): RLS habilitada e forcada, sem politicas, nenhum privilegio para
-- PUBLIC/anon/authenticated/service_role. Somente app_system recebe privilegios minimos.
-- Tempo: relogio informado por p_now (o chamador passa o instante; testes usam valor fixo).
-- DESVIO a 39 §2.1: o codigo (HMAC) inclui o id do desafio, entao a verificacao recebe p_challenge_id,
-- obtido por private.auth_challenge_ativo_id antes do calculo. Os limites de frequencia ficam so no
-- banco (ops.app_config, revalidados aqui); a aplicacao nao os envia como parametro.

-- 1. app.auth_challenge (39 §2) ---------------------------------------------------------------------
create table if not exists app.auth_challenge (
  id                  uuid primary key,
  email_hash          text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  purpose             text not null check (purpose in ('login', 'publish')),
  token_hash          text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  code_hmac           text not null check (code_hmac ~ '^[0-9a-f]{64}$'),
  email_enc           bytea,
  secrets_enc         bytea,
  draft_id            uuid,
  browser_nonce_hash  text check (browser_nonce_hash ~ '^[0-9a-f]{64}$'),
  ip_hmac             text check (ip_hmac ~ '^[0-9a-f]{64}$'),
  expires_at          timestamptz not null,
  consumed_at         timestamptz,
  invalidated_at      timestamptz,
  invalid_reason      text check (invalid_reason in ('substituido', 'tentativas', 'expirado_limpeza')),
  delivered_at        timestamptz,
  attempts            smallint not null default 0 check (attempts between 0 and 5),
  created_at          timestamptz not null,
  constraint auth_challenge_validade_15min check (expires_at = created_at + interval '15 minutes'),
  constraint auth_challenge_motivo_consistente
    check ((invalidated_at is null) = (invalid_reason is null)),
  constraint auth_challenge_uso_unico
    check (not (consumed_at is not null and invalidated_at is not null))
);

create unique index if not exists auth_challenge_token_hash_uidx
  on app.auth_challenge (token_hash);
-- No maximo um desafio vivo por (e-mail, intencao) (08 §5.1 item 2; CA-H011-10).
create unique index if not exists auth_challenge_vivo_uidx
  on app.auth_challenge (email_hash, purpose)
  where consumed_at is null and invalidated_at is null;
create index if not exists auth_challenge_email_criado_idx
  on app.auth_challenge (email_hash, created_at);

comment on table app.auth_challenge is
  'Desafio de acesso (H-011, 39 §2). Sem endereco, token ou codigo em claro; blobs zerados ao fim.';

-- 2. Parametros de frequencia em ops.app_config (39 §4); padrao se ausente ou fora da faixa --------
create or replace function private.auth_challenge_config(
  p_key text, p_min integer, p_max integer, p_default integer)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select case when jsonb_typeof(c.value) = 'number' then
              case when (c.value #>> '{}')::numeric between p_min and p_max
                   then (c.value #>> '{}')::integer
              end
            end
       from ops.app_config c where c.key = p_key),
    p_default)
$$;

-- 3. Id do desafio vivo do par (e-mail, intencao), ou nulo ----------------------------------------
create or replace function private.auth_challenge_ativo_id(
  p_email_hash text, p_purpose text, p_now timestamptz)
returns uuid
language sql
stable
set search_path = ''
as $$
  select c.id from app.auth_challenge c
   where c.email_hash = p_email_hash
     and c.purpose = p_purpose
     and c.consumed_at is null
     and c.invalidated_at is null
     and c.expires_at > p_now
$$;

-- 4. Criacao do desafio (39 §2.1 item 1 e §4). Uma transacao; trava por e-mail. ---------------------
-- resultado: criado | espera | teto. Pedido barrado nao cria linha (nao conta).
create or replace function private.auth_challenge_create(
  p_id uuid,
  p_email_hash text,
  p_purpose text,
  p_token_hash text,
  p_code_hmac text,
  p_email_enc bytea,
  p_secrets_enc bytea,
  p_draft_id uuid,
  p_ip_hmac text,
  p_now timestamptz)
returns table (out_resultado text, out_challenge_id uuid, out_outbox_id uuid,
               out_retry_after integer)
language plpgsql
set search_path = ''
as $$
declare
  v_min integer := private.auth_challenge_config('auth.challenge.min_interval_seconds', 10, 600, 60);
  v_max integer := private.auth_challenge_config('auth.challenge.max_per_hour', 1, 20, 5);
  v_ultimo timestamptz;
  v_contagem integer;
  v_antigo timestamptz;
  v_espera integer;
  v_saida uuid;
begin
  if p_id is null or p_now is null or p_email_hash is null or p_token_hash is null
     or p_code_hmac is null or p_purpose is null or p_purpose not in ('login', 'publish') then
    raise exception 'auth_challenge_entrada_invalida' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_email_hash, 0));

  select max(c.created_at) into v_ultimo
    from app.auth_challenge c
   where c.email_hash = p_email_hash;
  if v_ultimo is not null and p_now - v_ultimo < make_interval(secs => v_min) then
    v_espera := greatest(1, ceil(extract(epoch from
                  (v_ultimo + make_interval(secs => v_min) - p_now)))::integer);
    return query select 'espera'::text, null::uuid, null::uuid, v_espera;
    return;
  end if;

  select count(*)::integer into v_contagem
    from app.auth_challenge c
   where c.email_hash = p_email_hash
     and c.created_at > p_now - interval '1 hour';
  if v_contagem >= v_max then
    select c.created_at into v_antigo
      from app.auth_challenge c
     where c.email_hash = p_email_hash
       and c.created_at > p_now - interval '1 hour'
     order by c.created_at
     offset (v_contagem - v_max)
     limit 1;
    v_espera := greatest(1, ceil(extract(epoch from
                  (v_antigo + interval '1 hour' - p_now)))::integer);
    return query select 'teto'::text, null::uuid, null::uuid, v_espera;
    return;
  end if;

  -- Novo pedido substitui o desafio vivo do mesmo e-mail e intencao (D-H011-5).
  update app.auth_challenge c
     set invalidated_at = p_now,
         invalid_reason = 'substituido',
         email_enc = null,
         secrets_enc = null
   where c.email_hash = p_email_hash
     and c.purpose = p_purpose
     and c.consumed_at is null
     and c.invalidated_at is null;

  insert into app.auth_challenge (id, email_hash, purpose, token_hash, code_hmac, email_enc,
    secrets_enc, draft_id, ip_hmac, expires_at, attempts, created_at)
  values (p_id, p_email_hash, p_purpose, p_token_hash, p_code_hmac, p_email_enc,
    p_secrets_enc, p_draft_id, p_ip_hmac, p_now + interval '15 minutes', 0, p_now);

  -- Saida do e-mail: classe auth, sem endereco (o destinatario e resolvido no envio).
  select e.out_outbox_id into v_saida
    from private.email_outbox_inserir(p_id, 'acesso', 'auth', 'acesso_login', 'acesso_login',
           jsonb_build_object('challenge_ref', p_id), 'ac:' || p_id::text, p_now) e;

  return query select 'criado'::text, p_id, v_saida, null::integer;
end
$$;

-- 5. Consumo pelo link (39 §2.1 item 2). Uso unico; expirado ou inexistente = invalido. ------------
create or replace function private.auth_challenge_consume_link(p_token_hash text, p_now timestamptz)
returns table (out_resultado text, out_challenge_id uuid, out_purpose text,
               out_email_enc bytea, out_draft_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_c app.auth_challenge%rowtype;
begin
  select * into v_c from app.auth_challenge c where c.token_hash = p_token_hash for update;
  if not found then
    return query select 'invalido'::text, null::uuid, null::text, null::bytea, null::uuid;
    return;
  end if;

  if v_c.consumed_at is not null or v_c.invalidated_at is not null then
    null;
  elsif v_c.expires_at <= p_now then
    update app.auth_challenge c
       set invalidated_at = p_now, invalid_reason = 'expirado_limpeza',
           email_enc = null, secrets_enc = null
     where c.id = v_c.id;
  else
    update app.auth_challenge c
       set consumed_at = p_now, email_enc = null, secrets_enc = null
     where c.id = v_c.id;
    return query select 'ok'::text, v_c.id, v_c.purpose, v_c.email_enc, v_c.draft_id;
    return;
  end if;

  return query select 'invalido'::text, null::uuid, null::text, null::bytea, null::uuid;
end
$$;

-- 6. Verificacao do codigo (39 §2.1 item 3). Quinto erro invalida o desafio. ----------------------
create or replace function private.auth_challenge_verify_code(
  p_challenge_id uuid,
  p_email_hash text,
  p_purpose text,
  p_code_hmac text,
  p_max_attempts integer,
  p_now timestamptz)
returns table (out_resultado text, out_attempts_restantes integer, out_challenge_id uuid,
               out_email_enc bytea, out_draft_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_c app.auth_challenge%rowtype;
  v_tentativas integer;
begin
  select * into v_c
    from app.auth_challenge c
   where c.id = p_challenge_id
     and c.email_hash = p_email_hash
     and c.purpose = p_purpose
     and c.consumed_at is null
     and c.invalidated_at is null
     for update;
  if not found then
    return query select 'invalido'::text, 0, null::uuid, null::bytea, null::uuid;
    return;
  end if;

  if v_c.expires_at <= p_now then
    update app.auth_challenge c
       set invalidated_at = p_now, invalid_reason = 'expirado_limpeza',
           email_enc = null, secrets_enc = null
     where c.id = v_c.id;
    return query select 'invalido'::text, 0, null::uuid, null::bytea, null::uuid;
    return;
  end if;

  if v_c.code_hmac = p_code_hmac then
    update app.auth_challenge c
       set consumed_at = p_now, email_enc = null, secrets_enc = null
     where c.id = v_c.id;
    return query select 'ok'::text, 0, v_c.id, v_c.email_enc, v_c.draft_id;
    return;
  end if;

  v_tentativas := v_c.attempts + 1;
  if v_tentativas >= p_max_attempts then
    update app.auth_challenge c
       set attempts = v_tentativas, invalidated_at = p_now, invalid_reason = 'tentativas',
           email_enc = null, secrets_enc = null
     where c.id = v_c.id;
    return query select 'invalido'::text, 0, null::uuid, null::bytea, null::uuid;
    return;
  end if;

  update app.auth_challenge c set attempts = v_tentativas where c.id = v_c.id;
  return query select 'errado'::text, p_max_attempts - v_tentativas, null::uuid, null::bytea,
    null::uuid;
end
$$;

-- 7. Entrega confirmada pelo provedor (39 §2.1 item 4). Zera o segredo para nao haver segundo envio.
create or replace function private.auth_challenge_mark_delivered(p_challenge_id uuid, p_now timestamptz)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  update app.auth_challenge c
     set delivered_at = p_now, secrets_enc = null
   where c.id = p_challenge_id
     and c.delivered_at is null;
  return found;
end
$$;

-- 8. Expurgo (39 §2.1 item 5). Zera blobs de linhas terminais ou vencidas; remove linhas com mais de 24 h.
create or replace function private.auth_challenge_purge(p_now timestamptz)
returns table (out_zerados integer, out_removidos integer)
language plpgsql
set search_path = ''
as $$
declare
  v_zerados integer;
  v_removidos integer;
begin
  update app.auth_challenge c
     set email_enc = null, secrets_enc = null
   where (c.consumed_at is not null or c.invalidated_at is not null or c.expires_at <= p_now)
     and (c.email_enc is not null or c.secrets_enc is not null);
  get diagnostics v_zerados = row_count;

  delete from app.auth_challenge c where c.created_at < p_now - interval '24 hours';
  get diagnostics v_removidos = row_count;

  return query select v_zerados, v_removidos;
end
$$;

-- 9. Postura de acesso (igual H-005/H-092) ----------------------------------------------------------
alter table app.auth_challenge enable row level security;
alter table app.auth_challenge force row level security;

revoke all on app.auth_challenge from public, anon, authenticated, service_role;
grant usage on schema app to app_system;
grant select, insert, update, delete on app.auth_challenge to app_system;

revoke all on function
  private.auth_challenge_config(text, integer, integer, integer),
  private.auth_challenge_ativo_id(text, text, timestamptz),
  private.auth_challenge_create(uuid, text, text, text, text, bytea, bytea, uuid, text, timestamptz),
  private.auth_challenge_consume_link(text, timestamptz),
  private.auth_challenge_verify_code(uuid, text, text, text, integer, timestamptz),
  private.auth_challenge_mark_delivered(uuid, timestamptz),
  private.auth_challenge_purge(timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function
  private.auth_challenge_config(text, integer, integer, integer),
  private.auth_challenge_ativo_id(text, text, timestamptz),
  private.auth_challenge_create(uuid, text, text, text, text, bytea, bytea, uuid, text, timestamptz),
  private.auth_challenge_consume_link(text, timestamptz),
  private.auth_challenge_verify_code(uuid, text, text, text, integer, timestamptz),
  private.auth_challenge_mark_delivered(uuid, timestamptz),
  private.auth_challenge_purge(timestamptz)
  to app_system;
