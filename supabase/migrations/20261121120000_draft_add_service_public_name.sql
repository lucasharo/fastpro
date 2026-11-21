-- Issue #159 | Nome publico do servico no rascunho (docs/factory/185-DESENHO-DEFEITOS-TELAS.md, §3.1, D-ARQ-159-5).
-- Expansao pura: uma funcao nova de leitura. Nao altera draft_get, draft_create nem draft_patch.
-- Idempotente. Desfazer: supabase/rollbacks/20261121120000_draft_add_service_public_name.down.sql.
-- Dado: so o nome do servico do catalogo (publico, sem dado pessoal). EXECUTE so para app_api.

create or replace function private.service_public_name(p_service_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.name from app.service s where s.id = p_service_id
$$;

comment on function private.service_public_name(uuid) is
  'Nome do servico do catalogo para o rascunho (Issue 159). Leitura simples; EXECUTE so para app_api.';

revoke all on function private.service_public_name(uuid) from public, anon, authenticated, service_role;

grant execute on function private.service_public_name(uuid) to app_api;
