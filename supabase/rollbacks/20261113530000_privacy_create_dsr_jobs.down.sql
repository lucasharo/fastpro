-- Issue 120 (H-111) | Desfaz 20261113530000_privacy_create_dsr_jobs.sql: remove os gatilhos de enfileiramento e as funcoes-alvo
-- dos jobs. Nao altera dados de casos, contas, extratos nem registros da fila. Recusa se houver job dsr.* pendente ou em
-- execucao: a reversao nao pode deixar um handler sem funcao ou um expurgo sem gatilho em andamento.
-- As linhas da fila concluidas e do catalogo de auditoria nao sao removidas.
-- Execucao manual e consciente, so em banco de desenvolvimento.
begin;

do $$
begin
  if exists (select 1 from ops.job
              where kind in ('dsr.process_auto', 'dsr.auth_cleanup', 'dsr.export_purge')
                and state in ('pendente', 'em_execucao')) then
    raise exception 'desfazer_recusado_ha_job_pendente';
  end if;
end
$$;

drop trigger if exists dsr_case_event_enqueue_email on app.dsr_case_event;
drop trigger if exists dsr_export_enqueue_purge on app.dsr_export;
drop trigger if exists dsr_usuario_enqueue_auth_cleanup on app.app_user;
drop trigger if exists dsr_case_enqueue_process_auto on app.dsr_case;

drop function if exists app.dsr_job_auth_cleanup_target(uuid);
drop function if exists app.dsr_job_export_mark_purged(uuid);
drop function if exists app.dsr_job_export_target(uuid);
drop function if exists app.dsr_job_process_auto(uuid);
drop function if exists private.dsr_event_enqueue_email();
drop function if exists private.dsr_export_enqueue_purge();
drop function if exists private.dsr_usuario_enqueue_auth_cleanup();
drop function if exists private.dsr_case_enqueue_job();

delete from ops.schema_migration where version = '20261113530000';

commit;
