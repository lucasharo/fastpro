// H-073 (Issue 83) | Montagem das rotas de caso de acesso (/v1/admin/access-cases) a partir do ambiente.
// So monta com os NOMES presentes: DATABASE_URL_APP_SYSTEM (papel app_system) e ADMIN_BASE_URL, e com a
// fabrica de cliente SQL injetada pela borda (pool Pg; este modulo nao importa o driver). Sem qualquer um
// deles devolve undefined e a rota segue inexistente (404). Nunca le, grava nem registra o valor das variaveis:
// a string de conexao so vai para a fabrica. Um cliente por string de conexao (memoizado).
import { randomUUID } from 'node:crypto';
import { PgAccessCasePort, PgAdminSessionRepository, type SqlClient } from '@fastpro/db';
import type { AdminAccessCaseRouteOptions } from './admin-access-case-route.js';

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

/** Opcoes de accessCase para o app, ou undefined quando faltar qualquer nome ou a fabrica da borda. */
export function montarAdministracaoCaso(
  env: AdminCasoEnv,
  opcoes: AdminCasoOpcoes = {},
): AdminAccessCaseRouteOptions | undefined {
  const url = env.DATABASE_URL_APP_SYSTEM;
  const baseUrl = env.ADMIN_BASE_URL;
  if (!url || !baseUrl || opcoes.abrirCliente === undefined) return undefined;

  let cliente = clientes.get(url);
  if (cliente === undefined) {
    cliente = opcoes.abrirCliente(url);
    clientes.set(url, cliente);
  }
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
