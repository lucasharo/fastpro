// Issue 68 (H-055) | Montagem da rota de descoberta a partir do ambiente (docs/factory/153-DESENHO-H055.md, §4, §6; decisao 605).
// Liga so com DATABASE_URL_APP_SYSTEM (papel app_system), a fabrica do cliente SQL e DISCOVERY_CURSOR_KEY com pelo menos
// 32 caracteres. A chave e checada na subida, nunca numa requisicao. A chave do limite de taxa sai da mesma chave por HKDF
// com rotulo proprio (dominio separado), sem segredo novo. Sem qualquer item, a rota nao existe (404 uniforme).
// Nunca le, grava nem registra o valor das chaves: a pendencia leva so o nome.
import { createHmac, hkdfSync } from 'node:crypto';
import { createDiscoveryCursorCodec, type DiscoveryCursorCodec } from '@fastpro/domain';
import {
  PgDiscoveryPhotoStore,
  PgDiscoveryProjectionStore,
  PgDiscoveryRateLimit,
  PgDiscoveryStore,
  PgProfessionalProfile,
  PgSessionRepository,
  type SqlClient,
} from '@fastpro/db';
import { clienteDe } from '../professional-profile-composicao.js';
import type { DiscoveryRouteOptions } from './discovery-route.js';

const CURSOR_KEY_NOME = 'DISCOVERY_CURSOR_KEY';
const DATABASE_URL_NOME = 'DATABASE_URL_APP_SYSTEM';
const RATE_SALT = 'fastpro-discovery-rate-v1';
const RATE_INFO = 'rate-hmac';

type Ambiente = Readonly<Record<string, string | undefined>>;

export interface DescobertaOpcoes {
  /** Fabrica de cliente SQL do papel app_system (decidida na borda). Sem ela, nada e montado. */
  readonly abrirCliente?: (connectionString: string) => SqlClient;
  /** Relogio das rotas. Padrao: relogio do sistema. */
  readonly relogio?: { nowMs(): number };
}

export interface DescobertaMontagem {
  /** Opcoes da rota, ou undefined quando faltar algum item fixo. */
  readonly options: DiscoveryRouteOptions | undefined;
  /** Nomes (nunca valores) que impedem a rota de ligar. */
  readonly pendencias: readonly string[];
}

function preenchida(env: Ambiente, nome: string): boolean {
  return (env[nome] ?? '').trim() !== '';
}

/** Chave do HMAC do limite de taxa: derivada da chave do cursor com rotulo proprio (dominio separado). */
function chaveDoLimite(chaveCursor: string): string {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(chaveCursor, 'utf8'), Buffer.from(RATE_SALT, 'utf8'), Buffer.from(RATE_INFO, 'utf8'), 32),
  ).toString('hex');
}

/** Monta o codec do cursor; chave ausente ou curta devolve so o nome da pendencia. */
function codecDoCursor(env: Ambiente): { readonly codec?: DiscoveryCursorCodec; readonly pendencia?: string } {
  if (!preenchida(env, CURSOR_KEY_NOME)) return { pendencia: CURSOR_KEY_NOME };
  try {
    return { codec: createDiscoveryCursorCodec(env[CURSOR_KEY_NOME] ?? '') };
  } catch {
    return { pendencia: `${CURSOR_KEY_NOME} (tamanho minimo de 32 caracteres)` };
  }
}

export function montarDescoberta(env: Ambiente, opcoes: DescobertaOpcoes = {}): DescobertaMontagem {
  const pendencias: string[] = [];
  if (!preenchida(env, DATABASE_URL_NOME)) pendencias.push(DATABASE_URL_NOME);
  if (opcoes.abrirCliente === undefined) pendencias.push('fabrica do cliente SQL da descoberta (ainda nao montada na funcao)');
  const cursor = codecDoCursor(env);
  if (cursor.pendencia !== undefined) pendencias.push(cursor.pendencia);

  const url = env[DATABASE_URL_NOME];
  if (pendencias.length > 0 || url === undefined || cursor.codec === undefined || opcoes.abrirCliente === undefined) {
    return { options: undefined, pendencias };
  }

  const relogio = opcoes.relogio ?? { nowMs: () => Date.now() };
  const cliente = clienteDe(url, opcoes.abrirCliente);
  const perfil = new PgProfessionalProfile({ client: cliente });
  const chaveLimite = chaveDoLimite(env[CURSOR_KEY_NOME] ?? '');
  return {
    options: {
      sessions: new PgSessionRepository(cliente),
      profissional: { existe: async (userId) => (await perfil.find(userId)) !== null },
      limite: new PgDiscoveryRateLimit({
        client: cliente,
        chaveDoProfissional: (professionalId) => createHmac('sha256', chaveLimite).update(professionalId).digest('hex'),
      }),
      service: {
        store: new PgDiscoveryStore(cliente),
        projection: new PgDiscoveryProjectionStore(cliente),
        photos: new PgDiscoveryPhotoStore(cliente),
        cursor: cursor.codec,
        clock: relogio,
      },
    },
    pendencias,
  };
}
