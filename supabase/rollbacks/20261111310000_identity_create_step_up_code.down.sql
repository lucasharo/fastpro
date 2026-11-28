-- Desfaz H-014 (codigo de step-up), migracao 20261111310000. Idempotente.
-- Restaura as assinaturas e os corpos de 20261111140000 (create, consume_link) e 20261111170000 (request).
-- Desafios de step-up sao efemeros (15 min) e sao removidos antes de restaurar a restricao de purpose.
begin;

-- 1. Remove as funcoes de step-up e a versao nova dos pedidos.
drop function if exists private.step_up_verify(uuid, uuid, text, text, integer, timestamptz, text, text,
  integer, integer);
drop function if exists private.step_up_request(uuid, uuid, text, text, text, bytea, text, timestamptz,
  text, text, text, integer, integer, integer);
drop function if exists private.auth_challenge_request(uuid, text, text, text, text, bytea, bytea, uuid,
  text, timestamptz, text, text, text, integer, integer, integer, uuid);
drop function if exists private.auth_challenge_create(uuid, text, text, text, text, bytea, bytea, uuid,
  text, timestamptz, uuid);

-- 2. Restaura auth_challenge_create (10 argumentos), como em 20261111140000.
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

-- 3. Restaura auth_challenge_consume_link, como em 20261111140000.
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

-- 4. Restaura auth_challenge_request (16 argumentos), como em 20261111170000.
create or replace function private.auth_challenge_request(
  p_id uuid,
  p_email_hash text,
  p_purpose text,
  p_token_hash text,
  p_code_hmac text,
  p_email_enc bytea,
  p_secrets_enc bytea,
  p_draft_id uuid,
  p_ip_hmac text,
  p_now timestamptz,
  p_ip_key text,
  p_global_h_key text,
  p_global_d_key text,
  p_ip_limit integer,
  p_global_h_limit integer,
  p_global_d_limit integer)
returns table (out_resultado text, out_challenge_id uuid, out_outbox_id uuid,
               out_retry_after integer, out_motivo text)
language plpgsql
set search_path = ''
as $$
declare
  v_ip integer := least(greatest(p_ip_limit, 5), 100);
  v_gh integer := least(greatest(p_global_h_limit, 5), 200);
  v_gd integer := least(greatest(p_global_d_limit, 10), 90);
  v_ok_ip boolean;
  v_ret_ip integer;
  v_ok_gh boolean;
  v_ret_gh integer;
  v_ok_gd boolean;
  v_ret_gd integer;
  v_retry integer := 0;
  v_motivo text := null;
  v_res text;
  v_chal uuid;
  v_outbox uuid;
  v_espera integer;
begin
  if p_id is null or p_now is null or p_email_hash is null or p_token_hash is null
     or p_code_hmac is null or p_purpose is null or p_purpose not in ('login', 'publish')
     or p_ip_key is null or p_global_h_key is null or p_global_d_key is null then
    raise exception 'auth_challenge_entrada_invalida' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rl1|lock|global', 0));
  perform pg_advisory_xact_lock(hashtextextended('rl1|lock|' || p_ip_key, 0));

  select c.out_ok, c.out_retry_after into v_ok_ip, v_ret_ip
    from private.rl_check(p_ip_key, 3600, 600, v_ip, p_now) c;
  select c.out_ok, c.out_retry_after into v_ok_gh, v_ret_gh
    from private.rl_check(p_global_h_key, 3600, 600, v_gh, p_now) c;
  select c.out_ok, c.out_retry_after into v_ok_gd, v_ret_gd
    from private.rl_check(p_global_d_key, 86400, 86400, v_gd, p_now) c;

  if not v_ok_ip then
    v_motivo := coalesce(v_motivo, 'ip');
    v_retry := greatest(v_retry, v_ret_ip);
  end if;
  if not v_ok_gh then
    v_motivo := coalesce(v_motivo, 'global_h');
    v_retry := greatest(v_retry, v_ret_gh);
  end if;
  if not v_ok_gd then
    v_motivo := coalesce(v_motivo, 'global_d');
    v_retry := greatest(v_retry, v_ret_gd);
  end if;

  if v_motivo is not null then
    return query select 'limite'::text, null::uuid, null::uuid, v_retry, v_motivo;
    return;
  end if;

  select c.out_resultado, c.out_challenge_id, c.out_outbox_id, c.out_retry_after
    into v_res, v_chal, v_outbox, v_espera
    from private.auth_challenge_create(p_id, p_email_hash, p_purpose, p_token_hash, p_code_hmac,
      p_email_enc, p_secrets_enc, p_draft_id, p_ip_hmac, p_now) c;

  if v_res = 'criado' then
    perform private.rl_hit(p_ip_key, 600, p_now);
    perform private.rl_hit(p_global_h_key, 600, p_now);
    perform private.rl_hit(p_global_d_key, 86400, p_now);
  end if;

  return query select v_res, v_chal, v_outbox, v_espera,
    case when v_res = 'criado' then null::text else 'email'::text end;
end
$$;

-- 5. Desafios de step-up saem antes da restricao antiga; a coluna e a restricao nova saem.
delete from app.auth_challenge where purpose = 'step_up';

alter table app.auth_challenge drop constraint if exists auth_challenge_step_up_sessao;
alter table app.auth_challenge drop column if exists session_id;
alter table app.auth_challenge drop constraint if exists auth_challenge_purpose_check;
alter table app.auth_challenge add constraint auth_challenge_purpose_check
  check (purpose in ('login', 'publish'));

-- 6. Postura de acesso das assinaturas restauradas (como em 20261111140000 e 20261111170000).
revoke all on function
  private.auth_challenge_create(uuid, text, text, text, text, bytea, bytea, uuid, text, timestamptz),
  private.auth_challenge_request(uuid, text, text, text, text, bytea, bytea, uuid, text,
    timestamptz, text, text, text, integer, integer, integer),
  private.auth_challenge_consume_link(text, timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function
  private.auth_challenge_create(uuid, text, text, text, text, bytea, bytea, uuid, text, timestamptz),
  private.auth_challenge_request(uuid, text, text, text, text, bytea, bytea, uuid, text,
    timestamptz, text, text, text, integer, integer, integer),
  private.auth_challenge_consume_link(text, timestamptz)
  to app_system;

commit;
