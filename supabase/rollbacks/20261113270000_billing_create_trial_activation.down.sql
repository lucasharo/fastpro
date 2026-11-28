-- Desfaz 20261113270000_billing_create_trial_activation.sql (H-044, Issue 57). EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento. Remove as duas funcoes e as duas linhas de catalogo de auditoria.
-- NAO apaga nenhuma linha de billing.access_grant (o livro proibe DELETE): trials ja gravados continuam no livro,
-- e a unicidade por identidade continua valendo pelo indice access_grant_trial_unico (criado na Issue 58).
-- A linha do catalogo so sai se nenhum evento de auditoria a referencia (FK restrict); eventos ja gravados
-- permanecem, como na revogacao da Issue 58. Idempotente (if exists).
begin;

drop function if exists private.trial_activate(uuid, text, timestamptz, uuid);
drop function if exists private.identity_id_from_document_hmac(text);

-- So remove a linha do catalogo sem eventos que a referenciem (audit_event_action_fk, on delete restrict).
delete from audit.action_catalog c
 where ((c.action = 'billing.trial.activated' and c.object_type = 'access_grant')
     or (c.action = 'billing.trial.denied' and c.object_type = 'professional_profile'))
   and not exists (
     select 1 from audit.audit_event e
      where e.action = c.action and e.object_type = c.object_type);

commit;
