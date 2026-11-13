-- Desfaz 20261113190000_billing_create_plan_pricing.sql (H-046, Issue 59). EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento. Os quatro planos e os quatro precos da carga voltam ao reaplicar a migracao;
-- qualquer linha de preco criada depois (troca de preco) se perde: exportar antes se houver dado de producao.
-- Sem cascade: se H-047 tiver FK para plan_price (subscription.plan_id), o rollback falha de proposito;
-- desfazer a FK de H-047 antes. Nao remove btree_gist (e do baseline).
-- Idempotente (if exists).
begin;

drop function if exists private.plan_price_at(timestamptz, text);

drop trigger if exists plan_price_guard_bu on billing.plan_price;
drop trigger if exists plan_price_sem_delete_bd on billing.plan_price;
drop trigger if exists plan_price_sem_truncate_bt on billing.plan_price;
drop trigger if exists plan_guard_bu on billing.plan;
drop trigger if exists plan_guard_bd on billing.plan;
drop trigger if exists plan_guard_bt on billing.plan;

drop function if exists private.billing_plan_price_guard();
drop function if exists private.billing_plan_guard();

drop table if exists billing.plan_price;
drop table if exists billing.plan;

commit;
