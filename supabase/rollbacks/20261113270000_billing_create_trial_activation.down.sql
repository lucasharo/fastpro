-- Desfaz 20261113270000_billing_create_trial_activation.sql (H-044, Issue 57). EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento. Remove as duas funcoes e as duas linhas de catalogo de auditoria.
-- NAO apaga nenhuma linha de billing.access_grant (o livro proibe DELETE): trials ja gravados continuam no livro,
-- e a unicidade por identidade continua valendo pelo indice access_grant_trial_unico (criado na Issue 58).
-- A linha do catalogo so sai se nenhum evento de auditoria a referencia (FK restrict); eventos ja gravados
-- permanecem, como na revogacao da Issue 58. Idempotente (if exists).
begin;

drop function if exists private.trial_activate(uuid, text, timestamptz, uuid);
drop function if exists private.identity_id_from_document_hmac(text);

delete from audit.action_catalog
 where (action = 'billing.trial.activated' and object_type = 'access_grant')
    or (action = 'billing.trial.denied' and object_type = 'professional_profile');

commit;
