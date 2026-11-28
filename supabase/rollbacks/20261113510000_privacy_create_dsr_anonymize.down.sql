-- Issue 120 (H-111) | Desfaz 20261113510000_privacy_create_dsr_anonymize.sql: remove a funcao de anonimizacao do titular.
-- Nao altera dados. Recusa se ja houver conta anonimizada ou caso concluido por anonimizacao: esse e estado
-- irreversivel, e a reversao so e permitida enquanto a funcao nunca tiver sido usada. A linha do catalogo de
-- auditoria nao e removida (registros de auditoria podem referenciar a acao).
-- Execucao manual e consciente, so em banco de desenvolvimento.
begin;

do $$
begin
  if exists (select 1 from app.app_user where status = 'anonimizado')
     or exists (select 1 from app.dsr_case where outcome = 'conta_anonimizada') then
    raise exception 'desfazer_recusado_ha_anonimizacao';
  end if;
end
$$;

drop function if exists private.dsr_anonymize_subject(uuid);

delete from ops.schema_migration where version = '20261113510000';

commit;
