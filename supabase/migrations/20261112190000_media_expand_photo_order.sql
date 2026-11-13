-- H-029 (Issue #42) | Pre-visualizacao, exclusao e reordenacao das fotos (docs/factory/98-DESENHO-H029.md, §2 e §3;
-- CA-05 a CA-08; decisoes 117 a 119 e 133). Idempotente. Desfazer: supabase/rollbacks/20261112190000_media_expand_photo_order.down.sql.
-- Expansao: colunas novas, gatilho de ordem, indice, uma restricao, o guarda de confirmacao (copia literal de
-- 20261112150000 com uma linha alterada: foto que muda soma photo_rev, que zera a confirmacao, decisao 133) e
-- funcoes novas. Nao redefine nenhuma funcao da #39 (media_*), da #40 (media_reduce_*) nem da #43 (draft_*).
-- Tempo: p_now informado pelo chamador (relogio do servidor), como nas funcoes anteriores.

-- 1. Posicao guardada no servidor (decisao 119). Preenchida nas linhas existentes; depois obrigatoria.
alter table app.media_asset add column if not exists sort_order integer;

update app.media_asset m
   set sort_order = s.rn
  from (
    select x.id, row_number() over (partition by x.draft_id order by x.created_at, x.id) as rn
      from app.media_asset x
  ) s
 where m.id = s.id
   and m.sort_order is null;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'app' and table_name = 'media_asset' and column_name = 'sort_order' and is_nullable = 'YES'
  ) then
    alter table app.media_asset alter column sort_order set not null;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'app.media_asset'::regclass and conname = 'media_asset_sort_order_ck') then
    alter table app.media_asset add constraint media_asset_sort_order_ck
      check (sort_order between 1 and 100000);
  end if;
end;
$$;

-- 2. Gatilho de ordem (before insert): nova foto entra no fim. Nome depois de media_asset_limite na ordem
--    alfabetica dos gatilhos do mesmo evento, entao o de limite (que trava o rascunho) ja rodou: duas insercoes
--    simultaneas nao recebem o mesmo numero. A posicao exposta e sempre recalculada por row_number().
create or replace function private.media_asset_ordem()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select coalesce(max(m.sort_order), 0) + 1 into new.sort_order
    from app.media_asset m
   where m.draft_id = new.draft_id
     and m.purge_requested_at is null;
  return new;
end;
$$;

drop trigger if exists media_asset_ordem on app.media_asset;
create trigger media_asset_ordem
  before insert on app.media_asset
  for each row execute function private.media_asset_ordem();

-- 3. Indice da sequencia viva. Sem indice unico: renumerar em uma instrucao violaria a unicidade a meio caminho.
create index if not exists media_asset_ordem_vivo_idx
  on app.media_asset (draft_id, sort_order) where purge_requested_at is null;

-- 4. Contador de revisao das fotos do rascunho. Constante: a tabela nao e reescrita.
alter table app.request_draft add column if not exists photo_rev integer not null default 0;

alter table app.request_draft drop constraint if exists request_draft_photo_rev_nao_negativo;
alter table app.request_draft add constraint request_draft_photo_rev_nao_negativo
  check (photo_rev >= 0);

-- 5. Guarda de confirmacao (#43, 20261112150000). UNICA mudanca: 'photo_rev' entra em v_conteudo (decisao 133).
--    Mudar, excluir ou reordenar foto soma 1 em content_rev e zera confirmed_at (90 §3.3). Resto identico.
create or replace function private.draft_confirmation_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conteudo boolean;
begin
  v_conteudo :=
    (new.service_id, new.address_text, new.urgency, new.description, new.first_name, new.email, new.email_verified_at)
    is distinct from
    (old.service_id, old.address_text, old.urgency, old.description, old.first_name, old.email, old.email_verified_at)
    or new.photo_rev is distinct from old.photo_rev;

  if old.confirmed_at is null and new.confirmed_at is not null and v_conteudo then
    raise exception 'confirmacao_com_conteudo_alterado' using errcode = '23514';
  end if;

  new.content_rev := old.content_rev + case when v_conteudo then 1 else 0 end;

  if new.confirmed_at is not distinct from old.confirmed_at
     and (v_conteudo or new.status not in ('aberto', 'publicado')) then
    new.confirmed_at := null;
  end if;

  return new;
end
$$;

drop trigger if exists request_draft_confirmation_guard on app.request_draft;
create trigger request_draft_confirmation_guard
  before update on app.request_draft
  for each row execute function private.draft_confirmation_guard();

-- 6. Listagem (§2.1). Trava o rascunho vivo do hash; zero linhas = nao existe (404). Marca para remocao os
--    pendentes nao confirmados e vencidos deste rascunho (mesma liberacao preguicosa de media_issue).
--    Rascunho sem foto viva = uma linha com out_id nulo. Estado derivado uma vez, aqui.
create or replace function private.media_list(p_hash text, p_now timestamptz)
returns table (out_id uuid, out_state text, out_reject_code text, out_pos integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft uuid;
begin
  if p_hash is null or p_now is null then
    raise exception 'media_entrada_invalida' using errcode = '22023';
  end if;

  select r.id into v_draft
    from app.request_draft r
   where r.browser_nonce_hash = p_hash
     and r.status in ('aberto', 'aguardando_email')
     and r.expires_at > p_now
   for update;
  if not found then
    return;
  end if;

  update app.media_asset m
     set purge_requested_at = p_now
   where m.draft_id = v_draft
     and m.confirmed_at is null
     and m.purge_requested_at is null
     and m.pending_expires_at <= p_now;

  if not exists (
    select 1 from app.media_asset m where m.draft_id = v_draft and m.purge_requested_at is null
  ) then
    out_id := null; out_state := null; out_reject_code := null; out_pos := null;
    return next;
    return;
  end if;

  return query
  select x.id, x.estado, x.motivo, x.pos
    from (
      select m.id,
             m.created_at,
             m.status = 'rejected' as recusada,
             (case
               when m.status = 'rejected' then 'recusada'
               when m.status = 'ready' then 'pronta'
               when m.confirmed_at is null then 'enviando'
               when m.reduce_lease_until is not null and m.reduce_lease_until > p_now then 'processando'
               else 'aguardando'
             end)::text as estado,
             (case when m.status = 'rejected' then m.reject_code else null end)::text as motivo,
             (case when m.status = 'rejected' then null
                   else (row_number() over (partition by (m.status = 'rejected')
                                            order by m.sort_order, m.created_at, m.id))::integer
              end)::integer as pos
        from app.media_asset m
       where m.draft_id = v_draft
         and m.purge_requested_at is null
    ) x
   order by x.recusada, x.pos, x.created_at, x.id;
end;
$$;

-- 7. Exclusao (§2.3). Trava rascunho antes da foto (ordem de media_issue). Soma photo_rev so em 'deleted'.
--    out_code: deleted | already | not_found. Funciona em qualquer estado da foto.
create or replace function private.media_delete(p_hash text, p_id uuid, p_now timestamptz)
returns table (out_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft uuid;
  v_row app.media_asset;
begin
  if p_hash is null or p_id is null or p_now is null then
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

  select m.* into v_row
    from app.media_asset m
   where m.id = p_id
     and m.draft_id = v_draft
   for update;
  if not found then
    out_code := 'not_found';
    return next;
    return;
  end if;

  if v_row.purge_requested_at is not null then
    out_code := 'already';
    return next;
    return;
  end if;

  update app.media_asset m
     set purge_requested_at = p_now
   where m.id = v_row.id;

  update app.request_draft r
     set photo_rev = r.photo_rev + 1,
         updated_at = p_now
   where r.id = v_draft;

  out_code := 'deleted';
  return next;
end;
$$;

-- 8. Reordenacao (§2.4). Comparar e trocar: a sequencia viva (sem marcadas, sem recusadas) precisa ser igual a
--    p_current. Renumera 1..N numa so instrucao, sob a trava do rascunho, e soma photo_rev.
--    out_code: ok | unchanged | changed | invalid | not_found.
create or replace function private.media_reorder(
  p_hash text,
  p_current uuid[],
  p_new uuid[],
  p_now timestamptz)
returns table (out_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft uuid;
  v_viva uuid[];
  v_n integer;
begin
  if p_hash is null or p_now is null then
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

  v_n := coalesce(cardinality(p_new), 0);
  if v_n = 0 or p_current is null or cardinality(p_current) <> v_n
     or (select count(distinct x) from unnest(p_new) x) <> v_n
     or (select count(distinct x) from unnest(p_current) x) <> v_n
     or (select array_agg(x order by x) from unnest(p_new) x) is distinct from
        (select array_agg(x order by x) from unnest(p_current) x) then
    out_code := 'invalid';
    return next;
    return;
  end if;

  select array_agg(m.id order by m.sort_order, m.created_at, m.id) into v_viva
    from app.media_asset m
   where m.draft_id = v_draft
     and m.purge_requested_at is null
     and m.status <> 'rejected';

  if v_viva is distinct from p_current then
    out_code := 'changed';
    return next;
    return;
  end if;

  if p_new = p_current then
    out_code := 'unchanged';
    return next;
    return;
  end if;

  update app.media_asset m
     set sort_order = t.pos
    from unnest(p_new) with ordinality as t(id, pos)
   where m.id = t.id
     and m.draft_id = v_draft;

  update app.request_draft r
     set photo_rev = r.photo_rev + 1,
         updated_at = p_now
   where r.id = v_draft;

  out_code := 'ok';
  return next;
end;
$$;

-- 9. Leitura da versao reduzida (§2.2). So foto do dono, viva e 'ready'. Zero linhas = 404 uniforme.
create or replace function private.media_read_target(p_hash text, p_id uuid, p_now timestamptz)
returns table (out_bytes integer)
language sql
stable
security definer
set search_path = ''
as $$
  select m.ready_bytes
    from app.media_asset m
    join app.request_draft r on r.id = m.draft_id
   where m.id = p_id
     and m.purge_requested_at is null
     and m.status = 'ready'
     and r.browser_nonce_hash = p_hash
     and r.status in ('aberto', 'aguardando_email')
     and r.expires_at > p_now
$$;

-- Privilegios: nenhuma funcao para PUBLIC, anon, authenticated, service_role, app_system ou leitor de backup;
-- execute so para app_api. O gatilho de ordem nao tem execute para ninguem (so o gatilho o chama).
revoke all on function
  private.media_asset_ordem(),
  private.draft_confirmation_guard(),
  private.media_list(text, timestamptz),
  private.media_delete(text, uuid, timestamptz),
  private.media_reorder(text, uuid[], uuid[], timestamptz),
  private.media_read_target(text, uuid, timestamptz)
  from public, anon, authenticated, service_role, app_system, app_backup_reader;

grant execute on function
  private.media_list(text, timestamptz),
  private.media_delete(text, uuid, timestamptz),
  private.media_reorder(text, uuid[], uuid[], timestamptz),
  private.media_read_target(text, uuid, timestamptz)
  to app_api;
