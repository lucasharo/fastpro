-- Desfaz 20261113140000_requests_fix_begin_ja_publicado_status.sql (H-031, Issue #44). EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento. Devolve a definicao anterior de private.request_publish_begin (ja_publicado gravado com 201).
-- Nao toca dados nem a 20261113010000. Use somente se for preciso reverter a correcao. Idempotente (create or replace).
-- Versao 20261113140000 (e nao 20261113120000): o runner recusa migracao pendente fora de ordem, e 20261113130000 ja esta aplicada.
begin;

create or replace function private.request_publish_begin(
  p_user uuid,
  p_draft_id uuid,
  p_secret_hash text,
  p_idem_key text,
  p_body_hash text,
  p_content_rev integer,
  p_user_rate_key text,
  p_ip_rate_key text,
  p_now timestamptz)
returns table (out_status text, out_request_id uuid, out_published_at timestamptz, out_deadline_at timestamptz,
  out_address_text text, out_missing text[], out_retry_after integer)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  v_lim jsonb := private.request_publish_limits();
  v_d app.request_draft%rowtype;
  v_out text;
  v_ref text;
  v_req app.service_request%rowtype;
  v_code text;
  v_faltam text[];
  v_ok_u boolean;
  v_ra_u integer;
  v_ok_i boolean;
  v_ra_i integer;
begin
  if p_user is null or p_draft_id is null or p_secret_hash is null or p_secret_hash !~ '^[0-9a-f]{64}$'
     or p_idem_key is null or p_body_hash is null or p_body_hash !~ '^[0-9a-f]{64}$'
     or p_content_rev is null or p_content_rev < 0 or p_user_rate_key is null or p_ip_rate_key is null
     or p_now is null then
    raise exception 'publicacao_entrada_invalida' using errcode = '22023';
  end if;

  select * into v_d from app.request_draft r
   where r.id = p_draft_id and r.browser_nonce_hash = p_secret_hash
   for update;
  if not found or v_d.status = 'descartado'
     or (v_d.status <> 'publicado' and v_d.expires_at <= p_now) then
    return query select 'nao_encontrado'::text, null::uuid, null::timestamptz, null::timestamptz,
                        null::text, null::text[], null::integer;
    return;
  end if;

  select b.outcome, b.response_body_ref into v_out, v_ref
    from private.idempotency_begin(p_user::text, 'request.publish', p_idem_key, p_body_hash,
         (v_lim ->> 'lease_s')::integer) as b;

  if v_out = 'conflito' then
    return query select 'conflito'::text, null::uuid, null::timestamptz, null::timestamptz,
                        null::text, null::text[], null::integer;
    return;
  end if;
  if v_out = 'em_andamento' then
    return query select 'em_andamento'::text, null::uuid, null::timestamptz, null::timestamptz,
                        null::text, null::text[], null::integer;
    return;
  end if;
  if v_out = 'repetida' then
    select r.* into v_req from app.service_request r where r.id = v_ref::uuid;
    if not found then
      raise exception 'publicacao_chave_perdida' using errcode = '55000';
    end if;
    return query select 'repetida'::text, v_req.id, v_req.published_at, v_req.acceptance_deadline_at,
                        null::text, null::text[], null::integer;
    return;
  end if;

  -- Chave nova (v_out = 'nova'): daqui em diante, toda saida que nao seja 'ok' libera a chave.
  if v_d.status = 'publicado' then
    select r.* into v_req from app.service_request r where r.origin_draft_id = v_d.id;
    if found and v_req.customer_user_id = p_user then
      perform private.request_publish_key_done(p_user, p_idem_key, 201, v_req.id::text, p_now,
              (v_lim ->> 'key_ttl_s')::integer);
      return query select 'ja_publicado'::text, v_req.id, v_req.published_at, v_req.acceptance_deadline_at,
                          null::text, null::text[], null::integer;
      return;
    end if;
    perform private.request_publish_abort(p_user, p_idem_key, p_body_hash);
    return query select 'nao_encontrado'::text, null::uuid, null::timestamptz, null::timestamptz,
                        null::text, null::text[], null::integer;
    return;
  end if;

  select rc.out_code, rc.out_missing into v_code, v_faltam
    from private.request_publish_recusa(p_user, v_d, p_content_rev, p_now) rc;
  if v_code is not null then
    perform private.request_publish_abort(p_user, p_idem_key, p_body_hash);
    return query select v_code, null::uuid, null::timestamptz, null::timestamptz,
                        null::text, v_faltam, null::integer;
    return;
  end if;

  -- Taxa (§5.2): rl_check das duas chaves; so depois, rl_hit das duas. Replays e recusas nao consomem.
  select r.out_ok, r.out_retry_after into v_ok_u, v_ra_u
    from private.rl_check(p_user_rate_key, (v_lim ->> 'user_window_s')::integer, 60,
                          (v_lim ->> 'user_max')::integer, p_now) r;
  select r.out_ok, r.out_retry_after into v_ok_i, v_ra_i
    from private.rl_check(p_ip_rate_key, (v_lim ->> 'ip_window_s')::integer, 3600,
                          (v_lim ->> 'ip_max')::integer, p_now) r;
  if not v_ok_u or not v_ok_i then
    perform private.request_publish_abort(p_user, p_idem_key, p_body_hash);
    return query select 'limite'::text, null::uuid, null::timestamptz, null::timestamptz,
                        null::text, null::text[], greatest(coalesce(v_ra_u, 0), coalesce(v_ra_i, 0));
    return;
  end if;
  perform private.rl_hit(p_user_rate_key, 60, p_now);
  perform private.rl_hit(p_ip_rate_key, 3600, p_now);

  return query select 'ok'::text, null::uuid, null::timestamptz, null::timestamptz,
                      v_d.address_text, null::text[], null::integer;
end
$$;

revoke all on function
  private.request_publish_begin(uuid, uuid, text, text, text, integer, text, text, timestamptz)
  from public, anon, authenticated, service_role, app_api;

grant execute on function
  private.request_publish_begin(uuid, uuid, text, text, text, integer, text, text, timestamptz)
  to app_system;

delete from ops.schema_migration where version = '20261113140000';

commit;
