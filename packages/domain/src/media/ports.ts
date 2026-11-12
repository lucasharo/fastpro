// H-026 (Issue #39) | Portas da quarentena (docs/factory/88-DESENHO-H026.md, §1, §2, §4).
// O dominio nao conhece banco nem HTTP: as implementacoes ficam em @fastpro/db e na composicao.
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
}

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
