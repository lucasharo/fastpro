// Issue 56 (H-043) | Contrato publico do perfil (docs/factory/143-DESENHO-H043.md, §5 e §6.1; T43-02, T43-03).
// Lista fechada em cada nivel do JSON: a validacao rejeita qualquer chave fora dela (defesa em profundidade,
// alem do dominio). Sem telefone, WhatsApp, e-mail, identificador interno, documento, base ou acesso comercial.

export const PUBLIC_PROFILE_PATH_PREFIX = '/v1/public/professionals/' as const;

/** Chaves do corpo 200, nivel do perfil. */
export const PUBLIC_PROFILE_FIELDS = [
  'publicName',
  'slug',
  'verified',
  'verificationBadge',
  'services',
  'rating',
  'recentReviews',
] as const;

/** Campos que nunca podem aparecer no corpo publico, em nenhum nivel (dec. 594). */
export const PUBLIC_PROFILE_FORBIDDEN_FIELDS = [
  'phone',
  'whatsapp',
  'email',
  'userId',
  'user_id',
  'document_type',
  'document_enc',
  'document_hmac',
  'radius_m',
  'base_point',
  'geocode_point_id',
  'commercial_access',
  'verification_status',
  'verified_at',
  'suspended_at',
] as const;

const CHAVES_BADGE = new Set(['label', 'disclaimer']);
const CHAVES_REPUTACAO = new Set(['average', 'count', 'label']);
const CHAVES_GRUPO = new Set(['groupName', 'items']);
const CHAVES_ITEM = new Set(['name', 'modalities']);
const MODALIDADES = new Set(['online', 'presencial']);

export type PublicProfileValidation = { readonly ok: true } | { readonly ok: false; readonly motivo: string };

const isObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Exige exatamente o conjunto de chaves permitido (nem a mais, nem a menos). */
function chavesExatas(obj: Record<string, unknown>, permitidas: ReadonlySet<string>): boolean {
  const chaves = Object.keys(obj);
  return chaves.length === permitidas.size && chaves.every((k) => permitidas.has(k));
}

/**
 * Valida o corpo 200 do perfil publico. Rejeita chave fora da lista em qualquer nivel, campo proibido
 * e valor fora do esperado nesta versao (verified true, reputacao zerada, lista de avaliacoes vazia).
 */
export function validatePublicProfileResponse(valor: unknown): PublicProfileValidation {
  if (!isObjeto(valor)) return { ok: false, motivo: 'corpo_nao_objeto' };
  if (!chavesExatas(valor, new Set(PUBLIC_PROFILE_FIELDS))) return { ok: false, motivo: 'chaves_do_perfil' };
  for (const proibido of PUBLIC_PROFILE_FORBIDDEN_FIELDS) {
    if (proibido in valor) return { ok: false, motivo: 'campo_proibido' };
  }
  if (valor.verified !== true) return { ok: false, motivo: 'verified' };
  if (!isObjeto(valor.verificationBadge) || !chavesExatas(valor.verificationBadge, CHAVES_BADGE)) {
    return { ok: false, motivo: 'selo' };
  }
  if (!isObjeto(valor.rating) || !chavesExatas(valor.rating, CHAVES_REPUTACAO)) {
    return { ok: false, motivo: 'reputacao' };
  }
  if (valor.rating.average !== null || valor.rating.count !== 0) return { ok: false, motivo: 'reputacao_nao_zerada' };
  if (!Array.isArray(valor.recentReviews) || valor.recentReviews.length !== 0) {
    return { ok: false, motivo: 'avaliacoes' };
  }
  if (!Array.isArray(valor.services)) return { ok: false, motivo: 'servicos' };
  for (const grupo of valor.services) {
    if (!isObjeto(grupo) || !chavesExatas(grupo, CHAVES_GRUPO) || !Array.isArray(grupo.items)) {
      return { ok: false, motivo: 'grupo' };
    }
    for (const item of grupo.items) {
      if (!isObjeto(item) || !chavesExatas(item, CHAVES_ITEM) || !Array.isArray(item.modalities)) {
        return { ok: false, motivo: 'item' };
      }
      if (!item.modalities.every((m) => typeof m === 'string' && MODALIDADES.has(m))) {
        return { ok: false, motivo: 'modalidade' };
      }
    }
  }
  return { ok: true };
}
