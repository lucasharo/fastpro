-- H-073 (#83) | Correcao da revisao: escritas no caso e no registro so por funcao security definer
-- (60 §3; revisao do Orquestrador). Idempotente. Nao edita migracoes ja aplicadas.
-- Desfazer: supabase/rollbacks/20261111320000_admin_access_case_hardening.down.sql (manual, so em dev).
-- Depende de 20261111290000 (tabelas e funcoes do caso).
-- 1. app_system deixa de fazer INSERT e UPDATE nas tabelas do caso; continua com SELECT (leitura).
--    As funcoes private.access_case_* e private.access_case_gate sao donas das tabelas e escrevem por elas.
-- 2. Gate: trava a linha do caso (FOR SHARE) durante a leitura, e qualquer falha da auditoria ou do
--    registro vira ADM20 (sem caso, sem linha de log e sem leitura; 60 §3 "qualquer falha").

revoke insert, update, delete, truncate on app.access_case from app_system;
revoke insert, update, delete, truncate on app.sensitive_access_log from app_system;
grant select on app.access_case, app.sensitive_access_log to app_system;

create or replace function private.access_case_gate(
  p_actor uuid, p_session_hash text, p_case uuid, p_conversation uuid, p_now timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case app.access_case%rowtype;
  v_totp timestamptz;
  v_audit uuid;
  v_log uuid := gen_random_uuid();
begin
  if p_actor is null or p_session_hash is null or p_case is null or p_conversation is null or p_now is null then
    raise exception 'acesso_negado' using errcode = 'ADM20';
  end if;
  v_totp := private.access_case_session_totp(p_actor, p_session_hash, p_now);
  if v_totp is null or not private.admin_has_permission(p_actor, 'case.open_sensitive') then
    raise exception 'acesso_negado' using errcode = 'ADM20';
  end if;

  select * into v_case from app.access_case c
   where c.id = p_case
     and c.opened_by = p_actor
     and c.scope_id = p_conversation
     and c.scope_kind = 'conversation'
     and c.closed_at is null
     and c.approved_at is not null
     and c.approved_at <= p_now
     and p_now < c.expires_at
   for share;
  if not found then
    raise exception 'acesso_negado' using errcode = 'ADM20';
  end if;

  begin
    v_audit := private.audit_append('admin:' || p_actor::text, 'admin', 'access_case.conversation_read',
      'conversation', p_conversation, '{}'::jsonb,
      jsonb_build_object('case_id', p_case, 'scope_kind', 'conversation'), null, null);
    insert into app.sensitive_access_log (id, case_id, actor_id, scope_kind, scope_id, action, read_at,
                                          audit_event_id)
    values (v_log, p_case, p_actor, 'conversation', p_conversation, 'read', p_now, v_audit);
  exception when others then
    raise exception 'acesso_negado' using errcode = 'ADM20';
  end;
  return v_log;
end
$$;
