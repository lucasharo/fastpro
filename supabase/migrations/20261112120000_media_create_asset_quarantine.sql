-- H-026 (Issue #39) | Upload de fotos em quarentena (docs/factory/88-DESENHO-H026.md, §1 a §4; I-29, F-09, P-01).
-- Idempotente. Desfazer: supabase/rollbacks/20261112120000_media_create_asset_quarantine.down.sql.
-- Migracao por expansao: so cria objetos novos (tabela, trigger, funcoes, bucket). Nao altera request_draft
-- nem as funcoes draft_* de H-025.
-- A API nunca le os bytes: o envio vai direto ao bucket privado 'quarantine'. Nenhuma politica em
-- storage.objects para esse bucket (ninguem le, nem o visitante). Nenhuma funcao copia ou le o objeto.
-- Status fica 'pending' nesta etapa; 'ready' e 'rejected' sao de H-027 e H-028.
-- Tempo: p_now informado pelo chamador (relogio do servidor), para prazo, teto e testes.
-- TTL do pendente: 30 minutos (constante MEDIA_PENDING_TTL_MINUTES no dominio; a funcao usa o mesmo valor).

-- 1. Tabela da foto em quarentena. Sem nome, caminho, EXIF, IP ou tipo detectado (CA-13, I-29).
create table if not exists app.media_asset (
  id                 uuid primary key default gen_random_uuid(),
  draft_id           uuid not null references app.request_draft (id) on delete restrict,
  client_upload_id   uuid not null,
  declared_type      text not null check (declared_type in ('image/jpeg', 'image/png', 'image/webp')),
  declared_bytes     integer not null check (declared_bytes between 1 and 10485760),
  status             text not null default 'pending' check (status in ('pending', 'ready', 'rejected')),
  confirmed_at       timestamptz,
  confirmed_bytes    integer,
  pending_expires_at timestamptz not null,
  purge_requested_at timestamptz,
  created_at         timestamptz not null default clock_timestamp(),
  constraint media_asset_confirmacao_ck check (
    (confirmed_at is null and confirmed_bytes is null)
    or (confirmed_at is not null and confirmed_bytes between 1 and 10485760))
);
comment on table app.media_asset is
  'Foto em quarentena (H-026, 09 media_asset). Escrita so por funcao; o arquivo mora no bucket quarantine.';

-- Idempotencia por rascunho (CA-04). Parcial: uma linha marcada para expurgo nao bloqueia um reenvio novo.
create unique index if not exists media_asset_cliente_vivo_key
  on app.media_asset (draft_id, client_upload_id) where purge_requested_at is null;
create index if not exists media_asset_draft_vivo_idx
  on app.media_asset (draft_id) where purge_requested_at is null;
create index if not exists media_asset_pendente_vencimento_idx
  on app.media_asset (pending_expires_at) where confirmed_at is null and purge_requested_at is null;
create index if not exists media_asset_purge_idx
  on app.media_asset (purge_requested_at) where purge_requested_at is not null;

alter table app.media_asset enable row level security;
alter table app.media_asset force row level security;
revoke all on app.media_asset
  from public, anon, authenticated, service_role, app_api, app_system, app_backup_reader;

-- 2. Limite de 5 fotos vivas por rascunho como invariante do banco (I-29, CA-03; M-03).
--    Trava a linha do rascunho (serializa insercoes simultaneas) e conta as vivas antes de inserir.
create or replace function private.media_asset_limite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vivas bigint;
begin
  perform 1 from app.request_draft r where r.id = new.draft_id for update;
  select count(*) into v_vivas
    from app.media_asset m
   where m.draft_id = new.draft_id
     and m.purge_requested_at is null
     and m.status <> 'rejected';
  if v_vivas >= 5 then
    raise exception 'photo_limit' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists media_asset_limite on app.media_asset;
create trigger media_asset_limite
  before insert on app.media_asset
  for each row execute function private.media_asset_limite();

-- 3. Bucket privado de quarentena (idempotente). Limite de 10 MB e tres tipos impostos pelo proprio bucket.
--    Nenhuma politica em storage.objects: anon e authenticated nao leem nem listam (CA-08).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('quarantine', 'quarantine', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 4. Emissao (media_issue). Ordem: rascunho vivo (trava) -> libera pendentes vencidos deste rascunho ->
--    repeticao do client_upload_id -> limite de 5 -> teto global -> insercao (pendente, TTL de 30 min).
--    out_code: new | replay | not_found | photo_limit | cap.
create or replace function private.media_issue(
  p_hash text,
  p_client_upload_id uuid,
  p_type text,
  p_bytes integer,
  p_now timestamptz,
  p_global_cap integer)
returns table (out_code text, out_id uuid, out_status text, out_confirmed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft uuid;
  v_row app.media_asset;
  v_vivas bigint;
begin
  if p_hash is null or p_client_upload_id is null or p_now is null or p_global_cap is null
     or p_global_cap < 1 or p_global_cap > 1000000
     or p_type is null or p_type not in ('image/jpeg', 'image/png', 'image/webp')
     or p_bytes is null or p_bytes < 1 or p_bytes > 10485760 then
    raise exception 'media_entrada_invalida' using errcode = '22023';
  end if;

  select r.id into v_draft
    from app.request_draft r
   where r.browser_nonce_hash = p_hash
     and r.status in ('aberto', 'aguardando_email')
     and r.expires_at > p_now
   for update;
  if not found then
    out_code := 'not_found';
    return next;
    return;
  end if;

  -- Liberacao preguiçosa: pendentes vencidos deste rascunho deixam de contar no limite (F-09).
  update app.media_asset m
     set purge_requested_at = p_now
   where m.draft_id = v_draft
     and m.confirmed_at is null
     and m.purge_requested_at is null
     and m.pending_expires_at <= p_now;

  select m.* into v_row
    from app.media_asset m
   where m.draft_id = v_draft
     and m.client_upload_id = p_client_upload_id
     and m.purge_requested_at is null;
  if found then
    out_code := 'replay';
    out_id := v_row.id;
    out_status := v_row.status;
    out_confirmed := v_row.confirmed_at is not null;
    return next;
    return;
  end if;

  select count(*) into v_vivas
    from app.media_asset m
   where m.draft_id = v_draft
     and m.purge_requested_at is null
     and m.status <> 'rejected';
  if v_vivas >= 5 then
    out_code := 'photo_limit';
    return next;
    return;
  end if;

  select count(*) into v_vivas
    from app.media_asset m
   where m.purge_requested_at is null
     and m.status <> 'rejected';
  if v_vivas >= p_global_cap then
    out_code := 'cap';
    return next;
    return;
  end if;

  insert into app.media_asset (draft_id, client_upload_id, declared_type, declared_bytes, status,
                               pending_expires_at, created_at)
  values (v_draft, p_client_upload_id, p_type, p_bytes, 'pending',
          p_now + interval '30 minutes', p_now)
  returning * into v_row;

  out_code := 'new';
  out_id := v_row.id;
  out_status := v_row.status;
  out_confirmed := false;
  return next;
end;
$$;

-- 5. Leitura por posse (media_get). Zero linhas = 404 uniforme (inclui foto de outro rascunho).
create or replace function private.media_get(p_hash text, p_id uuid, p_now timestamptz)
returns table (out_id uuid, out_status text, out_confirmed boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.status, m.confirmed_at is not null
    from app.media_asset m
    join app.request_draft r on r.id = m.draft_id
   where m.id = p_id
     and m.purge_requested_at is null
     and r.browser_nonce_hash = p_hash
     and r.status in ('aberto', 'aguardando_email')
     and r.expires_at > p_now
$$;

-- 6. Confirmacao (media_finalize). Nunca grava 'ready' e nunca le o objeto: so registra o tamanho que a API
--    obteve pelo stat. out_code: confirmed | replay | not_found | expired | missing | too_large.
--    Pendente vencido e objeto acima de 10 MB vao para expurgo (a vaga e liberada).
create or replace function private.media_finalize(
  p_hash text,
  p_id uuid,
  p_stored_bytes integer,
  p_now timestamptz)
returns table (out_code text, out_id uuid, out_status text, out_confirmed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row app.media_asset;
begin
  if p_hash is null or p_id is null or p_now is null then
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

  if v_row.confirmed_at is not null then
    out_code := 'replay';
    out_id := v_row.id;
    out_status := v_row.status;
    out_confirmed := true;
    return next;
    return;
  end if;

  if v_row.pending_expires_at <= p_now then
    update app.media_asset m set purge_requested_at = p_now where m.id = v_row.id;
    out_code := 'expired';
    return next;
    return;
  end if;

  if p_stored_bytes is null or p_stored_bytes < 1 then
    out_code := 'missing';
    return next;
    return;
  end if;

  if p_stored_bytes > 10485760 then
    update app.media_asset m set purge_requested_at = p_now where m.id = v_row.id;
    out_code := 'too_large';
    return next;
    return;
  end if;

  update app.media_asset m
     set confirmed_at = p_now,
         confirmed_bytes = p_stored_bytes
   where m.id = v_row.id
  returning * into v_row;

  out_code := 'confirmed';
  out_id := v_row.id;
  out_status := v_row.status;
  out_confirmed := true;
  return next;
end;
$$;

-- 7. Expurgo, fase A (media_sweep): marca para expurgo (a) pendentes vencidos e (b) fotos de rascunho
--    descartado ou vencido (nunca publicado). Devolve os ids ainda marcados (inclui nova tentativa de falha).
create or replace function private.media_sweep(p_now timestamptz, p_limit integer)
returns table (out_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_now is null or p_limit is null or p_limit < 1 or p_limit > 10000 then
    raise exception 'media_entrada_invalida' using errcode = '22023';
  end if;

  with elegiveis as (
    select m.id
      from app.media_asset m
      join app.request_draft r on r.id = m.draft_id
     where m.purge_requested_at is null
       and (
         (m.confirmed_at is null and m.pending_expires_at <= p_now)
         or r.status = 'descartado'
         or (r.status in ('aberto', 'aguardando_email') and r.expires_at <= p_now)
       )
     order by m.created_at, m.id
     limit p_limit
     for update of m skip locked
  )
  update app.media_asset m
     set purge_requested_at = p_now
    from elegiveis e
   where m.id = e.id;

  return query
    select m.id
      from app.media_asset m
     where m.purge_requested_at is not null
     order by m.purge_requested_at, m.id
     limit p_limit;
end;
$$;

-- 8. Expurgo, fase C (media_purge_done): apaga as linhas marcadas cujo objeto o Storage ja removeu.
--    Devolve quantas linhas saíram. Linha nao marcada nao e apagada por esta funcao.
create or replace function private.media_purge_done(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_ids is null then
    return 0;
  end if;
  delete from app.media_asset m
   where m.id = any(p_ids)
     and m.purge_requested_at is not null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- 9. Varredura de orfaos: quais destes ids ainda tem linha (objeto sem linha e removido pelo job).
create or replace function private.media_known(p_ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id from app.media_asset m where m.id = any(p_ids)
$$;

-- Privilegios: nenhuma funcao para PUBLIC, anon, authenticated ou service_role; execute so para app_api.
revoke all on function private.media_asset_limite() from public, anon, authenticated, service_role, app_api;
revoke all on function private.media_issue(text, uuid, text, integer, timestamptz, integer)
  from public, anon, authenticated, service_role;
revoke all on function private.media_get(text, uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.media_finalize(text, uuid, integer, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.media_sweep(timestamptz, integer)
  from public, anon, authenticated, service_role;
revoke all on function private.media_purge_done(uuid[])
  from public, anon, authenticated, service_role;
revoke all on function private.media_known(uuid[])
  from public, anon, authenticated, service_role;

grant execute on function private.media_issue(text, uuid, text, integer, timestamptz, integer) to app_api;
grant execute on function private.media_get(text, uuid, timestamptz) to app_api;
grant execute on function private.media_finalize(text, uuid, integer, timestamptz) to app_api;
grant execute on function private.media_sweep(timestamptz, integer) to app_api;
grant execute on function private.media_purge_done(uuid[]) to app_api;
grant execute on function private.media_known(uuid[]) to app_api;
