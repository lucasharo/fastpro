// H-025 | Rascunho de pedido sem conta (docs/factory/74-DESENHO-H025.md, §1 a §4; CA-01..CA-03, CA-07, CA-08).
// Logica pura, sem I/O (node:crypto e banco ficam na composicao e em @fastpro/db).
// Corpo {service_id, address_text, urgency, description} com chaves permitidas, limites, cookie do
// rascunho, estados, politica de limite de taxa, forma da resposta e a checagem de campos para revisao.
import { ADDRESS_LABEL_MAX, ADDRESS_QUERY_MIN } from '../geo/address-suggest.js';

export const DRAFT_PATH = '/v1/drafts' as const;
export const DRAFT_CURRENT_PATH = '/v1/drafts/current' as const;
/** Cookie do rascunho (desenho §1): __Host-, segredo de 256 bits gerado so pelo servidor. */
export const DRAFT_COOKIE_NAME = '__Host-fp_draft';
/** Prazo do rascunho: 7 dias corridos, renovados a cada salvamento (71 D-H025-1; desenho §1). */
export const DRAFT_TTL_DAYS = 7;
export const DRAFT_MAX_AGE_SECONDS = DRAFT_TTL_DAYS * 24 * 60 * 60;
/** Teto absoluto desde a criacao (desenho §1, decisao de arquitetura). */
export const DRAFT_ABSOLUTE_MAX_DAYS = 30;
/** Corpo do POST e do PATCH: no maximo 8 KB (desenho §1). */
export const DRAFT_BODY_LIMIT_BYTES = 8 * 1024;
export const DRAFT_DESCRIPTION_MAX = 2000;
export const DRAFT_ADDRESS_MIN = ADDRESS_QUERY_MIN;
export const DRAFT_ADDRESS_MAX = ADDRESS_LABEL_MAX;
/** Segredo do cookie: 32 bytes em base64url, sempre 43 caracteres. */
export const DRAFT_SECRET_LENGTH = 43;

export const DRAFT_URGENCY = [
  'imediato',
  'proximas_semanas',
  'proximo_mes',
  'nao_definido',
] as const;
export type DraftUrgency = (typeof DRAFT_URGENCY)[number];

/** Os quatro estados do modelo (09). A coluna aceita todos; esta historia grava so aberto e descartado. */
export const DRAFT_STATUSES = ['aberto', 'aguardando_email', 'descartado', 'publicado'] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];
export const DRAFT_STATUSES_WRITTEN_BY_H025 = ['aberto', 'descartado'] as const;
/** Estados em que o rascunho ainda e visivel ao cliente e pode ser salvo (desenho §1, §3). */
export const DRAFT_LIVE_STATUSES = ['aberto', 'aguardando_email'] as const;

/** Chaves aceitas no corpo. Qualquer outra (inclusive email, status, id, lat, lon) e 422. */
export const DRAFT_FIELDS = ['service_id', 'address_text', 'urgency', 'description'] as const;
export type DraftField = (typeof DRAFT_FIELDS)[number];

/** Campos enviados em um salvamento. Chave ausente = nao muda; null = limpa (desenho §1). */
export type DraftFieldsPatch = {
  service_id?: string | null;
  address_text?: string | null;
  urgency?: DraftUrgency;
  description?: string | null;
};

export type DraftBodyErrorCode =
  | 'corpo_grande'
  | 'corpo_invalido'
  | 'campo_desconhecido'
  | 'vazio'
  | 'servico_invalido'
  | 'endereco_invalido'
  | 'urgencia_invalida'
  | 'descricao_invalida';

export type DraftBodyResult =
  | { readonly ok: true; readonly fields: DraftFieldsPatch }
  | { readonly ok: false; readonly status: 413 | 422; readonly code: DraftBodyErrorCode };

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const CONTROL_CHAR = /\p{Cc}/u;

function codePoints(text: string): number {
  return [...text].length;
}

function isDraftUrgency(value: unknown): value is DraftUrgency {
  return typeof value === 'string' && (DRAFT_URGENCY as readonly string[]).includes(value);
}

type FieldResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

function parseServiceId(value: unknown): FieldResult<string | null> {
  if (value === null) return { ok: true, value: null };
  if (typeof value === 'string' && UUID_RE.test(value)) return { ok: true, value };
  return { ok: false };
}

function parseAddress(value: unknown): FieldResult<string | null> {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false };
  const text = value.normalize('NFC').trim();
  if (CONTROL_CHAR.test(text)) return { ok: false };
  const n = codePoints(text);
  if (n < DRAFT_ADDRESS_MIN || n > DRAFT_ADDRESS_MAX) return { ok: false };
  return { ok: true, value: text };
}

function parseDescription(value: unknown): FieldResult<string | null> {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false };
  const text = value.normalize('NFC').trim();
  // Quebra de linha (LF ou CR) e permitida; outro caractere de controle (inclusive \0) e recusado.
  if (CONTROL_CHAR.test(text.replace(/\r\n|\r|\n/g, ''))) return { ok: false };
  if (codePoints(text) > DRAFT_DESCRIPTION_MAX) return { ok: false };
  return { ok: true, value: text === '' ? null : text };
}

/**
 * Confere o corpo ja lido (desenho §1, D-09). Corpo acima de 8 KB: 413. JSON invalido, nao objeto,
 * chave fora da lista: 422 (campo_desconhecido, sem gravar). Corpo sem nenhuma chave: 422 vazio.
 * Cada campo: formato e limite; qualquer falha recusa o pedido inteiro (nada e gravado).
 */
export function parseDraftBody(text: string, byteLength: number): DraftBodyResult {
  if (byteLength > DRAFT_BODY_LIMIT_BYTES) return { ok: false, status: 413, code: 'corpo_grande' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, status: 422, code: 'corpo_invalido' };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 422, code: 'corpo_invalido' };
  }
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.some((k) => !(DRAFT_FIELDS as readonly string[]).includes(k))) {
    return { ok: false, status: 422, code: 'campo_desconhecido' };
  }
  if (keys.length === 0) return { ok: false, status: 422, code: 'vazio' };

  const fields: { -readonly [K in keyof DraftFieldsPatch]: DraftFieldsPatch[K] } = {};
  if (Object.hasOwn(obj, 'service_id')) {
    const r = parseServiceId(obj['service_id']);
    if (!r.ok) return { ok: false, status: 422, code: 'servico_invalido' };
    fields.service_id = r.value;
  }
  if (Object.hasOwn(obj, 'address_text')) {
    const r = parseAddress(obj['address_text']);
    if (!r.ok) return { ok: false, status: 422, code: 'endereco_invalido' };
    fields.address_text = r.value;
  }
  if (Object.hasOwn(obj, 'urgency')) {
    if (!isDraftUrgency(obj['urgency'])) return { ok: false, status: 422, code: 'urgencia_invalida' };
    fields.urgency = obj['urgency'];
  }
  if (Object.hasOwn(obj, 'description')) {
    const r = parseDescription(obj['description']);
    if (!r.ok) return { ok: false, status: 422, code: 'descricao_invalida' };
    fields.description = r.value;
  }
  return { ok: true, fields };
}

// ---------------------------------------------------------------------------------------------
// Cabecalhos e cookie (desenho §1, R4).
// ---------------------------------------------------------------------------------------------

export interface DraftRequestHeaders {
  readonly origin: string | undefined;
  readonly secFetchSite: string | undefined;
  readonly contentType: string | undefined;
}

export type DraftHeaderCheck = { readonly ok: true } | { readonly ok: false; readonly status: 403 | 415 };

/**
 * Origin, quando presente, tem de ser a origem do site; Sec-Fetch-Site, quando presente, tem de ser
 * same-origin. Metodos que mudam estado (POST, PATCH, DELETE) exigem Origin; o GET aceita a ausencia
 * (navegacao do mesmo site pode nao enviar Origin).
 */
export function checkDraftOrigin(
  h: Pick<DraftRequestHeaders, 'origin' | 'secFetchSite'>,
  siteOrigin: string,
  exigeOrigem: boolean,
): { readonly ok: true } | { readonly ok: false; readonly status: 403 } {
  if (h.origin === undefined) {
    if (exigeOrigem) return { ok: false, status: 403 };
  } else if (h.origin !== siteOrigin) {
    return { ok: false, status: 403 };
  }
  if (h.secFetchSite !== undefined && h.secFetchSite !== 'same-origin') {
    return { ok: false, status: 403 };
  }
  return { ok: true };
}

/** Content-Type de POST e PATCH: application/json (parametros como charset sao aceitos). */
export function checkDraftJson(contentType: string | undefined): { readonly ok: true } | { readonly ok: false; readonly status: 415 } {
  const media = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return media === 'application/json' ? { ok: true } : { ok: false, status: 415 };
}

const SEGREDO_FORMATO_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Le o segredo do cookie __Host-fp_draft do cabecalho Cookie. Devolve so segredo com o formato
 * exato (43 caracteres base64url). Ausente, malformado ou repetido: devolve null (o chamador nao
 * vai ao banco para GET, PATCH e DELETE, e trata como sem rascunho).
 */
export function draftSecretFromCookie(cookieHeader: string | undefined): string | null {
  if (cookieHeader === undefined) return null;
  const values: string[] = [];
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === DRAFT_COOKIE_NAME) values.push(part.slice(eq + 1).trim());
  }
  if (values.length !== 1) return null;
  const value = values[0] ?? '';
  return SEGREDO_FORMATO_RE.test(value) ? value : null;
}

/** Set-Cookie do rascunho: __Host- (sem Domain), HttpOnly, Secure, SameSite=Strict, Path=/. */
export function draftCookieHeader(secret: string): string {
  if (!SEGREDO_FORMATO_RE.test(secret)) throw new RangeError('segredo_invalido');
  return `${DRAFT_COOKIE_NAME}=${secret}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${DRAFT_MAX_AGE_SECONDS}`;
}

/** Set-Cookie que limpa o cookie do rascunho (DELETE). */
export const DRAFT_CLEAR_COOKIE_HEADER = `${DRAFT_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

// ---------------------------------------------------------------------------------------------
// Estados e resposta (desenho §1, §2).
// ---------------------------------------------------------------------------------------------

/** Resposta de rascunho: so estes campos saem. Nunca hash, IP, e-mail ou nome (R2, R3). */
export interface DraftView {
  readonly id: string;
  readonly status: DraftStatus;
  readonly service_id: string | null;
  readonly address_text: string | null;
  readonly urgency: DraftUrgency | null;
  readonly description: string | null;
  readonly expires_at: string;
  readonly updated_at: string;
}

/** Corpo fixo de todo 404 (sem cookie, malformado, de outro navegador, vencido, descartado). */
export const DRAFT_NOT_FOUND_BODY = { code: 'nao_encontrado' } as const;

/** Cabecalhos de toda resposta desta historia (sem cache, sem vazamento de tipo). */
export const DRAFT_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Type': 'application/json; charset=utf-8',
};

// ---------------------------------------------------------------------------------------------
// Limites de taxa (desenho §3, R1). Janela = spanS; balde = bucketS; limite = pedidos na janela.
// ---------------------------------------------------------------------------------------------

export interface DraftRatePolicy {
  readonly id: 'criacao_hora' | 'criacao_dia' | 'salvar_ip' | 'salvar_rascunho';
  readonly spanS: number;
  readonly bucketS: number;
  readonly limit: number;
}

/** Criacao de rascunho por IP-HMAC: 10 por hora (a janela de hora) e 50 por dia. */
export const DRAFT_RATE_CRIACAO_HORA: DraftRatePolicy = { id: 'criacao_hora', spanS: 3600, bucketS: 300, limit: 10 };
export const DRAFT_RATE_CRIACAO_DIA: DraftRatePolicy = { id: 'criacao_dia', spanS: 86400, bucketS: 3600, limit: 50 };
/** Salvamento por IP-HMAC: 120 por 60 s. Por rascunho: 60 por 60 s (chave = hash do segredo). */
export const DRAFT_RATE_SALVAR_IP: DraftRatePolicy = { id: 'salvar_ip', spanS: 60, bucketS: 10, limit: 120 };
export const DRAFT_RATE_SALVAR_RASCUNHO: DraftRatePolicy = { id: 'salvar_rascunho', spanS: 60, bucketS: 10, limit: 60 };

// ---------------------------------------------------------------------------------------------
// Revisao (D-H025-5; CA-04 fica para H-030). Funcao pura, sem bloqueio nesta historia.
// ---------------------------------------------------------------------------------------------

export const DRAFT_REVIEW_FIELDS = [
  'service_id',
  'address_text',
  'urgency',
  'description',
  'first_name',
  'email',
] as const;
export type DraftReviewField = (typeof DRAFT_REVIEW_FIELDS)[number];

export interface DraftReviewInput {
  readonly serviceId: string | null;
  readonly addressText: string | null;
  readonly urgency: DraftUrgency | null;
  readonly description: string | null;
  /** Primeiro nome e e-mail sao pedidos na identificacao (H-013); ausentes contam como faltantes. */
  readonly firstName?: string | null;
  readonly email?: string | null;
}

function preenchido(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Lista, na ordem fixa de DRAFT_REVIEW_FIELDS, os campos que faltam para enviar o pedido para revisao.
 * Urgencia "nao_definido" conta como preenchida (e uma escolha). Lista vazia = pronto para revisar.
 * Usada por H-030 para o bloqueio por campo (CA-04 e da H-030; aqui so o calculo).
 */
export function draftMissingForReview(input: DraftReviewInput): readonly DraftReviewField[] {
  const faltam: DraftReviewField[] = [];
  if (!preenchido(input.serviceId)) faltam.push('service_id');
  if (!preenchido(input.addressText)) faltam.push('address_text');
  if (!isDraftUrgency(input.urgency)) faltam.push('urgency');
  if (!preenchido(input.description)) faltam.push('description');
  if (!preenchido(input.firstName)) faltam.push('first_name');
  if (!preenchido(input.email)) faltam.push('email');
  return faltam;
}
