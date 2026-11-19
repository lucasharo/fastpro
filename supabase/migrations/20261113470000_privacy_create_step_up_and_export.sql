-- Issue 120 (H-111) | Direitos do titular: grant de step-up da abertura (app.step_up_grant), extrato (app.dsr_export),
-- bucket privado dsr-exports e politica restritiva em storage.objects que nega acesso direto a esse bucket
-- (docs/factory/147-DESENHO-H111.md §3.2 e §8, passo 2).
-- Segunda fatia do desenho. Expansiva: duas tabelas novas, funcoes de gatilho novas, um bucket e uma politica
-- restritiva que vale so para o bucket dsr-exports. Nenhuma tabela existente e alterada.
-- Postura igual a fatia 1 (20261113460000): RLS forcada sem politicas de tabela; leitura so a app_system; nenhum
-- papel de API, anon, authenticated ou PUBLIC recebe escrita. Toda escrita futura passara por funcoes SECURITY DEFINER.
-- Prazos (15 min de step-up, 7 dias de extrato) ficam em ops.app_config (privacy.*); aqui nao ha constante de prazo.
-- Valor [PROPOSTA]: limite de 10 MiB do extrato (o desenho nao fixa o tamanho).
-- Nao cria funcao de negocio (emissao, consumo, geracao do extrato, download), job nem e-mail.
-- Desfazer: supabase/rollbacks/20261113470000_privacy_create_step_up_and_export.down.sql (recusa se houver extrato, token ou arquivo).

do $$
begin
  if to_regclass('app.app_user') is null
     or to_regclass('app.dsr_case') is null
     or to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null
     or not exists (select 1 from pg_roles where rolname = 'app_system')
     or not exists (select 1 from pg_roles where rolname = 'app_api')
  then
    raise exception 'dsr_pre_requisito_ausente';
  end if;
end
$$;

-- 1. Grant de step-up da abertura: uso unico, guardado so como hash --------------------------------------
-- Nao reaproveita app.auth_challenge: o step-up desse desafio e ligado a sessao (auth_challenge_step_up_sessao)
-- e tem validade fixa de 15 minutos no banco; o do titular para direitos e avulso e le o prazo da configuracao.
create table if not exists app.step_up_grant (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references app.app_user (id) on delete restrict,
  purpose     text not null
                constraint step_up_grant_purpose_check check (purpose in ('dsr_open')),
  token_hash  text not null
                constraint step_up_grant_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  constraint step_up_grant_validade_check check (expires_at > created_at),
  constraint step_up_grant_uso_check check (
    consumed_at is null or (consumed_at >= created_at and consumed_at <= expires_at))
);

create unique index if not exists step_up_grant_token_uk on app.step_up_grant (token_hash);
create index if not exists step_up_grant_usuario_recente_idx on app.step_up_grant (user_id, created_at desc);
create index if not exists step_up_grant_abertos_idx on app.step_up_grant (user_id, expires_at)
  where consumed_at is null;

comment on table app.step_up_grant is
  'Grant de step-up para abrir direito do titular (Issue 120, H-111). So o hash do token; uso unico; sem exclusao.';

-- 2. Extrato do direito de acesso: metadados e ponteiro para o arquivo no bucket privado -------------------
create table if not exists app.dsr_export (
  id               uuid primary key default gen_random_uuid(),
  case_id          uuid not null unique references app.dsr_case (id) on delete restrict,
  storage_bucket   text not null default 'dsr-exports'
                     constraint dsr_export_bucket_check check (storage_bucket = 'dsr-exports'),
  storage_path     text not null
                     constraint dsr_export_path_check check (storage_path ~
                       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$'),
  sha256           text not null
                     constraint dsr_export_sha256_check check (sha256 ~ '^[0-9a-f]{64}$'),
  signature        text not null
                     constraint dsr_export_signature_check check (signature ~ '^[0-9a-f]{64}$'),
  schema_version   integer not null
                     constraint dsr_export_schema_check check (schema_version >= 1),
  size_bytes       integer not null
                     constraint dsr_export_tamanho_check check (size_bytes between 1 and 10485760),
  generated_at     timestamptz not null default now(),
  expires_at       timestamptz not null,
  purged_at        timestamptz,
  download_count   integer not null default 0
                     constraint dsr_export_downloads_check check (download_count >= 0),
  last_download_at timestamptz,
  constraint dsr_export_validade_check check (expires_at > generated_at),
  constraint dsr_export_expurgo_check check (purged_at is null or purged_at >= generated_at),
  constraint dsr_export_download_check check ((download_count = 0) = (last_download_at is null))
);

comment on table app.dsr_export is
  'Extrato JSON do caso de acesso (Issue 120, H-111). Metadados e hash; o arquivo mora no bucket dsr-exports. Sem exclusao.';

-- 3. Gatilhos ----------------------------------------------------------------------------------------------
-- Grant: identidade e prazos imutaveis; consumo gravado uma vez so.
create or replace function private.dsr_step_up_grant_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.purpose is distinct from old.purpose
     or new.token_hash is distinct from old.token_hash
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at then
    raise exception 'step_up_grant_imutavel' using errcode = '42501';
  end if;
  if old.consumed_at is not null and new.consumed_at is distinct from old.consumed_at then
    raise exception 'step_up_grant_ja_consumido' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists dsr_step_up_grant_guard on app.step_up_grant;
create trigger dsr_step_up_grant_guard
  before update on app.step_up_grant
  for each row execute function private.dsr_step_up_grant_guard();

-- Extrato: identidade do arquivo imutavel; expurgo gravado uma vez; contador de downloads so cresce.
create or replace function private.dsr_export_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.case_id is distinct from old.case_id
     or new.storage_bucket is distinct from old.storage_bucket
     or new.storage_path is distinct from old.storage_path
     or new.sha256 is distinct from old.sha256
     or new.signature is distinct from old.signature
     or new.schema_version is distinct from old.schema_version
     or new.size_bytes is distinct from old.size_bytes
     or new.generated_at is distinct from old.generated_at
     or new.expires_at is distinct from old.expires_at then
    raise exception 'dsr_export_imutavel' using errcode = '42501';
  end if;
  if old.purged_at is not null and new.purged_at is distinct from old.purged_at then
    raise exception 'dsr_export_ja_expurgado' using errcode = '42501';
  end if;
  if new.download_count < old.download_count
     or (old.last_download_at is not null and new.last_download_at < old.last_download_at) then
    raise exception 'dsr_export_contador_regressivo' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists dsr_export_guard on app.dsr_export;
create trigger dsr_export_guard
  before update on app.dsr_export
  for each row execute function private.dsr_export_guard();

-- Sem exclusao nem truncamento nas duas tabelas: a prova do consumo e do extrato e retida.
create or replace function private.dsr_registro_refuse_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'dsr_registro_nao_deletavel' using errcode = '42501';
end
$$;

drop trigger if exists dsr_step_up_grant_no_delete on app.step_up_grant;
create trigger dsr_step_up_grant_no_delete
  before delete or truncate on app.step_up_grant
  for each statement execute function private.dsr_registro_refuse_delete();

drop trigger if exists dsr_export_no_delete on app.dsr_export;
create trigger dsr_export_no_delete
  before delete or truncate on app.dsr_export
  for each statement execute function private.dsr_registro_refuse_delete();

-- 4. Postura de seguranca das tabelas: RLS forcada sem politicas; so leitura para app_system ------------------
alter table app.step_up_grant enable row level security;
alter table app.step_up_grant force row level security;
alter table app.dsr_export enable row level security;
alter table app.dsr_export force row level security;

revoke all on app.step_up_grant, app.dsr_export
  from public, anon, authenticated, app_api;
grant select on app.step_up_grant, app.dsr_export to app_system;

-- 5. Bucket privado do extrato (application/json, 10 MiB [PROPOSTA]) --------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dsr-exports', 'dsr-exports', false, 10485760, array['application/json'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Politica restritiva: papeis sem BYPASSRLS nao leem, gravam nem apagam objeto do bucket dsr-exports por Storage,
-- mesmo que uma politica permissiva de outro bucket venha a existir depois. Leitura so por URL assinada da API.
-- Nao existe politica permissiva em storage.objects hoje (conferido no DEV); esta politica nao muda o acesso atual.
drop policy if exists dsr_exports_negar_acesso_direto on storage.objects;
create policy dsr_exports_negar_acesso_direto on storage.objects
  as restrictive
  for all
  to public
  using (bucket_id is distinct from 'dsr-exports')
  with check (bucket_id is distinct from 'dsr-exports');
