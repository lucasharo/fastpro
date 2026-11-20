-- H-056 (Issue #69) | Fotos elegiveis com marca d'agua: funcoes de acesso as fotos do pedido
-- (docs/factory/167-DESENHO-H056.md, §3 e decisoes A-1 a A-3; fatia 1).
-- Cria a regra unica de acesso do profissional (private.request_photo_access), a lista e o alvo de entrega
-- do profissional e do dono. Nenhuma funcao escreve; nenhuma tabela, coluna, politica, cron ou grant de tabela muda.
-- Negacao nunca levanta excecao: nulo, UUID ausente ou acesso negado devolvem zero linhas ou false.
-- Idempotente (create or replace). Desfazer: supabase/rollbacks/20261120500000_media_create_request_photo_view_access.down.sql.

-- 0. Pre-requisitos: falha com mensagem clara se a base nao estiver aplicada.
do $$
begin
  if to_regprocedure('private.professional_access_guard(uuid,text,timestamptz)') is null
     or to_regprocedure('private.request_detail_professional(uuid,uuid,timestamptz)') is null
     or to_regprocedure('private.request_acceptance_active(uuid,uuid)') is null
     or to_regclass('app.media_asset') is null
     or to_regclass('app.service_request') is null
     or to_regclass('app.acceptance') is null then
    raise exception 'h056_fotos_pre_requisito_ausente' using errcode = '42P01';
  end if;
end
$$;

-- 1. Pedido visivel ao profissional (A-1). (i) Participante com aceite ativo: pedido publicado ou selecionado e
--    guarda 'participacao' (acesso vale mesmo depois do prazo). (ii) Aceite retirado ou removido: negado (S8).
--    (iii) Sem aceite: mesma regra de "antes do aceite" de private.request_detail_professional (guarda
--    'descoberta_aceite', status publicado, prazo aberto, casamento de servico e raio).
create or replace function private.request_photo_pedido_acesso(
  p_request_id uuid,
  p_professional_id uuid,
  p_now timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  v_status text;
begin
  if p_request_id is null or p_professional_id is null or p_now is null then
    return false;
  end if;

  if private.request_acceptance_active(p_request_id, p_professional_id) then
    select r.status::text into v_status
      from app.service_request r
     where r.id = p_request_id;
    if v_status is null or v_status not in ('publicado', 'selecionado') then
      return false;
    end if;
    return private.professional_access_guard(p_professional_id, 'participacao', p_now);
  end if;

  if exists (
    select 1 from app.acceptance a
     where a.request_id = p_request_id
       and a.professional_id = p_professional_id
  ) then
    return false;
  end if;

  return exists (
    select 1 from private.request_detail_professional(p_professional_id, p_request_id, p_now)
  );
end
$$;

-- 2. Acesso do profissional a uma foto (ou so ao pedido, quando p_photo_id e nulo: usado pela lista).
--    A foto precisa ser deste pedido, estar pronta e nao marcada para expurgo (A-2; S10).
create or replace function private.request_photo_access(
  p_request_id uuid,
  p_professional_id uuid,
  p_photo_id uuid,
  p_now timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
begin
  if not private.request_photo_pedido_acesso(p_request_id, p_professional_id, p_now) then
    return false;
  end if;
  if p_photo_id is null then
    return true;
  end if;
  return exists (
    select 1 from app.media_asset m
     where m.id = p_photo_id
       and m.request_id = p_request_id
       and m.status = 'ready'
       and m.purge_requested_at is null
  );
end
$$;

-- 3. Linhas da lista de fotos prontas de um pedido (sem checar acesso; so chamada pelas funcoes de lista).
--    Pedido sem foto pronta = uma linha com out_id nulo. Posicao 1..n por sort_order, created_at, id.
create or replace function private.request_photo_rows(p_request_id uuid)
returns table (out_id uuid, out_pos integer, out_width smallint, out_height smallint)
language plpgsql
stable
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
begin
  if p_request_id is null then
    return;
  end if;
  if not exists (
    select 1 from app.media_asset m
     where m.request_id = p_request_id
       and m.status = 'ready'
       and m.purge_requested_at is null
  ) then
    out_id := null; out_pos := null; out_width := null; out_height := null;
    return next;
    return;
  end if;
  return query
    select x.id, x.pos::integer, x.w::smallint, x.h::smallint
      from (
        select m.id,
               row_number() over (order by m.sort_order, m.created_at, m.id) as pos,
               m.ready_width as w,
               m.ready_height as h
          from app.media_asset m
         where m.request_id = p_request_id
           and m.status = 'ready'
           and m.purge_requested_at is null
      ) x
     order by x.pos;
end
$$;

-- 4. Lista de fotos do profissional. Zero linhas = negado (o chamador responde 404 uniforme).
create or replace function private.request_photo_list(
  p_professional_id uuid,
  p_request_id uuid,
  p_now timestamptz)
returns table (out_id uuid, out_pos integer, out_width smallint, out_height smallint)
language plpgsql
stable
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
begin
  if not private.request_photo_access(p_request_id, p_professional_id, null, p_now) then
    return;
  end if;
  return query select x.out_id, x.out_pos, x.out_width, x.out_height from private.request_photo_rows(p_request_id) x;
end
$$;

-- 5. Dados de entrega de uma foto do profissional: bytes e dimensoes declaradas (ready_*), para a
--    conferencia da leitura (fotoReduzidaValida). Zero linhas = negado.
create or replace function private.request_photo_target(
  p_professional_id uuid,
  p_request_id uuid,
  p_photo_id uuid,
  p_now timestamptz)
returns table (out_bytes integer, out_width smallint, out_height smallint)
language plpgsql
stable
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
begin
  if not private.request_photo_access(p_request_id, p_professional_id, p_photo_id, p_now) then
    return;
  end if;
  return query
    select m.ready_bytes::integer, m.ready_width::smallint, m.ready_height::smallint
      from app.media_asset m
     where m.id = p_photo_id
       and m.request_id = p_request_id
       and m.status = 'ready'
       and m.purge_requested_at is null;
end
$$;

-- 6. Lista de fotos do dono (cliente que publicou o pedido). Sem guarda comercial; qualquer status do pedido.
create or replace function private.request_photo_owner_list(p_customer_id uuid, p_request_id uuid)
returns table (out_id uuid, out_pos integer, out_width smallint, out_height smallint)
language plpgsql
stable
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
begin
  if p_customer_id is null or p_request_id is null then
    return;
  end if;
  if not exists (
    select 1 from app.service_request r
     where r.id = p_request_id
       and r.customer_user_id = p_customer_id
  ) then
    return;
  end if;
  return query select x.out_id, x.out_pos, x.out_width, x.out_height from private.request_photo_rows(p_request_id) x;
end
$$;

-- 7. Dados de entrega de uma foto do dono. Zero linhas = nao e dono, foto ausente, fora do pedido ou expurgada.
create or replace function private.request_photo_owner_target(
  p_customer_id uuid,
  p_request_id uuid,
  p_photo_id uuid)
returns table (out_bytes integer, out_width smallint, out_height smallint)
language plpgsql
stable
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
begin
  if p_customer_id is null or p_request_id is null or p_photo_id is null then
    return;
  end if;
  if not exists (
    select 1 from app.service_request r
     where r.id = p_request_id
       and r.customer_user_id = p_customer_id
  ) then
    return;
  end if;
  return query
    select m.ready_bytes::integer, m.ready_width::smallint, m.ready_height::smallint
      from app.media_asset m
     where m.id = p_photo_id
       and m.request_id = p_request_id
       and m.status = 'ready'
       and m.purge_requested_at is null;
end
$$;

-- Privilegios: so app_system executa; demais papeis (inclusive PUBLIC) nao. As auxiliares ficam fechadas
-- (chamadas apenas pelas funcoes acima, que rodam com o dono).
revoke all on function private.request_photo_pedido_acesso(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.request_photo_access(uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.request_photo_rows(uuid)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.request_photo_list(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.request_photo_target(uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.request_photo_owner_list(uuid, uuid)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.request_photo_owner_target(uuid, uuid, uuid)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;

grant execute on function private.request_photo_list(uuid, uuid, timestamptz) to app_system;
grant execute on function private.request_photo_target(uuid, uuid, uuid, timestamptz) to app_system;
grant execute on function private.request_photo_owner_list(uuid, uuid) to app_system;
grant execute on function private.request_photo_owner_target(uuid, uuid, uuid) to app_system;
