// H-006: espelho puro (sem banco) da auditoria append-only. Replica a canonicalizacao do estado e o
// hash encadeado de supabase/migrations/20261110140000_audit_create_event_chain.sql
// (private.audit_canonical_state / private.audit_row_hash) e as regras de estado sem PII. O banco e
// a autoridade; estas funcoes servem para rejeicao antecipada e para o teste de paridade SQL x TS.
import { createHash } from 'node:crypto';

/** Acoes semeadas no catalogo (CA-14). Cada historia consumidora acrescenta as suas por migracao. */
export const AUDIT_ACTIONS = {
  PROFESSIONAL_SUSPENDED: 'professional.suspended',
  REVIEW_REVISED: 'review.revised',
  COMPLETION_CORRECTED: 'completion.corrected',
  PAYMENT_REFUNDED: 'payment.refunded',
  CONSENT_CHANGED: 'consent.changed',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/** Chaves de estado permitidas por acao semeada (espelho de audit.action_catalog.state_keys). */
export const AUDIT_STATE_KEYS: Readonly<Record<AuditAction, readonly string[]>> = {
  'professional.suspended': ['status', 'suspension_kind', 'until_at', 'approval_request_id'],
  'review.revised': ['status', 'visible', 'moderation_case_id'],
  'completion.corrected': ['status', 'selected_acceptance_id', 'completed_at', 'support_case_id'],
  'payment.refunded': ['status', 'refund_amount_cents', 'currency', 'approval_request_id'],
  'consent.changed': ['scope', 'granted', 'consent_text_version', 'acceptance_id'],
};

export type AuditScalar = string | number | boolean | null;
export type AuditState = Readonly<Record<string, AuditScalar>>;

export class AuditStateError extends Error {
  readonly code = 'AU002';
  constructor(message: string) {
    super(message);
    this.name = 'AuditStateError';
  }
}

const compareBytes = (a: string, b: string): number =>
  Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));

/**
 * Estado canonico: chaves em ordem bytewise (COLLATE "C"); `{` + `"chave":valor` separados por `,`
 * + `}`. Valores: string, booleano, nulo e numero (inteiros e decimais simples, como no jsonb).
 */
export function canonicalizeState(state: AuditState): string {
  const parts = Object.keys(state)
    .sort(compareBytes)
    .map((key) => {
      const value = state[key];
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new AuditStateError('numero nao finito no estado');
      }
      if (value !== null && typeof value === 'object') {
        throw new AuditStateError('estado deve ser plano (sem objetos/arrays)');
      }
      return `${JSON.stringify(key)}:${JSON.stringify(value)}`;
    });
  return `{${parts.join(',')}}`;
}

export interface AuditHashFields {
  hashVersion: number;
  seq: number | string | bigint;
  id: string;
  /** UTC com microssegundos: `YYYY-MM-DDTHH:MM:SS.UUUUUUZ` (como to_char no banco). */
  at: string;
  actorRef: string;
  actorRole: string;
  action: string;
  objectType: string;
  objectId: string;
  beforeState: AuditState;
  afterState: AuditState;
  reasonCode: string | null;
  correlationId: string | null;
  prevHash: string;
}

export const GENESIS_HASH = '0'.repeat(64);

/** SHA-256 hexadecimal (minusculo) da linha: campos separados por `\n`, na ordem do SQL. */
export function computeRowHash(f: AuditHashFields): string {
  const input = [
    `v${f.hashVersion}`,
    String(f.seq),
    f.id,
    f.at,
    f.actorRef,
    f.actorRole,
    f.action,
    f.objectType,
    f.objectId,
    canonicalizeState(f.beforeState),
    canonicalizeState(f.afterState),
    f.reasonCode ?? '',
    f.correlationId ?? '',
    f.prevHash,
  ].join('\n');
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

// --- Verificacao de cadeia (mesma regra de private.audit_verify_chain) -----------------------------

export interface AuditChainRow extends AuditHashFields {
  rowHash: string;
}

export type ChainFailure =
  'lacuna_seq' | 'prev_hash_divergente' | 'row_hash_divergente' | 'cabeca_divergente';

export interface ChainVerdict {
  ok: boolean;
  checked: number;
  firstBadSeq: number | null;
  reason: ChainFailure | null;
}

export interface ChainHead {
  lastSeq: number;
  lastHash: string;
}

/** Verifica as linhas (ordenadas por seq, desde a seq 1) e, se informada, a cabeca da cadeia. */
export function verifyChain(rows: readonly AuditChainRow[], head?: ChainHead): ChainVerdict {
  let prev = GENESIS_HASH;
  let expected = 1;
  let checked = 0;
  const fail = (firstBadSeq: number, reason: ChainFailure): ChainVerdict => ({
    ok: false,
    checked,
    firstBadSeq,
    reason,
  });
  for (const row of rows) {
    const seq = Number(row.seq);
    if (seq !== expected) return fail(expected, 'lacuna_seq');
    if (row.prevHash !== prev) return fail(seq, 'prev_hash_divergente');
    if (computeRowHash(row) !== row.rowHash) return fail(seq, 'row_hash_divergente');
    prev = row.rowHash;
    expected += 1;
    checked += 1;
  }
  if (head && (head.lastSeq !== expected - 1 || head.lastHash !== prev)) {
    return fail(expected, 'cabeca_divergente');
  }
  return { ok: true, checked, firstBadSeq: null, reason: null };
}

// --- Estado sem PII (CA-09): rejeicao antecipada; o banco continua sendo a autoridade ------------

const FORBIDDEN_SUBSTRINGS =
  /(email|mail|telefone|phone|celular|whatsapp|cpf|cnpj|documento|endereco|address|logradouro|latitude|longitude|useragent|mensagem|message|senha|password|token|secret|birth|nascimento)/;
const FORBIDDEN_EDGE_WORDS = new Set([
  'rg',
  'nome',
  'name',
  'cep',
  'lat',
  'lng',
  'ip',
  'texto',
  'text',
  'body',
  'conteudo',
  'content',
]);

/** Espelho de private.audit_key_is_forbidden. */
export function isForbiddenStateKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (FORBIDDEN_SUBSTRINGS.test(lower.replace(/[_.-]/g, ''))) return true;
  const words = lower.split(/[_.-]+/);
  return FORBIDDEN_EDGE_WORDS.has(words[0] ?? '') || FORBIDDEN_EDGE_WORDS.has(words.at(-1) ?? '');
}

const STRING_ALPHABET = /^[A-Za-z0-9_.:-]*$/;
const DIGITS_10_15 = /^[0-9]{10,15}$/;
const MASKED_CPF = /^[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}$/;

/**
 * Lanca AuditStateError (codigo AU002) se o estado tiver PII provavel, aninhamento, chave
 * proibida ou chave fora da allowlist (quando informada). Nunca redige em silencio e nunca inclui
 * valores na mensagem.
 */
export function assertAuditStateClean(state: AuditState, allowedKeys?: readonly string[]): void {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    throw new AuditStateError('estado deve ser um objeto plano');
  }
  for (const [key, value] of Object.entries(state)) {
    if (isForbiddenStateKey(key)) throw new AuditStateError(`chave proibida: ${key}`);
    if (allowedKeys && !allowedKeys.includes(key)) {
      throw new AuditStateError(`chave fora da allowlist da acao: ${key}`);
    }
    if (value !== null && typeof value === 'object') {
      throw new AuditStateError(`valor aninhado em ${key}`);
    }
    if (typeof value === 'string') {
      if (
        value.length > 64 ||
        !STRING_ALPHABET.test(value) ||
        DIGITS_10_15.test(value) ||
        MASKED_CPF.test(value)
      ) {
        throw new AuditStateError(`valor de ${key} nao permitido (possivel dado pessoal)`);
      }
    }
  }
}

// --- Gravacao (mesma transacao da acao) --------------------------------------------------------------

/** Cliente ja dentro de uma transacao (BEGIN emitido). Nunca use um pool/outra conexao. */
export interface TxClient {
  readonly inTransaction: true;
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** Marca um cliente (ex.: pg.Client apos BEGIN) como participante da transacao da acao. */
export function asTx(client: {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}): TxClient {
  return Object.assign(client, { inTransaction: true as const });
}

export interface AppendAuditInput {
  actorRef: string;
  actorRole: string;
  action: string;
  objectType: string;
  objectId: string;
  beforeState: AuditState;
  afterState: AuditState;
  reasonCode?: string | null;
  correlationId?: string | null;
}

/**
 * Chama private.audit_append na transacao `tx`. O erro (catalogo, PII, lock_timeout...) e propagado:
 * NAO envolva em try/catch nem savepoint que permita seguir com a acao (CA-03). Devolve o id do evento.
 */
export async function appendAudit(tx: TxClient, input: AppendAuditInput): Promise<string> {
  const known = (AUDIT_STATE_KEYS as Record<string, readonly string[]>)[input.action];
  assertAuditStateClean(input.beforeState, known);
  assertAuditStateClean(input.afterState, known);
  const res = await tx.query(
    'select private.audit_append($1, $2, $3, $4, $5::uuid, $6::jsonb, $7::jsonb, $8, $9::uuid) as id',
    [
      input.actorRef,
      input.actorRole,
      input.action,
      input.objectType,
      input.objectId,
      JSON.stringify(input.beforeState),
      JSON.stringify(input.afterState),
      input.reasonCode ?? null,
      input.correlationId ?? null,
    ],
  );
  return String(res.rows[0]?.['id']);
}
