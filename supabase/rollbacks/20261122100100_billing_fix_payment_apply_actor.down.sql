-- Volta private.billing_payment_apply a versao de 20261122100000 (reaplicar a secao 11 daquela migracao).
-- 11. Aplica o pagamento consultado no provedor. Idempotente por provider_payment_id; nunca regride
-- (aprovado so passa a estornado ou chargeback). Pagamento aprovado gera a concessao paga com a regra de inicio
-- de 08 §8.4. Estorno e chargeback nao mexem no acesso (08 §8.9: decisao explicita do Financeiro).
-- Codigos: concedido | registrado | sem_mudanca | checkout_desconhecido | valor_divergente | metodo_invalido.
create or replace function private.billing_payment_apply(
  p_checkout_id uuid,
  p_provider_payment_id text,
  p_method text,
  p_amount_cents integer,
  p_status text,
  p_paid_at timestamptz,
  p_provider_updated_at timestamptz,
  p_provider_subscription_id text,
  p_at timestamptz
) returns table (
  out_code text,
  out_payment_id uuid,
  out_period_start timestamptz,
  out_period_end timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ck billing.checkout%rowtype;
  v_pay billing.payment%rowtype;
  v_sub_id uuid;
  v_hmac text;
  v_identity uuid;
  v_cancelada boolean;
  v_prev_end timestamptz;
  v_inicio timestamptz;
  v_fim timestamptz;
  v_grant uuid;
  v_novo boolean := false;
begin
  if p_provider_payment_id is null or p_status is null or p_at is null then
    raise exception 'entrada_invalida' using errcode = '22023';
  end if;
  if p_status not in ('aprovado', 'pendente', 'recusado', 'estornado', 'chargeback') then
    raise exception 'status_invalido' using errcode = '22023';
  end if;
  if p_method is null or p_method not in ('cartao', 'pix') then
    return query select 'metodo_invalido'::text, null::uuid, null::timestamptz, null::timestamptz;
    return;
  end if;
  select * into v_ck from billing.checkout where id = p_checkout_id;
  if not found then
    return query select 'checkout_desconhecido'::text, null::uuid, null::timestamptz, null::timestamptz;
    return;
  end if;
  if p_amount_cents is distinct from v_ck.amount_cents then
    return query select 'valor_divergente'::text, null::uuid, null::timestamptz, null::timestamptz;
    return;
  end if;

  -- Serializa por profissional: duas aprovacoes simultaneas nao calculam o mesmo inicio.
  perform 1 from app.professional_profile where user_id = v_ck.professional_id for update;

  -- Assinatura do profissional (uma por profissional): cria ou atualiza com o plano e, no cartao recorrente,
  -- o identificador do provedor.
  insert into billing.subscription (professional_id, plan_id, mode, provider_subscription_id, updated_at)
  values (v_ck.professional_id, v_ck.plan_id,
          case when v_ck.mode = 'recorrente' then 'cartao_recorrente' else 'manual' end,
          case when v_ck.mode = 'recorrente' then p_provider_subscription_id end, p_at)
  on conflict (professional_id) do nothing;
  select id into v_sub_id from billing.subscription where professional_id = v_ck.professional_id;

  select * into v_pay from billing.payment
   where provider = 'mercadopago' and provider_payment_id = p_provider_payment_id
   for update;
  if not found then
    insert into billing.payment (professional_id, checkout_id, subscription_id, provider_payment_id, method,
                                 amount_cents, plan_price_id, status, paid_at, provider_updated_at, created_at, updated_at)
    values (v_ck.professional_id, v_ck.id, v_sub_id, p_provider_payment_id, p_method, p_amount_cents,
            v_ck.plan_price_id, p_status, case when p_status = 'aprovado' then coalesce(p_paid_at, p_at) end,
            p_provider_updated_at, p_at, p_at)
    returning * into v_pay;
    v_novo := true;
  else
    -- Fora de ordem ou repetido: so avanca. pendente -> qualquer; aprovado -> estornado | chargeback.
    if v_pay.status = p_status
       or (v_pay.status = 'aprovado' and p_status not in ('estornado', 'chargeback'))
       or (v_pay.status in ('recusado', 'estornado', 'chargeback') and p_status <> 'chargeback')
       or (v_pay.status = 'chargeback') then
      return query select 'sem_mudanca'::text, v_pay.id, v_pay.period_start, v_pay.period_end;
      return;
    end if;
    update billing.payment
       set status = p_status,
           paid_at = coalesce(paid_at, case when p_status = 'aprovado' then coalesce(p_paid_at, p_at) end),
           provider_updated_at = coalesce(p_provider_updated_at, provider_updated_at),
           updated_at = p_at
     where id = v_pay.id
    returning * into v_pay;
  end if;

  if v_pay.status <> 'aprovado' or v_pay.period_start is not null then
    return query select 'registrado'::text, v_pay.id,
                        v_pay.period_start, v_pay.period_end;
    return;
  end if;
  if exists (select 1 from billing.access_grant where source_payment_id = v_pay.id) then
    return query select 'sem_mudanca'::text, v_pay.id, v_pay.period_start, v_pay.period_end;
    return;
  end if;

  -- Regra de inicio (08 §8.4): encadeia no fim da concessao paga anterior quando o pagamento chega antes do fim
  -- ou dentro da carencia de 72 h (e nao houve cancelamento deliberado); senao, comeca no pagamento.
  select coalesce(s.cancel_at_period_end, false) into v_cancelada
    from billing.subscription s where s.professional_id = v_ck.professional_id;
  select max(g.ends_at) into v_prev_end
    from billing.access_grant g
   where g.professional_id = v_ck.professional_id and g.type = 'paid' and g.status = 'ativa';
  if v_prev_end is not null and not coalesce(v_cancelada, false)
     and v_pay.paid_at <= v_prev_end + interval '72 hours' then
    v_inicio := v_prev_end;
  else
    v_inicio := greatest(v_pay.paid_at, coalesce(v_prev_end, v_pay.paid_at));
  end if;
  v_fim := private.billing_add_months(v_inicio, v_ck.months);

  select pp.document_hmac into v_hmac from app.professional_profile pp where pp.user_id = v_ck.professional_id;
  if v_hmac is null then
    raise exception 'identidade_ausente' using errcode = '22023';
  end if;
  v_identity := private.identity_id_from_document_hmac(v_hmac);

  insert into billing.access_grant (professional_id, identity_id, type, starts_at, ends_at, source_payment_id, status)
  values (v_ck.professional_id, v_identity, 'paid', v_inicio, v_fim, v_pay.id, 'ativa')
  returning id into v_grant;

  update billing.payment set period_start = v_inicio, period_end = v_fim, updated_at = p_at where id = v_pay.id;

  -- Nova compra depois de um cancelamento reabre a assinatura; registra o plano e o modo da compra.
  update billing.subscription
     set plan_id = v_ck.plan_id,
         mode = case when v_ck.mode = 'recorrente' then 'cartao_recorrente' else mode end,
         provider_subscription_id = case when v_ck.mode = 'recorrente'
                                         then coalesce(p_provider_subscription_id, provider_subscription_id)
                                         else provider_subscription_id end,
         cancel_at_period_end = case when v_ck.mode = 'recorrente' or v_cancelada then false else cancel_at_period_end end,
         canceled_at = case when v_ck.mode = 'recorrente' or v_cancelada then null else canceled_at end,
         updated_at = p_at
   where professional_id = v_ck.professional_id;

  perform private.audit_append(
    'sistema:mercadopago', 'sistema', 'billing.paid.granted', 'access_grant', v_grant,
    '{}'::jsonb,
    jsonb_build_object(
      'type', 'paid',
      'status', 'ativa',
      'starts_at', to_char(v_inicio at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'ends_at', to_char(v_fim at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
    null, null);

  return query select 'concedido'::text, v_pay.id, v_inicio, v_fim;
end
$$;

