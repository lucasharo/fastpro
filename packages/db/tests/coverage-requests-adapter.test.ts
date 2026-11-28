// Issue 37 (H-024) | Adaptador Pg da cobertura com cliente falso (docs/factory/99-DESENHO-H024.md, §2.2 e §7).
// Sem banco: confere parametros, mapeamento de erro para codigo fixo e que a resposta e so o texto do resultado.
import { describe, it, expect } from 'vitest';
import { CoverageStoreError, PgCoverageStore } from '../src/coverage-requests.js';

type Chamada = { sql: string; params: unknown[] | undefined };

function clienteFalso(resposta: () => Promise<{ rows: Record<string, unknown>[] }>) {
  const chamadas: Chamada[] = [];
  return {
    chamadas,
    client: {
      query: (sql: string, params?: unknown[]) => {
        chamadas.push({ sql, params });
        return resposta();
      },
    },
  };
}

const PEDIDO = '00000000-0000-4000-8000-000000000001';
const DONO = '00000000-0000-4000-8000-000000000002';
const IP = 'a'.repeat(64);
const AGORA = new Date('2099-08-15T12:00:00.000Z');

describe('PgCoverageStore (Issue 37)', () => {
  it('chama private.coverage_for_request com os parametros na ordem e devolve so o texto do resultado', async () => {
    const f = clienteFalso(async () => ({ rows: [{ out_result: 'com' }] }));
    const store = new PgCoverageStore(f.client);
    const r = await store.coverageFor({ requestId: PEDIDO, customerId: DONO, ipKey: IP, now: AGORA });
    expect(r).toBe('com');
    expect(f.chamadas).toHaveLength(1);
    expect(f.chamadas[0].sql).toContain('private.coverage_for_request(');
    expect(f.chamadas[0].params).toEqual([PEDIDO, DONO, IP, AGORA.toISOString(), 60, 60, 20]);
  });

  it('aceita os quatro resultados do banco e nenhum outro (sem contagem, sem lista)', async () => {
    for (const v of ['com', 'sem', 'limite', 'indisponivel']) {
      const f = clienteFalso(async () => ({ rows: [{ out_result: v }] }));
      expect(await new PgCoverageStore(f.client).coverageFor({ requestId: PEDIDO, customerId: DONO, ipKey: IP })).toBe(v);
    }
  });

  it('resposta com colunas extras (contagem, lista, coordenada) nao vaza: so o texto sai', async () => {
    const f = clienteFalso(async () => ({
      rows: [{ out_result: 'sem', total: 5, profissionais: ['x'], lat: -23.5 }],
    }));
    const r = await new PgCoverageStore(f.client).coverageFor({ requestId: PEDIDO, customerId: DONO, ipKey: IP });
    expect(r).toBe('sem');
    expect(typeof r).toBe('string');
  });

  it('resultado fora do conjunto vira falha com codigo fixo', async () => {
    const f = clienteFalso(async () => ({ rows: [{ out_result: '3 profissionais' }] }));
    await expect(new PgCoverageStore(f.client).coverageFor({ requestId: PEDIDO, customerId: DONO, ipKey: IP })).rejects.toMatchObject({
      code: 'coverage_falhou',
    });
  });

  it('parametro invalido nao chega ao banco e devolve codigo fixo', async () => {
    const f = clienteFalso(async () => ({ rows: [] }));
    const store = new PgCoverageStore(f.client);
    const casos = [
      { requestId: 'nao-uuid', customerId: DONO, ipKey: IP },
      { requestId: PEDIDO, customerId: DONO, ipKey: 'IP-EM-CLARO' },
      { requestId: PEDIDO, customerId: DONO, ipKey: IP, limitIp: 0 },
    ];
    for (const c of casos) {
      await expect(store.coverageFor(c)).rejects.toBeInstanceOf(CoverageStoreError);
    }
    expect(f.chamadas).toHaveLength(0);
  });

  it('erro do banco vira codigo fixo; o texto do driver nao sai', async () => {
    const f = clienteFalso(async () => {
      throw new Error('detalhe interno com coordenada -46.123457 e uuid de profissional');
    });
    try {
      await new PgCoverageStore(f.client).coverageFor({ requestId: PEDIDO, customerId: DONO, ipKey: IP });
      expect.unreachable('deveria ter falhado');
    } catch (err) {
      expect(err).toBeInstanceOf(CoverageStoreError);
      expect((err as CoverageStoreError).message).toBe('coverage_falhou');
      expect((err as CoverageStoreError).code).toBe('coverage_falhou');
    }
  });

  it('a consulta enviada nao conta, nao agrega e nao le ponto exato', async () => {
    const f = clienteFalso(async () => ({ rows: [{ out_result: 'com' }] }));
    await new PgCoverageStore(f.client).coverageFor({ requestId: PEDIDO, customerId: DONO, ipKey: IP });
    const sql = f.chamadas[0].sql.toLowerCase();
    expect(sql).not.toMatch(/count|array_agg|string_agg|exact_point|geography|st_/);
  });
});
