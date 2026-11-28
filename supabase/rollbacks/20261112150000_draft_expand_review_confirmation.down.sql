-- Desfaz 20261112150000_draft_expand_review_confirmation.sql (H-030, Issue #43). EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento. Remove o gatilho, as funcoes novas, as restricoes e as colunas
-- confirmed_at e content_rev. Perde-se so a marca de confirmacao e o contador: o cliente reconfirma; o
-- status 'aberto' e o conteudo ficam intactos. Nao toca first_name, email, email_verified_at (#26) nem as
-- funcoes de H-025. Idempotente (if exists).
begin;

drop trigger if exists request_draft_confirmation_guard on app.request_draft;
drop function if exists private.draft_confirmation_guard();
drop function if exists private.draft_confirm(text, timestamptz, integer, integer);
drop function if exists private.draft_review_get(text, timestamptz);

alter table app.request_draft drop constraint if exists request_draft_confirmed_status_check;
alter table app.request_draft drop constraint if exists request_draft_content_rev_nao_negativo;

alter table app.request_draft
  drop column if exists content_rev,
  drop column if exists confirmed_at;

delete from ops.schema_migration where version = '20261112150000';

commit;
