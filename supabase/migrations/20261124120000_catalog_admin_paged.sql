-- Console admin, catalogo em abas (decisao do dono, 2026-11-24): a tela lista uma aba por vez (grupos, servicos ou
-- sinonimos) em tabela com filtros e paginas de 50 itens, paginadas no banco. A API confere a sessao admin e a
-- permissao catalog.manage (private.admin_guard) antes de chamar estas funcoes. Somente leitura; so app_system.

-- Uma pagina de uma aba. p_entity: group | service | synonym. Filtros opcionais (nulo = sem filtro):
-- p_search (nome ou termo, sem acento e sem caixa), p_active, p_group (servicos e sinonimos) e p_service (sinonimos).
-- Devolve {"total": n, "items": [...]} com no maximo 50 itens a partir de p_offset.
create or replace function private.catalog_admin_page(p_entity text, p_search text, p_active boolean, p_group uuid,
  p_service uuid, p_offset integer, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_busca  text := nullif(private.catalog_norm(coalesce(p_search, '')), '');
  v_limite integer := least(greatest(coalesce(p_limit, 50), 1), 50);
  v_inicio integer := greatest(coalesce(p_offset, 0), 0);
  v_total  integer;
  v_itens  jsonb;
begin
  if p_entity = 'group' then
    select count(*) into v_total from app.service_group g
     where (v_busca is null or g.name_norm like '%' || v_busca || '%')
       and (p_active is null or g.active = p_active);
    select coalesce(jsonb_agg(x.j order by x.ord), '[]'::jsonb) into v_itens from (
      select jsonb_build_object('id', g.id, 'name', g.name, 'position', g.position, 'active', g.active,
               'version', g.version,
               'services', (select count(*) from app.service s where s.group_id = g.id)) as j,
             row_number() over (order by g.position, g.id) as ord
        from app.service_group g
       where (v_busca is null or g.name_norm like '%' || v_busca || '%')
         and (p_active is null or g.active = p_active)
       order by g.position, g.id
       offset v_inicio limit v_limite) x;
  elsif p_entity = 'service' then
    select count(*) into v_total from app.service s
     where (v_busca is null or s.name_norm like '%' || v_busca || '%')
       and (p_active is null or s.active = p_active)
       and (p_group is null or s.group_id = p_group);
    select coalesce(jsonb_agg(x.j order by x.ord), '[]'::jsonb) into v_itens from (
      select jsonb_build_object('id', s.id, 'name', s.name, 'group_id', s.group_id, 'group_name', g.name,
               'modality', s.modality, 'regulated', s.regulated, 'active', s.active, 'version', s.version,
               'synonyms', (select count(*) from app.service_synonym y where y.service_id = s.id)) as j,
             row_number() over (order by g.position, s.name_norm, s.id) as ord
        from app.service s
        join app.service_group g on g.id = s.group_id
       where (v_busca is null or s.name_norm like '%' || v_busca || '%')
         and (p_active is null or s.active = p_active)
         and (p_group is null or s.group_id = p_group)
       order by g.position, s.name_norm, s.id
       offset v_inicio limit v_limite) x;
  elsif p_entity = 'synonym' then
    select count(*) into v_total from app.service_synonym y
      join app.service s on s.id = y.service_id
     where (v_busca is null or y.term_norm like '%' || v_busca || '%')
       and (p_active is null or y.active = p_active)
       and (p_group is null or s.group_id = p_group)
       and (p_service is null or y.service_id = p_service);
    select coalesce(jsonb_agg(x.j order by x.ord), '[]'::jsonb) into v_itens from (
      select jsonb_build_object('id', y.id, 'term', y.term, 'service_id', y.service_id, 'service_name', s.name,
               'group_name', g.name, 'active', y.active, 'version', y.version) as j,
             row_number() over (order by y.term_norm, s.name_norm, y.id) as ord
        from app.service_synonym y
        join app.service s on s.id = y.service_id
        join app.service_group g on g.id = s.group_id
       where (v_busca is null or y.term_norm like '%' || v_busca || '%')
         and (p_active is null or y.active = p_active)
         and (p_group is null or s.group_id = p_group)
         and (p_service is null or y.service_id = p_service)
       order by y.term_norm, s.name_norm, y.id
       offset v_inicio limit v_limite) x;
  else
    return null;
  end if;
  return jsonb_build_object('total', v_total, 'items', v_itens);
end
$$;

-- Opcoes leves para os filtros e para os campos Grupo e Servico dos formularios (so id, nome e grupo).
create or replace function private.catalog_admin_options()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'active', g.active)
                                         order by g.position, g.id) from app.service_group g), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'group_id', s.group_id,
                                           'active', s.active) order by s.name_norm, s.id) from app.service s), '[]'::jsonb))
$$;

revoke all on function
  private.catalog_admin_page(text, text, boolean, uuid, uuid, integer, integer),
  private.catalog_admin_options()
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
grant execute on function private.catalog_admin_page(text, text, boolean, uuid, uuid, integer, integer) to app_system;
grant execute on function private.catalog_admin_options() to app_system;
