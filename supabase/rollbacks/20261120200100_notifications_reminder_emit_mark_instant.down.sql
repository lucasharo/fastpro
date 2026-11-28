-- H-099 (Issue 109) | Desfaz 20261120200100_notifications_reminder_emit_mark_instant (manual).
-- Remove a versao de 3 argumentos. A versao de 4 argumentos e removida pelo rollback de 20261120200000.
drop function if exists private.reminder_emit(text, text, uuid);
