-- Galeria de fotos do profissional (pedido do dono, 2026-11-27): ate 30 fotos, enviadas pelo proprio profissional e
-- vistas no perfil publico. Arquivo no bucket privado professional-gallery (chave <id>.jpg), sem politica de acesso
-- direto: so a API le e grava. Tabela fechada; tudo passa por funcoes security definer do papel app_system.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('professional-gallery', 'professional-gallery', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

create table if not exists app.professional_photo (
  id              uuid primary key,
  professional_id uuid not null references app.professional_profile (user_id) on delete restrict,
  width           integer not null check (width between 1 and 4000),
  height          integer not null check (height between 1 and 4000),
  bytes           integer not null check (bytes between 1 and 2097152),
  created_at      timestamptz not null
);

create index if not exists professional_photo_dono_idx on app.professional_photo (professional_id, created_at desc);

alter table app.professional_photo enable row level security;
alter table app.professional_photo force row level security;
revoke all on table app.professional_photo from public, anon, authenticated, service_role, app_api, app_backup_reader, app_system;

create or replace function private.professional_photo_add(
  p_user uuid, p_id uuid, p_width integer, p_height integer, p_bytes integer, p_now timestamptz)
returns table (out_code text)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
begin
  if p_user is null or p_id is null or p_now is null then
    raise exception 'galeria_entrada_invalida' using errcode = '22023';
  end if;
  if not exists (select 1 from app.professional_profile p
                   join app.app_user u on u.id = p.user_id
                  where p.user_id = p_user and u.status = 'ativo') then
    return query select 'sem_perfil'::text;
    return;
  end if;
  if exists (select 1 from app.professional_profile p where p.user_id = p_user and p.suspended_at is not null) then
    return query select 'suspenso'::text;
    return;
  end if;
  -- Serializa os envios do mesmo profissional para o limite nao ser ultrapassado.
  perform pg_advisory_xact_lock(hashtext('professional_photo:' || p_user::text));
  if (select count(*) from app.professional_photo f where f.professional_id = p_user) >= 30 then
    return query select 'limite'::text;
    return;
  end if;
  insert into app.professional_photo (id, professional_id, width, height, bytes, created_at)
  values (p_id, p_user, p_width, p_height, p_bytes, p_now);
  return query select 'ok'::text;
end
$$;

create or replace function private.professional_photo_list(p_user uuid)
returns table (out_id uuid, out_width integer, out_height integer, out_created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.width, f.height, f.created_at
    from app.professional_photo f
   where f.professional_id = p_user
   order by f.created_at desc, f.id
$$;

create or replace function private.professional_photo_delete(p_user uuid, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from app.professional_photo f where f.id = p_id and f.professional_id = p_user;
  return found;
end
$$;

-- Perfil publico: so profissional visivel (mesma regra das avaliacoes publicas).
create or replace function private.professional_photo_public_list(p_slug text)
returns table (out_id uuid, out_width integer, out_height integer)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.width, f.height
    from app.professional_photo f
   where f.professional_id = private.professional_visible_user_by_slug(p_slug)
   order by f.created_at desc, f.id
$$;

revoke all on function private.professional_photo_add(uuid, uuid, integer, integer, integer, timestamptz) from public, anon, authenticated, service_role, app_api;
revoke all on function private.professional_photo_list(uuid) from public, anon, authenticated, service_role, app_api;
revoke all on function private.professional_photo_delete(uuid, uuid) from public, anon, authenticated, service_role, app_api;
revoke all on function private.professional_photo_public_list(text) from public, anon, authenticated, service_role, app_api;
grant execute on function private.professional_photo_add(uuid, uuid, integer, integer, integer, timestamptz) to app_system;
grant execute on function private.professional_photo_list(uuid) to app_system;
grant execute on function private.professional_photo_delete(uuid, uuid) to app_system;
grant execute on function private.professional_photo_public_list(text) to app_system;
