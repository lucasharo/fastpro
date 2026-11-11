// H-011 | T-H011-31 (ordem de prioridade, parte offline), T-H011-34 (nao configurado nao marca
// entrega), T-H011-36 (nenhuma funcao de conta no caminho do desafio) e o handler do expurgo.
// Sem banco, sem rede. A parte com banco e o pipeline completo ficam em outras rodadas.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-011');
};

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { FakeClock, FakeEmailProvider } from '@fastpro/testkit';
import { comparePriority, type EmailMessage } from '@fastpro/domain';
import {
  ChallengeEmailProvider,
  PURGE_KIND,
  type ChallengeRow,
  type ChallengeStore,
  type CreateChallengeResult,
} from '../src/challenges.js';
import { AuthChallengePurgeHandler, registerChallengeHandlers } from '../src/challenges-jobs.js';
import { JobRegistry } from '../src/jobs-tick.js';
import { randomBytes } from 'node:crypto';
import { challengeAad, sealChallengeBlob } from '../src/challenges-crypto.js';

const key = randomBytes(32);

class RowStore implements ChallengeStore {
  readonly marked: string[] = [];
  constructor(private readonly row: ChallengeRow) {}
  async create(): Promise<CreateChallengeResult> {
    throw new Error('nao usado');
  }
  async findRow(): Promise<ChallengeRow | null> {
    return this.row;
  }
  async markDelivered(id: string): Promise<void> {
    this.marked.push(id);
  }
}

const ID = '33333333-3333-4333-8333-333333333333';

function msg(): EmailMessage {
  return {
    to: 'cliente@example.test',
    templateKey: 'acesso_login',
    params: { challenge_ref: ID },
    idempotencyKey: `ac:${ID}`,
  };
}

describe('T-H011-31 prioridade do acesso (parte offline)', () => {
  it('acesso (auth) sai antes de lembrete mesmo que o lembrete seja mais antigo', () => {
    const lembrete = { mailClass: 'lembrete' as const, createdAt: '2026-11-11T09:00:00.000Z' };
    const auth = { mailClass: 'auth' as const, createdAt: '2026-11-11T10:00:00.000Z' };
    expect(comparePriority(auth, lembrete)).toBeLessThan(0);
    expect(comparePriority(lembrete, auth)).toBeGreaterThan(0);
  });
});

describe('T-H011-34 nao configurado ou cota negada: nada marcado como entregue', () => {
  it('resultado de nao_configurado passa sem marcar entrega; o desafio segue para novo envio', async () => {
    const provedor = new FakeEmailProvider().queue({
      kind: 'nao_configurado',
      code: 'dominio_nao_verificado',
    });
    const segredos = sealChallengeBlob(
      key,
      JSON.stringify({ token: 'token-sintetico', code: '123456' }),
      challengeAad(ID, 'secrets_enc'),
    );
    const store = new RowStore({
      id: ID,
      active: true,
      emailEnc: null,
      secretsEnc: segredos,
      delivered: false,
    });
    const decorado = new ChallengeEmailProvider(provedor, store, {
      key,
      siteUrl: 'https://app.example.test',
      clock: new FakeClock(),
    });
    const res = await decorado.send(msg());
    expect(res.kind).toBe('nao_configurado');
    expect(provedor.calls.length).toBe(1);
    expect(store.marked).toEqual([]);
  });
});

describe('T-H011-36 caminho do desafio nunca toca conta (Supabase Auth)', () => {
  it('nenhum modulo do desafio referencia createUser, generateLink ou verifyOtp', () => {
    for (const arq of ['challenges.ts', 'challenges-crypto.ts', 'challenges-jobs.ts']) {
      const texto = readFileSync(new URL(`../src/${arq}`, import.meta.url), 'utf8');
      expect(/createUser|generateLink|verifyOtp|auth\.admin/.test(texto), arq).toBe(false);
    }
  });
});

describe('handler do expurgo auth.challenge.purge', () => {
  it('chama a funcao de expurgo com o instante do relogio e devolve as contagens', async () => {
    const chamadas: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      async query(sql: string, params: unknown[] = []) {
        chamadas.push({ sql, params });
        return { rows: [{ out_zerados: 2, out_removidos: 1 }] };
      },
    };
    const clock = new FakeClock('2026-11-11T12:00:00.000Z');
    const handler = new AuthChallengePurgeHandler(client, clock);
    const rep = await handler.purge();
    expect(rep).toEqual({ zerados: 2, removidos: 1 });
    expect(chamadas[0]?.sql).toContain('private.auth_challenge_purge');
    expect(chamadas[0]?.params).toEqual(['2026-11-11T12:00:00.000Z']);
  });

  it('o handler fica registrado com o tipo auth.challenge.purge', () => {
    const registry = new JobRegistry();
    registerChallengeHandlers(registry, { query: async () => ({ rows: [] }) }, new FakeClock());
    expect(PURGE_KIND).toBe('auth.challenge.purge');
    expect(registry.get(PURGE_KIND)).toBeDefined();
  });
});
