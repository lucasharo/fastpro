// H-005: regras puras (sem banco) do esqueleto de jobs com lease e idempotencia. Espelham as
// funcoes SQL de supabase/migrations/20261110130000_*.sql (private.job_claim, job_fail,
// idempotency_begin) e servem de especificacao testavel sem banco. Sem logica de produto.
import { createHash } from 'node:crypto';

export type JobState = 'pendente' | 'em_execucao' | 'concluido' | 'falha';

export interface JobRow {
  state: JobState;
  runAt: Date;
  leaseUntil: Date | null;
  attempts: number;
  maxAttempts: number;
}

/** Um job pode ser reivindicado se estiver devido (pendente) ou com lease vencido, e com tentativas. */
export function isJobClaimable(job: JobRow, now: Date): boolean {
  if (job.attempts >= job.maxAttempts) return false;
  if (job.state === 'pendente') return job.runAt.getTime() <= now.getTime();
  if (job.state === 'em_execucao') {
    return job.leaseUntil !== null && job.leaseUntil.getTime() < now.getTime();
  }
  return false;
}

/** Fim do lease concedido a partir de `now`. */
export function leaseUntil(now: Date, leaseSeconds: number): Date {
  if (!Number.isInteger(leaseSeconds) || leaseSeconds <= 0) {
    throw new RangeError('leaseSeconds deve ser inteiro positivo');
  }
  return new Date(now.getTime() + leaseSeconds * 1000);
}

/** Resultado de uma falha: reagenda enquanto houver tentativas; depois, estado terminal 'falha'. */
export function stateAfterFailure(
  job: Pick<JobRow, 'attempts' | 'maxAttempts'>,
): 'pendente' | 'falha' {
  return job.attempts >= job.maxAttempts ? 'falha' : 'pendente';
}

export type IdempotencyOutcome = 'nova' | 'repetida' | 'em_andamento' | 'conflito';

export interface IdempotencyRecord {
  requestHash: string;
  state: 'em_andamento' | 'concluida';
  responseStatus: number | null;
  expiresAt: Date;
}

/**
 * Decide o tratamento de uma requisicao com Idempotency-Key (08 §7.5).
 * - sem registro (ou vencido): 'nova'; mesma chave com corpo diferente: 'conflito' (HTTP 422);
 * - mesma chave e corpo, concluida: 'repetida' (reenvia a resposta); em execucao:
 *   'em_andamento' (HTTP 409 com Retry-After).
 */
export function decideIdempotency(
  existing: IdempotencyRecord | null,
  requestHash: string,
  now: Date,
): IdempotencyOutcome {
  if (existing === null || existing.expiresAt.getTime() <= now.getTime()) return 'nova';
  if (existing.requestHash !== requestHash) return 'conflito';
  return existing.state === 'concluida' ? 'repetida' : 'em_andamento';
}

/** Status HTTP associado a cada resultado (nulo = executar/reenviar a resposta gravada). */
export function httpStatusFor(outcome: IdempotencyOutcome): 409 | 422 | null {
  if (outcome === 'conflito') return 422;
  if (outcome === 'em_andamento') return 409;
  return null;
}

/** SHA-256 hexadecimal do corpo (texto ou bytes) como request_hash. */
export function hashRequestBody(body: string | Uint8Array): string {
  return createHash('sha256').update(body).digest('hex');
}

const IDEMPOTENCY_KEY =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** O cabecalho Idempotency-Key deve ser um UUID (08 §7.5). */
export function isValidIdempotencyKey(value: string): boolean {
  return IDEMPOTENCY_KEY.test(value);
}
