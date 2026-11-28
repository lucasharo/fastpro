-- H-031 (Issue #44) | Correcao: teto de 30 dias do rascunho na publicacao (110 §12.1, T-DB13).
-- Motivo: a publicacao so checava expires_at. Um rascunho com mais de 30 dias desde a criacao, com expires_at
-- ainda no futuro (dado fora dos escritores normais), era publicado. Agora begin e commit respondem
-- nao_encontrado quando created_at + 30 dias <= agora, igual ao teto das funcoes de rascunho.
-- Migracao nova (a 20261113140000 e a 20261113010000 ja estao aplicadas e nao sao editadas).
-- Idempotente (create or replace; mantem security definer, search_path vazio e os grants existentes).
-- Desfazer: supabase/rollbacks/20261113150000_requests_fix_teto_30_dias.down.sql.

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
  v_status integer;
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
     or (v_d.status <> 'publicado' and (v_d.expires_at <= p_now or v_d.created_at + interval '30 days' <= p_now)) then
    return query select 'nao_encontrado'::text, null::uuid, null::timestamptz, null::timestamptz,
                        null::text, null::text[], null::integer;
    return;
  end if;

  select b.outcome, b.response_status, b.response_body_ref into v_out, v_status, v_ref
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
    -- Replay (110 §4.4.3, decisao 256): a chave guardou 200 (ja publicado) ou 201 (criado).
    -- Devolve o mesmo desfecho da chamada original, para o replay responder o mesmo status.
    return query select (case when v_status = 200 then 'ja_publicado' else 'repetida' end)::text, v_req.id, v_req.published_at, v_req.acceptance_deadline_at,
                        null::text, null::text[], null::integer;
    return;
  end if;

  -- Chave nova (v_out = 'nova'): daqui em diante, toda saida que nao seja 'ok' libera a chave.
  if v_d.status = 'publicado' then
    select r.* into v_req from app.service_request r where r.origin_draft_id = v_d.id;
    if found and v_req.customer_user_id = p_user then
      perform private.request_publish_key_done(p_user, p_idem_key, 200, v_req.id::text, p_now,
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

create or replace function private.request_publish_commit(
  p_user uuid,
  p_draft_id uuid,
  p_secret_hash text,
  p_idem_key text,
  p_body_hash text,
  p_content_rev integer,
  p_point_id uuid,
  p_ack boolean,
  p_now timestamptz)
returns table (out_status text, out_request_id uuid, out_published_at timestamptz, out_deadline_at timestamptz,
  out_similar_id uuid, out_similar_published_at timestamptz, out_similar_service_name text, out_missing text[])
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  v_lim jsonb := private.request_publish_limits();
  v_d app.request_draft%rowtype;
  v_req app.service_request%rowtype;
  v_code text;
  v_faltam text[];
  v_pt_geo extensions.geography;
  v_pt_ok boolean;
  v_sim_id uuid;
  v_sim_em timestamptz;
  v_sim_nome text;
  v_chave boolean;
  v_fotos integer := 0;
begin
  if p_user is null or p_draft_id is null or p_secret_hash is null or p_secret_hash !~ '^[0-9a-f]{64}$'
     or p_idem_key is null or p_body_hash is null or p_body_hash !~ '^[0-9a-f]{64}$'
     or p_content_rev is null or p_content_rev < 0 or p_point_id is null or p_ack is null or p_now is null then
    raise exception 'publicacao_entrada_invalida' using errcode = '22023';
  end if;

  select * into v_d from app.request_draft r
   where r.id = p_draft_id and r.browser_nonce_hash = p_secret_hash
   for update;
  if not found or v_d.status = 'descartado'
     or (v_d.status <> 'publicado' and (v_d.expires_at <= p_now or v_d.created_at + interval '30 days' <= p_now)) then
    return query select 'nao_encontrado'::text, null::uuid, null::timestamptz, null::timestamptz,
                        null::uuid, null::timestamptz, null::text, null::text[];
    return;
  end if;

  if v_d.status = 'publicado' then
    select r.* into v_req from app.service_request r where r.origin_draft_id = v_d.id;
    if found and v_req.customer_user_id = p_user then
      perform private.request_publish_key_done(p_user, p_idem_key, 200, v_req.id::text, p_now,
              (v_lim ->> 'key_ttl_s')::integer);
      return query select 'ja_publicado'::text, v_req.id, v_req.published_at, v_req.acceptance_deadline_at,
                          null::uuid, null::timestamptz, null::text, null::text[];
      return;
    end if;
    return query select 'nao_encontrado'::text, null::uuid, null::timestamptz, null::timestamptz,
                        null::uuid, null::timestamptz, null::text, null::text[];
    return;
  end if;

  select rc.out_code, rc.out_missing into v_code, v_faltam
    from private.request_publish_recusa(p_user, v_d, p_content_rev, p_now) rc;
  if v_code is not null then
    return query select v_code, null::uuid, null::timestamptz, null::timestamptz,
                        null::uuid, null::timestamptz, null::text, v_faltam;
    return;
  end if;

  -- A chave ainda e nossa (em_andamento, mesmo hash). Senao, a API responde 503 e a repeticao reinicia.
  select true into v_chave from ops.idempotency_key k
   where k.principal_id = p_user::text and k.operation = 'request.publish' and k.key = p_idem_key
     and k.state = 'em_andamento' and k.request_hash = p_body_hash
   for update;
  if not found then
    raise exception 'publicacao_chave_perdida' using errcode = '55000';
  end if;

  -- Ponto (§4.4.4): do mesmo assunto (rascunho), permanente, ok e com celula de casamento.
  select g.exact_point into v_pt_geo from app.geocode_point g
   where g.id = p_point_id and g.subject_kind = 'request' and g.subject_id = p_draft_id
     and g.state = 'ok' and g.geocode_mode = 'permanent' and g.match_cell is not null;
  v_pt_ok := found;
  if not v_pt_ok then
    return query select 'ponto_invalido'::text, null::uuid, null::timestamptz, null::timestamptz,
                        null::uuid, null::timestamptz, null::text, null::text[];
    return;
  end if;

  -- Duplicidade (§6): so pedidos do proprio cliente, mesmo servico, dentro do raio. Nunca bloqueia.
  select r.id, r.published_at, s.name into v_sim_id, v_sim_em, v_sim_nome
    from app.service_request r
    join app.geocode_point g on g.id = r.geocode_point_id
    join app.service s on s.id = r.service_id
   where r.customer_user_id = p_user
     and r.service_id = v_d.service_id
     and (r.status in ('publicado', 'selecionado')
          or r.published_at > p_now - make_interval(secs => (v_lim ->> 'dup_window_s')::integer))
     and extensions.st_dwithin(g.exact_point, v_pt_geo, (v_lim ->> 'dup_radius_m')::integer)
   order by r.published_at desc
   limit 1;
  if found and not p_ack then
    return query select 'duplicidade'::text, null::uuid, null::timestamptz, null::timestamptz,
                        v_sim_id, v_sim_em, v_sim_nome, null::text[];
    return;
  end if;

  insert into app.service_request (customer_user_id, origin_draft_id, service_id, status, urgency, description,
    address_text, first_name, geocode_point_id, published_at, acceptance_deadline_at, acceptances_count, version)
  values (p_user, v_d.id, v_d.service_id, 'publicado', v_d.urgency, v_d.description,
    v_d.address_text, v_d.first_name, p_point_id, p_now, p_now + interval '168 hours', 0, 1)
  returning * into v_req;

  update app.media_asset m
     set request_id = v_req.id
   where m.draft_id = v_d.id and m.status = 'ready' and m.confirmed_at is not null
     and m.purge_requested_at is null;
  get diagnostics v_fotos = row_count;

  update app.request_draft r
     set status = 'publicado', updated_at = p_now
   where r.id = v_d.id;

  if p_ack and v_sim_id is not null then
    insert into app.duplicate_ack (request_id, similar_request_id, confirmed_at)
    values (v_req.id, v_sim_id, p_now);
  end if;

  perform private.audit_append('customer:' || p_user::text, 'customer', 'request.published',
    'service_request', v_req.id, '{}'::jsonb,
    jsonb_build_object('status', 'publicado', 'photos', v_fotos, 'duplicate_ack', (p_ack and v_sim_id is not null)),
    null, null);

  if not private.request_publish_key_done(p_user, p_idem_key, 201, v_req.id::text, p_now,
                                          (v_lim ->> 'key_ttl_s')::integer) then
    raise exception 'publicacao_chave_perdida' using errcode = '55000';
  end if;

  return query select 'criado'::text, v_req.id, v_req.published_at, v_req.acceptance_deadline_at,
                      null::uuid, null::timestamptz, null::text, null::text[];
end
$$;
