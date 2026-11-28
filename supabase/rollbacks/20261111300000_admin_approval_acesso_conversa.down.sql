-- Desfaz 20261111300000_admin_approval_acesso_conversa.sql (H-073, #83). EXECUCAO MANUAL e consciente: so
-- em banco de desenvolvimento. Apaga os casos e pedidos do tipo acesso_conversa (com seus votos, e com
-- o registro de leituras que dependa deles) e restaura a lista de tipos e a guarda de voto anteriores
-- (so Superadmin). Tira a migracao do registro.
begin;

-- As tabelas de caso recusam DELETE por gatilho (somente acrescimo). Na limpeza de desenvolvimento os
-- gatilhos saem so nesta transacao e voltam antes do commit.
alter table app.sensitive_access_log disable trigger sensitive_access_log_no_mutation;
alter table app.access_case disable trigger access_case_no_delete;

delete from app.sensitive_access_log
 where case_id in (select c.id from app.access_case c
                    join app.approval_request r on r.id = c.approval_request_id
                   where r.action_type = 'acesso_conversa');
delete from app.access_case
 where approval_request_id in (select id from app.approval_request where action_type = 'acesso_conversa');
delete from app.approval_vote
 where approval_request_id in (select id from app.approval_request where action_type = 'acesso_conversa');
delete from app.approval_request where action_type = 'acesso_conversa';

alter table app.access_case enable trigger access_case_no_delete;
alter table app.sensitive_access_log enable trigger sensitive_access_log_no_mutation;

alter table app.approval_request drop constraint if exists approval_request_action_type_check;
alter table app.approval_request add constraint approval_request_action_type_check
  check (action_type in ('papel_superadmin', 'mfa_reenroll'));

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

delete from ops.schema_migration where version = '20261111300000';

commit;
