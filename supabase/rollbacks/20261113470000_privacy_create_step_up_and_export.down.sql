-- Issue 120 (H-111) | Desfaz 20261113470000_privacy_create_step_up_and_export.sql: remove a politica do bucket, o bucket
-- dsr-exports (so se vazio), as tabelas app.dsr_export e app.step_up_grant e as funcoes de gatilho novas.
-- Recusa se houver extrato, grant de step-up ou arquivo gravado: esses registros nao sao descartados por rollback.
-- Execucao manual e consciente, so em banco de desenvolvimento.
begin;

do $$
begin
  if to_regclass('app.dsr_export') is not null and exists (select 1 from app.dsr_export) then
    raise exception 'dsr_rollback_com_extratos';
  end if;
  if to_regclass('app.step_up_grant') is not null and exists (select 1 from app.step_up_grant) then
    raise exception 'dsr_rollback_com_tokens';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'dsr-exports') then
    raise exception 'dsr_rollback_com_arquivos';
  end if;
end
$$;

drop policy if exists dsr_exports_negar_acesso_direto on storage.objects;

drop table if exists app.dsr_export;
drop table if exists app.step_up_grant;

drop function if exists private.dsr_registro_refuse_delete();
drop function if exists private.dsr_export_guard();
drop function if exists private.dsr_step_up_grant_guard();

delete from storage.buckets where id = 'dsr-exports';

delete from ops.schema_migration where version = '20261113470000';

commit;
