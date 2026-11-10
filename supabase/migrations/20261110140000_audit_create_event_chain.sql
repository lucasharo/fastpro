-- H-006 | Auditoria append-only com hash encadeado: audit.audit_event, audit.chain_head,
-- audit.action_catalog e funcoes private.audit_append / private.audit_verify_chain.
-- Idempotente. Desfazer: supabase/rollbacks/20261110140000_audit_create_event_chain.down.sql (manual, so em dev).
-- Fontes: docs/factory/23-DESENHO-H006.md (desenho aprovado), 22-REFINO-H006.md (CA-01..CA-14);
-- 08 §4.2, §7, §13; 09 audit_event; ADR-012; I-15.
--
-- Postura: tabelas com RLS habilitada E forcada, SEM politicas; nenhum privilegio para
-- PUBLIC/anon/authenticated/service_role. Unica porta de escrita: private.audit_append (SECURITY
-- DEFINER). O proprio banco sela cada linha (trigger BEFORE INSERT): seq, at, prev_hash, row_hash.
-- Append-only em 3 camadas: sem privilegio de UPDATE/DELETE/TRUNCATE, triggers ENABLE ALWAYS que
-- bloqueiam (AU001) ate para o dono, e deteccao por hash (private.audit_verify_chain).
-- Codigos: AU001 = mutacao proibida; AU002 = evento invalido (catalogo, estado com PII, razao).
-- Nenhum segredo e versionado. Mensagens de erro nunca incluem valores do estado (sem PII).

-- 1. Predicados puros (IMMUTABLE) para o estado sem PII (CA-09) -------------------------------------
-- Chave proibida: termos longos por substring da chave normalizada (sem _ . -); termos curtos ou
-- ambiguos (ip, rg, lat, name, text...) apenas quando sao a PRIMEIRA ou a ULTIMA palavra da chave
-- (user_name, ip_address) -- assim "consent_text_version" e "until_at" nao sao falsos positivos.
create or replace function private.audit_key_is_forbidden(p_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_key is null
      or regexp_replace(lower(p_key), '[_.-]', '', 'g') ~
         '(email|mail|telefone|phone|celular|whatsapp|cpf|cnpj|documento|endereco|address|logradouro|latitude|longitude|useragent|mensagem|message|senha|password|token|secret|birth|nascimento)'
      or (regexp_split_to_array(lower(p_key), '[_.-]+'))[1] = any (array[
           'rg','nome','name','cep','lat','lng','ip','texto','text','body','conteudo','content'])
      or (regexp_split_to_array(lower(p_key), '[_.-]+'))[
           cardinality(regexp_split_to_array(lower(p_key), '[_.-]+'))] = any (array[
           'rg','nome','name','cep','lat','lng','ip','texto','text','body','conteudo','content'])
$$;

create or replace function private.audit_keys_are_clean(p_keys text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_keys is not null
     and not exists (select 1 from unnest(p_keys) as k where private.audit_key_is_forbidden(k))
$$;

-- Estado valido: objeto plano; valores escalares; strings ate 64 caracteres no alfabeto
-- [A-Za-z0-9_.:-] (sem @, espaco, +, /), nao so-digitos de 10 a 15 (telefone/CPF/CNPJ) nem CPF
-- mascarado; nenhuma chave proibida.
create or replace function private.audit_state_is_valid(p_state jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_state is null or jsonb_typeof(p_state) <> 'object' then false
    else not exists (
      select 1 from jsonb_each(p_state) as e
       where jsonb_typeof(e.value) in ('object', 'array')
          or private.audit_key_is_forbidden(e.key)
          or (jsonb_typeof(e.value) = 'string' and (
                length(e.value #>> '{}') > 64
             or (e.value #>> '{}') !~ '^[A-Za-z0-9_.:-]*$'
             or (e.value #>> '{}') ~ '^[0-9]{10,15}$'
             or (e.value #>> '{}') ~ '^[0-9]{3}[.][0-9]{3}[.][0-9]{3}-[0-9]{2}$'))
    )
  end
$$;

-- 2. Hash encadeado (CA-08): SHA-256 nativo, entrada versionada (hash_version = 1) ------------------
-- Estado canonico: chaves em ordem bytewise (COLLATE "C"); '{' + chave_json ':' valor_json ... + '}'.
create or replace function private.audit_canonical_state(p_state jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select '{' || coalesce(
           (select string_agg(to_json(k)::text || ':' || (p_state -> k)::text, ',' order by k collate "C")
              from jsonb_object_keys(p_state) as k), '') || '}'
$$;

-- Campos (separados por \n): 'v'||versao, seq, id, at (UTC, microssegundos), actor_ref, actor_role,
-- action, object_type, object_id, estado antes, estado depois, reason_code, correlation_id, prev_hash.
create or replace function private.audit_row_hash(
  p_hash_version smallint,
  p_seq bigint,
  p_id uuid,
  p_at timestamptz,
  p_actor_ref text,
  p_actor_role text,
  p_action text,
  p_object_type text,
  p_object_id uuid,
  p_before_state jsonb,
  p_after_state jsonb,
  p_reason_code text,
  p_correlation_id uuid,
  p_prev_hash text
) returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    sha256(convert_to(concat_ws(E'\n',
      'v' || p_hash_version::text,
      p_seq::text,
      p_id::text,
      to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      p_actor_ref,
      p_actor_role,
      p_action,
      p_object_type,
      p_object_id::text,
      private.audit_canonical_state(p_before_state),
      private.audit_canonical_state(p_after_state),
      coalesce(p_reason_code, ''),
      coalesce(p_correlation_id::text, ''),
      p_prev_hash), 'UTF8')),
    'hex')
$$;

-- 3. Catalogo de acoes (CA-14) ----------------------------------------------------------------------
-- Alterado SOMENTE por migracao. state_keys = chaves permitidas em before/after_state.
create table if not exists audit.action_catalog (
  action          text primary key
                    constraint action_catalog_action_fmt check (action ~ '^[a-z][a-z0-9_.]{0,99}$'),
  object_type     text not null
                    constraint action_catalog_object_type_fmt check (object_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  reason_required boolean not null,
  state_keys      text[] not null
                    constraint action_catalog_state_keys_clean check (private.audit_keys_are_clean(state_keys)),
  active          boolean not null default true,
  description     text,
  constraint action_catalog_action_object_type_key unique (action, object_type)
);
comment on table audit.action_catalog is
  'Catalogo de acoes auditaveis (H-006). Alterado so por migracao; state_keys e a allowlist do estado.';

-- 4. Cabeca da cadeia (1 linha; travada FOR UPDATE ate o COMMIT) ------------------------------------
create table if not exists audit.chain_head (
  id         boolean primary key default true constraint chain_head_unica check (id),
  last_seq   bigint not null default 0 check (last_seq >= 0),
  last_hash  char(64) not null default repeat('0', 64) check (last_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz
);
comment on table audit.chain_head is
  'Cabeca da cadeia de auditoria (H-006): ultima seq e ultimo row_hash. Uma unica linha.';
insert into audit.chain_head (id) values (true) on conflict (id) do nothing;

-- 5. Evento de auditoria ------------------------------------------------------------------------------
create table if not exists audit.audit_event (
  id             uuid primary key default gen_random_uuid(),
  seq            bigint not null constraint audit_event_seq_key unique
                   constraint audit_event_seq_pos check (seq >= 1),
  at             timestamptz not null,
  actor_ref      text not null constraint audit_event_actor_ref_fmt
                   check (actor_ref ~ '^(customer|professional|admin|system):[A-Za-z0-9_-]{1,64}$'),
  actor_role     text not null constraint audit_event_actor_role_fmt
                   check (actor_role ~ '^[a-z][a-z0-9_]{0,31}$'),
  action         text not null,
  object_type    text not null constraint audit_event_object_type_fmt
                   check (object_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  object_id      uuid not null,
  before_state   jsonb not null constraint audit_event_before_state_ok
                   check (private.audit_state_is_valid(before_state) and pg_column_size(before_state) <= 4096),
  after_state    jsonb not null constraint audit_event_after_state_ok
                   check (private.audit_state_is_valid(after_state) and pg_column_size(after_state) <= 4096),
  reason_code    text constraint audit_event_reason_code_fmt
                   check (reason_code is null or reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  correlation_id uuid,
  hash_version   smallint not null default 1,
  prev_hash      char(64) not null constraint audit_event_prev_hash_fmt check (prev_hash ~ '^[0-9a-f]{64}$'),
  row_hash       char(64) not null constraint audit_event_row_hash_key unique
                   constraint audit_event_row_hash_fmt check (row_hash ~ '^[0-9a-f]{64}$'),
  constraint audit_event_system_actor check ((actor_ref like 'system:%') = (actor_role = 'system')),
  constraint audit_event_action_fk foreign key (action, object_type)
    references audit.action_catalog (action, object_type) on delete restrict
);
create index if not exists audit_event_object_idx on audit.audit_event (object_type, object_id, at);
create index if not exists audit_event_actor_idx on audit.audit_event (actor_ref, at);
comment on table audit.audit_event is
  'Auditoria append-only com hash encadeado (H-006). Escrita so por private.audit_append; sem PII.';

-- 6. Postura de seguranca: RLS habilitada e forcada, sem politicas -----------------------------------
alter table audit.action_catalog enable row level security;
alter table audit.action_catalog force row level security;
alter table audit.chain_head     enable row level security;
alter table audit.chain_head     force row level security;
alter table audit.audit_event    enable row level security;
alter table audit.audit_event    force row level security;

revoke all on audit.action_catalog, audit.chain_head, audit.audit_event
  from public, anon, authenticated, service_role, app_api, app_system;

-- 7. Triggers -------------------------------------------------------------------------------------------

-- 7.1 Bloqueio de UPDATE/DELETE/TRUNCATE (inclusive para o dono). Sem valores na mensagem.
create or replace function audit.tg_block_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'auditoria append-only: % em %.% e proibido', tg_op, tg_table_schema, tg_table_name
    using errcode = 'AU001';
end
$$;

-- 7.2 chain_head: so avanca de 1 em 1.
create or replace function audit.tg_head_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.last_seq <> old.last_seq + 1 then
    raise exception 'auditoria: chain_head so avanca em +1' using errcode = 'AU001';
  end if;
  return new;
end
$$;

-- 7.3 Selagem: valida catalogo, razao e estado; trava a cabeca; atribui seq, at, prev_hash, row_hash
-- (valores enviados pelo chamador sao sobrescritos) e avanca a cabeca na mesma transacao.
create or replace function audit.tg_event_seal()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cat  audit.action_catalog%rowtype;
  v_head audit.chain_head%rowtype;
begin
  if new.action is null or new.object_type is null then
    return new;  -- NOT NULL rejeita a linha logo apos o trigger
  end if;

  select c.* into v_cat from audit.action_catalog c
   where c.action = new.action and c.object_type = new.object_type and c.active;
  if not found then
    raise exception 'auditoria: acao/objeto fora do catalogo' using errcode = 'AU002';
  end if;
  if v_cat.reason_required and new.reason_code is null then
    raise exception 'auditoria: reason_code obrigatorio para a acao' using errcode = 'AU002';
  end if;
  if not private.audit_state_is_valid(new.before_state)
     or not private.audit_state_is_valid(new.after_state) then
    raise exception 'auditoria: estado invalido ou com dado pessoal' using errcode = 'AU002';
  end if;
  if exists (select 1 from jsonb_object_keys(new.before_state) as k where k <> all (v_cat.state_keys))
     or exists (select 1 from jsonb_object_keys(new.after_state) as k where k <> all (v_cat.state_keys)) then
    raise exception 'auditoria: chave de estado fora da allowlist da acao' using errcode = 'AU002';
  end if;

  select h.* into v_head from audit.chain_head h where h.id for update;

  new.seq          := v_head.last_seq + 1;
  new.at           := greatest(clock_timestamp(), coalesce(v_head.updated_at, clock_timestamp()));
  new.hash_version := 1;
  new.prev_hash    := v_head.last_hash;
  new.row_hash     := private.audit_row_hash(
    new.hash_version, new.seq, new.id, new.at, new.actor_ref, new.actor_role, new.action,
    new.object_type, new.object_id, new.before_state, new.after_state, new.reason_code,
    new.correlation_id, new.prev_hash);

  update audit.chain_head h
     set last_seq = new.seq, last_hash = new.row_hash, updated_at = new.at
   where h.id;
  return new;
end
$$;

drop trigger if exists tg_event_seal on audit.audit_event;
create trigger tg_event_seal before insert on audit.audit_event
  for each row execute function audit.tg_event_seal();
drop trigger if exists tg_block_mutation on audit.audit_event;
create trigger tg_block_mutation before update or delete on audit.audit_event
  for each row execute function audit.tg_block_mutation();
drop trigger if exists tg_block_truncate on audit.audit_event;
create trigger tg_block_truncate before truncate on audit.audit_event
  for each statement execute function audit.tg_block_mutation();

drop trigger if exists tg_head_guard on audit.chain_head;
create trigger tg_head_guard before update on audit.chain_head
  for each row execute function audit.tg_head_guard();
drop trigger if exists tg_block_delete on audit.chain_head;
create trigger tg_block_delete before delete on audit.chain_head
  for each row execute function audit.tg_block_mutation();
drop trigger if exists tg_block_truncate on audit.chain_head;
create trigger tg_block_truncate before truncate on audit.chain_head
  for each statement execute function audit.tg_block_mutation();

-- ENABLE ALWAYS: dispara tambem com session_replication_role = replica.
alter table audit.audit_event enable always trigger tg_event_seal;
alter table audit.audit_event enable always trigger tg_block_mutation;
alter table audit.audit_event enable always trigger tg_block_truncate;
alter table audit.chain_head  enable always trigger tg_head_guard;
alter table audit.chain_head  enable always trigger tg_block_delete;
alter table audit.chain_head  enable always trigger tg_block_truncate;

-- 8. Semente do catalogo (CA-14). Chaves sao PROPOSTA e podem ser ampliadas por migracao --------------
insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('professional.suspended', 'professional_profile', true,
   array['status','suspension_kind','until_at','approval_request_id'], 'Suspensao de profissional'),
  ('review.revised', 'review', true,
   array['status','visible','moderation_case_id'], 'Revisao/moderacao de avaliacao'),
  ('completion.corrected', 'service_request', true,
   array['status','selected_acceptance_id','completed_at','support_case_id'], 'Correcao de conclusao de servico'),
  ('payment.refunded', 'payment', true,
   array['status','refund_amount_cents','currency','approval_request_id'], 'Estorno de pagamento'),
  ('consent.changed', 'contact_consent', false,
   array['scope','granted','consent_text_version','acceptance_id'], 'Mudanca de consentimento de contato')
on conflict (action) do nothing;

-- 9. Verificacao da cadeia (CA-08) ------------------------------------------------------------------------
-- Somente leitura. SECURITY DEFINER (le chain_head, que nao tem grant a papeis de aplicacao) e
-- devolve apenas o veredito (sem linhas). reason: lacuna_seq | prev_hash_divergente |
-- row_hash_divergente | cabeca_divergente. first_bad_seq: a posicao (seq) a partir da qual falha;
-- em lacuna/cabeca e a primeira seq ausente.
create or replace function private.audit_verify_chain(
  p_from_seq bigint default 1,
  p_to_seq bigint default null
) returns table (ok boolean, checked bigint, first_bad_seq bigint, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          audit.audit_event%rowtype;
  v_prev     text;
  v_expected bigint;
  v_n        bigint := 0;
  v_head     audit.chain_head%rowtype;
begin
  if p_from_seq is null or p_from_seq < 1 or (p_to_seq is not null and p_to_seq < p_from_seq) then
    raise exception 'faixa invalida' using errcode = '22023';
  end if;

  if p_from_seq = 1 then
    v_prev := repeat('0', 64);
  else
    select e.row_hash into v_prev from audit.audit_event e where e.seq = p_from_seq - 1;
    if not found then
      return query select false, 0::bigint, p_from_seq - 1, 'lacuna_seq'::text;
      return;
    end if;
  end if;
  v_expected := p_from_seq;

  for r in
    select * from audit.audit_event e
     where e.seq >= p_from_seq and (p_to_seq is null or e.seq <= p_to_seq)
     order by e.seq
  loop
    if r.seq <> v_expected then
      return query select false, v_n, v_expected, 'lacuna_seq'::text;
      return;
    end if;
    if r.prev_hash::text <> v_prev then
      return query select false, v_n, r.seq, 'prev_hash_divergente'::text;
      return;
    end if;
    if r.row_hash::text <> private.audit_row_hash(
         r.hash_version, r.seq, r.id, r.at, r.actor_ref, r.actor_role, r.action, r.object_type,
         r.object_id, r.before_state, r.after_state, r.reason_code, r.correlation_id,
         r.prev_hash::text) then
      return query select false, v_n, r.seq, 'row_hash_divergente'::text;
      return;
    end if;
    v_prev := r.row_hash::text;
    v_expected := v_expected + 1;
    v_n := v_n + 1;
  end loop;

  if p_to_seq is null then
    select h.* into v_head from audit.chain_head h where h.id;
    if v_head.last_seq <> v_expected - 1 or v_head.last_hash::text <> v_prev then
      return query select false, v_n, v_expected, 'cabeca_divergente'::text;
      return;
    end if;
  end if;
  return query select true, v_n, null::bigint, null::text;
end
$$;

-- 10. Interface unica de gravacao (CA-01..04, CA-13) -----------------------------------------------------
-- Roda na transacao do chamador (nao abre outra). Qualquer erro e propagado: nao engolir com
-- EXCEPTION/savepoint. Ideal: ultima escrita antes do COMMIT (reduz o tempo com o lock da cadeia).
create or replace function private.audit_append(
  p_actor_ref text,
  p_actor_role text,
  p_action text,
  p_object_type text,
  p_object_id uuid,
  p_before_state jsonb,
  p_after_state jsonb,
  p_reason_code text default null,
  p_correlation_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  v_id   uuid := gen_random_uuid();
  v_corr uuid := coalesce(p_correlation_id, nullif(current_setting('app.correlation_id', true), '')::uuid);
begin
  insert into audit.audit_event (
    id, actor_ref, actor_role, action, object_type, object_id,
    before_state, after_state, reason_code, correlation_id)
  values (
    v_id, p_actor_ref, p_actor_role, p_action, p_object_type, p_object_id,
    p_before_state, p_after_state, p_reason_code, v_corr);
  return v_id;
end
$$;

-- 11. Privilegios -----------------------------------------------------------------------------------------
revoke all on function
  private.audit_key_is_forbidden(text),
  private.audit_keys_are_clean(text[]),
  private.audit_state_is_valid(jsonb),
  private.audit_canonical_state(jsonb),
  private.audit_row_hash(smallint, bigint, uuid, timestamptz, text, text, text, text, uuid, jsonb, jsonb, text, uuid, text),
  private.audit_verify_chain(bigint, bigint),
  private.audit_append(text, text, text, text, uuid, jsonb, jsonb, text, uuid),
  audit.tg_block_mutation(),
  audit.tg_head_guard(),
  audit.tg_event_seal()
  from public, anon, authenticated, service_role, app_api, app_system;

-- app_system: apenas leitura de audit_event (verificacao) e EXECUTE de verify/append.
-- app_api: somente EXECUTE de audit_append; nenhum privilegio de tabela (H-104 concede SELECT + politica).
grant usage on schema audit to app_system;
grant usage on schema private to app_api, app_system;
grant select on audit.audit_event to app_system;
grant execute on function
  private.audit_append(text, text, text, text, uuid, jsonb, jsonb, text, uuid) to app_api, app_system;
grant execute on function private.audit_verify_chain(bigint, bigint) to app_system;
