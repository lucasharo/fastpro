// H-073 (Issue 83) | Montagem das rotas de caso de acesso (/v1/admin/access-cases) a partir do ambiente.
// So monta com os NOMES presentes: DATABASE_URL_APP_SYSTEM (papel app_system) e ADMIN_BASE_URL, e com a
// fabrica de cliente SQL injetada pela borda (pool Pg; este modulo nao importa o driver). Sem qualquer um
// deles devolve undefined e a rota segue inexistente (404). Nunca le, grava nem registra o valor das variaveis:
// a string de conexao so vai para a fabrica. Um cliente por string de conexao (memoizado).
import { randomUUID } from 'node:crypto';
import { PgAccessCasePort, PgAdminSessionRepository, type SqlClient } from '@fastpro/db';
import type { AdminAuthPort, AdminLogger, AdminLoginLimits } from '@fastpro/domain';
import type { AdminAccessCaseRouteOptions } from './admin-access-case-route.js';
import type { AdminStepUpRouteOptions } from './admin-step-up-route.js';

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

/** Portas que faltam para a confirmacao recente (step-up, H-073 60 §4): nomes exatos, nunca valores. */
export const ADMIN_CONFIRMACAO_PORTAS_FALTANTES = [
  'AdminAuthPort (provedor de login admin: signInWithPasswordAndTotp, adaptador HTTP ainda nao existe)',
  'AdminLoginLimits (limites de login admin em Pg, adaptador ainda nao existe)',
] as const;

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
