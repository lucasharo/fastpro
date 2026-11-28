-- Issue 46 (H-033) | Correcao da migracao 20261113250000 (ja aplicada no banco de desenvolvimento; nao foi editada).
-- private.contact_available_professional foi criada como stable, mas le com select ... for share, o que o Postgres
-- recusa em funcao nao volatil ("SELECT FOR SHARE is not allowed in a non-volatile function"). Passa a volatile.
-- Idempotente. Desfazer: supabase/rollbacks/20261113250100_contact_fix_available_volatile.down.sql.

alter function private.contact_available_professional(uuid, uuid, timestamptz) volatile;
