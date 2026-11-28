-- H-016 | Expand de app.app_session para o login por senha do profissional (docs/factory/33-DESENHO-H016.md §2.5;
-- docs/factory/67-DESENHO-H016.md §6, item B). Idempotente.
-- Desfazer: supabase/rollbacks/20261111380000_identity_expand_session_password.down.sql.
-- Expand puro: nenhuma coluna e removida e nenhuma linha e alterada. Sessoes de cliente (H-011/H-012/H-014)
-- continuam exigindo challenge_id. A sessao aberta por senha (purpose='password') nasce sem desafio.
-- Mesma postura de RLS e grants de 150000 e 180000: nenhum privilegio novo.

-- 1. challenge_id passa a ser opcional; so a sessao por senha pode ficar sem desafio --------------------
alter table app.app_session alter column challenge_id drop not null;

-- 2. purpose aceita 'password' (login por senha do profissional, H-016) -----------------------------------
-- Nome do CHECK inline de 150000 (padrao do Postgres: <tabela>_<coluna>_check).
alter table app.app_session drop constraint if exists app_session_purpose_check;
alter table app.app_session add constraint app_session_purpose_check
  check (purpose in ('login', 'publish', 'password'));

-- 3. Exclusividade: nao ter desafio se e so se a sessao for por senha --------------------------------------
alter table app.app_session drop constraint if exists app_session_desafio_por_senha;
alter table app.app_session add constraint app_session_desafio_por_senha
  check ((purpose = 'password') = (challenge_id is null));

comment on column app.app_session.challenge_id is
  'Desafio que abriu a sessao (H-011/H-012). Nulo somente para purpose=password (login por senha, H-016).';
