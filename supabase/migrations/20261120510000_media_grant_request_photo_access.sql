-- H-056 (Issue #69) | Concede a app_system a funcao de acesso private.request_photo_access (fatia 1).
-- A migracao 20261120500000 (aplicada) concedeu app_system as listas e alvos, mas omitiu esta funcao, que a
-- porta de acesso do PgPhotoViewStore usa (167-DESENHO-H056.md, §3 e §4.2, item 848). Sem outra mudanca.
-- Idempotente (grant repetido nao altera nada). Desfazer: supabase/rollbacks/20261120510000_media_grant_request_photo_access.down.sql.
grant execute on function private.request_photo_access(uuid, uuid, uuid, timestamptz) to app_system;
