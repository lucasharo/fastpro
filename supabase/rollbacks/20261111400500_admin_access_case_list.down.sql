-- Desfaz 20261111400000_admin_access_case_list.sql (H-073, #83). EXECUCAO MANUAL e consciente: so em
-- banco de desenvolvimento. Remove apenas as duas funcoes de leitura (listagem e validade da sessao).
-- Nao toca em tabelas, casos, registros de leitura nem em auditoria.
begin;

drop function if exists private.access_case_list(uuid, text, timestamptz);
drop function if exists private.admin_session_expiry(text, timestamptz);

commit;
