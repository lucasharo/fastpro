// Issue 71 (H-058) | Montagem da rota de aceite a partir do ambiente (docs/factory/162-DESENHO-H058.md, §4.6, §8 fatia 5).
// Liga so com DATABASE_URL_APP_SYSTEM (papel app_system), SITE_URL (origem das mutacoes), DISCOVERY_CURSOR_KEY
// (de onde sai a chave do HMAC do limite de taxa, por HKDF com rotulo proprio, como na descoberta da #68), e as
// duas fabricas da borda: o cliente SQL (sessao, perfil e limite) e a conexao dedicada da transacao do aceite
// (BEGIN e COMMIT precisam de uma unica conexao; um pool de consultas soltas nao serve). Sem qualquer item, a rota
// nao existe (404 uniforme). Nunca le, grava nem registra o valor das chaves: a pendencia leva so o nome.
import { createHmac, hkdfSync } from 'node:crypto';
import { createDiscoveryCursorCodec } from '@fastpro/domain';
import {
  PgAcceptanceRateLimit,
  PgAcceptanceStore,
  PgProfessionalProfile,
  PgSessionRepository,
  type AcceptanceConnection,
  type SqlClient,
} from '@fastpro/db';
import { clienteDe } from '../professional-profile-composicao.js';
import type { AcceptanceRouteOptions } from './acceptance-route.js';

const DATABASE_URL_NOME = 'DATABASE_URL_APP_SYSTEM';
const SITE_URL_NOME = 'SITE_URL';
const CURSOR_KEY_NOME = 'DISCOVERY_CURSOR_KEY';
const RATE_SALT = 'fastpro-accept-rate-v1';
const RATE_INFO = 'accept-rate-hmac';

type Ambiente = Readonly<Record<string, string | undefined>>;

export interface AceiteOpcoes {
  /** Fabrica de cliente SQL do papel app_system (sessao, perfil e limite). Sem ela, nada e montado. */
  readonly abrirCliente?: (connectionString: string) => SqlClient;
  /**
   * Fabrica da conexao dedicada da transacao do aceite: cada chamada devolve uma conexao propria, que a
   * transacao usa do BEGIN ao COMMIT e depois libera. Sem ela, nada e montado (pendencia nomeada).
   */
  readonly abrirConexaoDedicada?: (connectionString: string) => () => Promise<AcceptanceConnection>;
  /** Relogio das rotas. Padrao: relogio do sistema. */
  readonly relogio?: { nowMs(): number };
}

export interface AceiteMontagem {
  /** Opcoes da rota, ou undefined quando faltar algum item fixo. */
  readonly options: AcceptanceRouteOptions | undefined;
  /** Nomes (nunca valores) que impedem a rota de ligar. */
  readonly pendencias: readonly string[];
}

function preenchida(env: Ambiente, nome: string): boolean {
  return (env[nome] ?? '').trim() !== '';
}

/** Chave do HMAC do limite do aceite: derivada da chave do cursor com rotulo proprio (dominio separado). */
function chaveDoLimite(chaveCursor: string): string {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(chaveCursor, 'utf8'), Buffer.from(RATE_SALT, 'utf8'), Buffer.from(RATE_INFO, 'utf8'), 32),
  ).toString('hex');
}

export function montarAceite(env: Ambiente, opcoes: AceiteOpcoes = {}): AceiteMontagem {
  const pendencias: string[] = [];
  if (!preenchida(env, DATABASE_URL_NOME)) pendencias.push(DATABASE_URL_NOME);
  if (!preenchida(env, SITE_URL_NOME)) pendencias.push(SITE_URL_NOME);
  if (!preenchida(env, CURSOR_KEY_NOME)) {
    pendencias.push(CURSOR_KEY_NOME);
  } else {
    try {
      createDiscoveryCursorCodec(env[CURSOR_KEY_NOME] ?? '');
    } catch {
      pendencias.push(`${CURSOR_KEY_NOME} (tamanho minimo de 32 caracteres)`);
    }
  }
  if (opcoes.abrirCliente === undefined) pendencias.push('fabrica do cliente SQL do aceite (ainda nao montada na funcao)');
  if (opcoes.abrirConexaoDedicada === undefined) {
    pendencias.push('fabrica da conexao dedicada do aceite (ainda nao montada na funcao)');
  }

  const url = env[DATABASE_URL_NOME];
  const siteUrl = env[SITE_URL_NOME];
  const chaveCursor = env[CURSOR_KEY_NOME];
  if (
    pendencias.length > 0 ||
    url === undefined ||
    siteUrl === undefined ||
    chaveCursor === undefined ||
    opcoes.abrirCliente === undefined ||
    opcoes.abrirConexaoDedicada === undefined
  ) {
    return { options: undefined, pendencias };
  }

  const relogio = opcoes.relogio ?? { nowMs: () => Date.now() };
  const cliente = clienteDe(url, opcoes.abrirCliente);
  const perfil = new PgProfessionalProfile({ client: cliente });
  const chaveLimite = chaveDoLimite(chaveCursor);
  return {
    options: {
      siteUrl,
      sessions: new PgSessionRepository(cliente),
      profissional: { existe: async (userId) => (await perfil.find(userId)) !== null },
      limite: new PgAcceptanceRateLimit({
        client: cliente,
        chaveDoProfissional: (professionalId) => createHmac('sha256', chaveLimite).update(professionalId).digest('hex'),
      }),
      service: {
        store: new PgAcceptanceStore({ connect: opcoes.abrirConexaoDedicada(url) }),
        clock: relogio,
      },
    },
    pendencias,
  };
}
