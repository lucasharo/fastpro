-- Sessao que se renova (decisao do dono, 2026-11-23): o cliente entra so com o codigo (OTP) e fica logado enquanto
-- usar o site. Cada consulta de "quem sou" (GET /v1/auth/me, feita a cada troca de tela) empurra o fim da sessao
-- ativa para agora + 7 dias; o cookie e reenviado com o novo Max-Age. Sessao vencida, revogada ou de outra etapa
-- nao renova (continua exigindo novo codigo). Para poupar escrita, so renova quando faltar menos de 6 dias.
-- Regra da tabela: na sessao ativa expires_at = absolute_expires_at (app_session_ativa_consistente).

create or replace function private.app_session_refresh(p_secret_hash text, p_now timestamptz)
returns table (out_renovada boolean, out_absolute_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  v_id uuid;
  v_fim timestamptz;
begin
  select s.id, s.absolute_expires_at into v_id, v_fim
    from app.app_session s
   where s.secret_hash = p_secret_hash
     and s.stage = 'ativa'
     and s.revoked_at is null
     and s.expires_at > p_now
     and s.absolute_expires_at > p_now
     and exists (select 1 from app.app_user u where u.id = s.user_id and u.status = 'ativo')
   for update;
  if not found then
    return query select false, null::timestamptz;
    return;
  end if;
  if v_fim - p_now >= interval '6 days' then
    return query select false, v_fim;
    return;
  end if;
  update app.app_session
     set expires_at = p_now + interval '7 days', absolute_expires_at = p_now + interval '7 days'
   where id = v_id;
  return query select true, p_now + interval '7 days';
end
$$;

revoke all on function private.app_session_refresh(text, timestamptz)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
grant execute on function private.app_session_refresh(text, timestamptz) to app_system;
