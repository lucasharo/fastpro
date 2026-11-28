-- Issue 120 (H-111) | Desfaz 20261113520000_privacy_create_dsr_admin_functions.sql: remove as funcoes administrativas,
-- as permissoes dsr.* e o papel dpo (somente o que a migracao criou). Nao altera dados de casos nem de contas.
-- Recusa se ja houver papel dpo concedido a algum operador: a reversao nao pode deixar vinculo sem papel.
-- As linhas do catalogo de auditoria nao sao removidas (registros de auditoria podem referenciar as acoes).
-- Execucao manual e consciente, so em banco de desenvolvimento.
begin;

do $$
begin
  if exists (select 1 from app.admin_user_role where role_code = 'dpo') then
    raise exception 'desfazer_recusado_ha_papel_dpo';
  end if;
end
$$;

drop function if exists app.dsr_admin_anonymize(uuid, uuid);
drop function if exists app.dsr_admin_generate_extract(uuid, uuid);
drop function if exists app.dsr_reject(uuid, uuid, text, boolean, text);
drop function if exists app.dsr_defer(uuid, uuid);
drop function if exists app.dsr_assign(uuid, uuid, uuid);
drop function if exists app.dsr_admin_get(uuid, uuid);
drop function if exists app.dsr_admin_list(uuid, text, text, text, uuid, integer, timestamptz, uuid);
drop function if exists private.dsr_admin_caso(uuid, uuid, text);

delete from app.admin_role_permission
 where (role_code = 'dpo' and permission_code in ('dsr.read', 'dsr.decide', 'dsr.open_assisted'))
    or (role_code = 'superadmin' and permission_code in ('dsr.read', 'dsr.decide', 'dsr.open_assisted'))
    or (role_code = 'auditor' and permission_code = 'dsr.read')
    or (role_code = 'suporte' and permission_code = 'dsr.read');

delete from app.admin_permission where code in ('dsr.read', 'dsr.decide', 'dsr.open_assisted');
delete from app.admin_role where code = 'dpo';

delete from ops.schema_migration where version = '20261113520000';

commit;
