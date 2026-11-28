-- H-012 | Revisao S-3: app_system nao apaga usuario (docs/factory/46-DESENHO-H012.md, §3 e §4).
-- Idempotente. Desfazer: supabase/rollbacks/20261111160000_identity_revoke_app_user_delete.down.sql.
-- Correcao por migracao nova: a 20261111150000 ja foi aplicada, e o executor (lib/migrations.mjs)
-- proibe editar migracao aplicada (o checksum denuncia).
-- Motivo: so app.app_session precisa de DELETE (expurgo de etapas vencidas, private.app_session_purge).
-- A H-012 nunca apaga usuario; qualquer exclusao de conta fica para uma historia propria.

revoke delete on app.app_user from app_system;
