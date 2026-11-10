-- H-008 | Tick A degradado (desenho 24-DESENHO-H008.md; decisao do spike S-10).
-- Contexto: o dono desativou pg_net e pg_cron no painel do Supabase (acesso indevido fechado). Esta
-- migracao NAO cria extensao, segredo, Vault nem agendamento, e nao remove nada.
-- Efeito: o despachante do tick (A) passa a ser inerte (devolve null, sem erro e sem enfileirar) quando
-- o esquema net nao existe, quando a view do Vault nao existe, ou quando o segredo/URL nao existem.
-- O tick C (oportunista, sem pg_cron) nao depende desta funcao e nao muda.
-- A migracao 20261110160000 NAO e editada (ja aplicada). Nao ha agenda a remover aqui: neste ambiente
-- o cron nao existe; se um ambiente tiver a agenda, o comando agendado so chama o despachante inerte.
-- Nao usa DROP nem CASCADE. CREATE OR REPLACE mantem dono e assinatura; os privilegios sao reafirmados.
-- Desfazer: supabase/rollbacks/20261110170000_platform_tick_degrade_without_extensions.down.sql (manual).
-- Nenhum segredo e versionado: o despachante continua lendo jobs_tick_secret e jobs_tick_url do Vault.

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
  -- Sem pg_net (esquema net) ou sem Vault: nao ha como enfileirar. Inerte: nao erra e nao cria nada.
  if to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    return null;
  end if;

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

-- Privilegios: CREATE OR REPLACE preserva o ACL, mas o revoke e reafirmado (mesmo padrao da 160000).
revoke all on function private.jobs_tick_dispatch()
  from public, anon, authenticated, service_role, app_api, app_system;
