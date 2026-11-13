// H-036 | O teto de chamadas informado pela rota (calls_cap) chega ao armazenamento.
// Sem banco, sem rede. Dados sinteticos.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-036');
};

import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import type { BreakerCaps, PermanentPoint } from '@fastpro/domain';
import { PERMANENT_CALLS_PER_REQUEST_MAX } from '@fastpro/domain';
import { ensurePermanentPoint, type EnsurePermanentDeps } from '../src/geo/permanent-geocode-service.js';
import type { GeocodingPermanentPort, PermanentLookup } from '../src/geo/permanent-ports.js';
import { GeoStoreFake } from './geo-permanent-store-fake.js';

const PONTO: PermanentPoint = { lon: -46.6333, lat: -23.5505, precision: 'endereco' };
const CAIXA: BreakerCaps = { soft: 100, hard: 1000 };

class Provedor implements GeocodingPermanentPort {
  async geocode(): Promise<PermanentLookup> {
    return { status: 'ponto', point: PONTO };
  }
}

function montar(): { deps: EnsurePermanentDeps; cabos: number[] } {
  const store = new GeoStoreFake();
  const cabos: number[] = [];
  const original = store.reserve.bind(store);
  store.reserve = async (input) => {
    cabos.push(input.callsCap);
    return original(input);
  };
  const deps: EnsurePermanentDeps = {
    store,
    provider: new Provedor(),
    hashAddress: (k: string) => createHmac('sha256', 'segredo-sintetico-h036').update(k).digest('hex'),
    caps: CAIXA,
    clock: () => Date.parse('2026-11-12T12:00:00Z'),
  };
  return { deps, cabos };
}

describe('H-036 | callsCap de ensurePermanentPoint', () => {
  it('repassa o teto informado pela rota ao armazenamento', async () => {
    const { deps, cabos } = montar();
    await ensurePermanentPoint({ subject: 'prof-1', addressText: 'Rua Beta Sintetica, 20', callsCap: 40 }, deps);
    expect(cabos).toEqual([40]);
  });

  it('sem teto informado usa o padrao do pedido (H-031 e #34 seguem iguais)', async () => {
    const { deps, cabos } = montar();
    await ensurePermanentPoint({ subject: 'pedido-9', addressText: 'Rua Gama Sintetica, 30' }, deps);
    expect(cabos).toEqual([PERMANENT_CALLS_PER_REQUEST_MAX]);
  });
});
