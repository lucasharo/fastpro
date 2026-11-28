-- QA de banco (H-012 T-H012-20, H-014 T-H014-22): a migracao 20261111490000 pôs NOINHERIT no papel de
-- conexao de teste (fastpro_system_login), mas no PostgreSQL 16 ou superior a opcao de heranca fica na
-- membership (pg_auth_members.inherit_option), e ALTER ROLE nao a altera. Por isso o papel continuava
-- herdando os privilegios de app_system. Esta migracao refaz a membership com WITH INHERIT FALSE.
-- O papel continua membro de app_system (SET ROLE funciona); so deixa de herdar privilegios.
-- Idempotente e guardada: se algum dos papeis nao existir neste banco (producao, por exemplo), nada acontece.
-- Nao altera migracoes aplicadas, nao cria papel e nao altera funcoes, tabelas ou grants de PUBLIC.
-- Desfazer: supabase/rollbacks/20261111500000_platform_login_membership_noinherit.down.sql.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'fastpro_system_login')
     and exists (select 1 from pg_roles where rolname = 'app_system') then
    revoke app_system from fastpro_system_login;
    grant app_system to fastpro_system_login with inherit false;
  end if;
end
$$;
