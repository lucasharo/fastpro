-- H-103 (#112) | Listagem da equipe administrativa (private.admin_staff_list), so leitura. Docs:
-- docs/factory/70-DESENHO-H103.md §2 (GET /v1/admin/staff) e §4 (T-H103-09). Idempotente.
-- Desfazer: supabase/rollbacks/20261111410000_admin_staff_list.down.sql (manual, so em dev).
-- Depende de 20261111190000 (app.admin_staff), 20261111220000 (app.admin_user_role, private.admin_has_permission)
-- e 20261111290000 (private.access_case_session_totp: sessao viva do proprio ator).
-- Nenhuma tabela e alterada. Sem e-mail, sem hash do segredo, sem segredo TOTP, sem cifra de convite.

-- 1. Lista: contas da equipe com estado, se o MFA foi cadastrado, papeis ativos e data de criacao.
--    Exige sessao viva do proprio ator (sessao invalida = 42501) e admin.role.manage checado no banco
--    (sem a permissao = 42501). Ate 100 linhas, mais recentes primeiro.
create or replace function private.admin_staff_list(p_actor uuid, p_session_hash text, p_now timestamptz)
returns table (
  out_user_id    uuid,
  out_status     text,
  out_mfa_ativo  boolean,
  out_papeis     text[],
  out_created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_actor is null or p_session_hash is null or p_now is null then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  if private.access_case_session_totp(p_actor, p_session_hash, p_now) is null then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  if not private.admin_has_permission(p_actor, 'admin.role.manage') then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;

  return query
    select s.user_id,
           s.status::text,
           s.mfa_enrolled_at is not null,
           array(
             select r.role_code::text
               from app.admin_user_role r
              where r.user_id = s.user_id
                and r.revoked_at is null
              order by r.role_code
           ),
           s.created_at
      from app.admin_staff s
     order by s.created_at desc, s.user_id
     limit 100;
end
$$;

revoke all on function
  private.admin_staff_list(uuid, text, timestamptz)
  from public, anon, authenticated, service_role, app_api;

grant execute on function
  private.admin_staff_list(uuid, text, timestamptz)
  to app_system;
