// Issue 57 (H-044) | Rota POST /v1/billing/trial/activate via HTTP (docs/factory/135-DESENHO-H044.md, §6, T-04, T-14, T-17).
// Servidor de loopback com a funcao de rota; sessao e porta do trial em memoria; fetch bloqueado. Sem banco, sem rede.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-044');
};

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { hashSessionSecret } from '@fastpro/db';
import {
  SESSION_COOKIE_NAME,
  type SessionRecord,
  type SessionRepositoryPort,
  type TrialActivationOutcome,
  type TrialActivationPort,
} from '@fastpro/domain';
import { handleProfessionalTrialRoute, TRIAL_ACTIVATE_PATH, type ProfessionalTrialRouteOptions } from '../src/professional-trial-route.js';

const T0 = Date.UTC(2099, 0, 1, 12);
const PROF_A = '11111111-2222-4333-8444-555555555555';
const PROF_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SEG_A = ['sessao', 'h044', 'profissional', 'a'].join('-');
const SEG_B = ['sessao', 'h044', 'profissional', 'b'].join('-');
const SEG_DESCONHECIDO = ['sessao', 'h044', 'desconhecida'].join('-');
const DETALHE_TECNICO = ['relacao', 'billing', 'access', 'grant'].join('_');
const DUAS_SEMANAS_MS = 14 * 24 * 60 * 60 * 1000;

const sessoes = new Map<string, string>([
  [hashSessionSecret(SEG_A), PROF_A],
  [hashSessionSecret(SEG_B), PROF_B],
]);

const sessions = {
  authenticate: async (hash: string) => {
    const usuario = sessoes.get(hash);
    if (usuario === undefined) return null;
    return {
      sessionId: `sessao-${usuario.slice(0, 8)}`,
      userId: usuario,
      recentAuthAtMs: T0,
      authMethod: 'password',
    } as unknown as SessionRecord;
  },
} as unknown as SessionRepositoryPort;

const chamadasPorta: Array<{ id: string; at: Date }> = [];
let resposta: TrialActivationOutcome | Error = {
  code: 'ok',
  startsAt: new Date(T0),
  endsAt: new Date(T0 + DUAS_SEMANAS_MS),
};
const trial: TrialActivationPort = {
  activate: async (id: string, at: Date) => {
    chamadasPorta.push({ id, at });
    if (resposta instanceof Error) throw resposta;
    return resposta;
  },
};
let sessoesFalhando = false;
const sessionsComFalha = {
  authenticate: async (hash: string, agora: number) => {
    if (sessoesFalhando) throw new Error(DETALHE_TECNICO);
    return sessions.authenticate(hash, agora);
  },
} as unknown as SessionRepositoryPort;
let usarSessoesComFalha = false;

const opcoes = (): ProfessionalTrialRouteOptions => ({
  sessions: usarSessoesComFalha ? sessionsComFalha : sessions,
  trial,
  clock: { now: () => new Date(T0) },
});

let servidor: Server;
let base = 0;

beforeAll(async () => {
  servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
    handleProfessionalTrialRoute(req, res, opcoes()).catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', () => resolve()));
  base = (servidor.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
});

interface Resposta {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly texto: string;
}

interface Pedido {
  readonly metodo?: string;
  readonly cookie?: string | null;
  readonly corpo?: string;
}

function pedir({ metodo = 'POST', cookie = `${SESSION_COOKIE_NAME}=${SEG_A}`, corpo }: Pedido = {}): Promise<Resposta> {
  return new Promise((resolve, reject) => {
    const cabecalhos: Record<string, string> = {};
    if (cookie !== null) cabecalhos.cookie = cookie;
    if (corpo !== undefined) {
      cabecalhos['content-type'] = 'application/json';
      cabecalhos['content-length'] = String(Buffer.byteLength(corpo));
    }
    const req = request(
      { host: '127.0.0.1', port: base, path: TRIAL_ACTIVATE_PATH, method: metodo, headers: cabecalhos },
      (res) => {
        const partes: Buffer[] = [];
        res.on('data', (parte: Buffer) => partes.push(parte));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, texto: Buffer.concat(partes).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    req.end(corpo);
  });
}

function reiniciar(): void {
  chamadasPorta.length = 0;
  resposta = { code: 'ok', startsAt: new Date(T0), endsAt: new Date(T0 + DUAS_SEMANAS_MS) };
  sessoesFalhando = false;
  usarSessoesComFalha = false;
}

describe('T-17: rota do trial (sessao e metodo)', () => {
  it('sem cookie de sessao devolve 401 e nao chama a porta', async () => {
    reiniciar();
    const r = await pedir({ cookie: null });
    expect(r.status).toBe(401);
    expect(chamadasPorta).toHaveLength(0);
  });

  it('cookie desconhecido devolve 401 e nao chama a porta', async () => {
    reiniciar();
    const r = await pedir({ cookie: `${SESSION_COOKIE_NAME}=${SEG_DESCONHECIDO}` });
    expect(r.status).toBe(401);
    expect(chamadasPorta).toHaveLength(0);
  });

  it('metodo diferente de POST devolve 405 com Allow: POST', async () => {
    reiniciar();
    const r = await pedir({ metodo: 'GET' });
    expect(r.status).toBe(405);
    expect(r.headers.allow).toBe('POST');
    expect(chamadasPorta).toHaveLength(0);
  });

  it('o id do profissional vem da sessao: a sessao B nunca ativa o trial de A', async () => {
    reiniciar();
    const r = await pedir({ cookie: `${SESSION_COOKIE_NAME}=${SEG_B}` });
    expect(r.status).toBe(201);
    expect(chamadasPorta.map((c) => c.id)).toEqual([PROF_B]);
  });

  it('falha ao consultar a sessao devolve 503 sem mensagem tecnica', async () => {
    reiniciar();
    usarSessoesComFalha = true;
    sessoesFalhando = true;
    const r = await pedir();
    usarSessoesComFalha = false;
    sessoesFalhando = false;
    expect(r.status).toBe(503);
    expect(r.texto).toBe('{"error":"servico_indisponivel"}');
    expect(r.texto).not.toContain(DETALHE_TECNICO);
  });
});

describe('T-04: corpo da requisicao', () => {
  it('corpo vazio e {} funcionam (201)', async () => {
    reiniciar();
    expect((await pedir({ corpo: '' })).status).toBe(201);
    expect((await pedir({ corpo: '{}' })).status).toBe(201);
    expect(chamadasPorta).toHaveLength(2);
  });

  it('professional_id no corpo e recusado (400), sem gravar nada', async () => {
    reiniciar();
    const r = await pedir({ corpo: JSON.stringify({ professional_id: PROF_B }) });
    expect(r.status).toBe(400);
    expect(r.texto).toBe('{"error":"invalid_body"}');
    expect(chamadasPorta).toHaveLength(0);
  });

  it.each(['card_number', 'pix', 'payment_token', 'qualquer_chave'])(
    'chave %s no corpo devolve 400 invalid_body e nao chama a porta',
    async (chave) => {
      reiniciar();
      const r = await pedir({ corpo: JSON.stringify({ [chave]: 'valor-sintetico' }) });
      expect(r.status).toBe(400);
      expect(chamadasPorta).toHaveLength(0);
    },
  );

  it('JSON invalido, lista e corpo acima do limite devolvem 400', async () => {
    reiniciar();
    expect((await pedir({ corpo: 'nao-json' })).status).toBe(400);
    expect((await pedir({ corpo: '[]' })).status).toBe(400);
    expect((await pedir({ corpo: 'x'.repeat(5000) })).status).toBe(400);
    expect(chamadasPorta).toHaveLength(0);
  });

  it('a rota e o seu modulo nao importam gateway de pagamento (estatico)', () => {
    const arquivos = [
      new URL('../src/professional-trial-route.ts', import.meta.url),
      new URL('../src/professional-trial-composicao.ts', import.meta.url),
    ];
    for (const arquivo of arquivos) {
      expect(readFileSync(arquivo, 'utf8')).not.toMatch(/mercado[-_ ]?pago/i);
    }
  });
});

describe('T-14 e negacoes da rota', () => {
  it('201 traz so starts_at e ends_at (lista branca) e nenhum dado pessoal', async () => {
    reiniciar();
    const r = await pedir();
    expect(r.status).toBe(201);
    const corpo = JSON.parse(r.texto) as Record<string, unknown>;
    expect(Object.keys(corpo).sort()).toEqual(['ends_at', 'starts_at']);
    expect(corpo.starts_at).toBe(new Date(T0).toISOString());
    expect(corpo.ends_at).toBe(new Date(T0 + DUAS_SEMANAS_MS).toISOString());
    expect(r.texto).not.toMatch(/@|identity|hmac|grant|document/i);
  });

  it('403 not_verified com corpo fixo', async () => {
    reiniciar();
    resposta = { code: 'not_verified' };
    const r = await pedir();
    expect(r.status).toBe(403);
    expect(r.texto).toBe('{"error":"not_verified"}');
  });

  it('409 trial_used com corpo fixo', async () => {
    reiniciar();
    resposta = { code: 'trial_used' };
    const r = await pedir();
    expect(r.status).toBe(409);
    expect(r.texto).toBe('{"error":"trial_used"}');
  });

  it('409 paid_access_active com corpo fixo', async () => {
    reiniciar();
    resposta = { code: 'paid_access_active' };
    const r = await pedir();
    expect(r.status).toBe(409);
    expect(r.texto).toBe('{"error":"paid_access_active"}');
  });

  it('falha tecnica da porta devolve 503 generico, sem mensagem de banco', async () => {
    reiniciar();
    resposta = new Error(DETALHE_TECNICO);
    const r = await pedir();
    expect(r.status).toBe(503);
    expect(r.texto).toBe('{"error":"servico_indisponivel"}');
    expect(r.texto).not.toContain(DETALHE_TECNICO);
  });

  it('respostas de negacao sao identicas nas mesmas condicoes (sem enumeracao extra)', async () => {
    reiniciar();
    resposta = { code: 'not_verified' };
    const primeira = await pedir();
    resposta = { code: 'not_verified' };
    const segunda = await pedir({ cookie: `${SESSION_COOKIE_NAME}=${SEG_B}` });
    expect(primeira.texto).toBe(segunda.texto);
    expect(primeira.status).toBe(segunda.status);
  });
});
