-- Desfaz 20261113170000_billing_create_access_grant.sql (H-045, Issue 58). EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento. Guarda: com concessao ou assinatura gravada, aborta com
-- rollback_recusado_com_dados, a menos que a sessao informe set app.rollback_force = '1' (perda de dados
-- de proposito). Exportar antes se houver linha de producao. Nao remove btree_gist (e do baseline) nem a
-- auditoria ja gravada; a linha do catalogo de auditoria so sai se nenhum evento a referencia (FK restrict).
-- Idempotente (if exists).
begin;

do $$
begin
  if coalesce(current_setting('app.rollback_force', true), '') <> '1'
     and (exists (select 1 from billing.access_grant) or exists (select 1 from billing.subscription)) then
    raise exception 'rollback_recusado_com_dados' using errcode = '23514';
  end if;
end
$$;

drop function if exists private.commercial_access(uuid, timestamptz);
drop function if exists private.access_grant_revoke(uuid, text, text, text, uuid);

drop trigger if exists access_grant_guard_bu on billing.access_grant;
drop trigger if exists access_grant_sem_delete_bd on billing.access_grant;
drop trigger if exists access_grant_sem_truncate_bt on billing.access_grant;
drop function if exists private.access_grant_guard();

drop table if exists billing.access_grant;
drop table if exists billing.subscription;

delete from audit.action_catalog
 where action = 'billing.access_grant.revoke' and object_type = 'access_grant';

commit;
