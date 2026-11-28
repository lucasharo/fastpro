-- H-102 | Conta administrativa: primeira migracao (docs/factory/54-DESENHO-H102.md, §1 e §8 item 5).
-- Idempotente. Desfazer: supabase/rollbacks/20261111190000_admin_create_staff.down.sql.
-- Entrega (1) do desenho: app.admin_staff, app.approval_request e app.approval_vote minimas,
-- private.admin_email_is_reserved (usada por H-012 em outra etapa). Papeis, convite, sessao admin
-- e troca de papel entram na segunda migracao (admin_create_rbac).
-- Postura igual a H-011/H-012: RLS habilitada e forcada, sem politicas; nenhum privilegio para
-- PUBLIC/anon/authenticated/service_role/app_api. So app_system (BYPASSRLS) recebe privilegios.
-- Nenhum dado pessoal novo: o e-mail continua so em app.app_user.

-- 1. app.admin_staff: conta administrativa. A linha nasce em pendente_mfa e so vira ativo com TOTP ---
create table if not exists app.admin_staff (
  user_id            uuid primary key references app.app_user (id),
  status             text not null check (status in ('pendente_mfa', 'ativo', 'desativado')),
  origin             text not null check (origin in ('convite', 'bootstrap')),
  invited_by         uuid references app.admin_staff (user_id),
  mfa_enrolled_at    timestamptz,
  created_at         timestamptz not null,
  status_changed_at  timestamptz not null,
  constraint admin_staff_origem_convite check ((origin = 'convite') = (invited_by is not null)),
  constraint admin_staff_nao_convida_a_si check (invited_by is null or invited_by <> user_id),
  constraint admin_staff_ativo_com_mfa check (status <> 'ativo' or mfa_enrolled_at is not null)
);

comment on table app.admin_staff is
  'Conta administrativa (H-102). Papeis entram na proxima migracao. Sem senha e sem segredo TOTP aqui.';

-- 2. app.approval_request: pedido de dupla aprovacao (minimo; H-105 acrescenta action_type) ---------
create table if not exists app.approval_request (
  id                 uuid primary key,
  action_type        text not null check (action_type in ('papel_superadmin', 'mfa_reenroll')),
  subject_user_id    uuid not null references app.admin_staff (user_id),
  detail_code        text check (detail_code is null or detail_code ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  requested_by       uuid not null references app.admin_staff (user_id),
  required_approvals smallint not null default 1 check (required_approvals = 1),
  status             text not null check (status in ('pendente', 'aprovada', 'rejeitada', 'expirada', 'consumida')),
  created_at         timestamptz not null,
  expires_at         timestamptz not null,
  consumed_at        timestamptz,
  constraint approval_request_validade_24h check (expires_at = created_at + interval '24 hours'),
  constraint approval_request_consumo check ((status = 'consumida') = (consumed_at is not null)),
  constraint approval_request_solicitante_nao_alvo check (requested_by <> subject_user_id),
  constraint approval_request_detalhe_por_acao check ((action_type = 'papel_superadmin') = (detail_code is not null))
);

comment on table app.approval_request is
  'Pedido de dupla aprovacao (H-102, D-H102-5/6). Uso unico: consumida na mesma transacao da acao.';

-- 3. app.approval_vote: um voto por aprovador. O aprovador nunca e o solicitante nem o alvo ---------
create table if not exists app.approval_vote (
  id                  uuid primary key,
  approval_request_id uuid not null references app.approval_request (id),
  approver_id         uuid not null references app.admin_staff (user_id),
  voted_at            timestamptz not null,
  constraint approval_vote_unico unique (approval_request_id, approver_id)
);

comment on table app.approval_vote is
  'Voto de aprovacao (H-102). Trigger impede autoaprovacao e voto em pedido que nao esta pendente.';

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
  if not exists (
    select 1 from app.admin_staff s where s.user_id = new.approver_id and s.status = 'ativo'
  ) then
    raise exception 'aprovador_nao_ativo' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists approval_vote_guard on app.approval_vote;
create trigger approval_vote_guard
  before insert on app.approval_vote
  for each row execute function private.approval_vote_guard();

-- 4. Consulta de reserva de e-mail (46 §4 item 1; H-102 D-H102-7). Nesta migracao so conta a conta
-- administrativa; o convite vivo entra na segunda migracao (que substitui esta funcao).
create or replace function private.admin_email_is_reserved(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
      from app.app_user u
      join app.admin_staff s on s.user_id = u.id
     where u.email = p_email
  ), false)
$$;

-- 5. Postura de acesso (igual H-011/H-012) ---------------------------------------------------------
alter table app.admin_staff enable row level security;
alter table app.admin_staff force row level security;
alter table app.approval_request enable row level security;
alter table app.approval_request force row level security;
alter table app.approval_vote enable row level security;
alter table app.approval_vote force row level security;

revoke all on app.admin_staff, app.approval_request, app.approval_vote
  from public, anon, authenticated, service_role, app_api;
grant select, insert, update, delete on app.admin_staff, app.approval_request, app.approval_vote
  to app_system;

revoke all on function
  private.approval_vote_guard(),
  private.admin_email_is_reserved(text)
  from public, anon, authenticated, service_role, app_api;

grant execute on function
  private.approval_vote_guard(),
  private.admin_email_is_reserved(text)
  to app_system;
