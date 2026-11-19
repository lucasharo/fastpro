-- Issue 120 (H-111) | Desfaz 20261113490000_privacy_create_dsr_user_functions.sql: remove as funcoes do titular
-- (abertura, cancelamento, lista e consulta) e os dois helpers privados. Nao apaga casos, grants, extratos,
-- chaves de idempotencia nem linhas de e-mail ja gravados: a prova do atendimento e retida.
-- Execucao manual e consciente, so em banco de desenvolvimento.
begin;

drop function if exists app.dsr_get_own(uuid, uuid);
drop function if exists app.dsr_list_own(uuid, integer, timestamptz, uuid);
drop function if exists app.dsr_cancel(uuid, uuid);
drop function if exists app.dsr_open(uuid, text, jsonb, text, text);
drop function if exists private.dsr_config_inteiro(text);
drop function if exists private.dsr_gerar_protocolo(timestamptz);

delete from ops.schema_migration where version = '20261113490000';

commit;
