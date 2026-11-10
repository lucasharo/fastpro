-- H-008 | Tick de jobs (desenho 24-DESENHO-H008.md §2; decisao do spike S-10): habilita pg_cron e
-- pg_net, fecha os esquemas cron/net para papeis de aplicacao, cria o despachante do tick (A) e a
-- funcao de status, e agenda o tick de 1 minuto e o expurgo diario de cron.job_run_details.
-- Idempotente. Desfazer: supabase/rollbacks/20261110160000_platform_enable_job_tick.down.sql (manual).
-- Estrita: se qualquer extensao nao puder ser criada, a migracao falha (nada fica pela metade).
-- Nenhum segredo e versionado: o despachante le jobs_tick_secret e jobs_tick_url do Vault, criados
-- pelo operador. Sem segredo ou sem URL, o despachante nao chama nada (no-op).

-- 1. Extensoes ---------------------------------------------------------------------------------------
-- pg_net vai para o esquema extensions (medido no S-10: sem a clausula cai em public).
-- pg_cron nao aceita outro esquema: a plataforma o instala em pg_catalog (medido); os objetos vivem
-- no esquema cron, que e o que a migracao protege.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- 2. Revoke depois do create (a plataforma e a extensao concedem acesso ao criar) ----------------
revoke all on schema cron, net from public, anon, authenticated, service_role, app_api, app_system;
revoke all on all tables in schema cron, net
  from public, anon, authenticated, service_role, app_api, app_system;
revoke all on all sequences in schema cron, net
  from public, anon, authenticated, service_role, app_api, app_system;
revoke all on all functions in schema cron, net
  from public, anon, authenticated, service_role, app_api, app_system;

-- Objetos de cron/net que estejam fora desses dois esquemas (ex.: em extensions) tambem ficam
-- fechados: qualquer tabela, sequencia ou funcao pertencente a pg_net ou pg_cron.
do $$
declare
  o record;
begin
  for o in
    select 'table' as tipo, format('%I.%I', n.nspname, c.relname) as nome
      from pg_depend d
      join pg_class c on c.oid = d.objid and d.classid = 'pg_class'::regclass
      join pg_namespace n on n.oid = c.relnamespace
      join pg_extension e on e.oid = d.refobjid and d.refclassid = 'pg_extension'::regclass
     where e.extname in ('pg_net', 'pg_cron') and d.deptype = 'e'
       and c.relkind in ('r', 'p', 'v', 'm', 'f')
    union all
    select 'sequence', format('%I.%I', n.nspname, c.relname)
      from pg_depend d
      join pg_class c on c.oid = d.objid and d.classid = 'pg_class'::regclass
      join pg_namespace n on n.oid = c.relnamespace
      join pg_extension e on e.oid = d.refobjid and d.refclassid = 'pg_extension'::regclass
     where e.extname in ('pg_net', 'pg_cron') and d.deptype = 'e' and c.relkind = 'S'
  loop
    execute format('revoke all on %s %s from public, anon, authenticated, service_role, app_api, app_system',
                   o.tipo, o.nome);
  end loop;
  for o in
    select p.oid::regprocedure::text as nome
      from pg_depend d
      join pg_proc p on p.oid = d.objid and d.classid = 'pg_proc'::regclass
      join pg_extension e on e.oid = d.refobjid and d.refclassid = 'pg_extension'::regclass
     where e.extname in ('pg_net', 'pg_cron') and d.deptype = 'e'
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role, app_api, app_system',
                   o.nome);
  end loop;
end
$$;

-- 3. Despachante do tick (A): so dispara se o segredo e a URL existirem --------------------------
-- Roda como dono (postgres) no cron; nao recebe grant. Nunca grava segredo, nunca usa raise com
-- valor. A URL precisa ser https e terminar no caminho fixo: nao serve como SSRF generico.
-- Devolve o id do pedido do pg_net (ou null quando nao disparou).
create or replace function private.jobs_tick_dispatch()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_url text;
  v_request bigint;
begin
  select ds.decrypted_secret into v_secret
    from vault.decrypted_secrets ds where ds.name = 'jobs_tick_secret';
  select ds.decrypted_secret into v_url
    from vault.decrypted_secrets ds where ds.name = 'jobs_tick_url';

  if coalesce(v_secret, '') = '' or coalesce(v_url, '') = '' then
    return null;  -- sem segredo ou sem URL neste ambiente: nao dispara
  end if;
  if v_url !~ '^https://[^[:space:]]+/internal/jobs/tick$' then
    return null;  -- URL fora do padrao: nao enfileira
  end if;

  select net.http_post(
           url := v_url,
           body := '{}'::jsonb,
           headers := jsonb_build_object(
             'Authorization', 'Bearer ' || v_secret,
             'Content-Type', 'application/json'),
           timeout_milliseconds := 30000)
    into v_request;
  return v_request;
end
$$;

-- 4. Status do tick (somente leitura; so app_system): sem comando, sem segredo, sem mensagem ------
create or replace function private.jobs_tick_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_instalado boolean;
  v_ativo boolean;
  v_inicio timestamptz;
  v_status text;
begin
  v_instalado := exists (select 1 from pg_extension where extname = 'pg_cron');
  if not v_instalado then
    return jsonb_build_object('cron_instalado', false, 'job_ativo', false,
                              'ultima_execucao', null, 'ultimo_status', null);
  end if;

  select j.active into v_ativo from cron.job j where j.jobname = 'jobs-tick';
  select d.start_time, d.status into v_inicio, v_status
    from cron.job_run_details d
    join cron.job j on j.jobid = d.jobid
   where j.jobname = 'jobs-tick'
   order by d.start_time desc
   limit 1;

  return jsonb_build_object('cron_instalado', true, 'job_ativo', coalesce(v_ativo, false),
                            'ultima_execucao', v_inicio, 'ultimo_status', v_status);
end
$$;

-- 5. Privilegios das funcoes ----------------------------------------------------------------------
revoke all on function private.jobs_tick_dispatch(), private.jobs_tick_status()
  from public, anon, authenticated, service_role, app_api, app_system;
grant execute on function private.jobs_tick_status() to app_system;

-- 6. Agenda (cron.schedule faz upsert pelo nome; idempotente) --------------------------------------
-- O comando agendado e so a chamada fixa ao despachante: sem URL, sem segredo, sem http.
select cron.schedule('jobs-tick', '* * * * *', 'select private.jobs_tick_dispatch()');
-- Expurgo diario: job_run_details cresce 1.440 linhas/dia; retencao de 3 dias.
select cron.schedule('cron-purge', '17 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '3 days'$$);
