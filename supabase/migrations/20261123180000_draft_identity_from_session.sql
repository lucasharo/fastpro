-- Pedido de quem ja esta logado (decisao do dono, 2026-11-23): o cliente com sessao nao preenche nome e e-mail nem
-- recebe codigo. O e-mail vem da propria sessao (app.app_user) e ja conta como confirmado; o primeiro nome vem do
-- ultimo pedido do cliente (ou e pedido na tela, so ele). A posse do rascunho continua pelo cookie do navegador.

-- 1. Dados da sessao para o rascunho: e-mail da conta e o primeiro nome do ultimo pedido (se houver).
create or replace function private.session_customer_identity(p_session_hash text, p_now timestamptz)
returns table (out_user_id uuid, out_email text, out_first_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email,
         (select r.first_name from app.service_request r where r.customer_user_id = u.id
           order by r.published_at desc limit 1)
    from app.app_session s
    join app.app_user u on u.id = s.user_id and u.status = 'ativo'
   where s.secret_hash = p_session_hash
     and s.stage = 'ativa'
     and s.revoked_at is null
     and s.expires_at > p_now
     and s.absolute_expires_at > p_now
   limit 1
$$;

-- 2. Grava nome e e-mail no rascunho do navegador e marca o e-mail como confirmado. Reconfere a sessao e que o
-- e-mail recebido e o da conta (nunca confia so no chamador).
create or replace function private.draft_identity_from_session(
  p_draft_hash text,
  p_session_hash text,
  p_now timestamptz,
  p_first_name text,
  p_email text,
  p_email_hmac text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_draft uuid;
begin
  if p_draft_hash is null or p_session_hash is null or p_now is null or p_email_hmac is null
     or p_first_name is null or char_length(btrim(p_first_name)) not between 2 and 60 then
    return 'entrada_invalida';
  end if;

  select u.email into v_email
    from app.app_session s
    join app.app_user u on u.id = s.user_id and u.status = 'ativo'
   where s.secret_hash = p_session_hash
     and s.stage = 'ativa'
     and s.revoked_at is null
     and s.expires_at > p_now
     and s.absolute_expires_at > p_now;
  if not found then
    return 'sessao_invalida';
  end if;
  if lower(btrim(v_email)) is distinct from lower(btrim(p_email)) then
    return 'email_divergente';
  end if;

  select r.id into v_draft
    from app.request_draft r
   where r.browser_nonce_hash = p_draft_hash
     and r.status in ('aberto', 'aguardando_email')
     and r.expires_at > p_now
   for update;
  if not found then
    return 'rascunho_ausente';
  end if;

  update app.request_draft r
     set first_name = btrim(p_first_name),
         email = v_email,
         email_hmac = p_email_hmac,
         email_verified_at = p_now,
         status = 'aberto',
         updated_at = p_now
   where r.id = v_draft;
  return 'ok';
end
$$;

revoke all on function
  private.session_customer_identity(text, timestamptz),
  private.draft_identity_from_session(text, text, timestamptz, text, text, text)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
grant execute on function private.session_customer_identity(text, timestamptz) to app_system;
grant execute on function private.draft_identity_from_session(text, text, timestamptz, text, text, text) to app_system;
