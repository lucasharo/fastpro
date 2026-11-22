-- Desfaz 20261122100000_billing_checkout_payment (E5). Remove funcoes, tabelas novas e colunas novas da assinatura.
drop function if exists private.billing_reconciliation_record(text, text, text, text, timestamptz);
drop function if exists private.billing_payment_ledger(text);
drop function if exists private.billing_reconciliation_targets(timestamptz);
drop function if exists private.billing_event_finish(uuid, text, timestamptz);
drop function if exists private.billing_event_record(text, text, text, boolean, timestamptz);
drop function if exists private.billing_status(uuid, timestamptz);
drop function if exists private.billing_subscription_cancel(uuid, timestamptz);
drop function if exists private.billing_subscription_link(uuid, text, text, timestamptz);
drop function if exists private.billing_payment_apply(uuid, text, text, integer, text, timestamptz, timestamptz, text, timestamptz);
drop function if exists private.billing_checkout_get(uuid, text);
drop function if exists private.billing_checkout_set_provider_ref(uuid, text);
drop function if exists private.billing_checkout_create(uuid, text, text, boolean, text, timestamptz);
drop function if exists private.billing_add_months(timestamptz, integer);
drop table if exists billing.reconciliation_issue;
drop table if exists billing.provider_event;
drop table if exists billing.payment;
drop table if exists billing.checkout;
drop index if exists billing.subscription_provider_unico;
alter table billing.subscription
  drop column if exists updated_at,
  drop column if exists status_provider,
  drop column if exists auto_renew_text_version,
  drop column if exists auto_renew_opt_in_at,
  drop column if exists provider_subscription_id,
  drop column if exists provider,
  drop column if exists plan_id;
delete from audit.action_catalog where action in ('billing.paid.granted', 'billing.subscription.cancel');
