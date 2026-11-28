-- H-073 (#83) | Acesso excepcional a conversa: caso, registro de leitura, janela de 30 min e gate
-- (docs/factory/60-DESENHO-H073.md §1 a §4). Idempotente.
-- Desfazer: supabase/rollbacks/20261111290000_admin_create_access_case.down.sql (manual, so em dev).
-- Depende de 20261111220000 (admin_staff, approval_request, papeis) e 20261111280000 (totp_at).
-- A aprovacao com o tipo 'acesso_conversa' e o voto por tipo entram na migracao seguinte
-- (20261111300000), para cada passo ficar pequeno e revisavel.
-- Postura igual a H-102: RLS forcada, sem politicas; so app_system usa as tabelas e as funcoes.
-- Somente acrescimo: sensitive_access_log recusa UPDATE, DELETE e TRUNCATE; access_case nao aceita
-- DELETE nem alteracao de campos da aprovacao depois de gravados.

-- 1. app.access_case: pedido de acesso com motivo, aprovacao de outra pessoa e janela de 30 min ------
create table if not exists app.access_case (
  id                  uuid primary key,
  opened_by           uuid not null references app.admin_staff (user_id),
  authorized_by       uuid references app.admin_staff (user_id),
  justification       text not null
                        check (char_length(btrim(justification)) between 20 and 500),
  scope_kind          text not null check (scope_kind = 'conversation'),
  scope_id            uuid not null,
  approval_request_id uuid not null unique references app.approval_request (id),
  created_at          timestamptz not null,
  approved_at         timestamptz,
  expires_at          timestamptz,
  closed_at           timestamptz,
  closed_by           uuid references app.admin_staff (user_id),
  close_reason        text check (close_reason in ('encerrado', 'revogado')),
  constraint access_case_autorizador_outro check (authorized_by is null or authorized_by <> opened_by),
  constraint access_case_aprovacao_completa check (
    (approved_at is null) = (expires_at is null) and (approved_at is null) = (authorized_by is null)),
  constraint access_case_janela_30min check (expires_at is null or expires_at = approved_at + interval '30 minutes'),
  constraint access_case_fechamento_completo check (
    (closed_at is null) = (closed_by is null) and (closed_at is null) = (close_reason is null))
);

comment on table app.access_case is
  'Caso de acesso excepcional a uma conversa (H-073). Janela de 30 min a partir da aprovacao, sem renovacao.';

-- Campos da aprovacao: vazios -> preenchidos uma vez. Preenchidos nunca mudam. Campos de origem nunca mudam.
create or replace function private.access_case_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.opened_by is distinct from old.opened_by
     or new.justification is distinct from old.justification
     or new.scope_kind is distinct from old.scope_kind
     or new.scope_id is distinct from old.scope_id
     or new.approval_request_id is distinct from old.approval_request_id
     or new.created_at is distinct from old.created_at then
    raise exception 'caso_origem_imutavel' using errcode = '42501';
  end if;
  if old.approved_at is not null and (
       new.approved_at is distinct from old.approved_at
    or new.expires_at is distinct from old.expires_at
    or new.authorized_by is distinct from old.authorized_by) then
    raise exception 'caso_aprovado_imutavel' using errcode = '42501';
  end if;
  if old.closed_at is not null and (
       new.closed_at is distinct from old.closed_at
    or new.closed_by is distinct from old.closed_by
    or new.close_reason is distinct from old.close_reason) then
    raise exception 'caso_fechado_imutavel' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists access_case_guard_update on app.access_case;
create trigger access_case_guard_update
  before update on app.access_case
  for each row execute function private.access_case_guard_update();

create or replace function private.access_case_refuse_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'registro_somente_acrescimo' using errcode = '42501';
end
$$;

drop trigger if exists access_case_no_delete on app.access_case;
create trigger access_case_no_delete
  before delete or truncate on app.access_case
  for each statement execute function private.access_case_refuse_mutation();

-- 2. app.sensitive_access_log: um registro por pagina lida. Sem texto, e-mail, telefone ou justificativa --
create table if not exists app.sensitive_access_log (
  id             uuid primary key,
  case_id        uuid not null references app.access_case (id),
  actor_id       uuid not null references app.admin_staff (user_id),
  scope_kind     text not null check (scope_kind = 'conversation'),
  scope_id       uuid not null,
  action         text not null check (action = 'read'),
  read_at        timestamptz not null,
  audit_event_id uuid not null
);

create index if not exists sensitive_access_log_caso_idx on app.sensitive_access_log (case_id, read_at);
create index if not exists sensitive_access_log_escopo_idx on app.sensitive_access_log (scope_id, read_at);

comment on table app.sensitive_access_log is
  'Registro de cada leitura excepcional (H-073, CA-H073-06). Append-only: sem UPDATE, DELETE nem TRUNCATE.';

drop trigger if exists sensitive_access_log_no_mutation on app.sensitive_access_log;
create trigger sensitive_access_log_no_mutation
  before update or delete or truncate on app.sensitive_access_log
  for each statement execute function private.access_case_refuse_mutation();

-- 3. Acoes de auditoria do caso (chaves sem dado pessoal; justificativa fica so em access_case) --------
insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('access_case.opened', 'access_case', false, array['status', 'scope_kind'],
   'Caso de acesso excepcional aberto (H-073)'),
  ('access_case.approved', 'access_case', false, array['status'],
   'Caso de acesso excepcional aprovado por outra pessoa (H-073)'),
  ('access_case.closed', 'access_case', false, array['status', 'close_reason'],
   'Caso de acesso excepcional encerrado ou revogado (H-073)'),
  ('access_case.conversation_read', 'conversation', false, array['case_id', 'scope_kind'],
   'Leitura de conversa sob caso excepcional (H-073, CA-H073-06)'),
  ('access_case.read_denied', 'conversation', false, array['reason_code'],
   'Tentativa de leitura negada apos o caso (H-073; gravada em transacao propria pela API)')
on conflict (action, object_type) do nothing;

-- 4. Permissao de autorizar o caso: so o Superadmin (D-7-1, 60 §7). Abrir continua em Suporte.
-- A permissao nova entra no mapa; a migracao seguinte aplica o voto por tipo.
insert into app.admin_permission (code, label) values
  ('case.authorize_sensitive', 'Autorizar caso sensivel')
on conflict (code) do nothing;

insert into app.admin_role_permission (role_code, permission_code) values
  ('superadmin', 'case.authorize_sensitive')
on conflict do nothing;

-- 5. Funcoes internas: sessao valida do ator (devolve totp_at ou nulo) e janela de prova recente --------
create or replace function private.access_case_session_totp(p_actor uuid, p_session_hash text, p_now timestamptz)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select s.totp_at
    from app.admin_session s
   where s.secret_hash = p_session_hash
     and s.user_id = p_actor
     and s.revoked_at is null
     and s.expires_at > p_now
$$;

-- 6. Abrir: pendente, sem liberar nada. Ordem: permissao, sessao, prova recente, entrada, limites. ------
create or replace function private.access_case_open(
  p_actor uuid, p_session_hash text, p_conversation uuid, p_justification text,
  p_case_id uuid, p_now timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_totp timestamptz;
  v_request uuid := gen_random_uuid();
begin
  if p_actor is null or p_session_hash is null or p_case_id is null or p_now is null then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  if not private.admin_has_permission(p_actor, 'case.open_sensitive') then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  v_totp := private.access_case_session_totp(p_actor, p_session_hash, p_now);
  if v_totp is null then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  if not (p_now < v_totp + interval '30 minutes') then
    raise exception 'step_up_required' using errcode = 'ADM21';
  end if;
  if p_conversation is null then
    raise exception 'conversa_invalida' using errcode = 'ADM22';
  end if;
  if char_length(btrim(coalesce(p_justification, ''))) not between 20 and 500 then
    raise exception 'justificativa_invalida' using errcode = 'ADM22';
  end if;

  -- Serializa as aberturas do mesmo solicitante (20 simultaneas = 1 caso por conversa).
  perform pg_advisory_xact_lock(hashtext('access_case:' || p_actor::text));

  if (select count(*) from app.access_case c
        join app.approval_request r on r.id = c.approval_request_id
       where c.opened_by = p_actor and c.closed_at is null and c.approved_at is null
         and r.status = 'pendente' and r.expires_at > p_now) >= 5 then
    raise exception 'muitos_casos_pendentes' using errcode = 'ADM24';
  end if;

  if exists (select 1 from app.access_case c
              where c.opened_by = p_actor and c.scope_id = p_conversation and c.closed_at is null
                and ((c.approved_at is null and c.expires_at is null)
                     or (c.approved_at <= p_now and c.expires_at > p_now))) then
    raise exception 'caso_ja_existe' using errcode = 'ADM23';
  end if;

  insert into app.approval_request (id, action_type, subject_user_id, detail_code, requested_by,
                                    required_approvals, status, created_at, expires_at)
  values (v_request, 'acesso_conversa', null, null, p_actor, 1, 'pendente', p_now, p_now + interval '24 hours');

  insert into app.access_case (id, opened_by, justification, scope_kind, scope_id, approval_request_id,
                               created_at)
  values (p_case_id, p_actor, p_justification, 'conversation', p_conversation, v_request, p_now);

  perform private.audit_append('admin:' || p_actor::text, 'admin', 'access_case.opened',
    'access_case', p_case_id, '{}'::jsonb, '{"status":"pendente","scope_kind":"conversation"}'::jsonb, null, null);
  return p_case_id;
end
$$;

-- 7. Aprovar: outra pessoa com case.authorize_sensitive, prova recente. Uso unico do pedido. ------------
-- O voto usa private.admin_approval_vote (que recusa autoaprovacao e voto repetido pelo gatilho).
create or replace function private.access_case_approve(
  p_actor uuid, p_session_hash text, p_case uuid, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case app.access_case%rowtype;
  v_req app.approval_request%rowtype;
  v_totp timestamptz;
begin
  if p_actor is null or p_session_hash is null or p_case is null or p_now is null then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  if not private.admin_has_permission(p_actor, 'case.authorize_sensitive') then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  v_totp := private.access_case_session_totp(p_actor, p_session_hash, p_now);
  if v_totp is null then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  if not (p_now < v_totp + interval '30 minutes') then
    raise exception 'step_up_required' using errcode = 'ADM21';
  end if;

  select * into v_case from app.access_case c where c.id = p_case for update;
  if not found then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  select * into v_req from app.approval_request r where r.id = v_case.approval_request_id for update;

  if v_case.approved_at is not null or v_case.closed_at is not null
     or v_req.status <> 'pendente' or v_req.expires_at <= p_now then
    raise exception 'caso_nao_pendente' using errcode = 'ADM25';
  end if;

  perform private.admin_approval_vote(v_req.id, p_actor, p_now);

  update app.approval_request set status = 'consumida', consumed_at = p_now where id = v_req.id;

  update app.access_case
     set authorized_by = p_actor,
         approved_at = p_now,
         expires_at = p_now + interval '30 minutes'
   where id = p_case;

  perform private.audit_append('admin:' || p_actor::text, 'admin', 'access_case.approved',
    'access_case', p_case, '{}'::jsonb, '{"status":"ativo"}'::jsonb, null, null);
end
$$;

-- 8. Fechar: o solicitante (encerrado) ou quem autoriza (revogado). Idempotente. -----------------------
create or replace function private.access_case_close(p_actor uuid, p_case uuid, p_now timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case app.access_case%rowtype;
  v_reason text;
begin
  if p_actor is null or p_case is null or p_now is null then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  select * into v_case from app.access_case c where c.id = p_case for update;
  if not found then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  if v_case.closed_at is not null then
    return false;
  end if;
  if v_case.opened_by = p_actor then
    v_reason := 'encerrado';
  elsif private.admin_has_permission(p_actor, 'case.authorize_sensitive') then
    v_reason := 'revogado';
  else
    raise exception 'permissao_negada' using errcode = '42501';
  end if;

  update app.access_case
     set closed_at = p_now, closed_by = p_actor, close_reason = v_reason
   where id = p_case;

  perform private.audit_append('admin:' || p_actor::text, 'admin', 'access_case.closed',
    'access_case', p_case, '{}'::jsonb, jsonb_build_object('status', 'fechado', 'close_reason', v_reason),
    null, null);
  return true;
end
$$;

-- 9. Gate de leitura (60 §3). Chamado DENTRO da funcao que le a conversa, na mesma transacao. -------
-- Qualquer falha levanta ADM20 e a transacao inteira desfaz (sem caso, sem linha de log nem de leitura).
create or replace function private.access_case_gate(
  p_actor uuid, p_session_hash text, p_case uuid, p_conversation uuid, p_now timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case app.access_case%rowtype;
  v_totp timestamptz;
  v_audit uuid;
  v_log uuid := gen_random_uuid();
begin
  if p_actor is null or p_session_hash is null or p_case is null or p_conversation is null or p_now is null then
    raise exception 'acesso_negado' using errcode = 'ADM20';
  end if;
  v_totp := private.access_case_session_totp(p_actor, p_session_hash, p_now);
  if v_totp is null or not private.admin_has_permission(p_actor, 'case.open_sensitive') then
    raise exception 'acesso_negado' using errcode = 'ADM20';
  end if;

  select * into v_case from app.access_case c
   where c.id = p_case
     and c.opened_by = p_actor
     and c.scope_id = p_conversation
     and c.scope_kind = 'conversation'
     and c.closed_at is null
     and c.approved_at is not null
     and c.approved_at <= p_now
     and p_now < c.expires_at;
  if not found then
    raise exception 'acesso_negado' using errcode = 'ADM20';
  end if;

  v_audit := private.audit_append('admin:' || p_actor::text, 'admin', 'access_case.conversation_read',
    'conversation', p_conversation, '{}'::jsonb,
    jsonb_build_object('case_id', p_case, 'scope_kind', 'conversation'), null, null);

  insert into app.sensitive_access_log (id, case_id, actor_id, scope_kind, scope_id, action, read_at,
                                        audit_event_id)
  values (v_log, p_case, p_actor, 'conversation', p_conversation, 'read', p_now, v_audit);
  return v_log;
end
$$;

-- 10. Privilegios: so app_system (como nas migracoes de H-102) -----------------------------------------
alter table app.access_case enable row level security;
alter table app.access_case force row level security;
alter table app.sensitive_access_log enable row level security;
alter table app.sensitive_access_log force row level security;

revoke all on app.access_case, app.sensitive_access_log from public, anon, authenticated, service_role, app_api;
grant select, insert, update on app.access_case to app_system;
grant select, insert on app.sensitive_access_log to app_system;

revoke all on function
  private.access_case_guard_update(),
  private.access_case_refuse_mutation(),
  private.access_case_session_totp(uuid, text, timestamptz),
  private.access_case_open(uuid, text, uuid, text, uuid, timestamptz),
  private.access_case_approve(uuid, text, uuid, timestamptz),
  private.access_case_close(uuid, uuid, timestamptz),
  private.access_case_gate(uuid, text, uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role, app_api;

grant execute on function
  private.access_case_open(uuid, text, uuid, text, uuid, timestamptz),
  private.access_case_approve(uuid, text, uuid, timestamptz),
  private.access_case_close(uuid, uuid, timestamptz),
  private.access_case_gate(uuid, text, uuid, uuid, timestamptz)
  to app_system;
