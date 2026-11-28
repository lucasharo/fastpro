-- H-110 (Issue 119) | Correcao apos Code Review, sobre 20261112230000_ops_create_operational_purge (ja aplicada no DEV).
-- Migracao nova: a original nao e editada. Mantem security definer, search_path vazio e grants so a app_system.
--
-- 1. E9 (achado 1): o filtro (nome com padrao uuid e sem linha em app.media_asset) vai para o SQL. Antes o limite era
--    aplicado antes do filtro, e nomes fora do padrao ou objetos com linha ocupavam o lote (starvation).
--    Agora o SQL devolve so os nomes orfaos (ate o limite) e conta os fora do padrao em out_retidos, sem limite.
--    Como o tipo de retorno muda, a funcao e recriada (drop + create); a assinatura de entrada nao muda.
-- 2. E1 (achado 2): ops_purge_media_adia move para o fim da fila as fotos marcadas cuja remocao falhou. A fila de
--    marcados e ordenada por purge_requested_at; sem isso, uma falha persistente (objeto_recusado) travava o lote.

drop function if exists private.ops_purge_media_orfaos(timestamptz, integer);

create function private.ops_purge_media_orfaos(p_now timestamptz, p_limit integer)
returns table (out_estado text, out_nomes text[], out_retidos integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ttl bigint := private.ops_purge_cfg('purge.quarantine_pending_seconds');
  v_nomes text[] := '{}'::text[];
  v_retidos integer := 0;
begin
  perform private.ops_purge_check_limit(p_limit);
  if v_ttl is null then
    return query select 'desligado'::text, '{}'::text[], 0;
    return;
  end if;
  if to_regclass('storage.objects') is null then
    return query select 'pulado_ausente'::text, '{}'::text[], 0;
    return;
  end if;
  -- Nomes sao lidos so aqui (nunca em log). Fora do padrao uuid: contagem propria, fora do limite.
  execute format(
    'with cand as (
       select o.name::text as nome,
              o.created_at,
              substring(o.name::text from ''^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'') as uuid_txt
         from storage.objects o
        where o.bucket_id = %L
          and o.created_at <= $1
     )
     select
       (select count(*)::integer from cand c where c.uuid_txt is null),
       coalesce((
         select array_agg(s.nome order by s.created_at, s.nome)
           from (
             select c.nome, c.created_at
               from cand c
              where c.uuid_txt is not null
                and not exists (select 1 from app.media_asset m where m.id = c.uuid_txt::uuid)
              order by c.created_at, c.nome
              limit $2
           ) s
       ), ''{}''::text[])',
    'quarantine')
    into v_retidos, v_nomes
    using p_now - make_interval(secs => v_ttl), p_limit;
  return query select 'ok'::text, v_nomes, v_retidos;
end;
$$;

revoke all on function private.ops_purge_media_orfaos(timestamptz, integer)
  from public, anon, authenticated, service_role, app_api;
grant execute on function private.ops_purge_media_orfaos(timestamptz, integer) to app_system;

-- 2. E1: adia (move para o fim da fila de marcados) as fotos cuja remocao do objeto falhou. Nao apaga nada.
create or replace function private.ops_purge_media_adia(p_ids uuid[], p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
begin
  if p_ids is null or p_now is null then
    raise exception 'purge_entrada_invalida' using errcode = '22023';
  end if;
  update app.media_asset m
     set purge_requested_at = p_now
   where m.id = any(p_ids)
     and m.purge_requested_at is not null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function private.ops_purge_media_adia(uuid[], timestamptz)
  from public, anon, authenticated, service_role, app_api;
grant execute on function private.ops_purge_media_adia(uuid[], timestamptz) to app_system;
