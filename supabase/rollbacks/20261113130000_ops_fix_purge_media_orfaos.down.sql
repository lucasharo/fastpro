-- Desfaz 20261113130000_ops_fix_purge_media_orfaos.sql. EXECUCAO MANUAL e consciente: so em banco de desenvolvimento.
-- Remove ops_purge_media_adia e restaura a versao de ops_purge_media_orfaos de 20261112230000 (filtro no Node).
begin;
delete from ops.schema_migration where version = '20261113130000';

drop function if exists private.ops_purge_media_adia(uuid[], timestamptz);

drop function if exists private.ops_purge_media_orfaos(timestamptz, integer);

create function private.ops_purge_media_orfaos(p_now timestamptz, p_limit integer)
returns table (out_estado text, out_nome text, out_id uuid, out_existe boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ttl bigint := private.ops_purge_cfg('purge.quarantine_pending_seconds');
  v_nome text;
  v_id uuid;
begin
  perform private.ops_purge_check_limit(p_limit);
  if v_ttl is null then
    return query select 'desligado'::text, null::text, null::uuid, null::boolean;
    return;
  end if;
  if to_regclass('storage.objects') is null then
    return query select 'pulado_ausente'::text, null::text, null::uuid, null::boolean;
    return;
  end if;
  for v_nome in
    execute format(
      'select o.name::text from storage.objects o where o.bucket_id = %L and o.created_at <= $1 order by o.created_at, o.name limit $2',
      'quarantine')
    using p_now - make_interval(secs => v_ttl), p_limit
  loop
    v_id := null;
    if v_nome ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' then
      v_id := substring(v_nome from '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})')::uuid;
    end if;
    return query select 'ok'::text, v_nome, v_id,
      (v_id is not null and exists (select 1 from app.media_asset m where m.id = v_id));
  end loop;
end;
$$;

revoke all on function private.ops_purge_media_orfaos(timestamptz, integer)
  from public, anon, authenticated, service_role, app_api;
grant execute on function private.ops_purge_media_orfaos(timestamptz, integer) to app_system;
commit;
