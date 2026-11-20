-- H-114 (Issue #123, fatia S8) | Acao de auditoria do exercicio integrado do runbook (CA-18).
-- Motivo: audit.action_catalog e fechado (private.audit_append recusa acao fora do catalogo). Cada
-- exercicio do runbook (D-04, D-05, D-06, D-07, D-09, R-MP, R-EMAIL, R-AUTH) grava um evento com
-- ator, papel, motivo e instante; o procedimento vai no estado depois, nunca dado pessoal.
-- Migracao so de catalogo: nao altera funcao, tabela nem dado. Idempotente (on conflict).
-- Desfazer: supabase/rollbacks/20261120420000_audit_add_runbook_exercise_action.down.sql (manual, so em dev).

insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('runbook.exercicio.executado', 'runbook_exercicio', true,
   array['status', 'procedimento'],
   'Exercicio sintetico de procedimento do runbook de incidente executado em DEV (H-114, Issue 123, CA-18)')
on conflict (action, object_type) do nothing;
