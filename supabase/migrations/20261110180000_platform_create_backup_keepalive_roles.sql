-- H-010 | Papeis do backup manual (somente leitura) e do keep-alive (desenho 28-DESENHO-H010.md).
-- Nao destrutiva e idempotente: so cria papeis, concede leitura e define parametros de sessao.
-- NOLOGIN e SEM senha: login e senha sao passo manual fora desta migracao (ver supabase/README.md).
-- Nenhum segredo e versionado. Desfazer: supabase/rollbacks/20261110180000_platform_create_backup_keepalive_roles.down.sql
--
-- app_backup_reader: leitura das tabelas e sequencias dos esquemas do produto. BYPASSRLS para o dump
--   nao sair parcial por RLS forcada (o procedimento proibe --enable-row-security). Nunca service_role.
-- app_keepalive: nenhum privilegio em tabela ou sequencia, sem BYPASSRLS; so faz consulta de catalogo.

-- 1. Papeis (NOLOGIN, sem senha) -------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_backup_reader') then
    create role app_backup_reader nologin noinherit nosuperuser nocreatedb nocreaterole bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_keepalive') then
    create role app_keepalive nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
  end if;
end
$$;

-- 2. Parametros de sessao por papel (valem quando o login for habilitado manualmente) ---------
alter role app_backup_reader set default_transaction_read_only = on;
alter role app_backup_reader set statement_timeout = '30min';
alter role app_backup_reader set idle_in_transaction_session_timeout = '10min';
alter role app_keepalive set default_transaction_read_only = on;
alter role app_keepalive set statement_timeout = '10s';
alter role app_keepalive set idle_in_transaction_session_timeout = '10s';

-- 3. Leitura do backup: so esquemas do produto e extensions (sem auth, storage, vault) ---------
grant usage on schema app, billing, audit, ops, private, extensions to app_backup_reader;
grant select on all tables in schema app, billing, audit, ops, private to app_backup_reader;
grant select on all sequences in schema app, billing, audit, ops, private to app_backup_reader;

-- 4. Keep-alive: nenhum grant em tabela ou sequencia (reafirmado mesmo que o papel ja exista) ---
revoke all on all tables in schema app, billing, audit, ops, private from app_keepalive;
revoke all on all sequences in schema app, billing, audit, ops, private from app_keepalive;
