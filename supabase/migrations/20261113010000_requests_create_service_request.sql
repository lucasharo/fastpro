-- H-031 (Issue #44) | Publicacao idempotente do pedido (docs/factory/110-DESENHO-H031.md, §4).
-- Expansao pura: tabelas, gatilhos e funcoes novas; uma coluna nula em app.media_asset; uma chave em ops.app_config.
-- Idempotente. Desfazer: supabase/rollbacks/20261113010000_requests_create_service_request.down.sql.
-- Nada publica sozinho: so request_publish_commit cria pedido. Sem coordenada em app.service_request
-- (a coordenada vive em app.geocode_point, decisao 233). Sem grant a app_api: so app_system executa.

-- 0. Parametros administraveis (D-09, decisao 240). Revalidados em private.request_publish_limits().
insert into ops.app_config (key, value, version, updated_by)
values (
  'publish.limits',
  '{"user_max":5,"user_window_s":3600,"ip_max":20,"ip_window_s":86400,"dup_radius_m":100,"dup_window_s":86400,"ack_ttl_s":300,"lease_s":120,"key_ttl_s":86400}'::jsonb,
  1,
  'migration:20261113010000')
on conflict (key) do nothing;

-- 1. Pedido (§4.1). O id e novo (RN-03); origin_draft_id e unico (um pedido por rascunho, decisao 236).
create table if not exists app.service_request (
  id                     uuid primary key default gen_random_uuid(),
  customer_user_id       uuid not null references app.app_user (id) on delete restrict,
  origin_draft_id        uuid unique references app.request_draft (id) on delete set null,
  service_id             uuid not null references app.service (id) on delete restrict,
  status                 text not null default 'publicado'
                           check (status in ('publicado', 'selecionado', 'concluido', 'cancelado')),
  urgency                text not null
                           check (urgency in ('imediato', 'proximas_semanas', 'proximo_mes', 'nao_definido')),
  description            text not null check (char_length(description) between 1 and 2000),
  address_text           text not null check (char_length(address_text) between 3 and 200),
  first_name             text not null check (char_length(first_name) between 2 and 60),
  geocode_point_id       uuid not null unique references app.geocode_point (id) on delete restrict,
  published_at           timestamptz not null,
  acceptance_deadline_at timestamptz not null,
  acceptances_count      integer not null default 0 check (acceptances_count >= 0),
  wave2_opened_at        timestamptz check (wave2_opened_at is null or wave2_opened_at >= published_at),
  version                integer not null default 1 check (version >= 1),
  is_republication       boolean not null default false,
  chain_id               uuid,
  republished_from_id    uuid references app.service_request (id) on delete restrict,
  created_at             timestamptz not null default clock_timestamp(),
  constraint service_request_prazo_168h
    check (acceptance_deadline_at = published_at + interval '168 hours')
);

comment on table app.service_request is
  'Pedido publicado (H-031, #44). Prazo de aceites absoluto de 168 h (RF-015, I-07). Coordenada so em app.geocode_point.';

-- Indices (CA-18). O da #36 e (service_id, status, acceptance_deadline_at); o da #47 e (customer_user_id, status).
create index if not exists service_request_busca_idx
  on app.service_request (service_id, status, acceptance_deadline_at);
create index if not exists service_request_cliente_status_idx
  on app.service_request (customer_user_id, status);
create index if not exists service_request_duplicidade_idx
  on app.service_request (customer_user_id, service_id, published_at desc);

-- 2. Aviso de duplicidade confirmado (§4.2, AMB-01). Medicao para recalibrar (ADR-015).
create table if not exists app.duplicate_ack (
  id                  uuid primary key default gen_random_uuid(),
  request_id          uuid not null references app.service_request (id) on delete restrict,
  similar_request_id  uuid not null references app.service_request (id) on delete restrict,
  confirmed_at        timestamptz not null
);

-- 3. Fotos do rascunho ligadas ao pedido (§4.3, D-13, decisao 252).
alter table app.media_asset
  add column if not exists request_id uuid references app.service_request (id) on delete restrict;
create index if not exists media_asset_pedido_idx
  on app.media_asset (request_id) where request_id is not null;

-- 4. Gatilhos de integridade do pedido (§4.1).
-- 4a. Insercao: ponto do mesmo rascunho, permanente, ok e com celula de casamento. Vale tambem para SQL direto.
create or replace function private.service_request_ponto_bi()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'publicado' then
    raise exception 'pedido_ponto_invalido' using errcode = '23514';
  end if;
  if not exists (
    select 1 from app.geocode_point g
     where g.id = new.geocode_point_id
       and g.subject_kind = 'request'
       and g.subject_id = new.origin_draft_id
       and g.state = 'ok'
       and g.geocode_mode = 'permanent'
       and g.match_cell is not null
  ) then
    raise exception 'pedido_ponto_invalido' using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists service_request_ponto_bi on app.service_request;
create trigger service_request_ponto_bi
  before insert on app.service_request
  for each row execute function private.service_request_ponto_bi();

-- 4b. Atualizacao: campos de identidade e de prazo sao imutaveis. Unica excecao: origin_draft_id pode ir para nulo
--     quando o rascunho e expurgado (on delete set null, A5). status, version, acceptances_count, wave2_opened_at ficam livres.
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
     or new.address_text is distinct from old.address_text then
    raise exception 'pedido_campo_imutavel' using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists service_request_imutaveis_bu on app.service_request;
create trigger service_request_imutaveis_bu
  before update on app.service_request
  for each row execute function private.service_request_imutaveis_bu();

-- 4c. Pedido nao se apaga (retencao e DSR definem o caminho seguro, ADR-016).
create or replace function private.service_request_sem_delete_bd()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'pedido_nao_apagavel' using errcode = '23514';
end
$$;

drop trigger if exists service_request_sem_delete_bd on app.service_request;
create trigger service_request_sem_delete_bd
  before delete on app.service_request
  for each row execute function private.service_request_sem_delete_bd();

-- 5. Postura de seguranca: RLS habilitada e forcada, sem politicas; nenhum papel acessa a tabela direto.
alter table app.service_request enable row level security;
alter table app.service_request force row level security;
alter table app.duplicate_ack enable row level security;
alter table app.duplicate_ack force row level security;

revoke all on app.service_request, app.duplicate_ack
  from public, anon, authenticated, service_role, app_api, app_system;

-- 6. Funcoes auxiliares (todas security definer, search_path vazio; execute so para app_system).
create or replace function private.request_publish_cfg_int(p_value jsonb, p_field text, p_min integer, p_max integer, p_default integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    case when p_value is not null
          and jsonb_typeof(p_value -> p_field) = 'number'
          and (p_value ->> p_field)::numeric between p_min and p_max
          and (p_value ->> p_field)::numeric = trunc((p_value ->> p_field)::numeric)
         then ((p_value ->> p_field)::numeric)::integer
    end,
    p_default)
$$;

create or replace function private.request_publish_limits()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'user_max',      private.request_publish_cfg_int(c.value, 'user_max', 1, 100, 5),
    'user_window_s', private.request_publish_cfg_int(c.value, 'user_window_s', 60, 86400, 3600),
    'ip_max',        private.request_publish_cfg_int(c.value, 'ip_max', 1, 1000, 20),
    'ip_window_s',   private.request_publish_cfg_int(c.value, 'ip_window_s', 3600, 604800, 86400),
    'dup_radius_m',  private.request_publish_cfg_int(c.value, 'dup_radius_m', 10, 1000, 100),
    'dup_window_s',  private.request_publish_cfg_int(c.value, 'dup_window_s', 3600, 604800, 86400),
    'ack_ttl_s',     private.request_publish_cfg_int(c.value, 'ack_ttl_s', 30, 3600, 300),
    'lease_s',       private.request_publish_cfg_int(c.value, 'lease_s', 10, 600, 120),
    'key_ttl_s',     private.request_publish_cfg_int(c.value, 'key_ttl_s', 3600, 604800, 86400))
  from (select 1) s
  left join ops.app_config c on c.key = 'publish.limits'
$$;

-- Campos faltando, na ordem de DRAFT_REVIEW_FIELDS. COPIA da regra de draft_confirm (#43), que nao e tocada.
-- O teste T-DB09 (paridade) trava a divergencia.
create or replace function private.request_publish_missing(p_draft app.request_draft)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ativo boolean;
  v_faltam text[] := array[]::text[];
begin
  select s.active into v_ativo from app.service s where s.id = p_draft.service_id;
  if p_draft.service_id is null or coalesce(v_ativo, false) = false then
    v_faltam := array_append(v_faltam, 'service_id');
  end if;
  if p_draft.address_text is null or p_draft.address_text ~ '^\s*$' then
    v_faltam := array_append(v_faltam, 'address_text');
  end if;
  if p_draft.urgency is null then
    v_faltam := array_append(v_faltam, 'urgency');
  end if;
  if p_draft.description is null or p_draft.description ~ '^\s*$' then
    v_faltam := array_append(v_faltam, 'description');
  end if;
  if p_draft.first_name is null or p_draft.first_name ~ '^\s*$' then
    v_faltam := array_append(v_faltam, 'first_name');
  end if;
  if p_draft.email is null or p_draft.email ~ '^\s*$' then
    v_faltam := array_append(v_faltam, 'email');
  end if;
  return v_faltam;
end
$$;

-- Recusas baratas de §3.1 (ordem fixa). Codigo nulo = pode publicar. Nao escreve nada.
create or replace function private.request_publish_recusa(
  p_user uuid, p_draft app.request_draft, p_content_rev integer, p_now timestamptz)
returns table (out_code text, out_missing text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_email text;
  v_verificado timestamptz;
  v_faltam text[];
  v_fotos integer;
begin
  select u.status, u.email, u.email_verified_at into v_status, v_email, v_verificado
    from app.app_user u where u.id = p_user;
  if not found or v_status <> 'ativo' then
    return query select 'sessao_necessaria'::text, null::text[];
    return;
  end if;
  if v_verificado is null or p_draft.status <> 'aberto' or p_draft.email_verified_at is null then
    return query select 'email_nao_confirmado'::text, null::text[];
    return;
  end if;
  if lower(p_draft.email) <> v_email then
    return query select 'email_divergente'::text, null::text[];
    return;
  end if;
  v_faltam := private.request_publish_missing(p_draft);
  if cardinality(v_faltam) > 0 then
    return query select 'campos_faltando'::text, v_faltam;
    return;
  end if;
  if p_content_rev <> p_draft.content_rev then
    return query select 'conteudo_alterado'::text, null::text[];
    return;
  end if;
  if p_draft.confirmed_at is null then
    return query select 'nao_confirmado'::text, null::text[];
    return;
  end if;
  select count(*) into v_fotos
    from app.media_asset m
   where m.draft_id = p_draft.id
     and m.status = 'pending'
     and m.purge_requested_at is null
     and coalesce(m.pending_expires_at > p_now, true);
  if v_fotos > 0 then
    return query select 'fotos_em_processamento'::text, null::text[];
    return;
  end if;
  return query select null::text, null::text[];
end
$$;

-- Libera a chave que a propria chamada abriu (em_andamento, mesmo hash). Idempotente.
create or replace function private.request_publish_abort(p_user uuid, p_idem_key text, p_body_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
begin
  delete from ops.idempotency_key k
   where k.principal_id = p_user::text
     and k.operation = 'request.publish'
     and k.key = p_idem_key
     and k.state = 'em_andamento'
     and k.request_hash = p_body_hash;
  return found;
end
$$;

-- Conclui a chave com o status e a referencia e prorroga o prazo da resposta guardada.
create or replace function private.request_publish_key_done(
  p_user uuid, p_idem_key text, p_status integer, p_ref text, p_now timestamptz, p_ttl integer)
returns boolean
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
begin
  if not private.idempotency_complete(p_user::text, 'request.publish', p_idem_key, p_status, p_ref) then
    return false;
  end if;
  update ops.idempotency_key k
     set expires_at = p_now + make_interval(secs => p_ttl)
   where k.principal_id = p_user::text and k.operation = 'request.publish' and k.key = p_idem_key;
  return true;
end
$$;

-- 7. Begin (§4.4.3): trava o rascunho, abre a chave, confere o barato e consome a cota. Sem chamada paga.
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

-- 8. Commit (§4.4.4): uma transacao. Reconfere tudo, valida o ponto, procura duplicidade, cria o pedido.
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
     or (v_d.status <> 'publicado' and v_d.expires_at <= p_now) then
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

-- 9. Catalogo de auditoria (§4.5, decisao 259): o papel do cliente e 'customer'; so contagens e booleano.
insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('request.published', 'service_request', false,
   array['status', 'photos', 'duplicate_ack'],
   'Pedido publicado pelo cliente (H-031, sem endereco, ponto, e-mail ou nome)')
on conflict (action, object_type) do nothing;

-- 10. Privilegios: execute so para app_system. Nenhum grant a app_api, anon, authenticated, service_role.
revoke all on function
  private.request_publish_cfg_int(jsonb, text, integer, integer, integer),
  private.request_publish_limits(),
  private.request_publish_missing(app.request_draft),
  private.request_publish_recusa(uuid, app.request_draft, integer, timestamptz),
  private.request_publish_abort(uuid, text, text),
  private.request_publish_key_done(uuid, text, integer, text, timestamptz, integer),
  private.request_publish_begin(uuid, uuid, text, text, text, integer, text, text, timestamptz),
  private.request_publish_commit(uuid, uuid, text, text, text, integer, uuid, boolean, timestamptz),
  private.service_request_ponto_bi(),
  private.service_request_imutaveis_bu(),
  private.service_request_sem_delete_bd()
  from public, anon, authenticated, service_role, app_api;

grant execute on function
  private.request_publish_begin(uuid, uuid, text, text, text, integer, text, text, timestamptz),
  private.request_publish_commit(uuid, uuid, text, text, text, integer, uuid, boolean, timestamptz),
  private.request_publish_abort(uuid, text, text)
  to app_system;
