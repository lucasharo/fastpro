-- Issue 68 (H-055) | Fotos prontas por pedido para a lista da descoberta (docs/factory/153-DESENHO-H055.md, §5.3).
-- Expansao pura: uma funcao nova, sem tabela, sem coluna e sem alteracao das funcoes existentes.
-- Vinculo seguro: app.media_asset.request_id e preenchido pela publicacao (private.request_publish_commit_enc) so nas
-- fotos prontas e confirmadas. Aqui conta a foto com status 'ready' e sem expurgo pedido.
-- Devolve so os ids de pedido com ao menos uma foto pronta: nunca chave de arquivo, nome, contagem ou status.
-- Lista de entrada limitada a 200 ids (o mesmo teto da pagina da descoberta).

create or replace function private.request_discovery_photo_flags(p_request_ids uuid[])
returns table (out_request_id uuid)
language plpgsql
stable
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
begin
  if p_request_ids is null or cardinality(p_request_ids) > 200 then
    raise exception 'foto_parametro_invalido' using errcode = '22023';
  end if;

  return query
    select distinct m.request_id
      from app.media_asset m
     where m.request_id = any(p_request_ids)
       and m.status = 'ready'
       and m.purge_requested_at is null;
end
$$;

-- Privilegios: so app_system executa (mesmo padrao das funcoes de leitura do pedido).
revoke all on function private.request_discovery_photo_flags(uuid[])
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
grant execute on function private.request_discovery_photo_flags(uuid[]) to app_system;
