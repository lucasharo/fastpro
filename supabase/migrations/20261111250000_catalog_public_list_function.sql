-- H-018 | Leitura publica do catalogo por funcao, sem politica de RLS (decisao do Orquestrador, #31).
-- Motivo: o guarda "nenhuma politica de acesso nos esquemas do produto" (H-003, platform.dbtest) proibe
-- politicas. Por isso remove as tres politicas catalog_*_public_read e a view app.catalog_public, e a leitura
-- passa a ser private.catalog_public_list(): SECURITY DEFINER, search_path vazio, EXECUTE so para app_api.
-- app_api perde os grants de coluna nas tabelas do catalogo (nenhuma leitura direta).
-- Idempotente. Desfazer: supabase/rollbacks/20261111250000_catalog_public_list_function.down.sql (manual, so em dev).

drop policy if exists catalog_group_public_read on app.service_group;
drop policy if exists catalog_service_public_read on app.service;
drop policy if exists catalog_synonym_public_read on app.service_synonym;
drop view if exists app.catalog_public;

revoke select (id, name, position, active) on app.service_group from app_api;
revoke select (id, group_id, name, modality, regulated, active) on app.service from app_api;
revoke select (service_id, term, active) on app.service_synonym from app_api;

create or replace function private.catalog_public_list()
returns table (
  group_id uuid,
  group_name text,
  group_position integer,
  service_id uuid,
  service_name text,
  modality text,
  regulated boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.name, g.position, s.id, s.name, s.modality, s.regulated
    from app.service s
    join app.service_group g on g.id = s.group_id
   where g.active and s.active
   order by g.position, g.id, s.name_norm, s.id
$$;
comment on function private.catalog_public_list() is
  'Leitura publica do catalogo (H-018, 53 §2): so colunas publicas, so itens ativos. EXECUTE so para app_api.';

revoke all on function private.catalog_public_list() from public, anon, authenticated;
grant execute on function private.catalog_public_list() to app_api;
