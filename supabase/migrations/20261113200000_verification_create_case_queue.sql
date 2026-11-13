-- Issue 52 (H-039) | Fila de verificacao: caso por profissional, historico imutavel, decisao, recurso,
-- leitura do documento e fila (docs/factory/124-DESENHO-H039.md §3 a §4; decisoes 370 a 403).
-- Idempotente (if not exists, create or replace, on conflict do nothing). Desfazer:
-- supabase/rollbacks/20261113200000_verification_create_case_queue.down.sql (manual, so em dev).
-- Expansao ADITIVA: tabelas novas, gatilhos novos, colunas e constraints relaxadas em
-- app.sensitive_access_log (decisao 390), permissao nova, acoes novas no catalogo de auditoria.
-- Postura igual a H-073 e H-102: RLS forcada sem politicas; so app_system executa as funcoes.
-- Nenhum cron, ops.job ou gatilho de tempo (CA-H039-18). Relogio entra por parametro (p_now);
-- excecao unica: gatilho de criacao usa received_at do documento.
-- Decisao de implementacao: a funcao de caso nao mexe em updated_at; cada funcao grava p_now em
-- updated_at do caso e do perfil. A guarda do perfil confere esse mesmo instante (sem relogio).

-- 1. Funcoes puras de apoio ------------------------------------------------------------------------
-- Prazo-meta em dias uteis (dec. 384, 397): sabado e domingo contam como segunda 00:00 de Brasilia;
-- soma 2 dias uteis mantendo a hora local; sem feriados.
create or replace function private.verification_sla_target(p_from timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_local timestamp := p_from at time zone 'America/Sao_Paulo';
  v_dow integer := extract(isodow from (p_from at time zone 'America/Sao_Paulo'))::integer;
  v_i integer;
begin
  if v_dow >= 6 then
    v_local := date_trunc('day', v_local) + make_interval(days => 8 - v_dow);
  end if;
  for v_i in 1..2 loop
    v_local := v_local + interval '1 day';
    while extract(isodow from v_local) > 5 loop
      v_local := v_local + interval '1 day';
    end loop;
  end loop;
  return v_local at time zone 'America/Sao_Paulo';
end
$$;

-- Complemento sem dado pessoal (dec. 376, CA-H039-04): CPF, CNPJ, e-mail ou 10 ou mais digitos.
create or replace function private.verification_text_has_pii(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_text ~ '\d{3}\.?\d{3}\.?\d{3}-?\d{2}'
      or p_text ~ '\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}'
      or p_text ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'
      or p_text ~ '(\d[\s.()/-]*){10,}'
$$;

-- Transicoes validas do caso (CA-H039-03). Qualquer par fora desta lista e recusado pelo gatilho.
create or replace function private.verification_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('pendente', 'em_revisao'),
    ('em_revisao', 'em_revisao'),
    ('em_revisao', 'aprovada'),
    ('em_revisao', 'recusada'),
    ('em_revisao', 'retida_duplicidade'),
    ('retida_duplicidade', 'aprovada'),
    ('retida_duplicidade', 'recusada'),
    ('retida_duplicidade', 'retida_duplicidade'),
    ('recusada', 'em_revisao'),
    ('retida_duplicidade', 'em_revisao'))
$$;

-- 2. app.verification_case: um caso por profissional --------------------------------------------------
create table if not exists app.verification_case (
  id                          uuid primary key default gen_random_uuid(),
  professional_id             uuid not null unique references app.professional_profile (user_id) on delete restrict,
  status                      text not null default 'pendente'
                                constraint verification_case_status_check
                                check (status in ('pendente', 'em_revisao', 'retida_duplicidade', 'aprovada', 'recusada', 'suspensa')),
  assigned_to                 uuid references app.admin_staff (user_id),
  assigned_at                 timestamptz,
  reason_code                 text
                                constraint verification_case_reason_check
                                check (reason_code is null or reason_code in ('aprovado', 'documento_ilegivel', 'documento_divergente',
                                  'tipo_nao_aceito', 'duplicidade_suspeita', 'certificacao_insuficiente', 'outro')),
  explanation_to_professional text
                                constraint verification_case_explanation_len
                                check (char_length(explanation_to_professional) <= 500),
  appeal_status               text not null default 'nenhum'
                                constraint verification_case_appeal_check check (appeal_status in ('nenhum', 'pendente', 'decidido')),
  decided_by                  uuid references app.admin_staff (user_id),
  decided_at                  timestamptz,
  sla_target_at               timestamptz not null,
  version                     integer not null default 1,
  created_at                  timestamptz not null,
  updated_at                  timestamptz not null,
  constraint vc_pendente_sem_responsavel check (status <> 'pendente' or assigned_to is null),
  constraint vc_revisao_com_responsavel check (status <> 'em_revisao' or assigned_to is not null or appeal_status = 'pendente'),
  constraint vc_decisao_completa check (status not in ('aprovada', 'recusada', 'retida_duplicidade')
    or (reason_code is not null and decided_by is not null and decided_at is not null)),
  constraint vc_outro_com_explicacao check (reason_code <> 'outro'
    or char_length(btrim(coalesce(explanation_to_professional, ''))) > 0),
  constraint vc_recurso_so_apos_decisao check (appeal_status = 'nenhum' or decided_at is not null)
);

create index if not exists verification_case_fila_pendente_idx
  on app.verification_case (sla_target_at, id) where status = 'pendente';
create index if not exists verification_case_fila_minha_idx
  on app.verification_case (assigned_to, sla_target_at, id) where status in ('em_revisao', 'retida_duplicidade');
create index if not exists verification_case_fila_recurso_idx
  on app.verification_case (sla_target_at, id) where status = 'em_revisao' and assigned_to is null;

comment on table app.verification_case is
  'Caso de verificacao de identidade (Issue 52, H-039). Fonte do estado; o perfil espelha na mesma transacao.';

-- 3. app.verification_case_event: historico imutavel --------------------------------------------------
create table if not exists app.verification_case_event (
  id             uuid primary key default gen_random_uuid(),
  case_id        uuid not null references app.verification_case (id) on delete restrict,
  seq            integer not null,
  action         text not null
                   constraint verification_case_event_action_check
                   check (action in ('created', 'assigned', 'reassigned', 'document_read', 'decided', 'appeal_received')),
  actor_id       uuid references app.admin_staff (user_id),
  actor_role     text not null
                   constraint verification_case_event_role_check
                   check (actor_role in ('system', 'verificacao', 'superadmin', 'profissional')),
  from_status    text,
  to_status      text,
  reason_code    text,
  explanation    text,
  audit_event_id uuid not null,
  at             timestamptz not null,
  constraint verification_case_event_seq_uk unique (case_id, seq),
  constraint verification_case_event_ator_nulo check (actor_id is not null
    or action in ('created', 'appeal_received'))
);

create index if not exists verification_case_event_caso_idx on app.verification_case_event (case_id, at);

comment on table app.verification_case_event is
  'Historico imutavel do caso de verificacao (Issue 52, H-039). Fonte do evento de saida (dec. 385, 399).';

-- Recusa qualquer mutacao (historico) e qualquer exclusao (caso).
create or replace function private.verification_event_refuse_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'vrf_evento_imutavel' using errcode = '42501';
end
$$;

drop trigger if exists verification_case_event_no_mutation on app.verification_case_event;
create trigger verification_case_event_no_mutation
  before update or delete or truncate on app.verification_case_event
  for each statement execute function private.verification_event_refuse_mutation();

create or replace function private.verification_case_refuse_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'vrf_sem_delete' using errcode = '42501';
end
$$;

drop trigger if exists verification_case_no_delete on app.verification_case;
create trigger verification_case_no_delete
  before delete or truncate on app.verification_case
  for each statement execute function private.verification_case_refuse_delete();

-- Guarda do caso: identidade imutavel, transicao valida, versao sobe a cada mudanca.
create or replace function private.verification_case_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.professional_id is distinct from old.professional_id
     or new.created_at is distinct from old.created_at then
    raise exception 'vrf_imutavel' using errcode = '42501';
  end if;
  if not private.verification_transition_allowed(old.status, new.status) then
    raise exception 'vrf_transicao_invalida' using errcode = '42501';
  end if;
  new.version := old.version + 1;
  return new;
end
$$;

drop trigger if exists verification_case_guard on app.verification_case;
create trigger verification_case_guard
  before update on app.verification_case
  for each row execute function private.verification_case_guard();

-- 4. app.sensitive_access_log: expansao aditiva (dec. 390) ---------------------------------------------
-- Remove qualquer CHECK que cite scope_kind (o de H-073 e os novos) e recria a serie completa.
do $$
declare
  r record;
begin
  for r in
    select c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'app' and t.relname = 'sensitive_access_log' and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%scope_kind%'
  loop
    execute format('alter table app.sensitive_access_log drop constraint %I', r.conname);
  end loop;
end
$$;

alter table app.sensitive_access_log alter column case_id drop not null;
alter table app.sensitive_access_log add column if not exists verification_case_id uuid
  references app.verification_case (id);
alter table app.sensitive_access_log add column if not exists reason_code text;

alter table app.sensitive_access_log add constraint sensitive_access_log_scope_kind_check
  check (scope_kind in ('conversation', 'identity_document'));
alter table app.sensitive_access_log add constraint sensitive_access_log_escopo_caso_check
  check ((scope_kind = 'conversation') = (case_id is not null));
alter table app.sensitive_access_log add constraint sensitive_access_log_escopo_verificacao_check
  check ((scope_kind = 'identity_document') = (verification_case_id is not null));
alter table app.sensitive_access_log add constraint sensitive_access_log_motivo_leitura_check
  check (scope_kind <> 'identity_document'
         or reason_code in ('analise_inicial', 'conferencia_duvida', 'reanalise_recurso'));

create index if not exists sensitive_access_log_verificacao_idx
  on app.sensitive_access_log (verification_case_id, read_at) where verification_case_id is not null;

-- 5. Sessao, espelho e evento (funcoes de apoio, sem execucao para papeis de API) ----------------------
create or replace function private.verification_session_ok(p_actor uuid, p_session_hash text, p_now timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.admin_session s
     where s.secret_hash = p_session_hash
       and s.user_id = p_actor
       and s.revoked_at is null
       and s.expires_at > p_now)
$$;

-- O perfil so muda para o estado de um caso com o mesmo instante (mesma transacao).
create or replace function private.verification_case_mirrors(p_user uuid, p_status text, p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.verification_case c
     where c.professional_id = p_user and c.status = p_status and c.updated_at = p_at)
$$;

create or replace function private.verification_event_add(
  p_case uuid, p_action text, p_actor uuid, p_role text, p_from text, p_to text,
  p_reason text, p_explanation text, p_audit uuid, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into app.verification_case_event (id, case_id, seq, action, actor_id, actor_role, from_status,
                                           to_status, reason_code, explanation, audit_event_id, at)
  values (gen_random_uuid(), p_case,
          (select coalesce(max(e.seq), 0) + 1 from app.verification_case_event e where e.case_id = p_case),
          p_action, p_actor, p_role, p_from, p_to, p_reason, p_explanation, p_audit, p_at);
end
$$;

-- REG (dec. 373, 403): servico regulamentado vinculado ao profissional. Sem a funcao de #51, fail closed.
create or replace function private.verification_reg_gate(p_professional uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  if not exists (
       select 1 from app.professional_service ps
         join app.service s on s.id = ps.service_id
        where ps.professional_id = p_professional and s.regulated) then
    return 'sem_reg';
  end if;
  if to_regprocedure('private.certificacoes_completas(uuid)') is null then
    return 'incompletas';
  end if;
  execute 'select private.certificacoes_completas($1)' into v_ok using p_professional;
  return case when coalesce(v_ok, false) then 'completas' else 'incompletas' end;
end
$$;

-- 6. Criacao do caso (CA-H039-01, 15; dec. 370, 393, 401) -----------------------------------------------
create or replace function private.verification_case_create(p_professional uuid, p_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_audit uuid;
begin
  insert into app.verification_case (id, professional_id, status, sla_target_at, created_at, updated_at)
  values (v_id, p_professional, 'pendente', private.verification_sla_target(p_at), p_at, p_at)
  on conflict (professional_id) do nothing;
  if not found then
    return null;
  end if;
  v_audit := private.audit_append('system:verification', 'system', 'verification.case.created',
    'verification_case', v_id, '{}'::jsonb, '{"status":"pendente"}'::jsonb, null, null);
  perform private.verification_event_add(v_id, 'created', null, 'system', null, 'pendente', null, null, v_audit, p_at);
  return v_id;
end
$$;

create or replace function private.verification_case_on_idoc_received()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.verification_case_create(new.professional_id, coalesce(new.received_at, clock_timestamp()));
  return new;
end
$$;

drop trigger if exists identity_document_verification_case on app.identity_document;
create trigger identity_document_verification_case
  after update of status on app.identity_document
  for each row
  when (new.status = 'recebido' and old.status is distinct from 'recebido')
  execute function private.verification_case_on_idoc_received();

-- 7. Guarda do perfil: a mesma regra de H-035 e H-102, acrescida do espelho do caso (dec. 371) -----------
-- Preserva as duas excecoes anteriores (primeiro cadastro e suspensao) e acrescenta a transicao espelhada.
create or replace function private.professional_profile_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.document_hmac is not null and (
       new.public_name is distinct from old.public_name
    or new.slug is distinct from old.slug
    or new.document_type is distinct from old.document_type
    or new.document_enc is distinct from old.document_enc
    or new.document_hmac is distinct from old.document_hmac) then
    raise exception 'professional_documento_imutavel' using errcode = '42501';
  end if;

  if new.verification_status is distinct from old.verification_status then
    if not (
         (old.document_hmac is null
          and old.verification_status = 'pendente'
          and new.verification_status in ('pendente', 'retida_duplicidade')
          and new.document_hmac is not null)
      or (new.verification_status = 'suspensa'
          and old.verification_status <> 'suspensa'
          and new.suspended_at is not null
          and exists (
            select 1 from app.approval_request r
             where r.action_type = 'suspensao_permanente'
               and r.subject_ref = new.user_id
               and r.status = 'consumida'
               and r.consumed_at = new.suspended_at))
      or (new.verification_status in ('em_revisao', 'aprovada', 'recusada', 'retida_duplicidade')
          and old.verification_status in ('pendente', 'em_revisao', 'retida_duplicidade', 'recusada')
          and private.verification_case_mirrors(new.user_id, new.verification_status, new.updated_at))
    ) then
      raise exception 'professional_status_protegido' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- 8. Atribuicao, reatribuicao, decisao, recurso (CA-H039-02 a 07, 13, 14; dec. 372, 378, 379, 400) -----
create or replace function private.verification_case_assign(
  p_actor uuid, p_session_hash text, p_case uuid, p_expected_version integer, p_now timestamptz)
returns table (out_status text, out_version integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case app.verification_case%rowtype;
  v_version integer;
  v_audit uuid;
begin
  if p_actor is null or p_session_hash is null or p_case is null or p_expected_version is null or p_now is null then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  if not private.admin_has_permission(p_actor, 'verification.review')
     or not private.verification_session_ok(p_actor, p_session_hash, p_now) then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  select * into v_case from app.verification_case c where c.id = p_case for update;
  if not found or v_case.professional_id = p_actor then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  if v_case.version <> p_expected_version then
    raise exception 'caso_conflito' using errcode = 'VRF01';
  end if;
  if v_case.status = 'pendente' then
    null;
  elsif v_case.status = 'em_revisao' and v_case.assigned_to is null and v_case.appeal_status = 'pendente' then
    if v_case.decided_by = p_actor then
      raise exception 'permissao_negada' using errcode = '42501';
    end if;
  else
    raise exception 'caso_conflito' using errcode = 'VRF01';
  end if;

  update app.verification_case c
     set status = 'em_revisao', assigned_to = p_actor, assigned_at = p_now, updated_at = p_now
   where c.id = p_case;
  update app.professional_profile p
     set verification_status = 'em_revisao', updated_at = p_now
   where p.user_id = v_case.professional_id;

  v_audit := private.audit_append('admin:' || p_actor::text, 'verificacao', 'verification.case.assigned',
    'verification_case', p_case, jsonb_build_object('status', v_case.status, 'assigned', false),
    '{"status":"em_revisao","assigned":true}'::jsonb, null, null);
  perform private.verification_event_add(p_case, 'assigned', p_actor, 'verificacao', v_case.status,
    'em_revisao', null, null, v_audit, p_now);

  select c.version into v_version from app.verification_case c where c.id = p_case;
  return query select 'em_revisao'::text, v_version;
end
$$;

create or replace function private.verification_case_reassign(
  p_actor uuid, p_session_hash text, p_case uuid, p_new_assignee uuid,
  p_expected_version integer, p_now timestamptz)
returns table (out_status text, out_version integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case app.verification_case%rowtype;
  v_version integer;
  v_audit uuid;
begin
  if p_actor is null or p_session_hash is null or p_case is null or p_expected_version is null
     or p_now is null then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  if not private.admin_has_permission(p_actor, 'verification.reassign')
     or not private.verification_session_ok(p_actor, p_session_hash, p_now) then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  select * into v_case from app.verification_case c where c.id = p_case for update;
  if not found then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  if v_case.version <> p_expected_version then
    raise exception 'caso_conflito' using errcode = 'VRF01';
  end if;
  if v_case.status not in ('em_revisao', 'retida_duplicidade') or v_case.assigned_to is null
     or p_new_assignee is not distinct from v_case.assigned_to then
    raise exception 'caso_conflito' using errcode = 'VRF01';
  end if;
  if p_new_assignee is null or not private.admin_has_permission(p_new_assignee, 'verification.review')
     or p_new_assignee = v_case.professional_id then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  if v_case.appeal_status = 'pendente' and p_new_assignee = v_case.decided_by then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;

  update app.verification_case c
     set assigned_to = p_new_assignee, assigned_at = p_now, updated_at = p_now
   where c.id = p_case;

  v_audit := private.audit_append('admin:' || p_actor::text, 'superadmin', 'verification.case.reassigned',
    'verification_case', p_case, '{"assigned":true}'::jsonb, '{"assigned":true}'::jsonb, null, null);
  perform private.verification_event_add(p_case, 'reassigned', p_actor, 'superadmin', v_case.status,
    v_case.status, null, null, v_audit, p_now);

  select c.version into v_version from app.verification_case c where c.id = p_case;
  return query select v_case.status, v_version;
end
$$;

create or replace function private.verification_case_decide(
  p_actor uuid, p_session_hash text, p_case uuid, p_decision text, p_reason_code text,
  p_complement text, p_expected_version integer, p_now timestamptz)
returns table (out_status text, out_version integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case app.verification_case%rowtype;
  v_profile app.professional_profile%rowtype;
  v_complement text := nullif(btrim(coalesce(p_complement, '')), '');
  v_version integer;
  v_audit uuid;
  v_appeal_after text;
begin
  if p_actor is null or p_session_hash is null or p_case is null or p_expected_version is null or p_now is null then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  if not private.admin_has_permission(p_actor, 'verification.review')
     or not private.verification_session_ok(p_actor, p_session_hash, p_now) then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  select * into v_case from app.verification_case c where c.id = p_case for update;
  if not found or v_case.assigned_to is distinct from p_actor
     or v_case.status not in ('em_revisao', 'retida_duplicidade') then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  if v_case.version <> p_expected_version then
    raise exception 'caso_conflito' using errcode = 'VRF01';
  end if;

  if p_decision is null or p_decision not in ('aprovada', 'recusada', 'retida_duplicidade')
     or p_reason_code is null
     or p_reason_code not in ('aprovado', 'documento_ilegivel', 'documento_divergente', 'tipo_nao_aceito',
                              'duplicidade_suspeita', 'certificacao_insuficiente', 'outro')
     or (p_decision = 'aprovada' and p_reason_code <> 'aprovado')
     or (p_decision = 'retida_duplicidade' and p_reason_code <> 'duplicidade_suspeita')
     or (p_decision = 'recusada' and p_reason_code in ('aprovado', 'duplicidade_suspeita')) then
    raise exception 'motivo_invalido' using errcode = 'VRF02';
  end if;

  if (p_complement is not null and char_length(p_complement) > 500)
     or (p_reason_code = 'outro' and v_complement is null)
     or (v_complement is not null and private.verification_text_has_pii(v_complement)) then
    raise exception 'explicacao_invalida' using errcode = 'VRF03';
  end if;

  if p_decision = 'retida_duplicidade' and v_case.status <> 'em_revisao' then
    raise exception 'caso_conflito' using errcode = 'VRF01';
  end if;

  select * into v_profile from app.professional_profile p where p.user_id = v_case.professional_id for update;
  if p_decision = 'aprovada' then
    if not exists (select 1 from app.identity_document d
                    where d.professional_id = v_case.professional_id and d.status = 'recebido'
                      and d.purge_requested_at is null and d.analyzed_at is not null) then
      raise exception 'identidade_nao_analisada' using errcode = 'VRF04';
    end if;
    if v_profile.verification_status = 'suspensa' then
      raise exception 'perfil_suspenso' using errcode = 'VRF07';
    end if;
    if private.verification_reg_gate(v_case.professional_id) = 'incompletas' then
      raise exception 'certificacao_pendente' using errcode = 'VRF05';
    end if;
  end if;

  v_appeal_after := case when v_case.appeal_status = 'pendente' then 'decidido' else v_case.appeal_status end;
  update app.verification_case c
     set status = p_decision, reason_code = p_reason_code, explanation_to_professional = v_complement,
         decided_by = p_actor, decided_at = p_now, appeal_status = v_appeal_after, updated_at = p_now
   where c.id = p_case;
  update app.professional_profile p
     set verification_status = p_decision,
         verified_at = case when p_decision = 'aprovada' then p_now else p.verified_at end,
         updated_at = p_now
   where p.user_id = v_case.professional_id;

  v_audit := private.audit_append('admin:' || p_actor::text, 'verificacao', 'verification.case.decided',
    'verification_case', p_case,
    jsonb_build_object('status', v_case.status, 'appeal_status', v_case.appeal_status),
    jsonb_build_object('status', p_decision, 'appeal_status', v_appeal_after), p_reason_code, null);
  perform private.verification_event_add(p_case, 'decided', p_actor, 'verificacao', v_case.status, p_decision,
    p_reason_code, v_complement, v_audit, p_now);

  select c.version into v_version from app.verification_case c where c.id = p_case;
  return query select p_decision, v_version;
end
$$;

-- Recurso do profissional: a rota e de H-041 (dec. 392); aqui so a funcao (app_system).
create or replace function private.verification_case_appeal(p_professional uuid, p_now timestamptz)
returns table (out_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case app.verification_case%rowtype;
  v_audit uuid;
begin
  if p_professional is null or p_now is null then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  select * into v_case from app.verification_case c where c.professional_id = p_professional for update;
  if not found then
    return query select 'sem_caso'::text;
    return;
  end if;
  if v_case.appeal_status <> 'nenhum' then
    return query select 'recurso_ja_usado'::text;
    return;
  end if;
  if v_case.status not in ('recusada', 'retida_duplicidade') then
    return query select 'nao_elegivel'::text;
    return;
  end if;

  update app.verification_case c
     set status = 'em_revisao', appeal_status = 'pendente', assigned_to = null, assigned_at = null,
         updated_at = p_now
   where c.id = v_case.id;
  update app.professional_profile p
     set verification_status = 'em_revisao', updated_at = p_now
   where p.user_id = p_professional;

  v_audit := private.audit_append('professional:' || p_professional::text, 'profissional',
    'verification.case.appeal_received', 'verification_case', v_case.id,
    jsonb_build_object('status', v_case.status, 'appeal_status', 'nenhum'),
    '{"status":"em_revisao","appeal_status":"pendente"}'::jsonb, null, null);
  perform private.verification_event_add(v_case.id, 'appeal_received', null, 'profissional', v_case.status,
    'em_revisao', null, null, v_audit, p_now);
  return query select 'ok'::text;
end
$$;

-- 9. Leitura do documento (CA-H039-08 a 10, 12; dec. 382, 383, 389, 394, 395) ----------------------------
-- Autoriza, trava caso e documento, marca analise, grava log sensivel e evento, na transacao do chamador.
create or replace function private.idoc_review_target(
  p_actor uuid, p_session_hash text, p_case uuid, p_document uuid, p_reason_code text, p_now timestamptz)
returns table (out_id uuid, out_stored_type text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case app.verification_case%rowtype;
  v_doc app.identity_document%rowtype;
  v_totp timestamptz;
  v_audit uuid;
begin
  if p_actor is null or p_session_hash is null or p_case is null or p_document is null or p_now is null then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  if not private.admin_has_permission(p_actor, 'verification.review') then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  v_totp := private.access_case_session_totp(p_actor, p_session_hash, p_now);
  if v_totp is null or not (p_now < v_totp + interval '30 minutes') then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;

  select * into v_case from app.verification_case c where c.id = p_case for update;
  if not found or v_case.assigned_to is distinct from p_actor or v_case.status <> 'em_revisao' then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  if p_reason_code is null or p_reason_code not in ('analise_inicial', 'conferencia_duvida', 'reanalise_recurso') then
    raise exception 'motivo_invalido' using errcode = 'VRF02';
  end if;

  select * into v_doc from app.identity_document d
   where d.id = p_document and d.professional_id = v_case.professional_id and d.status = 'recebido'
     and d.purge_requested_at is null and d.stored_type is not null
   for update;
  if not found then
    raise exception 'documento_indisponivel' using errcode = 'VRF06';
  end if;

  update app.identity_document d
     set analyzed_at = coalesce(d.analyzed_at, p_now)
   where d.id = p_document;

  v_audit := private.audit_append('admin:' || p_actor::text, 'verificacao', 'verification.document.read',
    'identity_document', p_document, '{}'::jsonb, '{"scope_kind":"identity_document"}'::jsonb, p_reason_code, null);

  insert into app.sensitive_access_log (id, case_id, verification_case_id, actor_id, scope_kind, scope_id,
                                        action, read_at, audit_event_id, reason_code)
  values (gen_random_uuid(), null, p_case, p_actor, 'identity_document', p_document, 'read', p_now,
          v_audit, p_reason_code);

  perform private.verification_event_add(p_case, 'document_read', p_actor, 'verificacao', v_case.status,
    v_case.status, p_reason_code, null, v_audit, p_now);

  return query select v_doc.id, v_doc.stored_type;
end
$$;

-- 10. Fila e detalhe (CA-H039-16; dec. 385 a 387) -----------------------------------------------------
-- Sem CPF/CNPJ, nome, e-mail, nome de arquivo ou hash. services fica vazio: o vinculo com o catalogo
-- de H-036 ainda nao foi confirmado no DEV (ver relatorio da Issue 52).
create or replace function private.verification_queue_list(
  p_actor uuid, p_session_hash text, p_scope text, p_limit integer,
  p_after_sla timestamptz, p_after_id uuid, p_now timestamptz)
returns table (out_id uuid, out_short_id text, out_status text, out_appeal_status text,
               out_sla_target_at timestamptz, out_received_at timestamptz, out_services text[],
               out_overdue boolean, out_assigned_to_me boolean, out_version integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null or p_session_hash is null or p_scope is null or p_limit is null or p_now is null
     or (p_after_sla is null) <> (p_after_id is null) then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  if not private.admin_has_permission(p_actor, 'verification.review')
     or not private.verification_session_ok(p_actor, p_session_hash, p_now) then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  if p_scope not in ('pendentes', 'minhas', 'recursos', 'retidas') or p_limit < 1 or p_limit > 50 then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;

  return query
  select c.id, left(c.id::text, 8), c.status, c.appeal_status, c.sla_target_at,
         (select max(d.received_at) from app.identity_document d
           where d.professional_id = c.professional_id and d.status = 'recebido'
             and d.purge_requested_at is null),
         '{}'::text[],
         p_now > c.sla_target_at,
         coalesce(c.assigned_to = p_actor, false),
         c.version
    from app.verification_case c
   where (case p_scope
            when 'pendentes' then c.status = 'pendente'
            when 'minhas' then c.assigned_to = p_actor and c.status in ('em_revisao', 'retida_duplicidade')
            when 'recursos' then c.status = 'em_revisao' and c.assigned_to is null and c.appeal_status = 'pendente'
            when 'retidas' then c.status = 'retida_duplicidade'
          end)
     and (p_after_sla is null or (c.sla_target_at, c.id) > (p_after_sla, p_after_id))
   order by c.sla_target_at, c.id
   limit p_limit;
end
$$;

create or replace function private.verification_case_detail(
  p_actor uuid, p_session_hash text, p_case uuid, p_now timestamptz)
returns table (out_id uuid, out_short_id text, out_status text, out_appeal_status text,
               out_sla_target_at timestamptz, out_received_at timestamptz, out_services text[],
               out_overdue boolean, out_assigned_to_me boolean, out_version integer,
               out_reason_code text, out_explanation text, out_decided_at timestamptz,
               out_document_available boolean, out_document_id uuid, out_document_received_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case app.verification_case%rowtype;
  v_doc record;
begin
  if p_actor is null or p_session_hash is null or p_case is null or p_now is null then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  if not private.admin_has_permission(p_actor, 'verification.review')
     or not private.verification_session_ok(p_actor, p_session_hash, p_now) then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  select * into v_case from app.verification_case c where c.id = p_case;
  if not found or (v_case.assigned_to is not null and v_case.assigned_to <> p_actor) then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;

  select d.id, d.received_at into v_doc from app.identity_document d
   where d.professional_id = v_case.professional_id and d.status = 'recebido'
     and d.purge_requested_at is null
   order by d.received_at desc limit 1;

  return query select v_case.id, left(v_case.id::text, 8), v_case.status, v_case.appeal_status,
         v_case.sla_target_at, v_doc.received_at, '{}'::text[], p_now > v_case.sla_target_at,
         coalesce(v_case.assigned_to = p_actor, false), v_case.version,
         v_case.reason_code, v_case.explanation_to_professional, v_case.decided_at,
         v_doc.id is not null, v_doc.id, v_doc.received_at;
end
$$;

-- 11. Privilegios: funcoes sem execucao para papeis de API; so app_system nas de operacao --------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private'
       and (p.proname like 'verification\_%' or p.proname = 'idoc_review_target')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role, app_api', r.sig);
  end loop;
end
$$;

revoke all on function private.professional_profile_guard_update()
  from public, anon, authenticated, service_role, app_api;

grant execute on function private.verification_case_mirrors(uuid, text, timestamptz) to app_system;
grant execute on function private.verification_case_assign(uuid, text, uuid, integer, timestamptz) to app_system;
grant execute on function private.verification_case_reassign(uuid, text, uuid, uuid, integer, timestamptz) to app_system;
grant execute on function private.verification_case_decide(uuid, text, uuid, text, text, text, integer, timestamptz) to app_system;
grant execute on function private.verification_case_appeal(uuid, timestamptz) to app_system;
grant execute on function private.verification_queue_list(uuid, text, text, integer, timestamptz, uuid, timestamptz) to app_system;
grant execute on function private.verification_case_detail(uuid, text, uuid, timestamptz) to app_system;
grant execute on function private.idoc_review_target(uuid, text, uuid, uuid, text, timestamptz) to app_system;

-- Tabelas: RLS forcada, sem politicas, sem grant a nenhum papel de API.
alter table app.verification_case enable row level security;
alter table app.verification_case force row level security;
alter table app.verification_case_event enable row level security;
alter table app.verification_case_event force row level security;

revoke all on app.verification_case, app.verification_case_event
  from public, anon, authenticated, service_role, app_api;

-- 12. Permissao de reatribuir (dec. 398): so Superadmin ------------------------------------------------
insert into app.admin_permission (code, label) values
  ('verification.reassign', 'Reatribuir verificacao')
on conflict (code) do nothing;

insert into app.admin_role_permission (role_code, permission_code) values
  ('superadmin', 'verification.reassign')
on conflict do nothing;

-- 13. Acoes de auditoria (chaves sem dado pessoal; motivo em p_reason_code) -----------------------------
insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('verification.case.created', 'verification_case', false, array['status'],
   'Caso de verificacao criado no primeiro envio de documento (Issue 52, H-039)'),
  ('verification.case.assigned', 'verification_case', false, array['status', 'assigned'],
   'Caso de verificacao atribuido a uma pessoa da Verificacao (Issue 52, H-039)'),
  ('verification.case.reassigned', 'verification_case', false, array['assigned'],
   'Caso de verificacao reatribuido pelo Superadmin (Issue 52, H-039)'),
  ('verification.document.read', 'identity_document', true, array['scope_kind'],
   'Documento de identidade lido para analise (Issue 52, H-039, dec. 389)'),
  ('verification.case.decided', 'verification_case', true, array['status', 'appeal_status'],
   'Decisao motivada do caso de verificacao (Issue 52, H-039)'),
  ('verification.case.appeal_received', 'verification_case', false, array['status', 'appeal_status'],
   'Recurso recebido do profissional (Issue 52, H-039)')
on conflict (action, object_type) do nothing;

-- 14. Carga inicial (dec. 401): um caso por profissional com documento recebido. Idempotente. ---------
do $$
declare
  r record;
begin
  for r in
    select d.professional_id, min(d.received_at) as received_at
      from app.identity_document d
     where d.status = 'recebido' and d.purge_requested_at is null and d.received_at is not null
     group by d.professional_id
  loop
    perform private.verification_case_create(r.professional_id, r.received_at);
  end loop;
end
$$;
