-- H-035 | Cadastro profissional com CPF/CNPJ cifrado (docs/factory/75-DESENHO-H035.md §1, §2; CA-05, CA-06,
-- CA-08, CA-11). Idempotente. Desfazer: supabase/rollbacks/20261111420000_identity_professional_profile_document.down.sql.
-- Expand: so acrescenta colunas, CHECKs, indice e tipo de evento. Nao remove nem altera coluna existente.
-- Colunas nulas: perfis criados pela H-016 existem sem documento. Nenhuma coluna guarda o numero em claro:
-- document_enc e o blob cifrado (feito pela API) e document_hmac e o identificador de unicidade.
-- Nota: as grants de escrita dos campos novos e o caminho de retida_duplicidade ficam para a funcao de
-- gravacao (pendencia registrada no desenho); esta migracao nao altera privilegios.

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

-- Nome publico e slug entram junto com o documento, e o nome vem sem espacos nas bordas (D7: 2 a 80).
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
-- Slug unico entre perfis que o tem (colisao: o adaptador acrescenta sufixo curto, desenho §1).
create unique index if not exists professional_profile_slug_key
  on app.professional_profile (slug)
  where slug is not null;

-- Unicidade do documento entre perfis vivos. Ficam de fora:
--   recusada: o documento volta a valer para outro cadastro (CA-06);
--   retida_duplicidade: o perfil retido tem o mesmo HMAC do perfil original e nao pode bloquea-lo (desenho §1).
-- Assim a unicidade vale entre pendente, em_revisao, aprovada e suspensa.
create unique index if not exists professional_profile_document_hmac_vivo_key
  on app.professional_profile (document_hmac)
  where document_hmac is not null
    and verification_status not in ('recusada', 'retida_duplicidade');

-- 4. Tipo de evento de auditoria (75 §1, D6: sem PII, so ids) -------------------------------------------
-- Evento interno da duplicidade. Nunca e devolvido ao profissional. Catalogo de 20261110140000.
insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('professional.document_duplicate', 'professional_profile', false,
   array['verification_status', 'user_id_existente'],
   'Documento ja usado em outro perfil nao recusado: novo perfil retido por duplicidade')
on conflict (action) do nothing;
