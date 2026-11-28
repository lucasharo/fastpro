-- H-046 (Issue 59) | Planos e precos em centavos (docs/factory/120-DESENHO-H046.md, §2 a §6).
-- Expansao pura: billing.plan (quatro planos fixos), billing.plan_price (precos em centavos com vigencia
-- [valid_from, valid_to)), restricoes, indice, gatilhos de imutabilidade, RLS forcada sem politica, grants,
-- a leitura private.plan_price_at(p_at, p_plan_code) e a carga de referencia idempotente (decisoes 295 e 346).
-- Nenhuma tabela existente e alterada. Nenhum job, cron, tick, relogio do banco ou evento.
-- Relogio injetado: a funcao nao le relogio do banco; o instante vem sempre do chamador.
-- Sem beneficio, limite, desconto ou promocao (decisoes 292 e 296). Sem subscription.plan_id nem FK de pagamento (decisao 347).
-- Um preco vigente por plano: restricao de exclusao com btree_gist (extensions.gist_uuid_ops), como em H-045 (decisao 294).
-- Idempotente (if not exists, create or replace, drop trigger if exists, carga com not exists).
-- Desfazer: supabase/rollbacks/20261113190000_billing_create_plan_pricing.down.sql.

-- 1. Planos (decisoes 291 e 343). Quatro linhas fixas; sem coluna active, beneficio ou desconto.
create table if not exists billing.plan (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  months      integer not null unique,
  created_at  timestamptz not null default clock_timestamp(),
  constraint plan_code_months
    check ((code, months) in (('mensal', 1), ('trimestral', 3), ('semestral', 6), ('anual', 12)))
);

comment on table billing.plan is
  'Planos do MVP (H-046, Issue 59). Quatro linhas fixas; imutavel por inteiro (sem UPDATE, DELETE ou TRUNCATE).';

-- 2. Precos em centavos inteiros (RN-H046-01 e RN-H046-02). Vigencia semiaberta [valid_from, valid_to).
create table if not exists billing.plan_price (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references billing.plan (id) on delete restrict,
  amount_cents  integer not null check (amount_cents > 0),
  currency      text not null default 'BRL' check (currency = 'BRL'),
  valid_from    timestamptz not null,
  valid_to      timestamptz,
  created_at    timestamptz not null default clock_timestamp(),
  constraint plan_price_vigencia_valida
    check (valid_to is null or valid_to > valid_from),
  constraint plan_price_sem_sobreposicao
    exclude using gist (
      plan_id extensions.gist_uuid_ops with =,
      tstzrange(valid_from, valid_to, '[)') with &&
    )
);

comment on table billing.plan_price is
  'Precos vigentes por plano (H-046, Issue 59). Valor imutavel; so valid_to pode ser fechado uma vez; sem DELETE.';

create index if not exists plan_price_vigencia_idx
  on billing.plan_price (plan_id, valid_from desc) include (valid_to, amount_cents);

-- 3. Imutabilidade do plano (CA-H046-08). Qualquer UPDATE, DELETE ou TRUNCATE e recusado.
create or replace function private.billing_plan_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'plan_imutavel' using errcode = '23514';
end
$$;

drop trigger if exists plan_guard_bu on billing.plan;
create trigger plan_guard_bu
  before update on billing.plan
  for each row execute function private.billing_plan_guard();

drop trigger if exists plan_guard_bd on billing.plan;
create trigger plan_guard_bd
  before delete on billing.plan
  for each row execute function private.billing_plan_guard();

drop trigger if exists plan_guard_bt on billing.plan;
create trigger plan_guard_bt
  before truncate on billing.plan
  for each statement execute function private.billing_plan_guard();

-- 4. Imutabilidade do preco (CA-H046-08). Valor e vigencia de inicio fixos; valid_to fecha-se uma vez, para
-- um instante posterior a valid_from. Mensagens fixas, sem valores (sem dado de preco no log).
create or replace function private.billing_plan_price_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'plan_price_sem_delete' using errcode = '23514';
  end if;
  if new.id is distinct from old.id
     or new.plan_id is distinct from old.plan_id
     or new.amount_cents is distinct from old.amount_cents
     or new.currency is distinct from old.currency
     or new.valid_from is distinct from old.valid_from
     or new.created_at is distinct from old.created_at then
    raise exception 'plan_price_imutavel' using errcode = '23514';
  end if;
  if new.valid_to is distinct from old.valid_to then
    if old.valid_to is not null then
      raise exception 'plan_price_imutavel' using errcode = '23514';
    end if;
    if new.valid_to is null or new.valid_to <= old.valid_from then
      raise exception 'plan_price_fechamento_invalido' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists plan_price_guard_bu on billing.plan_price;
create trigger plan_price_guard_bu
  before update on billing.plan_price
  for each row execute function private.billing_plan_price_guard();

drop trigger if exists plan_price_sem_delete_bd on billing.plan_price;
create trigger plan_price_sem_delete_bd
  before delete on billing.plan_price
  for each row execute function private.billing_plan_price_guard();

drop trigger if exists plan_price_sem_truncate_bt on billing.plan_price;
create trigger plan_price_sem_truncate_bt
  before truncate on billing.plan_price
  for each statement execute function private.billing_plan_price_guard();

-- 5. Seguranca (CA-H046-11): RLS habilitada e forcada, sem politica (negacao por padrao). Leitura so para app_system.
alter table billing.plan enable row level security;
alter table billing.plan force row level security;
alter table billing.plan_price enable row level security;
alter table billing.plan_price force row level security;

revoke all on billing.plan, billing.plan_price
  from public, anon, authenticated, service_role, app_api, app_system;
grant usage on schema billing to app_system;
grant select on billing.plan, billing.plan_price to app_system;

revoke all on function private.billing_plan_guard(), private.billing_plan_price_guard()
  from public, anon, authenticated, service_role, app_api, app_system;

-- 6. Leitura por instante (CA-H046-03, 06, 09, 12; decisao 348). Uma funcao com filtro opcional por codigo.
-- Relogio injetado: p_at e obrigatorio e o corpo nao le relogio. Fronteira [valid_from, valid_to): em T vale o novo.
-- Devolve plan_price_id e amount_cents juntos: H-047 grava os dois no pagamento (RN-H046-06).
create or replace function private.plan_price_at(p_at timestamptz, p_plan_code text default null)
returns table (plan_code text, months integer, plan_price_id uuid, amount_cents integer, currency text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.code, p.months, pp.id, pp.amount_cents, pp.currency
    from billing.plan p
    join billing.plan_price pp on pp.plan_id = p.id
   where pp.valid_from <= p_at
     and (pp.valid_to is null or p_at < pp.valid_to)
     and (p_plan_code is null or p.code = p_plan_code)
   order by p.months;
$$;

revoke all on function private.plan_price_at(timestamptz, text) from public, anon, authenticated, service_role;
grant execute on function private.plan_price_at(timestamptz, text) to app_api, app_system;

-- 7. Carga de referencia (decisoes 295 e 346). Dado de referencia, nao de demonstracao: vale em qualquer ambiente.
-- Idempotente: planos por on conflict; precos so para plano que ainda nao tem nenhum preco (reaplicar nao recria valor antigo).
insert into billing.plan (code, months) values
  ('mensal', 1), ('trimestral', 3), ('semestral', 6), ('anual', 12)
on conflict (code) do nothing;

insert into billing.plan_price (plan_id, amount_cents, currency, valid_from)
select p.id, v.cents, 'BRL', timestamptz '2026-01-01 00:00:00+00'
  from billing.plan p
  join (values ('mensal', 2990), ('trimestral', 8070), ('semestral', 14940), ('anual', 23880)) as v(code, cents)
    on v.code = p.code
 where not exists (select 1 from billing.plan_price x where x.plan_id = p.id);
