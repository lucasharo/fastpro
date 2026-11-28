// H-015 | T-H015-01 (chaves e IP), 02 (IP), 03 (janelas), 04 (progressao), 05 (configuracao),
// 06 (429). Sem banco, sem rede. Desenho: docs/factory/50-DESENHO-H015.md §6.
import { describe, it, expect } from 'vitest';
import {
  RATE_LIMIT_DEFAULTS,
  RateKeyError,
  clampRetryAfter,
  codeLockSeconds,
  decideRateWindow,
  effectiveStrikes,
  normalizeClientIp,
  rateKeyMessage,
  rateLimitsFrom,
  rateLimited,
  worstRetryAfter,
} from '../src/identity/index.js';

const HOUR = 3600;
const DAY = 86_400;
const TEN_MIN = 600;
// 2099-01-01T12:00:00Z em epoch segundos, alinhado a 10 min e a 1 dia.
const T0 = Date.UTC(2099, 0, 1, 12, 0, 0) / 1000;

describe('T-H015-01 chaves de limite', () => {
  it('monta o texto com prefixo rl1 e campos fixos', () => {
    expect(rateKeyMessage('pedido', 'ip', '203.0.113.7')).toBe('rl1|pedido|ip|203.0.113.7');
    expect(rateKeyMessage('pedido', 'global_h', '*')).toBe('rl1|pedido|global_h|*');
    expect(rateKeyMessage('erro_codigo', 'email', 'a@example.test')).toBe(
      'rl1|erro_codigo|email|a@example.test',
    );
  });

  it('dominios distintos para o mesmo valor nao colidem', () => {
    const v = '203.0.113.7';
    const pedidoIp = rateKeyMessage('pedido', 'ip', v);
    const codigoIp = rateKeyMessage('codigo', 'ip', v);
    const pedidoGlobal = rateKeyMessage('pedido', 'global_h', v);
    expect(new Set([pedidoIp, codigoIp, pedidoGlobal]).size).toBe(3);
  });

  it('combinacao fora da tabela e erro, sem o valor na mensagem', () => {
    const segredo = 'segredo-sentinela@example.test';
    try {
      rateKeyMessage('codigo', 'email', segredo);
      expect.unreachable('deveria falhar');
    } catch (err) {
      expect(err).toBeInstanceOf(RateKeyError);
      expect((err as RateKeyError).code).toBe('combinacao_invalida');
      expect((err as Error).message).not.toContain('segredo');
    }
  });

  it('valor vazio e erro', () => {
    expect(() => rateKeyMessage('pedido', 'ip', '')).toThrow(RateKeyError);
  });
});

describe('T-H015-02 IP normalizado', () => {
  it('IPv6 do mesmo /64 gera a mesma chave', () => {
    const a = normalizeClientIp('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
    const b = normalizeClientIp('2001:0db8:0001:0002:1111:2222:3333:4444');
    expect(a.value).toBe(b.value);
    expect(a.value).toBe('2001:db8:1:2::/64');
    expect(a.ausente).toBe(false);
  });

  it('IPv6 de outro /64 gera chave diferente', () => {
    expect(normalizeClientIp('2001:db8:1:3::1').value).not.toBe(
      normalizeClientIp('2001:db8:1:2::1').value,
    );
  });

  it('IPv4 mapeado em IPv6 vira o mesmo IPv4', () => {
    expect(normalizeClientIp('::ffff:203.0.113.7').value).toBe('203.0.113.7');
    expect(normalizeClientIp('::ffff:203.0.113.7').value).toBe(
      normalizeClientIp('203.0.113.7').value,
    );
  });

  it('IPv6 com compressao "::" e zona sao aceitos', () => {
    expect(normalizeClientIp('2001:db8::1%eth0').value).toBe('2001:db8:0:0::/64');
  });

  it('ausente ou ilegivel vira desconhecido com metrica', () => {
    for (const raw of [undefined, null, '', '   ', 'nao-e-ip', '999.1.1.1', '1:2:3', '2001::1::2']) {
      expect(normalizeClientIp(raw)).toEqual({ value: 'desconhecido', ausente: true });
    }
  });

  it('nunca devolve o IP original para entrada invalida', () => {
    expect(normalizeClientIp('10.0.0.999').value).not.toContain('10.0.0.999');
  });
});

describe('T-H015-03 janelas e Retry-After', () => {
  const limit = 20;
  const bucketsWith = (count: number) => [{ windowStart: bucketStart(T0), count }];
  const bucketStart = (t: number) => Math.floor(t / TEN_MIN) * TEN_MIN;

  it('19 pedidos passam, 20 barram, 21 barram com o mesmo limite', () => {
    const decide = (count: number) =>
      decideRateWindow({
        nowSeconds: T0,
        bucketSeconds: TEN_MIN,
        spanSeconds: HOUR,
        limit,
        buckets: bucketsWith(count),
      });
    expect(decide(19).decision).toBe('permitido');
    expect(decide(20).decision).toBe('barrado');
    expect(decide(21).decision).toBe('barrado');
  });

  it('soma o balde atual com os anteriores dentro da hora', () => {
    const buckets = [
      { windowStart: bucketStart(T0) - 30 * 60, count: 10 },
      { windowStart: bucketStart(T0) - 10 * 60, count: 10 },
    ];
    const d = decideRateWindow({
      nowSeconds: T0,
      bucketSeconds: TEN_MIN,
      spanSeconds: HOUR,
      limit,
      buckets,
    });
    expect(d.decision).toBe('barrado');
  });

  it('balde mais antigo que a janela nao conta', () => {
    const buckets = [{ windowStart: bucketStart(T0) - 2 * HOUR, count: 100 }];
    expect(
      decideRateWindow({ nowSeconds: T0, bucketSeconds: TEN_MIN, spanSeconds: HOUR, limit, buckets })
        .decision,
    ).toBe('permitido');
  });

  it('Retry-After aponta para a saida do balde mais antigo com contagem', () => {
    const oldest = bucketStart(T0) - 20 * 60;
    const buckets = [
      { windowStart: oldest, count: 5 },
      { windowStart: bucketStart(T0), count: 15 },
    ];
    const d = decideRateWindow({
      nowSeconds: T0,
      bucketSeconds: TEN_MIN,
      spanSeconds: HOUR,
      limit,
      buckets,
    });
    expect(d).toEqual({ decision: 'barrado', retryAfterSeconds: oldest + HOUR - T0 });
  });

  it('diario fica ate 00:00 UTC', () => {
    const cur = Math.floor(T0 / DAY) * DAY;
    const d = decideRateWindow({
      nowSeconds: T0,
      bucketSeconds: DAY,
      spanSeconds: DAY,
      limit: 80,
      buckets: [{ windowStart: cur, count: 80 }],
    });
    expect(d).toEqual({ decision: 'barrado', retryAfterSeconds: cur + DAY - T0 });
  });

  it('diario zera na virada do dia UTC', () => {
    const cur = Math.floor(T0 / DAY) * DAY;
    const d = decideRateWindow({
      nowSeconds: cur + DAY + 5,
      bucketSeconds: DAY,
      spanSeconds: DAY,
      limit: 80,
      buckets: [{ windowStart: cur, count: 80 }],
    });
    expect(d.decision).toBe('permitido');
  });

  it('maior Retry-After quando mais de um limite barra', () => {
    const a = { decision: 'barrado' as const, retryAfterSeconds: 120 };
    const b = { decision: 'barrado' as const, retryAfterSeconds: 900 };
    const ok = { decision: 'permitido' as const };
    expect(worstRetryAfter([a, ok, b])).toBe(900);
    expect(worstRetryAfter([ok])).toBeNull();
  });

  it('Retry-After fica entre 1 e 86400', () => {
    expect(clampRetryAfter(0)).toBe(1);
    expect(clampRetryAfter(-50)).toBe(1);
    expect(clampRetryAfter(1.2)).toBe(2);
    expect(clampRetryAfter(10 * DAY)).toBe(86_400);
    expect(clampRetryAfter(Number.NaN)).toBe(86_400);
  });
});

describe('T-H015-04 progressao do bloqueio do codigo', () => {
  it('1o, 2o e 3o bloqueio duram 900, 3600 e 86400 s; 4o tambem 86400', () => {
    expect(codeLockSeconds(1)).toBe(900);
    expect(codeLockSeconds(2)).toBe(3600);
    expect(codeLockSeconds(3)).toBe(86_400);
    expect(codeLockSeconds(4)).toBe(86_400);
  });

  it('strike invalido e erro', () => {
    expect(() => codeLockSeconds(0)).toThrow(RangeError);
  });

  it('zera apos 7 dias sem erro, mas 6 dias e 23 horas nao zera', () => {
    const last = T0;
    expect(effectiveStrikes(2, last, last + 6 * DAY + 23 * HOUR)).toBe(2);
    expect(effectiveStrikes(2, last, last + 7 * DAY + 1)).toBe(0);
  });
});

describe('T-H015-05 configuracao', () => {
  it('sem valores usa o padrao', () => {
    expect(rateLimitsFrom({})).toEqual(RATE_LIMIT_DEFAULTS);
  });

  it('fora da faixa ou de tipo errado cai no padrao', () => {
    const r = rateLimitsFrom({
      pedidoIpHora: 4,
      pedidoGlobalHora: 'trinta',
      codigoIpHora: 9999,
      erroCodigoDia: 1.5,
    });
    expect(r.pedidoIpHora).toBe(RATE_LIMIT_DEFAULTS.pedidoIpHora);
    expect(r.pedidoGlobalHora).toBe(RATE_LIMIT_DEFAULTS.pedidoGlobalHora);
    expect(r.codigoIpHora).toBe(RATE_LIMIT_DEFAULTS.codigoIpHora);
    expect(r.erroCodigoDia).toBe(RATE_LIMIT_DEFAULTS.erroCodigoDia);
  });

  it('pedido global diario nunca passa de 90', () => {
    expect(rateLimitsFrom({ pedidoGlobalDia: 90 }).pedidoGlobalDia).toBe(90);
    expect(rateLimitsFrom({ pedidoGlobalDia: 91 }).pedidoGlobalDia).toBe(RATE_LIMIT_DEFAULTS.pedidoGlobalDia);
    expect(rateLimitsFrom({ pedidoGlobalDia: 500 }).pedidoGlobalDia).toBeLessThanOrEqual(90);
  });
});

describe('T-H015-06 forma do 429', () => {
  it('mesmo tipo e mesmo N geram resposta byte a byte igual', () => {
    expect(rateLimited('pedido', 120)).toEqual(rateLimited('pedido', 120));
  });

  it('cabecalhos fixos, sem Set-Cookie nem X-RateLimit', () => {
    const r = rateLimited('codigo', 900);
    expect(r.status).toBe(429);
    expect(r.headers).toEqual({
      'Retry-After': '900',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
    });
    expect(Object.keys(r.headers).some((k) => /^(set-cookie|x-ratelimit)/i.test(k))).toBe(false);
  });

  it('pedido usa muitos_pedidos e codigo usa muitas_tentativas', () => {
    expect(JSON.parse(rateLimited('pedido', 60).body)).toEqual({
      code: 'muitos_pedidos',
      retry_after_seconds: 60,
    });
    expect(JSON.parse(rateLimited('codigo', 60).body)).toEqual({
      code: 'muitas_tentativas',
      retry_after_seconds: 60,
    });
  });

  it('Retry-After do cabecalho e do corpo sao o mesmo inteiro entre 1 e 86400', () => {
    const r = rateLimited('pedido', 999_999);
    expect(r.headers['Retry-After']).toBe('86400');
    expect(JSON.parse(r.body).retry_after_seconds).toBe(86_400);
  });
});
