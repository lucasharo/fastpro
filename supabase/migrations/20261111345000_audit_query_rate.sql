-- H-104 (#113) | Limite de consultas da auditoria por admin, conferido e incrementado de forma atomica.
-- Desenho: docs/factory/63-DESENHO-H104.md §6 (R-2) e D-H104-9 (30 consultas em 5 min, 429 sem entrada).
-- Reaproveita o contador do H-015 (ops.rate_counter, private.rl_check e private.rl_hit) com baldes de 1 s:
-- a janela e exata a menos de 1 s. Idempotente.
-- Desfazer: supabase/rollbacks/20261111345000_audit_query_rate.down.sql (manual, so em dev).
-- Atomicidade: a trava de transacao por admin (pg_advisory_xact_lock) cobre a conferencia e o incremento;
-- duas chamadas concorrentes do mesmo admin nao leem o mesmo total. Cada chamada e uma transacao curta.
-- Postura: funcao SECURITY DEFINER com search_path vazio; EXECUTE somente de app_system.

create or replace function private.audit_query_rate_take(
  p_admin uuid,
  p_now timestamptz,
  p_limit int,
  p_window_s int
) returns boolean
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  v_key text;
  v_ok  boolean;
begin
  if p_admin is null or p_now is null or p_limit is null or p_window_s is null
     or p_limit < 1 or p_window_s < 1 then
    raise exception 'rate_entrada_invalida' using errcode = '22023';
  end if;

  -- Chave do contador: SHA-256 do identificador do admin (64 hex, formato de ops.rate_counter).
  v_key := encode(sha256(convert_to('audit_query|' || p_admin::text, 'UTF8')), 'hex');

  -- Trava por admin: conferencia e incremento numa so sequencia; consultas concorrentes esperam.
  perform pg_advisory_xact_lock(hashtext('audit_query_rate'), hashtext(p_admin::text));

  select r.out_ok into v_ok
    from private.rl_check(v_key, p_window_s, 1, p_limit, p_now) r;

  if v_ok then
    perform private.rl_hit(v_key, 1, p_now);
  end if;
  return v_ok;
end
$$;

revoke all on function private.audit_query_rate_take(uuid, timestamptz, int, int)
  from public, anon, authenticated, service_role, app_api;
grant execute on function private.audit_query_rate_take(uuid, timestamptz, int, int)
  to app_system;
