-- Desfaz 20261111470000_retention_create_policy.sql (H-109, #118). EXECUCAO MANUAL e consciente: so em banco
-- de desenvolvimento. Apaga as tabelas de retencao (dados de politica e de hold incluidos), as funcoes,
-- as colunas de retencao, as acoes de auditoria do catalogo e o papel governanca_dados.
-- Nao toca audit.audit_event. Falha de proposito se houver pedidos 'retencao_politica' ainda existentes:
-- remova-os manualmente (em dev) antes de restaurar a restricao anterior de approval_request.
begin;

-- 1. Funcoes do expurgo, do cadastro e do hold -------------------------------------------------------------
drop function if exists private.legal_hold_release_apply(uuid, uuid, uuid, timestamptz);
drop function if exists private.legal_hold_release_propose(uuid, uuid, timestamptz);
drop function if exists private.legal_hold_place(uuid, text, uuid, text, timestamptz);
drop function if exists private.retention_finalize_batch(uuid, uuid[], timestamptz, integer);
drop function if exists private.retention_finalize_rc02(uuid, uuid, timestamptz);
drop function if exists private.retention_finalize_rc01(uuid, uuid, timestamptz);
drop function if exists private.retention_queue_result(uuid, boolean, timestamptz);
drop function if exists private.retention_queue_pending(uuid, uuid[], integer);
drop function if exists private.retention_queue_add(uuid, uuid, text, text, timestamptz);
drop function if exists private.retention_mark_batch(uuid, integer, timestamptz);
drop function if exists private.retention_dry_run(uuid, timestamptz);
drop function if exists private.retention_policy_apply(uuid, uuid, timestamptz);
drop function if exists private.retention_policy_propose(uuid, uuid, text, interval, text, text, timestamptz, boolean, boolean, timestamptz);
drop function if exists private.retention_policy_denied_record(uuid, text, text, timestamptz);
drop function if exists private.retention_due(text, timestamptz);
drop function if exists private.retention_acao_permitida(text, text);

-- 2. Restaura a guarda de voto e a lista de tipos da H-105 (20261111460000), sem retencao_politica.
alter table app.approval_request drop constraint if exists approval_request_detalhe_por_acao;
alter table app.approval_request add constraint approval_request_detalhe_por_acao
  check ((action_type = 'papel_superadmin') = (detail_code is not null));
alter table app.approval_request drop constraint if exists approval_request_action_type_check;
alter table app.approval_request add constraint approval_request_action_type_check
  check (action_type in ('papel_superadmin', 'mfa_reenroll', 'acesso_conversa', 'estorno', 'suspensao_permanente'));

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

-- 2b. Restaura a guarda do perfil profissional da H-105 (20261111460000), sem a excecao do expurgo.
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

-- 3. Tabelas, colunas e restricoes -------------------------------------------------------------------------
drop table if exists app.retention_object_queue;
drop table if exists app.legal_hold;
drop table if exists app.retention_policy_change;
drop table if exists app.retention_policy;

alter table app.app_user drop constraint if exists app_user_anonimizado_consistente;
alter table app.app_user drop constraint if exists app_user_retention_state;
alter table app.app_user drop column if exists anonymized_at;
alter table app.app_user drop column if exists retention_state;
alter table app.professional_profile drop constraint if exists professional_profile_retention_state;
alter table app.professional_profile drop column if exists retention_state;


-- 4. Papel, permissoes e catalogo de auditoria --------------------------------------------------------------
delete from app.admin_role_permission
 where role_code = 'governanca_dados' and permission_code in ('retention.policy.manage', 'retention.hold.manage');
delete from app.admin_permission where code in ('retention.policy.manage', 'retention.hold.manage');
delete from app.admin_role where code = 'governanca_dados';

delete from audit.action_catalog
 where (action, object_type) in (
   ('retention.policy.proposed', 'retention_policy'),
   ('retention.policy.changed', 'retention_policy'),
   ('retention.policy.denied', 'retention_policy'),
   ('retention.hold.placed', 'legal_hold'),
   ('retention.hold.release_requested', 'legal_hold'),
   ('retention.hold.released', 'legal_hold'),
   ('retention.batch.executed', 'retention_policy'));

commit;
