// Issue 57 (H-044) | Montagem da rota de ativacao do trial (POST /v1/billing/trial/activate) a partir do ambiente.
// So liga com DATABASE_URL_APP_SYSTEM presente e a fabrica de cliente SQL da borda (papel app_system). Sem isso,
// devolve undefined e a rota segue inexistente (404). Nunca le, grava nem registra o valor da variavel.
import { randomUUID } from 'node:crypto';
import { PgSessionRepository, createPgTrialActivation, type SqlClient } from '@fastpro/db';
import { clienteDe } from './professional-profile-composicao.js';
import type { ProfessionalTrialRouteOptions } from './professional-trial-route.js';

type Ambiente = Readonly<Record<string, string | undefined>>;

export interface AtivacaoTrialOpcoes {
  /** Fabrica de cliente SQL do papel app_system (decidida na borda). Sem ela, nada e montado. */
  readonly abrirCliente?: (connectionString: string) => SqlClient;
  /** Relogio da rota. Padrao: relogio do sistema. */
  readonly relogio?: { nowMs(): number };
}

export interface AtivacaoTrialMontagem {
  /** Opcoes da rota, ou undefined quando faltar qualquer item. */
  readonly options: ProfessionalTrialRouteOptions | undefined;
  /** Nomes (nunca valores) que impedem a rota de ligar. */
  readonly pendencias: readonly string[];
}

/** Monta as opcoes de POST /v1/billing/trial/activate. O id de correlacao da auditoria e gerado aqui. */
export function montarAtivacaoTrial(env: Ambiente, opcoes: AtivacaoTrialOpcoes = {}): AtivacaoTrialMontagem {
  const pendencias: string[] = [];
  const url = (env.DATABASE_URL_APP_SYSTEM ?? '').trim();
  if (url === '') pendencias.push('DATABASE_URL_APP_SYSTEM');
  if (opcoes.abrirCliente === undefined) pendencias.push('fabrica do cliente SQL do trial (ainda nao montada na funcao)');
  if (pendencias.length > 0 || opcoes.abrirCliente === undefined) {
    return { options: undefined, pendencias };
  }

  const cliente = clienteDe(url, opcoes.abrirCliente);
  const relogioMs = opcoes.relogio ?? { nowMs: () => Date.now() };
  return {
    options: {
      sessions: new PgSessionRepository(cliente),
      trial: createPgTrialActivation(cliente, { novaCorrelacao: () => randomUUID() }),
      clock: { now: () => new Date(relogioMs.nowMs()) },
    },
    pendencias: [],
  };
}
