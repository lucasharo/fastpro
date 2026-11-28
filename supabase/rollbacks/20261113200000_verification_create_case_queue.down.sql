-- Desfaz 20261113200000_verification_create_case_queue.sql (Issue 52, H-039). EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento, ou depois de exportar os casos e o historico (ver a condicao abaixo).
-- Remove o gatilho de identity_document, as funcoes, o caso e o historico, a permissao verification.reassign
-- do mapa e o registro da migracao. Reverte app.sensitive_access_log para o formato de H-073.
-- Nao restaura verification_status de perfis (o perfil pode ter sido decidido) e nao apaga eventos de
-- auditoria (append-only); as acoes verification.* ficam no catalogo porque eventos gravados dependem delas.
-- Condicao: so executa se nao houver leitura de documento nem caso com decisao. Antes disso, exporte e
-- decida conscientemente; este arquivo recusa a execucao sozinho.
begin;

do $$
begin
  if exists (select 1 from app.verification_case where status <> 'pendente' or appeal_status <> 'nenhum') then
    raise exception 'rollback_recusado: ha casos com decisao ou recurso; exporte antes' using errcode = '42501';
  end if;
  if exists (select 1 from app.sensitive_access_log where scope_kind = 'identity_document') then
    raise exception 'rollback_recusado: ha leituras de documento registradas; exporte antes' using errcode = '42501';
  end if;
end
$$;

drop trigger if exists identity_document_verification_case on app.identity_document;

drop function if exists private.idoc_review_target(uuid, text, uuid, uuid, text, timestamptz);
drop function if exists private.verification_case_detail(uuid, text, uuid, timestamptz);
drop function if exists private.verification_queue_list(uuid, text, text, integer, timestamptz, uuid, timestamptz);
drop function if exists private.verification_case_appeal(uuid, timestamptz);
drop function if exists private.verification_case_decide(uuid, text, uuid, text, text, text, integer, timestamptz);
drop function if exists private.verification_case_reassign(uuid, text, uuid, uuid, integer, timestamptz);
drop function if exists private.verification_case_assign(uuid, text, uuid, integer, timestamptz);
drop function if exists private.verification_case_on_idoc_received();
drop function if exists private.verification_case_create(uuid, timestamptz);
drop function if exists private.verification_reg_gate(uuid);
drop function if exists private.verification_event_add(uuid, text, uuid, text, text, text, text, text, uuid, timestamptz);
drop function if exists private.verification_case_mirrors(uuid, text, timestamptz);
drop function if exists private.verification_session_ok(uuid, text, timestamptz);
drop function if exists private.verification_case_guard();
drop function if exists private.verification_case_refuse_delete();
drop function if exists private.verification_event_refuse_mutation();
drop function if exists private.verification_transition_allowed(text, text);
drop function if exists private.verification_text_has_pii(text);
drop function if exists private.verification_sla_target(timestamptz);

-- Guarda do perfil volta ao corpo de 20261111460000 (suspensao), sem o espelho do caso.
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
    ) then
      raise exception 'professional_status_protegido' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop table if exists app.verification_case_event;
drop table if exists app.verification_case;

-- Reverte sensitive_access_log para o formato de H-073 (so conversa).
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

drop index if exists app.sensitive_access_log_verificacao_idx;
alter table app.sensitive_access_log drop column if exists verification_case_id;
alter table app.sensitive_access_log drop column if exists reason_code;
alter table app.sensitive_access_log alter column case_id set not null;
alter table app.sensitive_access_log add constraint sensitive_access_log_scope_kind_check
  check (scope_kind = 'conversation');

delete from app.admin_role_permission where role_code = 'superadmin' and permission_code = 'verification.reassign';
delete from app.admin_permission where code = 'verification.reassign';

delete from ops.schema_migration where version = '20261113200000';

commit;
