-- H-073 (#83) | Listagem dos casos de acesso excepcional (private.access_case_list) e validade da sessao
-- admin para a guarda (private.admin_session_expiry). Docs: docs/factory/60-DESENHO-H073.md §1 e §3. Idempotente.
-- Desfazer: supabase/rollbacks/20261111400000_admin_access_case_list.down.sql (manual, so em dev).
-- Depende de 20261111290000 (app.access_case, access_case_session_totp), 20261111280000 (admin_guard com
-- totp_at) e 20261111300000 (approval_request do tipo acesso_conversa).
-- Somente leitura: nenhuma tabela e alterada e nenhuma escrita de caso acontece aqui.

-- 1. Validade da sessao admin valida (mesmos filtros de private.admin_guard). Sem linha = nulo. -----------
create or replace function private.admin_session_expiry(p_secret_hash text, p_now timestamptz)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select s.expires_at
    from app.admin_session s
   where s.secret_hash = p_secret_hash
     and s.revoked_at is null
     and s.aal2_at is not null
     and s.expires_at > p_now
$$;

-- 2. Lista: os casos que a propria pessoa abriu e, com case.authorize_sensitive (checado no banco), os
--    pendentes de outras pessoas. Estado derivado: pendente | ativo | vencido | fechado (60 §1).
--    Sessao invalida = 42501. Campos: id, estado, conversa, justificativa, expiracao. Ate 100 linhas.
create or replace function private.access_case_list(p_actor uuid, p_session_hash text, p_now timestamptz)
returns table (out_id uuid, out_estado text, out_scope_id uuid, out_justificativa text, out_expires_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pode_autorizar boolean;
begin
  if p_actor is null or p_session_hash is null or p_now is null then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  if private.access_case_session_totp(p_actor, p_session_hash, p_now) is null then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  v_pode_autorizar := private.admin_has_permission(p_actor, 'case.authorize_sensitive');

  return query
    select c.id,
           case
             when c.closed_at is not null then 'fechado'
             when c.approved_at is null and r.status = 'pendente' and r.expires_at > p_now then 'pendente'
             when c.approved_at is null then 'vencido'
             when p_now < c.expires_at then 'ativo'
             else 'vencido'
           end::text,
           c.scope_id,
           c.justification,
           c.expires_at
      from app.access_case c
      left join app.approval_request r on r.id = c.approval_request_id
     where c.opened_by = p_actor
        or (v_pode_autorizar
            and c.opened_by <> p_actor
            and c.approved_at is null
            and c.closed_at is null
            and r.status = 'pendente'
            and r.expires_at > p_now)
     order by c.created_at desc
     limit 100;
end
$$;

revoke all on function
  private.admin_session_expiry(text, timestamptz),
  private.access_case_list(uuid, text, timestamptz)
  from public, anon, authenticated, service_role, app_api;

grant execute on function
  private.admin_session_expiry(text, timestamptz),
  private.access_case_list(uuid, text, timestamptz)
  to app_system;
