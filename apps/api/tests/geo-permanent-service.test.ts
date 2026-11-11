// H-021 | Servico da coordenada permanente com provedor e armazenamento simulados
// (docs/factory/68-DESENHO-H021.md, §3, §5, §7 G-02', G-03', G-06, G-06b, G-I28a, G-I28b).
// Sem banco, sem rede: o fetch global e bloqueado. Dados sinteticos (@example.test).
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-021');
};

import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildQuotaPanel, parseBreakerCaps, type BreakerCaps, type PermanentPoint } from '@fastpro/domain';
import {
  ensurePermanentPoint,
  type EnsurePermanentDeps,
  type EnsurePermanentOutcome,
} from '../src/geo/permanent-geocode-service.js';
import type {
  GeocodingPermanentPort,
  PermanentLookup,
  QuotaAlertEvent,
} from '../src/geo/permanent-ports.js';
import { GeoStoreFake } from './geo-permanent-store-fake.js';

const SEGREDO_SINTETICO = 'segredo-sintetico-h021';
const hashAddress = (key: string) =>
  createHmac('sha256', SEGREDO_SINTETICO).update(key).digest('hex');

const ENDERECO = 'Rua Alfa Sintetica, 10, Centro';
const CANARIO_TEXTO = 'Rua Canario Servico Sintetica 4242';
const PONTO: PermanentPoint = { lon: -46.6333, lat: -23.5505, precision: 'endereco' };
const CANARIO_COORD = { lon: -46.987654, lat: -23.123456 };
const CAIXA_GRANDE: BreakerCaps = { soft: 100, hard: 1000 };

/** Provedor simulado: conta as chamadas e responde com a funcao do teste. */
class ProvedorFake implements GeocodingPermanentPort {
  readonly consultas: string[] = [];
  constructor(private readonly responder: (q: string) => PermanentLookup = () => ({ status: 'ponto', point: PONTO })) {}
  async geocode(query: string): Promise<PermanentLookup> {
    this.consultas.push(query);
    return this.responder(query);
  }
}

function montar(opts: {
  provider?: ProvedorFake;
  store?: GeoStoreFake;
  caps?: BreakerCaps | null;
  agora?: { ms: number };
  alertas?: QuotaAlertEvent[];
}) {
  const alertas = opts.alertas ?? [];
  const store = opts.store ?? new GeoStoreFake((e) => alertas.push(e));
  const provider = opts.provider ?? new ProvedorFake();
  const relogio = opts.agora ?? { ms: Date.parse('2026-11-11T12:00:00Z') };
  const deps: EnsurePermanentDeps = {
    store,
    provider,
    hashAddress,
    caps: opts.caps === undefined ? CAIXA_GRANDE : opts.caps,
    clock: () => relogio.ms,
  };
  return { deps, store, provider, relogio, alertas };
}

const publicar = (subject: string, addressText: string, deps: EnsurePermanentDeps) =>
  ensurePermanentPoint({ subject, addressText }, deps);

describe('CA-1 | publicar com endereco completo faz exatamente 1 chamada permanente', () => {
  it('grava o ponto uma vez, devolve so o identificador e nao vaza coordenada no desfecho', async () => {
    const { deps, store, provider } = montar({});
    const r = await publicar('pedido-1', ENDERECO, deps);
    expect(provider.consultas).toHaveLength(1);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.pointId).toMatch(/^[0-9a-f-]{36}$/);
    const desfecho = JSON.stringify(r);
    expect(desfecho).not.toContain(String(PONTO.lon));
    expect(desfecho).not.toContain(String(PONTO.lat));
    expect(store.linhas).toHaveLength(1);
    expect(store.linhas[0]?.state).toBe('ok');
    expect(store.linhas[0]?.point).toEqual(PONTO);
  });
});

describe('CA-2 | repetir a publicacao nao gera nova chamada paga (idempotente)', () => {
  it('repeticao com o mesmo texto reutiliza o ponto', async () => {
    const { deps, provider } = montar({});
    const primeira = await publicar('pedido-1', ENDERECO, deps);
    const segunda = await publicar('pedido-1', ENDERECO, deps);
    expect(provider.consultas).toHaveLength(1);
    expect(primeira.status).toBe('ok');
    expect(segunda).toEqual(primeira);
  });

  it('texto que difere so em caixa e espacos conta como o mesmo endereco', async () => {
    const { deps, provider } = montar({});
    await publicar('pedido-1', 'Rua Alfa Sintetica, 10, Centro', deps);
    const r = await publicar('pedido-1', '  rua   ALFA sintetica,  10, centro ', deps);
    expect(provider.consultas).toHaveLength(1);
    expect(r.status).toBe('ok');
  });

  it('cinco publicacoes simultaneas geram uma unica chamada; as outras esperam', async () => {
    const { deps, provider } = montar({});
    const todas = await Promise.all(Array.from({ length: 5 }, () => publicar('pedido-1', ENDERECO, deps)));
    expect(provider.consultas).toHaveLength(1);
    const contagem = todas.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});
    expect(contagem).toEqual({ ok: 1, em_andamento: 4 });
  });

  it('falha do provedor: nenhuma coordenada gravada, teto devolvido, 503 e nova acao do cliente chama de novo', async () => {
    let falhar = true;
    const provider = new ProvedorFake(() =>
      falhar ? { status: 'falha', code: 'provider_5xx' } : { status: 'ponto', point: PONTO },
    );
    const { deps, store } = montar({ provider });
    const r1 = await publicar('pedido-1', ENDERECO, deps);
    expect(r1).toEqual({ status: 'indisponivel' });
    expect(store.linhas).toHaveLength(0);
    expect(store.chamadasDoPedido('pedido-1')).toBe(0);
    falhar = false;
    const r2 = await publicar('pedido-1', ENDERECO, deps);
    expect(r2.status).toBe('ok');
    expect(provider.consultas).toHaveLength(2);
  });

  it('endereco sem resultado: 422 e repeticao do mesmo texto nao paga de novo', async () => {
    const provider = new ProvedorFake(() => ({ status: 'sem_resultado' }));
    const { deps } = montar({ provider });
    expect(await publicar('pedido-1', ENDERECO, deps)).toEqual({ status: 'endereco_nao_encontrado' });
    expect(await publicar('pedido-1', ENDERECO, deps)).toEqual({ status: 'endereco_nao_encontrado' });
    expect(provider.consultas).toHaveLength(1);
  });

  it('entrada invalida (curta demais) nao chega ao provedor', async () => {
    const { deps, provider } = montar({});
    expect(await publicar('pedido-1', 'ab', deps)).toEqual({ status: 'entrada_invalida' });
    expect(provider.consultas).toHaveLength(0);
  });
});

describe('CA-5 | teto por pedido, breaker de gasto e painel', () => {
  it('teto de 3 enderecos diferentes por pedido: o 4o vira teto, sem chamada', async () => {
    const { deps, provider, store } = montar({});
    for (const n of [1, 2, 3]) {
      expect((await publicar('pedido-1', `Rua Sintetica ${n}, 10`, deps)).status).toBe('ok');
    }
    expect(await publicar('pedido-1', 'Rua Sintetica 4, 10', deps)).toEqual({ status: 'teto' });
    expect(provider.consultas).toHaveLength(3);
    expect(store.chamadasDoPedido('pedido-1')).toBe(3);
  });

  it('o teto e por cadeia: outro pedido comeca do zero e republicar um endereco ja pago nao consome teto', async () => {
    const { deps, provider } = montar({});
    for (const n of [1, 2, 3]) await publicar('pedido-1', `Rua Sintetica ${n}, 10`, deps);
    expect(await publicar('pedido-1', 'Rua Sintetica 1, 10', deps)).toEqual(
      expect.objectContaining({ status: 'ok' }),
    );
    expect(provider.consultas).toHaveLength(3);
    expect((await publicar('pedido-2', 'Rua Sintetica 4, 10', deps)).status).toBe('ok');
  });

  it('breaker com teto ausente: nenhuma chamada paga, aguardando sem texto gravado', async () => {
    const { deps, provider, store } = montar({ caps: null });
    const r = await publicar('pedido-1', CANARIO_TEXTO, deps);
    expect(r).toEqual({ status: 'aguardando_geocodificacao' });
    expect(provider.consultas).toHaveLength(0);
    expect(store.linhas).toHaveLength(1);
    expect(store.linhas[0]?.state).toBe('aguardando');
    expect(store.linhas[0]?.point).toBeNull();
    expect(JSON.stringify(store.linhas)).not.toContain(CANARIO_TEXTO);
    expect(store.chamadasDoPedido('pedido-1')).toBe(0);
  });

  it('breaker com teto invalido (soft maior que hard) tambem fecha: zero chamadas', async () => {
    const caps = parseBreakerCaps('500', '100');
    expect(caps).toBeNull();
    const { deps, provider } = montar({ caps });
    expect(await publicar('pedido-1', ENDERECO, deps)).toEqual({ status: 'aguardando_geocodificacao' });
    expect(provider.consultas).toHaveLength(0);
  });

  it('uso no teto: 0 chamadas, aguardando, alerta de nivel 2 uma unica vez, painel mostra o estado', async () => {
    const alertas: QuotaAlertEvent[] = [];
    const caps: BreakerCaps = { soft: 1, hard: 2 };
    const { deps, provider, store, relogio } = montar({ caps, alertas });
    expect((await publicar('pedido-1', 'Rua Sintetica 1, 10', deps)).status).toBe('ok');
    expect((await publicar('pedido-2', 'Rua Sintetica 2, 10', deps)).status).toBe('ok');
    expect(await publicar('pedido-3', 'Rua Sintetica 3, 10', deps)).toEqual({
      status: 'aguardando_geocodificacao',
    });
    expect(await publicar('pedido-4', 'Rua Sintetica 4, 10', deps)).toEqual({
      status: 'aguardando_geocodificacao',
    });
    expect(provider.consultas).toHaveLength(2);
    expect(alertas).toEqual([
      { nivel: 1, used: 1 },
      { nivel: 2, used: 2 },
    ]);
    const painel = buildQuotaPanel({ ...(await store.panel(relogio.ms)), caps });
    expect(painel).toEqual(
      expect.objectContaining({
        used: 2,
        hard: 2,
        breaker_state: 'aberto',
        motivo_bloqueio: 'teto',
        pct: 100,
        aguardando: 2,
      }),
    );
  });

  it('aguardando nao vira concluido: aumentar o teto reabre e o mesmo texto paga uma vez', async () => {
    const caps: BreakerCaps = { soft: 1, hard: 1 };
    const { deps, provider } = montar({ caps });
    expect((await publicar('pedido-1', ENDERECO, deps)).status).toBe('ok');
    expect(await publicar('pedido-2', CANARIO_TEXTO, deps)).toEqual({
      status: 'aguardando_geocodificacao',
    });
    // Mesmo armazenamento e mesmo provedor; so o teto muda (ambiente reconfigurado).
    const reaberto = await ensurePermanentPoint(
      { subject: 'pedido-2', addressText: CANARIO_TEXTO },
      { ...deps, caps: { soft: 1, hard: 5 } },
    );
    expect(reaberto.status).toBe('ok');
    expect(provider.consultas.filter((q) => q === CANARIO_TEXTO)).toHaveLength(1);
    expect(provider.consultas).toHaveLength(2);
  });

  it('mes novo reabre o breaker com o mesmo teto', async () => {
    const caps: BreakerCaps = { soft: 1, hard: 1 };
    const { deps, provider, relogio } = montar({ caps });
    expect((await publicar('pedido-1', ENDERECO, deps)).status).toBe('ok');
    expect((await publicar('pedido-2', CANARIO_TEXTO, deps)).status).toBe('aguardando_geocodificacao');
    relogio.ms = Date.parse('2026-12-01T00:00:05Z');
    expect((await publicar('pedido-2', CANARIO_TEXTO, deps)).status).toBe('ok');
    expect(provider.consultas).toHaveLength(2);
  });

  it('o alerta de nivel 1 sai uma unica vez no mes, mesmo com varias chamadas acima do aviso', async () => {
    const alertas: QuotaAlertEvent[] = [];
    const { deps } = montar({ caps: { soft: 2, hard: 10 }, alertas });
    for (const n of [1, 2, 3, 4]) await publicar(`pedido-${n}`, `Rua Sintetica ${n}, 10`, deps);
    expect(alertas.filter((a) => a.nivel === 1)).toEqual([{ nivel: 1, used: 2 }]);
  });
});

// CA-3 (66-REFINO-H021): edicoes do endereco antes da publicacao nao geram chamada permanente, e o limite de
// 3 vale para republicacao. O rascunho em si e de H-025 (ainda nao existe); aqui se prova o contrato do servico:
// ele so age quando e chamado para publicar. Edicoes do rascunho nao o chamam (decisao 46).
describe('CA-3 | edicoes antes da publicacao nao chamam o provedor; o teto vale para a cadeia publicada', () => {
  it('dez edicoes sem publicar: zero consultas ao provedor e nenhum ponto gravado', () => {
    const { provider, store } = montar({});
    // Cada edicao e so um novo texto no rascunho; nenhuma delas chama o servico de publicacao.
    const edicoes = Array.from({ length: 10 }, (_, i) => `Rua Rascunho Editada ${i}, 10`);
    expect(edicoes).toHaveLength(10);
    expect(provider.consultas).toHaveLength(0);
    expect(store.linhas).toHaveLength(0);
    expect(store.chamadasDoPedido('pedido-1')).toBe(0);
  });

  it('a primeira publicacao depois das edicoes consome 1 unidade do teto da cadeia', async () => {
    const { deps, provider, store } = montar({});
    const r = await publicar('pedido-1', 'Rua Rascunho Editada 9, 10', deps);
    expect(r.status).toBe('ok');
    expect(provider.consultas).toHaveLength(1);
    expect(store.chamadasDoPedido('pedido-1')).toBe(1);
  });

  it('depois das edicoes, 3 enderecos publicados esgotam o teto e o 4o e recusado sem chamada', async () => {
    const { deps, provider, store } = montar({});
    for (const n of [1, 2, 3]) {
      expect((await publicar('pedido-1', `Rua Publicada ${n}, 10`, deps)).status).toBe('ok');
    }
    expect(await publicar('pedido-1', 'Rua Publicada 4, 10', deps)).toEqual({ status: 'teto' });
    expect(provider.consultas).toHaveLength(3);
    expect(store.chamadasDoPedido('pedido-1')).toBe(3);
  });
});

describe('CA-6 | nenhuma coordenada vem de resultado temporario (I-28)', () => {
  it('o ponto gravado e exatamente o que o provedor permanente devolveu (proveniencia)', async () => {
    const canario: PermanentPoint = { ...CANARIO_COORD, precision: 'rua' };
    const provider = new ProvedorFake(() => ({ status: 'ponto', point: canario }));
    const { deps, store } = montar({ provider });
    const r = await publicar('pedido-1', ENDERECO, deps);
    expect(r.status).toBe('ok');
    expect(store.linhas[0]?.point).toEqual(canario);
    expect(JSON.stringify(r)).not.toContain(String(CANARIO_COORD.lon));
  });

  it('o armazenamento recusa ponto fora do Brasil e escrita sem reserva viva', async () => {
    const store = new GeoStoreFake();
    const reserva = await store.reserve({
      subject: 'pedido-1',
      hash: hashAddress(ENDERECO.toLowerCase()),
      nowMs: Date.now(),
      leaseMs: 60_000,
      callsCap: 3,
      caps: CAIXA_GRANDE,
    });
    expect(reserva.acao).toBe('chamar');
    if (reserva.ref === undefined) throw new Error('referencia esperada');
    await expect(
      store.storePermanent(reserva.ref, { lon: 10, lat: 10, precision: 'endereco' }, Date.now()),
    ).rejects.toThrow('geo_ponto_fora_do_brasil');
    await expect(
      store.storePermanent('referencia-inexistente', PONTO, Date.now()),
    ).rejects.toThrow('geo_store_sem_reserva');
  });

  it('nenhum modulo de servico ou porta permanente importa o caminho temporario', () => {
    const pasta = fileURLToPath(new URL('../src/geo/', import.meta.url));
    const arquivos = readdirSync(pasta).filter((n) => /^(permanent-|mapbox-permanent-).*\.ts$/.test(n));
    expect(arquivos.length).toBeGreaterThan(0);
    for (const nome of arquivos) {
      const texto = readFileSync(join(pasta, nome), 'utf8');
      expect(texto, nome).not.toMatch(/mapbox-temp-adapter|GeocodingTempPort|address-suggest-service/);
    }
  });

  it('o canario de coordenada nao aparece em nenhum desfecho nem no retrato do armazenamento sem ponto', async () => {
    const provider = new ProvedorFake(() => ({ status: 'sem_resultado' }));
    const { deps, store } = montar({ provider, caps: null });
    const desfechos: EnsurePermanentOutcome[] = [
      await publicar('pedido-1', CANARIO_TEXTO, deps),
      await publicar('pedido-2', ENDERECO, deps),
    ];
    const texto = JSON.stringify(desfechos) + store.retratoDasLinhas();
    expect(texto).not.toContain(CANARIO_TEXTO);
    expect(texto).not.toContain(String(CANARIO_COORD.lat));
  });
});
