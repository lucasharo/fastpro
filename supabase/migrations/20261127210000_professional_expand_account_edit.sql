-- Edicao dos dados pelo profissional (pedido do dono, 2026-11-27): nome publico, biografia e foto de perfil.
-- O nome publico e o nome de exibicao (ex.: "Seu Ze Pedreiro"): a troca nao mexe na verificacao nem no endereco do
-- perfil. Documento (tipo, cifra e HMAC) e slug continuam imutaveis. Foto no bucket privado professional-gallery.

alter table app.professional_profile add column if not exists bio text;
alter table app.professional_profile add column if not exists photo_id uuid;
alter table app.professional_profile drop constraint if exists professional_profile_bio_formato;
alter table app.professional_profile add constraint professional_profile_bio_formato
  check (bio is null or (char_length(bio) between 1 and 500 and bio = btrim(bio)));

create or replace function private.professional_profile_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.document_hmac is not null and (
       new.slug is distinct from old.slug
    or new.document_type is distinct from old.document_type
    or new.document_enc is distinct from old.document_enc
    or new.document_hmac is distinct from old.document_hmac) then
    raise exception 'professional_documento_imutavel' using errcode = '42501';
  end if;

  if new.verification_status is distinct from old.verification_status then
    if not (
         (old.document_hmac is null
          and old.verification_status = 'pendente'
          and new.verification_status in ('pendente', 'retida_duplicidade')
          and new.document_hmac is not null)
      or (new.verification_status = 'suspensa'
          and old.verification_status <> 'suspensa'
          and new.suspended_at is not null
          and exists (
            select 1 from app.approval_request r
             where r.action_type = 'suspensao_permanente'
               and r.subject_ref = new.user_id
               and r.status = 'consumida'
               and r.consumed_at = new.suspended_at))
      or (new.verification_status in ('em_revisao', 'aprovada', 'recusada', 'retida_duplicidade')
          and old.verification_status in ('pendente', 'em_revisao', 'retida_duplicidade', 'recusada')
          and private.verification_case_mirrors(new.user_id, new.verification_status, new.updated_at))
      or (new.verification_status = 'pendente'
          and old.verification_status = 'recusada'
          and private.verification_case_mirrors(new.user_id, new.verification_status, new.updated_at))
    ) then
      raise exception 'professional_status_protegido' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create or replace function private.professional_account_get(p_user uuid)
returns table (out_public_name text, out_bio text, out_photo_id uuid, out_email text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.public_name, p.bio, p.photo_id, u.email
    from app.professional_profile p
    join app.app_user u on u.id = p.user_id
   where p.user_id = p_user
$$;

-- Nome so muda depois de existir (ele nasce junto do documento); biografia vazia apaga.
create or replace function private.professional_account_save(p_user uuid, p_public_name text, p_bio text, p_now timestamptz)
returns table (out_code text)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  v_atual app.professional_profile%rowtype;
  v_nome text := nullif(btrim(coalesce(p_public_name, '')), '');
  v_bio text := nullif(btrim(coalesce(p_bio, '')), '');
begin
  if p_user is null or p_now is null then
    raise exception 'perfil_entrada_invalida' using errcode = '22023';
  end if;
  select p.* into v_atual
    from app.professional_profile p
    join app.app_user u on u.id = p.user_id and u.status = 'ativo'
   where p.user_id = p_user
     for update of p;
  if not found then
    return query select 'sem_perfil'::text;
    return;
  end if;
  if v_atual.suspended_at is not null then
    return query select 'suspenso'::text;
    return;
  end if;
  if v_nome is not null and v_atual.public_name is null then
    return query select 'nome_sem_documento'::text;
    return;
  end if;
  if (v_nome is not null and char_length(v_nome) not between 2 and 80) or char_length(coalesce(v_bio, '')) > 500 then
    return query select 'invalido'::text;
    return;
  end if;
  update app.professional_profile p
     set public_name = coalesce(v_nome, p.public_name), bio = v_bio, updated_at = p_now
   where p.user_id = p_user;
  return query select 'ok'::text;
end
$$;

-- Troca (ou remove, com nulo) a foto e devolve a anterior, para o arquivo ser apagado.
create or replace function private.professional_profile_photo_set(p_user uuid, p_photo uuid, p_now timestamptz)
returns table (out_code text, out_previous uuid)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  v_atual app.professional_profile%rowtype;
begin
  if p_user is null or p_now is null then
    raise exception 'perfil_entrada_invalida' using errcode = '22023';
  end if;
  select p.* into v_atual
    from app.professional_profile p
    join app.app_user u on u.id = p.user_id and u.status = 'ativo'
   where p.user_id = p_user
     for update of p;
  if not found then
    return query select 'sem_perfil'::text, null::uuid;
    return;
  end if;
  if v_atual.suspended_at is not null then
    return query select 'suspenso'::text, null::uuid;
    return;
  end if;
  update app.professional_profile p set photo_id = p_photo, updated_at = p_now where p.user_id = p_user;
  return query select 'ok'::text, v_atual.photo_id;
end
$$;

-- Perfil publico: so profissional visivel.
create or replace function private.professional_about_public(p_slug text)
returns table (out_bio text, out_photo_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.bio, p.photo_id
    from app.professional_profile p
   where p.user_id = private.professional_visible_user_by_slug(p_slug)
$$;

-- Conta anonimizada perde biografia e foto.
create or replace function private.professional_about_anonimizar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update app.professional_profile p set bio = null, photo_id = null where p.user_id = new.id;
  return null;
end
$$;

drop trigger if exists professional_about_anonimizar on app.app_user;
create trigger professional_about_anonimizar
  after update of anonymized_at on app.app_user
  for each row when (old.anonymized_at is null and new.anonymized_at is not null)
  execute function private.professional_about_anonimizar();

revoke all on function private.professional_account_get(uuid) from public, anon, authenticated, service_role, app_api;
revoke all on function private.professional_account_save(uuid, text, text, timestamptz) from public, anon, authenticated, service_role, app_api;
revoke all on function private.professional_profile_photo_set(uuid, uuid, timestamptz) from public, anon, authenticated, service_role, app_api;
revoke all on function private.professional_about_public(text) from public, anon, authenticated, service_role, app_api;
revoke all on function private.professional_about_anonimizar() from public, anon, authenticated, service_role, app_api;
grant execute on function private.professional_account_get(uuid) to app_system;
grant execute on function private.professional_account_save(uuid, text, text, timestamptz) to app_system;
grant execute on function private.professional_profile_photo_set(uuid, uuid, timestamptz) to app_system;
grant execute on function private.professional_about_public(text) to app_system;
