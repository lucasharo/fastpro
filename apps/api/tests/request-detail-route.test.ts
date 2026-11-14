// Issue 45 (H-032) | Rotas de leitura do pedido em HTTP (docs/factory/127-DESENHO-H032.md, §9.1, T-01 a T-08, T-15, T-16).
// Servidor HTTP real com a rota isolada; loja em memoria que segue a regra de visibilidade (a SQL real tem prova em
// packages/db/tests/request-visibility-h032.dbtest.mjs). Sem banco, sem provedor externo, sem Mapbox.
// Sentinelas (e-mail, endereco, chave) sao montadas por concatenacao para o check:secrets nao confundir com segredo real.
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ELIGIBLE_PROFESSIONAL_KEYS, OWNER_KEYS, SESSION_COOKIE_NAME } from '@fastpro/domain';
import { hashSessionSecret, type OwnerRequestRow, type ProfessionalRequestRow } from '@fastpro/db';
import { handleRequestDetailRoute, type RequestDetailRouteOptions } from '../src/requests/detail-route.js';
import type { VisibilityStorePort } from '../src/requests/detail-service.js';
import { createAddressVault } from '../src/requests/address-crypto.js';

const DONO = '11111111-1111-4111-8111-111111111111';
const OUTRO = '22222222-2222-4222-8222-222222222222';
const PRO = '44444444-4444-4444-8444-444444444444';
const PRO_SEM_CASO = '55555555-5555-4555-8555-555555555555';
const PEDIDO = '33333333-3333-4333-8333-333333333333';
const INEXISTENTE = '66666666-6666-4666-8666-666666666666';
const SERVICO = '88888888-8888-4888-8888-888888888888';
const AGORA = Date.UTC(2026, 10, 13, 12, 0, 0);
const PRAZO = AGORA + 168 * 3600 * 1000;

// Sentinelas por concatenacao (check:secrets): nunca aparecem como literal completo no codigo.
const SENT_EMAIL = ['h032', 'sentinela', 'cliente'].join('-') + '@example.test';
const SENT_ENDERECO = ['Rua', 'Sentinela', 'Endereco', '4242, Vila Teste - SP'].join(' ');
const SENT_CHAVE = ['chave', 'sentinela', 'h032', 'em', 'memoria', '0123456789abcdef'].join('-');
const SEG_DONO = ['sessao', 'dono', 'h032', '0000000000000000000000000000'].join('-');
const SEG_OUTRO = ['sessao', 'outro', 'h032', '0000000000000000000000000000'].join('-');
const SEG_PRO = ['sessao', 'pro', 'h032', '0000000000000000000000000000'].join('-');
const SEG_PRO_SEM_CASO = ['sessao', 'pro2', 'h032', '0000000000000000000000000000'].join('-');

const vault = createAddressVault(SENT_CHAVE);

/** Fixtures: o pedido e' do DONO; PRO e' elegivel; PRO_SEM_CASO nao e' (uma causa por vez: ver T-07). */
const POSSE: Record<string, string> = { [PEDIDO]: DONO };
let agora = AGORA;
let causaPro: 'nenhuma' | 'raio' | 'verificacao' | 'servico' = 'nenhuma';
let linhaComEnderecoErrado = false;

function linhaDono(): OwnerRequestRow {
  return {
    id: PEDIDO,
    status: 'publicado',
    serviceId: SERVICO,
    serviceName: 'Encanamento',
    urgency: 'alta',
    description: 'Vazamento embaixo da pia',
    firstName: 'Ana',
    addressEnc: vault.seal(SENT_ENDERECO, linhaComEnderecoErrado ? INEXISTENTE : PEDIDO),
    addressTextLegado: null,
    publicLabel: 'Campinas - SP',
    publishedAt: new Date(AGORA).toISOString(),
    acceptanceDeadlineAt: new Date(PRAZO).toISOString(),
  };
}

function linhaProfissional(): ProfessionalRequestRow {
  return {
    id: PEDIDO,
    serviceId: SERVICO,
    serviceName: 'Encanamento',
    urgency: 'alta',
    description: 'Vazamento embaixo da pia',
    publicLabel: 'Campinas - SP',
    distanceKm: 1.5,
    modality: 'presencial',
    publishedAt: new Date(AGORA).toISOString(),
    acceptanceDeadlineAt: new Date(PRAZO).toISOString(),
  };
}

/** Loja em memoria com a regra de visibilidade (prazo estrito, causa unica por fixture). */
class LojaFalsa implements VisibilityStorePort {
  readonly chamadasProfissional: string[] = [];

  async readOwner(userId: string, requestId: string): Promise<OwnerRequestRow | null> {
    if (POSSE[requestId] !== userId || requestId !== PEDIDO) return null;
    return linhaDono();
  }

  async readProfessional(professionalId: string, requestId: string, nowMs: number): Promise<ProfessionalRequestRow | null> {
    this.chamadasProfissional.push(professionalId);
    if (requestId !== PEDIDO || professionalId !== PRO) return null;
    if (causaPro !== 'nenhuma') return null;
    if (nowMs >= PRAZO) return null;
    return linhaProfissional();
  }
}

const SESSOES = new Map<string, string>([
  [hashSessionSecret(SEG_DONO), DONO],
  [hashSessionSecret(SEG_OUTRO), OUTRO],
  [hashSessionSecret(SEG_PRO), PRO],
  [hashSessionSecret(SEG_PRO_SEM_CASO), PRO_SEM_CASO],
]);

let loja: LojaFalsa;
let servidor: Server;
let porta: number;

function opcoes(): RequestDetailRouteOptions {
  return {
    sessions: {
      async authenticate(hash: string) {
        const userId = SESSOES.get(hash);
        return userId === undefined ? null : { userId };
      },
    },
    service: { store: loja, addressVault: vault, clock: { nowMs: () => agora } },
  };
}

interface Resposta {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

function pedir(metodo: string, caminho: string, segredo?: string): Promise<Resposta> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: porta,
        method: metodo,
        path: caminho,
        headers: segredo === undefined ? {} : { cookie: `${SESSION_COOKIE_NAME}=${segredo}` },
      },
      (res) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(partes).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Cabecalhos que compoem a resposta (Date e conexao variam; ficam de fora). */
function assinatura(r: Resposta): string {
  return JSON.stringify({
    status: r.status,
    cacheControl: r.headers['cache-control'],
    referrerPolicy: r.headers['referrer-policy'],
    contentType: r.headers['content-type'],
    contentLength: r.headers['content-length'],
    body: r.body,
  });
}

beforeAll(async () => {
  servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleRequestDetailRoute(req, res, (req.url ?? '').split('?')[0] ?? '', opcoes());
  });
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', () => resolve()));
  porta = (servidor.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
});

beforeEach(() => {
  loja = new LojaFalsa();
  agora = AGORA;
  causaPro = 'nenhuma';
  linhaComEnderecoErrado = false;
});

describe('GET /v1/requests/:id (dono)', () => {
  it('CA-05 (T-05): o dono recebe o endereco original, com o corpo de 11 chaves na ordem da lista fechada', async () => {
    const r = await pedir('GET', `/v1/requests/${PEDIDO}`, SEG_DONO);
    expect(r.status).toBe(200);
    const corpo = JSON.parse(r.body) as Record<string, unknown>;
    expect(Object.keys(corpo)).toEqual([...OWNER_KEYS]);
    expect(corpo.addressText).toBe(SENT_ENDERECO);
    expect(corpo).not.toHaveProperty('customerUserId');
    expect(corpo).not.toHaveProperty('geocodePointId');
  });

  it('cabecalhos: no-store e no-referrer em toda resposta desta rota', async () => {
    for (const r of [
      await pedir('GET', `/v1/requests/${PEDIDO}`, SEG_DONO),
      await pedir('GET', `/v1/requests/${INEXISTENTE}`, SEG_DONO),
      await pedir('GET', `/v1/requests/${PEDIDO}`),
    ]) {
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.headers['referrer-policy']).toBe('no-referrer');
    }
  });

  it('CA-06 (T-06): outro cliente, pedido inexistente e id mal formado respondem identico byte a byte', async () => {
    const outro = await pedir('GET', `/v1/requests/${PEDIDO}`, SEG_OUTRO);
    const inexistente = await pedir('GET', `/v1/requests/${INEXISTENTE}`, SEG_DONO);
    const malformado = await pedir('GET', '/v1/requests/nao-e-uuid', SEG_DONO);
    expect(outro.status).toBe(404);
    expect(assinatura(outro)).toBe(assinatura(inexistente));
    expect(assinatura(malformado)).toBe(assinatura(inexistente));
    expect(outro.body).toBe('{"code":"pedido_nao_encontrado"}');
  });

  it('sem cookie: 401 sessao_necessaria; cookie invalido: 401 com o mesmo corpo', async () => {
    const sem = await pedir('GET', `/v1/requests/${PEDIDO}`);
    const invalido = await pedir('GET', `/v1/requests/${PEDIDO}`, 'sessao-que-nao-existe-000000000000000000');
    expect(sem.status).toBe(401);
    expect(sem.body).toBe('{"code":"sessao_necessaria"}');
    expect(assinatura(invalido)).toBe(assinatura(sem));
  });

  it('metodo que nao e GET responde a mesma recusa 404', async () => {
    const r = await pedir('POST', `/v1/requests/${PEDIDO}`, SEG_DONO);
    expect(assinatura(r)).toBe(assinatura(await pedir('GET', `/v1/requests/${INEXISTENTE}`, SEG_DONO)));
  });

  it('falha de decifragem: 503 endereco_indisponivel, sem pedido parcial e sem o texto do endereco', async () => {
    linhaComEnderecoErrado = true;
    const r = await pedir('GET', `/v1/requests/${PEDIDO}`, SEG_DONO);
    expect(r.status).toBe(503);
    expect(r.body).toBe('{"code":"endereco_indisponivel"}');
    expect(r.body).not.toContain(SENT_ENDERECO);
  });
});

describe('GET /v1/professional/requests/:id (profissional elegivel)', () => {
  it('T-01: corpo de 10 chaves, exatamente as da lista fechada, na ordem, com pedido aberto e elegivel', async () => {
    const r = await pedir('GET', `/v1/professional/requests/${PEDIDO}`, SEG_PRO);
    expect(r.status).toBe(200);
    expect(Object.keys(JSON.parse(r.body) as object)).toEqual([...ELIGIBLE_PROFESSIONAL_KEYS]);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
  });

  it('T-02: sem coordenada, sem geocode_point_id, sem hash de 64 hex e sem nome nem indice de celula', async () => {
    const r = await pedir('GET', `/v1/professional/requests/${PEDIDO}`, SEG_PRO);
    const texto = r.body + JSON.stringify(r.headers);
    expect(texto).not.toMatch(/-?\d{1,3}\.\d{4,}/);
    expect(texto).not.toMatch(/\b[0-9a-f]{64}\b/);
    expect(texto).not.toMatch(/geocode|match_|cell|lat|lon/i);
  });

  it('T-03: sem e-mail, sem telefone, sem firstName e sem addressText', async () => {
    const r = await pedir('GET', `/v1/professional/requests/${PEDIDO}`, SEG_PRO);
    expect(r.body).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(r.body).not.toMatch(/\(\d{2}\)\s?9?\d{4}-?\d{4}|\b\d{2}\s9?\d{4}-\d{4}\b|\b\d{10,11}\b/);
    const corpo = JSON.parse(r.body) as Record<string, unknown>;
    expect(corpo).not.toHaveProperty('firstName');
    expect(corpo).not.toHaveProperty('addressText');
    expect(corpo).not.toHaveProperty('status');
  });

  it('T-04: o e-mail do cliente (sentinela) nao aparece em nenhuma resposta do profissional, do outro cliente nem da recusa', async () => {
    const respostas = [
      await pedir('GET', `/v1/professional/requests/${PEDIDO}`, SEG_PRO),
      await pedir('GET', `/v1/professional/requests/${PEDIDO}`, SEG_PRO_SEM_CASO),
      await pedir('GET', `/v1/requests/${PEDIDO}`, SEG_OUTRO),
      await pedir('GET', `/v1/professional/requests/${INEXISTENTE}`, SEG_PRO),
    ];
    for (const r of respostas) expect(r.body + JSON.stringify(r.headers)).not.toContain(SENT_EMAIL);
  });

  it('CA-06 (T-06): profissional nao elegivel, pedido inexistente e id mal formado sao identicos ao dono-de-outro', async () => {
    const naoElegivel = await pedir('GET', `/v1/professional/requests/${PEDIDO}`, SEG_PRO_SEM_CASO);
    const inexistente = await pedir('GET', `/v1/professional/requests/${INEXISTENTE}`, SEG_PRO);
    const malformado = await pedir('GET', '/v1/professional/requests/x', SEG_PRO);
    expect(naoElegivel.status).toBe(404);
    expect(assinatura(naoElegivel)).toBe(assinatura(inexistente));
    expect(assinatura(malformado)).toBe(assinatura(inexistente));
  });

  it('CA-07 (T-07): tres causas isoladas (fora do raio, verificacao nao aprovada, servico nao atendido) dao o mesmo 404', async () => {
    const referencia = await pedir('GET', `/v1/professional/requests/${INEXISTENTE}`, SEG_PRO);
    for (const causa of ['raio', 'verificacao', 'servico'] as const) {
      causaPro = causa;
      const r = await pedir('GET', `/v1/professional/requests/${PEDIDO}`, SEG_PRO);
      expect(assinatura(r), `causa ${causa}`).toBe(assinatura(referencia));
    }
  });

  it('CA-08 (T-08): prazo estrito em milissegundos: antes do prazo devolve, no prazo e depois nao; o dono continua lendo', async () => {
    agora = PRAZO - 1;
    expect((await pedir('GET', `/v1/professional/requests/${PEDIDO}`, SEG_PRO)).status).toBe(200);
    agora = PRAZO;
    expect((await pedir('GET', `/v1/professional/requests/${PEDIDO}`, SEG_PRO)).status).toBe(404);
    agora = PRAZO + 1;
    expect((await pedir('GET', `/v1/professional/requests/${PEDIDO}`, SEG_PRO)).status).toBe(404);
    expect((await pedir('GET', `/v1/requests/${PEDIDO}`, SEG_DONO)).status).toBe(200);
  });
});

describe('T-15: sentinelas de endereco, chave e e-mail fora de logs e de respostas de erro', () => {
  it('varre logs capturados e corpos de erro (400 a 503): zero ocorrencias', async () => {
    const logs: string[] = [];
    const espioes = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        logs.push(args.map((a) => String(a)).join(' '));
      }),
    );
    try {
      const erros: Resposta[] = [
        await pedir('GET', `/v1/requests/${PEDIDO}`),
        await pedir('GET', `/v1/requests/${INEXISTENTE}`, SEG_OUTRO),
        await pedir('GET', `/v1/professional/requests/${PEDIDO}`, SEG_PRO_SEM_CASO),
      ];
      linhaComEnderecoErrado = true;
      erros.push(await pedir('GET', `/v1/requests/${PEDIDO}`, SEG_DONO));
      const todos = [...erros.map((r) => r.body), ...logs];
      for (const texto of todos) {
        expect(texto).not.toContain(SENT_ENDERECO);
        expect(texto).not.toContain(SENT_CHAVE);
        expect(texto).not.toContain(SENT_EMAIL);
      }
    } finally {
      for (const e of espioes) e.mockRestore();
    }
  });
});

describe('T-16: a leitura nao depende de provedor de geocodificacao', () => {
  it('as portas da rota sao so loja, cofre e relogio; o profissional e o dono leem sem nenhuma chamada externa', async () => {
    const o = opcoes();
    expect(Object.keys(o.service).sort()).toEqual(['addressVault', 'clock', 'store']);
    expect((await pedir('GET', `/v1/professional/requests/${PEDIDO}`, SEG_PRO)).status).toBe(200);
    expect((await pedir('GET', `/v1/requests/${PEDIDO}`, SEG_DONO)).status).toBe(200);
  });
});
