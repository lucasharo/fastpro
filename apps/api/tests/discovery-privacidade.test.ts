// Issue 68 (H-055) | Privacidade da lista da descoberta em HTTP (docs/factory/153-DESENHO-H055.md, §7: T-22 e T-23).
// Servidor HTTP real com a rota isolada e portas em memoria. Dados 100 % sinteticos; sem banco e sem rede externa.
// T-24 (distancia em multiplos de 0,5) e conferida no banco, com a saida real do SQL, em packages/db/tests.
// Segredos de teste montados por concatenacao (check:secrets). Nenhum log e capturado aqui: a rota nao registra nada.
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DISCOVERY_ITEM_KEYS,
  SESSION_COOKIE_NAME,
  createDiscoveryCursorCodec,
  type DiscoveryCursor,
  type RateWindowDecision,
} from '@fastpro/domain';
import { hashSessionSecret, type ProfessionalRequestRow } from '@fastpro/db';
import { handleDiscoveryRoute, type DiscoveryRouteOptions } from '../src/requests/discovery-route.js';
import type { DiscoveryServiceDeps } from '../src/requests/discovery-service.js';

const PRO = '44444444-4444-4444-8444-444444444444';
const SEM_PERFIL = '66666666-6666-4666-8666-666666666666';
const AGORA = Date.UTC(2026, 10, 19, 12, 0, 0);
const CHAVE = ['chave', 'privacidade', 'h055'].join('-') + '-0123456789abcdef0123';
const SEG_PRO = ['sessao', 'pro', 'privacidade', '0000000000000000000000000000'].join('-');
const SEG_SEM = ['sessao', 'sem', 'privacidade', '0000000000000000000000000000'].join('-');
const SEG_INVALIDO = ['sessao', 'inexistente', 'privacidade', '0000000000000000000000000000'].join('-');
const CAMINHO = '/v1/professional/discovery/requests';

/**
 * Termos que nunca podem sair no corpo (§6 e T-H055-23). Comparacao sem caixa. Os dados sinteticos usam
 * somente letras que nao formam estes termos, entao uma ocorrência indica vazamento de fato.
 */
const PROIBIDOS = [
  '@',
  'email',
  'telefone',
  'phone',
  'endereco',
  'address',
  'first_name',
  'exact_point',
  'match_',
  'lon',
  'lat',
  'cell',
  'cursor_key',
  'vaga',
  'onda',
  'user_id',
  'geocode',
  'distance_m',
  'customer',
];

const id = (n: number): string => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cursorCodec = createDiscoveryCursorCodec(CHAVE);

/** Linhas sinteticas com distancias reais de 0,5 km em passos, mais um pedido online sem distancia. */
const LINHAS: readonly ProfessionalRequestRow[] = [
  {
    id: id(1),
    serviceId: '88888888-8888-4888-8888-888888888888',
    serviceName: 'Eletricista',
    urgency: 'imediato',
    description: 'Descricao sintetica do pedido um',
    publicLabel: 'Campinas - SP',
    distanceKm: 0.5,
    modality: 'presencial',
    publishedAt: '2026-11-19T11:00:00.000Z',
    acceptanceDeadlineAt: '2026-11-26T11:00:00.000Z',
  },
  {
    id: id(2),
    serviceId: '88888888-8888-4888-8888-888888888888',
    serviceName: 'Eletricista',
    urgency: 'proximas_semanas',
    description: 'Descricao sintetica do pedido dois',
    publicLabel: 'Campinas - SP',
    distanceKm: 2.5,
    modality: 'presencial',
    publishedAt: '2026-11-19T11:00:00.000Z',
    acceptanceDeadlineAt: '2026-11-26T11:00:00.000Z',
  },
  {
    id: id(3),
    serviceId: '99999999-9999-4999-8999-999999999999',
    serviceName: 'Consultoria',
    urgency: 'nao_definido',
    description: 'Descricao sintetica do pedido tres',
    publicLabel: null,
    distanceKm: null,
    modality: 'online',
    publishedAt: '2026-11-19T11:00:00.000Z',
    acceptanceDeadlineAt: '2026-11-26T11:00:00.000Z',
  },
];

const DESCOBERTOS: readonly DiscoveryCursor[] = LINHAS.map((l, i) => ({
  group: l.modality === 'online' ? 1 : 0,
  key: i,
  requestId: l.id,
}));

interface Mundo {
  cotaBarrada: boolean;
  falhaBanco: boolean;
  semPedidos: boolean;
}
const mundo: Mundo = { cotaBarrada: false, falhaBanco: false, semPedidos: false };

function montar(): DiscoveryRouteOptions {
  const service: DiscoveryServiceDeps = {
    cursor: cursorCodec,
    clock: { nowMs: () => AGORA },
    store: {
      discover: async (entrada) => {
        if (mundo.falhaBanco) throw new Error('detalhe interno que nao pode sair');
        if (mundo.semPedidos) return [];
        return DESCOBERTOS.slice(0, entrada.limit);
      },
    },
    projection: {
      project: async (_prof, ids) => {
        const porId = new Map(LINHAS.map((l) => [l.id, l]));
        return ids.map((i) => porId.get(i)).filter((l): l is ProfessionalRequestRow => l !== undefined);
      },
    },
    // Um pedido com foto pronta: o campo has_photos deve sair true so para ele.
    photos: { withPhotos: async () => new Set<string>([id(2)]) },
  };
  return {
    sessions: {
      authenticate: async (hash) => {
        if (hash === hashSessionSecret(SEG_PRO)) return { userId: PRO };
        if (hash === hashSessionSecret(SEG_SEM)) return { userId: SEM_PERFIL };
        return null;
      },
    },
    profissional: { existe: async (userId) => userId !== SEM_PERFIL },
    limite: {
      check: async (): Promise<RateWindowDecision> =>
        mundo.cotaBarrada ? { decision: 'barrado', retryAfterSeconds: 9 } : { decision: 'permitido' },
      record: async () => undefined,
    },
    service,
  };
}

const opts = montar();
let servidor: Server;
let base: string;

beforeAll(async () => {
  servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleDiscoveryRoute(req, res, opts);
  });
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
});

interface Resposta {
  status: number;
  raw: string;
  json: unknown;
}

function chamar(caminho: string, cookieValor?: string): Promise<Resposta> {
  const url = new URL(caminho, base);
  const headers: Record<string, string> = {};
  if (cookieValor) headers.cookie = `${SESSION_COOKIE_NAME}=${cookieValor}`;
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: 'GET', headers }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (raw += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, raw, json: raw === '' ? null : JSON.parse(raw) }));
    });
    req.on('error', reject);
    req.end();
  });
}

function reiniciar(): void {
  mundo.cotaBarrada = false;
  mundo.falhaBanco = false;
  mundo.semPedidos = false;
}

/** Todas as respostas que a rota pode dar, incluindo os erros, para a varredura de privacidade. */
async function todasAsRespostas(): Promise<Resposta[]> {
  reiniciar();
  const respostas: Resposta[] = [await chamar(`${CAMINHO}?limit=3`, SEG_PRO)];
  respostas.push(await chamar(CAMINHO));
  respostas.push(await chamar(`${CAMINHO}?limit=0`, SEG_PRO));
  respostas.push(await chamar(`${CAMINHO}?cursor=lixo`, SEG_PRO));
  respostas.push(await chamar(CAMINHO, SEG_INVALIDO));
  respostas.push(await chamar(CAMINHO, SEG_SEM));
  mundo.cotaBarrada = true;
  respostas.push(await chamar(CAMINHO, SEG_PRO));
  mundo.cotaBarrada = false;
  mundo.falhaBanco = true;
  respostas.push(await chamar(CAMINHO, SEG_PRO));
  reiniciar();
  return respostas;
}

describe('T-22: lista fechada de chaves do item', () => {
  it('cada item sai com exatamente as chaves de DISCOVERY_ITEM_KEYS, na mesma ordem, e nenhuma extra', async () => {
    reiniciar();
    const r = await chamar(`${CAMINHO}?limit=3`, SEG_PRO);
    expect(r.status).toBe(200);
    const itens = (r.json as { items: Record<string, unknown>[] }).items;
    expect(itens).toHaveLength(3);
    for (const item of itens) {
      expect(Object.keys(item)).toEqual([...DISCOVERY_ITEM_KEYS]);
    }
  });

  it('a lista fechada tem 11 chaves e nenhuma delas e um dado interno ou pessoal', () => {
    expect(DISCOVERY_ITEM_KEYS).toHaveLength(11);
    for (const chave of DISCOVERY_ITEM_KEYS) {
      for (const proibido of PROIBIDOS) {
        expect(chave.toLowerCase()).not.toContain(proibido.toLowerCase());
      }
    }
  });

  it('has_photos e true so no pedido que tem foto pronta', async () => {
    reiniciar();
    const r = await chamar(`${CAMINHO}?limit=3`, SEG_PRO);
    const itens = (r.json as { items: { id: string; has_photos: unknown }[] }).items;
    expect(itens.map((i) => [i.id, i.has_photos])).toEqual([
      [id(1), false],
      [id(2), true],
      [id(3), false],
    ]);
  });
});

describe('T-23: varredura do corpo de toda resposta e dos erros', () => {
  it('nenhum termo proibido aparece no corpo de 200, 400, 401, 403, 429 ou 503', async () => {
    const respostas = await todasAsRespostas();
    expect(respostas.map((r) => r.status)).toEqual([200, 401, 400, 400, 401, 403, 429, 503]);
    for (const r of respostas) {
      const minusculo = r.raw.toLowerCase();
      for (const termo of PROIBIDOS) {
        expect(minusculo, `status ${r.status} contem ${termo}`).not.toContain(termo.toLowerCase());
      }
    }
  });

  it('o corpo 200 traz so o envelope e os 11 campos do item, sem campos extras no topo', async () => {
    reiniciar();
    const r = await chamar(`${CAMINHO}?limit=3`, SEG_PRO);
    expect(Object.keys(r.json as object).sort()).toEqual(['has_more', 'items', 'next_cursor']);
  });

  it('a descricao e a unica texto livre do cliente e sai integra, sem dados de contato anexados', async () => {
    reiniciar();
    const r = await chamar(`${CAMINHO}?limit=1`, SEG_PRO);
    const item = (r.json as { items: { description: string }[] }).items[0];
    expect(item?.description).toBe('Descricao sintetica do pedido um');
  });

  it('pagina vazia de inelegivel e elegivel sem pedidos tem o mesmo corpo, sem campo extra', async () => {
    reiniciar();
    mundo.semPedidos = true;
    const vazia = await chamar(CAMINHO, SEG_PRO);
    reiniciar();
    expect(vazia.raw).toBe(JSON.stringify({ items: [], next_cursor: null, has_more: false }));
  });
});
