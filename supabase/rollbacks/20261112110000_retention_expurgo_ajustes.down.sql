-- Desfaz 20261112110000_retention_expurgo_ajustes: volta as versoes de 20261111470000 (guarda e RC-02) e de
-- 20261111420000 (cadastro_junto antigo e set_document). Dev somente. Recusa se ja houve expurgo: restaurar a
-- regra antiga com perfil expurgado (nome sem documento) violaria o cadastro.

do $$
begin
  if exists (select 1 from app.professional_profile where retention_state is not null)
     or exists (select 1 from app.app_user where retention_state is not null) then
    raise exception 'rollback_recusado_ha_expurgo' using errcode = '55000';
  end if;
end
$$;

-- Regra antiga de cadastro (420000).
alter table app.professional_profile drop constraint if exists professional_profile_cadastro_junto;
alter table app.professional_profile add constraint professional_profile_cadastro_junto
  check ((public_name is null) = (document_type is null)
     and (slug is null) = (document_type is null));

-- Guarda da 470000.
create or replace function private.professional_profile_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Excecao estreita do expurgo (H-109, 82 §3): so a passagem expurgando -> expurgado, com os tres campos
  -- do documento nulos, pode trocar o documento. Public_name e slug continuam protegidos.
  if old.document_hmac is not null and (
       new.public_name is distinct from old.public_name
    or new.slug is distinct from old.slug
    or (not (old.retention_state = 'expurgando' and new.retention_state = 'expurgado'
             and new.document_type is null and new.document_enc is null and new.document_hmac is null)
        and (new.document_type is distinct from old.document_type
          or new.document_enc is distinct from old.document_enc
          or new.document_hmac is distinct from old.document_hmac))) then
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
    ) then
      raise exception 'professional_status_protegido' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- set_document da 420000 (sem a checagem de retention_state).
create or replace function private.professional_profile_set_document(
  p_user_id uuid,
  p_public_name text,
  p_slug text,
  p_document_type text,
  p_document_enc bytea,
  p_document_hmac text,
  p_now timestamptz)
returns table (out_resultado text)
language plpgsql
set search_path = ''
as $$
declare
  v_tipo text;
  v_status text;
  v_duplicado boolean;
  v_restricao text;
begin
  if p_user_id is null or p_public_name is null or p_slug is null or p_document_type is null
     or p_document_enc is null or p_document_hmac is null or p_now is null then
    raise exception 'professional_entrada_invalida' using errcode = '22023';
  end if;

  select p.document_type, p.verification_status
    into v_tipo, v_status
    from app.professional_profile p
   where p.user_id = p_user_id
     for update;
  if not found then
    return query select 'sem_perfil'::text;
    return;
  end if;
  if v_tipo is not null then
    return query select 'ja_cadastrado'::text;
    return;
  end if;

  select exists (
    select 1
      from app.professional_profile o
     where o.document_hmac = p_document_hmac
       and o.user_id <> p_user_id
       and o.verification_status <> 'recusada')
    into v_duplicado;
  v_status := case when v_duplicado then 'retida_duplicidade' else 'pendente' end;

  begin
    update app.professional_profile
       set public_name = p_public_name,
           slug = p_slug,
           document_type = p_document_type,
           document_enc = p_document_enc,
           document_hmac = p_document_hmac,
           verification_status = v_status,
           updated_at = p_now
     where user_id = p_user_id;
  exception when unique_violation then
    get stacked diagnostics v_restricao = constraint_name;
    if v_restricao <> 'professional_profile_document_hmac_vivo_key' then
      raise;
    end if;
    v_status := 'retida_duplicidade';
    update app.professional_profile
       set public_name = p_public_name,
           slug = p_slug,
           document_type = p_document_type,
           document_enc = p_document_enc,
           document_hmac = p_document_hmac,
           verification_status = v_status,
           updated_at = p_now
     where user_id = p_user_id;
  end;

  return query select v_status;
end;
$$;

revoke all on function
  private.professional_profile_guard_update(),
  private.professional_profile_set_document(uuid, text, text, text, bytea, text, timestamptz)
from public, anon, authenticated, service_role;

grant execute on function
  private.professional_profile_set_document(uuid, text, text, text, bytea, text, timestamptz)
to app_system;

-- finalize_rc02 da 470000 (sem email_hmac = null).
create or replace function private.retention_finalize_rc02(p_policy uuid, p_subject uuid, p_now timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  select u.retention_state into v_state from app.app_user u where u.id = p_subject for update;
  if not found or v_state is distinct from 'expurgando' then
    return 'ignorado';
  end if;
  if exists (select 1 from app.retention_object_queue q
              where q.policy_id = p_policy and q.subject_id = p_subject and q.state <> 'removido') then
    return 'falhou';
  end if;
  if exists (select 1 from app.legal_hold h
              where h.subject_type = 'user' and h.subject_id = p_subject and h.released_at is null) then
    update app.app_user set retention_state = null where id = p_subject;
    return 'suspenso';
  end if;
  update app.app_user
     set email = 'anon.' || replace(p_subject::text, '-', '') || '@anonimizado.invalid',
         anonymized_at = p_now, retention_state = 'expurgado'
   where id = p_subject;
  return 'processado';
end
$$;

revoke all on function private.retention_finalize_rc02(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role, app_api;
