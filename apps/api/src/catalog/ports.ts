// H-019 | Portas da busca de servico (docs/factory/64-DESENHO-H019.md, §3.1, §3.3).
// A rota depende so destas interfaces. O adaptador de banco entra em db-adapter.ts; a porta real
// ainda nao esta ligada na composicao, entao a rota responde 503 (falha) por padrao.

/** Codigos fixos do adaptador de banco. A mensagem da excecao nunca sai (§3.3). */
export type CatalogDbErrorCode = 'db_error' | 'db_timeout';

export type CatalogSearchPortResult =
  | { readonly ok: true; readonly rows: readonly unknown[] }
  | { readonly ok: false; readonly code: CatalogDbErrorCode };

export interface CatalogSearchPort {
  /** Uma consulta por termo normalizado (private.catalog_search). Sem escrita e sem retentativa. */
  search(q: string): Promise<CatalogSearchPortResult>;
}

/** Porta real ainda nao ligada: nenhuma consulta ao banco; a rota responde 503 falha (§3.3). */
export const unwiredCatalogSearch: CatalogSearchPort = {
  async search() {
    return { ok: false, code: 'db_error' };
  },
};

export type CatalogRateCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly retryAfterS: number };

/** Limite de taxa por IP (§3.1). Chaves hasheadas (HMAC) pela implementacao, nunca o IP cru. */
export interface CatalogRateLimitPort {
  /** Consulta sem contar (rl_check). */
  check(ip: string): Promise<CatalogRateCheck>;
  /** Conta a busca aceita (rl_hit), so depois do check. */
  hit(ip: string): Promise<void>;
}

/**
 * Sem implementacao real de taxa nesta fatia: nao ha consulta ao banco enquanto a porta de busca
 * estiver desligada, entao a taxa nao protege nada aqui. Ligar com o adaptador de rl_check/rl_hit.
 */
export const unwiredCatalogRate: CatalogRateLimitPort = {
  async check() {
    return { ok: true };
  },
  async hit() {},
};
