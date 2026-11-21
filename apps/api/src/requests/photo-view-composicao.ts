// H-056 (Issue 69) | Montagem das fotos elegiveis a partir do ambiente (docs/factory/167-DESENHO-H056.md, A-6, A-7, A-10, §5).
// Liga so com DATABASE_URL_APP_SYSTEM (papel app_system), WATERMARK_TOKEN_SECRET e WATERMARK_ID_SALT (32+ caracteres),
// SUPABASE_URL e a chave secreta do Storage (leitura do bucket reduzido) e a fabrica do cliente SQL. A chave do limite
// de taxa sai do segredo do token por HKDF com rotulo proprio. Sem qualquer item, as rotas nao existem (404 uniforme).
// A pendencia leva so o nome, nunca o valor. O gate da marca e uma instancia unica do modulo (A-7).
import { createHmac, hkdfSync } from 'node:crypto';
import {
  WATERMARK_SECRET_MIN_LENGTH,
  createPhotoTokenCodec,
  type WatermarkComposerPort,
} from '@fastpro/domain';
import {
  PHOTO_DELIVER_RATE_LIMIT,
  PHOTO_VIEW_RATE_LIMIT,
  PgDiscoveryRateLimit,
  PgPhotoViewStore,
  PgProfessionalProfile,
  PgSessionRepository,
  SupabaseReducedPhotoReader,
  type SqlClient,
} from '@fastpro/db';
import { clienteDe } from '../professional-profile-composicao.js';
import { MEDIA_ENV_STORAGE } from '../media/media-composicao.js';
import { ReduceGate } from '../media/reduce-gate.js';
import { SharpWatermarkComposer } from '../media/watermark-composer-sharp.js';
import type { WatermarkedPhotoRouteOptions } from '../media/watermarked-photo-route.js';
import type { PhotoViewRouteOptions } from './photo-view-route.js';

const DATABASE_URL_NOME = 'DATABASE_URL_APP_SYSTEM';
const TOKEN_SECRET_NOME = 'WATERMARK_TOKEN_SECRET';
const ID_SALT_NOME = 'WATERMARK_ID_SALT';
const [STORAGE_URL_NOME, STORAGE_CHAVE_NOME] = MEDIA_ENV_STORAGE;
/** Prefixos dos baldes: lista e link compartilham um; a entrega da imagem tem o seu (A-10). */
const PREFIXO_LIMITE_FOTO = 'photo_view:';
const PREFIXO_LIMITE_ENTREGA = 'photo_deliver:';
const RATE_SALT = 'fastpro-photo-rate-v1';
const RATE_INFO = 'rate-hmac';

/** Gate da marca (A-7): duas renderizacoes em paralelo por instancia, espera de 1 s. Unico por modulo. */
const GATE_MARCA = new ReduceGate({ maxConcurrent: 2, waitMs: 1000 });

type Ambiente = Readonly<Record<string, string | undefined>>;

export interface FotosPedidoOpcoes {
  /** Fabrica de cliente SQL do papel app_system (decidida na borda). Sem ela, nada e montado. */
  readonly abrirCliente?: (connectionString: string) => SqlClient;
  /** Relogio das rotas. Padrao: relogio do sistema. */
  readonly relogio?: { nowMs(): number };
  /** Substitutos somente para teste: compositor, gate e leitor HTTP do Storage. Ausentes = adaptadores reais. */
  readonly compositor?: WatermarkComposerPort;
  readonly gate?: ReduceGate;
  readonly fetchImpl?: typeof fetch;
}

export interface FotosPedidoMontagem {
  /** Opcoes da lista e do link (H-056 fatia 3), ou undefined quando faltar algum item fixo. */
  readonly options: PhotoViewRouteOptions | undefined;
  /** Opcoes da entrega da imagem marcada (fatia 4), ou undefined pelo mesmo motivo. */
  readonly entrega: WatermarkedPhotoRouteOptions | undefined;
  /** Nomes (nunca valores) que impedem as fotos de ligar. */
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
  for (const nome of MEDIA_ENV_STORAGE) {
    if (!preenchida(env, nome)) pendencias.push(nome);
  }

  const url = env[DATABASE_URL_NOME];
  const segredo = env[TOKEN_SECRET_NOME];
  const salt = env[ID_SALT_NOME];
  const abrir = opcoes.abrirCliente;
  if (pendencias.length > 0 || url === undefined || segredo === undefined || salt === undefined || abrir === undefined) {
    return { options: undefined, entrega: undefined, pendencias };
  }

  const relogio = opcoes.relogio ?? { nowMs: () => Date.now() };
  const cliente = clienteDe(url, abrir);
  const perfil = new PgProfessionalProfile({ client: cliente });
  const chaveLimite = chaveDoLimite(segredo);
  const chaveDoProfissional = (id: string): string => createHmac('sha256', chaveLimite).update(id).digest('hex');
  const store = new PgPhotoViewStore(cliente);
  const codec = createPhotoTokenCodec(segredo);
  const limiteFotos = new PgDiscoveryRateLimit({
    client: cliente,
    politica: PHOTO_VIEW_RATE_LIMIT,
    prefixo: PREFIXO_LIMITE_FOTO,
    chaveDoProfissional,
  });
  const limiteEntrega = new PgDiscoveryRateLimit({
    client: cliente,
    politica: PHOTO_DELIVER_RATE_LIMIT,
    prefixo: PREFIXO_LIMITE_ENTREGA,
    chaveDoProfissional,
  });
  const leitor = new SupabaseReducedPhotoReader({
    baseUrl: (env[STORAGE_URL_NOME] ?? '').trim().replace(/\/+$/, ''),
    serviceKey: env[STORAGE_CHAVE_NOME] ?? '',
    ...(opcoes.fetchImpl !== undefined ? { fetchImpl: opcoes.fetchImpl } : {}),
  });

  return {
    options: {
      sessions: new PgSessionRepository(cliente),
      profissional: { existe: async (userId) => (await perfil.find(userId)) !== null },
      limite: limiteFotos,
      service: { store, codec, clock: relogio },
    },
    entrega: {
      service: {
        store,
        reader: leitor,
        composer: opcoes.compositor ?? new SharpWatermarkComposer(),
        gate: opcoes.gate ?? GATE_MARCA,
        codec,
        limite: limiteEntrega,
        idSalt: salt,
        clock: relogio,
      },
    },
    pendencias,
  };
}
