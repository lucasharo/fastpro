-- H-099 (Issue 109) | Desfaz 20261120200000_notifications_create_reminder_scheduling (manual, sem dados).
-- Remove funcoes e indices criados pela migracao. Eventos e jobs ja gerados ficam no outbox e na fila:
-- sem handler registrado, um reminder.fire pendente falha com codigo fixo e nao tem efeito colateral.
drop function if exists private.reminder_scan(timestamptz);
drop function if exists private.reminder_emit(text, text, uuid, timestamptz);
drop function if exists private.reminder_trial_view(uuid, timestamptz);
drop function if exists private.reminder_request_view(uuid);
drop index if exists app.service_request_publicado_prazo_idx;
drop index if exists billing.access_grant_trial_ativo_fim_idx;
