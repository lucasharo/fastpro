-- H-045 (Issue 58) | Acesso comercial derivado (docs/factory/114-DESENHO-H045.md, §3 a §7).
-- Expansao pura: billing.access_grant (livro de concessoes), billing.subscription (minima, decisao 270),
-- restricoes, indices, gatilho de imutabilidade, RLS forcada sem politica, grants, a leitura
-- private.commercial_access(prof, at) e a unica escrita da historia, private.access_grant_revoke (auditada na
-- mesma transacao, auditoria da Issue 19). Nenhuma tabela existente e alterada. Nenhum job, cron, tick ou gatilho de tempo (CA-H045-06).
-- Relogio injetado: a funcao nao le now() nem clock_timestamp(); o instante vem sempre do chamador (CA-H045-05).
-- Nao sobreposicao de pagas: restricao de exclusao com btree_gist (variante A, decisao 276). Compilada no DEV
-- com extensions.gist_uuid_ops (btree_gist 1.7). O plano B (gatilho com advisory lock) nao foi usado.
-- Idempotente (if not exists, create or replace, drop trigger if exists).
-- Desfazer: supabase/rollbacks/20261113170000_billing_create_access_grant.down.sql.

-- 1. Assinatura minima (decisoes 270 e 280): uma por profissional nesta etapa. Sem coluna de estado.
create table if not exists billing.subscription (
  id                   uuid primary key default gen_random_uuid(),
  professional_id      uuid not null unique references app.professional_profile (user_id) on delete restrict,
  mode                 text not null default 'manual'
                         check (mode in ('cartao_recorrente', 'manual')),
  cancel_at_period_end boolean not null default false,
  canceled_at          timestamptz,
  created_at           timestamptz not null default clock_timestamp(),
  constraint subscription_cancelamento_coerente
    check (canceled_at is null or cancel_at_period_end)
);

comment on table billing.subscription is
  'Assinatura minima do profissional (H-045, Issue 58). Campos de provedor entram em H-046/H-047; sem coluna de estado.';

-- 2. Livro de concessoes (decisoes 268, 271, 272, 275, 285, 287). Sem grace_until: carencia e derivada.
create table if not exists billing.access_grant (
  id                 uuid primary key default gen_random_uuid(),
  professional_id    uuid not null references app.professional_profile (user_id) on delete restrict,
  identity_id        uuid not null,
  type               text not null check (type in ('trial', 'paid', 'adjustment')),
  starts_at          timestamptz not null,
  ends_at            timestamptz not null check (ends_at > starts_at),
  source_payment_id  uuid,
  status             text not null default 'ativa' check (status in ('ativa', 'revogada')),
  revoked_at         timestamptz,
  created_at         timestamptz not null default clock_timestamp(),
  constraint access_grant_revogacao_coerente
    check ((status = 'revogada') = (revoked_at is not null)),
  constraint access_grant_trial_14d
    check (type <> 'trial' or ends_at - starts_at = interval '14 days'),
  constraint access_grant_paid_com_pagamento
    check (type <> 'paid' or source_payment_id is not null),
  constraint access_grant_trial_sem_pagamento
    check (type <> 'trial' or source_payment_id is null),
  constraint access_grant_pago_sem_sobreposicao
    exclude using gist (
      professional_id extensions.gist_uuid_ops with =,
      tstzrange(starts_at, ends_at, '[)') with &&
    ) where (type = 'paid' and status = 'ativa')
);

comment on table billing.access_grant is
  'Livro de concessoes de acesso comercial (H-045, Issue 58). Estado nao e gravado: commercial_access deriva na leitura. Imutavel (starts_at, ends_at, type); sem DELETE.';

-- Indices (114 §3.2). Trial unico por identidade inclui revogadas (nao reabre trial por revogacao).
create unique index if not exists access_grant_trial_unico
  on billing.access_grant (identity_id) where type = 'trial';
create unique index if not exists access_grant_pagamento_unico
  on billing.access_grant (source_payment_id) where source_payment_id is not null;
create index if not exists access_grant_consulta_idx
  on billing.access_grant (professional_id, ends_at desc) include (starts_at, type)
  where status = 'ativa' and type in ('trial', 'paid');

-- 3. Imutabilidade (decisao 275, CA-H045-08). Recusa UPDATE de colunas fixas, transicao fora de ativa->revogada,
-- DELETE e TRUNCATE. Mensagens fixas, sem valores (sem PII).
create or replace function private.access_grant_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'access_grant_sem_delete' using errcode = '23514';
  end if;
  if new.id is distinct from old.id
     or new.professional_id is distinct from old.professional_id
     or new.identity_id is distinct from old.identity_id
     or new.type is distinct from old.type
     or new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at
     or new.source_payment_id is distinct from old.source_payment_id
     or new.created_at is distinct from old.created_at then
    raise exception 'access_grant_imutavel' using errcode = '23514';
  end if;
  if new.status is distinct from old.status then
    if not (old.status = 'ativa' and new.status = 'revogada') then
      raise exception 'access_grant_transicao_invalida' using errcode = '23514';
    end if;
  elsif new.revoked_at is distinct from old.revoked_at then
    raise exception 'access_grant_imutavel' using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists access_grant_guard_bu on billing.access_grant;
create trigger access_grant_guard_bu
  before update on billing.access_grant
  for each row execute function private.access_grant_guard();

drop trigger if exists access_grant_sem_delete_bd on billing.access_grant;
create trigger access_grant_sem_delete_bd
  before delete on billing.access_grant
  for each row execute function private.access_grant_guard();

drop trigger if exists access_grant_sem_truncate_bt on billing.access_grant;
create trigger access_grant_sem_truncate_bt
  before truncate on billing.access_grant
  for each statement execute function private.access_grant_guard();

-- 4. Seguranca: RLS habilitada e forcada, sem politica (negacao por padrao). Leitura so para app_system (decisao 282).
alter table billing.access_grant enable row level security;
alter table billing.access_grant force row level security;
alter table billing.subscription enable row level security;
alter table billing.subscription force row level security;

revoke all on billing.access_grant, billing.subscription
  from public, anon, authenticated, service_role, app_api, app_system;
grant usage on schema billing to app_system;
grant select on billing.access_grant, billing.subscription to app_system;

-- 5. Catalogo de auditoria da revogacao (audit_event_action_fk). Sem este cadastro, a revogacao nao grava.
insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('billing.access_grant.revoke', 'access_grant', true,
   array['type', 'status', 'starts_at', 'ends_at'],
   'Concessao de acesso comercial revogada (H-045, Issue 58)')
on conflict (action, object_type) do nothing;

-- 6. Leitura do estado (114 §4, decisoes 267 a 269, 272, 283, 286). Uma linha sempre; so estado e access_until.
-- Relogio injetado: p_at e obrigatorio e o corpo nao le relogio nem job. Pago prevalece sobre trial (269).
-- Carencia de 72 h so para pago sem cancelamento; em ends_at + 72 h exatos o estado e expirada (267).
create or replace function private.commercial_access(p_professional_id uuid, p_at timestamptz)
returns table (estado text, access_until timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with g as (
    select type, starts_at, ends_at
      from billing.access_grant
     where professional_id = p_professional_id
       and status = 'ativa'
       and type in ('trial', 'paid')
  ),
  c as (
    select coalesce((select s.cancel_at_period_end
                       from billing.subscription s
                      where s.professional_id = p_professional_id), false) as cancelada
  ),
  pn as (select max(ends_at) as e from g where type = 'paid' and starts_at <= p_at and p_at < ends_at),
  pe as (select max(ends_at) as e from g where type = 'paid' and ends_at <= p_at),
  tn as (select max(ends_at) as e from g where type = 'trial' and starts_at <= p_at and p_at < ends_at),
  te as (select max(ends_at) as e from g where type = 'trial' and ends_at <= p_at)
  select
    case
      when pn.e is not null and c.cancelada then 'cancelada_com_acesso_ate_fim_do_periodo'
      when pn.e is not null then 'ativa'
      when pe.e is not null and not c.cancelada and p_at < pe.e + interval '72 hours' then 'em_carencia'
      when tn.e is not null then 'trial_ativo'
      when pe.e is not null and (te.e is null or pe.e >= te.e) then 'expirada'
      when te.e is not null then 'trial_expirado'
      else 'sem_acesso'
    end as estado,
    case
      when pn.e is not null then pn.e
      when pe.e is not null and not c.cancelada and p_at < pe.e + interval '72 hours'
        then pe.e + interval '72 hours'
      when tn.e is not null then tn.e
      else null
    end as access_until
  from c, pn, pe, tn, te;
$$;

-- 7. Revogacao (decisao 275, auditoria da Issue 19): ativa -> revogada, idempotente, auditada na mesma transacao.
-- Falha da auditoria desfaz a revogacao. before/after: so type, status, starts_at e ends_at (datas em UTC com Z,
-- sem '+', para passar em audit_state_is_valid). Sem identidade nem pagamento.
create or replace function private.access_grant_revoke(
  p_grant_id uuid,
  p_actor_ref text,
  p_actor_role text,
  p_reason_code text,
  p_correlation_id uuid default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row billing.access_grant%rowtype;
  v_agora timestamptz := clock_timestamp();
  v_before jsonb;
  v_after jsonb;
begin
  select * into v_row from billing.access_grant where id = p_grant_id for update;
  if not found then
    raise exception 'access_grant_nao_encontrado' using errcode = 'P0002';
  end if;
  if v_row.status = 'revogada' then
    return false;
  end if;

  v_before := jsonb_build_object(
    'type', v_row.type,
    'status', v_row.status,
    'starts_at', to_char(v_row.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'ends_at', to_char(v_row.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));

  update billing.access_grant
     set status = 'revogada', revoked_at = v_agora
   where id = p_grant_id;

  v_after := jsonb_build_object(
    'type', v_row.type,
    'status', 'revogada',
    'starts_at', to_char(v_row.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'ends_at', to_char(v_row.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));

  perform private.audit_append(
    p_actor_ref, p_actor_role, 'billing.access_grant.revoke', 'access_grant', p_grant_id,
    v_before, v_after, p_reason_code, p_correlation_id);
  return true;
end
$$;

-- 8. Privilegios de funcao (114 §3.6, decisoes 279 e 277). Gatilho e funcao de gatilho: sem execute para ninguem.
revoke all on function private.access_grant_guard()
  from public, anon, authenticated, service_role, app_api, app_system;
revoke all on function private.commercial_access(uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function private.commercial_access(uuid, timestamptz) to app_api, app_system;
revoke all on function private.access_grant_revoke(uuid, text, text, text, uuid)
  from public, anon, authenticated, service_role, app_api;
grant execute on function private.access_grant_revoke(uuid, text, text, text, uuid) to app_system;
