// H-097 (Issue 107) | Rota POST /v1/auth/challenges e despacho pos-resposta, em memoria (sem banco, sem rede,
// sem e-mail real). Cobre T-H097-07 (parte sem banco), T-H097-08, T-H097-11 (parte da rota) e T-H097-13.
// Desenho: docs/factory/86-DESENHO-H097.md §1, §3, §5. Regra de conta nao cadastrada (SQL) fica fora daqui.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-097');
};

import { afterAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { RATE_LIMIT_DEFAULTS } from '@fastpro/domain';
import {
  requestChallenge,
  type ChallengeStore,
  type CreateChallengeInput,
  type CreateChallengeResult,
  type RequestChallengeDeps,
} from '@fastpro/db';
import { handleRequest } from '../src/app.js';
import { CHALLENGE_REQUEST_PATH, type ChallengeRequestRouteOptions } from '../src/challenge-request-route.js';
import { criarDespachoPosResposta } from '../src/challenge-dispatch.js';

const T0 = Date.UTC(2099, 0, 1, 12);
const PIMENTA_EMAIL = randomBytes(24).toString('base64url');
const PIMENTA_CODIGO = randomBytes(24).toString('base64url');
const PIMENTA_IP = randomBytes(24).toString('base64url');
const CHAVE = Buffer.alloc(32, 7);

/** Repositorio em memoria: grava o desafio e devolve a saida. Sem regra de conta (ver SQL, pendente). */
class RepoMemoria implements ChallengeStore {
  readonly criados: CreateChallengeInput[] = [];
  limite: number | null = null;

  async create(input: CreateChallengeInput): Promise<CreateChallengeResult> {
    this.criados.push(input);
    return { resultado: 'criado', challengeId: input.id, outboxId: `out-${input.id}` };
  }

  async findRow(): Promise<null> {
    return null;
  }

  async markDelivered(): Promise<void> {}

  async request(input: CreateChallengeInput): Promise<CreateChallengeResult | { resultado: 'limite'; retryAfterSeconds: number; motivo: string }> {
    if (this.limite !== null) {
      return { resultado: 'limite', retryAfterSeconds: this.limite, motivo: 'pedido_ip_hora' };
    }
    return this.create(input);
  }
}

class DespachoGravado {
  readonly agendados: string[] = [];
  schedule(outboxId: string): void {
    this.agendados.push(outboxId);
  }
}

function depsDe(store: RepoMemoria, dispatch: { schedule(outboxId: string): void }, comLimite: boolean): RequestChallengeDeps {
  return {
    store,
    secrets: {
      key: CHAVE,
      pepperEmail: PIMENTA_EMAIL,
      pepperCode: PIMENTA_CODIGO,
    },
    clock: { nowMs: () => T0, sleep: async () => undefined },
    dispatch,
    ...(comLimite
      ? { rate: { pepperIp: PIMENTA_IP, limits: RATE_LIMIT_DEFAULTS } }
      : {}),
  };
}

const servidores: Server[] = [];

async function servidorCom(opcoes: ChallengeRequestRouteOptions): Promise<string> {
  const server = createServer((req, res) => {
    handleRequest(req, res, { tickSecret: undefined, challengeRequest: opcoes }).catch(() => {
      res.statusCode = 500;
      res.end();
    });
  });
  servidores.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

interface Resposta {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

function postJson(base: string, corpo: string, caminho = CHALLENGE_REQUEST_PATH): Promise<Resposta> {
  return new Promise((resolve, reject) => {
    const url = new URL(caminho, base);
    const req = request(
      url,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo) } },
      (res) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(partes).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    req.end(corpo);
  });
}

/** Campos que a resposta precisa repetir identicos (data e conexao variam por natureza do servidor). */
function forma(r: Resposta) {
  return {
    status: r.status,
    body: r.body,
    cacheControl: r.headers['cache-control'],
    contentType: r.headers['content-type'],
  };
}

afterAll(() => {
  for (const s of servidores) s.close();
});

describe('POST /v1/auth/challenges (H-097, rota e resposta uniforme)', () => {
  it('T-H097-07 (parte sem banco): dois e-mails recebem a mesma resposta e o mesmo caminho de gravacao', async () => {
    const store = new RepoMemoria();
    const despacho = new DespachoGravado();
    const base = await servidorCom({ deps: depsDe(store, despacho, false) });

    const a = await postJson(base, JSON.stringify({ email: 'cadastrado@example.test' }));
    const b = await postJson(base, JSON.stringify({ email: 'nao-cadastrado@example.test' }));

    expect(a.status).toBe(202);
    expect(forma(b)).toEqual(forma(a));
    expect(a.body).toBe('{"status":"recebido"}');
    expect(store.criados).toHaveLength(2);
    expect(despacho.agendados).toEqual(store.criados.map((c) => `out-${c.id}`));
  });

  it('corpo invalido, ausente ou acima do limite: 422 pedido_invalido, sem desafio e sem envio', async () => {
    const store = new RepoMemoria();
    const despacho = new DespachoGravado();
    const base = await servidorCom({ deps: depsDe(store, despacho, false) });

    const ruim = await postJson(base, '{nao-e-json');
    const sem = await postJson(base, JSON.stringify({ email: 'nao-e-email' }));
    const grande = await postJson(base, JSON.stringify({ email: 'a@example.test', x: 'y'.repeat(5000) }));

    for (const r of [ruim, sem, grande]) {
      expect(r.status).toBe(422);
      expect(JSON.parse(r.body)).toEqual({ code: 'pedido_invalido' });
    }
    expect(store.criados).toHaveLength(0);
    expect(despacho.agendados).toHaveLength(0);
  });

  it('limite de pedidos: 429 com Retry-After e nenhum envio agendado', async () => {
    const store = new RepoMemoria();
    store.limite = 60;
    const despacho = new DespachoGravado();
    const base = await servidorCom({ deps: depsDe(store, despacho, true) });

    const r = await postJson(base, JSON.stringify({ email: 'a@example.test' }));

    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toBeDefined();
    expect(despacho.agendados).toHaveLength(0);
  });

  it('finalidade publish tambem envia (agenda a saida uma vez)', async () => {
    const store = new RepoMemoria();
    const despacho = new DespachoGravado();
    const base = await servidorCom({ deps: depsDe(store, despacho, false) });

    const r = await postJson(base, JSON.stringify({ email: 'novo@example.test', purpose: 'publish' }));

    expect(r.status).toBe(202);
    expect(store.criados[0]?.purpose).toBe('publish');
    expect(despacho.agendados).toHaveLength(1);
  });

  it('cota de login esgotada no lado da rota: a resposta continua 202 e o envio fica agendado', async () => {
    // A cota diaria e medida no envio (SQL, fora deste teste). Aqui: a rota nao reage a cota.
    const store = new RepoMemoria();
    const despacho = new DespachoGravado();
    const base = await servidorCom({ deps: depsDe(store, despacho, false) });

    const r = await postJson(base, JSON.stringify({ email: 'a@example.test' }));

    expect(r.status).toBe(202);
    expect(r.body).toBe('{"status":"recebido"}');
    expect(despacho.agendados).toHaveLength(1);
  });

  it('metodo diferente de POST nao chega ao pedido (404)', async () => {
    const store = new RepoMemoria();
    const base = await servidorCom({ deps: depsDe(store, new DespachoGravado(), false) });
    const r = await new Promise<Resposta>((resolve, reject) => {
      const req = request(new URL(CHALLENGE_REQUEST_PATH, base), { method: 'GET' }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: '' }));
      });
      req.on('error', reject);
      req.end();
    });
    expect(r.status).toBe(404);
    expect(store.criados).toHaveLength(0);
  });
});

describe('criarDespachoPosResposta (H-097, T-H097-13)', () => {
  it('schedule chama o envio uma vez, com o id da saida, pela primitiva pos-resposta', async () => {
    const chamadas: string[] = [];
    const promessas: Promise<unknown>[] = [];
    const d = criarDespachoPosResposta({
      enviar: async (id) => {
        chamadas.push(id);
      },
      waitUntil: (p) => {
        promessas.push(p);
      },
    });
    d.schedule('out-1');
    await Promise.all(promessas);
    expect(chamadas).toEqual(['out-1']);
  });

  it('falha no envio: a promessa entregue a primitiva nunca rejeita e o aviso leva so o codigo fixo', async () => {
    const promessas: Promise<unknown>[] = [];
    const codigos: string[] = [];
    const d = criarDespachoPosResposta({
      enviar: async () => {
        throw new Error('segredo-que-nao-pode-vazar');
      },
      waitUntil: (p) => {
        promessas.push(p);
      },
      onFalha: (codigo) => codigos.push(codigo),
    });
    expect(() => d.schedule('out-2')).not.toThrow();
    await expect(Promise.all(promessas)).resolves.toBeDefined();
    expect(codigos).toEqual(['envio_pos_resposta']);
  });

  it('erro sincrono do envio tambem nao escapa do schedule', async () => {
    const promessas: Promise<unknown>[] = [];
    const d = criarDespachoPosResposta({
      enviar: () => {
        throw new Error('sincrono');
      },
      waitUntil: (p) => {
        promessas.push(p);
      },
    });
    expect(() => d.schedule('out-3')).not.toThrow();
    await expect(Promise.all(promessas)).resolves.toBeDefined();
  });

  it('sem primitiva pos-resposta: nada e enviado agora, e a saida continua gravada (contingencia do tick)', async () => {
    let enviados = 0;
    const d = criarDespachoPosResposta({
      enviar: async () => {
        enviados += 1;
      },
    });
    const store = new RepoMemoria();
    const r = await requestChallenge(depsDe(store, d, false), { email: 'a@example.test' });
    expect(r.status).toBe(202);
    expect(store.criados).toHaveLength(1);
    expect(enviados).toBe(0);
  });

  it('falha do envio nao muda a resposta 202 do pedido', async () => {
    const promessas: Promise<unknown>[] = [];
    const d = criarDespachoPosResposta({
      enviar: async () => {
        throw new Error('provedor fora');
      },
      waitUntil: (p) => {
        promessas.push(p);
      },
    });
    const store = new RepoMemoria();
    const r = await requestChallenge(depsDe(store, d, false), { email: 'a@example.test' });
    await Promise.all(promessas);
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ status: 'recebido' });
  });
});
