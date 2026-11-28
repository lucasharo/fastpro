-- H-107 (Issue 116) | Leitura administrativa do historico de um item do catalogo: private.catalog_revision_list.
-- Docs: docs/factory/81-DESENHO-H107.md §2 (migracao nova, unica) e P-107-4 (aceita pela decisao do usuario).
-- Sem tabela, coluna, grant de escrita ou politica nova. Desfazer: supabase/rollbacks/20261111450000_catalog_revision_list.down.sql.
-- ESCRITA, NAO APLICADA: esta migracao so entra no banco em etapa propria (banco de desenvolvimento).
-- Depende de 20261111200000 (app.catalog_revision, private.catalog_assert_admin).
--
-- Seguranca: security definer (o papel app_api nao tem select em app.catalog_revision); a verificacao de
-- administrador e a primeira instrucao (catalog_assert_admin: aal2 e catalog.manage na ponte de identidade).
-- Saida: so as colunas que a tela mostra (versao, antes, depois, instante e ator de updated_by_ref).

create or replace function private.catalog_revision_list(p_entity text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.catalog_assert_admin();
  if p_entity is null or p_entity not in ('group', 'service', 'synonym') or p_id is null then
    raise exception 'catalogo: entidade ou identificador invalido' using errcode = 'CT004';
  end if;
  return coalesce(
    (select jsonb_agg(
              jsonb_build_object(
                'version', r.version,
                'before', r.before,
                'after', r.after,
                'at', r.at,
                'actor', r.after ->> 'updated_by_ref')
              order by r.version desc, r.at desc, r.id desc)
       from app.catalog_revision r
      where r.entity = p_entity and r.entity_id = p_id),
    '[]'::jsonb);
end
$$;

revoke all on function private.catalog_revision_list(text, uuid) from public, anon, authenticated;
grant execute on function private.catalog_revision_list(text, uuid) to app_api, app_system;
