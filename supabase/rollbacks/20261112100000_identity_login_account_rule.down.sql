-- Desfaz 20261112100000_identity_login_account_rule: volta private.auth_challenge_create a versao de
-- 20261111310000 e remove o HMAC do e-mail. Dev somente; nao apaga contas.

drop function if exists private.app_user_set_email_hmac(uuid, text);

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
  p_now timestamptz,
  p_session_id uuid default null)
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
  v_tipo text;
begin
  if p_id is null or p_now is null or p_email_hash is null or p_token_hash is null
     or p_code_hmac is null or p_purpose is null or p_purpose not in ('login', 'publish', 'step_up') then
    raise exception 'auth_challenge_entrada_invalida' using errcode = '22023';
  end if;
  if (p_purpose = 'step_up') <> (p_session_id is not null) then
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

  -- Novo pedido substitui o desafio vivo do mesmo e-mail e intencao (D-H011-5; 52 §4.3 para step_up).
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
    secrets_enc, draft_id, ip_hmac, expires_at, attempts, created_at, session_id)
  values (p_id, p_email_hash, p_purpose, p_token_hash, p_code_hmac, p_email_enc,
    p_secrets_enc, p_draft_id, p_ip_hmac, p_now + interval '15 minutes', 0, p_now, p_session_id);

  -- Saida do e-mail: classe auth, sem endereco (o destinatario e resolvido no envio).
  -- Codigo de step-up usa o modelo acesso_stepup (52 §4.3); o de acesso continua acesso_login.
  v_tipo := case when p_purpose = 'step_up' then 'acesso_stepup' else 'acesso_login' end;
  select e.out_outbox_id into v_saida
    from private.email_outbox_inserir(p_id, 'acesso', 'auth', v_tipo, v_tipo,
           jsonb_build_object('challenge_ref', p_id), 'ac:' || p_id::text, p_now) e;

  return query select 'criado'::text, p_id, v_saida, null::integer;
end
$$;

drop index if exists app.app_user_email_hmac_key;
alter table app.app_user drop column if exists email_hmac;
