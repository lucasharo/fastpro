-- Desfaz 20261111410000_admin_staff_list.sql (H-103, #112). EXECUCAO MANUAL e consciente: so em banco de
-- desenvolvimento. Remove apenas a funcao de leitura da equipe. Nao toca em tabelas, papeis, sessoes
-- nem em auditoria.
begin;

drop function if exists private.admin_staff_list(uuid, text, timestamptz);

commit;
