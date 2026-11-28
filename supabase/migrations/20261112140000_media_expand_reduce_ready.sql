-- H-027 (Issue #40) | Reducao e reencode das fotos (docs/factory/93-DESENHO-H027.md, §3; CA-01 a CA-03, CA-05,
-- CA-06, CA-11, CA-13; decisoes 79 a 88). Idempotente. Desfazer: supabase/rollbacks/20261112140000_media_expand_reduce_ready.down.sql.
-- Migracao por expansao: so acrescenta colunas anulaveis, restricoes, funcoes novas e o bucket request-photos.
-- Nao redefine nenhuma funcao da #39 (media_issue, media_get, media_finalize, media_sweep, media_purge_done,
-- media_known, o trigger de limite). 'ready' e gravado somente por private.media_reduce_done (teste estatico R-14).
-- Tempo: p_now informado pelo chamador (relogio do servidor), como nas funcoes da #39.

-- 1. Colunas novas em app.media_asset. Sem caminho, nome original, EXIF, IP ou tipo detectado (CA-13).
alter table app.media_asset
  add column if not exists ready_at          timestamptz,
  add column if not exists ready_bytes       integer,
  add column if not exists ready_width       smallint,
  add column if not exists ready_height      smallint,
  add column if not exists reject_code       text,
  add column if not exists reduce_lease_until timestamptz,
  add column if not exists reduce_attempts   smallint not null default 0,
  add column if not exists original_removed_at timestamptz;

-- 2. Restricoes que fecham os estados validos. Cada uma so e criada se ainda nao existe (idempotencia).
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'app.media_asset'::regclass and conname = 'media_asset_ready_bytes_ck') then
    alter table app.media_asset add constraint media_asset_ready_bytes_ck
      check (ready_bytes is null or ready_bytes between 1 and 750000);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'app.media_asset'::regclass and conname = 'media_asset_ready_dim_ck') then
    alter table app.media_asset add constraint media_asset_ready_dim_ck
      check ((ready_width is null or ready_width between 1 and 1280)
         and (ready_height is null or ready_height between 1 and 1280));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'app.media_asset'::regclass and conname = 'media_asset_reject_code_ck') then
    alter table app.media_asset add constraint media_asset_reject_code_ck
      check (reject_code is null or reject_code in ('imagem_invalida', 'imagem_grande_demais', 'nao_cabe_no_limite', 'nao_processavel'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'app.media_asset'::regclass and conname = 'media_asset_attempts_ck') then
    alter table app.media_asset add constraint media_asset_attempts_ck
      check (reduce_attempts between 0 and 4);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'app.media_asset'::regclass and conname = 'media_asset_ready_ck') then
    alter table app.media_asset add constraint media_asset_ready_ck
      check ((status = 'ready') = (ready_at is not null and ready_bytes is not null and ready_width is not null and ready_height is not null));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'app.media_asset'::regclass and conname = 'media_asset_ready_solo_ck') then
    alter table app.media_asset add constraint media_asset_ready_solo_ck
      check (status = 'ready' or (ready_at is null and ready_bytes is null and ready_width is null and ready_height is null));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'app.media_asset'::regclass and conname = 'media_asset_reject_ck') then
    alter table app.media_asset add constraint media_asset_reject_ck
      check ((status = 'rejected') = (reject_code is not null));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'app.media_asset'::regclass and conname = 'media_asset_ready_confirmed_ck') then
    alter table app.media_asset add constraint media_asset_ready_confirmed_ck
      check (status <> 'ready' or confirmed_at is not null);
  end if;
end;
$$;

-- 3. Bucket da versao reduzida (decisao 88). Privado, so JPEG, teto de 750.000 bytes. Nenhuma politica em
--    storage.objects: so a API escreve e remove, com a credencial de servico do ambiente do servidor.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('request-photos', 'request-photos', false, 750000, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 4. Reducao, passo 1 (media_reduce_begin). Posse por hash, como media_get. Ordem: nao encontrado -> ready ->
--    rejected -> nao confirmado -> lease ativa (busy) -> 3 tentativas contadas (grava rejected/nao_processavel)
--    -> toma a lease, soma 1 e devolve a tentativa. out_code: begin | ready | rejected | busy | not_confirmed | not_found.
create or replace function private.media_reduce_begin(
  p_hash text,
  p_id uuid,
  p_now timestamptz,
  p_lease_s integer)
returns table (out_code text, out_attempt smallint, out_reject_code text, out_original_pending boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row app.media_asset;
begin
  if p_hash is null or p_id is null or p_now is null or p_lease_s is null
     or p_lease_s < 5 or p_lease_s > 120 then
    raise exception 'media_entrada_invalida' using errcode = '22023';
  end if;

  select m.* into v_row
    from app.media_asset m
    join app.request_draft r on r.id = m.draft_id
   where m.id = p_id
     and m.purge_requested_at is null
     and r.browser_nonce_hash = p_hash
     and r.status in ('aberto', 'aguardando_email')
     and r.expires_at > p_now
   for update of m;
  if not found then
    out_code := 'not_found';
    return next;
    return;
  end if;

  if v_row.status = 'ready' then
    out_code := 'ready';
    out_original_pending := v_row.original_removed_at is null;
    return next;
    return;
  end if;

  if v_row.status = 'rejected' then
    out_code := 'rejected';
    out_reject_code := v_row.reject_code;
    out_original_pending := v_row.original_removed_at is null;
    return next;
    return;
  end if;

  if v_row.confirmed_at is null then
    out_code := 'not_confirmed';
    return next;
    return;
  end if;

  if v_row.reduce_lease_until is not null and v_row.reduce_lease_until > p_now then
    out_code := 'busy';
    return next;
    return;
  end if;

  if v_row.reduce_attempts >= 3 then
    update app.media_asset m
       set status = 'rejected',
           reject_code = 'nao_processavel',
           reduce_lease_until = null
     where m.id = v_row.id;
    out_code := 'rejected';
    out_reject_code := 'nao_processavel';
    out_original_pending := v_row.original_removed_at is null;
    return next;
    return;
  end if;

  update app.media_asset m
     set reduce_lease_until = p_now + make_interval(secs => p_lease_s),
         reduce_attempts = m.reduce_attempts + 1
   where m.id = v_row.id
  returning m.reduce_attempts into out_attempt;
  out_code := 'begin';
  out_original_pending := v_row.original_removed_at is null;
  return next;
end;
$$;

-- 5. Reducao, passo 2 (media_reduce_done). E a UNICA funcao que grava status 'ready' (teste estatico R-14).
--    So grava se a linha nao esta marcada para expurgo, esta pendente e confirmada e a tentativa e a dona.
--    out_code: done | lost (outra tentativa assumiu) | gone (linha marcada ou apagada durante a reducao).
create or replace function private.media_reduce_done(
  p_id uuid,
  p_attempt smallint,
  p_bytes integer,
  p_width integer,
  p_height integer,
  p_now timestamptz)
returns table (out_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row app.media_asset;
begin
  if p_id is null or p_attempt is null or p_now is null or p_bytes is null or p_width is null or p_height is null
     or p_bytes < 1 or p_bytes > 750000 or p_width < 1 or p_width > 1280 or p_height < 1 or p_height > 1280 then
    raise exception 'media_entrada_invalida' using errcode = '22023';
  end if;

  select m.* into v_row from app.media_asset m where m.id = p_id for update;
  if not found or v_row.purge_requested_at is not null then
    out_code := 'gone';
    return next;
    return;
  end if;

  if v_row.status <> 'pending' or v_row.confirmed_at is null or v_row.reduce_attempts <> p_attempt then
    out_code := 'lost';
    return next;
    return;
  end if;

  update app.media_asset m
     set status = 'ready',
         ready_at = p_now,
         ready_bytes = p_bytes,
         ready_width = p_width,
         ready_height = p_height,
         reduce_lease_until = null
   where m.id = v_row.id;
  out_code := 'done';
  return next;
end;
$$;

-- 6. Reducao, recusa definitiva (media_reduce_reject). Vaga liberada: 'rejected' nao conta na cota (trigger e media_issue).
create or replace function private.media_reduce_reject(
  p_id uuid,
  p_attempt smallint,
  p_code text,
  p_now timestamptz)
returns table (out_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row app.media_asset;
begin
  if p_id is null or p_attempt is null or p_now is null
     or p_code is null or p_code not in ('imagem_invalida', 'imagem_grande_demais', 'nao_cabe_no_limite', 'nao_processavel') then
    raise exception 'media_entrada_invalida' using errcode = '22023';
  end if;

  select m.* into v_row from app.media_asset m where m.id = p_id for update;
  if not found or v_row.purge_requested_at is not null then
    out_code := 'gone';
    return next;
    return;
  end if;

  if v_row.status <> 'pending' or v_row.confirmed_at is null or v_row.reduce_attempts <> p_attempt then
    out_code := 'lost';
    return next;
    return;
  end if;

  update app.media_asset m
     set status = 'rejected',
         reject_code = p_code,
         reduce_lease_until = null
   where m.id = v_row.id;
  out_code := 'rejected';
  return next;
end;
$$;

-- 7. Libera a lease da tentativa dona. p_count false devolve a tentativa (erro de Storage ou do sharp; decisao 86).
create or replace function private.media_reduce_release(
  p_id uuid,
  p_attempt smallint,
  p_count boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_id is null or p_attempt is null or p_count is null then
    raise exception 'media_entrada_invalida' using errcode = '22023';
  end if;

  update app.media_asset m
     set reduce_lease_until = null,
         reduce_attempts = case when p_count then m.reduce_attempts else greatest(m.reduce_attempts - 1, 0) end
   where m.id = p_id
     and m.status = 'pending'
     and m.reduce_attempts = p_attempt;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- 8. Marca que o original saiu da quarentena. So para ready ou rejected (decisao 82).
create or replace function private.media_original_removed(p_id uuid, p_now timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_id is null or p_now is null then
    raise exception 'media_entrada_invalida' using errcode = '22023';
  end if;

  update app.media_asset m
     set original_removed_at = p_now
   where m.id = p_id
     and m.status in ('ready', 'rejected')
     and m.original_removed_at is null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- 9. Lista de limpeza de sobras: ready ou rejected com original ainda na quarentena e sem expurgo marcado.
create or replace function private.media_original_cleanup_list(p_limit integer)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'media_entrada_invalida' using errcode = '22023';
  end if;

  select coalesce(array_agg(x.id), '{}'::uuid[]) into v_ids
    from (
      select m.id
        from app.media_asset m
       where m.status in ('ready', 'rejected')
         and m.original_removed_at is null
         and m.purge_requested_at is null
       order by m.created_at, m.id
       limit p_limit
    ) x;
  return v_ids;
end;
$$;

-- Privilegios: nenhuma funcao nova para PUBLIC, anon, authenticated ou service_role; execute so para app_api.
revoke all on function private.media_reduce_begin(text, uuid, timestamptz, integer)
  from public, anon, authenticated, service_role;
revoke all on function private.media_reduce_done(uuid, smallint, integer, integer, integer, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.media_reduce_reject(uuid, smallint, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.media_reduce_release(uuid, smallint, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.media_original_removed(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.media_original_cleanup_list(integer)
  from public, anon, authenticated, service_role;

grant execute on function private.media_reduce_begin(text, uuid, timestamptz, integer) to app_api;
grant execute on function private.media_reduce_done(uuid, smallint, integer, integer, integer, timestamptz) to app_api;
grant execute on function private.media_reduce_reject(uuid, smallint, text, timestamptz) to app_api;
grant execute on function private.media_reduce_release(uuid, smallint, boolean) to app_api;
grant execute on function private.media_original_removed(uuid, timestamptz) to app_api;
grant execute on function private.media_original_cleanup_list(integer) to app_api;
