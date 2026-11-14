// Issue 54 (H-041) | Montagem das rotas do estado visivel do profissional a partir do ambiente. Liga so com
// DATABASE_URL_APP_SYSTEM, SITE_URL e a fabrica de cliente SQL da borda (mesmo cliente de /v1/professional/profile).
// Sem qualquer um deles devolve undefined e as rotas seguem inexistentes (404). Nunca le nem registra valores.
import { PgSessionRepository } from '@fastpro/db';
import type { SqlClient } from '@fastpro/db';
import { clienteDe } from './professional-profile-composicao.js';
import type { ProfessionalVerificationRouteOptions } from './professional-verification-route.js';
import { PgProfessionalVerificationStore } from './verification/pg-professional-verification-store.js';

type Ambiente = Readonly<Record<string, string | undefined>>;

export interface VerificacaoProfissionalOpcoes {
  /** Fabrica de cliente SQL do papel app_system (decidida na borda). Sem ela, nada e montado. */
  readonly abrirCliente?: (connectionString: string) => SqlClient;
  /** Relogio das rotas. Padrao: relogio do sistema. */
  readonly relogio?: { nowMs(): number };
}

function preenchida(valor: string | undefined): valor is string {
  return (valor ?? '').trim() !== '';
}

/** Opcoes de GET e POST de /v1/professional/verificacao, ou undefined quando faltar algum item. */
export function montarVerificacaoProfissional(
  env: Ambiente,
  opcoes: VerificacaoProfissionalOpcoes = {},
): ProfessionalVerificationRouteOptions | undefined {
  const url = env.DATABASE_URL_APP_SYSTEM;
  const siteUrl = env.SITE_URL;
  if (!preenchida(url) || !preenchida(siteUrl) || opcoes.abrirCliente === undefined) return undefined;

  const cliente = clienteDe(url, opcoes.abrirCliente);
  return {
    sessions: new PgSessionRepository(cliente),
    verification: new PgProfessionalVerificationStore(cliente),
    siteUrl,
    clock: opcoes.relogio ?? { nowMs: () => Date.now() },
  };
}
