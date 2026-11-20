-- Desfaz 20261120510000 (H-056, Issue #69, fatia 1): retira o EXECUTE de app_system na funcao de acesso.
revoke execute on function private.request_photo_access(uuid, uuid, uuid, timestamptz) from app_system;
