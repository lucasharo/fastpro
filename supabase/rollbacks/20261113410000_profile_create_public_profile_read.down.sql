-- Desfaz 20261113410000_profile_create_public_profile_read.sql (Issue 56, H-043).
-- Remove so a funcao de leitura publica. Nao altera perfis, servicos, casos nem eventos de auditoria.
-- Nenhuma funcao de #52, #53 ou #54 e tocada. Execucao manual e consciente, so em banco de desenvolvimento.
begin;

drop function if exists private.professional_public_profile(text);

commit;
