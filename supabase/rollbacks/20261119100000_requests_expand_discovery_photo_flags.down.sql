-- Reversao da Issue 68 (H-055): remove a funcao de fotos da descoberta. Nao toca em dados.
drop function if exists private.request_discovery_photo_flags(uuid[]);
