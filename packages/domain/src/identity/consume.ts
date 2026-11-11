// H-012 | Consumo do link por POST (docs/factory/46-DESENHO-H012.md, §1 a §5; CA-H012-01..11).
// Logica pura, sem I/O: forma do corpo, cabecalhos exigidos, cookie da etapa, textos fixos e portas.
// O handler que decide o consumo fica em @fastpro/db (challenge-consume.ts).
import { CHALLENGE_TTL_SECONDS } from './challenge.js';

export const CONSUME_PATH = '/v1/auth/challenges/consume';
export const ACESSO_PATH = '/acesso';
/** Corpo do POST: no maximo 1 KiB (46 §1). */
export const CONSUME_BODY_LIMIT_BYTES = 1024;
/** Texto do token: no maximo 512 caracteres (46 §1). Formato errado nao desvia o caminho. */
export const CONSUME_TOKEN_MAX_LENGTH = 512;
export const IDENT_COOKIE_NAME = '__Host-fp_ident';
/** Validade da etapa de identificacao: 15 min fixos contados do clique (46 §3; D-H012-3). */
export const IDENT_STAGE_TTL_SECONDS = CHALLENGE_TTL_SECONDS;
/** Teto absoluto da sessao (08 §5.1 item 6). A H-012 so grava o campo; a H-014 converte. */
export const SESSION_ABSOLUTE_SECONDS = 7 * 24 * 60 * 60;
/** Tentativas de criacao da conta por requisicao (46 §4). */
export const ACCOUNT_MAX_ATTEMPTS = 2;
/** Orcamento de cada tentativa de criacao da conta (46 §4). */
export const ACCOUNT_DEADLINE_MS = 8_000;

/** Cabecalhos de toda resposta do POST (46 §5). Set-Cookie so aparece no 200. */
export const CONSUME_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Type': 'application/json; charset=utf-8',
};

/** Cabecalhos da pagina GET /acesso (46 §5). Igual para qualquer entrada. */
export const ACESSO_PAGE_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'Content-Type': 'text/html; charset=utf-8',
};

// ---------------------------------------------------------------------------------------------
// Corpo: {"token": string} e nada mais (46 §1, CA-H012-09).
// ---------------------------------------------------------------------------------------------

export type ConsumeBodyResult =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false };

/**
 * Confere o corpo ja lido. Qualquer chave alem de `token`, corpo acima de 1 KiB, JSON invalido ou
 * `token` que nao seja texto de ate 512 caracteres: recusa (o chamador responde 422, sem consumir).
 */
export function parseConsumeBody(text: string, byteLength: number): ConsumeBodyResult {
  if (byteLength > CONSUME_BODY_LIMIT_BYTES) return { ok: false };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false };
  const keys = Object.keys(raw);
  if (keys.length !== 1 || keys[0] !== 'token') return { ok: false };
  const token = (raw as { token?: unknown }).token;
  if (typeof token !== 'string' || token.length > CONSUME_TOKEN_MAX_LENGTH) return { ok: false };
  return { ok: true, token };
}

// ---------------------------------------------------------------------------------------------
// Cabecalhos conferidos antes de ler o corpo (46 §1, CA-H012-09; D-H012-5).
// ---------------------------------------------------------------------------------------------

export interface ConsumeRequestHeaders {
  readonly origin: string | undefined;
  readonly secFetchSite: string | undefined;
  readonly contentType: string | undefined;
}

export type ConsumeHeaderCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly status: 403 | 415;
      readonly code: 'origem_invalida' | 'tipo_invalido';
    };

/** Origem do site (SITE_URL), sem caminho: "https://exemplo.test". */
export function siteOriginOf(siteUrl: string): string {
  return new URL(siteUrl).origin;
}

/**
 * Origin tem de ser exatamente a origem do site; Sec-Fetch-Site, quando presente, tem de ser
 * same-origin; Content-Type tem de ser application/json (parametros como charset sao aceitos).
 */
export function checkConsumeHeaders(
  h: ConsumeRequestHeaders,
  siteOrigin: string,
): ConsumeHeaderCheck {
  if (h.origin !== siteOrigin) return { ok: false, status: 403, code: 'origem_invalida' };
  if (h.secFetchSite !== undefined && h.secFetchSite !== 'same-origin') {
    return { ok: false, status: 403, code: 'origem_invalida' };
  }
  const media = (h.contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (media !== 'application/json') return { ok: false, status: 415, code: 'tipo_invalido' };
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Cookie da etapa de identificacao (46 §3). O valor e um segredo de 256 bits em base64url.
// ---------------------------------------------------------------------------------------------

const FORMATO_COOKIE_RE = /^[A-Za-z0-9_-]{43}$/;

/** Set-Cookie da etapa: __Host- (sem Domain), HttpOnly, Secure, SameSite=Strict, validade de 15 min. */
export function identCookieHeader(secret: string): string {
  if (!FORMATO_COOKIE_RE.test(secret)) throw new RangeError('segredo_invalido');
  return `${IDENT_COOKIE_NAME}=${secret}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${IDENT_STAGE_TTL_SECONDS}`;
}

// ---------------------------------------------------------------------------------------------
// Portas (implementadas em @fastpro/db). Nenhuma chama rede aqui.
// ---------------------------------------------------------------------------------------------

/**
 * Resultado da conta do cliente. 'falha' cobre rede, tempo esgotado, 5xx, 429 e "e-mail ja existe
 * no Auth sem usuario local": o handler tenta de novo (ate ACCOUNT_MAX_ATTEMPTS).
 */
export type CustomerAccountResult =
  | { readonly status: 'ok'; readonly userId: string }
  | { readonly status: 'bloqueado' }
  | { readonly status: 'falha' };

export interface CustomerAccountPort {
  /** Procura o usuario pelo e-mail normalizado; se nao existir, cria (idempotente). */
  ensureCustomer(email: string, nowMs: number): Promise<CustomerAccountResult>;
}

export interface OpenStageInput {
  readonly sessionId: string;
  readonly userId: string;
  readonly challengeId: string;
  readonly purpose: string;
  readonly draftId: string | null;
  /** SHA-256 em hexadecimal do segredo do cookie. O segredo em claro nunca vai ao banco. */
  readonly hashDoSegredo: string;
  readonly nowMs: number;
}

export interface SessionStageStore {
  /** Abre a etapa de identificacao. Falso quando o desafio ja tinha etapa (nao duplica). */
  openStage(input: OpenStageInput): Promise<boolean>;
}

/** Codigos fixos de falha pos-consumo (metrica sem PII; 46 §4). */
export type ConsumeFailureCode =
  | 'consumo_falha_banco'
  | 'consumo_falha_decifra'
  | 'consumo_falha_conta'
  | 'consumo_falha_etapa';
