-- H-015 | Anti-enumeracao e limites (desenho docs/factory/50-DESENHO-H015.md, §1.2, §1.3, §3).
-- Idempotente. Desfazer: supabase/rollbacks/20261111170000_identity_create_rate_limits.down.sql.
-- So adiciona objetos. NAO altera private.auth_challenge_create nem private.auth_challenge_verify_code:
-- as portas novas (auth_challenge_request e auth_code_attempt) as envolvem.
-- Chaves de contador sao HMAC calculados na aplicacao (o pepper nunca chega ao banco). Nenhum e-mail
-- ou IP em claro. Tempo: p_now informado pelo chamador. Limites vem de ops.app_config (validados na
-- aplicacao) e sao revalidados aqui com least/greatest; o teto diario de pedidos e rigido em 90.
-- Postura (igual H-011): RLS habilitada e forcada, sem politicas, nenhum privilegio para
-- PUBLIC/anon/authenticated/service_role. Somente app_system recebe privilegios minimos.

-- 1. ops.code_lock (50 §1.2): bloqueio progressivo do codigo por e-mail (chave = HMAC do e-mail) ----
create table if not exists ops.code_lock (
  key_hmac      text primary key check (key_hmac ~ '^[0-9a-f]{64}$'),
  strikes       smallint not null default 0 check (strikes >= 0),
  locked_until  timestamptz,
  last_error_at timestamptz not null,
  updated_at    timestamptz not null
);
comment on table ops.code_lock is
  'Bloqueio do caminho do codigo por e-mail (H-015, 50 §3). Chave apenas como HMAC; sem e-mail em claro.';

-- 2. Contador em janela: soma os baldes do inicio da janela grosseira ate o balde atual (50 §1.1). --
create or replace function private.rl_check(
  p_key text,
  p_span_s integer,
  p_bucket_s integer,
  p_limit integer,
  p_now timestamptz)
returns table (out_ok boolean, out_retry_after integer)
language plpgsql
set search_path = ''
as $$
declare
  v_now bigint;
  v_cur bigint;
  v_total bigint;
  v_oldest bigint;
begin
  if p_key is null or p_span_s is null or p_bucket_s is null or p_limit is null or p_now is null
     or p_bucket_s <= 0 or p_span_s < p_bucket_s then
    raise exception 'rate_entrada_invalida' using errcode = '22023';
  end if;

  v_now := floor(extract(epoch from p_now))::bigint;
  v_cur := (v_now / p_bucket_s::bigint) * p_bucket_s;

  select coalesce(sum(c.count), 0)::bigint,
         min(floor(extract(epoch from c.window_start))::bigint) filter (where c.count > 0)
    into v_total, v_oldest
    from ops.rate_counter c
   where c.key_hmac = p_key
     and c.window_start >= to_timestamp((v_cur - (p_span_s - p_bucket_s))::double precision)
     and c.window_start <= to_timestamp(v_cur::double precision);

  if v_total < p_limit then
    return query select true, null::integer;
    return;
  end if;

  return query select false,
    least(86400, greatest(1, (coalesce(v_oldest, v_cur) + p_span_s - v_now)))::integer;
end
$$;

-- Incrementa o balde atual da chave. So chamado depois de a operacao ser aceita (50 §1.1).
create or replace function private.rl_hit(p_key text, p_bucket_s integer, p_now timestamptz)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_start timestamptz;
begin
  if p_key is null or p_bucket_s is null or p_bucket_s <= 0 or p_now is null then
    raise exception 'rate_entrada_invalida' using errcode = '22023';
  end if;

  v_start := to_timestamp(
    (floor(extract(epoch from p_now) / p_bucket_s) * p_bucket_s)::double precision);

  insert into ops.rate_counter as r (key_hmac, window_start, count)
  values (p_key, v_start, 1)
  on conflict (key_hmac, window_start) do update set count = r.count + 1;
end
$$;

-- 3. Porta do pedido de acesso (50 §1.3 item 3). Ordem de travas fixa: global -> IP -> e-mail.
-- Pedido barrado por IP ou global nao cria nada e nao conta. O e-mail e travado dentro de create.
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

-- 4. Porta da verificacao do codigo (50 §1.3 item 4 e §3). Ordem de travas: IP -> e-mail.
-- Bloqueio do e-mail vem antes do IP e antes da comparacao; so tentativa que chega a comparacao
-- ou a registra conta no IP. Todo resultado diferente de 'ok' conta erro no e-mail.
create or replace function private.auth_code_attempt(
  p_challenge_id uuid,
  p_email_hash text,
  p_purpose text,
  p_code_hmac text,
  p_max_attempts integer,
  p_now timestamptz,
  p_ip_key text,
  p_email_key text,
  p_ip_limit integer,
  p_err_limit integer)
returns table (out_resultado text, out_attempts_restantes integer, out_challenge_id uuid,
               out_email_enc bytea, out_draft_id uuid, out_retry_after integer)
language plpgsql
set search_path = ''
as $$
declare
  v_ip integer := least(greatest(p_ip_limit, 10), 500);
  v_err integer := least(greatest(p_err_limit, 5), 50);
  v_lock ops.code_lock%rowtype;
  v_found boolean;
  v_ok boolean;
  v_ret integer;
  v_res text;
  v_restantes integer;
  v_chal uuid;
  v_enc bytea;
  v_draft uuid;
  v_strikes integer;
  v_locked_until timestamptz;
  v_sum_ok boolean;
  v_sum_ret integer;
begin
  if p_now is null or p_email_hash is null or p_purpose is null or p_code_hmac is null
     or p_max_attempts is null or p_ip_key is null or p_email_key is null then
    raise exception 'auth_challenge_entrada_invalida' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rl1|lock|' || p_ip_key, 0));
  perform pg_advisory_xact_lock(hashtextextended('rl1|lock|' || p_email_key, 0));

  select * into v_lock from ops.code_lock l where l.key_hmac = p_email_key;
  v_found := found;

  if v_found and v_lock.locked_until is not null and v_lock.locked_until > p_now then
    return query select 'bloqueado_codigo'::text, 0, null::uuid, null::bytea, null::uuid,
      least(86400, greatest(1, ceil(extract(epoch from (v_lock.locked_until - p_now)))::integer));
    return;
  end if;

  select c.out_ok, c.out_retry_after into v_ok, v_ret
    from private.rl_check(p_ip_key, 3600, 600, v_ip, p_now) c;
  if not v_ok then
    return query select 'bloqueado_ip'::text, 0, null::uuid, null::bytea, null::uuid, v_ret;
    return;
  end if;
  perform private.rl_hit(p_ip_key, 600, p_now);

  select v.out_resultado, v.out_attempts_restantes, v.out_challenge_id, v.out_email_enc,
         v.out_draft_id
    into v_res, v_restantes, v_chal, v_enc, v_draft
    from private.auth_challenge_verify_code(p_challenge_id, p_email_hash, p_purpose, p_code_hmac,
      p_max_attempts, p_now) v;

  if v_res = 'ok' then
    return query select 'ok'::text, v_restantes, v_chal, v_enc, v_draft, null::integer;
    return;
  end if;

  -- Registro de erro (50 §3): mesma transacao, serializado pelo lock do e-mail.
  -- Zera os strikes se o ultimo erro foi ha mais de 7 dias (passo 2).
  v_strikes := case
    when v_found and p_now - v_lock.last_error_at <= interval '7 days' then v_lock.strikes::integer
    else 0 end;
  v_locked_until := case when v_found then v_lock.locked_until else null end;

  perform private.rl_hit(p_email_key, 3600, p_now);

  select c.out_ok, c.out_retry_after into v_sum_ok, v_sum_ret
    from private.rl_check(p_email_key, 86400, 3600, v_err, p_now) c;

  if not v_sum_ok then
    -- Passo 3: chegou ao limite de erros na janela. Bloqueio progressivo; apaga os baldes do e-mail.
    v_strikes := v_strikes + 1;
    v_locked_until := p_now + make_interval(secs => case
      when v_strikes = 1 then 900
      when v_strikes = 2 then 3600
      else 86400 end);
    delete from ops.rate_counter r where r.key_hmac = p_email_key;
  end if;

  insert into ops.code_lock as k (key_hmac, strikes, locked_until, last_error_at, updated_at)
  values (p_email_key, v_strikes::smallint, v_locked_until, p_now, p_now)
  on conflict (key_hmac) do update
     set strikes = excluded.strikes,
         locked_until = excluded.locked_until,
         last_error_at = excluded.last_error_at,
         updated_at = excluded.updated_at;

  return query select v_res, v_restantes, null::uuid, null::bytea, null::uuid, null::integer;
end
$$;

-- 5. Expurgo diario (50 §1.3 item 5): contadores com mais de 3 dias e bloqueios vencidos e velhos.
create or replace function private.rate_purge(p_now timestamptz)
returns table (out_rate integer, out_lock integer)
language plpgsql
set search_path = ''
as $$
declare
  v_rate integer;
  v_lock integer;
begin
  if p_now is null then
    raise exception 'rate_entrada_invalida' using errcode = '22023';
  end if;

  delete from ops.rate_counter r where r.window_start < p_now - interval '3 days';
  get diagnostics v_rate = row_count;

  delete from ops.code_lock k
   where k.last_error_at < p_now - interval '8 days'
     and (k.locked_until is null or k.locked_until < p_now);
  get diagnostics v_lock = row_count;

  return query select v_rate, v_lock;
end
$$;

-- 6. Postura de acesso (igual H-011) ---------------------------------------------------------------
alter table ops.code_lock enable row level security;
alter table ops.code_lock force row level security;

revoke all on ops.code_lock from public, anon, authenticated, service_role;
grant select, insert, update, delete on ops.code_lock to app_system;

revoke all on function
  private.rl_check(text, integer, integer, integer, timestamptz),
  private.rl_hit(text, integer, timestamptz),
  private.auth_challenge_request(uuid, text, text, text, text, bytea, bytea, uuid, text,
    timestamptz, text, text, text, integer, integer, integer),
  private.auth_code_attempt(uuid, text, text, text, integer, timestamptz, text, text, integer,
    integer),
  private.rate_purge(timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function
  private.rl_check(text, integer, integer, integer, timestamptz),
  private.rl_hit(text, integer, timestamptz),
  private.auth_challenge_request(uuid, text, text, text, text, bytea, bytea, uuid, text,
    timestamptz, text, text, text, integer, integer, integer),
  private.auth_code_attempt(uuid, text, text, text, integer, timestamptz, text, text, integer,
    integer),
  private.rate_purge(timestamptz)
  to app_system;
