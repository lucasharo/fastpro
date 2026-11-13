-- Desfaz 20261113250100_contact_fix_available_volatile.sql (Issue 46). Volta a funcao a stable, como na migracao
-- 20261113250000. Atencao: a versao stable falha ao executar (select ... for share); o down existe so para reversao
-- exata do que foi aplicado. Idempotente.
begin;

alter function private.contact_available_professional(uuid, uuid, timestamptz) stable;

delete from ops.schema_migration where version = '20261113250100';

commit;
