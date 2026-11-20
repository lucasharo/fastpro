// Issue 120 (H-111) | Testes de contrato das rotas de step-up do titular (147-DESENHO-H111 §5.1): POST /v1/privacy/step-up
// e /step-up/confirm. Sem banco e sem rede: sessao e servico de step-up falsos. Nenhum codigo real e registrado.
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SESSION_COOKIE_NAME } from '@fastpro/domain';
import { describe, expect, it } from 'vitest';
import { handlePrivacyTitularRoute, type PrivacyTitularRouteOptions } from './titular-route.js';

const SUJEITO = '11111111-1111-4111-8111-111111111111';
const CHAVE_OK = { 'idempotency-key': 'idem-stepup-120-aaaa' };

interface Resposta {
  status: number;
  corpo: unknown;
}

interface StepUpFalso {
  emitido: string[];
  emitir: (usuario: string) => Promise<unknown>;
  confirmar: (usuario: string, codigo: string) => Promise<unknown>;
}

function stepUpFalso(sobrescrita: Partial<Pick<StepUpFalso, 'emitir' | 'confirmar'>> = {}): StepUpFalso {
  const emitido: string[] = [];
  return {
    emitido,
    emitir: async (usuario: string) => {
      emitido.push(usuario);
      return { resultado: 'criado', outboxId: '55555555-5555-4555-8555-555555555555' };
    },
    confirmar: async () => ({ resultado: 'ok', token: 'token-sintetico-stepup-120-0123456789', expiresAt: '2026-11-20T12:15:00.000Z' }),
    ...sobrescrita,
  };
}

function opcoes(stepUp: StepUpFalso | undefined, sessaoValida = true): PrivacyTitularRouteOptions {
  return {
    sessions: {
      async authenticate() {
        return sessaoValida ? { userId: SUJEITO } : null;
      },
    } as never,
    service: {} as never,
    relogio: { nowMs: () => Date.parse('2026-11-20T12:00:00Z') },
    ...(stepUp !== undefined ? { stepUp: stepUp as never } : {}),
  };
}

async function chamar(
  metodo: string,
  url: string,
  opts: PrivacyTitularRouteOptions,
  { cookie = true, corpo, cabecalhos = CHAVE_OK }: { cookie?: boolean; corpo?: unknown; cabecalhos?: Record<string, string> } = {},
): Promise<Resposta> {
  const headers: Record<string, string> = { ...cabecalhos };
  if (cookie) headers.cookie = `${SESSION_COOKIE_NAME}=segredo-sintetico-120`;
  const texto = corpo === undefined ? '' : typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
  const req = Object.assign(Readable.from(texto === '' ? [] : [Buffer.from(texto, 'utf8')]), {
    method: metodo,
    url,
    headers,
    socket: { remoteAddress: '127.0.0.1' },
  }) as unknown as IncomingMessage;
  const resposta: Resposta = { status: 0, corpo: undefined };
  let escrito = false;
  const res = {
    headersSent: false,
    writeHead(status: number) {
      resposta.status = status;
    },
    end(conteudo: string) {
      escrito = true;
      resposta.corpo = conteudo === '' || conteudo === undefined ? undefined : JSON.parse(conteudo);
    },
  } as unknown as ServerResponse;
  await handlePrivacyTitularRoute(req, res, url.split('?')[0] ?? '', opts);
  expect(escrito).toBe(true);
  return resposta;
}

describe('step-up: montagem e sessao', () => {
  it('sem o servico de step-up montado, as rotas respondem 404 uniforme', async () => {
    const r = await chamar('POST', '/v1/privacy/step-up', opcoes(undefined), { corpo: {} });
    expect(r.status).toBe(404);
  });

  it('sem sessao valida responde 401 e nao emite codigo', async () => {
    const fake = stepUpFalso();
    const r = await chamar('POST', '/v1/privacy/step-up', opcoes(fake, false), { cookie: false, corpo: {} });
    expect(r.status).toBe(401);
    expect(fake.emitido).toHaveLength(0);
  });

  it('metodo GET na rota de emissao responde 404', async () => {
    const r = await chamar('GET', '/v1/privacy/step-up', opcoes(stepUpFalso()));
    expect(r.status).toBe(404);
  });
});

describe('step-up: emissao (POST /v1/privacy/step-up)', () => {
  it('sem Idempotency-Key valida recusa com 422 chave_invalida', async () => {
    const r = await chamar('POST', '/v1/privacy/step-up', opcoes(stepUpFalso()), { corpo: {}, cabecalhos: {} });
    expect(r.status).toBe(422);
    expect(r.corpo).toEqual({ code: 'chave_invalida' });
  });

  it('corpo com chave fora do contrato recusa com 422', async () => {
    const r = await chamar('POST', '/v1/privacy/step-up', opcoes(stepUpFalso()), {
      corpo: { purpose: 'dsr_open', extra: 1 },
    });
    expect(r.status).toBe(422);
    expect(r.corpo).toEqual({ code: 'corpo_invalido' });
  });

  it('emissao criada responde 202 sem corpo e usa o titular da sessao', async () => {
    const fake = stepUpFalso();
    const r = await chamar('POST', '/v1/privacy/step-up', opcoes(fake), { corpo: { purpose: 'dsr_open' } });
    expect(r.status).toBe(202);
    expect(r.corpo).toEqual({});
    expect(fake.emitido).toEqual([SUJEITO]);
  });

  it('limite de emissao responde 429 com o tempo de espera e nao vaza mais nada', async () => {
    const fake = stepUpFalso({ emitir: async () => ({ resultado: 'limite', retryAfter: 1800 }) });
    const r = await chamar('POST', '/v1/privacy/step-up', opcoes(fake), { corpo: {} });
    expect(r.status).toBe(429);
    expect(r.corpo).toEqual({ code: 'step_up_limite', retry_after: 1800 });
  });
});

describe('step-up: confirmacao (POST /v1/privacy/step-up/confirm)', () => {
  it('codigo correto responde 200 com o token de uso unico e a validade', async () => {
    const r = await chamar('POST', '/v1/privacy/step-up/confirm', opcoes(stepUpFalso()), { corpo: { code: '123456' } });
    expect(r.status).toBe(200);
    expect(r.corpo).toEqual({
      step_up_token: 'token-sintetico-stepup-120-0123456789',
      expires_at: '2026-11-20T12:15:00.000Z',
    });
  });

  it('codigo errado responde 400 codigo_invalido, sem dizer qual parte falhou', async () => {
    const r = await chamar('POST', '/v1/privacy/step-up/confirm', opcoes(stepUpFalso({ confirmar: async () => ({ resultado: 'invalido' }) })), {
      corpo: { code: '000000' },
    });
    expect(r.status).toBe(400);
    expect(r.corpo).toEqual({ code: 'codigo_invalido' });
  });

  it('bloqueio responde 429 com o tempo de espera', async () => {
    const fake = stepUpFalso({ confirmar: async () => ({ resultado: 'bloqueado', retryAfter: 900 }) });
    const r = await chamar('POST', '/v1/privacy/step-up/confirm', opcoes(fake), { corpo: { code: '000000' } });
    expect(r.status).toBe(429);
    expect(r.corpo).toEqual({ code: 'step_up_bloqueado', retry_after: 900 });
  });

  it('corpo sem code, ou com chave extra, responde 400', async () => {
    const semCodigo = await chamar('POST', '/v1/privacy/step-up/confirm', opcoes(stepUpFalso()), { corpo: {} });
    expect(semCodigo.status).toBe(400);
    const extra = await chamar('POST', '/v1/privacy/step-up/confirm', opcoes(stepUpFalso()), {
      corpo: { code: '123456', outra: 'x' },
    });
    expect(extra.status).toBe(400);
  });
});
