// Contrato publico do catalogo de servicos (H-018, 53-DESENHO-H018 §2 e §6.1 T-H018-06).
// Lista de permissao: a leitura publica devolve SOMENTE estes campos. Campos internos nunca entram.
export const CATALOG_PUBLIC_FIELDS = [
  'group_id',
  'group_name',
  'group_position',
  'service_id',
  'service_name',
  'modality',
  'regulated',
] as const;

// Campos internos proibidos na resposta publica (auditoria, administrador, colunas de controle).
export const CATALOG_FORBIDDEN_PUBLIC_FIELDS = [
  'council_body',
  'moderation_sensitive',
  'seed_key',
  'version',
  'updated_by_ref',
  'regulation_source',
] as const;
