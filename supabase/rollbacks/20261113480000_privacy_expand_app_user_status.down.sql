-- Issue 120 (H-111) | Desfaz 20261113480000_privacy_expand_app_user_status.sql: volta o CHECK de app.app_user.status para
-- {ativo, bloqueado} e remove o CHECK de coerencia de anonimizacao.
-- Recusa se houver conta anonimizada (estado irreversivel) ou em eliminacao (caso vivo): reverter sem aviso
-- mudaria o estado dessas contas. Execucao manual e consciente, so em banco de desenvolvimento.
begin;

do $$
begin
  if exists (select 1 from app.app_user where status = 'anonimizado') then
    raise exception 'dsr_rollback_com_conta_anonimizada';
  end if;
  if exists (select 1 from app.app_user where status = 'em_eliminacao') then
    raise exception 'dsr_rollback_com_conta_em_eliminacao';
  end if;
end
$$;

alter table app.app_user drop constraint if exists app_user_status_anonimizado_consistente;
alter table app.app_user drop constraint if exists app_user_status_check;
alter table app.app_user add constraint app_user_status_check
  check (status in ('ativo', 'bloqueado'));

delete from ops.schema_migration where version = '20261113480000';

commit;
