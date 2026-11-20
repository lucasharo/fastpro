// H-056 (Issue 69) | Montagem das fotos elegiveis a partir do ambiente (docs/factory/167-DESENHO-H056.md, A-6, A-10, §5).
// Liga so com DATABASE_URL_APP_SYSTEM (papel app_system), WATERMARK_TOKEN_SECRET e WATERMARK_ID_SALT (32+ caracteres)
// e a fabrica do cliente SQL. A chave do limite de taxa sai do segredo do token por HKDF com rotulo proprio.
// Sem qualquer item, as rotas nao existem (404 uniforme). A pendencia leva so o nome, nunca o valor.
import { createHmac, hkdfSync } from 'node:crypto';
import { WATERMARK_SECRET_MIN_LENGTH, createPhotoTokenCodec } from '@fastpro/domain';
import {
  PHOTO_VIEW_RATE_LIMIT,
  PgDiscoveryRateLimit,
  PgPhotoViewStore,
  PgProfessionalProfile,
  PgSessionRepository,
  type SqlClient,
} from '@fastpro/db';
import { clienteDe } from '../professional-profile-composicao.js';
import type { PhotoViewRouteOptions } from './photo-view-route.js';

const DATABASE_URL_NOME = 'DATABASE_URL_APP_SYSTEM';
const TOKEN_SECRET_NOME = 'WATERMARK_TOKEN_SECRET';
const ID_SALT_NOME = 'WATERMARK_ID_SALT';
/** Prefixo do balde de lista e link (A-10): a lista e o link do profissional e do dono compartilham o limite. */
const PREFIXO_LIMITE_FOTO = 'photo_view:';
const RATE_SALT = 'fastpro-photo-rate-v1';
const RATE_INFO = 'rate-hmac';

type Ambiente = Readonly<Record<string, string | undefined>>;

export interface FotosPedidoOpcoes {
  /** Fabrica de cliente SQL do papel app_system (decidida na borda). Sem ela, nada e montado. */
  readonly abrirCliente?: (connectionString: string) => SqlClient;
  /** Relogio das rotas. Padrao: relogio do sistema. */
  readonly relogio?: { nowMs(): number };
}

export interface FotosPedidoMontagem {
  /** Opcoes das rotas, ou undefined quando faltar algum item fixo. */
  readonly options: PhotoViewRouteOptions | undefined;
  /** Nomes (nunca valores) que impedem as rotas de ligar. */
  readonly pendencias: readonly string[];
}

function preenchida(env: Ambiente, nome: string): boolean {
  return (env[nome] ?? '').trim() !== '';
}

/** Chave do HMAC do limite de taxa: derivada do segredo do token com rotulo proprio (dominio separado). */
function chaveDoLimite(segredo: string): string {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(segredo, 'utf8'), Buffer.from(RATE_SALT, 'utf8'), Buffer.from(RATE_INFO, 'utf8'), 32),
  ).toString('hex');
}

export function montarFotosPedido(env: Ambiente, opcoes: FotosPedidoOpcoes = {}): FotosPedidoMontagem {
  const pendencias: string[] = [];
  if (!preenchida(env, DATABASE_URL_NOME)) pendencias.push(DATABASE_URL_NOME);
  if (opcoes.abrirCliente === undefined) pendencias.push('fabrica do cliente SQL das fotos (ainda nao montada na funcao)');
  for (const nome of [TOKEN_SECRET_NOME, ID_SALT_NOME]) {
    if (!preenchida(env, nome)) pendencias.push(nome);
    else if ((env[nome] ?? '').length < WATERMARK_SECRET_MIN_LENGTH) pendencias.push(`${nome} (tamanho minimo de 32 caracteres)`);
  }

  const url = env[DATABASE_URL_NOME];
  const segredo = env[TOKEN_SECRET_NOME];
  const abrir = opcoes.abrirCliente;
  if (pendencias.length > 0 || url === undefined || segredo === undefined || abrir === undefined) {
    return { options: undefined, pendencias };
  }

  const relogio = opcoes.relogio ?? { nowMs: () => Date.now() };
  const cliente = clienteDe(url, abrir);
  const perfil = new PgProfessionalProfile({ client: cliente });
  const chaveLimite = chaveDoLimite(segredo);
  return {
    options: {
      sessions: new PgSessionRepository(cliente),
      profissional: { existe: async (userId) => (await perfil.find(userId)) !== null },
      limite: new PgDiscoveryRateLimit({
        client: cliente,
        politica: PHOTO_VIEW_RATE_LIMIT,
        prefixo: PREFIXO_LIMITE_FOTO,
        chaveDoProfissional: (id) => createHmac('sha256', chaveLimite).update(id).digest('hex'),
      }),
      service: {
        store: new PgPhotoViewStore(cliente),
        codec: createPhotoTokenCodec(segredo),
        clock: relogio,
      },
    },
    pendencias,
  };
}

