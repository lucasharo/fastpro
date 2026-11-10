-- H-005 | Esqueleto transversal da plataforma: outbox de eventos, jobs com lease, idempotencia,
-- contador de taxa e configuracao. SEM logica de produto e SEM tabelas de dominio.
-- Idempotente. Desfazer: supabase/rollbacks/20261110130000_platform_create_outbox_jobs_idempotency.down.sql.
-- Fontes: 08 §7.5 (idempotencia), §7.6 (outbox), §15/ADR-014 (rate_counter); 09 §3.11.
-- NAO habilita pg_cron/pg_net (H-008 / S-10). Nenhum segredo e versionado.
--
-- Postura: todas as tabelas nascem com RLS habilitada E forcada e SEM politicas (nega tudo para
-- quem nao ignora a RLS). Nenhum privilegio para PUBLIC/anon/authenticated/service_role.
-- Somente o papel interno app_system (NOLOGIN, BYPASSRLS) recebe os privilegios minimos; o
-- papel app_api nao recebe nada nesta migracao (cada historia de consumo concede o que precisar).

-- 1. outbox_event (08 §7.6, 09 §3.11) ------------------------------------------------------------
-- Evento inserido na MESMA transacao da mudanca de dominio: so existe apos o COMMIT. Entrega
-- pelo menos uma vez, em ordem por agregado (aggregate_seq). Payload com IDs e tipos, sem PII.
create table if not exists ops.outbox_event (
  id             uuid primary key default gen_random_uuid(),  -- = event_id
  type           text not null check (type ~ '^[a-z][a-z0-9_.]{0,99}$'),
  version        integer not null default 1 check (version >= 1),
  aggregate_type text not null check (aggregate_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  aggregate_id   uuid not null,
  aggregate_seq  bigint not null check (aggregate_seq >= 1),
  occurred_at    timestamptz not null default now(),
  actor_ref      text,
  correlation_id uuid,
  payload        jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  dispatched_at  timestamptz,
  constraint outbox_event_aggregate_seq_key unique (aggregate_type, aggregate_id, aggregate_seq)
);
create index if not exists outbox_event_pending_idx
  on ops.outbox_event (occurred_at, id) where dispatched_at is null;
comment on table ops.outbox_event is
  'Outbox transacional (H-005). Payload sem PII. Entrega ao-menos-uma-vez; consumidor idempotente por id.';

-- 2. job com lease (08 §14, 09 §3.11) ------------------------------------------------------------
create table if not exists ops.job (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind ~ '^[a-z][a-z0-9_.]{0,99}$'),
  dedupe_key    text not null unique check (length(dedupe_key) between 1 and 200),
  run_at        timestamptz not null default now(),
  state         text not null default 'pendente'
                  check (state in ('pendente', 'em_execucao', 'concluido', 'falha')),
  lease_owner   text check (lease_owner is null or length(lease_owner) between 1 and 100),
  lease_until   timestamptz,
  attempts      integer not null default 0 check (attempts >= 0),
  max_attempts  integer not null default 5 check (max_attempts >= 1),
  payload_ref   text,   -- referencia (nunca PII nem o dado em si)
  last_error    text check (last_error is null or length(last_error) <= 100),  -- so codigo
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint job_lease_consistente check (
    (state = 'em_execucao') = (lease_owner is not null and lease_until is not null)
  )
);
create index if not exists job_state_run_at_idx
  on ops.job (state, run_at) where state in ('pendente', 'em_execucao');
comment on table ops.job is
  'Fila de jobs com lease (H-005). Reivindicacao por FOR UPDATE SKIP LOCKED; lease vencido e retomado.';

-- 3. idempotency_key (08 §7.5, 09 §3.11) ---------------------------------------------------------
create table if not exists ops.idempotency_key (
  principal_id      text not null check (length(principal_id) between 1 and 100),
  operation         text not null check (operation ~ '^[a-z][a-z0-9_.:]{0,99}$'),
  key               text not null check (length(key) between 8 and 128),
  request_hash      text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  state             text not null default 'em_andamento'
                      check (state in ('em_andamento', 'concluida')),
  response_status   integer check (response_status between 100 and 599),
  response_body_ref text,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  constraint idempotency_key_pkey primary key (principal_id, operation, key),
  constraint idempotency_resposta_consistente check (
    (state = 'concluida') = (response_status is not null)
  )
);
create index if not exists idempotency_key_expires_idx on ops.idempotency_key (expires_at);
comment on table ops.idempotency_key is
  'Registro de idempotencia (H-005): chave unica por (principal, operacao, chave). Expurgo por expires_at.';

-- 4. rate_counter (ADR-014): limites de baixa frequencia em Postgres -----------------------------
create table if not exists ops.rate_counter (
  key_hmac     text not null check (key_hmac ~ '^[0-9a-f]{64}$'),  -- HMAC; nunca IP/e-mail em claro
  window_start timestamptz not null,
  count        integer not null default 0 check (count >= 0),
  constraint rate_counter_pkey primary key (key_hmac, window_start)
);
create index if not exists rate_counter_window_idx on ops.rate_counter (window_start);
comment on table ops.rate_counter is
  'Contador de taxa por janela (H-005, ADR-014). Chave apenas como HMAC. Sem logica de limite aqui.';

-- 5. app_config (09 §3.11): parametros administraveis -----------------------------------------------
create table if not exists ops.app_config (
  key         text primary key check (key ~ '^[a-z][a-z0-9_.]{0,99}$'),
  value       jsonb not null,
  version     integer not null default 1 check (version >= 1),
  updated_by  text,
  updated_at  timestamptz not null default now()
);
comment on table ops.app_config is
  'Parametros administraveis (H-005). Sem valores semeados nesta migracao. Historico fica para historia propria.';

-- 6. Postura de seguranca: RLS habilitada e forcada, sem politicas ------------------------------
alter table ops.outbox_event     enable row level security;
alter table ops.outbox_event     force row level security;
alter table ops.job              enable row level security;
alter table ops.job              force row level security;
alter table ops.idempotency_key  enable row level security;
alter table ops.idempotency_key  force row level security;
alter table ops.rate_counter     enable row level security;
alter table ops.rate_counter     force row level security;
alter table ops.app_config       enable row level security;
alter table ops.app_config       force row level security;

revoke all on ops.outbox_event, ops.job, ops.idempotency_key, ops.rate_counter, ops.app_config
  from public, anon, authenticated, service_role;

-- 7. Funcoes utilitarias (esquema private; SECURITY INVOKER; search_path vazio) --------------------

-- 7.1 Enfileira job; devolve o id (o existente quando o dedupe_key ja existe).
create or replace function private.job_enqueue(
  p_kind text,
  p_dedupe_key text,
  p_run_at timestamptz default null,
  p_payload_ref text default null,
  p_max_attempts integer default 5
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into ops.job (kind, dedupe_key, run_at, payload_ref, max_attempts)
  values (p_kind, p_dedupe_key, coalesce(p_run_at, clock_timestamp()), p_payload_ref, p_max_attempts)
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  if v_id is null then
    select j.id into v_id from ops.job j where j.dedupe_key = p_dedupe_key;
  end if;
  return v_id;
end
$$;

-- 7.2 Reivindica ate p_limit jobs devidos (pendentes com run_at vencido, ou em execucao com lease
-- vencido), com lease de p_lease_seconds para p_owner. FOR UPDATE SKIP LOCKED: duas chamadas
-- concorrentes nunca recebem o mesmo job. Lease vencido sem tentativas restantes vira 'falha'.
create or replace function private.job_claim(
  p_owner text,
  p_kind text default null,
  p_lease_seconds integer default 60,
  p_limit integer default 1
) returns setof ops.job
language plpgsql
set search_path = ''
as $$
begin
  if p_owner is null or length(p_owner) not between 1 and 100 then
    raise exception 'p_owner invalido' using errcode = '22023';
  end if;
  if p_lease_seconds is null or p_lease_seconds <= 0 or p_limit is null or p_limit <= 0 then
    raise exception 'p_lease_seconds e p_limit devem ser positivos' using errcode = '22023';
  end if;

  update ops.job j
     set state = 'falha', lease_owner = null, lease_until = null,
         last_error = 'lease_expirado', updated_at = clock_timestamp()
   where j.id in (
     select x.id from ops.job x
      where x.state = 'em_execucao' and x.lease_until < clock_timestamp()
        and x.attempts >= x.max_attempts
        and (p_kind is null or x.kind = p_kind)
      for update skip locked);

  return query
  with candidato as (
    select x.id from ops.job x
     where (p_kind is null or x.kind = p_kind)
       and x.attempts < x.max_attempts
       and ((x.state = 'pendente' and x.run_at <= clock_timestamp())
            or (x.state = 'em_execucao' and x.lease_until < clock_timestamp()))
     order by x.run_at, x.id
     limit p_limit
     for update skip locked
  )
  update ops.job j
     set state = 'em_execucao',
         lease_owner = p_owner,
         lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds),
         attempts = j.attempts + 1,
         updated_at = clock_timestamp()
    from candidato c
   where j.id = c.id
  returning j.*;
end
$$;

-- 7.3 Conclui o job; so o dono atual do lease consegue (true) -- dono antigo recebe false.
create or replace function private.job_complete(p_id uuid, p_owner text)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  update ops.job
     set state = 'concluido', lease_owner = null, lease_until = null, last_error = null,
         updated_at = clock_timestamp()
   where id = p_id and state = 'em_execucao' and lease_owner = p_owner;
  return found;
end
$$;

-- 7.4 Registra falha: reagenda (pendente, run_at + espera) ou, sem tentativas, vira 'falha'.
create or replace function private.job_fail(
  p_id uuid,
  p_owner text,
  p_error_code text default 'erro',
  p_retry_seconds integer default 60
) returns boolean
language plpgsql
set search_path = ''
as $$
begin
  update ops.job
     set state = case when attempts >= max_attempts then 'falha' else 'pendente' end,
         run_at = case when attempts >= max_attempts then run_at
                       else clock_timestamp() + make_interval(secs => greatest(p_retry_seconds, 0)) end,
         lease_owner = null, lease_until = null,
         last_error = left(p_error_code, 100), updated_at = clock_timestamp()
   where id = p_id and state = 'em_execucao' and lease_owner = p_owner;
  return found;
end
$$;

-- 7.5 Inicia/consulta idempotencia (08 §7.5). Resultado (outcome):
--   nova          -> registrada agora (ou chave vencida reaproveitada); executar a operacao
--   repetida      -> mesma chave e mesmo corpo ja concluida; reenviar a resposta gravada
--   em_andamento  -> mesma chave e mesmo corpo ainda em execucao  => HTTP 409 + Retry-After
--   conflito      -> mesma chave com corpo diferente              => HTTP 422
create or replace function private.idempotency_begin(
  p_principal_id text,
  p_operation text,
  p_key text,
  p_request_hash text,
  p_ttl_seconds integer default 86400
) returns table (outcome text, response_status integer, response_body_ref text)
language plpgsql
set search_path = ''
as $$
declare
  r ops.idempotency_key%rowtype;
  v_try integer;
begin
  if p_ttl_seconds is null or p_ttl_seconds <= 0 then
    raise exception 'p_ttl_seconds deve ser positivo' using errcode = '22023';
  end if;
  for v_try in 1..3 loop
    insert into ops.idempotency_key (principal_id, operation, key, request_hash, expires_at)
    values (p_principal_id, p_operation, p_key, p_request_hash,
            clock_timestamp() + make_interval(secs => p_ttl_seconds))
    on conflict (principal_id, operation, key) do nothing;
    if found then
      return query select 'nova'::text, null::integer, null::text;
      return;
    end if;

    select k.* into r from ops.idempotency_key k
     where k.principal_id = p_principal_id and k.operation = p_operation and k.key = p_key
       for update;
    if not found then
      continue;  -- removida entre as duas consultas (expurgo): tenta de novo
    end if;

    if r.expires_at <= clock_timestamp() then
      update ops.idempotency_key k
         set request_hash = p_request_hash, state = 'em_andamento', response_status = null,
             response_body_ref = null, created_at = clock_timestamp(),
             expires_at = clock_timestamp() + make_interval(secs => p_ttl_seconds)
       where k.principal_id = p_principal_id and k.operation = p_operation and k.key = p_key;
      return query select 'nova'::text, null::integer, null::text;
      return;
    end if;
    if r.request_hash <> p_request_hash then
      return query select 'conflito'::text, null::integer, null::text;
      return;
    end if;
    if r.state = 'concluida' then
      return query select 'repetida'::text, r.response_status, r.response_body_ref;
      return;
    end if;
    return query select 'em_andamento'::text, null::integer, null::text;
    return;
  end loop;
  raise exception 'idempotency_begin: disputa persistente' using errcode = '40001';
end
$$;

-- 7.6 Conclui a idempotencia gravando a resposta (so se ainda em andamento).
create or replace function private.idempotency_complete(
  p_principal_id text,
  p_operation text,
  p_key text,
  p_response_status integer,
  p_response_body_ref text default null
) returns boolean
language plpgsql
set search_path = ''
as $$
begin
  update ops.idempotency_key
     set state = 'concluida', response_status = p_response_status,
         response_body_ref = p_response_body_ref
   where principal_id = p_principal_id and operation = p_operation and key = p_key
     and state = 'em_andamento';
  return found;
end
$$;

-- 8. Privilegios minimos -----------------------------------------------------------------------
revoke all on function
  private.job_enqueue(text, text, timestamptz, text, integer),
  private.job_claim(text, text, integer, integer),
  private.job_complete(uuid, text),
  private.job_fail(uuid, text, text, integer),
  private.idempotency_begin(text, text, text, text, integer),
  private.idempotency_complete(text, text, text, integer, text)
  from public, anon, authenticated, service_role;

-- Somente o papel interno de sistema (NOLOGIN, BYPASSRLS). Sem grants ao app_api.
grant usage on schema ops, private to app_system;
grant select, insert, update, delete on ops.outbox_event, ops.job, ops.idempotency_key,
  ops.rate_counter to app_system;
grant select, insert, update on ops.app_config to app_system;
grant execute on function
  private.job_enqueue(text, text, timestamptz, text, integer),
  private.job_claim(text, text, integer, integer),
  private.job_complete(uuid, text),
  private.job_fail(uuid, text, text, integer),
  private.idempotency_begin(text, text, text, text, integer),
  private.idempotency_complete(text, text, text, integer, text)
  to app_system;
