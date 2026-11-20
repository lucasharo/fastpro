-- Issue 120 (H-111) | Desfaz 20261120410000_privacy_create_dsr_process_watch_assisted.sql: remove app.dsr_process,
-- app.dsr_deadline_watch, app.dsr_open_assisted e private.dsr_correcao_campos (somente o que a migracao criou).
-- Recusa se ja houver caso aberto pelo DPO (canal dpo_externo): a reversao nao pode deixar casos sem a funcao de abertura.
-- As linhas do catalogo de auditoria nao sao removidas (registros de auditoria podem referenciar as acoes).
-- Execucao manual e consciente, so em banco de desenvolvimento.
begin;

do $$
begin
  if exists (select 1 from app.dsr_case where channel = 'dpo_externo') then
    raise exception 'desfazer_recusado_ha_caso_dpo_externo';
  end if;
end
$$;

drop function if exists app.dsr_open_assisted(uuid, uuid, text, jsonb, text);
drop function if exists app.dsr_deadline_watch(integer);
drop function if exists app.dsr_process(uuid, uuid);
drop function if exists private.dsr_correcao_campos();

delete from ops.schema_migration where version = '20261120410000';

commit;
