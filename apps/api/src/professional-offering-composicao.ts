// H-036 | Montagem das rotas de servicos, base e raio (/v1/professional/profile/services e /area) a partir do ambiente.
// So liga com TODOS os itens presentes: papel app_system (DATABASE_URL_APP_SYSTEM), SITE_URL, a chave de hash do
// endereco (ADDRESS_HASH_KEY, com tamanho minimo), a chave dos baldes de taxa (PROFILE_RATE_HMAC_KEY) e o provedor
// de geocodificacao permanente. O provedor real da Mapbox so entra depois de BLQ-EXEC (decisao 116): sem ele, a
// rota continua inexistente (404). Nunca le, grava nem registra o valor das variaveis: so o nome aparece nas pendencias.
import { createHmac } from 'node:crypto';
import { PgGeoPointStore, PgProfessionalOffering, PgSessionRepository, type SqlClient } from '@fastpro/db';
import { parseBreakerCaps } from '@fastpro/domain';
import { createAddressHasher } from './geo/address-hash.js';
import { ensurePermanentPoint } from './geo/permanent-geocode-service.js';
import type { GeocodingPermanentPort } from './geo/permanent-ports.js';
import type { ProfessionalOfferingRouteOptions } from './professional-offering-route.js';

/** Variaveis fixas exigidas (nomes). */
export const OFERTA_PROFISSIONAL_ENV_OBRIGATORIAS = [
  'DATABASE_URL_APP_SYSTEM',
  'SITE_URL',
  'ADDRESS_HASH_KEY',
  'PROFILE_RATE_HMAC_KEY',
] as const;
/** Tamanho minimo da chave dos baldes de taxa (mesmo criterio de ADDRESS_HASH_KEY). */
export const PROFILE_RATE_HMAC_KEY_MIN_LENGTH = 32;

type Ambiente = Readonly<Record<string, string | undefined>>;

export interface OfertaProfissionalOpcoes {
  /** Fabrica de cliente SQL do papel app_system (decidida na borda). Sem ela, nada e montado. */
  readonly abrirCliente?: (connectionString: string) => SqlClient;
  /** Relogio das rotas. Padrao: relogio do sistema. */
  readonly relogio?: { nowMs(): number };
  /** Provedor de geocodificacao permanente. Ausente = rota desligada (BLQ-EXEC, decisao 116). */
  readonly provedor?: GeocodingPermanentPort;
}

export interface OfertaProfissionalMontagem {
  /** Opcoes das rotas, ou undefined quando faltar qualquer item. */
  readonly options: ProfessionalOfferingRouteOptions | undefined;
  /** Nomes (nunca valores) e itens que impedem as rotas de ligar. */
  readonly pendencias: readonly string[];
}

const clientes = new Map<string, SqlClient>();

function clienteDe(url: string, abrirCliente: (connectionString: string) => SqlClient): SqlClient {
  let cliente = clientes.get(url);
  if (cliente === undefined) {
    cliente = abrirCliente(url);
    clientes.set(url, cliente);
  }
  return cliente;
}

function preenchida(env: Ambiente, nome: string): boolean {
  return (env[nome] ?? '').trim() !== '';
}

export function montarOfertaProfissional(
  env: Ambiente,
  opcoes: OfertaProfissionalOpcoes = {},
): OfertaProfissionalMontagem {
  const pendencias: string[] = OFERTA_PROFISSIONAL_ENV_OBRIGATORIAS.filter((nome) => !preenchida(env, nome));
  if (opcoes.abrirCliente === undefined) pendencias.push('fabrica do cliente SQL da oferta (ainda nao montada na funcao)');
  if (opcoes.provedor === undefined) pendencias.push('provedor de geocodificacao permanente (BLQ-EXEC, decisao 116)');

  const url = env.DATABASE_URL_APP_SYSTEM;
  const siteUrl = env.SITE_URL;
  const chaveTaxa = env.PROFILE_RATE_HMAC_KEY ?? '';
  if (preenchida(env, 'PROFILE_RATE_HMAC_KEY') && chaveTaxa.length < PROFILE_RATE_HMAC_KEY_MIN_LENGTH) {
    pendencias.push('PROFILE_RATE_HMAC_KEY (tamanho minimo)');
  }
  let hashEndereco: ((chave: string) => string) | undefined;
  if (preenchida(env, 'ADDRESS_HASH_KEY')) {
    try {
      hashEndereco = createAddressHasher(env.ADDRESS_HASH_KEY ?? '');
    } catch {
      pendencias.push('ADDRESS_HASH_KEY (tamanho minimo)');
    }
  }
  if (
    pendencias.length > 0 ||
    !url ||
    !siteUrl ||
    hashEndereco === undefined ||
    opcoes.abrirCliente === undefined ||
    opcoes.provedor === undefined
  ) {
    return { options: undefined, pendencias };
  }

  const relogio = opcoes.relogio ?? { nowMs: () => Date.now() };
  const cliente = clienteDe(url, opcoes.abrirCliente);
  const store = new PgGeoPointStore({ client: cliente, subjectKind: 'professional_base', clock: () => relogio.nowMs() });
  const caps = parseBreakerCaps(env.MAPBOX_PERMANENT_SOFT_LIMIT, env.MAPBOX_PERMANENT_HARD_LIMIT);
  const provedor = opcoes.provedor;
  const hashDoEndereco = hashEndereco;

  return {
    options: {
      sessions: new PgSessionRepository(cliente),
      offering: new PgProfessionalOffering({ client: cliente }),
      locate: ({ userId, addressText, callsCap }) =>
        ensurePermanentPoint(
          { subject: userId, addressText, callsCap },
          { store, provider: provedor, hashAddress: hashDoEndereco, caps, clock: () => relogio.nowMs() },
        ),
      rateKey: (purpose, userId) =>
        createHmac('sha256', chaveTaxa).update(`${purpose}:${userId}`, 'utf8').digest('hex'),
      siteUrl,
      clock: relogio,
    },
    pendencias: [],
  };
}
