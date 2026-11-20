-- H-114 (Issue #123, fatia S4) | Acao de auditoria da revogacao forcada de sessao administrativa (D-07).
-- Motivo: audit.action_catalog e fechado (private.audit_append recusa acao fora do catalogo) e a acao
-- admin.session.revoked nao existia. Sem esta linha, o registro de contencao do runbook (149, secao 5)
-- seria recusado. Migracao so de catalogo: nao altera funcao, tabela nem dado.
-- Idempotente (on conflict). Reason obrigatorio: o runbook exige motivo em toda acao (CA-18).
-- Desfazer: supabase/rollbacks/20261120400000_audit_add_runbook_actions.down.sql (manual, so em dev).

insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('admin.session.revoked', 'admin_session', true,
   array['status'], 'Sessao administrativa revogada na contencao de conta comprometida (H-114, runbook D-07)')
on conflict (action) do nothing;
