-- Desfaz 20261111490000_platform_login_role_noinherit.sql. EXECUCAO MANUAL e consciente: so em banco de
-- desenvolvimento. Devolve a heranca ao papel de conexao de teste e tira a migracao do registro.
begin;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'fastpro_system_login') then
    alter role fastpro_system_login inherit;
  end if;
end
$$;
delete from ops.schema_migration where version = '20261111490000';
commit;
