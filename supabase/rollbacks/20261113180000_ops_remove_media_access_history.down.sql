-- Desfaz 20261113180000_ops_remove_media_access_history.sql (Issue 150). EXECUCAO MANUAL e consciente: so em banco de
-- desenvolvimento. Recria SOMENTE a estrutura vazia de ops.media_access_daily (colunas e restricoes iguais as da
-- migracao 20261112230000) e a chave de rollup com o valor do runbook (86400). Se o banco tiver outro valor, o
-- executor ajusta a mao. NAO restaura a funcao ops_purge_media_access e NAO restaura linhas: dados removidos nao voltam
-- (decisao 326; desenho §2.1). Idempotente (if not exists, on conflict do nothing).
begin;

create table if not exists ops.media_access_daily (
  professional_id uuid not null,
  day             date not null,
  outcome         text not null check (outcome in ('ok', 'negado', 'limitado')),
  n               bigint not null check (n >= 0),
  rolled_at       timestamptz not null,
  primary key (professional_id, day, outcome)
);
alter table ops.media_access_daily enable row level security;
alter table ops.media_access_daily force row level security;
revoke all on table ops.media_access_daily
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
comment on table ops.media_access_daily is
  'Estrutura vazia recriada pelo rollback da Issue 150. Sem DML direto; os dados removidos nao voltam.';

insert into ops.app_config (key, value, version, updated_by)
values ('purge.media_access_rollup_after_seconds', '86400'::jsonb, 1, 'rollback:20261113180000')
on conflict do nothing;

do $$
begin
  raise notice 'Issue 150 desfeita: estrutura vazia recriada. A funcao esta em 20261112230000 (secao 12); para reativar, recrie-a a partir dela e reintroduza o bloco no TypeScript. Dados removidos nao voltam.';
end $$;

commit;
