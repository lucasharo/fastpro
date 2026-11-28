-- H-102 | Retira o DELETE do papel de sistema nas tabelas de papel, convite e sessao admin (revisao da #111).
-- Idempotente. Desfazer: supabase/rollbacks/20261111240000_admin_restrict_rbac_delete.down.sql.
-- Motivo: a migracao 20261111220000_admin_create_rbac ja foi aplicada (o checksum impede editar), entao a
-- correcao vai aqui. Linhas de admin_user_role e admin_invite nunca sao apagadas (historico); a sessao
-- admin expira e e expurgada SOMENTE pela funcao private.admin_session_purge (security definer, dona da
-- tabela). app_system continua com SELECT, INSERT e UPDATE nas tres tabelas.

revoke delete on app.admin_user_role, app.admin_invite, app.admin_session from app_system;
