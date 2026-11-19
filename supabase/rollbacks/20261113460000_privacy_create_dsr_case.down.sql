-- Issue 120 (H-111) | Desfaz 20261113460000_privacy_create_dsr_case.sql: remove as tabelas do caso e da linha do tempo,
-- as funcoes de gatilho e os quatro parametros privacy.* semeados por esta migracao.
-- Recusa se houver caso ou evento gravado: o registro de atendimento de direito do titular nao e descartado por rollback.
-- Execucao manual e consciente, so em banco de desenvolvimento.
begin;

do $$
begin
  if to_regclass('app.dsr_case') is not null and exists (select 1 from app.dsr_case) then
    raise exception 'dsr_rollback_com_casos';
  end if;
  if to_regclass('app.dsr_case_event') is not null and exists (select 1 from app.dsr_case_event) then
    raise exception 'dsr_rollback_com_eventos';
  end if;
end
$$;

drop table if exists app.dsr_case_event;
drop table if exists app.dsr_case;

drop function if exists private.dsr_case_event_refuse_mutation();
drop function if exists private.dsr_case_refuse_delete();
drop function if exists private.dsr_case_guard();
drop function if exists private.dsr_case_insert_guard();
drop function if exists private.dsr_case_transition_allowed(text, text);

delete from ops.app_config
 where updated_by = 'migration:20261113460000'
   and key in ('privacy.dsr_deadline_days', 'privacy.dsr_export_ttl_days',
               'privacy.dsr_export_min_interval_days', 'privacy.dsr_step_up_minutes');

delete from ops.schema_migration where version = '20261113460000';

commit;
