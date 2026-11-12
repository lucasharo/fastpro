-- Desfaz 20261111500000_platform_login_membership_noinherit.sql. EXECUCAO MANUAL e consciente: so em banco de
-- desenvolvimento. Devolve a membership do papel de conexao de teste a app_system com heranca (estado anterior).
-- Guardado: se algum dos papeis nao existir, nada acontece.
begin;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'fastpro_system_login')
     and exists (select 1 from pg_roles where rolname = 'app_system') then
    revoke app_system from fastpro_system_login;
    grant app_system to fastpro_system_login with inherit true;
  end if;
end
$$;
commit;
