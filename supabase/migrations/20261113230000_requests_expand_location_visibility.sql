-- Issue 45 (H-032) | Visibilidade de localizacao: migracao EXPANSIVA M1 (docs/factory/127-DESENHO-H032.md, §4.1).
-- Acrescenta address_text_enc (bytea; cifra AES-256-GCM feita pela API) e public_label (rotulo "Cidade - UF").
-- address_text passa a aceitar nulo. A funcao request_publish_commit (Issue 44) NAO e editada e continua valendo ate M2.
-- Funcoes novas (todas security definer, search_path vazio, erro fixo):
--   private.request_publish_commit_enc, request_owner_get, request_visibility_guard, request_detail_professional,
--   request_address_legacy_list e request_address_backfill_set (estas duas so ate a M2 remover).
-- Unica alteracao em funcao da Issue 44: private.service_request_imutaveis_bu passa a aceitar a troca de address_text
-- de texto para nulo SO quando address_text_enc ja esta gravado (o backfill do banco de desenvolvimento precisa disso).
-- Todos os outros campos continuam imutaveis como antes. Idempotente.
-- Desfazer: supabase/rollbacks/20261113230000_requests_expand_location_visibility.down.sql.

-- 0. Guarda de pre-requisito: colunas usadas pelas funcoes novas. Sem ela, o erro apareceria so na chamada.
do $$
declare
  v_falta text;
begin
  select string_agg(x.s || '.' || x.t || '.' || x.c, ', ') into v_falta
    from (values
      ('app', 'service_request', 'id'),
      ('app', 'service_request', 'service_id'),
      ('app', 'service_request', 'status'),
      ('app', 'service_request', 'customer_user_id'),
      ('app', 'service_request', 'origin_draft_id'),
      ('app', 'service_request', 'geocode_point_id'),
      ('app', 'service_request', 'address_text'),
      ('app', 'service_request', 'description'),
      ('app', 'service_request', 'urgency'),
      ('app', 'service_request', 'first_name'),
      ('app', 'service_request', 'published_at'),
      ('app', 'service_request', 'acceptance_deadline_at'),
      ('app', 'service_request', 'acceptances_count'),
      ('app', 'service_request', 'version'),
      ('app', 'geocode_point', 'id'),
      ('app', 'geocode_point', 'subject_kind'),
      ('app', 'geocode_point', 'state'),
      ('app', 'geocode_point', 'match_lon'),
      ('app', 'geocode_point', 'match_lat'),
      ('app', 'geocode_point', 'match_cell'),
      ('app', 'geocode_point', 'match_grid_version'),
      ('app', 'professional_service', 'professional_id'),
      ('app', 'professional_service', 'service_id'),
      ('app', 'professional_service', 'modality'),
      ('app', 'professional_area', 'professional_id'),
      ('app', 'professional_area', 'geocode_point_id'),
      ('app', 'professional_area', 'radius_m'),
      ('app', 'professional_profile', 'user_id'),
      ('app', 'professional_profile', 'verification_status'),
      ('app', 'app_user', 'id'),
      ('app', 'app_user', 'status'),
      ('app', 'service', 'id'),
      ('app', 'service', 'name'),
      ('app', 'service', 'regulated')) as x(s, t, c)
   where not exists (
     select 1 from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = x.s and c.relname = x.t and a.attname = x.c and a.attnum > 0 and not a.attisdropped);
  if v_falta is not null then
    raise exception 'visibilidade_pre_requisito_ausente';
  end if;
end
$$;

-- 1. Colunas novas (nulas; nenhuma linha existente muda).
alter table app.service_request add column if not exists address_text_enc bytea;
alter table app.service_request add column if not exists public_label text;

alter table app.service_request drop constraint if exists service_request_endereco_enc_ck;
alter table app.service_request add constraint service_request_endereco_enc_ck
  check (address_text_enc is null or (octet_length(address_text_enc) between 30 and 1024 and get_byte(address_text_enc, 0) = 1));

alter table app.service_request drop constraint if exists service_request_public_label_ck;
alter table app.service_request add constraint service_request_public_label_ck
  check (public_label is null or (char_length(public_label) between 3 and 80 and public_label !~ '[0-9@]'));

-- 2. address_text passa a aceitar nulo; o pedido precisa ter um dos dois (em claro ou cifrado).
alter table app.service_request alter column address_text drop not null;

alter table app.service_request drop constraint if exists service_request_endereco_presente_ck;
alter table app.service_request add constraint service_request_endereco_presente_ck
  check (address_text is not null or address_text_enc is not null);

-- 3. Gatilho: o endereco cifrado e o rotulo, uma vez gravados, nao mudam. address_text so pode virar nulo junto da cifra.
create or replace function private.service_request_endereco_bu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.address_text_enc is not null and new.address_text_enc is distinct from old.address_text_enc)
     or (old.public_label is not null and new.public_label is distinct from old.public_label)
     or (new.address_text is distinct from old.address_text
         and not (old.address_text is not null and new.address_text is null and new.address_text_enc is not null)) then
    raise exception 'pedido_campo_imutavel' using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists service_request_endereco_bu on app.service_request;
create trigger service_request_endereco_bu
  before update on app.service_request
  for each row execute function private.service_request_endereco_bu();

-- 3b. Unica mudanca na funcao da Issue 44: a troca de address_text de texto para nulo passa so com a cifra gravada.
create or replace function private.service_request_imutaveis_bu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.id, new.customer_user_id, new.service_id, new.geocode_point_id, new.published_at, new.acceptance_deadline_at)
     is distinct from
     (old.id, old.customer_user_id, old.service_id, old.geocode_point_id, old.published_at, old.acceptance_deadline_at)
     or (new.origin_draft_id is distinct from old.origin_draft_id and new.origin_draft_id is not null)
     or new.first_name is distinct from old.first_name
     or new.urgency is distinct from old.urgency
     or new.description is distinct from old.description
     or (new.address_text is distinct from old.address_text
         and not (old.address_text is not null and new.address_text is null and new.address_text_enc is not null)) then
    raise exception 'pedido_campo_imutavel' using errcode = '23514';
  end if;
  return new;
end
$$;

-- 4. Publicacao com endereco cifrado. Corpo = request_publish_commit (20261113150000) com tres diferencas:
--    valida p_request_id e p_address_enc; grava id = p_request_id, address_text = null, cifra e rotulo.
create or replace function private.request_publish_commit_enc(
  p_user uuid,
  p_draft_id uuid,
  p_secret_hash text,
  p_idem_key text,
  p_body_hash text,
  p_content_rev integer,
  p_point_id uuid,
  p_ack boolean,
  p_now timestamptz,
  p_request_id uuid,
  p_address_enc bytea,
  p_public_label text)
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
     or p_content_rev is null or p_content_rev < 0 or p_point_id is null or p_ack is null or p_now is null
     or p_request_id is null or p_request_id = p_draft_id then
    raise exception 'publicacao_entrada_invalida' using errcode = '22023';
  end if;
  if p_address_enc is null or octet_length(p_address_enc) not between 30 and 1024 or get_byte(p_address_enc, 0) <> 1 then
    raise exception 'endereco_cifrado_invalido' using errcode = '22023';
  end if;
  if p_public_label is not null and (char_length(p_public_label) not between 3 and 80 or p_public_label ~ '[0-9@]') then
    raise exception 'rotulo_publico_invalido' using errcode = '22023';
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

  -- Ponto (110 §4.4.4): do mesmo assunto (rascunho), permanente, ok e com celula de casamento.
  select g.exact_point into v_pt_geo from app.geocode_point g
   where g.id = p_point_id and g.subject_kind = 'request' and g.subject_id = p_draft_id
     and g.state = 'ok' and g.geocode_mode = 'permanent' and g.match_cell is not null;
  v_pt_ok := found;
  if not v_pt_ok then
    return query select 'ponto_invalido'::text, null::uuid, null::timestamptz, null::timestamptz,
                        null::uuid, null::timestamptz, null::text, null::text[];
    return;
  end if;

  -- Duplicidade (110 §6): so pedidos do proprio cliente, mesmo servico, dentro do raio. Nunca bloqueia.
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

  insert into app.service_request (id, customer_user_id, origin_draft_id, service_id, status, urgency, description,
    address_text, address_text_enc, public_label, first_name, geocode_point_id, published_at, acceptance_deadline_at,
    acceptances_count, version)
  values (p_request_id, p_user, v_d.id, v_d.service_id, 'publicado', v_d.urgency, v_d.description,
    null, p_address_enc, p_public_label, v_d.first_name, p_point_id, p_now, p_now + interval '168 hours', 0, 1)
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

-- 5. Leitura do dono: zero linhas quando o pedido nao e do cliente. address_text so vem preenchido em linha legada.
create or replace function private.request_owner_get(p_user uuid, p_request_id uuid)
returns table (out_id uuid, out_status text, out_service_id uuid, out_service_name text, out_urgency text,
  out_description text, out_first_name text, out_address_text text, out_address_enc bytea, out_public_label text,
  out_published_at timestamptz, out_deadline_at timestamptz, out_acceptances_count integer)
language plpgsql
stable
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
begin
  if p_user is null or p_request_id is null then
    raise exception 'leitura_entrada_invalida' using errcode = '22023';
  end if;
  return query
    select r.id, r.status::text, r.service_id, s.name::text, r.urgency::text, r.description, r.first_name,
           r.address_text, r.address_text_enc, r.public_label, r.published_at, r.acceptance_deadline_at,
           r.acceptances_count
      from app.service_request r
      join app.service s on s.id = r.service_id
     where r.id = p_request_id
       and r.customer_user_id = p_user;
end
$$;

-- 6. Guarda de elegibilidade do profissional (Rodada 92, decisao 421): verificacao aprovada e conta ativa.
--    Acesso comercial vigente entra aqui quando a Issue 68 (H-055) existir. Ponto unico de extensao.
create or replace function private.request_visibility_guard(p_professional_id uuid, p_now timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_professional_id is null or p_now is null then
    raise exception 'visibilidade_parametro_invalido' using errcode = '22023';
  end if;
  return exists (
    select 1
      from app.professional_profile p
      join app.app_user u on u.id = p.user_id
     where p.user_id = p_professional_id
       and p.verification_status = 'aprovada'
       and u.status = 'ativo');
end
$$;

-- 7. Detalhe do profissional: um pedido, pela mesma regra de casamento da Issue 36 (discover_scan), sem coordenada.
--    Zero linhas quando: guarda falha, pedido inexistente, status <> publicado, prazo fechado, ou sem casamento.
--    Le match_lon/match_lat (centros de celula), nunca exact_point. Distancia: centros de celula, para cima em 0,5 km.
create or replace function private.request_detail_professional(
  p_professional_id uuid,
  p_request_id uuid,
  p_now timestamptz)
returns table (out_id uuid, out_service_id uuid, out_service_name text, out_urgency text, out_description text,
  out_public_label text, out_distance_km numeric, out_modality text, out_published_at timestamptz,
  out_deadline_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  v_req app.service_request%rowtype;
  v_svc_nome text;
  v_regulado boolean;
  v_pres boolean;
  v_onl_bruto boolean;
  v_onl boolean;
  v_base_lon double precision;
  v_base_lat double precision;
  v_raio integer;
  v_pt_lon double precision;
  v_pt_lat double precision;
  v_dist double precision;
  v_km numeric;
  v_mod text;
begin
  if p_professional_id is null or p_request_id is null or p_now is null then
    raise exception 'visibilidade_parametro_invalido' using errcode = '22023';
  end if;
  if not private.request_visibility_guard(p_professional_id, p_now) then
    return;
  end if;

  select r.* into v_req
    from app.service_request r
   where r.id = p_request_id
     and r.status = 'publicado'
     and p_now < r.acceptance_deadline_at;
  if not found then
    return;
  end if;

  select s.name, s.regulated into v_svc_nome, v_regulado
    from app.service s
   where s.id = v_req.service_id;

  select bool_or(ps.modality = 'presencial'), bool_or(ps.modality = 'online')
    into v_pres, v_onl_bruto
    from app.professional_service ps
   where ps.professional_id = p_professional_id
     and ps.service_id = v_req.service_id;
  v_pres := coalesce(v_pres, false);
  v_onl := coalesce(v_onl_bruto, false) and not coalesce(v_regulado, true);

  if v_pres then
    select g.match_lon, g.match_lat, pa.radius_m into v_base_lon, v_base_lat, v_raio
      from app.professional_area pa
      join app.geocode_point g on g.id = pa.geocode_point_id
     where pa.professional_id = p_professional_id
       and g.subject_kind = 'professional_base'
       and g.state = 'ok'
       and g.match_grid_version = 1;

    select g.match_lon, g.match_lat into v_pt_lon, v_pt_lat
      from app.geocode_point g
     where g.id = v_req.geocode_point_id
       and g.subject_kind = 'request'
       and g.state = 'ok'
       and g.match_grid_version = 1;

    if v_base_lon is not null and v_pt_lon is not null then
      v_dist := 2 * 6371008.8 * asin(least(1::float8, sqrt(
                  power(sin(radians(v_pt_lat - v_base_lat) / 2), 2)
                + cos(radians(v_base_lat)) * cos(radians(v_pt_lat)) * power(sin(radians(v_pt_lon - v_base_lon) / 2), 2))));
    end if;
  end if;

  if v_pres and v_dist is not null and v_dist <= v_raio then
    v_mod := 'presencial';
    v_km := round(greatest(0.5::float8, ceil(v_dist / 500.0) * 0.5)::numeric, 1);
  elsif v_onl then
    v_mod := 'online';
    v_km := null;
  else
    return;
  end if;

  return query
    select v_req.id, v_req.service_id, v_svc_nome, v_req.urgency::text, v_req.description, v_req.public_label,
           v_km, v_mod, v_req.published_at, v_req.acceptance_deadline_at;
end
$$;

-- 8. Backfill do banco de desenvolvimento (so ate a M2): le lote de texto em claro e grava a cifra.
create or replace function private.request_address_legacy_list(p_limit integer)
returns table (out_request_id uuid, out_address_text text)
language plpgsql
stable
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'backfill_parametro_invalido' using errcode = '22023';
  end if;
  return query
    select r.id, r.address_text
      from app.service_request r
     where r.address_text is not null
       and r.address_text_enc is null
     order by r.id
     limit p_limit;
end
$$;

create or replace function private.request_address_backfill_set(p_request_id uuid, p_enc bytea)
returns boolean
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
begin
  if p_request_id is null or p_enc is null or octet_length(p_enc) not between 30 and 1024 or get_byte(p_enc, 0) <> 1 then
    raise exception 'endereco_cifrado_invalido' using errcode = '22023';
  end if;
  update app.service_request r
     set address_text_enc = p_enc,
         address_text = null
   where r.id = p_request_id
     and r.address_text is not null
     and r.address_text_enc is null;
  return found;
end
$$;

-- 9. Privilegios: nenhuma funcao nova e executavel por anon, authenticated, service_role, app_api ou app_backup_reader.
--    So app_system executa. Sem grant em tabela (RLS forcada e sem politica, como na Issue 44).
revoke all on function private.request_publish_commit_enc(uuid, uuid, text, text, text, integer, uuid, boolean, timestamptz, uuid, bytea, text)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.request_owner_get(uuid, uuid)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.request_visibility_guard(uuid, timestamptz)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.request_detail_professional(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.request_address_legacy_list(integer)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.request_address_backfill_set(uuid, bytea)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;

grant execute on function private.request_publish_commit_enc(uuid, uuid, text, text, text, integer, uuid, boolean, timestamptz, uuid, bytea, text) to app_system;
grant execute on function private.request_owner_get(uuid, uuid) to app_system;
grant execute on function private.request_detail_professional(uuid, uuid, timestamptz) to app_system;
grant execute on function private.request_address_legacy_list(integer) to app_system;
grant execute on function private.request_address_backfill_set(uuid, bytea) to app_system;
