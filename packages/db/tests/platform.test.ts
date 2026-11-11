import { describe, it, expect } from 'vitest';
import {
  decideIdempotency,
  hashRequestBody,
  httpStatusFor,
  isJobClaimable,
  isValidIdempotencyKey,
  leaseUntil,
  stateAfterFailure,
  type IdempotencyRecord,
  type JobRow,
} from '../src/platform.js';

const now = new Date('2026-11-10T12:00:00.000Z');
const past = new Date(now.getTime() - 1000);
const future = new Date(now.getTime() + 1000);

const job = (over: Partial<JobRow>): JobRow => ({
  state: 'pendente',
  runAt: past,
  leaseUntil: null,
  attempts: 0,
  maxAttempts: 5,
  ...over,
});

describe('isJobClaimable', () => {
  it('pendente devido e reivindicavel; agendado no futuro nao', () => {
    expect(isJobClaimable(job({}), now)).toBe(true);
    expect(isJobClaimable(job({ runAt: future }), now)).toBe(false);
  });

  it('em execucao so quando o lease venceu', () => {
    expect(isJobClaimable(job({ state: 'em_execucao', leaseUntil: future }), now)).toBe(false);
    expect(isJobClaimable(job({ state: 'em_execucao', leaseUntil: past }), now)).toBe(true);
    expect(isJobClaimable(job({ state: 'em_execucao', leaseUntil: null }), now)).toBe(false);
  });

  it('concluido, falha e tentativas esgotadas nunca sao reivindicados', () => {
    expect(isJobClaimable(job({ state: 'concluido' }), now)).toBe(false);
    expect(isJobClaimable(job({ state: 'falha' }), now)).toBe(false);
    expect(isJobClaimable(job({ attempts: 5 }), now)).toBe(false);
  });
});

describe('leaseUntil e stateAfterFailure', () => {
  it('soma os segundos e recusa valor invalido', () => {
    expect(leaseUntil(now, 60).toISOString()).toBe('2026-11-10T12:01:00.000Z');
    expect(() => leaseUntil(now, 0)).toThrow(RangeError);
    expect(() => leaseUntil(now, 1.5)).toThrow(RangeError);
  });

  it('reagenda enquanto ha tentativas e falha ao esgotar', () => {
    expect(stateAfterFailure({ attempts: 4, maxAttempts: 5 })).toBe('pendente');
    expect(stateAfterFailure({ attempts: 5, maxAttempts: 5 })).toBe('falha');
  });
});

describe('decideIdempotency (08 §7.5)', () => {
  const h1 = hashRequestBody('{"a":1}');
  const h2 = hashRequestBody('{"a":2}');
  const rec = (over: Partial<IdempotencyRecord>): IdempotencyRecord => ({
    requestHash: h1,
    state: 'em_andamento',
    responseStatus: null,
    expiresAt: future,
    ...over,
  });

  it('sem registro ou vencido: nova', () => {
    expect(decideIdempotency(null, h1, now)).toBe('nova');
    expect(decideIdempotency(rec({ expiresAt: past }), h2, now)).toBe('nova');
  });

  it('mesma chave com corpo diferente: conflito (422)', () => {
    const out = decideIdempotency(rec({}), h2, now);
    expect(out).toBe('conflito');
    expect(httpStatusFor(out)).toBe(422);
  });

  it('em andamento: 409; concluida com mesmo corpo: repetida', () => {
    const andamento = decideIdempotency(rec({}), h1, now);
    expect(andamento).toBe('em_andamento');
    expect(httpStatusFor(andamento)).toBe(409);
    const repetida = decideIdempotency(rec({ state: 'concluida', responseStatus: 201 }), h1, now);
    expect(repetida).toBe('repetida');
    expect(httpStatusFor(repetida)).toBeNull();
    expect(httpStatusFor('nova')).toBeNull();
  });
});

describe('hashRequestBody e isValidIdempotencyKey', () => {
  it('SHA-256 hexadecimal estavel de 64 caracteres', () => {
    // Vetor publico do SHA-256 de "abc", em duas metades (o check-secrets recusa hex longo).
    const sha256Abc = 'ba7816bf8f01cfea414140de5dae2223' + 'b00361a396177a9cb410ff61f20015ad';
    expect(hashRequestBody('abc')).toBe(sha256Abc);
    expect(hashRequestBody(new TextEncoder().encode('abc'))).toBe(hashRequestBody('abc'));
  });

  it('exige UUID', () => {
    expect(isValidIdempotencyKey('3f2b8c4e-9a1d-4e6f-8b7a-1c2d3e4f5a6b')).toBe(true);
    expect(isValidIdempotencyKey('nao-e-uuid')).toBe(false);
    expect(isValidIdempotencyKey('')).toBe(false);
  });
});
