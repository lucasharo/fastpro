-- Volta private.billing_subscription_cancel a versao de 20261122100000.
-- 13. Cancelamento (H-052): acesso ate o fim do periodo, sem carencia e sem nova cobranca.
create or replace function private.billing_subscription_cancel(p_professional_id uuid, p_at timestamptz)
returns table (out_code text, out_provider_subscription_id text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sub billing.subscription%rowtype;
begin
  select * into v_sub from billing.subscription where professional_id = p_professional_id for update;
  if not found then
    return query select 'sem_assinatura'::text, null::text;
    return;
  end if;
  if v_sub.cancel_at_period_end then
    return query select 'ja_cancelada'::text, v_sub.provider_subscription_id;
    return;
  end if;
  update billing.subscription
     set cancel_at_period_end = true, canceled_at = p_at, updated_at = p_at
   where id = v_sub.id;
  perform private.audit_append(
    'profissional:' || p_professional_id::text, 'profissional', 'billing.subscription.cancel', 'subscription', v_sub.id,
    jsonb_build_object('cancel_at_period_end', false), jsonb_build_object('cancel_at_period_end', true), null, null);
  return query select 'ok'::text, v_sub.provider_subscription_id;
end
$$;

