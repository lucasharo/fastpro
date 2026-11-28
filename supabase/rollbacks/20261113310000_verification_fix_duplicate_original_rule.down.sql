-- Desfaz 20261113310000_verification_fix_duplicate_original_rule.sql (Issue 53, H-040).
-- Restaura a checagem de duplicidade de 20261112110000 (status <> 'recusada'), copiada literalmente.
-- Assinatura, grants e search_path iguais. Nao altera cadastros, status nem eventos de auditoria.
-- Execucao manual e consciente, so em banco de desenvolvimento.
begin;

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

delete from ops.schema_migration where version = '20261113310000';

commit;
