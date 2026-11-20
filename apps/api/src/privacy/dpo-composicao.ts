// Issue 120 (H-111) | Montagem do painel do DPO sobre direitos do titular (147-DESENHO-H111 §5.2).
// Liga so com DATABASE_URL_APP_SYSTEM (papel app_system) e ADMIN_BASE_URL, e com a fabrica do cliente SQL.
// Sem eles, as rotas /v1/admin/privacy/dsr-cases nao ligam (404 vazio). Nunca le, grava nem registra valores.
import { PgAdminSessionRepository, type SqlClient } from '@fastpro/db';
import type { PrivacyDpoRouteOptions } from './dpo-route.js';
import { PgDsrDpoSql, ServicoDsrDpo } from './dpo-service.js';
import { clienteDe } from './privacy-composicao.js';

export const DPO_PRIVACIDADE_ENV_OBRIGATORIAS = ['DATABASE_URL_APP_SYSTEM', 'ADMIN_BASE_URL'] as const;

type Ambiente = Readonly<Record<string, string | undefined>>;

export interface PrivacidadeDpoOpcoes {
  /** Fabrica de cliente SQL do papel app_system (decidida na borda). Sem ela, nada e montado. */
  readonly abrirCliente?: (connectionString: string) => SqlClient;
  /** Relogio das rotas. Padrao: relogio do sistema. */
  readonly relogio?: { nowMs(): number };
}

export interface PrivacidadeDpoMontagem {
  readonly options: PrivacyDpoRouteOptions | undefined;
  /** Nomes (nunca valores) que impedem as rotas do DPO de ligar. */
  readonly pendencias: readonly string[];
}

export function montarPrivacidadeDpo(env: Ambiente, opcoes: PrivacidadeDpoOpcoes = {}): PrivacidadeDpoMontagem {
  const pendencias: string[] = [];
  const url = (env.DATABASE_URL_APP_SYSTEM ?? '').trim();
  const baseUrl = (env.ADMIN_BASE_URL ?? '').trim();
  if (url === '') pendencias.push('DATABASE_URL_APP_SYSTEM');
  if (baseUrl === '') pendencias.push('ADMIN_BASE_URL');
  if (pendencias.length > 0 || opcoes.abrirCliente === undefined) return { options: undefined, pendencias };
  const relogio = opcoes.relogio ?? { nowMs: () => Date.now() };
  const cliente = clienteDe(url, opcoes.abrirCliente);
  const sessao = new PgAdminSessionRepository(cliente);
  return {
    options: {
      guard: (segredo, nowMs) => sessao.guard(segredo, nowMs),
      service: new ServicoDsrDpo(new PgDsrDpoSql(cliente)),
      baseUrl,
      clock: relogio,
    },
    pendencias,
  };
}
