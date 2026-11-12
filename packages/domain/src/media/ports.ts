// H-026 (Issue #39) | Portas da quarentena (docs/factory/88-DESENHO-H026.md, §1, §2, §4).
// O dominio nao conhece banco nem HTTP: as implementacoes ficam em @fastpro/db e na composicao.
// H-027 (Issue #40) | Portas da reducao (docs/factory/93-DESENHO-H027.md, §2 e §4).
import type { MediaRejectCode } from './reduce.js';

export type MediaStatus = 'pending' | 'ready' | 'rejected';

/** Foto como o banco a devolve, so o que a resposta pode mostrar (sem caminho, bucket ou tamanho). */
export interface MediaRecord {
  readonly id: string;
  readonly status: MediaStatus;
  readonly confirmed: boolean;
}

export type MediaIssueCode = 'new' | 'replay' | 'not_found' | 'photo_limit' | 'cap';
export type MediaFinalizeCode = 'confirmed' | 'replay' | 'not_found' | 'expired' | 'missing' | 'too_large';

export interface MediaIssueInput {
  /** SHA-256 do segredo do cookie do rascunho (o segredo em claro nunca vai ao banco). */
  readonly secretHash: string;
  /** uuid gerado pelo navegador por foto; chave de idempotencia por rascunho. */
  readonly clientUploadId: string;
  readonly type: string;
  readonly bytes: number;
  readonly nowMs: number;
  readonly globalCap: number;
}

export interface MediaIssueResult {
  readonly code: MediaIssueCode;
  readonly media: MediaRecord | null;
}

export interface MediaFinalizeResult {
  readonly code: MediaFinalizeCode;
  readonly media: MediaRecord | null;
}

export interface MediaStorePort {
  /** Emissao (media_issue): reserva a vaga ou devolve a repeticao. Nao assina URL. */
  issue(input: MediaIssueInput): Promise<MediaIssueResult>;
  /** Leitura por posse (media_get). Null = 404 uniforme. */
  get(secretHash: string, id: string, nowMs: number): Promise<MediaRecord | null>;
  /** Confirmacao (media_finalize). storedBytes null quando o objeto nao existe. */
  finalize(secretHash: string, id: string, storedBytes: number | null, nowMs: number): Promise<MediaFinalizeResult>;
  /** Expurgo fase A (media_sweep): ids marcados que ainda precisam sair do Storage. */
  sweep(nowMs: number, limit: number): Promise<readonly string[]>;
  /** Expurgo fase C (media_purge_done): apaga as linhas cujo objeto saiu. Devolve a contagem. */
  purgeDone(ids: readonly string[]): Promise<number>;
  /** Dos ids dados, quais ainda tem linha (varredura de orfaos). */
  known(ids: readonly string[]): Promise<readonly string[]>;
  /** Reducao, passo 1 (media_reduce_begin): posse por hash, lease e contagem de tentativa. */
  reduceBegin(secretHash: string, id: string, nowMs: number, leaseS: number): Promise<MediaReduceBeginResult>;
  /** Reducao, passo 2 (media_reduce_done): grava 'ready' so para a tentativa dona. */
  reduceDone(id: string, attempt: number, bytes: number, width: number, height: number, nowMs: number): Promise<MediaReduceDoneCode>;
  /** Reducao, recusa definitiva (media_reduce_reject). A vaga e liberada: 'rejected' nao conta. */
  reduceReject(id: string, attempt: number, code: MediaRejectCode, nowMs: number): Promise<MediaReduceRejectOut>;
  /** Libera a lease da tentativa dona; count false devolve a tentativa (media_reduce_release). */
  reduceRelease(id: string, attempt: number, count: boolean): Promise<boolean>;
  /** Marca que o original saiu da quarentena (media_original_removed; so ready ou rejected). */
  originalRemoved(id: string, nowMs: number): Promise<boolean>;
  /** Ids ready ou rejected cujo original ainda nao saiu (limpeza de sobras, decisao 82). */
  originalCleanupList(limit: number): Promise<readonly string[]>;
}

export type MediaReduceBeginCode = 'begin' | 'ready' | 'rejected' | 'busy' | 'not_confirmed' | 'not_found';
export interface MediaReduceBeginResult {
  readonly code: MediaReduceBeginCode;
  /** Numero da tentativa tomada (so em 'begin'). */
  readonly attempt: number | null;
  /** Motivo fixo da recusa (so em 'rejected'). */
  readonly rejectCode: MediaRejectCode | null;
  /** Verdadeiro quando o original ainda esta na quarentena e precisa sair. */
  readonly originalPending: boolean;
}
export type MediaReduceDoneCode = 'done' | 'lost' | 'gone';
export type MediaReduceRejectOut = 'rejected' | 'lost' | 'gone';

/**
 * Porta do Storage de quarentena. Somente o bucket fixo e chaves 'd/<uuid>'. Nenhum metodo le o conteudo:
 * nao ha download, listagem de nomes para o visitante nem assinatura de leitura (CA-08).
 */
export interface QuarantineStoragePort {
  /** URL de envio de uso unico (upsert false). A URL e segredo: nunca logada. */
  createUploadUrl(key: string, ttlS: number): Promise<{ readonly url: string }>;
  /** Metadado do objeto (tamanho), sem baixar bytes. Null quando nao existe. */
  stat(key: string): Promise<{ readonly bytes: number } | null>;
  /** Remove; objeto ja ausente conta como sucesso. Lanca em falha. */
  remove(key: string): Promise<void>;
  /** Chaves 'd/<uuid>' criadas antes de antesDeMs (para a varredura de orfaos). */
  listOlderThan(antesDeMs: number, limite: number): Promise<readonly string[]>;
}

/** Storage da reducao (interno ao servico de reducao, nunca exposto a rota; 93 §4.1). */
export interface MediaReduceStoragePort {
  /** Le o original da quarentena ('d/<id>'). Null quando o objeto nao existe. Lanca em falha de Storage. */
  readOriginal(id: string): Promise<Uint8Array | null>;
  /** Grava a versao reduzida ('p/<id>', upsert, image/jpeg). Sobrescreve a tentativa anterior. */
  putReduced(id: string, bytes: Uint8Array): Promise<void>;
  /** Metadado da versao reduzida (tamanho), sem baixar. Null quando nao existe. */
  statReduced(id: string): Promise<{ readonly bytes: number } | null>;
  /** Remove o original da quarentena; ausente conta como sucesso. */
  removeOriginal(id: string): Promise<void>;
  /** Remove a versao reduzida; ausente conta como sucesso. */
  removeReduced(id: string): Promise<void>;
}

/** Causas transitorias: tempo e memoria contam tentativa; o resto nao (decisoes 84 e 86). */
export type ReduceTransientCause = 'timeout' | 'memory' | 'unavailable' | 'ocupado';

export type ReduceOutcome =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly width: number; readonly height: number }
  | { readonly ok: false; readonly kind: 'definitive'; readonly code: MediaRejectCode }
  | { readonly ok: false; readonly kind: 'transient'; readonly cause: ReduceTransientCause };

/** Orcamento de pixels em voo: o redutor reserva a area lida antes de decodificar. Null = sem espaco no prazo. */
export interface ReduceBudgetPort {
  reservar(areaPx: number): Promise<{ liberar(): void } | null>;
}

/** Redutor de imagem (sharp no servidor; falso nos testes). Nenhuma mensagem de biblioteca atravessa a porta. */
export interface ImageReducerPort {
  reduce(bytes: Uint8Array, opts: { readonly deadlineMs: number; readonly orcamento?: ReduceBudgetPort }): Promise<ReduceOutcome>;
}
