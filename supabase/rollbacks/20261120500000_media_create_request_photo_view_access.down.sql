-- Desfaz 20261120500000 (H-056, Issue #69, fatia 1). Remove as funcoes de acesso as fotos do pedido.
-- Nao toca tabelas, colunas, dados, politicas nem grants de tabela. Nenhuma funcao anterior e alterada.
drop function if exists private.request_photo_owner_target(uuid, uuid, uuid);
drop function if exists private.request_photo_owner_list(uuid, uuid);
drop function if exists private.request_photo_target(uuid, uuid, uuid, timestamptz);
drop function if exists private.request_photo_list(uuid, uuid, timestamptz);
drop function if exists private.request_photo_rows(uuid);
drop function if exists private.request_photo_access(uuid, uuid, uuid, timestamptz);
drop function if exists private.request_photo_pedido_acesso(uuid, uuid, timestamptz);
