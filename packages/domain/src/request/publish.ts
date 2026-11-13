// H-031 (Issue #44) | Regras puras da publicacao idempotente do pedido (docs/factory/110-DESENHO-H031.md, §3, §5, §8).
// Sem I/O: corpo, formato da chave, hash do corpo canonico, token de reconhecimento de duplicidade (HMAC, sem tabela)
// e o mapa fechado de respostas de erro. Banco, provedor e relogio ficam fora do dominio.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** Tamanho maximo do corpo (3.1: 413 acima de 1 KB). */
export const PUBLISH_BODY_MAX_BYTES = 1024;
/** Validade do token de reconhecimento de duplicidade (D-09, decisao 229: 5 minutos). */
export const PUBLISH_ACK_TTL_S = 300;
/** Tamanho minimo da chave HMAC (decisao 254). */
export const PUBLISH_HMAC_MIN_CHARS = 32;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAVE = /^[A-Za-z0-9_-]{16,64}$/;
const CHAVES_CORPO = ['draft_id', 'content_rev', 'duplicate_ack'] as const;
const ACK_MAX = 512;

export interface PublishBody {
  readonly draftId: string;
  readonly contentRev: number;
  readonly duplicateAck?: string;
}

export type PublishBodyResult =
  | { readonly ok: true; readonly body: PublishBody }
  | { readonly ok: false; readonly code: 'corpo_invalido' | 'corpo_grande' };

/** Valida o cabecalho Idempotency-Key: 16 a 64 caracteres de [A-Za-z0-9_-]. */
export function isPublishIdempotencyKey(valor: unknown): valor is string {
  return typeof valor === 'string' && CHAVE.test(valor);
}

/**
 * Le o corpo JSON ja decodificado. Lista fechada de chaves: draft_id e content_rev obrigatorios;
 * duplicate_ack opcional. Nenhum outro campo (RN-10, atribuicao em massa, 110 §9.3).
 */
export function parsePublishBody(raw: unknown, bytes?: number): PublishBodyResult {
  if (bytes !== undefined && bytes > PUBLISH_BODY_MAX_BYTES) {
    return { ok: false, code: 'corpo_grande' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, code: 'corpo_invalido' };
  }
  const campos = raw as Record<string, unknown>;
  for (const chave of Object.keys(campos)) {
    if (!(CHAVES_CORPO as readonly string[]).includes(chave)) return { ok: false, code: 'corpo_invalido' };
  }
  const draftId = campos.draft_id;
  const contentRev = campos.content_rev;
  if (typeof draftId !== 'string' || !UUID.test(draftId)) return { ok: false, code: 'corpo_invalido' };
  if (typeof contentRev !== 'number' || !Number.isSafeInteger(contentRev) || contentRev < 0) {
    return { ok: false, code: 'corpo_invalido' };
  }
  let duplicateAck: string | undefined;
  if (campos.duplicate_ack !== undefined) {
    const ack = campos.duplicate_ack;
    if (typeof ack !== 'string' || ack.length < 1 || ack.length > ACK_MAX) {
      return { ok: false, code: 'corpo_invalido' };
    }
    duplicateAck = ack;
  }
  return {
    ok: true,
    body: duplicateAck === undefined
      ? { draftId: draftId.toLowerCase(), contentRev }
      : { draftId: draftId.toLowerCase(), contentRev, duplicateAck },
  };
}

/** Hash do corpo canonico (110 §5.1): sha256 de "draft_id|content_rev|duplicate_ack ou vazio". */
export function publishBodyHash(body: PublishBody): string {
  return createHash('sha256')
    .update(`${body.draftId}|${body.contentRev}|${body.duplicateAck ?? ''}`, 'utf8')
    .digest('hex');
}

export interface DuplicateAckClaims {
  readonly userId: string;
  readonly draftId: string;
  readonly contentRev: number;
  readonly similarRequestId: string;
}

function assinar(chave: string, payload: string): string {
  return createHmac('sha256', chave).update(`publish-ack|${payload}`, 'utf8').digest('hex');
}

function exigirChave(chave: string): void {
  if (typeof chave !== 'string' || chave.length < PUBLISH_HMAC_MIN_CHARS) {
    throw new Error('publish_hmac_chave_curta');
  }
}

/**
 * Emite o token de reconhecimento da duplicidade (decisao 229, D-08). Formato: base64url(JSON) "." HMAC hex.
 * O JSON leva as reivindicacoes e a expiracao em segundos (agora + 300 s).
 */
export function issueDuplicateAck(
  chave: string,
  claims: DuplicateAckClaims,
  agoraMs: number,
): { readonly token: string; readonly expiresAtMs: number } {
  exigirChave(chave);
  const expiresAtMs = Math.floor(agoraMs / 1000) * 1000 + PUBLISH_ACK_TTL_S * 1000;
  const payload = Buffer.from(
    JSON.stringify({
      d: claims.draftId,
      r: claims.contentRev,
      s: claims.similarRequestId,
      u: claims.userId,
      e: expiresAtMs,
    }),
    'utf8',
  ).toString('base64url');
  return { token: `${payload}.${assinar(chave, payload)}`, expiresAtMs };
}

/**
 * Verifica o token na API. Falha fechada: qualquer formato errado, assinatura diferente, expiracao vencida
 * ou reivindicacao de outro usuario, rascunho, versao ou pedido semelhante devolve false.
 */
export function verifyDuplicateAck(
  chave: string,
  token: string,
  claims: DuplicateAckClaims,
  agoraMs: number,
): boolean {
  exigirChave(chave);
  if (typeof token !== 'string') return false;
  const partes = token.split('.');
  if (partes.length !== 2) return false;
  const [payload, assinatura] = partes as [string, string];
  const esperada = Buffer.from(assinar(chave, payload), 'hex');
  const recebida = Buffer.from(assinatura, 'hex');
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return false;
  let dados: Record<string, unknown>;
  try {
    dados = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return false;
  }
  return (
    dados.d === claims.draftId &&
    dados.r === claims.contentRev &&
    dados.s === claims.similarRequestId &&
    dados.u === claims.userId &&
    typeof dados.e === 'number' &&
    dados.e > agoraMs
  );
}

/** Resposta fechada de cada desfecho de erro (110 §3.1 e §3.3). Codigo nulo = sem erro. */
export interface PublishErrorResponse {
  readonly status: number;
  readonly code: string;
  readonly retryAfter?: number;
}

export const PUBLISH_ERROR_RESPONSES: Readonly<Record<string, PublishErrorResponse>> = {
  publicacao_indisponivel: { status: 503, code: 'publicacao_indisponivel' },
  chave_invalida: { status: 422, code: 'chave_invalida' },
  sessao_necessaria: { status: 401, code: 'sessao_necessaria' },
  nao_encontrado: { status: 404, code: 'nao_encontrado' },
  conflito: { status: 422, code: 'chave_reutilizada' },
  em_andamento: { status: 409, code: 'em_andamento', retryAfter: 2 },
  campos_faltando: { status: 422, code: 'campos_faltando' },
  email_nao_confirmado: { status: 409, code: 'email_nao_confirmado' },
  email_divergente: { status: 409, code: 'email_divergente' },
  conteudo_alterado: { status: 409, code: 'conteudo_alterado' },
  nao_confirmado: { status: 409, code: 'nao_confirmado' },
  fotos_em_processamento: { status: 409, code: 'fotos_em_processamento', retryAfter: 5 },
  limite: { status: 429, code: 'limite' },
  duplicidade: { status: 409, code: 'duplicidade' },
  geocodificacao_em_andamento: { status: 409, code: 'geocodificacao_em_andamento', retryAfter: 2 },
  geocode_limit: { status: 422, code: 'geocode_limit' },
  endereco_nao_encontrado: { status: 422, code: 'endereco_nao_encontrado' },
  endereco_invalido: { status: 422, code: 'endereco_invalido' },
  aguardando_geocodificacao: { status: 202, code: 'aguardando_geocodificacao', retryAfter: 30 },
  indisponivel: { status: 503, code: 'indisponivel', retryAfter: 10 },
  ponto_invalido: { status: 503, code: 'indisponivel', retryAfter: 10 },
  publicacao_chave_perdida: { status: 503, code: 'indisponivel', retryAfter: 2 },
};

/** Desfechos de sucesso do banco. 201 e criacao ou repeticao da mesma chave; 200 e segunda aba (decisao 256). */
export const PUBLISH_SUCCESS_STATUS = { criado: 201, repetida: 201, ja_publicado: 200 } as const;
