-- H-109 (Issue #118) | Ajustes do expurgo (docs/factory/82-DESENHO-H109.md §8, A-6 e A-7; decisao da Arquitetura em 2026-11-12).
-- Idempotente. Desfazer: supabase/rollbacks/20261112110000_retention_expurgo_ajustes.down.sql (dev somente).
-- 1. Regra de cadastro (substitui professional_profile_cadastro_junto): nome e slug vem juntos; com documento,
--    sao obrigatorios; sem documento, so existem depois do expurgo registrado (retention_state = 'expurgado').
-- 2. Guarda de imutabilidade: nome e slug sao write-once tambem depois do expurgo.
-- 3. Reentrada de documento: perfil com retention_state preenchido devolve ja_cadastrado.
-- 4. Anonimizacao do RC-02 limpa email_hmac (sem identificador reutilizavel; o e-mail volta a ser cadastravel).
-- Nenhum prazo nesta migracao (CA-H109-11).

-- 1. Regra de cadastro --------------------------------------------------------------------------------------
alter table app.professional_profile drop constraint if exists professional_profile_cadastro_junto;
alter table app.professional_profile add constraint professional_profile_cadastro_junto
  check ((public_name is null) = (slug is null)
     and (document_type is not null or public_name is null or retention_state is not distinct from 'expurgado')
     and (document_type is null or (public_name is not null and slug is not null)));

-- 2. Guarda de imutabilidade (copia da 470000 com a condicao ampliada para perfil expurgado) -------------
create or replace function private.professional_profile_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Nome e slug sao write-once depois do cadastro com documento e tambem depois do expurgo (82 §8, A-6).
  -- Excecao estreita do documento: so a passagem expurgando -> expurgado, com os tres campos do documento
  -- nulos, pode trocar o documento (82 §3).
  if (old.document_hmac is not null or old.retention_state = 'expurgado') and (
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

-- 3. Gravacao do documento (copia da 420000). Perfil com retention_state preenchido: ja_cadastrado. --------
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
  v_expurgo text;
  v_duplicado boolean;
  v_restricao text;
begin
  if p_user_id is null or p_public_name is null or p_slug is null or p_document_type is null
     or p_document_enc is null or p_document_hmac is null or p_now is null then
    raise exception 'professional_entrada_invalida' using errcode = '22023';
  end if;

  -- Trava a linha do perfil: dois envios do mesmo usuario nao passam juntos (CA-11).
  select p.document_type, p.verification_status, p.retention_state
    into v_tipo, v_status, v_expurgo
    from app.professional_profile p
   where p.user_id = p_user_id
     for update;
  if not found then
    return query select 'sem_perfil'::text;
    return;
  end if;
  -- Perfil com documento, ou expurgado (82 §8, A-6): reabrir o cadastro e decisao de produto, nao deste mecanismo.
  if v_tipo is not null or v_expurgo is not null then
    return query select 'ja_cadastrado'::text;
    return;
  end if;

  -- Duplicidade: outro perfil nao recusado com o mesmo HMAC (R2).
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
      -- Colisao de slug: quem chama acrescenta o sufixo e tenta de novo.
      raise;
    end if;
    -- Corrida: outro cadastro com o mesmo HMAC ganhou o indice depois da checagem. Grava como retido.
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

-- 4. RC-02: anonimiza e tambem limpa email_hmac (copia da 470000 com email_hmac = null) ----------------------
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
  -- email_hmac e determinístico e reutilizavel: sai junto com o e-mail (82 §8, A-7).
  update app.app_user
     set email = 'anon.' || replace(p_subject::text, '-', '') || '@anonimizado.invalid',
         email_hmac = null,
         anonymized_at = p_now, retention_state = 'expurgado'
   where id = p_subject;
  return 'processado';
end
$$;

revoke all on function private.retention_finalize_rc02(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role, app_api;
