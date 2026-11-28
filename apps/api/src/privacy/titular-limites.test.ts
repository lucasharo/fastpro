// Issue 120 (H-111) | Limites da API do titular (147 §6.1, P-F): 5 aberturas por dia e 3 step-ups por hora, com o
// limitador existente. Sem banco e sem rede: sessao, servico, emissor do step-up e limitador falsos. Chaves do
// limitador: 64 hex, sem o id do titular em claro e separadas por politica.
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SESSION_COOKIE_NAME, type RateWindowDecision } from '@fastpro/domain';
import type { SqlClient } from '@fastpro/db';
import { describe, expect, it } from 'vitest';
import {
  DSR_ABERTURA_POLITICA,
  DSR_STEPUP_POLITICA,
  chaveDoLimitePrivacidade,
  montarLimitesTitular,
} from './privacy-composicao.js';
import { handlePrivacyTitularRoute, type LimiteTaxaTitular, type PrivacyTitularRouteOptions } from './titular-route.js';
import type { ServicoDsrTitular } from './titular-service.js';

const SUJEITO = '11111111-1111-4111-8111-111111111111';
const CHAVE_IDEMPOTENCIA = 'idem-chave-120-limites';
const AGORA = Date.parse('2026-11-20T12:00:00Z');
const BARRADO: RateWindowDecision = { decision: 'barrado', retryAfterSeconds: 120 };
const PERMITIDO: RateWindowDecision = { decision: 'permitido' };

interface Resposta {
  status: number;
  corpo: unknown;
}

function limite(decisao: RateWindowDecision, registros: string[]): LimiteTaxaTitular {
  return {
    async check() {
      return decisao;
    },
    async record(titular: string) {
      registros.push(titular);
    },
  };
}

async function chamar(url: string, metodo: string, opts: PrivacyTitularRouteOptions, corpo?: unknown): Promise<Resposta> {
  const texto = corpo === undefined ? '' : JSON.stringify(corpo);
  const req = Object.assign(Readable.from(texto === '' ? [] : [Buffer.from(texto, 'utf8')]), {
    method: metodo,
    url,
    headers: { cookie: `${SESSION_COOKIE_NAME}=segredo-sintetico-120`, 'idempotency-key': CHAVE_IDEMPOTENCIA },
    socket: { remoteAddress: '127.0.0.1' },
  }) as unknown as IncomingMessage;
  const resposta: Resposta = { status: 0, corpo: undefined };
  const res = {
    headersSent: false,
    writeHead(status: number) {
      resposta.status = status;
    },
    end(conteudo: string) {
      resposta.corpo = conteudo === '' ? undefined : JSON.parse(conteudo);
    },
  } as unknown as ServerResponse;
  await handlePrivacyTitularRoute(req, res, url.split('?')[0] ?? '', opts);
  return resposta;
}

function opcoes(
  servico: Partial<Record<'abrir', unknown>>,
  stepUp: Partial<Record<'emitir', unknown>>,
  limites?: PrivacyTitularRouteOptions['limites'],
): PrivacyTitularRouteOptions {
  return {
    sessions: { async authenticate() { return { userId: SUJEITO }; } },
    service: servico as unknown as ServicoDsrTitular,
    relogio: { nowMs: () => AGORA },
    stepUp: stepUp as unknown as PrivacyTitularRouteOptions['stepUp'],
    ...(limites !== undefined ? { limites } : {}),
  };
}

const CORPO_ABERTURA = { kind: 'correcao', details: {} };
const SERVICO_OK = { abrir: async () => ({ status: 201, corpo: { id: 'x' } }) };
const STEPUP_OK = { emitir: async () => ({ resultado: 'criado' }) };

describe('limites da API na abertura de pedido (5 por dia)', () => {
  it('barrado: responde 429 dsr_limite_diario com Retry-After no corpo e nao chama o servico', async () => {
    let abriu = false;
    const servico = {
      abrir: async () => {
        abriu = true;
        return { status: 201, corpo: {} };
      },
    };
    const registros: string[] = [];
    const r = await chamar(
      '/v1/privacy/dsr-requests',
      'POST',
      opcoes(servico, {}, { abertura: limite(BARRADO, registros), stepUp: limite(PERMITIDO, []) }),
      CORPO_ABERTURA,
    );
    expect(r).toEqual({ status: 429, corpo: { code: 'dsr_limite_diario', retry_after: 120 } });
    expect(abriu).toBe(false);
    expect(registros).toEqual([]);
  });

  it('abertura nova (201) conta no limite do titular', async () => {
    const registros: string[] = [];
    const r = await chamar(
      '/v1/privacy/dsr-requests',
      'POST',
      opcoes(SERVICO_OK, {}, { abertura: limite(PERMITIDO, registros), stepUp: limite(PERMITIDO, []) }),
      CORPO_ABERTURA,
    );
    expect(r.status).toBe(201);
    expect(registros).toEqual([SUJEITO]);
  });

  it('repeticao com a mesma chave (200) nao gasta o limite do dia', async () => {
    const registros: string[] = [];
    const servico = { abrir: async () => ({ status: 200, corpo: {} }) };
    const r = await chamar(
      '/v1/privacy/dsr-requests',
      'POST',
      opcoes(servico, {}, { abertura: limite(PERMITIDO, registros), stepUp: limite(PERMITIDO, []) }),
      CORPO_ABERTURA,
    );
    expect(r.status).toBe(200);
    expect(registros).toEqual([]);
  });
});

describe('limites da API no step-up (3 por hora)', () => {
  it('barrado: responde 429 step_up_limite e nao emite codigo', async () => {
    let emitiu = false;
    const stepUp = {
      emitir: async () => {
        emitiu = true;
        return { resultado: 'criado' };
      },
    };
    const r = await chamar(
      '/v1/privacy/step-up',
      'POST',
      opcoes({}, stepUp, { abertura: limite(PERMITIDO, []), stepUp: limite(BARRADO, []) }),
      {},
    );
    expect(r).toEqual({ status: 429, corpo: { code: 'step_up_limite', retry_after: 120 } });
    expect(emitiu).toBe(false);
  });

  it('emissao aceita (202) conta no limite por hora', async () => {
    const registros: string[] = [];
    const r = await chamar(
      '/v1/privacy/step-up',
      'POST',
      opcoes({}, STEPUP_OK, { abertura: limite(PERMITIDO, []), stepUp: limite(PERMITIDO, registros) }),
      {},
    );
    expect(r.status).toBe(202);
    expect(registros).toEqual([SUJEITO]);
  });
});

describe('montagem dos limites (chave do banco sem dado pessoal)', () => {
  const SEGREDO = 'segredo-sintetico-limite-120-teste';

  function clienteCapturando(capturas: unknown[][]): SqlClient {
    return {
      async query(_sql: string, params: unknown[]) {
        capturas.push(params);
        return { rows: [{ out_ok: true }] };
      },
    } as unknown as SqlClient;
  }

  it('sem o segredo do limitador, nao ha limite na API (o SQL continua limitando)', () => {
    expect(montarLimitesTitular({}, clienteCapturando([]))).toBeUndefined();
  });

  it('a chave derivada tem 64 hex, e deterministica e muda com o segredo', () => {
    const chave = chaveDoLimitePrivacidade(SEGREDO);
    expect(chave).toMatch(/^[0-9a-f]{64}$/);
    expect(chaveDoLimitePrivacidade(SEGREDO)).toBe(chave);
    expect(chaveDoLimitePrivacidade(`${SEGREDO}-outro`)).not.toBe(chave);
  });

  it('aberturas e step-ups usam politicas e chaves distintas, sem o id do titular em claro', async () => {
    const capturas: unknown[][] = [];
    const limites = montarLimitesTitular({ DISCOVERY_CURSOR_KEY: SEGREDO }, clienteCapturando(capturas));
    expect(limites).toBeDefined();
    await limites!.abertura.check(SUJEITO, AGORA);
    await limites!.stepUp.check(SUJEITO, AGORA);
    const [abertura, stepUp] = capturas as [unknown[], unknown[]];
    const chaveAbertura = abertura?.[0] as string;
    const chaveStepUp = stepUp?.[0] as string;
    expect(chaveAbertura).toMatch(/^[0-9a-f]{64}$/);
    expect(chaveStepUp).toMatch(/^[0-9a-f]{64}$/);
    expect(chaveAbertura).not.toBe(chaveStepUp);
    expect(chaveAbertura).not.toContain(SUJEITO);
    expect(abertura?.slice(1)).toEqual([
      DSR_ABERTURA_POLITICA.spanSeconds,
      DSR_ABERTURA_POLITICA.bucketSeconds,
      DSR_ABERTURA_POLITICA.limit,
      new Date(AGORA).toISOString(),
    ]);
    expect(stepUp?.slice(1)).toEqual([
      DSR_STEPUP_POLITICA.spanSeconds,
      DSR_STEPUP_POLITICA.bucketSeconds,
      DSR_STEPUP_POLITICA.limit,
      new Date(AGORA).toISOString(),
    ]);
  });

  it('politicas batem com 147 §6.1 (5 por 24 h; 3 por 1 h)', () => {
    expect(DSR_ABERTURA_POLITICA).toEqual({ limit: 5, spanSeconds: 86_400, bucketSeconds: 3_600 });
    expect(DSR_STEPUP_POLITICA).toEqual({ limit: 3, spanSeconds: 3_600, bucketSeconds: 60 });
  });
});
