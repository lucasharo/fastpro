-- Novo documento depois de recusa reabre o caso como 'pendente' (decisao do dono, 2026-11-27; responde a
-- pergunta 393 do 124-DESENHO-H039). Conta suspensa nao reabre. O historico da recusa fica nos eventos e na
-- auditoria; motivo e decisao anteriores permanecem no caso ate a nova decisao. Nao consome o recurso.

-- 1. Evento novo no historico.
alter table app.verification_case_event
  drop constraint verification_case_event_action_check,
  add constraint verification_case_event_action_check
    check (action in ('created', 'assigned', 'reassigned', 'document_read', 'decided', 'appeal_received',
                      'resubmitted'));

alter table app.verification_case_event
  drop constraint verification_case_event_ator_nulo,
  add constraint verification_case_event_ator_nulo
    check (actor_id is not null or action in ('created', 'appeal_received', 'resubmitted'));

insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('verification.case.resubmitted', 'verification_case', false, array['status'],
   'Caso recusado reaberto por novo documento do profissional')
on conflict (action, object_type) do nothing;

-- 2. Transicao recusada -> pendente.
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
    ('recusada', 'pendente'),
    ('retida_duplicidade', 'em_revisao'))
$$;

-- 3. O perfil pode voltar de recusada para pendente, sempre espelhando o caso.
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
      or (new.verification_status = 'pendente'
          and old.verification_status = 'recusada'
          and private.verification_case_mirrors(new.user_id, new.verification_status, new.updated_at))
    ) then
      raise exception 'professional_status_protegido' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- 4. Reabertura.
create or replace function private.verification_case_reopen(p_professional uuid, p_at timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case app.verification_case%rowtype;
  v_audit uuid;
begin
  select * into v_case from app.verification_case c where c.professional_id = p_professional for update;
  if not found or v_case.status <> 'recusada' or p_at < v_case.decided_at then
    return false;
  end if;
  if exists (select 1 from app.professional_profile p
              where p.user_id = p_professional and p.verification_status = 'suspensa') then
    return false;
  end if;

  update app.verification_case c
     set status = 'pendente', assigned_to = null, assigned_at = null,
         sla_target_at = private.verification_sla_target(p_at), updated_at = p_at
   where c.id = v_case.id;
  if not private.verification_profile_mirror_blocked(p_professional) then
    update app.professional_profile p
       set verification_status = 'pendente', updated_at = p_at
     where p.user_id = p_professional and p.verification_status = 'recusada';
  end if;

  v_audit := private.audit_append('professional:' || p_professional::text, 'profissional',
    'verification.case.resubmitted', 'verification_case', v_case.id,
    '{"status":"recusada"}'::jsonb, '{"status":"pendente"}'::jsonb, null, null);
  perform private.verification_event_add(v_case.id, 'resubmitted', null, 'profissional', 'recusada',
    'pendente', null, null, v_audit, p_at);
  return true;
end
$$;

revoke all on function private.verification_case_reopen(uuid, timestamptz)
  from public, anon, authenticated, service_role, app_api, app_system;

-- 5. Documento recebido: cria o caso; se ja existir e estiver recusado, reabre.
create or replace function private.verification_case_on_idoc_received()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := coalesce(new.received_at, clock_timestamp());
begin
  if private.verification_case_create(new.professional_id, v_at) is null then
    perform private.verification_case_reopen(new.professional_id, v_at);
  end if;
  return new;
end
$$;

-- 6. Casos que ja receberam documento depois da recusa.
do $$
declare
  r record;
begin
  for r in
    select c.professional_id
      from app.verification_case c
     where c.status = 'recusada'
       and exists (select 1 from app.identity_document d
                    where d.professional_id = c.professional_id and d.status = 'recebido'
                      and d.purge_requested_at is null and d.received_at > c.decided_at)
  loop
    perform private.verification_case_reopen(r.professional_id, clock_timestamp());
  end loop;
end
$$;
