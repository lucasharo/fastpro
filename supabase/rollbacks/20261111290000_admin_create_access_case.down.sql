-- Desfaz 20261111290000_admin_create_access_case.sql (H-073, #83). EXECUCAO MANUAL e consciente: so em
-- banco de desenvolvimento. Remove o gate, as funcoes do caso e as duas tabelas (com o que houver nelas),
-- revoga a permissao case.authorize_sensitive do mapa e tira a migracao do registro. As acoes
-- access_case.* ficam no catalogo (eventos ja gravados dependem delas).
-- Atencao: se a migracao 20261111300000 (aprovacao acesso_conversa) ja estiver aplicada, desfaca-a antes.
begin;

drop function if exists private.access_case_gate(uuid, text, uuid, uuid, timestamptz);
drop function if exists private.access_case_close(uuid, uuid, timestamptz);
drop function if exists private.access_case_approve(uuid, text, uuid, timestamptz);
drop function if exists private.access_case_open(uuid, text, uuid, text, uuid, timestamptz);
drop function if exists private.access_case_session_totp(uuid, text, timestamptz);

drop table if exists app.sensitive_access_log;
drop table if exists app.access_case;

drop function if exists private.access_case_refuse_mutation();
drop function if exists private.access_case_guard_update();

delete from app.admin_role_permission where permission_code = 'case.authorize_sensitive';
delete from app.admin_permission where code = 'case.authorize_sensitive';

delete from ops.schema_migration where version = '20261111290000';

commit;
