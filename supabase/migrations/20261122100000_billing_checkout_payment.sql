-- E5 (Issues 60 a 67, H-047 a H-054) | Cobranca pelo Mercado Pago em sandbox: checkout, pagamento, webhook
-- idempotente, concessao paga com inicio de periodo (08 §8.4), adesao a renovacao no cartao, cancelamento ao fim do
-- periodo e registro de divergencias da reconciliacao. A carencia de 72 h continua derivada em
-- private.commercial_access (H-045); Pix pendente nao gera concessao.
-- Regras: o estado vem sempre do recurso consultado na API do Mercado Pago (nunca do corpo do webhook); boleto nao
-- existe (CHECK); toda escrita e por funcao security definer chamada pelo papel app_system; sem dado de cartao.
-- Relogio injetado: as funcoes recebem o instante do chamador.
-- Idempotente (if not exists, create or replace). Desfazer: supabase/rollbacks/20261122100000_billing_checkout_payment.down.sql.

-- 1. Assinatura: campos do provedor e da adesao expressa (H-051).
alter table billing.subscription add column if not exists plan_id uuid references billing.plan (id) on delete restrict;
alter table billing.subscription add column if not exists provider text not null default 'mercadopago'
  check (provider = 'mercadopago');
alter table billing.subscription add column if not exists provider_subscription_id text;
alter table billing.subscription add column if not exists auto_renew_opt_in_at timestamptz;
alter table billing.subscription add column if not exists auto_renew_text_version text;
alter table billing.subscription add column if not exists status_provider text;
alter table billing.subscription add column if not exists updated_at timestamptz not null default clock_timestamp();

create unique index if not exists subscription_provider_unico
  on billing.subscription (provider_subscription_id) where provider_subscription_id is not null;

-- 2. Intencao de compra (o external_reference enviado ao Mercado Pago e o id desta linha).
create table if not exists billing.checkout (
  id                uuid primary key default gen_random_uuid(),
  professional_id   uuid not null references app.professional_profile (user_id) on delete restrict,
  plan_id           uuid not null references billing.plan (id) on delete restrict,
  plan_price_id     uuid not null references billing.plan_price (id) on delete restrict,
  amount_cents      integer not null check (amount_cents > 0),
  months            integer not null check (months in (1, 3, 6, 12)),
  method            text not null check (method in ('cartao', 'pix')),
  mode              text not null check (mode in ('avulso', 'recorrente')),
  auto_renew_text_version text,
  provider_ref      text,
  created_at        timestamptz not null,
  constraint checkout_recorrente_so_cartao check (mode <> 'recorrente' or method = 'cartao'),
  constraint checkout_recorrente_com_adesao check (mode <> 'recorrente' or auto_renew_text_version is not null)
);

create unique index if not exists checkout_provider_ref_unico
  on billing.checkout (provider_ref) where provider_ref is not null;
create index if not exists checkout_profissional_idx on billing.checkout (professional_id, created_at desc);

-- 3. Pagamentos (sem boleto, H5). Unico por pagamento do provedor.
create table if not exists billing.payment (
  id                   uuid primary key default gen_random_uuid(),
  professional_id      uuid not null references app.professional_profile (user_id) on delete restrict,
  checkout_id          uuid not null references billing.checkout (id) on delete restrict,
  subscription_id      uuid references billing.subscription (id) on delete restrict,
  provider             text not null default 'mercadopago' check (provider = 'mercadopago'),
  provider_payment_id  text not null,
  method               text not null check (method in ('cartao', 'pix')),
  amount_cents         integer not null check (amount_cents > 0),
  plan_price_id        uuid not null references billing.plan_price (id) on delete restrict,
  status               text not null check (status in ('aprovado', 'pendente', 'recusado', 'estornado', 'chargeback')),
  paid_at              timestamptz,
  period_start         timestamptz,
  period_end           timestamptz,
  provider_updated_at  timestamptz,
  created_at           timestamptz not null default clock_timestamp(),
  updated_at           timestamptz not null default clock_timestamp(),
  constraint payment_provider_unico unique (provider, provider_payment_id),
  constraint payment_aprovado_com_data check (status <> 'aprovado' or paid_at is not null),
  constraint payment_periodo_coerente check ((period_start is null) = (period_end is null))
);

create index if not exists payment_profissional_idx on billing.payment (professional_id, created_at desc);

-- 4. Caixa de entrada do provedor (webhook). Unico por (provider, event_key): reenvio nao duplica efeito.
create table if not exists billing.provider_event (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null default 'mercadopago',
  event_key     text not null,
  topic         text not null,
  resource_id   text not null,
  received_at   timestamptz not null,
  signature_ok  boolean not null,
  processed_at  timestamptz,
  outcome       text,
  constraint provider_event_unico unique (provider, event_key)
);

-- 5. Divergencias da reconciliacao diaria (H-053). Nunca corrige acesso: so registra para o Financeiro.
create table if not exists billing.reconciliation_issue (
  id                   uuid primary key default gen_random_uuid(),
  found_at             timestamptz not null,
  kind                 text not null check (kind in ('ausente_no_livro', 'status_divergente', 'valor_divergente')),
  provider_payment_id  text not null,
  provider_status      text,
  ledger_status        text,
  resolved_at          timestamptz,
  constraint reconciliation_issue_unico unique (kind, provider_payment_id)
);

-- 6. Seguranca: RLS forcada sem politica; leitura e escrita so pelas funcoes (app_system).
alter table billing.checkout enable row level security;
alter table billing.checkout force row level security;
alter table billing.payment enable row level security;
alter table billing.payment force row level security;
alter table billing.provider_event enable row level security;
alter table billing.provider_event force row level security;
alter table billing.reconciliation_issue enable row level security;
alter table billing.reconciliation_issue force row level security;

revoke all on billing.checkout, billing.payment, billing.provider_event, billing.reconciliation_issue
  from public, anon, authenticated, service_role, app_api, app_system;
grant select on billing.checkout, billing.payment, billing.provider_event, billing.reconciliation_issue to app_system;

insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('billing.paid.granted', 'access_grant', false,
   array['type', 'status', 'starts_at', 'ends_at'],
   'Periodo pago concedido por pagamento aprovado no Mercado Pago (H-049, Issue 62)'),
  ('billing.subscription.cancel', 'subscription', false,
   array['cancel_at_period_end'],
   'Assinatura cancelada pelo profissional com acesso ate o fim do periodo (H-052, Issue 65)')
on conflict (action, object_type) do nothing;

-- 7. Fim do periodo em meses civis no fuso de Sao Paulo (08 §8.4).
create or replace function private.billing_add_months(p_start timestamptz, p_months integer)
returns timestamptz
language sql
immutable
strict
set search_path = ''
as $$
  select ((p_start at time zone 'America/Sao_Paulo') + make_interval(months => p_months)) at time zone 'America/Sao_Paulo';
$$;

-- 8. Cria a intencao de compra com o preco vigente (RN-H046-06: o preco do momento fica gravado).
-- Codigos: ok | not_verified | plano_invalido | metodo_invalido (boleto e qualquer outro) | adesao_obrigatoria.
create or replace function private.billing_checkout_create(
  p_professional_id uuid,
  p_plan_code text,
  p_method text,
  p_auto_renew boolean,
  p_auto_renew_text_version text,
  p_at timestamptz
) returns table (
  out_code text,
  out_checkout_id uuid,
  out_amount_cents integer,
  out_months integer,
  out_mode text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_preco record;
  v_modo text;
  v_id uuid;
begin
  if p_professional_id is null or p_at is null then
    raise exception 'entrada_invalida' using errcode = '22023';
  end if;
  if p_method is null or p_method not in ('cartao', 'pix') then
    return query select 'metodo_invalido'::text, null::uuid, null::integer, null::integer, null::text;
    return;
  end if;
  select pp.verification_status into v_status from app.professional_profile pp where pp.user_id = p_professional_id;
  if not found or v_status is distinct from 'aprovada' then
    return query select 'not_verified'::text, null::uuid, null::integer, null::integer, null::text;
    return;
  end if;
  if p_plan_code is null or p_plan_code not in ('mensal', 'trimestral', 'semestral', 'anual') then
    return query select 'plano_invalido'::text, null::uuid, null::integer, null::integer, null::text;
    return;
  end if;
  select p.id as plan_id, pr.plan_price_id, pr.amount_cents, pr.months into v_preco
    from private.plan_price_at(p_at, p_plan_code) pr
    join billing.plan p on p.code = pr.plan_code;
  if not found then
    return query select 'plano_invalido'::text, null::uuid, null::integer, null::integer, null::text;
    return;
  end if;
  v_modo := case when p_method = 'cartao' and coalesce(p_auto_renew, false) then 'recorrente' else 'avulso' end;
  if v_modo = 'recorrente' and coalesce(trim(p_auto_renew_text_version), '') = '' then
    return query select 'adesao_obrigatoria'::text, null::uuid, null::integer, null::integer, null::text;
    return;
  end if;
  insert into billing.checkout (professional_id, plan_id, plan_price_id, amount_cents, months, method, mode,
                                auto_renew_text_version, created_at)
  values (p_professional_id, v_preco.plan_id, v_preco.plan_price_id, v_preco.amount_cents, v_preco.months, p_method,
          v_modo, case when v_modo = 'recorrente' then p_auto_renew_text_version end, p_at)
  returning id into v_id;
  return query select 'ok'::text, v_id, v_preco.amount_cents, v_preco.months, v_modo;
end
$$;

-- 9. Guarda o identificador do provedor (preferencia ou plano de assinatura) na intencao.
create or replace function private.billing_checkout_set_provider_ref(p_checkout_id uuid, p_provider_ref text)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  with u as (
    update billing.checkout set provider_ref = p_provider_ref
     where id = p_checkout_id and provider_ref is null
    returning 1
  )
  select exists (select 1 from u);
$$;

-- 10. Le a intencao por id ou por provider_ref (o plano de assinatura do Mercado Pago).
create or replace function private.billing_checkout_get(p_checkout_id uuid, p_provider_ref text)
returns table (
  out_checkout_id uuid,
  out_professional_id uuid,
  out_amount_cents integer,
  out_months integer,
  out_method text,
  out_mode text,
  out_provider_ref text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.professional_id, c.amount_cents, c.months, c.method, c.mode, c.provider_ref
    from billing.checkout c
   where (p_checkout_id is not null and c.id = p_checkout_id)
      or (p_checkout_id is null and p_provider_ref is not null and c.provider_ref = p_provider_ref)
   limit 1;
$$;

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

-- 12. Liga a assinatura recorrente do provedor ao profissional (adesao expressa registrada, H-051).
create or replace function private.billing_subscription_link(
  p_checkout_id uuid,
  p_provider_subscription_id text,
  p_status_provider text,
  p_at timestamptz
) returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ck billing.checkout%rowtype;
begin
  select * into v_ck from billing.checkout where id = p_checkout_id;
  if not found or v_ck.mode <> 'recorrente' then
    return 'checkout_desconhecido';
  end if;
  if exists (select 1 from billing.subscription
              where provider_subscription_id = p_provider_subscription_id
                and professional_id <> v_ck.professional_id) then
    return 'assinatura_de_outro';
  end if;
  insert into billing.subscription (professional_id, plan_id, mode, provider_subscription_id, auto_renew_opt_in_at,
                                    auto_renew_text_version, status_provider, updated_at)
  values (v_ck.professional_id, v_ck.plan_id, 'cartao_recorrente', p_provider_subscription_id, p_at,
          v_ck.auto_renew_text_version, p_status_provider, p_at)
  on conflict (professional_id) do update
     set plan_id = excluded.plan_id,
         mode = 'cartao_recorrente',
         provider_subscription_id = excluded.provider_subscription_id,
         auto_renew_opt_in_at = coalesce(
           case when billing.subscription.provider_subscription_id is distinct from excluded.provider_subscription_id
                then null else billing.subscription.auto_renew_opt_in_at end, excluded.auto_renew_opt_in_at),
         auto_renew_text_version = excluded.auto_renew_text_version,
         status_provider = excluded.status_provider,
         cancel_at_period_end = case when excluded.status_provider = 'cancelled'
                                     then true else billing.subscription.cancel_at_period_end end,
         canceled_at = case when excluded.status_provider = 'cancelled'
                            then coalesce(billing.subscription.canceled_at, p_at) else billing.subscription.canceled_at end,
         updated_at = p_at;
  return 'ok';
end
$$;

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

-- 14. Situacao para a tela do profissional: acesso derivado, assinatura e ultimos pagamentos.
create or replace function private.billing_status(p_professional_id uuid, p_at timestamptz)
returns table (
  out_estado text,
  out_access_until timestamptz,
  out_plan_code text,
  out_mode text,
  out_cancel_at_period_end boolean,
  out_auto_renew boolean,
  out_payments jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select ca.estado, ca.access_until, p.code, s.mode, coalesce(s.cancel_at_period_end, false),
         (s.mode = 'cartao_recorrente' and not coalesce(s.cancel_at_period_end, false)),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'method', x.method, 'amount_cents', x.amount_cents, 'status', x.status,
                    'paid_at', x.paid_at, 'period_start', x.period_start, 'period_end', x.period_end)
                  order by x.created_at desc)
             from (select * from billing.payment where professional_id = p_professional_id
                    order by created_at desc limit 10) x), '[]'::jsonb)
    from private.commercial_access(p_professional_id, p_at) ca
    left join billing.subscription s on s.professional_id = p_professional_id
    left join billing.plan p on p.id = s.plan_id;
$$;

-- 15. Caixa de entrada do webhook: grava uma vez por evento; devolve se e novo.
create or replace function private.billing_event_record(
  p_event_key text,
  p_topic text,
  p_resource_id text,
  p_signature_ok boolean,
  p_at timestamptz
) returns table (out_event_id uuid, out_new boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into billing.provider_event (provider, event_key, topic, resource_id, received_at, signature_ok)
  values ('mercadopago', p_event_key, p_topic, p_resource_id, p_at, p_signature_ok)
  on conflict (provider, event_key) do nothing
  returning id into v_id;
  if v_id is not null then
    return query select v_id, true;
    return;
  end if;
  select id into v_id from billing.provider_event where provider = 'mercadopago' and event_key = p_event_key;
  return query select v_id, (select processed_at is null from billing.provider_event where id = v_id);
end
$$;

create or replace function private.billing_event_finish(p_event_id uuid, p_outcome text, p_at timestamptz)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update billing.provider_event set processed_at = p_at, outcome = p_outcome where id = p_event_id;
$$;

-- 16. Reconciliacao (H-053): intencoes recentes a conferir e registro de divergencia (sem efeito no acesso).
create or replace function private.billing_reconciliation_targets(p_since timestamptz)
returns table (out_checkout_id uuid, out_amount_cents integer)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.amount_cents from billing.checkout c where c.created_at >= p_since order by c.created_at;
$$;

create or replace function private.billing_payment_ledger(p_provider_payment_id text)
returns table (out_status text, out_amount_cents integer)
language sql
stable
security definer
set search_path = ''
as $$
  select status, amount_cents from billing.payment
   where provider = 'mercadopago' and provider_payment_id = p_provider_payment_id;
$$;

create or replace function private.billing_reconciliation_record(
  p_kind text,
  p_provider_payment_id text,
  p_provider_status text,
  p_ledger_status text,
  p_at timestamptz
) returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  with i as (
    insert into billing.reconciliation_issue (found_at, kind, provider_payment_id, provider_status, ledger_status)
    values (p_at, p_kind, p_provider_payment_id, p_provider_status, p_ledger_status)
    on conflict (kind, provider_payment_id) do nothing
    returning 1
  )
  select exists (select 1 from i);
$$;

-- 17. Privilegios: so app_system executa.
do $$
declare
  f text;
begin
  foreach f in array array[
    'private.billing_add_months(timestamptz, integer)',
    'private.billing_checkout_create(uuid, text, text, boolean, text, timestamptz)',
    'private.billing_checkout_set_provider_ref(uuid, text)',
    'private.billing_checkout_get(uuid, text)',
    'private.billing_payment_apply(uuid, text, text, integer, text, timestamptz, timestamptz, text, timestamptz)',
    'private.billing_subscription_link(uuid, text, text, timestamptz)',
    'private.billing_subscription_cancel(uuid, timestamptz)',
    'private.billing_status(uuid, timestamptz)',
    'private.billing_event_record(text, text, text, boolean, timestamptz)',
    'private.billing_event_finish(uuid, text, timestamptz)',
    'private.billing_reconciliation_targets(timestamptz)',
    'private.billing_payment_ledger(text)',
    'private.billing_reconciliation_record(text, text, text, text, timestamptz)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role, app_api', f);
    execute format('grant execute on function %s to app_system', f);
  end loop;
end
$$;
