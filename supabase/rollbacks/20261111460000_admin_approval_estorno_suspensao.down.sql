-- Desfaz 20261111460000_admin_approval_estorno_suspensao.sql (H-105, Issue 114). EXECUCAO MANUAL e consciente: so em
-- banco de desenvolvimento. Aborta se existir pedido dos tipos estorno ou suspensao_permanente: nao apaga dados
-- (o operador decide). Sem esses pedidos, restaura as guardas, as constraints e os tipos anteriores.
begin;

-- 0. Recusa se houver linha dos tipos novos (nada e alterado antes desta checagem).
do $$
begin
  if exists (select 1 from app.approval_request where action_type in ('estorno', 'suspensao_permanente')) then
    raise exception 'rollback_recusado: ha pedidos estorno ou suspensao_permanente (H-105); decida antes de desfazer'
      using errcode = '23514';
  end if;
end
$$;

-- 1. Funcoes novas e guardas. Guardas voltam as versoes anteriores (300000 e 420000).
drop function if exists private.approval_dual_list(uuid, text, timestamptz);
drop function if exists private.approval_dual_denied_record(uuid, text, uuid, text, timestamptz);
drop function if exists private.approval_dual_cancel(uuid, text, uuid, timestamptz);
drop function if exists private.approval_dual_vote(uuid, text, text, uuid, timestamptz);
drop function if exists private.approval_dual_open(uuid, text, text, uuid, integer, text, uuid, timestamptz);

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
    if not (old.document_hmac is null
            and old.verification_status = 'pendente'
            and new.verification_status in ('pendente', 'retida_duplicidade')
            and new.document_hmac is not null) then
      raise exception 'professional_status_protegido' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

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

  if v_req.action_type = 'acesso_conversa' then
    if not private.admin_has_permission(new.approver_id, 'case.authorize_sensitive') then
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

drop trigger if exists approval_request_guard_update on app.approval_request;
drop function if exists private.approval_request_guard_update();

-- 2. Permissoes e papeis novos (antes de remover as permissoes, o mapa de papel sai).
delete from app.admin_role_permission
 where permission_code in ('account.suspend.request', 'account.suspend.approve');
delete from app.admin_permission
 where code in ('account.suspend.request', 'account.suspend.approve');

-- 3. Auditoria: so catalogo (nao ha evento destas acoes sem pedido do tipo novo, conferido acima).
delete from audit.action_catalog
 where action in ('approval.requested', 'approval.voted', 'approval.cancelled',
                  'approval.expired', 'approval.vote_denied');

-- 4. Indice, constraints e colunas. Lista de tipos e limite de votos voltam ao que era em 300000.
drop index if exists app.approval_request_alvo_aberto_key;
alter table app.approval_request drop constraint if exists approval_request_campos_por_tipo;
alter table app.approval_request drop constraint if exists approval_request_votos_por_tipo;
alter table app.approval_request drop constraint if exists approval_request_reason_tamanho;
alter table app.approval_request drop constraint if exists approval_request_amount_positivo;

alter table app.approval_request drop constraint if exists approval_request_action_type_check;
alter table app.approval_request add constraint approval_request_action_type_check
  check (action_type in ('papel_superadmin', 'mfa_reenroll', 'acesso_conversa'));

alter table app.approval_request drop constraint if exists approval_request_required_approvals_check;
alter table app.approval_request add constraint approval_request_required_approvals_check
  check (required_approvals = 1);

alter table app.approval_request drop column if exists subject_ref;
alter table app.approval_request drop column if exists amount_cents;
alter table app.approval_request drop column if exists reason;

-- 5. Registro de migracao.
delete from ops.schema_migration where version = '20261111460000';

commit;
