-- Desfaz 20261112130000_draft_expand_identity_attach.sql (H-013, Issue #26). EXECUCAO MANUAL e consciente: so em
-- banco de desenvolvimento. Remove as funcoes novas, as restricoes e as quatro colunas de identificacao do
-- rascunho (e-mail, nome e confirmacao: descartaveis por natureza, §2.1). Nenhum dado de outra coluna e tocado.
-- As funcoes antigas (consume_link, auth_code_attempt, draft_*) nao sao alteradas. Idempotente (if exists).
begin;

drop function if exists private.draft_identity_set(text, timestamptz, text, text, text);
drop function if exists private.draft_identity_get(text, timestamptz);
drop function if exists private.auth_challenge_consume_link_attach(text, timestamptz, text);
drop function if exists private.auth_code_attempt_attach(uuid, text, text, text, integer, timestamptz, text, text, integer, integer, text);
drop function if exists private.draft_attach_challenge(uuid, text, timestamptz);
drop function if exists private.draft_bind_challenge(uuid, text, timestamptz);

alter table app.request_draft drop constraint if exists request_draft_verificado_com_email;
alter table app.request_draft drop constraint if exists request_draft_email_par;
alter table app.request_draft drop constraint if exists request_draft_email_hmac_formato;
alter table app.request_draft drop constraint if exists request_draft_email_normalizado;
alter table app.request_draft drop constraint if exists request_draft_first_name_tamanho;

alter table app.request_draft
  drop column if exists email_verified_at,
  drop column if exists email_hmac,
  drop column if exists email,
  drop column if exists first_name;

delete from ops.schema_migration where version = '20261112130000';

commit;
