-- H-035 | Cadastro profissional com CPF/CNPJ cifrado (docs/factory/75-DESENHO-H035.md §1, §2, §4; decisao 54 em
-- 11-DECISOES.md; CA-05, CA-06, CA-08, CA-11). Idempotente. Desfazer: supabase/rollbacks/20261111420000_identity_professional_profile_document.down.sql.
-- Expand: so acrescenta colunas, CHECKs, indices, gatilho, funcao e tipo de evento. Nao remove coluna existente.
-- Colunas nulas: perfis criados pela H-016 existem sem documento. Nenhuma coluna guarda o numero em claro:
-- document_enc e o blob cifrado (feito pela API) e document_hmac e o identificador de unicidade.
-- Protecao de status e documento (decisao 54): app_system altera verification_status so no primeiro cadastro
-- do documento (pendente -> pendente ou retida_duplicidade) e os campos do documento sao write-once. Isso e
-- imposto por gatilho no banco, nao so por convencao. Nenhuma funcao usa security definer.

-- 1. Colunas novas do perfil ---------------------------------------------------------------------------
alter table app.professional_profile add column if not exists public_name text;
alter table app.professional_profile add column if not exists slug text;
alter table app.professional_profile add column if not exists document_type text;
alter table app.professional_profile add column if not exists document_enc bytea;
alter table app.professional_profile add column if not exists document_hmac text;

-- 2. CHECKs ---------------------------------------------------------------------------------------------
-- Tipo: so CPF ou CNPJ (D2: CNPJ alfanumerico fica fora por enquanto).
alter table app.professional_profile drop constraint if exists professional_profile_documento_tipo;
alter table app.professional_profile add constraint professional_profile_documento_tipo
  check (document_type is null or document_type in ('CPF', 'CNPJ'));

-- Os tres campos do documento: todos nulos ou todos preenchidos (desenho §1).
alter table app.professional_profile drop constraint if exists professional_profile_documento_completo;
alter table app.professional_profile add constraint professional_profile_documento_completo
  check ((document_type is null and document_enc is null and document_hmac is null)
      or (document_type is not null and document_enc is not null and document_hmac is not null));

-- HMAC-SHA-256 em hexadecimal (64 caracteres minusculos).
alter table app.professional_profile drop constraint if exists professional_profile_documento_hmac_formato;
alter table app.professional_profile add constraint professional_profile_documento_hmac_formato
  check (document_hmac is null or document_hmac ~ '^[0-9a-f]{64}$');

-- Nome publico e slug entram junto com o documento; o nome vem sem espacos nas bordas (D7: 2 a 80).
alter table app.professional_profile drop constraint if exists professional_profile_nome_publico_formato;
alter table app.professional_profile add constraint professional_profile_nome_publico_formato
  check (public_name is null
      or (char_length(public_name) between 2 and 80 and public_name = btrim(public_name)));
alter table app.professional_profile drop constraint if exists professional_profile_cadastro_junto;
alter table app.professional_profile add constraint professional_profile_cadastro_junto
  check ((public_name is null) = (document_type is null)
     and (slug is null) = (document_type is null));
alter table app.professional_profile drop constraint if exists professional_profile_slug_formato;
alter table app.professional_profile add constraint professional_profile_slug_formato
  check (slug is null or slug ~ '^[a-z0-9][a-z0-9-]{0,99}$');

-- 3. Indices unicos parciais ----------------------------------------------------------------------------
-- Slug unico entre perfis que o tem (colisao: a funcao devolve o erro e o adaptador acrescenta sufixo).
create unique index if not exists professional_profile_slug_key
  on app.professional_profile (slug)
  where slug is not null;

-- Unicidade do documento entre perfis vivos. Ficam de fora:
--   recusada: o documento volta a valer para outro cadastro (CA-06);
--   retida_duplicidade: o perfil retido tem o mesmo HMAC do perfil original e nao pode bloquea-lo (desenho §1).
create unique index if not exists professional_profile_document_hmac_vivo_key
  on app.professional_profile (document_hmac)
  where document_hmac is not null
    and verification_status not in ('recusada', 'retida_duplicidade');

-- 4. Tipo de evento de auditoria (75 §1, D6: sem PII, so ids) -------------------------------------------
insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('professional.document_duplicate', 'professional_profile', false,
   array['verification_status', 'user_id_existente'],
   'Documento ja usado em outro perfil nao recusado: novo perfil retido por duplicidade')
on conflict (action) do nothing;

-- 5. Gatilho de protecao (decisao 54) ---------------------------------------------------------------------
-- (a) Campos do documento sao write-once: depois de gravados, nenhum deles muda.
-- (b) verification_status so muda no primeiro cadastro do documento: de pendente para pendente ou
--     retida_duplicidade, com o HMAC preenchido na mesma atualizacao. Qualquer outra mudanca de status e recusada
--     (inclui aprovada, em_revisao, recusada e suspensa; essas transicoes sao da decisao de H-039/H-040).
create or replace function private.professional_profile_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.document_hmac is not null and (
       new.public_name is distinct from old.public_name
    or new.slug is distinct from old.slug
    or new.document_type is distinct from old.document_type
    or new.document_enc is distinct from old.document_enc
    or new.document_hmac is distinct from old.document_hmac) then
    raise exception 'professional_documento_imutavel' using errcode = '42501';
  end if;

  if new.verification_status is distinct from old.verification_status then
    if not (old.document_hmac is null
            and old.verification_status = 'pendente'
            and new.verification_status in ('pendente', 'retida_duplicidade')
            and new.document_hmac is not null) then
      raise exception 'professional_status_protegido' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists professional_profile_guard_update on app.professional_profile;
create trigger professional_profile_guard_update
  before update on app.professional_profile
  for each row execute function private.professional_profile_guard_update();
alter table app.professional_profile enable always trigger professional_profile_guard_update;

-- Privilegios de escrita por coluna para app_system. user_id e created_at ficam de fora.
grant update (public_name, slug, document_type, document_enc, document_hmac, verification_status, updated_at)
  on app.professional_profile to app_system;

-- 6. Funcao de gravacao do documento (desenho §2 item 4). Sem security definer: roda com o papel que chama.
-- resultado: pendente | retida_duplicidade | ja_cadastrado | sem_perfil.
-- O numero nunca chega aqui em claro: a API manda o blob cifrado e o HMAC.
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

  -- Trava a linha do perfil: dois envios do mesmo usuario nao passam juntos (CA-11).
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
