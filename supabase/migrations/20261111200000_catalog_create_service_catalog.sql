-- H-018 | Catalogo de servicos: tabelas, leitura publica, funcoes de escrita administrativa e auditoria.
-- Idempotente. Desfazer: supabase/rollbacks/20261111200000_catalog_create_service_catalog.down.sql (manual, so em dev).
-- Fontes: docs/factory/53-DESENHO-H018.md (§1 a §3), 52-REFINO-H018.md (CA-01..CA-12); ADR-002, ADR-003,
-- ADR-017; 23-DESENHO-H006 (auditoria: private.audit_append, audit.tg_block_mutation).
--
-- Postura: tabelas com RLS habilitada E forcada. app_api so le colunas publicas e so linhas ativas
-- (politicas for select). Nenhuma politica nem grant de escrita para app_api: a escrita passa pelas
-- funcoes private.catalog_*_save (SECURITY DEFINER), que exigem private.catalog_assert_admin():
-- principal admin, sessao aal2 e permissao catalog.manage.
-- Codigos de erro (PROPOSTA): CT002 grupo ativo sem servico ativo (no COMMIT); CT003 versao em
-- conflito; CT004 entrada invalida (campo fora da lista, valor fora da regra); CT005 nao encontrado.
-- Ordem na funcao de escrita: alteracao da linha, depois private.audit_append, depois catalog_revision
-- (a revisao precisa do id do evento de auditoria; a linha de revisao e append-only).

-- 1. Normalizacao (53 §1): minusculas, sem acento, espacos colapsados. IMMUTABLE (unaccent com dicionario).
create or replace function private.catalog_norm(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(
           lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_text, ''))),
           '\s+', ' ', 'g'))
$$;

-- 2. Tabelas ---------------------------------------------------------------------------------------------
create table if not exists app.service_group (
  id             uuid primary key default gen_random_uuid(),
  seed_key       text,
  name           text not null,
  name_norm      text generated always as (private.catalog_norm(name)) stored,
  position       integer not null,
  active         boolean not null,
  version        integer not null default 1,
  updated_by_ref text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint service_group_seed_key_key unique (seed_key),
  constraint service_group_seed_key_fmt check (seed_key is null or seed_key ~ '^g[0-9]{2}$'),
  constraint service_group_name_key unique (name_norm),
  constraint service_group_name_len check (char_length(name) between 1 and 80),
  constraint service_group_name_norm_nonempty check (name_norm <> ''),
  constraint service_group_position_pos check (position > 0),
  constraint service_group_version_pos check (version >= 1),
  constraint service_group_updated_by_fmt check (
    updated_by_ref is null or updated_by_ref ~ '^(admin|system):[A-Za-z0-9_-]{1,64}$')
);
comment on table app.service_group is
  'Grupos do catalogo de servicos (H-018, 53 §1). Escrita so por private.catalog_group_save / seed.';

create table if not exists app.service (
  id                   uuid primary key default gen_random_uuid(),
  seed_key             text,
  group_id             uuid not null,
  name                 text not null,
  name_norm            text generated always as (private.catalog_norm(name)) stored,
  modality             text not null,
  regulated            boolean not null,
  regulation_source    text not null default 'proposta_po',
  council_body         text,
  moderation_sensitive boolean not null default false,
  active               boolean not null,
  version              integer not null default 1,
  updated_by_ref       text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint service_group_fk foreign key (group_id) references app.service_group (id) on delete restrict,
  constraint service_seed_key_key unique (seed_key),
  constraint service_seed_key_fmt check (seed_key is null or seed_key ~ '^g[0-9]{2}-[a-z0-9-]+$'),
  constraint service_group_id_name_key unique (group_id, name_norm),
  constraint service_name_len check (char_length(name) between 1 and 120),
  constraint service_name_norm_nonempty check (name_norm <> ''),
  constraint service_modality_fmt check (modality in ('presencial', 'online', 'ambos')),
  constraint service_regulation_source_fmt check (regulation_source in ('proposta_po', 'juridico')),
  constraint service_council_len check (council_body is null or char_length(council_body) between 1 and 40),
  constraint service_council_needs_regulated check (council_body is null or regulated),
  constraint service_version_pos check (version >= 1),
  constraint service_updated_by_fmt check (
    updated_by_ref is null or updated_by_ref ~ '^(admin|system):[A-Za-z0-9_-]{1,64}$')
);
comment on table app.service is
  'Servicos do catalogo (H-018, 53 §1): um grupo por servico. council_body e regulation_source sao internos.';

create table if not exists app.service_synonym (
  id             uuid primary key default gen_random_uuid(),
  service_id     uuid not null,
  term           text not null,
  term_norm      text generated always as (private.catalog_norm(term)) stored,
  active         boolean not null default true,
  version        integer not null default 1,
  updated_by_ref text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint service_synonym_service_fk foreign key (service_id) references app.service (id) on delete restrict,
  constraint service_synonym_term_key unique (service_id, term_norm),
  constraint service_synonym_term_len check (char_length(term) between 1 and 80),
  constraint service_synonym_term_norm_nonempty check (term_norm <> ''),
  constraint service_synonym_version_pos check (version >= 1),
  constraint service_synonym_updated_by_fmt check (
    updated_by_ref is null or updated_by_ref ~ '^(admin|system):[A-Za-z0-9_-]{1,64}$')
);
comment on table app.service_synonym is
  'Sinonimos de servico (H-018, 53 §1). Carregados aqui; exposicao publica e de H-019.';

-- Historico de alteracoes administrativas: valores completos (inclusive nomes), ligados ao evento de
-- auditoria. Append-only: bloqueio por gatilho ENABLE ALWAYS (AU001), como em H-006.
create table if not exists app.catalog_revision (
  id             uuid primary key default gen_random_uuid(),
  entity         text not null,
  entity_id      uuid not null,
  version        integer not null,
  before         jsonb,
  after          jsonb not null,
  audit_event_id uuid not null,
  at             timestamptz not null default now(),
  constraint catalog_revision_entity_fmt check (entity in ('group', 'service', 'synonym')),
  constraint catalog_revision_version_pos check (version >= 1),
  constraint catalog_revision_audit_key unique (audit_event_id),
  constraint catalog_revision_audit_fk foreign key (audit_event_id)
    references audit.audit_event (id) on delete restrict
);
comment on table app.catalog_revision is
  'Revisoes do catalogo (H-018, 53 §3.3): antes/depois completos, ligados a audit.audit_event. Append-only.';

-- Registro de execucoes da semente (53 §4.2). Append-only. Uma linha por (versao, checksum).
create table if not exists app.catalog_seed_run (
  id                uuid primary key default gen_random_uuid(),
  seed_version      text not null,
  checksum          text not null,
  applied_at        timestamptz not null default now(),
  groups_inserted   integer not null,
  services_inserted integer not null,
  synonyms_inserted integer not null,
  skipped_conflict  integer not null,
  groups_total      integer not null,
  services_total    integer not null,
  audit_event_id    uuid not null,
  constraint catalog_seed_run_version_key unique (seed_version, checksum),
  constraint catalog_seed_run_version_len check (char_length(seed_version) between 1 and 40),
  constraint catalog_seed_run_checksum_fmt check (checksum ~ '^[0-9a-f]{64}$'),
  constraint catalog_seed_run_audit_key unique (audit_event_id),
  constraint catalog_seed_run_audit_fk foreign key (audit_event_id)
    references audit.audit_event (id) on delete restrict
);
comment on table app.catalog_seed_run is
  'Execucoes da semente do catalogo (H-018, 53 §4.2). Append-only.';

-- 3. Acoes de auditoria (53 §3.3). Estado so com escalares validos: sem nome, texto ou PII. -----------
insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('catalog.group.changed', 'service_group', false,
   array['version', 'active', 'position', 'fields'], 'Alteracao de grupo do catalogo (H-018)'),
  ('catalog.service.changed', 'service', false,
   array['version', 'active', 'group_id', 'modality', 'regulated', 'sensitive', 'fields'],
   'Alteracao de servico do catalogo (H-018)'),
  ('catalog.synonym.changed', 'service_synonym', false,
   array['version', 'active', 'fields'], 'Alteracao de sinonimo do catalogo (H-018)'),
  ('catalog.seed.applied', 'catalog_seed_run', false,
   array['version', 'checksum', 'groups_inserted', 'services_inserted', 'synonyms_inserted',
         'skipped_conflict'],
   'Aplicacao da semente do catalogo (H-018); um evento por execucao')
on conflict (action) do nothing;

-- 4. Append-only para revisoes e execucoes (ENABLE ALWAYS, como em H-006) -------------------------------
drop trigger if exists tg_block_mutation on app.catalog_revision;
create trigger tg_block_mutation before update or delete on app.catalog_revision
  for each row execute function audit.tg_block_mutation();
drop trigger if exists tg_block_truncate on app.catalog_revision;
create trigger tg_block_truncate before truncate on app.catalog_revision
  for each statement execute function audit.tg_block_mutation();
alter table app.catalog_revision enable always trigger tg_block_mutation;
alter table app.catalog_revision enable always trigger tg_block_truncate;

drop trigger if exists tg_block_mutation on app.catalog_seed_run;
create trigger tg_block_mutation before update or delete on app.catalog_seed_run
  for each row execute function audit.tg_block_mutation();
drop trigger if exists tg_block_truncate on app.catalog_seed_run;
create trigger tg_block_truncate before truncate on app.catalog_seed_run
  for each statement execute function audit.tg_block_mutation();
alter table app.catalog_seed_run enable always trigger tg_block_mutation;
alter table app.catalog_seed_run enable always trigger tg_block_truncate;

-- 5. Invariante CA-02: grupo ativo exige ao menos um servico ativo. Gatilho de restricao adiado para o
-- COMMIT (permite criar grupo e servicos na mesma transacao). Erro CT002.
create or replace function private.catalog_check_group(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_group is null then
    return;
  end if;
  if exists (select 1 from app.service_group g where g.id = p_group and g.active)
     and not exists (select 1 from app.service s where s.group_id = p_group and s.active) then
    raise exception 'catalogo: grupo ativo sem servico ativo' using errcode = 'CT002';
  end if;
end
$$;

create or replace function private.catalog_tg_group_invariant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.catalog_check_group(new.id);
  return null;
end
$$;

create or replace function private.catalog_tg_service_invariant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.catalog_check_group(new.group_id);
  if tg_op = 'UPDATE' and old.group_id is distinct from new.group_id then
    perform private.catalog_check_group(old.group_id);
  end if;
  return null;
end
$$;

drop trigger if exists catalog_group_invariant on app.service_group;
create constraint trigger catalog_group_invariant
  after insert or update on app.service_group
  deferrable initially deferred
  for each row execute function private.catalog_tg_group_invariant();

drop trigger if exists catalog_service_invariant on app.service;
create constraint trigger catalog_service_invariant
  after insert or update on app.service
  deferrable initially deferred
  for each row execute function private.catalog_tg_service_invariant();

-- 6. RLS: habilitada e forcada em todas as tabelas. Leitura publica so para app_api (colunas em §8).
alter table app.service_group      enable row level security;
alter table app.service_group      force row level security;
alter table app.service            enable row level security;
alter table app.service            force row level security;
alter table app.service_synonym    enable row level security;
alter table app.service_synonym    force row level security;
alter table app.catalog_revision   enable row level security;
alter table app.catalog_revision   force row level security;
alter table app.catalog_seed_run   enable row level security;
alter table app.catalog_seed_run   force row level security;

drop policy if exists catalog_group_public_read on app.service_group;
create policy catalog_group_public_read on app.service_group
  for select to app_api
  using (active);

drop policy if exists catalog_service_public_read on app.service;
create policy catalog_service_public_read on app.service
  for select to app_api
  using (
    active
    and exists (select 1 from app.service_group g where g.id = group_id and g.active)
  );

drop policy if exists catalog_synonym_public_read on app.service_synonym;
create policy catalog_synonym_public_read on app.service_synonym
  for select to app_api
  using (
    active
    and exists (
      select 1 from app.service s
       where s.id = service_id and s.active
         and exists (select 1 from app.service_group g where g.id = s.group_id and g.active))
  );

-- 7. Grants minimos ----------------------------------------------------------------------------------
-- Nenhum grant de escrita a app_api. Colunas internas (seed_key, council_body, regulation_source,
-- moderation_sensitive, updated_by_ref, version, carimbos) ficam fora de qualquer grant de app_api.
grant usage on schema app to app_api, app_system;
grant select (id, name, position, active) on app.service_group to app_api;
grant select (id, group_id, name, modality, regulated, active) on app.service to app_api;
grant select (service_id, term, active) on app.service_synonym to app_api;
grant select on app.service_group, app.service, app.service_synonym to app_system;
grant select, insert on app.catalog_revision, app.catalog_seed_run to app_system;

-- 8. Leitura publica (53 §2): view com security_invoker (aplica a RLS de app_api) -----------------------
create or replace view app.catalog_public
with (security_invoker = true) as
select g.id       as group_id,
       g.name     as group_name,
       g.position as group_position,
       s.id       as service_id,
       s.name     as service_name,
       s.modality as modality,
       s.regulated as regulated
  from app.service s
  join app.service_group g on g.id = s.group_id
 where g.active and s.active;
comment on view app.catalog_public is
  'Leitura publica do catalogo (H-018, 53 §2). Campos permitidos; sem colunas internas.';
grant select on app.catalog_public to app_api;

-- 9. Verificacao de administrador (53 §3.1). Unico ponto de troca quando H-102 existir.
create or replace function private.catalog_assert_admin()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_type  text := nullif(current_setting('app.principal_type', true), '');
  v_aal   text := nullif(current_setting('app.aal', true), '');
  v_id    text := nullif(current_setting('app.principal_id', true), '');
  v_perms text := coalesce(current_setting('app.permissions', true), '');
begin
  if v_type is distinct from 'admin' or v_aal is distinct from 'aal2' then
    raise exception 'catalogo: administrador com sessao aal2 exigido' using errcode = '42501';
  end if;
  if v_id is null or v_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'catalogo: principal invalido' using errcode = '42501';
  end if;
  if not ('catalog.manage' = any (string_to_array(replace(v_perms, ' ', ''), ','))) then
    raise exception 'catalogo: permissao catalog.manage exigida' using errcode = '42501';
  end if;
  return v_id::uuid;
end
$$;

-- 10. Validacao de alteracao (p_patch) e conversao. Erro CT004 em qualquer desvio.
create or replace function private.catalog_patch_check(p_patch jsonb, p_allowed text[])
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'catalogo: alteracao deve ser um objeto' using errcode = 'CT004';
  end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k where k <> all (p_allowed)) then
    raise exception 'catalogo: campo fora da lista permitida' using errcode = 'CT004';
  end if;
end
$$;

create or replace function private.catalog_patch_text(p_patch jsonb, p_key text, p_max integer, p_nullable boolean)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_type  text := jsonb_typeof(p_patch -> p_key);
  v_value text;
begin
  if v_type = 'null' and p_nullable then
    return null;
  end if;
  if v_type is distinct from 'string' then
    raise exception 'catalogo: campo % deve ser texto', p_key using errcode = 'CT004';
  end if;
  v_value := btrim(p_patch ->> p_key);
  if char_length(v_value) < 1 or char_length(v_value) > p_max then
    raise exception 'catalogo: campo % fora do tamanho', p_key using errcode = 'CT004';
  end if;
  return v_value;
end
$$;

create or replace function private.catalog_patch_bool(p_patch jsonb, p_key text)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_typeof(p_patch -> p_key) is distinct from 'boolean' then
    raise exception 'catalogo: campo % deve ser booleano', p_key using errcode = 'CT004';
  end if;
  return (p_patch ->> p_key)::boolean;
end
$$;

create or replace function private.catalog_patch_position(p_patch jsonb, p_key text)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_num numeric;
begin
  if jsonb_typeof(p_patch -> p_key) is distinct from 'number' then
    raise exception 'catalogo: campo % deve ser numero', p_key using errcode = 'CT004';
  end if;
  v_num := (p_patch ->> p_key)::numeric;
  if v_num <> trunc(v_num) or v_num < 1 or v_num > 1000000 then
    raise exception 'catalogo: posicao invalida' using errcode = 'CT004';
  end if;
  return v_num::integer;
end
$$;

create or replace function private.catalog_patch_uuid(p_patch jsonb, p_key text)
returns uuid
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_typeof(p_patch -> p_key) is distinct from 'string' then
    raise exception 'catalogo: campo % deve ser identificador', p_key using errcode = 'CT004';
  end if;
  return (p_patch ->> p_key)::uuid;
exception
  when invalid_text_representation then
    raise exception 'catalogo: identificador invalido' using errcode = 'CT004';
end
$$;

-- Campos alterados como texto para a auditoria (chave.chave, <= 64 caracteres; senao "varios").
create or replace function private.catalog_fields_text(p_fields text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select case when coalesce(char_length(array_to_string(p_fields, '.')), 0) between 1 and 64
              then array_to_string(p_fields, '.')
              else 'varios' end
$$;

-- 11. Escrita administrativa: grupo -------------------------------------------------------------------
create or replace function private.catalog_group_save(
  p_id uuid,
  p_expected_version integer,
  p_patch jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  v_actor  uuid := private.catalog_assert_admin();
  v_old    app.service_group%rowtype;
  v_new    app.service_group%rowtype;
  v_fields text[] := '{}';
  v_audit  uuid;
begin
  perform private.catalog_patch_check(p_patch, array['name', 'position', 'active']);

  if p_id is null then
    if p_expected_version is not null then
      raise exception 'catalogo: versao esperada nao se aplica a criacao' using errcode = 'CT004';
    end if;
    insert into app.service_group (name, position, active, updated_by_ref)
    values (
      private.catalog_patch_text(p_patch, 'name', 80, false),
      private.catalog_patch_position(p_patch, 'position'),
      case when p_patch ? 'active' then private.catalog_patch_bool(p_patch, 'active') else false end,
      'admin:' || v_actor::text)
    returning * into v_new;
    v_fields := array['name', 'position', 'active'];
    v_audit := private.audit_append(
      'admin:' || v_actor::text, 'admin', 'catalog.group.changed', 'service_group', v_new.id,
      '{}'::jsonb,
      jsonb_build_object('version', v_new.version, 'active', v_new.active, 'position', v_new.position,
                         'fields', private.catalog_fields_text(v_fields)));
  else
    select * into v_old from app.service_group where id = p_id for update;
    if not found then
      raise exception 'catalogo: grupo nao encontrado' using errcode = 'CT005';
    end if;
    if p_expected_version is null or p_expected_version <> v_old.version then
      raise exception 'catalogo: versao em conflito' using errcode = 'CT003';
    end if;
    update app.service_group g
       set name = case when p_patch ? 'name' then private.catalog_patch_text(p_patch, 'name', 80, false) else v_old.name end,
           position = case when p_patch ? 'position' then private.catalog_patch_position(p_patch, 'position') else v_old.position end,
           active = case when p_patch ? 'active' then private.catalog_patch_bool(p_patch, 'active') else v_old.active end,
           version = v_old.version + 1,
           updated_by_ref = 'admin:' || v_actor::text,
           updated_at = now()
     where g.id = p_id
    returning * into v_new;

    if v_new.name is distinct from v_old.name then v_fields := array_append(v_fields, 'name'); end if;
    if v_new.position is distinct from v_old.position then v_fields := array_append(v_fields, 'position'); end if;
    if v_new.active is distinct from v_old.active then v_fields := array_append(v_fields, 'active'); end if;

    v_audit := private.audit_append(
      'admin:' || v_actor::text, 'admin', 'catalog.group.changed', 'service_group', v_new.id,
      jsonb_build_object('version', v_old.version, 'active', v_old.active, 'position', v_old.position),
      jsonb_build_object('version', v_new.version, 'active', v_new.active, 'position', v_new.position,
                         'fields', private.catalog_fields_text(v_fields)));
  end if;

  insert into app.catalog_revision (entity, entity_id, version, before, after, audit_event_id)
  values ('group', v_new.id, v_new.version,
          case when p_id is null then null else to_jsonb(v_old) end,
          to_jsonb(v_new), v_audit);
  return v_new.id;
end
$$;

-- 12. Escrita administrativa: servico ----------------------------------------------------------------
create or replace function private.catalog_service_save(
  p_id uuid,
  p_expected_version integer,
  p_patch jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  v_actor  uuid := private.catalog_assert_admin();
  v_old    app.service%rowtype;
  v_new    app.service%rowtype;
  v_fields text[] := '{}';
  v_audit  uuid;
  v_before jsonb := '{}'::jsonb;
  v_modality text;
  v_source   text;
  v_regulated boolean;
  v_council   text;
begin
  perform private.catalog_patch_check(p_patch, array[
    'name', 'group_id', 'modality', 'regulated', 'regulation_source', 'council_body',
    'moderation_sensitive', 'active']);

  if p_id is null then
    if p_expected_version is not null then
      raise exception 'catalogo: versao esperada nao se aplica a criacao' using errcode = 'CT004';
    end if;
    v_modality := private.catalog_patch_text(p_patch, 'modality', 20, false);
    v_source := case when p_patch ? 'regulation_source'
                     then private.catalog_patch_text(p_patch, 'regulation_source', 20, false)
                     else 'proposta_po' end;
    if v_modality not in ('presencial', 'online', 'ambos') or v_source not in ('proposta_po', 'juridico') then
      raise exception 'catalogo: modalidade ou fonte de regulamentacao invalida' using errcode = 'CT004';
    end if;
    v_regulated := private.catalog_patch_bool(p_patch, 'regulated');
    v_council := case when p_patch ? 'council_body' then private.catalog_patch_text(p_patch, 'council_body', 40, true) end;
    if v_council is not null and not v_regulated then
      raise exception 'catalogo: council_body exige regulamentado' using errcode = 'CT004';
    end if;
    insert into app.service (group_id, name, modality, regulated, regulation_source, council_body,
                             moderation_sensitive, active, updated_by_ref)
    values (
      private.catalog_patch_uuid(p_patch, 'group_id'),
      private.catalog_patch_text(p_patch, 'name', 120, false),
      v_modality,
      v_regulated,
      v_source,
      v_council,
      case when p_patch ? 'moderation_sensitive' then private.catalog_patch_bool(p_patch, 'moderation_sensitive') else false end,
      case when p_patch ? 'active' then private.catalog_patch_bool(p_patch, 'active') else false end,
      'admin:' || v_actor::text)
    returning * into v_new;
    v_fields := array['group_id', 'modality', 'regulated', 'active'];
    v_audit := private.audit_append(
      'admin:' || v_actor::text, 'admin', 'catalog.service.changed', 'service', v_new.id, v_before,
      jsonb_build_object('version', v_new.version, 'active', v_new.active, 'group_id', v_new.group_id,
                         'modality', v_new.modality, 'regulated', v_new.regulated,
                         'sensitive', v_new.moderation_sensitive,
                         'fields', private.catalog_fields_text(v_fields)));
  else
    select * into v_old from app.service where id = p_id for update;
    if not found then
      raise exception 'catalogo: servico nao encontrado' using errcode = 'CT005';
    end if;
    if p_expected_version is null or p_expected_version <> v_old.version then
      raise exception 'catalogo: versao em conflito' using errcode = 'CT003';
    end if;
    v_modality := case when p_patch ? 'modality' then private.catalog_patch_text(p_patch, 'modality', 20, false) else v_old.modality end;
    v_source := case when p_patch ? 'regulation_source' then private.catalog_patch_text(p_patch, 'regulation_source', 20, false) else v_old.regulation_source end;
    if v_modality not in ('presencial', 'online', 'ambos') or v_source not in ('proposta_po', 'juridico') then
      raise exception 'catalogo: modalidade ou fonte de regulamentacao invalida' using errcode = 'CT004';
    end if;
    v_regulated := case when p_patch ? 'regulated' then private.catalog_patch_bool(p_patch, 'regulated') else v_old.regulated end;
    v_council := case when p_patch ? 'council_body' then private.catalog_patch_text(p_patch, 'council_body', 40, true) else v_old.council_body end;
    if v_council is not null and not v_regulated then
      raise exception 'catalogo: council_body exige regulamentado' using errcode = 'CT004';
    end if;
    update app.service s
       set group_id = case when p_patch ? 'group_id' then private.catalog_patch_uuid(p_patch, 'group_id') else v_old.group_id end,
           name = case when p_patch ? 'name' then private.catalog_patch_text(p_patch, 'name', 120, false) else v_old.name end,
           modality = v_modality,
           regulated = v_regulated,
           regulation_source = v_source,
           council_body = v_council,
           moderation_sensitive = case when p_patch ? 'moderation_sensitive' then private.catalog_patch_bool(p_patch, 'moderation_sensitive') else v_old.moderation_sensitive end,
           active = case when p_patch ? 'active' then private.catalog_patch_bool(p_patch, 'active') else v_old.active end,
           version = v_old.version + 1,
           updated_by_ref = 'admin:' || v_actor::text,
           updated_at = now()
     where s.id = p_id
    returning * into v_new;

    if v_new.group_id is distinct from v_old.group_id then v_fields := array_append(v_fields, 'group_id'); end if;
    if v_new.name is distinct from v_old.name then v_fields := array_append(v_fields, 'name'); end if;
    if v_new.modality is distinct from v_old.modality then v_fields := array_append(v_fields, 'modality'); end if;
    if v_new.regulated is distinct from v_old.regulated then v_fields := array_append(v_fields, 'regulated'); end if;
    if v_new.council_body is distinct from v_old.council_body then v_fields := array_append(v_fields, 'council_body'); end if;
    if v_new.moderation_sensitive is distinct from v_old.moderation_sensitive then v_fields := array_append(v_fields, 'sensitive'); end if;
    if v_new.active is distinct from v_old.active then v_fields := array_append(v_fields, 'active'); end if;

    v_audit := private.audit_append(
      'admin:' || v_actor::text, 'admin', 'catalog.service.changed', 'service', v_new.id,
      jsonb_build_object('version', v_old.version, 'active', v_old.active, 'group_id', v_old.group_id,
                         'modality', v_old.modality, 'regulated', v_old.regulated,
                         'sensitive', v_old.moderation_sensitive),
      jsonb_build_object('version', v_new.version, 'active', v_new.active, 'group_id', v_new.group_id,
                         'modality', v_new.modality, 'regulated', v_new.regulated,
                         'sensitive', v_new.moderation_sensitive,
                         'fields', private.catalog_fields_text(v_fields)));
  end if;

  insert into app.catalog_revision (entity, entity_id, version, before, after, audit_event_id)
  values ('service', v_new.id, v_new.version,
          case when p_id is null then null else to_jsonb(v_old) end,
          to_jsonb(v_new), v_audit);
  return v_new.id;
end
$$;

-- 13. Escrita administrativa: sinonimo (criacao exige service_id; sem mudar o servico depois) ---------
create or replace function private.catalog_synonym_save(
  p_id uuid,
  p_expected_version integer,
  p_patch jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  v_actor  uuid := private.catalog_assert_admin();
  v_old    app.service_synonym%rowtype;
  v_new    app.service_synonym%rowtype;
  v_fields text[] := '{}';
  v_audit  uuid;
begin
  perform private.catalog_patch_check(p_patch, array['service_id', 'term', 'active']);

  if p_id is null then
    if p_expected_version is not null then
      raise exception 'catalogo: versao esperada nao se aplica a criacao' using errcode = 'CT004';
    end if;
    insert into app.service_synonym (service_id, term, active, updated_by_ref)
    values (
      private.catalog_patch_uuid(p_patch, 'service_id'),
      private.catalog_patch_text(p_patch, 'term', 80, false),
      case when p_patch ? 'active' then private.catalog_patch_bool(p_patch, 'active') else true end,
      'admin:' || v_actor::text)
    returning * into v_new;
    v_fields := array['term', 'active'];
    v_audit := private.audit_append(
      'admin:' || v_actor::text, 'admin', 'catalog.synonym.changed', 'service_synonym', v_new.id,
      '{}'::jsonb,
      jsonb_build_object('version', v_new.version, 'active', v_new.active,
                         'fields', private.catalog_fields_text(v_fields)));
  else
    if p_patch ? 'service_id' then
      raise exception 'catalogo: sinonimo nao muda de servico' using errcode = 'CT004';
    end if;
    select * into v_old from app.service_synonym where id = p_id for update;
    if not found then
      raise exception 'catalogo: sinonimo nao encontrado' using errcode = 'CT005';
    end if;
    if p_expected_version is null or p_expected_version <> v_old.version then
      raise exception 'catalogo: versao em conflito' using errcode = 'CT003';
    end if;
    update app.service_synonym y
       set term = case when p_patch ? 'term' then private.catalog_patch_text(p_patch, 'term', 80, false) else v_old.term end,
           active = case when p_patch ? 'active' then private.catalog_patch_bool(p_patch, 'active') else v_old.active end,
           version = v_old.version + 1,
           updated_by_ref = 'admin:' || v_actor::text,
           updated_at = now()
     where y.id = p_id
    returning * into v_new;

    if v_new.term is distinct from v_old.term then v_fields := array_append(v_fields, 'term'); end if;
    if v_new.active is distinct from v_old.active then v_fields := array_append(v_fields, 'active'); end if;

    v_audit := private.audit_append(
      'admin:' || v_actor::text, 'admin', 'catalog.synonym.changed', 'service_synonym', v_new.id,
      jsonb_build_object('version', v_old.version, 'active', v_old.active),
      jsonb_build_object('version', v_new.version, 'active', v_new.active,
                         'fields', private.catalog_fields_text(v_fields)));
  end if;

  insert into app.catalog_revision (entity, entity_id, version, before, after, audit_event_id)
  values ('synonym', v_new.id, v_new.version,
          case when p_id is null then null else to_jsonb(v_old) end,
          to_jsonb(v_new), v_audit);
  return v_new.id;
end
$$;

-- 14. Leitura administrativa completa (a tela e H-107) -------------------------------------------------
create or replace function private.catalog_admin_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.catalog_assert_admin();
  return jsonb_build_object(
    'groups', coalesce((select jsonb_agg(to_jsonb(g) order by g.position, g.id) from app.service_group g), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(to_jsonb(s) order by s.group_id, s.name_norm, s.id) from app.service s), '[]'::jsonb),
    'synonyms', coalesce((select jsonb_agg(to_jsonb(y) order by y.service_id, y.term_norm, y.id) from app.service_synonym y), '[]'::jsonb));
end
$$;

-- 15. Privilegios de funcao: so app_api e app_system executam as funcoes de escrita e leitura admin.
revoke all on function
  private.catalog_norm(text),
  private.catalog_check_group(uuid),
  private.catalog_tg_group_invariant(),
  private.catalog_tg_service_invariant(),
  private.catalog_assert_admin(),
  private.catalog_patch_check(jsonb, text[]),
  private.catalog_patch_text(jsonb, text, integer, boolean),
  private.catalog_patch_bool(jsonb, text),
  private.catalog_patch_position(jsonb, text),
  private.catalog_patch_uuid(jsonb, text),
  private.catalog_fields_text(text[]),
  private.catalog_group_save(uuid, integer, jsonb),
  private.catalog_service_save(uuid, integer, jsonb),
  private.catalog_synonym_save(uuid, integer, jsonb),
  private.catalog_admin_list()
  from public, anon, authenticated;

grant execute on function
  private.catalog_group_save(uuid, integer, jsonb),
  private.catalog_service_save(uuid, integer, jsonb),
  private.catalog_synonym_save(uuid, integer, jsonb),
  private.catalog_admin_list()
  to app_api, app_system;
