-- H-073 (#83) | Aprovacao do tipo 'acesso_conversa' e guarda de voto por tipo (docs/factory/60-DESENHO-H073.md
-- §1 e §5). Idempotente. Desfazer: supabase/rollbacks/20261111300000_admin_approval_acesso_conversa.down.sql.
-- Depende de 20261111290000 (access_case) e 20261111220000 (approval_request e approval_vote).
-- Regra por tipo: papel_superadmin e mfa_reenroll continuam exigindo Superadmin ativo; acesso_conversa
-- exige a permissao case.authorize_sensitive (so Superadmin tem, 60 §7 D-7-1). Em todos: aprovador
-- diferente do solicitante e do alvo, um voto por pessoa, pedido pendente. H-105 acrescentara os seus tipos.

-- 1. Lista de tipos vigente nesta migracao (a anterior era papel_superadmin e mfa_reenroll) ----------
alter table app.approval_request drop constraint if exists approval_request_action_type_check;
alter table app.approval_request add constraint approval_request_action_type_check
  check (action_type in ('papel_superadmin', 'mfa_reenroll', 'acesso_conversa'));

-- 2. Guarda de voto por tipo ---------------------------------------------------------------------------
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
    -- Quem aprova um caso de acesso precisa da permissao propria, ativa agora (60 §7 D-7-1).
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

-- 3. Privilegios (a funcao continua sem acesso publico; so o dono do gatilho a executa) -----------------
revoke all on function private.approval_vote_guard() from public, anon, authenticated, service_role, app_api;
