// Pacote C (H-060, H-082, H-083) | Rotas de segunda onda e republicacao com loja em memoria (sem rede e sem banco).
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleWaveRoute, isWaveRoute, waveRoute, type WaveRouteOptions } from '../src/waves/wave-route.js';
import { createDraftHasher } from '../src/drafts/draft-hash.js';
import { DRAFT_LIVE_CAP_DEFAULT, DRAFT_TTL_DAYS } from '@fastpro/domain';

const SITE = 'https://fastpro.example';
const CLIENTE = '11111111-1111-4111-8111-111111111111';
const OUTRO = '99999999-9999-4999-8999-999999999999';
const PEDIDO = '22222222-2222-4222-8222-222222222222';
const CANCELADO = '33333333-3333-4333-8333-333333333333';
const SEM_ENDERECO = '44444444-4444-4444-8444-444444444444';
// 43 caracteres em base64url, o formato do segredo de rascunho (newDraftSecret).
const SEGREDO_NOVO = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';

const chamadasRepublicar: { originId: string; addressText: string; ttlDays: number; liveCap: number }[] = [];
let falhaNoBanco = false;
// Estado da onda: a primeira abertura grava; repeticao devolve sem_mudanca.
let abriu = false;

const opts: WaveRouteOptions = {
  siteUrl: SITE,
  sessions: { authenticate: async (hash) => (hash.length === 64 ? { userId: CLIENTE } : null) },
  clock: { nowMs: () => Date.UTC(2026, 10, 23, 12) },
  origem: {
    enderecoDoDono: async (usuario, pedido) => {
      if (falhaNoBanco) throw new Error('falha simulada');
      if (usuario !== CLIENTE) return null;
      if (pedido === PEDIDO || pedido === CANCELADO) return 'Rua das Flores, 100';
      return null;
    },
  },
  rascunho: {
    hasher: createDraftHasher('k'.repeat(32)),
    novoSegredo: () => SEGREDO_NOVO,
  },
  store: {
    acoes: async (pedido, usuario) => {
      if (falhaNoBanco) throw new Error('falha simulada');
      if (usuario !== CLIENTE || pedido !== PEDIDO) return null;
      return { canCallMore: true, canRepublish: false };
    },
    abrirOnda2: async (pedido, usuario) => {
      if (usuario !== CLIENTE || pedido !== PEDIDO) return { outcome: 'nao_encontrado', wave2OpenedAt: null };
      if (pedido === PEDIDO && abriu) return { outcome: 'sem_mudanca', wave2OpenedAt: '2026-11-23T12:00:00.000Z' };
      abriu = true;
      return { outcome: 'aberta', wave2OpenedAt: '2026-11-23T12:00:00.000Z' };
    },
    republicar: async (entrada) => {
      if (falhaNoBanco) throw new Error('falha simulada');
      chamadasRepublicar.push({ originId: entrada.originId, addressText: entrada.addressText, ttlDays: entrada.ttlDays, liveCap: entrada.liveCap });
      if (entrada.originId === CANCELADO && chamadasRepublicar.length === 1) {
        return { outcome: 'rascunho_criado', draftId: '55555555-5555-4555-8555-555555555555', expiresAt: '2026-11-30T12:00:00.000Z' };
      }
      if (entrada.originId === CANCELADO) return { outcome: 'ja_existe', draftId: null, expiresAt: null };
      return { outcome: 'origem_invalida', draftId: null, expiresAt: null };
    },
  },
};

let server: Server;
let base = '';
beforeAll(async () => {
  server = createServer((req, res) => void handleWaveRoute(req, res, new URL(req.url ?? '/', 'http://x').pathname, opts));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const cookie = { Cookie: '__Host-fp_sess=segredo' };
async function chamar(metodo: string, caminho: string, origem: string | null = SITE, sessao = true) {
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: { ...(sessao ? cookie : {}), ...(origem ? { Origin: origem } : {}) },
  });
  return { status: r.status, cabecalhos: r.headers, corpo: (await r.json()) as Record<string, unknown> };
}

describe('roteamento', () => {
  it('reconhece as tres rotas com o metodo certo', () => {
    expect(waveRoute('GET', `/v1/requests/${PEDIDO}/actions`)).toEqual({ tipo: 'acoes', id: PEDIDO });
    expect(waveRoute('POST', `/v1/requests/${PEDIDO}/more-professionals`)).toEqual({ tipo: 'onda', id: PEDIDO });
    expect(waveRoute('POST', `/v1/requests/${PEDIDO}/republish`)).toEqual({ tipo: 'republicar', id: PEDIDO });
  });

  it('nao toma outros caminhos nem metodos errados', () => {
    expect(isWaveRoute('POST', `/v1/requests/${PEDIDO}/actions`)).toBe(false);
    expect(isWaveRoute('GET', `/v1/requests/${PEDIDO}/republish`)).toBe(false);
    expect(isWaveRoute('GET', `/v1/requests/${PEDIDO}`)).toBe(false);
    expect(isWaveRoute('POST', `/v1/requests/${PEDIDO}/selection`)).toBe(false);
  });
});

describe('GET /actions', () => {
  it('devolve o que o dono pode fazer', async () => {
    const r = await chamar('GET', `/v1/requests/${PEDIDO}/actions`, null);
    expect(r.status).toBe(200);
    expect(r.corpo).toEqual({ canCallMore: true, canRepublish: false });
    expect(r.cabecalhos.get('cache-control')).toBe('no-store');
  });

  it('sem sessao responde 401', async () => {
    const r = await chamar('GET', `/v1/requests/${PEDIDO}/actions`, null, false);
    expect(r.status).toBe(401);
    expect(r.corpo).toEqual({ code: 'sessao_necessaria' });
  });

  it('pedido de outro dono ou inexistente responde 404 uniforme', async () => {
    const r = await chamar('GET', `/v1/requests/${OUTRO}/actions`, null);
    expect(r.status).toBe(404);
    expect(r.corpo).toEqual({ code: 'nao_encontrado' });
  });

  it('id mal formado responde 404 sem consultar o banco', async () => {
    const r = await chamar('GET', '/v1/requests/nao-e-uuid/actions', null);
    expect(r.status).toBe(404);
  });
});

describe('POST /more-professionals', () => {
  it('sem Origin valido responde 403', async () => {
    const r = await chamar('POST', `/v1/requests/${PEDIDO}/more-professionals`, 'https://mau.example');
    expect(r.status).toBe(403);
    expect(r.corpo).toEqual({ code: 'origem_invalida' });
  });

  it('abre a segunda onda uma vez e repete como sem_mudanca', async () => {
    const primeira = await chamar('POST', `/v1/requests/${PEDIDO}/more-professionals`);
    expect(primeira.status).toBe(200);
    expect(primeira.corpo).toEqual({ status: 'aberta' });
    const repetida = await chamar('POST', `/v1/requests/${PEDIDO}/more-professionals`);
    expect(repetida.status).toBe(200);
    expect(repetida.corpo).toEqual({ status: 'sem_mudanca' });
  });

  it('sem permissao devolve o codigo fixo do banco', async () => {
    const r = await chamar('POST', `/v1/requests/${OUTRO}/more-professionals`);
    expect(r.status).toBe(404);
    expect(r.corpo).toEqual({ code: 'nao_encontrado' });
  });
});

describe('POST /republish', () => {
  it('cria o rascunho, devolve rascunho_criado e grava o cookie do novo rascunho', async () => {
    const r = await chamar('POST', `/v1/requests/${CANCELADO}/republish`);
    expect(r.status).toBe(201);
    expect(r.corpo).toEqual({ status: 'rascunho_criado' });
    expect(r.cabecalhos.get('set-cookie')).toContain(`__Host-fp_draft=${SEGREDO_NOVO}`);
    expect(chamadasRepublicar.at(-1)).toMatchObject({
      originId: CANCELADO,
      addressText: 'Rua das Flores, 100',
      ttlDays: DRAFT_TTL_DAYS,
      liveCap: DRAFT_LIVE_CAP_DEFAULT,
    });
  });

  it('uma republicacao viva devolve ja_existe sem cookie novo', async () => {
    const r = await chamar('POST', `/v1/requests/${CANCELADO}/republish`);
    expect(r.status).toBe(200);
    expect(r.corpo).toEqual({ status: 'ja_existe' });
    expect(r.cabecalhos.get('set-cookie')).toBeNull();
  });

  it('origem que nao permite republicar responde 409 com codigo fixo', async () => {
    const r = await chamar('POST', `/v1/requests/${PEDIDO}/republish`);
    expect(r.status).toBe(409);
    expect(r.corpo).toEqual({ code: 'origem_invalida' });
  });

  it('pedido sem endereco decifravel (ou de outro dono) responde 404', async () => {
    const r = await chamar('POST', `/v1/requests/${SEM_ENDERECO}/republish`);
    expect(r.status).toBe(404);
    expect(r.corpo).toEqual({ code: 'nao_encontrado' });
  });

  it('sem Origin valido responde 403 e nao cria nada', async () => {
    const antes = chamadasRepublicar.length;
    const r = await chamar('POST', `/v1/requests/${CANCELADO}/republish`, null);
    expect(r.status).toBe(403);
    expect(chamadasRepublicar.length).toBe(antes);
  });

  it('falha do banco ou do cofre responde 503 fixo, sem detalhe', async () => {
    falhaNoBanco = true;
    try {
      const r = await chamar('POST', `/v1/requests/${CANCELADO}/republish`);
      expect(r.status).toBe(503);
      expect(JSON.stringify(r.corpo)).not.toContain('falha simulada');
    } finally {
      falhaNoBanco = false;
    }
  });
});
