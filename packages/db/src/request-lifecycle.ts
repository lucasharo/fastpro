// Pacote A (H-061, H-077, H-078, H-080) | Adaptador das funcoes de ciclo do pedido e do aceite
// (migracao 20261123110000_request_complete_cancel_withdraw). Papel app_system; cada funcao confere o dono ou o
// proprio profissional antes de gravar.
import type { SqlClient } from './jobs-tick.js';

export type CodigoCiclo =
  | 'concluido'
  | 'sem_mudanca'
  | 'desfeito'
  | 'cancelado'
  | 'nao_encontrado'
  | 'estado_invalido'
  | 'prazo_encerrado';

export interface ResultadoCiclo {
  readonly outcome: CodigoCiclo;
  /** Status do pedido depois da operacao (null quando nao encontrado). */
  readonly status: string | null;
  readonly completedAt: string | null;
  readonly cancelledAt: string | null;
}

export type CodigoRetirada = 'retirado' | 'desistiu' | 'sem_mudanca' | 'nao_encontrado' | 'estado_invalido';

export interface ResultadoRetirada {
  readonly outcome: CodigoRetirada;
  readonly acceptanceId: string | null;
  readonly requestId: string | null;
  readonly withdrawnAt: string | null;
}

const texto = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null);

const CODIGOS_CICLO: readonly CodigoCiclo[] = [
  'concluido',
  'sem_mudanca',
  'desfeito',
  'cancelado',
  'nao_encontrado',
  'estado_invalido',
  'prazo_encerrado',
];
const CODIGOS_RETIRADA: readonly CodigoRetirada[] = ['retirado', 'desistiu', 'sem_mudanca', 'nao_encontrado', 'estado_invalido'];

function codigo<T extends string>(valor: unknown, validos: readonly T[], padrao: T): T {
  return validos.find((v) => v === valor) ?? padrao;
}

export class PgRequestLifecycleStore {
  constructor(private readonly client: SqlClient) {}

  async concluir(requestId: string, customerId: string, agora: Date): Promise<ResultadoCiclo> {
    const r = await this.client.query('select * from private.request_complete($1, $2, $3)', [requestId, customerId, agora]);
    return lerCiclo(r.rows[0] ?? {});
  }

  async desfazerConclusao(requestId: string, customerId: string, agora: Date): Promise<ResultadoCiclo> {
    const r = await this.client.query('select * from private.request_uncomplete($1, $2, $3)', [requestId, customerId, agora]);
    return lerCiclo(r.rows[0] ?? {});
  }

  async cancelar(requestId: string, customerId: string, agora: Date): Promise<ResultadoCiclo> {
    const r = await this.client.query('select * from private.request_cancel($1, $2, $3)', [requestId, customerId, agora]);
    return lerCiclo(r.rows[0] ?? {});
  }

  async retirarAceite(acceptanceId: string, professionalId: string, agora: Date): Promise<ResultadoRetirada> {
    const r = await this.client.query('select * from private.acceptance_withdraw($1, $2, $3)', [acceptanceId, professionalId, agora]);
    const l = r.rows[0] ?? {};
    return {
      outcome: codigo(l.out_outcome, CODIGOS_RETIRADA, 'nao_encontrado'),
      acceptanceId: texto(l.out_acceptance_id),
      requestId: texto(l.out_request_id),
      withdrawnAt: iso(l.out_withdrawn_at),
    };
  }
}

function lerCiclo(l: Record<string, unknown>): ResultadoCiclo {
  return {
    outcome: codigo(l.out_outcome, CODIGOS_CICLO, 'nao_encontrado'),
    status: texto(l.out_status),
    completedAt: iso(l.out_completed_at),
    cancelledAt: iso(l.out_cancelled_at),
  };
}
