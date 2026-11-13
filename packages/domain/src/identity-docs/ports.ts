// H-037 (Issue #50) | Portas dos documentos (107-DESENHO-H037.md, §2 D-3 e §4.2). O dominio nao conhece banco nem
// Storage: as implementacoes ficam em @fastpro/db (packages/db/src/identity-docs*.ts). Tres portas de Storage,
// separadas por finalidade. A porta do bucket final NAO tem leitura (CA-06, CA-19). IdentityDocReaderPort so
// existe como interface: a #52 cria a implementacao (CA-19).
import type { IdentityDocDeclaredType, IdentityDocRatePolicy } from './constants.js';

/** Staging (`identity-incoming`, chave `s/<uuid>`). Nunca usado por rota de leitura. */
export interface IdentityDocStagingPort {
  /** Assina um PUT de uso unico para a chave. Validade em segundos. */
  createUploadUrl(key: string, ttlS: number): Promise<string>;
  /** Tamanho do objeto, ou null se ausente. */
  stat(key: string): Promise<{ readonly bytes: number } | null>;
  /** Leitura unica, usada apenas pelo servico de finalizacao (nunca por rota). */
  read(key: string): Promise<Uint8Array | null>;
  remove(key: string): Promise<void>;
  /** Chaves `s/` com mais de `olderThanMs` de idade, no maximo `limit`. Usada pela varredura de orfaos. */
  listOlderThan(olderThanMs: number, limit: number): Promise<readonly string[]>;
}

/** Final (`identity-docs`, chave `i/<uuid>`). Sem leitura, sem URL de leitura, sem listagem (CA-06). */
export interface IdentityDocFinalPort {
  /** Upsert: a nova tentativa de finalizacao e idempotente. */
  put(id: string, bytes: Uint8Array, tipo: 'image/jpeg' | 'application/pdf'): Promise<void>;
  stat(id: string): Promise<{ readonly bytes: number } | null>;
  remove(id: string): Promise<void>;
}

/** Leitura para a Verificacao (#52). Interface apenas nesta Issue (CA-19); nenhum arquivo de #50 a importa. */
export interface IdentityDocReaderPort {
  readForReview(id: string): Promise<{ readonly bytes: Uint8Array; readonly type: 'image/jpeg' | 'application/pdf' } | null>;
}

export type IdentityDocIssueCode =
  | 'new'
  | 'replay'
  | 'replay_received'
  | 'no_profile'
  | 'email_unverified'
  | 'state_denied'
  | 'doc_limit'
  | 'cap';

export interface IdentityDocIssueInput {
  readonly userId: string;
  readonly clientUploadId: string;
  readonly declaredType: IdentityDocDeclaredType;
  readonly declaredBytes: number;
  readonly nowMs: number;
  readonly globalBytesCap: number;
}

export interface IdentityDocIssueResult {
  readonly code: IdentityDocIssueCode;
  readonly id: string | null;
  readonly status: 'em_envio' | 'recebido' | null;
}

export type IdentityDocConfirmBeginCode = 'begin' | 'replay' | 'not_found' | 'expired' | 'busy' | 'too_many';

export interface IdentityDocConfirmBeginResult {
  readonly code: IdentityDocConfirmBeginCode;
  readonly attempt: number | null;
  readonly declaredType: IdentityDocDeclaredType | null;
}

export type IdentityDocConfirmDoneCode = 'received' | 'lost' | 'gone';
export type IdentityDocDeleteCode = 'deleted' | 'not_found' | 'already_analyzed';

export interface IdentityDocListItem {
  readonly id: string;
  readonly kind: 'imagem' | 'pdf';
  readonly status: 'em_envio' | 'recebido';
  readonly receivedAt: string | null;
  readonly deletable: boolean;
}

export interface IdentityDocSweepItem {
  readonly id: string;
  readonly stagingKey: boolean;
  readonly finalKey: boolean;
}

/** Banco (`private.idoc_*`, executado como app_system). Assinaturas em 107 §4.2. */
export interface IdentityDocStorePort {
  issue(input: IdentityDocIssueInput): Promise<IdentityDocIssueResult>;
  list(userId: string): Promise<{ readonly documents: readonly IdentityDocListItem[]; readonly slotsRemaining: number }>;
  confirmBegin(userId: string, id: string, nowMs: number, leaseS: number): Promise<IdentityDocConfirmBeginResult>;
  confirmDone(
    userId: string,
    id: string,
    attempt: number,
    storedType: 'image/jpeg' | 'application/pdf',
    storedBytes: number,
    sha256: Uint8Array,
    nowMs: number,
  ): Promise<IdentityDocConfirmDoneCode>;
  confirmRefuse(userId: string, id: string, attempt: number, reasonCode: string, nowMs: number): Promise<'refused' | 'lost' | 'gone'>;
  confirmRelease(id: string, attempt: number, count: boolean): Promise<void>;
  remove(userId: string, id: string, nowMs: number): Promise<IdentityDocDeleteCode>;
  sweep(nowMs: number, limit: number): Promise<readonly IdentityDocSweepItem[]>;
  purgeDone(ids: readonly string[]): Promise<number>;
  knownPending(ids: readonly string[]): Promise<readonly string[]>;
}

/** Cota por politica (mesma ideia de MediaRate; a implementacao vive em packages/db ou na composicao). */
export interface IdentityDocRateLimiterPort {
  check(policy: IdentityDocRatePolicy, valor: string): Promise<{ readonly ok: boolean; readonly retryAfterS: number }>;
  hit(policy: IdentityDocRatePolicy, valor: string): Promise<void>;
}
