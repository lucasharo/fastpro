// H-011 | Handler do job auth.challenge.purge (docs/factory/39-DESENHO-H011.md, §2 "Expurgo").
// Chama private.auth_challenge_purge: zera blobs de desafios terminais ou vencidos e remove linhas
// com mais de 24 h. Nao registra valores; so contagens. O job e enfileirado por dia pelo store.
import {
  registerJobHandler,
  type JobHandler,
  type JobRegistry,
  type SqlClient,
} from './jobs-tick.js';
import { PURGE_KIND } from './challenges.js';
import type { ClockPort } from '@fastpro/domain';

export interface PurgeReport {
  readonly zerados: number;
  readonly removidos: number;
}

export class AuthChallengePurgeHandler implements JobHandler {
  constructor(
    private readonly client: SqlClient,
    private readonly clock: ClockPort,
  ) {}

  async run(): Promise<void> {
    await this.purge();
  }

  /** Execucao direta (usada pelo handler e pelos testes). */
  async purge(): Promise<PurgeReport> {
    const res = await this.client.query(
      'select * from private.auth_challenge_purge($1::timestamptz)',
      [new Date(this.clock.nowMs()).toISOString()],
    );
    const r = res.rows[0] as { out_zerados: number; out_removidos: number } | undefined;
    return { zerados: Number(r?.out_zerados ?? 0), removidos: Number(r?.out_removidos ?? 0) };
  }
}

/** Registra o handler do expurgo no registro de jobs (chamado pela composicao do app). */
export function registerChallengeHandlers(
  registry: JobRegistry,
  client: SqlClient,
  clock: ClockPort,
): void {
  registerJobHandler(registry, PURGE_KIND, new AuthChallengePurgeHandler(client, clock));
}
