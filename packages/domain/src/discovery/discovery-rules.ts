// Issue 36 (H-023) | Regras puras da descoberta por raio e online nacional (docs/factory/97-DESENHO-H023.md, §2, §4 e §5).
// Sem banco e sem rede. A regra de casamento roda em private.discover_requests (migracao 20261113210000).
// Aqui ficam os limites de parametro e a faixa de incerteza que o teste e a documentacao assumem (decisao 104).

export const DISCOVERY_RADIUS_MIN_M = 5000;
export const DISCOVERY_RADIUS_MAX_M = 100000;
export const DISCOVERY_PAGE_DEFAULT = 50;
export const DISCOVERY_PAGE_MAX = 200;

/** Faixa (m) em que o resultado pode divergir da distancia real entre os pontos exatos: 710 m + 0,3 % do raio. */
export function discoveryUncertaintyM(radiusM: number): number {
  return 710 + 0.003 * radiusM;
}

export function isValidDiscoveryRadius(radiusM: unknown): radiusM is number {
  return (
    typeof radiusM === 'number' &&
    Number.isInteger(radiusM) &&
    radiusM >= DISCOVERY_RADIUS_MIN_M &&
    radiusM <= DISCOVERY_RADIUS_MAX_M
  );
}

export function isValidDiscoveryLimit(limit: unknown): limit is number {
  return typeof limit === 'number' && Number.isInteger(limit) && limit >= 1 && limit <= DISCOVERY_PAGE_MAX;
}

/**
 * Cursor de pagina (keyset). A chave e a distancia arredondada em metro: material interno, nunca vai a resposta
 * ao profissional (decisao 107). A codificacao opaca do cursor fica na rota (Issue 68).
 */
export interface DiscoveryCursor {
  readonly group: 0 | 1;
  readonly key: number;
  readonly requestId: string;
}

/** Cursor ausente ou completo (mesma regra "tudo ou nada" de private.discover_scan). */
export function isValidDiscoveryCursor(cursor: DiscoveryCursor | null | undefined): boolean {
  if (cursor == null) return true;
  return (
    (cursor.group === 0 || cursor.group === 1) &&
    Number.isInteger(cursor.key) &&
    cursor.key >= 0 &&
    typeof cursor.requestId === 'string' &&
    cursor.requestId.length > 0
  );
}
