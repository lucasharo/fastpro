-- Desfaz 20261110170000_platform_tick_degrade_without_extensions.sql. EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento. Restaura o corpo do despachante como estava na 20261110160000 (sem
-- a guarda de esquema net/Vault) e remove o registro desta migracao. Nao cria, nao remove extensao,
-- agenda, segredo nem dado. Sem DROP e sem CASCADE. Atencao: restaurar o corpo antigo faz o despachante
-- voltar a falhar se pg_net estiver ausente (o que a 170000 evita).
begin;
delete from ops.schema_migration where version = '20261110170000';
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
revoke all on function private.jobs_tick_dispatch()
  from public, anon, authenticated, service_role, app_api, app_system;
commit;
