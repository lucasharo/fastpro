-- Desfaz 20261110160000_platform_enable_job_tick.sql. EXECUCAO MANUAL e consciente: so em banco de
-- desenvolvimento. Remove as agendas, as funcoes do tick e as extensoes pg_cron/pg_net (e com elas
-- o historico de execucoes). Nao usa CASCADE: se algum objeto depender das extensoes, o drop falha.
begin;
delete from ops.schema_migration where version = '20261110160000';
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'jobs-tick') then
      perform cron.unschedule('jobs-tick');
    end if;
    if exists (select 1 from cron.job where jobname = 'cron-purge') then
      perform cron.unschedule('cron-purge');
    end if;
  end if;
end
$$;
drop function if exists private.jobs_tick_status();
drop function if exists private.jobs_tick_dispatch();
drop extension if exists pg_net;
drop extension if exists pg_cron;
commit;
