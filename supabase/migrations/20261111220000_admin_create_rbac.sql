-- H-102 | RBAC, convite, sessao admin de 8 h e dupla aprovacao: segunda migracao
-- (docs/factory/54-DESENHO-H102.md, §1 a §5 e §8 item 5). Idempotente.
-- Desfazer: supabase/rollbacks/20261111220000_admin_create_rbac.down.sql (manual, so em dev).
-- Depende de 20261111190000_admin_create_staff (admin_staff, approval_request, approval_vote).
-- Postura igual a H-011/H-012: RLS forcada e sem politicas; nenhum privilegio para
-- PUBLIC/anon/authenticated/service_role/app_api. So app_system (BYPASSRLS) usa as tabelas e as
-- funcoes. Toda mudanca de papel, convite, ativacao e sessao grava auditoria na MESMA transacao,
-- por private.audit_append (CA-H102-09/10). Sem e-mail, senha, token ou segredo em auditoria.
-- Reserva de e-mail (46 §4): a funcao recebe o e-mail em claro (para app_user) e o HMAC (para convite).

-- 0. Ajustes na primeira migracao ----------------------------------------------------------------------
-- O convite de superadmin e a aprovacao de papel ainda nao tem alvo (o usuario nao existe). Por isso
-- o alvo da aprovacao passa a ser opcional; a regra de solicitante diferente do alvo continua valendo.
alter table app.approval_request alter column subject_user_id drop not null;

-- 1. Papeis, permissoes e mapa (08 §13; semente da D-H102-8; mapa [PROPOSTA] de 54 §1) ---------------
create table if not exists app.admin_role (
  code  text primary key check (code ~ '^[a-z][a-z_]{0,31}$'),
  label text not null
);

create table if not exists app.admin_permission (
  code  text primary key check (code ~ '^[a-z][a-z0-9_.]{0,63}$'),
  label text not null
);

create table if not exists app.admin_role_permission (
  role_code       text not null references app.admin_role (code),
  permission_code text not null references app.admin_permission (code),
  primary key (role_code, permission_code)
);

insert into app.admin_role (code, label) values
  ('superadmin', 'Superadmin'),
  ('verificacao', 'Verificacao'),
  ('moderador', 'Moderador'),
  ('financeiro', 'Financeiro'),
  ('suporte', 'Suporte'),
  ('auditor', 'Auditor')
on conflict (code) do nothing;

insert into app.admin_permission (code, label) values
  ('verification.review', 'Revisar verificacao'),
  ('moderation.decide', 'Decidir moderacao'),
  ('finance.refund.request', 'Solicitar estorno'),
  ('finance.refund.approve', 'Aprovar estorno'),
  ('support.completion.correct', 'Corrigir conclusao de servico'),
  ('audit.read', 'Consultar auditoria'),
  ('catalog.manage', 'Gerir catalogo'),
  ('admin.role.manage', 'Gerir papeis de administracao'),
  ('case.open_sensitive', 'Abrir caso sensivel')
on conflict (code) do nothing;

insert into app.admin_role_permission (role_code, permission_code) values
  ('verificacao', 'verification.review'),
  ('moderador', 'moderation.decide'),
  ('financeiro', 'finance.refund.request'),
  ('financeiro', 'finance.refund.approve'),
  ('suporte', 'support.completion.correct'),
  ('suporte', 'case.open_sensitive'),
  ('auditor', 'audit.read'),
  ('superadmin', 'admin.role.manage'),
  ('superadmin', 'catalog.manage')
on conflict do nothing;

-- 2. app.admin_user_role: papel concedido. Linhas nunca sao apagadas; revogacao preenche revoked_* ---
create table if not exists app.admin_user_role (
  id                  uuid primary key,
  user_id             uuid not null references app.admin_staff (user_id),
  role_code           text not null references app.admin_role (code),
  granted_by          uuid references app.admin_staff (user_id),
  grant_origin        text not null check (grant_origin in ('convite', 'bootstrap', 'concessao')),
  granted_at          timestamptz not null,
  approval_request_id uuid references app.approval_request (id),
  revoked_by          uuid references app.admin_staff (user_id),
  revoked_at          timestamptz,
  constraint admin_user_role_origem_granted_by check ((grant_origin = 'bootstrap') = (granted_by is null)),
  constraint admin_user_role_nao_autoconcede check (granted_by is null or granted_by <> user_id),
  constraint admin_user_role_revogacao check ((revoked_by is null) = (revoked_at is null)),
  constraint admin_user_role_superadmin_aprovado
    check (role_code <> 'superadmin' or approval_request_id is not null or grant_origin = 'bootstrap')
);

create unique index if not exists admin_user_role_ativo_unico
  on app.admin_user_role (user_id, role_code) where revoked_at is null;

comment on table app.admin_user_role is
  'Papel de administracao concedido (H-102). Linhas nunca sao apagadas. Ativo = revoked_at nulo.';

-- 3. app.admin_invite: convite de ativacao (72 h, uso unico). Token so como hash; e-mail cifrado ---
create table if not exists app.admin_invite (
  id                  uuid primary key,
  kind                text not null check (kind in ('ativacao', 'reenrolamento')),
  email_hmac          text not null check (email_hmac ~ '^[0-9a-f]{64}$'),
  email_enc           bytea,
  token_hash          text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  role_codes          text[] not null,
  invited_by          uuid references app.admin_staff (user_id),
  approval_request_id uuid references app.approval_request (id),
  state               text not null check (state in ('emitido', 'aguardando_totp', 'usado', 'invalidado')),
  attempts            smallint not null default 0 check (attempts between 0 and 5),
  user_id             uuid references app.app_user (id),
  created_at          timestamptz not null,
  expires_at          timestamptz not null,
  used_at             timestamptz,
  constraint admin_invite_validade_72h check (expires_at = created_at + interval '72 hours'),
  constraint admin_invite_papel_obrigatorio check (kind <> 'ativacao' or cardinality(role_codes) >= 1),
  constraint admin_invite_email_enc_vivo check ((state in ('emitido', 'aguardando_totp')) = (email_enc is not null)),
  constraint admin_invite_usuario_no_passo1 check (state not in ('aguardando_totp', 'usado') or user_id is not null),
  constraint admin_invite_uso check ((state = 'usado') = (used_at is not null)),
  constraint admin_invite_reenrolamento_convidador check (kind <> 'reenrolamento' or invited_by is not null),
  constraint admin_invite_superadmin_aprovado
    check (not ('superadmin' = any (role_codes)) or approval_request_id is not null or invited_by is null)
);

create unique index if not exists admin_invite_email_vivo_unico
  on app.admin_invite (email_hmac) where state in ('emitido', 'aguardando_totp');

comment on table app.admin_invite is
  'Convite administrativo (H-102). Um vivo por e-mail. email_enc so existe enquanto o convite estiver vivo.';

-- 4. app.admin_session: sessao admin de 8 h absolutas, sem renovacao (D-H102-4) -------------------
create table if not exists app.admin_session (
  id          uuid primary key,
  user_id     uuid not null references app.admin_staff (user_id),
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  aal2_at     timestamptz not null,
  created_at  timestamptz not null,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  constraint admin_session_8h check (expires_at = created_at + interval '8 hours')
);

create index if not exists admin_session_user_idx on app.admin_session (user_id);
create index if not exists admin_session_expires_idx on app.admin_session (expires_at);

comment on table app.admin_session is
  'Sessao da conta administrativa (H-102). Guarda so o hash do segredo do cookie. Sem janela deslizante.';

-- 5. Acoes de auditoria do admin (H-102; chaves sem dado pessoal) --------------------------
insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('admin.invite.issued', 'admin_invite', false,
   array['state', 'kind'], 'Convite administrativo emitido (H-102)'),
  ('admin.bootstrap.invite_issued', 'admin_invite', false,
   array['state', 'kind'], 'Convite do primeiro Superadmin emitido localmente (H-102)'),
  ('admin.account.activated', 'admin_staff', false,
   array['status'], 'Conta administrativa ativada com TOTP (H-102)'),
  ('admin.role.granted', 'admin_staff', false,
   array['status', 'role_code', 'approval_request_id'], 'Papel administrativo concedido (H-102)'),
  ('admin.role.revoked', 'admin_staff', false,
   array['status', 'role_code'], 'Papel administrativo revogado (H-102)'),
  ('admin.role.self_grant_denied', 'admin_staff', false,
   array['role_code'], 'Tentativa de autoconcessao de papel negada (H-102)'),
  ('admin.session.opened', 'admin_session', false,
   array['status'], 'Sessao administrativa aberta com segundo fator (H-102)'),
  ('admin.mfa.reenroll_requested', 'admin_staff', false,
   array['status'], 'Reenrolamento de MFA solicitado (H-102; procedimento de H-102 §5.3)'),
  ('admin.mfa.reenroll_completed', 'admin_staff', false,
   array['status'], 'Reenrolamento de MFA concluido (H-102; procedimento de H-102 §5.3)')
on conflict (action) do nothing;

-- 6. Funcoes de leitura de autoridade ------------------------------------------------------------------
-- Permissao efetiva de um usuario admin (conta ativa + papel ativo). Uso interno das funcoes abaixo.
create or replace function private.admin_has_permission(p_user uuid, p_permission text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from app.admin_staff s
      join app.admin_user_role r on r.user_id = s.user_id and r.revoked_at is null
      join app.admin_role_permission rp on rp.role_code = r.role_code
     where s.user_id = p_user and s.status = 'ativo' and rp.permission_code = p_permission)
$$;

-- Guarda de cada requisicao (54 §3). Sessao nao revogada e nao vencida, com aal2, conta ativa e papel
-- ativo. Devolve papeis e permissoes lidos do banco. Vazio = 404 na API (sem pista).
create or replace function private.admin_guard(p_secret_hash text, p_now timestamptz)
returns table (out_user_id uuid, out_roles text[], out_permissions text[])
language sql
stable
security definer
set search_path = ''
as $$
  select s.user_id,
         array(select r.role_code
                 from app.admin_user_role r
                where r.user_id = s.user_id and r.revoked_at is null
                order by r.role_code),
         array(select distinct rp.permission_code
                 from app.admin_user_role r
                 join app.admin_role_permission rp on rp.role_code = r.role_code
                where r.user_id = s.user_id and r.revoked_at is null
                order by rp.permission_code)
    from app.admin_session s
    join app.admin_staff st on st.user_id = s.user_id and st.status = 'ativo'
   where s.secret_hash = p_secret_hash
     and s.revoked_at is null
     and s.aal2_at is not null
     and s.expires_at > p_now
     and exists (select 1 from app.admin_user_role r
                  where r.user_id = s.user_id and r.revoked_at is null)
$$;

-- 7. Sessao admin --------------------------------------------------------------------------------------
create or replace function private.admin_session_open(
  p_session_id uuid, p_user_id uuid, p_secret_hash text, p_now timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_session_id is null or p_user_id is null or p_now is null
     or p_secret_hash is null or p_secret_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  if not exists (select 1 from app.admin_staff s where s.user_id = p_user_id and s.status = 'ativo')
     or not exists (select 1 from app.admin_user_role r
                     where r.user_id = p_user_id and r.revoked_at is null) then
    return false;
  end if;

  insert into app.admin_session (id, user_id, secret_hash, aal2_at, created_at, expires_at)
  values (p_session_id, p_user_id, p_secret_hash, p_now, p_now, p_now + interval '8 hours');

  perform private.audit_append('admin:' || p_user_id::text, 'admin', 'admin.session.opened',
    'admin_session', p_session_id, '{}'::jsonb, '{"status":"aberta"}'::jsonb, null, null);
  return true;
end
$$;

create or replace function private.admin_session_revoke(p_secret_hash text, p_now timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update app.admin_session s
     set revoked_at = p_now
   where s.secret_hash = p_secret_hash and s.revoked_at is null;
  return found;
end
$$;

create or replace function private.admin_session_purge(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed integer;
begin
  delete from app.admin_session s where s.expires_at < p_now;
  get diagnostics v_removed = row_count;
  return v_removed;
end
$$;

-- 8. Dupla aprovacao (D-H102-5 e 6). Aprovador: Superadmin ativo, nunca o solicitante nem o alvo ----
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
    select 1
      from app.admin_staff s
      join app.admin_user_role r on r.user_id = s.user_id and r.revoked_at is null
     where s.user_id = new.approver_id and s.status = 'ativo' and r.role_code = 'superadmin'
  ) then
    raise exception 'aprovador_nao_superadmin' using errcode = '42501';
  end if;
  return new;
end
$$;

create or replace function private.admin_approval_open(
  p_id uuid, p_action text, p_subject uuid, p_detail text, p_requested_by uuid, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_id is null or p_action is null or p_requested_by is null or p_now is null then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  if not private.admin_has_permission(p_requested_by, 'admin.role.manage') then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;

  insert into app.approval_request (id, action_type, subject_user_id, detail_code, requested_by,
                                    required_approvals, status, created_at, expires_at)
  values (p_id, p_action, p_subject, p_detail, p_requested_by, 1, 'pendente', p_now,
          p_now + interval '24 hours');

  if p_action = 'mfa_reenroll' then
    perform private.audit_append('admin:' || p_requested_by::text, 'superadmin',
      'admin.mfa.reenroll_requested', 'admin_staff', p_subject, '{}'::jsonb,
      '{"status":"pendente"}'::jsonb, null, null);
  end if;
end
$$;

-- Registra um voto e devolve o estado: 'pendente', 'aprovada' ou 'expirada' (sem erro: a expiracao
-- nao pode ser desfeita por um rollback). O gatilho de approval_vote recusa autoaprovacao.
create or replace function private.admin_approval_vote(
  p_id uuid, p_approver uuid, p_now timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req app.approval_request%rowtype;
  v_votes integer;
begin
  select * into v_req from app.approval_request r where r.id = p_id for update;
  if not found then
    raise exception 'aprovacao_inexistente' using errcode = 'ADM08';
  end if;
  if v_req.status <> 'pendente' then
    raise exception 'aprovacao_nao_pendente' using errcode = 'ADM09';
  end if;
  if v_req.expires_at <= p_now then
    update app.approval_request set status = 'expirada' where id = p_id;
    return 'expirada';
  end if;

  insert into app.approval_vote (id, approval_request_id, approver_id, voted_at)
  values (gen_random_uuid(), p_id, p_approver, p_now);

  select count(*) into v_votes from app.approval_vote v where v.approval_request_id = p_id;
  if v_votes >= v_req.required_approvals then
    update app.approval_request set status = 'aprovada' where id = p_id;
    return 'aprovada';
  end if;
  return 'pendente';
end
$$;

-- 9. Concessao e revogacao de papel (54 §5.1 e §5.2) -----------------------------------------------
create or replace function private.admin_self_grant_denied_record(p_actor uuid, p_role text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.audit_append('admin:' || p_actor::text, 'admin', 'admin.role.self_grant_denied',
    'admin_staff', p_actor, '{}'::jsonb, jsonb_build_object('role_code', p_role), null, null);
end
$$;

create or replace function private.admin_role_grant(
  p_actor uuid, p_target uuid, p_role text, p_approval uuid, p_now timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_req app.approval_request%rowtype;
begin
  if p_actor is null or p_target is null or p_role is null or p_now is null then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  if p_actor = p_target then
    raise exception 'autoconcessao_negada' using errcode = 'ADM01';
  end if;
  if not private.admin_has_permission(p_actor, 'admin.role.manage') then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  if not exists (select 1 from app.admin_staff s where s.user_id = p_target and s.status = 'ativo') then
    raise exception 'alvo_nao_ativo' using errcode = 'ADM04';
  end if;
  if not exists (select 1 from app.admin_role r where r.code = p_role) then
    raise exception 'papel_inexistente' using errcode = 'ADM04';
  end if;
  if exists (select 1 from app.admin_user_role r
              where r.user_id = p_target and r.role_code = p_role and r.revoked_at is null) then
    raise exception 'papel_ja_ativo' using errcode = 'ADM04';
  end if;

  if p_role = 'superadmin' then
    select * into v_req from app.approval_request r where r.id = p_approval for update;
    if not found or v_req.action_type <> 'papel_superadmin' or v_req.detail_code <> 'superadmin'
       or v_req.status <> 'aprovada' or v_req.consumed_at is not null
       or v_req.subject_user_id is distinct from p_target or v_req.requested_by <> p_actor
       or v_req.expires_at <= p_now then
      raise exception 'aprovacao_invalida' using errcode = 'ADM03';
    end if;
    update app.approval_request set status = 'consumida', consumed_at = p_now where id = p_approval;
  end if;

  insert into app.admin_user_role (id, user_id, role_code, granted_by, grant_origin, granted_at,
                                   approval_request_id)
  values (v_id, p_target, p_role, p_actor, 'concessao', p_now,
          case when p_role = 'superadmin' then p_approval end);

  -- Auditoria por ultimo, na mesma transacao: se falhar, a concessao inteira e desfeita (CA-H102-10).
  perform private.audit_append('admin:' || p_actor::text, 'superadmin', 'admin.role.granted',
    'admin_staff', p_target, '{"status":"inativo"}'::jsonb,
    jsonb_strip_nulls(jsonb_build_object('status', 'ativo', 'role_code', p_role,
                                         'approval_request_id', p_approval)),
    null, null);
  return v_id;
end
$$;

create or replace function private.admin_role_revoke(
  p_actor uuid, p_target uuid, p_role text, p_now timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_superadmins integer;
begin
  if p_actor is null or p_target is null or p_role is null or p_now is null then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  if not private.admin_has_permission(p_actor, 'admin.role.manage') then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;

  if p_role = 'superadmin' then
    select count(distinct r.user_id) into v_superadmins
      from app.admin_user_role r
      join app.admin_staff s on s.user_id = r.user_id and s.status = 'ativo'
     where r.role_code = 'superadmin' and r.revoked_at is null;
    if v_superadmins <= 1 and exists (
         select 1 from app.admin_user_role r
          where r.user_id = p_target and r.role_code = 'superadmin' and r.revoked_at is null) then
      raise exception 'ultimo_superadmin' using errcode = 'ADM02';
    end if;
  end if;

  update app.admin_user_role
     set revoked_by = p_actor, revoked_at = p_now
   where user_id = p_target and role_code = p_role and revoked_at is null;
  if not found then
    return false;
  end if;

  perform private.audit_append('admin:' || p_actor::text, 'superadmin', 'admin.role.revoked',
    'admin_staff', p_target, '{"status":"ativo"}'::jsonb,
    jsonb_build_object('status', 'inativo', 'role_code', p_role), null, null);
  return true;
end
$$;

-- 10. Convite (54 §2). Reserva de e-mail (D-H102-7 e D-H102-12) -----------------------------------
-- Conta administrativa OU convite vivo para o e-mail. Chamada tambem por H-012 (gancho na #27).
create or replace function private.admin_email_is_reserved(p_email text, p_email_hmac text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    exists (select 1
              from app.app_user u
              join app.admin_staff s on s.user_id = u.id
             where u.email = p_email)
    or exists (select 1
                 from app.admin_invite i
                where i.email_hmac = p_email_hmac
                  and i.state in ('emitido', 'aguardando_totp')
                  and i.expires_at > now()),
    false)
$$;

-- Emite um convite. invited_by nulo = bootstrap do primeiro Superadmin (p_mode: 'primeiro' ou
-- 'continuidade'; nunca passa do segundo Superadmin). Reemissao invalida o convite vivo do mesmo e-mail.
create or replace function private.admin_invite_issue(
  p_id uuid, p_kind text, p_email text, p_email_hmac text, p_email_enc bytea, p_token_hash text,
  p_role_codes text[], p_invited_by uuid, p_approval uuid, p_mode text, p_now timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req app.approval_request%rowtype;
  v_superadmins integer;
  v_pendentes integer;
  v_superadmin_convite boolean;
begin
  if p_id is null or p_kind is distinct from 'ativacao' or p_email is null or p_email_hmac is null
     or p_email_hmac !~ '^[0-9a-f]{64}$' or p_email_enc is null or p_token_hash is null
     or p_token_hash !~ '^[0-9a-f]{64}$' or p_role_codes is null or cardinality(p_role_codes) < 1
     or p_now is null then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_role_codes) rc
              where not exists (select 1 from app.admin_role r where r.code = rc)) then
    raise exception 'papel_inexistente' using errcode = 'ADM04';
  end if;

  if p_invited_by is not null then
    if not private.admin_has_permission(p_invited_by, 'admin.role.manage') then
      raise exception 'permissao_negada' using errcode = '42501';
    end if;
  else
    -- Bootstrap: so o papel superadmin; 'primeiro' exige zero Superadmins; 'continuidade' exige um.
    select count(distinct r.user_id) into v_superadmins
      from app.admin_user_role r
      join app.admin_staff s on s.user_id = r.user_id and s.status = 'ativo'
     where r.role_code = 'superadmin' and r.revoked_at is null;
    if p_role_codes <> array['superadmin']
       or p_mode is null or p_mode not in ('primeiro', 'continuidade')
       or (p_mode = 'primeiro' and v_superadmins <> 0)
       or (p_mode = 'continuidade' and v_superadmins <> 1)
       or exists (select 1 from app.admin_invite i
                   where i.invited_by is null and i.state in ('emitido', 'aguardando_totp')
                     and i.email_hmac <> p_email_hmac) then
      raise exception 'bootstrap_recusado' using errcode = 'ADM10';
    end if;
  end if;

  -- E-mail ja usado por conta, salvo o convite aguardando TOTP do mesmo e-mail para a mesma conta pendente.
  if exists (select 1 from app.app_user u
              where u.email = p_email
                and not exists (select 1
                                  from app.admin_invite i
                                  join app.admin_staff s on s.user_id = i.user_id
                                 where i.user_id = u.id and i.email_hmac = p_email_hmac
                                   and i.state = 'aguardando_totp' and s.status = 'pendente_mfa')) then
    raise exception 'email_indisponivel' using errcode = 'ADM06';
  end if;

  v_superadmin_convite := 'superadmin' = any (p_role_codes) and p_invited_by is not null;
  if v_superadmin_convite then
    select * into v_req from app.approval_request r where r.id = p_approval for update;
    if not found or v_req.action_type <> 'papel_superadmin' or v_req.detail_code <> 'superadmin'
       or v_req.status <> 'aprovada' or v_req.consumed_at is not null
       or v_req.subject_user_id is not null or v_req.requested_by <> p_invited_by
       or v_req.expires_at <= p_now then
      raise exception 'aprovacao_invalida' using errcode = 'ADM03';
    end if;
    update app.approval_request set status = 'consumida', consumed_at = p_now where id = p_approval;
  end if;

  update app.admin_invite i
     set state = 'invalidado', email_enc = null
   where i.email_hmac = p_email_hmac and i.state in ('emitido', 'aguardando_totp');

  insert into app.admin_invite (id, kind, email_hmac, email_enc, token_hash, role_codes, invited_by,
                                approval_request_id, state, attempts, user_id, created_at,
                                expires_at, used_at)
  values (p_id, p_kind, p_email_hmac, p_email_enc, p_token_hash, p_role_codes, p_invited_by,
          case when v_superadmin_convite then p_approval end, 'emitido', 0, null, p_now,
          p_now + interval '72 hours', null);

  if p_invited_by is null then
    perform private.audit_append('system:bootstrap', 'system', 'admin.bootstrap.invite_issued',
      'admin_invite', p_id, '{}'::jsonb, '{"state":"emitido","kind":"ativacao"}'::jsonb, null, null);
  else
    perform private.audit_append('admin:' || p_invited_by::text, 'superadmin', 'admin.invite.issued',
      'admin_invite', p_id, '{}'::jsonb, '{"state":"emitido","kind":"ativacao"}'::jsonb, null, null);
  end if;
  return p_id;
end
$$;

-- Leitura do convite vivo (sem trava). Devolve vazio se inexistente, usado, invalidado ou vencido.
create or replace function private.admin_invite_lookup(p_token_hash text, p_now timestamptz)
returns table (out_id uuid, out_kind text, out_state text, out_role_codes text[],
               out_email_enc bytea, out_user_id uuid, out_attempts smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.kind, i.state, i.role_codes, i.email_enc, i.user_id, i.attempts
    from app.admin_invite i
   where i.token_hash = p_token_hash
     and i.state in ('emitido', 'aguardando_totp')
     and i.expires_at > p_now
$$;

-- Passo 1 (54 §2): a conta do Auth ja existe e tem o user_id. Cria a conta pendente_mfa (uma vez) e
-- leva o convite a aguardando_totp. Idempotente para o mesmo user_id; outro user_id e recusado.
create or replace function private.admin_invite_mark_waiting(
  p_token_hash text, p_user_id uuid, p_now timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv app.admin_invite%rowtype;
begin
  select * into v_inv from app.admin_invite i where i.token_hash = p_token_hash for update;
  if not found or v_inv.expires_at <= p_now or v_inv.state not in ('emitido', 'aguardando_totp') then
    return false;
  end if;
  if v_inv.state = 'aguardando_totp' then
    return v_inv.user_id = p_user_id;
  end if;

  insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at, created_at,
                               status_changed_at)
  values (p_user_id, 'pendente_mfa',
          case when v_inv.invited_by is null then 'bootstrap' else 'convite' end,
          v_inv.invited_by, null, p_now, p_now)
  on conflict (user_id) do nothing;

  if not exists (select 1 from app.admin_staff s
                  where s.user_id = p_user_id and s.status = 'pendente_mfa') then
    return false;
  end if;

  update app.admin_invite set state = 'aguardando_totp', user_id = p_user_id where id = v_inv.id;
  return true;
end
$$;

-- Erro de codigo TOTP no passo 2: soma tentativas; a quinta invalida o convite (Superadmin reemite).
create or replace function private.admin_invite_record_code_failure(p_token_hash text, p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
begin
  update app.admin_invite i
     set attempts = i.attempts + 1,
         state = case when i.attempts + 1 >= 5 then 'invalidado' else i.state end,
         email_enc = case when i.attempts + 1 >= 5 then null else i.email_enc end
   where i.token_hash = p_token_hash and i.state = 'aguardando_totp' and i.expires_at > p_now
  returning i.attempts into v_attempts;
  return v_attempts;
end
$$;

-- Passo 2 (54 §2): codigo confirmado pelo Auth. Em uma transacao: conta ativa com TOTP, papeis do
-- convite, convite usado e e-mail cifrado apagado, com auditoria. Nao abre sessao.
create or replace function private.admin_invite_activate(p_token_hash text, p_now timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv app.admin_invite%rowtype;
  v_role text;
  v_origin text;
begin
  select * into v_inv from app.admin_invite i
   where i.token_hash = p_token_hash and i.state = 'aguardando_totp' and i.expires_at > p_now
   for update;
  if not found or v_inv.kind <> 'ativacao' then
    return null;
  end if;

  update app.admin_staff
     set status = 'ativo', mfa_enrolled_at = p_now, status_changed_at = p_now
   where user_id = v_inv.user_id and status = 'pendente_mfa';
  if not found then
    raise exception 'convite_sem_conta' using errcode = 'ADM11';
  end if;

  v_origin := case when v_inv.invited_by is null then 'bootstrap' else 'convite' end;
  foreach v_role in array v_inv.role_codes loop
    insert into app.admin_user_role (id, user_id, role_code, granted_by, grant_origin, granted_at,
                                     approval_request_id)
    values (gen_random_uuid(), v_inv.user_id, v_role, v_inv.invited_by, v_origin, p_now,
            case when v_role = 'superadmin' then v_inv.approval_request_id end);

    if v_inv.invited_by is null then
      perform private.audit_append('system:bootstrap', 'system', 'admin.role.granted', 'admin_staff',
        v_inv.user_id, '{"status":"inativo"}'::jsonb,
        jsonb_strip_nulls(jsonb_build_object('status', 'ativo', 'role_code', v_role,
                                             'approval_request_id', v_inv.approval_request_id)),
        null, null);
    else
      perform private.audit_append('admin:' || v_inv.invited_by::text, 'superadmin',
        'admin.role.granted', 'admin_staff', v_inv.user_id, '{"status":"inativo"}'::jsonb,
        jsonb_strip_nulls(jsonb_build_object('status', 'ativo', 'role_code', v_role,
                                             'approval_request_id', v_inv.approval_request_id)),
        null, null);
    end if;
  end loop;

  update app.admin_invite
     set state = 'usado', used_at = p_now, email_enc = null
   where id = v_inv.id;

  perform private.audit_append('admin:' || v_inv.user_id::text, 'admin', 'admin.account.activated',
    'admin_staff', v_inv.user_id, '{"status":"pendente_mfa"}'::jsonb, '{"status":"ativo"}'::jsonb,
    null, null);
  return v_inv.user_id;
end
$$;

-- 11. Postura de acesso (igual H-011/H-012) ----------------------------------------------------------
alter table app.admin_role enable row level security;
alter table app.admin_role force row level security;
alter table app.admin_permission enable row level security;
alter table app.admin_permission force row level security;
alter table app.admin_role_permission enable row level security;
alter table app.admin_role_permission force row level security;
alter table app.admin_user_role enable row level security;
alter table app.admin_user_role force row level security;
alter table app.admin_invite enable row level security;
alter table app.admin_invite force row level security;
alter table app.admin_session enable row level security;
alter table app.admin_session force row level security;

revoke all on app.admin_role, app.admin_permission, app.admin_role_permission, app.admin_user_role,
  app.admin_invite, app.admin_session from public, anon, authenticated, service_role, app_api;
grant select, insert, update, delete on app.admin_role, app.admin_permission,
  app.admin_role_permission, app.admin_user_role, app.admin_invite, app.admin_session to app_system;

revoke all on function
  private.admin_has_permission(uuid, text),
  private.admin_guard(text, timestamptz),
  private.admin_session_open(uuid, uuid, text, timestamptz),
  private.admin_session_revoke(text, timestamptz),
  private.admin_session_purge(timestamptz),
  private.approval_vote_guard(),
  private.admin_approval_open(uuid, text, uuid, text, uuid, timestamptz),
  private.admin_approval_vote(uuid, uuid, timestamptz),
  private.admin_self_grant_denied_record(uuid, text),
  private.admin_role_grant(uuid, uuid, text, uuid, timestamptz),
  private.admin_role_revoke(uuid, uuid, text, timestamptz),
  private.admin_email_is_reserved(text, text),
  private.admin_invite_issue(uuid, text, text, text, bytea, text, text[], uuid, uuid, text, timestamptz),
  private.admin_invite_lookup(text, timestamptz),
  private.admin_invite_mark_waiting(text, uuid, timestamptz),
  private.admin_invite_record_code_failure(text, timestamptz),
  private.admin_invite_activate(text, timestamptz)
  from public, anon, authenticated, service_role, app_api;

grant execute on function
  private.approval_vote_guard(),
  private.admin_guard(text, timestamptz),
  private.admin_session_open(uuid, uuid, text, timestamptz),
  private.admin_session_revoke(text, timestamptz),
  private.admin_session_purge(timestamptz),
  private.admin_approval_open(uuid, text, uuid, text, uuid, timestamptz),
  private.admin_approval_vote(uuid, uuid, timestamptz),
  private.admin_self_grant_denied_record(uuid, text),
  private.admin_role_grant(uuid, uuid, text, uuid, timestamptz),
  private.admin_role_revoke(uuid, uuid, text, timestamptz),
  private.admin_email_is_reserved(text, text),
  private.admin_invite_issue(uuid, text, text, text, bytea, text, text[], uuid, uuid, text, timestamptz),
  private.admin_invite_lookup(text, timestamptz),
  private.admin_invite_mark_waiting(text, uuid, timestamptz),
  private.admin_invite_record_code_failure(text, timestamptz),
  private.admin_invite_activate(text, timestamptz)
  to app_system;

-- 12. Troca da funcao de reserva da migracao anterior (assinatura de um argumento) -----------------
drop function if exists private.admin_email_is_reserved(text);
