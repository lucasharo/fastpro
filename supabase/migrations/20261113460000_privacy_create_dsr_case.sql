-- Issue 120 (H-111) | Direitos do titular: caso (app.dsr_case), linha do tempo (app.dsr_case_event),
-- restricoes, maquina de estados e parametros privacy.* (docs/factory/147-DESENHO-H111.md §3.1 a §3.3 e §8, passo 1).
-- Fatia 1 do desenho: so tabelas, restricoes, gatilhos e parametros. Nao cria funcao de negocio (abertura,
-- cancelamento, extrato, anonimizacao), bucket, job ou alteracao de app.app_user (o CHECK de status fica na migracao 3).
-- Expansiva: duas tabelas novas, funcoes de gatilho novas e quatro linhas em ops.app_config.
-- Postura igual a H-039 (20261113200000): RLS forcada sem politicas; leitura so a app_system; nenhum papel de API,
-- anon, authenticated ou PUBLIC recebe escrita. Toda escrita futura passara por funcoes SECURITY DEFINER.
-- Idempotente (if not exists, create or replace, drop trigger if exists, where not exists).
-- Desfazer: supabase/rollbacks/20261113460000_privacy_create_dsr_case.down.sql (recusa se ja houver caso).

do $$
begin
  if to_regclass('app.app_user') is null
     or to_regclass('app.approval_request') is null
     or to_regclass('ops.app_config') is null
     or not exists (select 1 from pg_roles where rolname = 'app_system')
     or not exists (select 1 from pg_roles where rolname = 'app_api')
  then
    raise exception 'dsr_pre_requisito_ausente';
  end if;
end
$$;

-- 1. Funcoes puras de apoio --------------------------------------------------------------------------
-- Transicoes validas do caso (desenho §2). Qualquer par fora desta lista e recusado pelo gatilho.
-- Estados terminais (indeferido_*, concluido, cancelado) nao saem: a guarda recusa qualquer alteracao.
create or replace function private.dsr_case_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('aberto', 'em_analise'),
    ('aberto', 'cancelado'),
    ('aberto', 'deferido'),
    ('aberto', 'indeferido_parcial'),
    ('aberto', 'indeferido_total'),
    ('em_analise', 'deferido'),
    ('em_analise', 'indeferido_parcial'),
    ('em_analise', 'indeferido_total'),
    ('deferido', 'concluido'))
$$;

-- 2. app.dsr_case: um registro por direito exercido --------------------------------------------------
create table if not exists app.dsr_case (
  id                    uuid primary key default gen_random_uuid(),
  protocol              text not null unique
                          constraint dsr_case_protocol_check
                          check (protocol ~ '^DSR-[0-9]{8}-[A-Z2-7]{6}$'),
  subject_user_id       uuid not null references app.app_user (id) on delete restrict,
  kind                  text not null
                          constraint dsr_case_kind_check
                          check (kind in ('acesso', 'correcao', 'eliminacao', 'bloqueio', 'confirmacao')),
  status                text not null default 'aberto'
                          constraint dsr_case_status_check
                          check (status in ('aberto', 'em_analise', 'deferido', 'indeferido_parcial',
                            'indeferido_total', 'concluido', 'cancelado')),
  channel               text not null default 'titular'
                          constraint dsr_case_channel_check
                          check (channel in ('titular', 'dpo_externo')),
  opened_by_operator_id uuid references app.app_user (id) on delete restrict,
  request_details       jsonb not null default '{}'::jsonb
                          constraint dsr_case_details_check
                          check (jsonb_typeof(request_details) = 'object'
                            and octet_length(request_details::text) <= 8192),
  legal_basis_note      text
                          constraint dsr_case_nota_nao_vazia_check
                          check (legal_basis_note is null or legal_basis_note ~ '\S'),
  outcome               text
                          constraint dsr_case_outcome_check
                          check (outcome is null or outcome in ('extrato_disponibilizado', 'dados_corrigidos',
                            'conta_anonimizada', 'recusado_impedimento_legal', 'recusado_fraude_identidade',
                            'cancelado_pelo_titular')),
  assigned_to           uuid references app.app_user (id) on delete restrict,
  opened_at             timestamptz not null default now(),
  deadline_at           timestamptz not null,
  closed_at             timestamptz,
  approval_request_id   uuid references app.approval_request (id) on delete restrict,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint dsr_case_canal_operador_check
    check ((channel = 'dpo_externo') = (opened_by_operator_id is not null)),
  constraint dsr_case_prazo_check
    check (deadline_at >= opened_at),
  constraint dsr_case_fechamento_check
    check ((closed_at is null) = (status not in ('indeferido_parcial', 'indeferido_total', 'concluido', 'cancelado'))),
  constraint dsr_case_desfecho_check
    check (
      ((status in ('indeferido_parcial', 'indeferido_total', 'concluido', 'cancelado')) = (outcome is not null))
      and (outcome is null
        or (status = 'cancelado' and outcome = 'cancelado_pelo_titular')
        or (status in ('indeferido_parcial', 'indeferido_total')
            and outcome in ('recusado_impedimento_legal', 'recusado_fraude_identidade'))
        or (status = 'concluido' and (
              (outcome = 'extrato_disponibilizado' and kind = 'acesso')
           or (outcome = 'dados_corrigidos' and kind = 'correcao')
           or (outcome = 'conta_anonimizada' and kind = 'eliminacao'))))
    )
);

-- Um unico caso ativo por tipo e titular. "deferido" conta como ativo: o caso ainda esta em execucao (desenho D-A1).
create unique index if not exists dsr_case_um_ativo_por_tipo_uk
  on app.dsr_case (subject_user_id, kind)
  where status in ('aberto', 'em_analise', 'deferido');
create index if not exists dsr_case_titular_recente_idx
  on app.dsr_case (subject_user_id, opened_at desc);
create index if not exists dsr_case_fila_prazo_idx
  on app.dsr_case (status, deadline_at);
create index if not exists dsr_case_responsavel_ativo_idx
  on app.dsr_case (assigned_to) where status in ('aberto', 'em_analise');

comment on table app.dsr_case is
  'Caso de direito do titular (Issue 120, H-111). Estados e desfecho validados por gatilho e restricoes; escrita so por funcao.';

-- 3. app.dsr_case_event: linha do tempo visivel ao titular (so estados e codigos) -----------------------
create table if not exists app.dsr_case_event (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references app.dsr_case (id) on delete restrict,
  at          timestamptz not null default now(),
  event       text not null
                constraint dsr_case_event_check
                check (event in ('opened', 'assigned', 'status_changed', 'extract_ready', 'correction_applied',
                  'anonymized', 'closed', 'rejected', 'cancelled')),
  from_status text
                constraint dsr_case_event_from_check
                check (from_status is null or from_status in ('aberto', 'em_analise', 'deferido',
                  'indeferido_parcial', 'indeferido_total', 'concluido', 'cancelado')),
  to_status   text
                constraint dsr_case_event_to_check
                check (to_status is null or to_status in ('aberto', 'em_analise', 'deferido',
                  'indeferido_parcial', 'indeferido_total', 'concluido', 'cancelado')),
  actor_ref   uuid references app.app_user (id) on delete restrict,
  detail      jsonb not null default '{}'::jsonb
                constraint dsr_case_event_detail_check
                check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 2048)
);

create index if not exists dsr_case_event_caso_idx on app.dsr_case_event (case_id, at);

comment on table app.dsr_case_event is
  'Linha do tempo do caso de direito do titular (Issue 120, H-111). Append-only; sem dado pessoal em detail.';

-- 4. Gatilhos ------------------------------------------------------------------------------------------
-- Criacao: so nasce em aberto, ou ja indeferido_total quando ha retencao legal (desenho §4.1, passo 5).
create or replace function private.dsr_case_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status not in ('aberto', 'indeferido_total') then
    raise exception 'dsr_criacao_estado_invalido' using errcode = '23514';
  end if;
  if new.status = 'indeferido_total' and (new.legal_basis_note is null or new.legal_basis_note !~ '\S') then
    raise exception 'nota_base_legal_obrigatoria' using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists dsr_case_insert_guard on app.dsr_case;
create trigger dsr_case_insert_guard
  before insert on app.dsr_case
  for each row execute function private.dsr_case_insert_guard();

-- Atualizacao: identidade imutavel, maquina de estados, base legal obrigatoria e terminal que nao muda.
create or replace function private.dsr_case_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.protocol is distinct from old.protocol
     or new.subject_user_id is distinct from old.subject_user_id
     or new.kind is distinct from old.kind
     or new.channel is distinct from old.channel
     or new.opened_by_operator_id is distinct from old.opened_by_operator_id
     or new.opened_at is distinct from old.opened_at
     or new.deadline_at is distinct from old.deadline_at
     or new.created_at is distinct from old.created_at then
    raise exception 'dsr_case_imutavel' using errcode = '42501';
  end if;
  if old.status in ('indeferido_parcial', 'indeferido_total', 'concluido', 'cancelado') then
    raise exception 'violacao_maquina_estados' using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and not private.dsr_case_transition_allowed(old.status, new.status) then
    raise exception 'violacao_maquina_estados' using errcode = '42501';
  end if;
  if (new.status in ('indeferido_parcial', 'indeferido_total')
      or (new.status = 'concluido' and new.kind = 'eliminacao'))
     and (new.legal_basis_note is null or new.legal_basis_note !~ '\S') then
    raise exception 'nota_base_legal_obrigatoria' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists dsr_case_guard on app.dsr_case;
create trigger dsr_case_guard
  before update on app.dsr_case
  for each row execute function private.dsr_case_guard();

-- Sem exclusao do caso (a prova de atendimento e retida) nem truncamento.
create or replace function private.dsr_case_refuse_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'dsr_case_nao_deletavel' using errcode = '42501';
end
$$;

drop trigger if exists dsr_case_no_delete on app.dsr_case;
create trigger dsr_case_no_delete
  before delete or truncate on app.dsr_case
  for each statement execute function private.dsr_case_refuse_delete();

-- Linha do tempo append-only: nenhuma alteracao nem exclusao.
create or replace function private.dsr_case_event_refuse_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'dsr_evento_imutavel' using errcode = '42501';
end
$$;

drop trigger if exists dsr_case_event_no_mutation on app.dsr_case_event;
create trigger dsr_case_event_no_mutation
  before update or delete or truncate on app.dsr_case_event
  for each statement execute function private.dsr_case_event_refuse_mutation();

-- 5. Postura de seguranca: RLS forcada sem politicas; so leitura para app_system -----------------------
alter table app.dsr_case enable row level security;
alter table app.dsr_case force row level security;
alter table app.dsr_case_event enable row level security;
alter table app.dsr_case_event force row level security;

revoke all on app.dsr_case, app.dsr_case_event
  from public, anon, authenticated, app_api;
grant select on app.dsr_case, app.dsr_case_event to app_system;

-- 6. Parametros de prazo e de exportacao (valores [PROPOSTA]; pendencia juridica registrada no desenho) -----
insert into ops.app_config (key, value, version, updated_by)
select v.key, v.value, 1, 'migration:20261113460000'
  from (values
    ('privacy.dsr_deadline_days', '15'::jsonb),
    ('privacy.dsr_export_ttl_days', '7'::jsonb),
    ('privacy.dsr_export_min_interval_days', '30'::jsonb),
    ('privacy.dsr_step_up_minutes', '15'::jsonb)
  ) as v (key, value)
 where not exists (select 1 from ops.app_config c where c.key = v.key);
