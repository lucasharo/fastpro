// H-019 | Montagem da busca de servico na composicao (docs/factory/64-DESENHO-H019.md, §3.1, §3.3).
// Liga a rota SO se as tres variaveis existirem com valor: URL do papel app_api, chave HMAC propria do
// limite de taxa (>= 32 caracteres) e SITE_URL. Qualquer falta, ou ausencia da fabrica de portas, devolve
// undefined: a rota continua inexistente (404). Nenhum valor e registrado aqui; so os nomes sao citados.
import type { CatalogRouteOptions } from './catalog-route.js';
import type { CatalogRateLimitPort, CatalogSearchPort } from './ports.js';

/** Papel app_api (menor privilegio). DATABASE_URL puro poderia apontar para o papel de migracao. */
export const CATALOG_DATABASE_URL_ENV = 'DATABASE_URL_APP_API' as const;
/** Chave propria do limite desta rota (separada das chaves de H-020, desenho §3.1). */
export const CATALOG_RATE_KEY_ENV = 'CATALOG_RATE_HMAC_KEY' as const;
export const CATALOG_RATE_KEY_MIN_LENGTH = 32;
export const CATALOG_SITE_URL_ENV = 'SITE_URL' as const;

export type CatalogEnv = Readonly<Record<string, string | undefined>>;

export interface CatalogPortsFactory {
  /** Cria as duas portas a partir dos valores ja validados. Em producao, usa o SqlClient real. */
  criar(configuracao: {
    readonly databaseUrl: string;
    readonly rateKey: string;
  }): { readonly search: CatalogSearchPort; readonly rate: CatalogRateLimitPort };
}

/**
 * Monta as opcoes da rota, ou devolve undefined (404). So liga com as tres variaveis presentes,
 * a chave com tamanho minimo e uma fabrica de portas. Sem fabrica, nunca liga.
 */
export function montarCatalogo(
  env: CatalogEnv,
  fabrica: CatalogPortsFactory | undefined,
): CatalogRouteOptions | undefined {
  const databaseUrl = env[CATALOG_DATABASE_URL_ENV];
  const rateKey = env[CATALOG_RATE_KEY_ENV];
  const siteUrl = env[CATALOG_SITE_URL_ENV];
  if (!databaseUrl || !siteUrl || !rateKey) return undefined;
  if (rateKey.length < CATALOG_RATE_KEY_MIN_LENGTH) return undefined;
  if (fabrica === undefined) return undefined;
  const { search, rate } = fabrica.criar({ databaseUrl, rateKey });
  return { search, rate, siteUrl };
}
