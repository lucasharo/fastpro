-- H-109 (#118) | Mecanismo de retencao sem prazos (docs/factory/82-DESENHO-H109.md §1 a §5; 79-REFINO-H109).
-- Idempotente. Desfazer: supabase/rollbacks/20261111470000_retention_create_policy.down.sql (manual, so em dev).
-- Numero 20261111470000 (nao 20261111450000 do desenho): 450000 e de catalog_revision_list e 460000 e da H-105.
-- Depende de 20261111460000 (guarda de voto e tipos de aprovacao da H-105), 20261111220000 (RBAC, approval_request, approval_vote, approval_vote_guard) e de
-- 20261111400000 / 20261111420000 (professional_profile) e 20261111150000 (app_user).
-- NENHUM prazo entra aqui: period nasce nulo, enabled=false, dry_run=true em todas as classes (CA-H109-01 e 11).
-- Postura igual a H-102: RLS forcada, sem politicas; PUBLIC/anon/authenticated/service_role/app_api sem
-- privilegio; so app_system le as tabelas e executa as funcoes. Escrita so por funcao security definer.
-- audit.audit_event nao e tocado (CA-H109-08): so chamadas a private.audit_append.

-- 0. Aprovacao do tipo 'retencao_politica' (82 §5). Lista completa vigente (H-105 em 20261111460000 ja inclui
-- estorno e suspensao_permanente; esta lista os preserva). Guarda de voto recriada com o ramo de retencao.
alter table app.approval_request drop constraint if exists approval_request_action_type_check;
alter table app.approval_request add constraint approval_request_action_type_check
  check (action_type in ('papel_superadmin', 'mfa_reenroll', 'acesso_conversa', 'estorno', 'suspensao_permanente',
                         'retencao_politica'));

-- Detalhe obrigatorio para papel_superadmin e retencao_politica (id da mudanca ou 'hold:<id>').
alter table app.approval_request drop constraint if exists approval_request_detalhe_por_acao;
alter table app.approval_request add constraint approval_request_detalhe_por_acao
  check ((action_type in ('papel_superadmin', 'retencao_politica')) = (detail_code is not null));

-- Guarda de voto: copia da H-105 (20261111460000) com o ramo retencao_politica (aprovador com a permissao do
-- cadastro ou do hold; Superadmin nao herda). Ramos existentes nao mudam.
create or replace function private.approval_vote_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_req app.approval_request%rowtype;
begin
  select * into v_req from app.approval_request r where r.id = new.approval_request_id;
  if not found then
    raise exception 'aprovacao_inexistente' using errcode = '23503';
  end if;
  if v_req.status <> 'pendente' then
    raise exception 'aprovacao_nao_pendente' using errcode = '23514';
  end if;
  if new.approver_id = v_req.requested_by or new.approver_id = v_req.subject_user_id then
    raise exception 'aprovacao_propria' using errcode = '42501';
  end if;
  if not exists (select 1 from app.admin_staff s where s.user_id = new.approver_id and s.status = 'ativo') then
    raise exception 'aprovador_nao_ativo' using errcode = '42501';
  end if;

  if v_req.action_type = 'acesso_conversa' then
    if not private.admin_has_permission(new.approver_id, 'case.authorize_sensitive') then
      raise exception 'aprovador_sem_permissao' using errcode = '42501';
    end if;
  elsif v_req.action_type = 'estorno' then
    if not private.admin_has_permission(new.approver_id, 'finance.refund.approve') then
      raise exception 'aprovador_sem_permissao' using errcode = '42501';
    end if;
  elsif v_req.action_type = 'suspensao_permanente' then
    if new.approver_id = v_req.subject_ref then
      raise exception 'aprovacao_propria' using errcode = '42501';
    end if;
    if not private.admin_has_permission(new.approver_id, 'account.suspend.approve') then
      raise exception 'aprovador_sem_permissao' using errcode = '42501';
    end if;
  elsif v_req.action_type = 'retencao_politica' then
    if not private.admin_has_permission(
         new.approver_id,
         case when v_req.detail_code like 'hold:%' then 'retention.hold.manage' else 'retention.policy.manage' end) then
      raise exception 'aprovador_sem_permissao' using errcode = '42501';
    end if;
  else
    if not exists (
      select 1
        from app.admin_staff s
        join app.admin_user_role r on r.user_id = s.user_id and r.revoked_at is null
       where s.user_id = new.approver_id and s.status = 'ativo' and r.role_code = 'superadmin'
    ) then
      raise exception 'aprovador_nao_superadmin' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

-- 1. Papel, permissoes e mapa (82 §5; A-1: governanca_dados; Superadmin nao herda) -----------------------
insert into app.admin_role (code, label) values ('governanca_dados', 'Governanca de dados')
on conflict (code) do nothing;

insert into app.admin_permission (code, label) values
  ('retention.policy.manage', 'Gerir politica de retencao'),
  ('retention.hold.manage', 'Gerir bloqueio legal (hold)')
on conflict (code) do nothing;

insert into app.admin_role_permission (role_code, permission_code) values
  ('governanca_dados', 'retention.policy.manage'),
  ('governanca_dados', 'retention.hold.manage')
on conflict do nothing;

-- 2. Estado de retencao nas linhas que o expurgo alcanca (RC-01 e RC-02; 82 §2 e §4) ---------------------
alter table app.professional_profile add column if not exists retention_state text;
alter table app.professional_profile drop constraint if exists professional_profile_retention_state;
alter table app.professional_profile add constraint professional_profile_retention_state
  check (retention_state is null or retention_state in ('expurgando', 'expurgado'));

alter table app.app_user add column if not exists retention_state text;
alter table app.app_user add column if not exists anonymized_at timestamptz;
alter table app.app_user drop constraint if exists app_user_retention_state;
alter table app.app_user add constraint app_user_retention_state
  check (retention_state is null or retention_state in ('expurgando', 'expurgado'));
alter table app.app_user drop constraint if exists app_user_anonimizado_consistente;
alter table app.app_user add constraint app_user_anonimizado_consistente
  check (anonymized_at is null or retention_state = 'expurgado');

-- 3. app.retention_policy: uma linha por classe. Sem prazo, sem base legal e desligada na semeadura ----
create table if not exists app.retention_policy (
  id                uuid primary key,
  data_class        text not null unique
                      check (data_class in ('RC-01', 'RC-02', 'RC-03', 'RC-04', 'RC-05', 'RC-06', 'RC-07', 'RC-10')),
  trigger_event     text check (trigger_event is null or trigger_event ~ '^[a-z][a-z_]{0,39}$'),
  period            interval check (period is null or period > interval '0'),
  action            text check (action is null or action in ('excluir', 'anonimizar', 'reter')),
  legal_basis_ref   text check (legal_basis_ref is null or legal_basis_ref ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  approved_by       uuid references app.admin_staff (user_id),
  effective_from    timestamptz,
  enabled           boolean not null default false,
  dry_run           boolean not null default true,
  last_dry_run_at   timestamptz,
  updated_at        timestamptz not null,
  constraint retention_policy_habilitada_completa check (
    not enabled or (period is not null and action is not null and legal_basis_ref is not null
                    and approved_by is not null and effective_from is not null)),
  constraint retention_policy_rc06_rc07_so_reter check (
    data_class not in ('RC-06', 'RC-07') or action is null or action = 'reter'),
  constraint retention_policy_rc02_sem_excluir check (data_class <> 'RC-02' or action is null or action <> 'excluir'),
  constraint retention_policy_simulacao_antes_de_executar check (dry_run or last_dry_run_at is not null)
);

comment on table app.retention_policy is
  'Politica de retencao por classe (H-109, 82 §1). Prazos so em dados cadastrados por aprovacao dupla; nunca em codigo.';

-- Semeadura: nenhum periodo, desligada, em simulacao. RC-06 e RC-07 so aceitam reter.
insert into app.retention_policy (id, data_class, trigger_event, action, enabled, dry_run, updated_at) values
  (gen_random_uuid(), 'RC-01', 'verificacao_aprovada', null, false, true, now()),
  (gen_random_uuid(), 'RC-02', 'conta_bloqueada', null, false, true, now()),
  (gen_random_uuid(), 'RC-03', null, null, false, true, now()),
  (gen_random_uuid(), 'RC-04', null, null, false, true, now()),
  (gen_random_uuid(), 'RC-05', null, null, false, true, now()),
  (gen_random_uuid(), 'RC-06', null, 'reter', false, true, now()),
  (gen_random_uuid(), 'RC-07', null, 'reter', false, true, now()),
  (gen_random_uuid(), 'RC-10', null, null, false, true, now())
on conflict (data_class) do nothing;

-- 4. app.retention_policy_change: unica porta de mudanca da politica (82 §5) --------------------------------
create table if not exists app.retention_policy_change (
  id                  uuid primary key,
  policy_id           uuid not null references app.retention_policy (id),
  period              interval check (period is null or period > interval '0'),
  action              text check (action is null or action in ('excluir', 'anonimizar', 'reter')),
  legal_basis_ref     text check (legal_basis_ref is null or legal_basis_ref ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  effective_from      timestamptz,
  enabled             boolean not null,
  dry_run             boolean not null,
  requested_by        uuid not null references app.admin_staff (user_id),
  approval_request_id uuid not null unique references app.approval_request (id),
  status              text not null check (status in ('pendente', 'aplicada')),
  created_at          timestamptz not null,
  applied_at          timestamptz,
  constraint retention_policy_change_habilitada_completa check (
    not enabled or (period is not null and action is not null and legal_basis_ref is not null
                    and effective_from is not null)),
  constraint retention_policy_change_aplicada check ((status = 'aplicada') = (applied_at is not null))
);

-- 5. app.legal_hold: suspende o expurgo do sujeito enquanto ativo. Nunca apagado (82 §1) ----------------
create table if not exists app.legal_hold (
  id                  uuid primary key,
  subject_type        text not null check (subject_type in ('user', 'request')),
  subject_id          uuid not null,
  reason_code         text not null check (reason_code ~ '^[a-z][a-z0-9_]{0,39}$'),
  placed_by           uuid not null references app.admin_staff (user_id),
  placed_at           timestamptz not null,
  released_by         uuid references app.admin_staff (user_id),
  released_at         timestamptz,
  approval_request_id uuid references app.approval_request (id),
  constraint legal_hold_liberacao_completa check ((released_at is null) = (released_by is null)),
  constraint legal_hold_liberacao_aprovada check (released_at is null or approval_request_id is not null)
);

create unique index if not exists legal_hold_ativo_unico
  on app.legal_hold (subject_type, subject_id, reason_code) where released_at is null;

-- 6. app.retention_object_queue: so caminhos de objeto, sem dado pessoal em claro (82 §2, fase B) ----------
create table if not exists app.retention_object_queue (
  id          uuid primary key,
  policy_id   uuid not null references app.retention_policy (id),
  subject_id  uuid not null,
  bucket      text not null check (bucket in ('identity-docs', 'request-photos')),
  object_path text not null check (char_length(object_path) between 1 and 512
                                   and object_path !~ '^/' and object_path !~ '[.][.]'),
  state       text not null default 'pendente' check (state in ('pendente', 'removido')),
  attempts    integer not null default 0 check (attempts between 0 and 1000),
  created_at  timestamptz not null,
  removed_at  timestamptz,
  constraint retention_object_queue_removido check ((state = 'removido') = (removed_at is not null)),
  constraint retention_object_queue_objeto_unico unique (policy_id, bucket, object_path)
);

create index if not exists retention_object_queue_pendente_idx
  on app.retention_object_queue (policy_id, subject_id) where state = 'pendente';

-- 7. RLS forcada, privilegios minimos ---------------------------------------------------------------------
alter table app.retention_policy enable row level security;
alter table app.retention_policy force row level security;
alter table app.retention_policy_change enable row level security;
alter table app.retention_policy_change force row level security;
alter table app.legal_hold enable row level security;
alter table app.legal_hold force row level security;
alter table app.retention_object_queue enable row level security;
alter table app.retention_object_queue force row level security;

revoke all on app.retention_policy, app.retention_policy_change, app.legal_hold, app.retention_object_queue
  from public, anon, authenticated, service_role, app_api;
grant select on app.retention_policy, app.retention_policy_change, app.legal_hold, app.retention_object_queue
  to app_system;

-- 8. Acoes de auditoria (chaves de estado sem dado pessoal; contagens e codigos) --------------------------
insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('retention.policy.proposed', 'retention_policy', false,
   array['status', 'enabled', 'dry_run', 'action', 'approval_request_id'], 'Mudanca de politica de retencao proposta (H-109)'),
  ('retention.policy.changed', 'retention_policy', false,
   array['status', 'enabled', 'dry_run', 'action', 'approval_request_id'], 'Politica de retencao alterada apos aprovacao dupla (H-109)'),
  ('retention.policy.denied', 'retention_policy', false,
   array['status'], 'Tentativa de mudanca de politica recusada (H-109)'),
  ('retention.hold.placed', 'legal_hold', false,
   array['status', 'subject_type', 'reason_code'], 'Bloqueio legal (hold) colocado (H-109)'),
  ('retention.hold.release_requested', 'legal_hold', false,
   array['status', 'approval_request_id'], 'Liberacao de bloqueio legal pedida (H-109)'),
  ('retention.hold.released', 'legal_hold', false,
   array['status', 'approval_request_id'], 'Bloqueio legal liberado apos aprovacao dupla (H-109)'),
  ('retention.batch.executed', 'retention_policy', false,
   array['data_class', 'action', 'eligible', 'processed', 'held', 'failed', 'dry_run', 'batch_no'],
   'Lote do expurgo por politica, so contagens (H-109)')
on conflict (action, object_type) do nothing;

-- 9. Regra por classe (espelho de ACOES_POR_CLASSE no dominio; usada pelo cadastro) ------------------------
create or replace function private.retention_acao_permitida(p_class text, p_action text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_class
    when 'RC-01' then p_action in ('excluir', 'anonimizar', 'reter')
    when 'RC-02' then p_action in ('anonimizar', 'reter')
    when 'RC-03' then p_action in ('excluir', 'anonimizar', 'reter')
    when 'RC-04' then p_action in ('excluir', 'anonimizar', 'reter')
    when 'RC-05' then p_action in ('anonimizar', 'reter')
    when 'RC-06' then p_action = 'reter'
    when 'RC-07' then p_action = 'reter'
    when 'RC-10' then p_action in ('excluir', 'reter')
    else false
  end
$$;

-- Vencimento de sujeitos elegiveis por classe (gatilho ocorrido ate o corte, sem hold ativo na leitura).
-- Marcados como 'expurgando' continuam aparecendo para a fase C concluir ou reverter.
create or replace function private.retention_due(p_class text, p_cutoff timestamptz)
returns table (subject_id uuid, held boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id,
         exists (select 1 from app.legal_hold h
                  where h.subject_type = 'user' and h.subject_id = p.user_id and h.released_at is null)
    from app.professional_profile p
   where p_class = 'RC-01'
     and (p.retention_state = 'expurgando'
          or (p.retention_state is null and p.document_enc is not null and p.verified_at <= p_cutoff))
  union all
  select u.id,
         exists (select 1 from app.legal_hold h
                  where h.subject_type = 'user' and h.subject_id = u.id and h.released_at is null)
    from app.app_user u
   where p_class = 'RC-02'
     and (u.retention_state = 'expurgando'
          or (u.retention_state is null and u.anonymized_at is null and u.status = 'bloqueado'
              and u.created_at <= p_cutoff))
$$;

-- 10. Cadastro: negacao (gravada pelo chamador, fora da transacao que levantou a excecao) ---------------
create or replace function private.retention_policy_denied_record(
  p_actor uuid, p_data_class text, p_motivo text, p_now timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pol app.retention_policy%rowtype;
begin
  if p_actor is null or p_data_class is null or p_motivo is null or p_now is null then
    raise exception 'retencao_entrada_invalida' using errcode = '22023';
  end if;
  select * into v_pol from app.retention_policy p where p.data_class = p_data_class;
  return private.audit_append('admin:' || p_actor::text, 'admin', 'retention.policy.denied',
    'retention_policy', v_pol.id, '{}'::jsonb, '{"status":"recusada"}'::jsonb, p_motivo, null);
end
$$;

-- 11. Cadastro: propor (cria a mudanca e o pedido de dupla aprovacao; nada e alterado na politica) ------
create or replace function private.retention_policy_propose(
  p_actor uuid, p_change uuid, p_data_class text, p_period interval, p_action text,
  p_legal_basis_ref text, p_effective_from timestamptz, p_enabled boolean, p_dry_run boolean, p_now timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pol app.retention_policy%rowtype;
  v_approval uuid := gen_random_uuid();
begin
  if p_actor is null or p_change is null or p_data_class is null or p_enabled is null or p_dry_run is null
     or p_now is null then
    raise exception 'retencao_entrada_invalida' using errcode = '22023';
  end if;
  if not private.admin_has_permission(p_actor, 'retention.policy.manage') then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  select * into v_pol from app.retention_policy p where p.data_class = p_data_class;
  if not found then
    raise exception 'classe_inexistente' using errcode = 'ADM04';
  end if;
  if p_action is not null and not coalesce(private.retention_acao_permitida(p_data_class, p_action), false) then
    raise exception 'acao_nao_permitida' using errcode = '23514';
  end if;
  if p_enabled and (p_period is null or p_action is null or p_legal_basis_ref is null or p_effective_from is null) then
    raise exception 'habilitacao_incompleta' using errcode = '23514';
  end if;
  if not p_dry_run and v_pol.last_dry_run_at is null then
    raise exception 'simulacao_pendente' using errcode = '23514';
  end if;

  insert into app.approval_request (id, action_type, subject_user_id, detail_code, requested_by,
                                    required_approvals, status, created_at, expires_at)
  values (v_approval, 'retencao_politica', null, p_change::text, p_actor, 1, 'pendente', p_now,
          p_now + interval '24 hours');

  insert into app.retention_policy_change (id, policy_id, period, action, legal_basis_ref, effective_from,
                                           enabled, dry_run, requested_by, approval_request_id, status, created_at)
  values (p_change, v_pol.id, p_period, p_action, p_legal_basis_ref, p_effective_from, p_enabled, p_dry_run,
          p_actor, v_approval, 'pendente', p_now);

  perform private.audit_append('admin:' || p_actor::text, 'admin', 'retention.policy.proposed',
    'retention_policy', v_pol.id, '{}'::jsonb,
    jsonb_strip_nulls(jsonb_build_object('status', 'pendente', 'enabled', p_enabled, 'dry_run', p_dry_run,
                                         'action', p_action, 'approval_request_id', v_approval)),
    null, null);
  return v_approval;
end
$$;

-- 12. Cadastro: aplicar (uso unico do pedido aprovado, validade de 24 h, solicitante aplica) ---------------
create or replace function private.retention_policy_apply(p_actor uuid, p_change uuid, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chg app.retention_policy_change%rowtype;
  v_req app.approval_request%rowtype;
  v_approver uuid;
begin
  if p_actor is null or p_change is null or p_now is null then
    raise exception 'retencao_entrada_invalida' using errcode = '22023';
  end if;
  if not private.admin_has_permission(p_actor, 'retention.policy.manage') then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  select * into v_chg from app.retention_policy_change c where c.id = p_change for update;
  if not found or v_chg.status <> 'pendente' then
    raise exception 'alteracao_invalida' using errcode = 'ADM03';
  end if;
  select * into v_req from app.approval_request r where r.id = v_chg.approval_request_id for update;
  if not found or v_req.action_type <> 'retencao_politica' or v_req.detail_code <> p_change::text
     or v_req.status <> 'aprovada' or v_req.consumed_at is not null or v_req.expires_at <= p_now
     or v_req.requested_by <> p_actor then
    raise exception 'aprovacao_invalida' using errcode = 'ADM03';
  end if;
  select v.approver_id into v_approver
    from app.approval_vote v where v.approval_request_id = v_req.id order by v.voted_at limit 1;

  update app.approval_request set status = 'consumida', consumed_at = p_now where id = v_req.id;
  update app.retention_policy_change set status = 'aplicada', applied_at = p_now where id = p_change;
  update app.retention_policy p
     set period = v_chg.period, action = v_chg.action, legal_basis_ref = v_chg.legal_basis_ref,
         effective_from = v_chg.effective_from, enabled = v_chg.enabled, dry_run = v_chg.dry_run,
         approved_by = v_approver, updated_at = p_now
   where p.id = v_chg.policy_id;

  perform private.audit_append('admin:' || p_actor::text, 'admin', 'retention.policy.changed',
    'retention_policy', v_chg.policy_id, '{}'::jsonb,
    jsonb_strip_nulls(jsonb_build_object('status', 'aplicada', 'enabled', v_chg.enabled, 'dry_run', v_chg.dry_run,
                                         'action', v_chg.action, 'approval_request_id', v_req.id)),
    null, null);
end
$$;

-- 13. Simulacao (dry run): conta e registra, nao altera linha de dado (CA-H109-01 e 82 §2) ---------------
create or replace function private.retention_dry_run(p_policy uuid, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pol app.retention_policy%rowtype;
  v_elig integer := 0;
  v_held integer := 0;
  v_audit uuid;
begin
  select * into v_pol from app.retention_policy p where p.id = p_policy for update;
  if not found or v_pol.period is null or p_now is null then
    raise exception 'retencao_entrada_invalida' using errcode = '22023';
  end if;
  if v_pol.effective_from is not null and v_pol.effective_from <= p_now then
    select count(*) filter (where not d.held), count(*) filter (where d.held)
      into v_elig, v_held
      from private.retention_due(v_pol.data_class, p_now - v_pol.period) d;
  end if;
  update app.retention_policy set last_dry_run_at = p_now, updated_at = p_now where id = p_policy;
  v_audit := private.audit_append('system:retention', 'system', 'retention.batch.executed', 'retention_policy',
    p_policy, '{}'::jsonb,
    jsonb_strip_nulls(jsonb_build_object('data_class', v_pol.data_class, 'action', v_pol.action,
                                         'eligible', v_elig, 'processed', 0, 'held', v_held, 'failed', 0,
                                         'dry_run', true, 'batch_no', 0)),
    null, null);
  return jsonb_build_object('eligible', v_elig, 'held', v_held);
end
$$;

-- 14. Fase A: marca o lote elegivel e devolve os ids (novos e retomados). Uma transacao. -----------------
create or replace function private.retention_mark_batch(p_policy uuid, p_limit integer, p_now timestamptz)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pol app.retention_policy%rowtype;
  v_cutoff timestamptz;
  v_ids uuid[];
begin
  select * into v_pol from app.retention_policy p where p.id = p_policy;
  if not found or not v_pol.enabled or v_pol.dry_run or v_pol.period is null or v_pol.action is null
     or v_pol.action = 'reter' or v_pol.effective_from is null or v_pol.effective_from > p_now
     or p_limit is null or p_limit < 1 or p_now is null then
    return '{}'::uuid[];
  end if;
  v_cutoff := p_now - v_pol.period;
  select coalesce(array_agg(x.subject_id order by x.subject_id), '{}'::uuid[]) into v_ids
    from (select d.subject_id from private.retention_due(v_pol.data_class, v_cutoff) d
           where not d.held order by d.subject_id limit p_limit) x;
  if cardinality(v_ids) = 0 then
    return v_ids;
  end if;
  if v_pol.data_class = 'RC-01' then
    update app.professional_profile p set retention_state = 'expurgando'
     where p.user_id = any (v_ids) and p.retention_state is null;
  elsif v_pol.data_class = 'RC-02' then
    update app.app_user u set retention_state = 'expurgando'
     where u.id = any (v_ids) and u.retention_state is null;
  end if;
  return v_ids;
end
$$;

-- 15. Fila de objetos (fase A complemento e fase B) ------------------------------------------------------
create or replace function private.retention_queue_add(
  p_policy uuid, p_subject uuid, p_bucket text, p_path text, p_now timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into app.retention_object_queue (id, policy_id, subject_id, bucket, object_path, state, attempts, created_at)
  values (gen_random_uuid(), p_policy, p_subject, p_bucket, p_path, 'pendente', 0, p_now)
  on conflict (policy_id, bucket, object_path) do nothing
$$;

create or replace function private.retention_queue_pending(p_policy uuid, p_subjects uuid[], p_limit integer)
returns table (id uuid, bucket text, object_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select q.id, q.bucket, q.object_path
    from app.retention_object_queue q
   where q.policy_id = p_policy and q.state = 'pendente' and q.subject_id = any (p_subjects)
   order by q.created_at, q.id
   limit p_limit
$$;

create or replace function private.retention_queue_result(p_id uuid, p_ok boolean, p_now timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  update app.retention_object_queue
     set state = case when p_ok then 'removido' else state end,
         removed_at = case when p_ok then p_now else removed_at end,
         attempts = case when p_ok then attempts else least(attempts + 1, 1000) end
   where id = p_id and state = 'pendente'
$$;

-- 16. Fase C por classe: reconfere hold, aplica a acao; devolve o resultado do sujeito ------------------
-- Objeto ainda pendente = 'falhou' (linha segue expurgando). Hold ativo = 'suspenso' (marca revertida).
create or replace function private.retention_finalize_rc01(p_policy uuid, p_subject uuid, p_now timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  select p.retention_state into v_state from app.professional_profile p where p.user_id = p_subject for update;
  if not found or v_state is distinct from 'expurgando' then
    return 'ignorado';
  end if;
  if exists (select 1 from app.retention_object_queue q
              where q.policy_id = p_policy and q.subject_id = p_subject and q.state <> 'removido') then
    return 'falhou';
  end if;
  if exists (select 1 from app.legal_hold h
              where h.subject_type = 'user' and h.subject_id = p_subject and h.released_at is null) then
    update app.professional_profile set retention_state = null, updated_at = p_now where user_id = p_subject;
    return 'suspenso';
  end if;
  -- Excluir e anonimizar tem o mesmo efeito em RC-01: zera os tres campos do documento (82 §3).
  update app.professional_profile
     set document_type = null, document_enc = null, document_hmac = null,
         retention_state = 'expurgado', updated_at = p_now
   where user_id = p_subject;
  return 'processado';
end
$$;

-- RC-02: anonimiza. O e-mail vira marcador irreversivel (sem HMAC reutilizavel); a linha permanece por FK.
create or replace function private.retention_finalize_rc02(p_policy uuid, p_subject uuid, p_now timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  select u.retention_state into v_state from app.app_user u where u.id = p_subject for update;
  if not found or v_state is distinct from 'expurgando' then
    return 'ignorado';
  end if;
  if exists (select 1 from app.retention_object_queue q
              where q.policy_id = p_policy and q.subject_id = p_subject and q.state <> 'removido') then
    return 'falhou';
  end if;
  if exists (select 1 from app.legal_hold h
              where h.subject_type = 'user' and h.subject_id = p_subject and h.released_at is null) then
    update app.app_user set retention_state = null where id = p_subject;
    return 'suspenso';
  end if;
  update app.app_user
     set email = 'anon.' || replace(p_subject::text, '-', '') || '@anonimizado.invalid',
         anonymized_at = p_now, retention_state = 'expurgado'
   where id = p_subject;
  return 'processado';
end
$$;

-- 17. Fase C do lote: uma transacao; o evento do lote e gravado nela (CA-H109-04 e 07) --------------------
create or replace function private.retention_finalize_batch(
  p_policy uuid, p_ids uuid[], p_now timestamptz, p_batch_no integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pol app.retention_policy%rowtype;
  v_id uuid;
  v_res text;
  v_processed integer := 0;
  v_held integer := 0;
  v_failed integer := 0;
  v_audit uuid;
begin
  select * into v_pol from app.retention_policy p where p.id = p_policy;
  if not found or v_pol.period is null or v_pol.action is null or v_pol.action = 'reter'
     or p_now is null or p_batch_no is null or p_batch_no < 1 then
    raise exception 'retencao_entrada_invalida' using errcode = '22023';
  end if;
  foreach v_id in array coalesce(p_ids, '{}'::uuid[]) loop
    if v_pol.data_class = 'RC-01' then
      v_res := private.retention_finalize_rc01(p_policy, v_id, p_now);
    elsif v_pol.data_class = 'RC-02' then
      v_res := private.retention_finalize_rc02(p_policy, v_id, p_now);
    else
      v_res := 'ignorado';
    end if;
    if v_res = 'processado' then
      v_processed := v_processed + 1;
    elsif v_res = 'suspenso' then
      v_held := v_held + 1;
    elsif v_res = 'falhou' then
      v_failed := v_failed + 1;
    end if;
  end loop;

  v_audit := private.audit_append('system:retention', 'system', 'retention.batch.executed', 'retention_policy',
    p_policy, '{}'::jsonb,
    jsonb_build_object('data_class', v_pol.data_class, 'action', v_pol.action,
                       'eligible', coalesce(cardinality(p_ids), 0), 'processed', v_processed,
                       'held', v_held, 'failed', v_failed, 'dry_run', false, 'batch_no', p_batch_no),
    null, null);
  return jsonb_build_object('processed', v_processed, 'held', v_held, 'failed', v_failed);
end
$$;

-- 18. Bloqueio legal (hold): colocar e imediato; liberar exige dupla aprovacao (82 §5) --------------------
create or replace function private.legal_hold_place(
  p_actor uuid, p_subject_type text, p_subject_id uuid, p_reason text, p_now timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  if p_actor is null or p_subject_type is null or p_subject_id is null or p_reason is null or p_now is null then
    raise exception 'retencao_entrada_invalida' using errcode = '22023';
  end if;
  if not private.admin_has_permission(p_actor, 'retention.hold.manage') then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  insert into app.legal_hold (id, subject_type, subject_id, reason_code, placed_by, placed_at)
  values (v_id, p_subject_type, p_subject_id, p_reason, p_actor, p_now);
  perform private.audit_append('admin:' || p_actor::text, 'admin', 'retention.hold.placed', 'legal_hold', v_id,
    '{}'::jsonb, jsonb_build_object('status', 'ativo', 'subject_type', p_subject_type, 'reason_code', p_reason),
    null, null);
  return v_id;
end
$$;

create or replace function private.legal_hold_release_propose(p_actor uuid, p_hold uuid, p_now timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hold app.legal_hold%rowtype;
  v_approval uuid := gen_random_uuid();
begin
  if p_actor is null or p_hold is null or p_now is null then
    raise exception 'retencao_entrada_invalida' using errcode = '22023';
  end if;
  if not private.admin_has_permission(p_actor, 'retention.hold.manage') then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  select * into v_hold from app.legal_hold h where h.id = p_hold for update;
  if not found or v_hold.released_at is not null then
    raise exception 'hold_inexistente' using errcode = 'ADM04';
  end if;
  insert into app.approval_request (id, action_type, subject_user_id, detail_code, requested_by,
                                    required_approvals, status, created_at, expires_at)
  values (v_approval, 'retencao_politica', null, 'hold:' || p_hold::text, p_actor, 1, 'pendente', p_now,
          p_now + interval '24 hours');
  perform private.audit_append('admin:' || p_actor::text, 'admin', 'retention.hold.release_requested',
    'legal_hold', p_hold, '{}'::jsonb,
    jsonb_build_object('status', 'pendente', 'approval_request_id', v_approval), null, null);
  return v_approval;
end
$$;

create or replace function private.legal_hold_release_apply(
  p_actor uuid, p_hold uuid, p_approval uuid, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hold app.legal_hold%rowtype;
  v_req app.approval_request%rowtype;
begin
  if p_actor is null or p_hold is null or p_approval is null or p_now is null then
    raise exception 'retencao_entrada_invalida' using errcode = '22023';
  end if;
  if not private.admin_has_permission(p_actor, 'retention.hold.manage') then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  select * into v_hold from app.legal_hold h where h.id = p_hold for update;
  if not found or v_hold.released_at is not null then
    raise exception 'hold_inexistente' using errcode = 'ADM04';
  end if;
  select * into v_req from app.approval_request r where r.id = p_approval for update;
  if not found or v_req.action_type <> 'retencao_politica' or v_req.detail_code <> ('hold:' || p_hold::text)
     or v_req.status <> 'aprovada' or v_req.consumed_at is not null or v_req.expires_at <= p_now
     or v_req.requested_by <> p_actor then
    raise exception 'aprovacao_invalida' using errcode = 'ADM03';
  end if;
  update app.approval_request set status = 'consumida', consumed_at = p_now where id = p_approval;
  update app.legal_hold
     set released_by = p_actor, released_at = p_now, approval_request_id = p_approval
   where id = p_hold;
  perform private.audit_append('admin:' || p_actor::text, 'admin', 'retention.hold.released', 'legal_hold', p_hold,
    '{}'::jsonb, jsonb_build_object('status', 'liberado', 'approval_request_id', p_approval), null, null);
end
$$;

-- 19. Privilegios das funcoes -----------------------------------------------------------------------------
revoke all on function
  private.retention_acao_permitida(text, text),
  private.retention_due(text, timestamptz),
  private.retention_policy_denied_record(uuid, text, text, timestamptz),
  private.retention_policy_propose(uuid, uuid, text, interval, text, text, timestamptz, boolean, boolean, timestamptz),
  private.retention_policy_apply(uuid, uuid, timestamptz),
  private.retention_dry_run(uuid, timestamptz),
  private.retention_mark_batch(uuid, integer, timestamptz),
  private.retention_queue_add(uuid, uuid, text, text, timestamptz),
  private.retention_queue_pending(uuid, uuid[], integer),
  private.retention_queue_result(uuid, boolean, timestamptz),
  private.retention_finalize_rc01(uuid, uuid, timestamptz),
  private.retention_finalize_rc02(uuid, uuid, timestamptz),
  private.retention_finalize_batch(uuid, uuid[], timestamptz, integer),
  private.legal_hold_place(uuid, text, uuid, text, timestamptz),
  private.legal_hold_release_propose(uuid, uuid, timestamptz),
  private.legal_hold_release_apply(uuid, uuid, uuid, timestamptz),
  private.approval_vote_guard()
  from public, anon, authenticated, service_role, app_api;

grant execute on function
  private.retention_acao_permitida(text, text),
  private.retention_policy_denied_record(uuid, text, text, timestamptz),
  private.retention_policy_propose(uuid, uuid, text, interval, text, text, timestamptz, boolean, boolean, timestamptz),
  private.retention_policy_apply(uuid, uuid, timestamptz),
  private.retention_dry_run(uuid, timestamptz),
  private.retention_mark_batch(uuid, integer, timestamptz),
  private.retention_queue_add(uuid, uuid, text, text, timestamptz),
  private.retention_queue_pending(uuid, uuid[], integer),
  private.retention_queue_result(uuid, boolean, timestamptz),
  private.retention_finalize_batch(uuid, uuid[], timestamptz, integer),
  private.legal_hold_place(uuid, text, uuid, text, timestamptz),
  private.legal_hold_release_propose(uuid, uuid, timestamptz),
  private.legal_hold_release_apply(uuid, uuid, uuid, timestamptz)
  to app_system;

-- retention_due, retention_finalize_rc01 e retention_finalize_rc02 nao recebem EXECUTE de app_system:
-- so rodam dentro das funcoes acima (dono da funcao, security definer).
