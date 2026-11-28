-- O admin nao exige login recente (decisao do dono, 2026-11-27): antes, abrir documento, abrir ou aprovar acesso a
-- conversa e pedir ou votar estorno/suspensao pediam entrada ha menos de 30 minutos. Agora vale a sessao inteira
-- (8 horas, sem mudanca). As funcoes que conferem a janela leem o instante por este helper: com sessao valida ele
-- devolve o proprio p_now; sem sessao continua nulo e a acao e negada.
create or replace function private.access_case_session_totp(p_actor uuid, p_session_hash text, p_now timestamp with time zone)
returns timestamp with time zone
language sql
stable
security definer
set search_path = ''
as $$
  select p_now
    from app.admin_session s
   where s.secret_hash = p_session_hash
     and s.user_id = p_actor
     and s.revoked_at is null
     and s.expires_at > p_now
$$;
