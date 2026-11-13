-- Desfaz 20261112190000_media_expand_photo_order.sql (H-029, Issue #42). EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento. Restaura o guarda de confirmacao da 20261112150000 (copia literal),
-- remove as funcoes, o gatilho, o indice, as colunas sort_order e photo_rev e a linha do ledger.
-- Perde-se so a ordem escolhida pelo cliente (as fotos ficam, na ordem de criacao) e o contador de revisao.
-- Idempotente (if exists). Nao toca nenhuma funcao de H-026, H-027, H-030 nem H-036.
begin;

-- 1. Guarda de confirmacao volta ao corpo da 20261112150000 (sem photo_rev).
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
    (old.service_id, old.address_text, old.urgency, old.description, old.first_name, old.email, old.email_verified_at);

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

-- 2. Funcoes novas, gatilho e indice.
drop function if exists private.media_read_target(text, uuid, timestamptz);
drop function if exists private.media_reorder(text, uuid[], uuid[], timestamptz);
drop function if exists private.media_delete(text, uuid, timestamptz);
drop function if exists private.media_list(text, timestamptz);
drop trigger if exists media_asset_ordem on app.media_asset;
drop function if exists private.media_asset_ordem();
drop index if exists app.media_asset_ordem_vivo_idx;

-- 3. Colunas e restricoes novas.
alter table app.request_draft drop constraint if exists request_draft_photo_rev_nao_negativo;
alter table app.request_draft drop column if exists photo_rev;

alter table app.media_asset drop constraint if exists media_asset_sort_order_ck;
alter table app.media_asset drop column if exists sort_order;

delete from ops.schema_migration where version = '20261112190000';

commit;
