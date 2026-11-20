-- Issue 120 (H-111) | Desfaz 20261120000000_privacy_create_dsr_download.sql: remove as duas funcoes, o guard e a
-- tabela de tokens. Recusa se houver tokens gravados (a prova de entrega do extrato e retida). A acao de auditoria
-- do catalogo nao e removida (catalogo so cresce). Execucao manual e consciente, so em banco de desenvolvimento.

do $$
begin
  if exists (select 1 from app.dsr_download_token) then
    raise exception 'dsr_download_token_com_registros';
  end if;
end
$$;

drop function if exists app.dsr_consume_extract_token(text);
drop function if exists app.dsr_issue_extract_token(uuid, uuid, text);
drop trigger if exists dsr_download_token_no_delete on app.dsr_download_token;
drop trigger if exists dsr_download_token_guard on app.dsr_download_token;
drop function if exists private.dsr_download_token_guard();
drop table if exists app.dsr_download_token;

delete from ops.schema_migration where version = '20261120000000';
