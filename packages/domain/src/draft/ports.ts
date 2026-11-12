// H-025 | Portas do rascunho (docs/factory/74-DESENHO-H025.md, §2, §3). Implementadas em @fastpro/db.
// O dominio nao conhece banco nem rede: estas interfaces so descrevem o que a rota precisa.
import type {
  DraftFieldsPatch,
  DraftRatePolicy,
  DraftStatus,
  DraftUrgency,
  DraftView,
} from './request-draft.js';

/** Registro de rascunho como o banco o devolve (sem hash, IP ou dado de identificacao). */
export interface DraftRecord {
  readonly id: string;
  readonly status: DraftStatus;
  readonly serviceId: string | null;
  readonly addressText: string | null;
  readonly urgency: DraftUrgency | null;
  readonly description: string | null;
  /** Instante em ISO 8601 (UTC). */
  readonly expiresAt: string;
  readonly updatedAt: string;
}

/** Codigos de falha da escrita, sempre fixos (nenhum texto de banco sai). */
export type DraftStoreError = 'nao_encontrado' | 'servico_invalido';

export type DraftWriteResult =
  | { readonly ok: true; readonly draft: DraftRecord }
  | { readonly ok: false; readonly code: DraftStoreError };

export interface DraftCreateInput {
  /** SHA-256 em hexadecimal do segredo novo. O segredo em claro nunca vai ao banco. */
  readonly secretHash: string;
  /** HMAC-SHA256 do IP do pedido (nunca o IP em claro). */
  readonly ipHmac: string;
  readonly nowMs: number;
  /** SHA-256 do cookie vencido que sera marcado como descartado, ou null. */
  readonly expiredSecretHash: string | null;
  readonly fields: DraftFieldsPatch;
}

export interface DraftPatchInput {
  readonly secretHash: string;
  readonly nowMs: number;
  readonly fields: DraftFieldsPatch;
}

export interface DraftStorePort {
  /** Rascunho vivo (aberto ou aguardando_email, prazo nao vencido) do segredo; null caso contrario. */
  find(secretHash: string, nowMs: number): Promise<DraftRecord | null>;
  /** Cria o rascunho (estado aberto). Marca o cookie vencido como descartado, se informado. */
  create(input: DraftCreateInput): Promise<DraftWriteResult>;
  /** Salva campos parciais no rascunho vivo e renova o prazo (ate o teto de 30 dias). */
  patch(input: DraftPatchInput): Promise<DraftWriteResult>;
  /** Descarta o rascunho vivo (estado descartado). Falso quando nao havia rascunho vivo. */
  discard(secretHash: string, nowMs: number): Promise<boolean>;
}

export type DraftRateCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly retryAfterS: number };

export interface DraftRatePort {
  /** Consulta sem contar (rl_check). A chave ja vem em HMAC ou em hash; o adaptador so a prefixa. */
  check(policy: DraftRatePolicy, key: string, nowMs: number): Promise<DraftRateCheck>;
  /** Conta o pedido aceito (rl_hit), so depois do check e do sucesso da escrita. */
  hit(policy: DraftRatePolicy, key: string, nowMs: number): Promise<void>;
}

/**
 * Forma da resposta (desenho §1). Escolhe campo a campo: nada que nao esteja aqui sai ao navegador
 * (hash do segredo, IP-HMAC, e-mail e nome nunca passam por esta funcao).
 */
export function toDraftView(record: DraftRecord): DraftView {
  return {
    id: record.id,
    status: record.status,
    service_id: record.serviceId,
    address_text: record.addressText,
    urgency: record.urgency,
    description: record.description,
    expires_at: record.expiresAt,
    updated_at: record.updatedAt,
  };
}
