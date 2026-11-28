-- Desfaz 20261112230000_ops_create_operational_purge.sql (H-110, Issue #119). EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento. Ordem: agendamento, funcoes novas, concessoes acrescentadas a funcoes de
-- H-026, linha de catalogo de auditoria (so se nao houver evento), tabela de rollup (so se vazia).
-- Chaves em ops.app_config nao sao removidas (a migracao nao as criou). Idempotente (if exists / to_regclass).
begin;

-- 1. Agendamento (se existir).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'ops-purge-daily') then
      perform cron.unschedule('ops-purge-daily');
    end if;
  end if;
end;
$$;

-- 2. Funcoes novas.
drop function if exists private.ops_purge_audit(uuid, jsonb);
drop function if exists private.ops_purge_enqueue(timestamptz, integer);
drop function if exists private.ops_purge_media_access(timestamptz, integer);
drop function if exists private.ops_purge_idempotency(timestamptz, integer);
drop function if exists private.ops_purge_email_outbox(timestamptz, integer);
drop function if exists private.ops_purge_outbox_event(timestamptz, integer);
drop function if exists private.ops_purge_provider_event(timestamptz, integer);
drop function if exists private.ops_purge_media_orfaos(timestamptz, integer);
drop function if exists private.ops_purge_media_marcados(integer);
drop function if exists private.ops_purge_media_mark(timestamptz, integer);
drop function if exists private.ops_purge_draft(timestamptz, integer);
drop function if exists private.ops_purge_session(timestamptz, integer);
drop function if exists private.ops_purge_auth_challenge(timestamptz, integer);
drop function if exists private.ops_purge_check_limit(integer);
drop function if exists private.ops_purge_cfg(text);

-- 3. Concessoes acrescentadas a funcoes de H-026 (as funcoes continuam; so sai o execute de app_system).
revoke execute on function private.media_original_cleanup_list(integer) from app_system;
revoke execute on function private.media_original_removed(uuid, timestamptz) from app_system;
revoke execute on function private.media_purge_done(uuid[]) from app_system;

-- 4. Catalogo de auditoria: so se nenhum evento usou a acao (cadeia de auditoria e append-only).
do $$
begin
  if not exists (select 1 from audit.audit_event e where e.action = 'ops.purge.executed') then
    delete from audit.action_catalog where action = 'ops.purge.executed' and object_type = 'ops_job';
  end if;
end;
$$;

-- 5. Rollup: so se vazio.
do $$
declare
  v_linhas bigint := 0;
begin
  if to_regclass('ops.media_access_daily') is not null then
    execute 'select count(*) from ops.media_access_daily' into v_linhas;
    if v_linhas = 0 then
      drop table ops.media_access_daily;
    else
      raise notice 'rollback_mantem_rollup_com_dados';
    end if;
  end if;
end;
$$;

commit;
