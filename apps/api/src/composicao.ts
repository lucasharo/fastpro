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
import type { SqlClient } from '@fastpro/db';
import {
  montarAdministracaoCaso,
  montarConfirmacaoAdmin,
  ADMIN_CASO_ENV_OBRIGATORIAS,
  ADMIN_CONFIRMACAO_PORTAS_FALTANTES,
  type AdminConfirmacaoOpcoes,
} from './admin-composicao.js';
import type { AdminAccessCaseRouteOptions } from './admin-access-case-route.js';
import type { AdminStepUpRouteOptions } from './admin-step-up-route.js';
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
  /** Fabrica do cliente SQL do papel app_system (H-073). Sem ela, as rotas do caso nao ligam (404). */
  readonly abrirClienteSql?: (connectionString: string) => SqlClient;
  /** Portas da confirmacao recente (step-up, H-073): provedor de login e limites. Hoje sem adaptador. */
  readonly confirmacaoAdmin?: AdminConfirmacaoOpcoes;
}

export interface Integracoes {
  /** Opcoes da busca de servico (H-019), ou undefined (404). */
  readonly catalog: CatalogRouteOptions | undefined;
  /** Provedor de e-mail (Resend). Construido, nunca usado para envio pela composicao. */
  readonly email: EmailProviderPort | undefined;
  /** Rotas do caso de acesso a conversa (H-073), ou undefined (404). */
  readonly accessCase: AdminAccessCaseRouteOptions | undefined;
  /** Confirmacao recente do segundo fator (POST /v1/admin/session/step-up), ou undefined (404). */
  readonly adminStepUp: AdminStepUpRouteOptions | undefined;
  /** Nomes (nunca valores) que impedem cada integracao de ligar. */
  readonly pendencias: readonly string[];
  /** Nomes (nunca valores) que impedem as rotas do caso de acesso (H-073) de ligar. */
  readonly pendenciasCaso: readonly string[];
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

  // H-073: so com os nomes ADMIN_CASO_ENV_OBRIGATORIAS presentes e a fabrica SQL da borda.
  const pendenciasCaso: string[] = ADMIN_CASO_ENV_OBRIGATORIAS.filter((nome) => !preenchida(env, nome));
  if (pendenciasCaso.length === 0 && opcoes.abrirClienteSql === undefined) {
    pendenciasCaso.push('fabrica do cliente SQL do caso de acesso (ainda nao montada na funcao)');
  }
  const accessCase = montarAdministracaoCaso(env, { abrirCliente: opcoes.abrirClienteSql });

  // H-073 (60 §4): confirmacao recente. So liga com as tres portas; hoje o provedor e os limites faltam.
  const confirmacao = opcoes.confirmacaoAdmin ?? {};
  const adminStepUp = montarConfirmacaoAdmin(env, { ...confirmacao, abrirCliente: opcoes.abrirClienteSql });
  if (adminStepUp === undefined) pendenciasCaso.push(...ADMIN_CONFIRMACAO_PORTAS_FALTANTES);

  return { catalog, email, accessCase, adminStepUp, pendencias, pendenciasCaso };
}
