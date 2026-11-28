// H-073 (Issue 83) | Montagem das rotas de caso de acesso (/v1/admin/access-cases) a partir do ambiente.
// So monta com os NOMES presentes: DATABASE_URL_APP_SYSTEM (papel app_system) e ADMIN_BASE_URL, e com a
// fabrica de cliente SQL injetada pela borda (pool Pg; este modulo nao importa o driver). Sem qualquer um
// deles devolve undefined e a rota segue inexistente (404). Nunca le, grava nem registra o valor das variaveis:
// a string de conexao so vai para a fabrica. Um cliente por string de conexao (memoizado).
import { randomUUID } from 'node:crypto';
import {
  challengeHmacHex,
  PgAccessCasePort,
  PgAdminLoginLimits,
  PgAdminSessionRepository,
  PgCatalogAdminPort,
  PgDualApprovalPort,
  PgOpsPanelReader,
  type SqlClient,
} from '@fastpro/db';
import type { AdminAuthPort, AdminLogger, AdminLoginLimits } from '@fastpro/domain';
import type { AdminAccessCaseRouteOptions } from './admin-access-case-route.js';
import type { AdminCatalogRouteOptions } from './admin-catalog-route.js';
import type { AdminDualApprovalRouteOptions } from './admin-dual-approval-route.js';
import type { AdminOpsRouteOptions } from './admin-ops-route.js';
import type { AdminStepUpRouteOptions } from './admin-step-up-route.js';
import { criarAuthAdminSupabase } from './admin-auth-supabase.js';

/** Variaveis exigidas para montar o caso (nomes; os valores nao saem deste modulo). */
export const ADMIN_CASO_ENV_OBRIGATORIAS = ['DATABASE_URL_APP_SYSTEM', 'ADMIN_BASE_URL'] as const;

export type AdminCasoEnv = Readonly<Partial<Record<(typeof ADMIN_CASO_ENV_OBRIGATORIAS)[number], string>>>;

export interface AdminCasoOpcoes {
  /** Fabrica de cliente SQL do papel app_system (decidida na borda). Sem ela, nada e montado. */
  readonly abrirCliente?: (connectionString: string) => SqlClient;
  /** Relogio das rotas. Padrao: relogio do sistema. */
  readonly relogio?: { nowMs(): number };
  /** Gerador do id do caso. Padrao: uuid aleatorio. */
  readonly novoIdCaso?: () => string;
}

const clientes = new Map<string, SqlClient>();

/** Um cliente por string de conexao (a fabrica da borda abre o pool uma vez). */
function clienteDe(url: string, abrirCliente: (connectionString: string) => SqlClient): SqlClient {
  let cliente = clientes.get(url);
  if (cliente === undefined) {
    cliente = abrirCliente(url);
    clientes.set(url, cliente);
  }
  return cliente;
}

/** Opcoes de accessCase para o app, ou undefined quando faltar qualquer nome ou a fabrica da borda. */
export function montarAdministracaoCaso(
  env: AdminCasoEnv,
  opcoes: AdminCasoOpcoes = {},
): AdminAccessCaseRouteOptions | undefined {
  const url = env.DATABASE_URL_APP_SYSTEM;
  const baseUrl = env.ADMIN_BASE_URL;
  if (!url || !baseUrl || opcoes.abrirCliente === undefined) return undefined;

  const cliente = clienteDe(url, opcoes.abrirCliente);
  const sessao = new PgAdminSessionRepository(cliente);
  return {
    guard: (secret, nowMs) => sessao.guard(secret, nowMs),
    deps: {
      cases: new PgAccessCasePort(cliente),
      newCaseId: opcoes.novoIdCaso ?? randomUUID,
    },
    baseUrl,
    clock: opcoes.relogio ?? { nowMs: () => Date.now() },
  };
}

/**
 * Painel operacional (H-108, 76 §2): guarda do console e leitura agregada (private.ops_panel_read) pelo papel
 * app_system. Mesmo molde de montarAdministracaoCaso: so monta com DATABASE_URL_APP_SYSTEM e a fabrica da borda;
 * sem eles a rota GET /v1/admin/ops/panel nao existe (404). A leitura so e chamada depois da guarda.
 */
export function montarPainelOperacional(
  env: AdminCasoEnv,
  opcoes: AdminCasoOpcoes = {},
): AdminOpsRouteOptions | undefined {
  const url = env.DATABASE_URL_APP_SYSTEM;
  if (!url || opcoes.abrirCliente === undefined) return undefined;

  const cliente = clienteDe(url, opcoes.abrirCliente);
  const sessao = new PgAdminSessionRepository(cliente);
  const leitor = new PgOpsPanelReader(cliente);
  return {
    guard: (secret, nowMs) => sessao.guard(secret, nowMs),
    ler: (nowMs) => leitor.ler(nowMs),
    clock: opcoes.relogio ?? { nowMs: () => Date.now() },
  };
}

/**
 * Rotas /v1/admin/catalog (H-107, 81 §1). So monta com DATABASE_URL_APP_SYSTEM, ADMIN_BASE_URL e a fabrica da borda;
 * sem qualquer um deles devolve undefined e as rotas seguem inexistentes (404). A guarda de cada requisicao
 * (sessao, aal2, catalog.manage) continua na rota; a porta so e chamada depois dela.
 */
export function montarCatalogoAdmin(
  env: AdminCasoEnv,
  opcoes: AdminCasoOpcoes = {},
): AdminCatalogRouteOptions | undefined {
  const url = env.DATABASE_URL_APP_SYSTEM;
  const baseUrl = env.ADMIN_BASE_URL;
  if (!url || !baseUrl || opcoes.abrirCliente === undefined) return undefined;

  const cliente = clienteDe(url, opcoes.abrirCliente);
  const sessao = new PgAdminSessionRepository(cliente);
  return {
    guard: (secret, nowMs) => sessao.guard(secret, nowMs),
    port: new PgCatalogAdminPort(cliente),
    baseUrl,
    clock: opcoes.relogio ?? { nowMs: () => Date.now() },
  };
}

/**
 * Dupla aprovacao de estorno e suspensao (H-105, 80 §3). So monta com DATABASE_URL_APP_SYSTEM, ADMIN_BASE_URL e a
 * fabrica da borda; sem qualquer um deles as rotas /v1/admin/{refund|suspension}-approvals seguem 404. A guarda
 * de cada requisicao e a do banco; a porta so e chamada depois dela.
 */
export function montarAprovacaoDupla(
  env: AdminCasoEnv,
  opcoes: AdminCasoOpcoes = {},
): AdminDualApprovalRouteOptions | undefined {
  const url = env.DATABASE_URL_APP_SYSTEM;
  const baseUrl = env.ADMIN_BASE_URL;
  if (!url || !baseUrl || opcoes.abrirCliente === undefined) return undefined;

  const cliente = clienteDe(url, opcoes.abrirCliente);
  const sessao = new PgAdminSessionRepository(cliente);
  return {
    guard: (secret, nowMs) => sessao.guard(secret, nowMs),
    deps: { port: new PgDualApprovalPort(cliente), newId: () => randomUUID() },
    baseUrl,
    clock: opcoes.relogio ?? { nowMs: () => Date.now() },
  };
}

/** Provedor de login admin (Supabase Auth, H-073 60 §4): nomes exigidos; valores nunca saem deste modulo. */
export const ADMIN_AUTH_ENV_OBRIGATORIAS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] as const;
/** Limites de login admin (H-015): chaves HMAC do e-mail e do IP (pepper da borda). */
export const ADMIN_LIMITES_ENV_OBRIGATORIAS = ['PEPPER_EMAIL_HMAC', 'PEPPER_IP_HMAC'] as const;

type AmbienteQualquer = Readonly<Record<string, string | undefined>>;

/** Adaptador HTTP do provedor de login, ou undefined sem SUPABASE_URL e a chave publica. */
export function montarAuthAdmin(
  env: AmbienteQualquer,
  fetchHttp?: typeof fetch,
): Pick<AdminAuthPort, 'signInWithPasswordAndTotp'> | undefined {
  const baseUrl = env.SUPABASE_URL;
  const apiKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!baseUrl || !apiKey) return undefined;
  return criarAuthAdminSupabase({ baseUrl, apiKey, fetch: fetchHttp });
}

/** Limites de login sobre o limitador do banco, ou undefined sem os peppers, o papel app_system e a fabrica. */
export function montarLimitesAdmin(
  env: AmbienteQualquer,
  abrirCliente?: (connectionString: string) => SqlClient,
): AdminLoginLimits | undefined {
  const url = env.DATABASE_URL_APP_SYSTEM;
  const pepperEmail = env.PEPPER_EMAIL_HMAC;
  const pepperIp = env.PEPPER_IP_HMAC;
  if (!url || !pepperEmail || !pepperIp || abrirCliente === undefined) return undefined;
  const cliente = clienteDe(url, abrirCliente);
  return new PgAdminLoginLimits(cliente, {
    email: (email) => challengeHmacHex(pepperEmail, `admin-login-email:${email}`),
    ip: (ip) => challengeHmacHex(pepperIp, `admin-login-ip:${ip}`),
  });
}

export interface AdminConfirmacaoOpcoes {
  readonly abrirCliente?: (connectionString: string) => SqlClient;
  /** Provedor de login (senha e TOTP). Ainda nao existe adaptador no repositorio. */
  readonly auth?: Pick<AdminAuthPort, 'signInWithPasswordAndTotp'>;
  /** Limites de tentativas (H-015). Ainda nao existe adaptador no repositorio. */
  readonly limits?: AdminLoginLimits;
  readonly log?: AdminLogger;
  readonly relogio?: { nowMs(): number };
}

/** Opcoes de adminStepUp, ou undefined sem os nomes, a fabrica da borda e as tres portas acima. */
export function montarConfirmacaoAdmin(
  env: AdminCasoEnv,
  opcoes: AdminConfirmacaoOpcoes = {},
): AdminStepUpRouteOptions | undefined {
  const url = env.DATABASE_URL_APP_SYSTEM;
  const baseUrl = env.ADMIN_BASE_URL;
  if (!url || !baseUrl) return undefined;
  if (opcoes.abrirCliente === undefined || opcoes.auth === undefined || opcoes.limits === undefined || opcoes.log === undefined) {
    return undefined;
  }
  const cliente = clienteDe(url, opcoes.abrirCliente);
  return {
    repo: new PgAdminSessionRepository(cliente),
    auth: opcoes.auth,
    limits: opcoes.limits,
    log: opcoes.log,
    baseUrl,
    clock: opcoes.relogio ?? { nowMs: () => Date.now() },
  };
}
