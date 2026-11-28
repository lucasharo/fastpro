-- Desfaz 20261113320000_verification_create_professional_state.sql (Issue 54, H-041).
-- Remove so as duas funcoes novas (assinaturas completas). Nao altera cadastros, casos, eventos nem auditoria:
-- o recurso gravado por professional_verification_appeal segue no historico (append-only).
-- Nenhuma funcao de Issue 52 ou 53 e tocada. Execucao manual e consciente, so em banco de desenvolvimento.
begin;

drop function if exists private.professional_verification_appeal(uuid, timestamptz);
drop function if exists private.professional_verification_state(uuid);

delete from ops.schema_migration where version = '20261113320000';

commit;
