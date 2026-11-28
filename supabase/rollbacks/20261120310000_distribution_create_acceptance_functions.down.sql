-- Desfaz 20261120310000 (H-058, Issue #71, fatia 3). Restaura o stub de aceite ativo (select false, decisao 448)
-- e remove as funcoes de criacao e de leitura do aceite. Nao toca tabelas nem dados.
drop function if exists private.acceptance_create(uuid, uuid, timestamptz);
drop function if exists private.acceptance_read(uuid, uuid);

create or replace function private.request_acceptance_active(p_request_id uuid, p_professional_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select false
$$;

revoke all on function private.request_acceptance_active(uuid, uuid)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
grant execute on function private.request_acceptance_active(uuid, uuid) to app_system;
