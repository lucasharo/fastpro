// H-009/H-019/H-093 | Ponto de montagem das integracoes da funcao da API. Le o ambiente (um objeto de nomes e
// valores, nunca registrado) e devolve as dependencias que estao completas. Qualquer falta deixa a parte
// undefined: a rota correspondente continua inexistente (404) e a pendencia vai so com o NOME da variavel.
// Nao ha interruptor de envio: o e-mail so existe com o provedor montado; o destinatario fica preso a
// conta cadastrada pelo adaptador (RESEND_ACCOUNT_RECIPIENT).
import {
  createAuthAwareRenderer,
  createEmailProvider,
  createFetchHttpTransport,
  createMinimalRenderer,
  EmailConfigError,
} from '@fastpro/email';
import type { ClockPort, EmailProviderPort } from '@fastpro/domain';
import {
  CATALOG_DATABASE_URL_ENV,
  CATALOG_RATE_KEY_ENV,
  CATALOG_RATE_KEY_MIN_LENGTH,
  CATALOG_SITE_URL_ENV,
  montarCatalogo,
  type CatalogPortsFactory,
  type CatalogEnv,
} from './catalog/compose.js';
import type { CatalogRouteOptions } from './catalog/catalog-route.js';

/** Nomes da busca que faltam (so nomes; a chave curta aparece marcada, sem tamanho nem valor). */
function faltantesCatalogo(env: CatalogEnv): readonly string[] {
  const faltam: string[] = [];
  if (!env[CATALOG_DATABASE_URL_ENV]) faltam.push(CATALOG_DATABASE_URL_ENV);
  const chave = env[CATALOG_RATE_KEY_ENV];
  if (!chave) faltam.push(CATALOG_RATE_KEY_ENV);
  else if (chave.length < CATALOG_RATE_KEY_MIN_LENGTH) faltam.push(`${CATALOG_RATE_KEY_ENV} (curta)`);
  if (!env[CATALOG_SITE_URL_ENV]) faltam.push(CATALOG_SITE_URL_ENV);
  return faltam;
}

/** Variaveis exigidas pelo provedor de e-mail (RESEND_VERIFIED_DOMAIN nao e exigido: sem dominio). */
export const EMAIL_ENV_OBRIGATORIAS = [
  'APP_ENV',
  'EMAIL_PROVIDER',
  'EMAIL_FROM',
  'RESEND_API_KEY',
  'RESEND_ACCOUNT_RECIPIENT',
] as const;

export type ComposicaoEnv = CatalogEnv;

export interface ComposicaoOpcoes {
  /** Fabrica de portas da busca sobre o pool real. Sem ela a busca nao liga (ver fabrica-pg.ts). */
  readonly fabricaCatalogo?: CatalogPortsFactory;
  /** Relogio do provedor de e-mail. Padrao: relogio do sistema. */
  readonly clock?: ClockPort;
}

export interface Integracoes {
  /** Opcoes da busca de servico (H-019), ou undefined (404). */
  readonly catalog: CatalogRouteOptions | undefined;
  /** Provedor de e-mail (Resend). Construido, nunca usado para envio pela composicao. */
  readonly email: EmailProviderPort | undefined;
  /** Nomes (nunca valores) que impedem cada integracao de ligar. */
  readonly pendencias: readonly string[];
}

const RELOGIO_PADRAO: ClockPort = {
  nowMs: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

function preenchida(env: ComposicaoEnv, nome: string): boolean {
  return (env[nome] ?? '').trim() !== '';
}

/** Monta o e-mail so com as variaveis completas. Configuracao invalida vira pendencia, sem detalhe. */
function montarEmail(
  env: ComposicaoEnv,
  relogio: ClockPort,
): { readonly email: EmailProviderPort | undefined; readonly pendencias: readonly string[] } {
  const faltam = EMAIL_ENV_OBRIGATORIAS.filter((nome) => !preenchida(env, nome));
  if (faltam.length > 0) return { email: undefined, pendencias: faltam };
  try {
    const email = createEmailProvider(env, {
      http: createFetchHttpTransport(),
      renderer: createAuthAwareRenderer(createMinimalRenderer()),
      clock: relogio,
    });
    return { email, pendencias: [] };
  } catch (erro) {
    if (erro instanceof EmailConfigError) {
      return { email: undefined, pendencias: ['EMAIL (configuracao recusada pelo adaptador)'] };
    }
    throw erro;
  }
}

/**
 * Ponto de montagem. Funcao pura sobre o ambiente recebido: nao abre conexao, nao envia nada e nao
 * registra valores. Sem fabrica de pool, a busca nao liga mesmo com as variaveis completas.
 */
export function montarIntegracoes(env: ComposicaoEnv, opcoes: ComposicaoOpcoes = {}): Integracoes {
  const pendencias: string[] = [];

  const catalogFaltantes = faltantesCatalogo(env);
  pendencias.push(...catalogFaltantes);
  if (catalogFaltantes.length === 0 && opcoes.fabricaCatalogo === undefined) {
    pendencias.push('fabrica do pool da busca (ainda nao montada na funcao)');
  }
  const catalog = montarCatalogo(env, opcoes.fabricaCatalogo);

  const { email, pendencias: pendenciasEmail } = montarEmail(env, opcoes.clock ?? RELOGIO_PADRAO);
  pendencias.push(...pendenciasEmail);

  return { catalog, email, pendencias };
}
