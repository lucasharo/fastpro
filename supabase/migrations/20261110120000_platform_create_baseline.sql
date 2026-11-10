-- H-003 | Base da plataforma: extensoes, esquemas do produto, tabela de controle, postura de
-- seguranca e papeis de aplicacao. Idempotente (pode rodar de novo sem efeito colateral).
-- Desfazer: supabase/rollbacks/20261110120000_platform_create_baseline.down.sql (manual).
-- NAO habilita pg_cron/pg_net (decisao do spike S-10) nem pgTAP (os testes de catalogo sao
-- feitos em Node, packages/db/tests). NAO cria senha: nenhum segredo e versionado.

-- 1. Extensoes (esquema "extensions", conforme S-02) -----------------------------------------
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- 2. Esquemas do produto (09 §1): nao expostos a Data API; tabelas de dominio so aqui --------
create schema if not exists app;      -- dominio
create schema if not exists billing;  -- assinatura e cobranca
create schema if not exists audit;    -- auditoria append-only
create schema if not exists ops;      -- operacional (jobs, outbox, controle de migracoes)
create schema if not exists private;  -- funcoes internas

-- 3. Tabela de controle de migracoes (preenchida pelo executor, packages/db) -----------------
create table if not exists ops.schema_migration (
  version    text primary key check (version ~ '^[0-9]{14}$'),
  name       text not null,
  checksum   text not null check (checksum ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz not null default now(),
  applied_by text not null default current_user
);
comment on table ops.schema_migration is
  'Controle de migracoes aplicadas (H-003). Escrita apenas pelo executor com o papel de migracao.';

-- 4. Postura de seguranca: negar por padrao -----------------------------------------------------
-- Regra obrigatoria: toda tabela criada nos esquemas do produto deve nascer com RLS habilitada E
-- forcada na mesma migracao (enable + force row level security). O teste de catalogo
-- (pnpm db:test) reprova qualquer tabela sem isso. Sem politicas, a RLS nega tudo.
alter table ops.schema_migration enable row level security;
alter table ops.schema_migration force row level security;

-- Nenhum acesso por padrao a PUBLIC, anon, authenticated ou service_role nos esquemas do produto.
revoke all on schema app, billing, audit, ops, private from public, anon, authenticated, service_role;
revoke all on all tables in schema app, billing, audit, ops, private
  from public, anon, authenticated, service_role;
revoke all on all sequences in schema app, billing, audit, ops, private
  from public, anon, authenticated, service_role;
revoke all on all functions in schema app, billing, audit, ops, private
  from public, anon, authenticated, service_role;

-- Objetos futuros criados pelo papel de migracao tambem nascem sem permissao para eles.
alter default privileges for role postgres in schema app, billing, audit, ops, private
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema app, billing, audit, ops, private
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema app, billing, audit, ops, private
  revoke all on functions from public, anon, authenticated, service_role;

-- No esquema public (exposto pela Data API) nada novo recebe permissao automaticamente.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated, service_role;

-- 5. Papeis de aplicacao (08 §4.2) ------------------------------------------------------------
-- Criados SEM login e SEM senha. Habilitar login e definir senha e passo manual fora das
-- migracoes (pendencia documentada no README de supabase/). Grants por tabela vem com cada
-- tabela, nas historias seguintes (minimo necessario).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_api') then
    create role app_api nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_system') then
    create role app_system nologin noinherit nosuperuser nocreatedb nocreaterole bypassrls;
  end if;
end
$$;

-- Os dois precisam enxergar tipos e funcoes das extensoes (ex.: PostGIS) nas consultas.
grant usage on schema extensions to app_api, app_system;
