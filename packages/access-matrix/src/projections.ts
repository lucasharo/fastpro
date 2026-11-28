// H-115 (Issue 124) | Projecoes autorizadas: listas fechadas por visao (desenho §3.3 e RN-10).
// Copias congeladas de packages/domain/src/request/visibility.ts. A igualdade e provada em
// apps/api/tests (access-matrix-domain-parity): alterar um lado sem o outro falha.

/** Chaves do dono (GET /v1/requests/:id). */
export const OWNER_KEYS = [
  'id',
  'status',
  'serviceId',
  'serviceName',
  'urgency',
  'description',
  'firstName',
  'addressText',
  'publicLabel',
  'publishedAt',
  'acceptanceDeadlineAt',
  'cobertura',
] as const;

/** Chaves do profissional elegivel (RN-10). Nunca inclui e-mail, telefone, endereco exato nem coordenadas. */
export const ELIGIBLE_PROFESSIONAL_KEYS = [
  'id',
  'serviceId',
  'serviceName',
  'urgency',
  'description',
  'publicLabel',
  'distanceKm',
  'modality',
  'publishedAt',
  'acceptanceDeadlineAt',
] as const;

/** Chaves do participante com aceite (acrescenta o primeiro nome). Ainda sem endereco exato. */
export const PARTICIPANT_KEYS = [...ELIGIBLE_PROFESSIONAL_KEYS, 'firstName'] as const;

/** Chaves que nunca podem aparecer para o dono em lista ou detalhe (campos internos). */
export const OWNER_FORBIDDEN = ['coordinates', 'latitude', 'longitude', 'addressCipher', 'addressHash'] as const;

/** Chaves que nunca podem aparecer para qualquer profissional (I-16, CA-H115-11). */
export const FORBIDDEN_FOR_PROFESSIONAL = [
  'email',
  'phone',
  'customerPhone',
  'coordinates',
  'latitude',
  'longitude',
  'addressText',
  'addressCipher',
  'addressHash',
  'customerId',
  'cpf',
  'cnpj',
] as const;

/** Chaves que nunca podem aparecer em resposta ao profissional elegivel sem aceite (CP-09). */
export const FORBIDDEN_PHONE = ['phone', 'customerPhone'] as const;
