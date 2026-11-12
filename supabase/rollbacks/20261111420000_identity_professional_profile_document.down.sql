-- Desfaz 20261111420000_identity_professional_profile_document.sql (H-035). EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento. Remove os indices, os CHECKs e as colunas do documento e o tipo de evento.
-- Protecao: recusa executar se ja houver documento cifrado gravado (apagar as colunas seria perda de dados).
-- Nesse caso, a retirada dos documentos e decisao humana separada (titular, 09 §7), nao deste rollback.
begin;
do $$
begin
  if exists (select 1 from app.professional_profile where document_enc is not null) then
    raise exception 'rollback_bloqueado_ha_documentos_cifrados' using errcode = 'P0001';
  end if;
end
$$;

drop function if exists private.professional_profile_set_document(uuid, text, text, text, bytea, text, timestamptz);
drop trigger if exists professional_profile_guard_update on app.professional_profile;
drop function if exists private.professional_profile_guard_update();
revoke update (public_name, slug, document_type, document_enc, document_hmac, verification_status, updated_at)
  on app.professional_profile from app_system;

drop index if exists app.professional_profile_document_hmac_vivo_key;
drop index if exists app.professional_profile_slug_key;

alter table app.professional_profile drop constraint if exists professional_profile_slug_formato;
alter table app.professional_profile drop constraint if exists professional_profile_cadastro_junto;
alter table app.professional_profile drop constraint if exists professional_profile_nome_publico_formato;
alter table app.professional_profile drop constraint if exists professional_profile_documento_hmac_formato;
alter table app.professional_profile drop constraint if exists professional_profile_documento_completo;
alter table app.professional_profile drop constraint if exists professional_profile_documento_tipo;

alter table app.professional_profile drop column if exists document_hmac;
alter table app.professional_profile drop column if exists document_enc;
alter table app.professional_profile drop column if exists document_type;
alter table app.professional_profile drop column if exists slug;
alter table app.professional_profile drop column if exists public_name;

delete from audit.action_catalog where action = 'professional.document_duplicate';
delete from ops.schema_migration where version = '20261111420000';
commit;
