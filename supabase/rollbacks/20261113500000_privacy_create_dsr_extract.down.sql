-- Issue 120 (H-111) | Desfaz 20261113500000_privacy_create_dsr_extract.sql: remove as duas funcoes do extrato
-- (geracao e registro) e o montador privado. Nao apaga extratos, casos, eventos, e-mails nem linhas de auditoria ja
-- gravados: a prova do atendimento e retida. O catalogo de auditoria nao e alterado.
-- Execucao manual e consciente, so em banco de desenvolvimento.
begin;

drop function if exists app.dsr_register_extract(uuid, text, text, text, integer);
drop function if exists app.dsr_generate_extract(uuid);
drop function if exists private.dsr_build_extract(uuid, text, timestamptz);

delete from ops.schema_migration where version = '20261113500000';

commit;
