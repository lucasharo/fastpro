-- QA de banco (H-012 T-H012-20, H-014 T-H014-22): o papel de conexao de teste (fastpro_system_login) herdava
-- os privilegios de app_system e executava as funcoes app_session_*. A escolha: NOINHERIT no proprio papel de
-- conexao. Ele continua membro de app_system (pode usar SET ROLE, se precisar), mas nao recebe privilegios por
-- heranca. Alternativa descartada: revogar a membership, que quebraria a conexao de teste.
-- Guardado: se o papel nao existir neste banco (producao, por exemplo), nada acontece.
-- Desfazer: supabase/rollbacks/20261111490000_platform_login_role_noinherit.down.sql.
-- Nao altera migracoes aplicadas e nao cria papel.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'fastpro_system_login') then
    alter role fastpro_system_login noinherit;
  end if;
end
$$;
