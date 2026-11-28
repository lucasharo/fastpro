-- Desfaz 20261120100000 (H-058, Issue #71). Ordem inversa: mensagem, conversa, aceite, depois as funcoes.
-- ATENCAO: remove as tabelas e seus dados. So rodar depois de desfazer 20261120110000 (funcoes de aceite).
-- Uso em DEV apenas; sem backup (fora do escopo do projeto).

drop table if exists app.message;
drop table if exists app.conversation;
drop table if exists app.acceptance;

drop function if exists private.acceptance_guard_insert();
drop function if exists private.acceptance_guard_update();
drop function if exists private.chat_nega_remocao();
drop function if exists private.conversation_guard_insert();
drop function if exists private.conversation_guard_update();
drop function if exists private.message_guard_insert();
drop function if exists private.message_imutavel();
