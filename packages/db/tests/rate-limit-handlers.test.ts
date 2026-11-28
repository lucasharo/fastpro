// H-015 | T-H015-10 (matriz cadastrado x nao cadastrado), 11 (429 nao cria desafio nem e-mail),
// 12 (sem mensagem de existencia), 13 (formato invalido sem tocar contadores), 14 (logs e metricas
// sem e-mail, IP, codigo ou token). Repositorio em memoria que segue as regras de 50 §1 e §3.
// Sem banco, sem rede. Desenho: docs/factory/50-DESENHO-H015.md §2, §6.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-015');
};

import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { FakeClock } from '@fastpro/testkit';
import {
  codeLockSeconds,
  decideChallengeLimit,
  decideRateWindow,
  effectiveStrikes,
  rateLimitsFrom,
  type RateBucket,
} from '@fastpro/domain';
import {
  requestChallenge,
  verifyChallengeCode,
  type AttemptCodeInput,
  type AttemptCodeResult,
  type ChallengeHttpResponse,
  type ChallengeRow,
  type ChallengeStore,
  type CreateChallengeResult,
  type RequestChallengeResult,
  type RequestLimitInput,
} from '../src/challenges.js';
import { challengeHmacHex } from '../src/challenges-crypto.js';

const PEPPER_IP = 'sentinela-pep-ip';
const PEPPER_EMAIL = 'sentinela-pep-email';
const PEPPER_CODE = 'sentinela-pep-code';
const LIMITS = rateLimitsFrom({});

/** Repositorio em memoria. `calls` registra a sequencia de chamadas (T-H015-10). */
class MemRateStore implements ChallengeStore {
  readonly calls: string[] = [];
  readonly challenges = new Map<string, { emailHash: string; purpose: string; codeHmac: string; consumed: boolean }>();
  private readonly pedidos = new Map<string, number[]>();
  private readonly counters = new Map<string, Map<number, number>>();
  private readonly locks = new Map<string, { strikes: number; lockedUntilS: number; lastErrorS: number }>();
  private seq = 0;

  async create(): Promise<CreateChallengeResult> {
    throw new Error('create nao usado com limites');
  }
  async findRow(): Promise<ChallengeRow | null> {
    return null;
  }
  async markDelivered(): Promise<void> {}

  private buckets(key: string): RateBucket[] {
    return [...(this.counters.get(key)?.entries() ?? [])].map(([windowStart, count]) => ({ windowStart, count }));
  }
  private decide(key: string, span: number, bucket: number, limit: number, nowS: number) {
    return decideRateWindow({ nowSeconds: nowS, bucketSeconds: bucket, spanSeconds: span, limit, buckets: this.buckets(key) });
  }
  private hit(key: string, bucket: number, nowS: number): void {
    const start = Math.floor(nowS / bucket) * bucket;
    const m = this.counters.get(key) ?? new Map<number, number>();
    m.set(start, (m.get(start) ?? 0) + 1);
    this.counters.set(key, m);
  }

  async request(input: RequestLimitInput): Promise<RequestChallengeResult> {
    this.calls.push('request');
    const nowS = Math.floor(input.nowMs / 1000);
    const checks = [
      { motivo: 'ip', d: this.decide(input.ipKey, 3600, 600, input.limits.pedidoIpHora, nowS) },
      { motivo: 'global_h', d: this.decide(input.globalHKey, 3600, 600, input.limits.pedidoGlobalHora, nowS) },
      { motivo: 'global_d', d: this.decide(input.globalDKey, 86_400, 86_400, input.limits.pedidoGlobalDia, nowS) },
    ];
    const barrados = checks.filter((c) => c.d.decision === 'barrado');
    if (barrados.length > 0) {
      const retry = Math.max(...barrados.map((c) => (c.d.decision === 'barrado' ? c.d.retryAfterSeconds : 0)));
      return { resultado: 'limite', retryAfterSeconds: retry, motivo: barrados[0]?.motivo ?? 'ip' };
    }

    const hist = this.pedidos.get(input.emailHash) ?? [];
    const email = decideChallengeLimit({
      nowMs: input.nowMs,
      createdAtMs: hist,
      limits: { minIntervalSeconds: 60, maxPerHour: 5 },
    });
    if (email.decision === 'espera') {
      return {
        resultado: email.motivo === 'intervalo' ? 'espera' : 'teto',
        retryAfterSeconds: email.retryAfterSeconds,
      };
    }

    this.pedidos.set(input.emailHash, [...hist, input.nowMs]);
    this.challenges.set(input.id, {
      emailHash: input.emailHash,
      purpose: input.purpose,
      codeHmac: input.codeHmac,
      consumed: false,
    });
    this.hit(input.ipKey, 600, nowS);
    this.hit(input.globalHKey, 600, nowS);
    this.hit(input.globalDKey, 86_400, nowS);
    this.seq += 1;
    return { resultado: 'criado', challengeId: input.id, outboxId: `outbox-${this.seq}` };
  }

  async activeId(emailHash: string, purpose: string): Promise<string | null> {
    this.calls.push('activeId');
    for (const [id, c] of this.challenges) {
      if (c.emailHash === emailHash && c.purpose === purpose && !c.consumed) return id;
    }
    return null;
  }

  async attemptCode(input: AttemptCodeInput): Promise<AttemptCodeResult> {
    this.calls.push('attemptCode');
    const nowS = Math.floor(input.nowMs / 1000);
    const lock = this.locks.get(input.emailKey);
    if (lock && lock.lockedUntilS > nowS) {
      return { resultado: 'bloqueado_codigo', retryAfterSeconds: lock.lockedUntilS - nowS };
    }
    const ipDecision = this.decide(input.ipKey, 3600, 600, input.limits.codigoIpHora, nowS);
    if (ipDecision.decision === 'barrado') {
      return { resultado: 'bloqueado_ip', retryAfterSeconds: ipDecision.retryAfterSeconds };
    }
    this.hit(input.ipKey, 600, nowS);

    const ch = input.challengeId ? this.challenges.get(input.challengeId) : undefined;
    const ativo = ch !== undefined && ch.emailHash === input.emailHash && ch.purpose === input.purpose && !ch.consumed;
    if (ativo && ch && ch.codeHmac === input.codeHmac) {
      ch.consumed = true;
      return { resultado: 'ok', retryAfterSeconds: null };
    }

    this.hit(input.emailKey, 3600, nowS);
    const prev = lock ?? { strikes: 0, lockedUntilS: 0, lastErrorS: nowS };
    let strikes = effectiveStrikes(prev.strikes, prev.lastErrorS, nowS);
    let lockedUntilS = prev.lockedUntilS;
    const soma = this.decide(input.emailKey, 86_400, 3600, input.limits.erroCodigoDia, nowS);
    if (soma.decision === 'barrado') {
      strikes += 1;
      lockedUntilS = nowS + codeLockSeconds(strikes);
      this.counters.delete(input.emailKey);
    }
    this.locks.set(input.emailKey, { strikes, lockedUntilS, lastErrorS: nowS });
    return { resultado: ativo ? 'errado' : 'invalido', retryAfterSeconds: null };
  }

  /** Quantidade de linhas de contador (para provar que nada foi tocado). */
  counterTotal(): number {
    let n = 0;
    for (const m of this.counters.values()) n += m.size;
    return n;
  }
}

class RecordingDispatch {
  readonly scheduled: string[] = [];
  schedule(outboxId: string): void {
    this.scheduled.push(outboxId);
  }
}

function deps(store: ChallengeStore, dispatch: RecordingDispatch, metric?: (n: string, l: Record<string, string>) => void) {
  return {
    store,
    secrets: {
      key: randomBytes(32),
      pepperEmail: PEPPER_EMAIL,
      pepperCode: PEPPER_CODE,
    },
    clock: new FakeClock(),
    dispatch,
    rate: { pepperIp: PEPPER_IP, limits: LIMITS, metric },
  };
}

function verifyDeps(store: ChallengeStore) {
  return {
    store,
    secrets: { key: randomBytes(32), pepperEmail: PEPPER_EMAIL, pepperCode: PEPPER_CODE },
    clock: new FakeClock(),
    rate: { pepperIp: PEPPER_IP, limits: LIMITS },
  };
}

const pedir = (store: MemRateStore, email: string, ip: string, dispatch = new RecordingDispatch()) =>
  requestChallenge(deps(store, dispatch), { email }, ip);

const codigo = (store: MemRateStore, email: string, code: string, ip = '198.51.100.9') =>
  verifyChallengeCode(verifyDeps(store), { email, code, purpose: 'login', clientIp: ip });

/** Forma comparavel de uma resposta (status, cabecalhos e corpo). */
const forma = (r: ChallengeHttpResponse) => ({ status: r.status, headers: r.headers, body: r.body });

const ALL_TEXT: string[] = [];
const registrar = (r: ChallengeHttpResponse) => {
  ALL_TEXT.push(JSON.stringify(r.body), JSON.stringify(r.headers));
  return r;
};

type Cenario = {
  readonly nome: string;
  /** Roda o cenario para um e-mail (repositorio novo a cada chamada) e devolve a resposta final. */
  readonly roda: (email: string) => Promise<{ resp: ChallengeHttpResponse; calls: string[]; store: MemRateStore }>;
};

const CENARIOS: Cenario[] = [
  {
    nome: '202 dentro do limite',
    roda: async (email) => {
      const store = new MemRateStore();
      const resp = await pedir(store, email, '203.0.113.1');
      return { resp: registrar(resp), calls: store.calls, store };
    },
  },
  {
    nome: '429 por IP',
    roda: async (email) => {
      const store = new MemRateStore();
      for (let i = 0; i < LIMITS.pedidoIpHora; i += 1) {
        await pedir(store, `outro${i}@example.test`, '203.0.113.2');
      }
      store.calls.length = 0;
      const resp = await pedir(store, email, '203.0.113.2');
      return { resp: registrar(resp), calls: store.calls, store };
    },
  },
  {
    nome: '429 global por hora',
    roda: async (email) => {
      const store = new MemRateStore();
      for (let i = 0; i < LIMITS.pedidoGlobalHora; i += 1) {
        await pedir(store, `g${i}@example.test`, `10.9.${Math.floor(i / 250)}.${i % 250}`);
      }
      store.calls.length = 0;
      const resp = await pedir(store, email, '10.8.0.1');
      return { resp: registrar(resp), calls: store.calls, store };
    },
  },
  {
    nome: '429 por intervalo do e-mail',
    roda: async (email) => {
      const store = new MemRateStore();
      await pedir(store, email, '203.0.113.3');
      store.calls.length = 0;
      const resp = await pedir(store, email, '203.0.113.4');
      return { resp: registrar(resp), calls: store.calls, store };
    },
  },
  {
    nome: '429 de bloqueio do codigo',
    roda: async (email) => {
      const store = new MemRateStore();
      for (let i = 0; i < 15; i += 1) await codigo(store, email, '000000');
      store.calls.length = 0;
      const resp = await codigo(store, email, '000000');
      return { resp: registrar(resp), calls: store.calls, store };
    },
  },
  {
    nome: 'codigo errado',
    roda: async (email) => {
      const store = new MemRateStore();
      await pedir(store, email, '203.0.113.5');
      store.calls.length = 0;
      const resp = await codigo(store, email, '000000');
      return { resp: registrar(resp), calls: store.calls, store };
    },
  },
];

describe('T-H015-10 matriz cadastrado x nao cadastrado', () => {
  for (const cenario of CENARIOS) {
    it(`${cenario.nome}: status, corpo, cabecalhos e chamadas iguais para os dois e-mails`, async () => {
      const cadastrado = await cenario.roda('cadastrado@example.test');
      const naoCadastrado = await cenario.roda('nao.cadastrado@example.test');
      expect(forma(cadastrado.resp)).toEqual(forma(naoCadastrado.resp));
      expect(cadastrado.calls).toEqual(naoCadastrado.calls);
    });
  }

  it('o 429 de IP e o de global trazem Retry-After inteiro e Cache-Control no-store', async () => {
    const ip = await CENARIOS[1]!.roda('a@example.test');
    expect(ip.resp.status).toBe(429);
    expect(ip.resp.headers['Cache-Control']).toBe('no-store');
    expect(Number(ip.resp.headers['Retry-After'])).toBeGreaterThan(0);
    expect(ip.resp.body).toEqual({ code: 'muitos_pedidos', retry_after_seconds: Number(ip.resp.headers['Retry-After']) });
  });

  it('o 429 de codigo usa muitas_tentativas e o de pedido muitos_pedidos', async () => {
    const codigoResp = await CENARIOS[4]!.roda('b@example.test');
    expect(codigoResp.resp.body).toMatchObject({ code: 'muitas_tentativas' });
    const pedidoResp = await CENARIOS[3]!.roda('b@example.test');
    expect(pedidoResp.resp.body).toMatchObject({ code: 'muitos_pedidos' });
  });
});

describe('T-H015-11 429 nao cria desafio nem saida de e-mail', () => {
  it('barrado por IP ou por intervalo nao cria desafio nem agenda envio', async () => {
    const store = new MemRateStore();
    const dispatch = new RecordingDispatch();
    for (let i = 0; i < LIMITS.pedidoIpHora; i += 1) {
      await pedir(store, `ip${i}@example.test`, '203.0.113.20', dispatch);
    }
    const antesDesafios = store.challenges.size;
    const antesEnvios = dispatch.scheduled.length;
    const barrado = await pedir(store, 'bloqueado@example.test', '203.0.113.20', dispatch);
    expect(barrado.status).toBe(429);
    expect(store.challenges.size).toBe(antesDesafios);
    expect(dispatch.scheduled.length).toBe(antesEnvios);

    await pedir(store, 'intervalo@example.test', '203.0.113.21', dispatch);
    const depoisDesafios = store.challenges.size;
    const intervalo = await pedir(store, 'intervalo@example.test', '203.0.113.22', dispatch);
    expect(intervalo.status).toBe(429);
    expect(store.challenges.size).toBe(depoisDesafios);
  });
});

describe('T-H015-12 nenhuma mensagem revela existencia de conta', () => {
  it('respostas de todos os cenarios nao contem frases de existencia', async () => {
    ALL_TEXT.length = 0;
    for (const cenario of CENARIOS) {
      await cenario.roda('cadastrado@example.test');
      await cenario.roda('nao.cadastrado@example.test');
    }
    const texto = ALL_TEXT.join(' ').toLowerCase();
    expect(ALL_TEXT.length).toBeGreaterThan(0);
    for (const proibida of ['não encontrado', 'nao encontrado', 'não cadastrado', 'nao cadastrado', 'já existe', 'ja existe']) {
      expect(texto.includes(proibida)).toBe(false);
    }
  });
});

describe('T-H015-13 formato invalido responde 422 sem tocar contadores', () => {
  it('e-mail invalido e codigo com formato errado nao chamam o repositorio', async () => {
    const store = new MemRateStore();
    const pedido = await requestChallenge(deps(store, new RecordingDispatch()), { email: 'nao-e-email' }, '203.0.113.30');
    expect(pedido.status).toBe(422);
    expect(pedido.body).toEqual({ code: 'pedido_invalido' });

    const verif = await codigo(store, 'ok@example.test', 'abc');
    expect(verif.status).toBe(422);
    expect(verif.body).toEqual({ code: 'codigo_invalido' });

    expect(store.calls).toEqual([]);
    expect(store.counterTotal()).toBe(0);
  });
});

describe('T-H015-14 logs e metricas sem e-mail, IP, codigo ou token', () => {
  it('nada registrado contem valores sentinela', async () => {
    const email = 'sentinela.mail@example.test';
    const ip = '203.0.113.240';
    const linhas: string[] = [];
    const espiar = (...args: unknown[]) => linhas.push(args.map((a) => String(a)).join(' '));
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(espiar),
      vi.spyOn(console, 'info').mockImplementation(espiar),
      vi.spyOn(console, 'warn').mockImplementation(espiar),
      vi.spyOn(console, 'error').mockImplementation(espiar),
    ];
    const metricas: Array<{ name: string; labels: Record<string, string> }> = [];
    try {
      const store = new MemRateStore();
      const dispatch = new RecordingDispatch();
      const metric = (name: string, labels: Record<string, string>) => metricas.push({ name, labels });
      await requestChallenge(deps(store, dispatch, metric), { email }, ip);
      await requestChallenge(deps(store, dispatch, metric), { email }, '');
      for (let i = 0; i < 15; i += 1) await codigo(store, email, '000000', ip);
      await codigo(store, email, '000000', ip);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }

    const tudo = [...linhas, ...metricas.map((m) => `${m.name} ${JSON.stringify(m.labels)}`), ...ALL_TEXT].join(' ');
    expect(tudo.includes(email)).toBe(false);
    expect(tudo.includes(ip)).toBe(false);
    expect(tudo.includes('000000')).toBe(false);
    expect(tudo.includes(PEPPER_IP) || tudo.includes(PEPPER_EMAIL) || tudo.includes(PEPPER_CODE)).toBe(false);
    expect(metricas.some((m) => m.name === 'rate.ip_ausente')).toBe(true);
    expect(challengeHmacHex(PEPPER_IP, ip)).toMatch(/^[0-9a-f]{64}$/);
  });
});
