// Issue 68 (H-055) | Adaptador de projecao com cliente falso (docs/factory/153-DESENHO-H055.md, §5.2; T-H055-16, T-H055-31).
// Sem banco: ordem preservada com respostas fora de ordem, no maximo 8 em paralelo, descarte silencioso de id sem
// linha, mesmo instante em todas as chamadas e erro convertido em codigo fixo sem texto de driver.
import { describe, it, expect } from 'vitest';
import { DiscoveryProjectionError, PgDiscoveryProjectionStore } from '../src/discovery-projection.js';

type Chamada = { sql: string; params: unknown[] | undefined };

const PROF = '00000000-0000-4000-8000-000000000001';
const AT = new Date('2099-08-15T12:00:00.000Z');

function linhaDe(requestId: string) {
  return {
    out_id: requestId,
    out_service_id: 'svc-1',
    out_service_name: 'Encanador',
    out_urgency: 'imediato',
    out_description: 'Vazamento',
    out_public_label: 'Campinas - SP',
    out_distance_km: 1.5,
    out_modality: 'presencial',
    out_published_at: '2099-08-15T10:00:00.000Z',
    out_deadline_at: '2099-08-16T10:00:00.000Z',
  };
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Cliente falso: responde por id, com atraso configuravel e controle de concorrencia. */
function clienteFalso(opcoes: {
  atrasoMs?: (requestId: string) => number;
  semLinha?: ReadonlySet<string>;
  falha?: boolean;
}) {
  const chamadas: Chamada[] = [];
  let emVoo = 0;
  let pico = 0;
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      chamadas.push({ sql, params });
      emVoo += 1;
      pico = Math.max(pico, emVoo);
      try {
        const requestId = String(params?.[1]);
        if (opcoes.falha) throw new Error('password authentication failed for user "app_system" at 10.0.0.5');
        await esperar(opcoes.atrasoMs?.(requestId) ?? 0);
        if (opcoes.semLinha?.has(requestId)) return { rows: [] };
        return { rows: [linhaDe(requestId)] };
      } finally {
        emVoo -= 1;
      }
    },
  };
  return { chamadas, client, pico: () => pico };
}

describe('PgDiscoveryProjectionStore (Issue 68)', () => {
  it('devolve as linhas na ordem da descoberta mesmo com respostas fora de ordem', async () => {
    const ids = ['r1', 'r2', 'r3', 'r4', 'r5'];
    const f = clienteFalso({ atrasoMs: (id) => (id === 'r1' ? 30 : id === 'r3' ? 5 : 0) });
    const projecao = await new PgDiscoveryProjectionStore(f.client).project(PROF, ids, AT);
    expect(projecao.map((l) => l.id)).toEqual(ids);
    expect(projecao[0].serviceName).toBe('Encanador');
    expect(projecao[0].distanceKm).toBe(1.5);
  });

  it('nunca tem mais de 8 chamadas em voo, mesmo com 20 ids', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `r${i}`);
    const f = clienteFalso({ atrasoMs: () => 5 });
    const projecao = await new PgDiscoveryProjectionStore(f.client).project(PROF, ids, AT);
    expect(projecao).toHaveLength(20);
    expect(f.pico()).toBeLessThanOrEqual(8);
    expect(f.pico()).toBeGreaterThan(1);
  });

  it('descarta em silencio o id sem linha e mantem os demais na ordem (A-4)', async () => {
    const f = clienteFalso({ semLinha: new Set(['r2']) });
    const projecao = await new PgDiscoveryProjectionStore(f.client).project(PROF, ['r1', 'r2', 'r3'], AT);
    expect(projecao.map((l) => l.id)).toEqual(['r1', 'r3']);
  });

  it('usa o mesmo instante em todas as chamadas e a chamada da projecao do profissional', async () => {
    const f = clienteFalso({});
    await new PgDiscoveryProjectionStore(f.client).project(PROF, ['r1', 'r2'], AT);
    expect(f.chamadas).toHaveLength(2);
    for (const c of f.chamadas) {
      expect(c.sql).toContain('private.request_detail_professional');
      expect(c.params?.[0]).toBe(PROF);
      expect(c.params?.[2]).toBe(AT.toISOString());
    }
  });

  it('lista vazia nao chama o banco', async () => {
    const f = clienteFalso({});
    const projecao = await new PgDiscoveryProjectionStore(f.client).project(PROF, [], AT);
    expect(projecao).toEqual([]);
    expect(f.chamadas).toHaveLength(0);
  });

  it('erro do banco vira o codigo fixo discovery_projecao_falhou, sem texto de driver', async () => {
    const f = clienteFalso({ falha: true });
    const erro = await new PgDiscoveryProjectionStore(f.client)
      .project(PROF, ['r1'], AT)
      .then(() => null, (e: unknown) => e);
    expect(erro).toBeInstanceOf(DiscoveryProjectionError);
    expect((erro as DiscoveryProjectionError).code).toBe('discovery_projecao_falhou');
    expect((erro as Error).message).toBe('discovery_projecao_falhou');
    expect((erro as Error).message).not.toContain('password');
    expect((erro as Error).message).not.toContain('10.0.0.5');
  });

  it('instante invalido falha com o codigo fixo antes de qualquer chamada', async () => {
    const f = clienteFalso({});
    await expect(new PgDiscoveryProjectionStore(f.client).project(PROF, ['r1'], new Date('x'))).rejects.toMatchObject({
      code: 'discovery_projecao_falhou',
    });
    expect(f.chamadas).toHaveLength(0);
  });
});
