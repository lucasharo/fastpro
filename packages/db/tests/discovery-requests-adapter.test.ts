// Issue 36 (H-023) | Adaptador Pg da descoberta com cliente falso (docs/factory/97-DESENHO-H023.md, §4.1 e §6).
// Issue 55 (H-042): a entrada recebe o instante da requisicao (sexto argumento de private.discover_requests).
// Sem banco: confere parametros, mapeamento de erro para codigo fixo e que nenhuma chamada sai com parametro invalido.
import { describe, it, expect } from 'vitest';
import { DiscoveryStoreError, PgDiscoveryStore } from '../src/discovery-requests.js';

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

const PROF = '00000000-0000-4000-8000-000000000001';
const AT = new Date('2099-08-15T12:00:00.000Z');

describe('PgDiscoveryStore (Issue 36)', () => {
  it('chama private.discover_requests com os parametros na ordem e converte a linha', async () => {
    const f = clienteFalso(async () => ({
      rows: [{ out_request_id: 'req-1', out_cursor_group: 0, out_cursor_key: 1234 }],
    }));
    const loja = new PgDiscoveryStore(f.client);
    const pagina = await loja.discover({ professionalId: PROF, at: AT, limit: 10, after: { group: 1, key: 5, requestId: 'req-0' } });
    expect(f.chamadas[0].sql).toContain(
      'private.discover_requests($1::uuid, $2::integer, $3::smallint, $4::integer, $5::uuid, $6::timestamptz)',
    );
    expect(f.chamadas[0].params).toEqual([PROF, 10, 1, 5, 'req-0', AT.toISOString()]);
    expect(pagina).toEqual([{ requestId: 'req-1', group: 0, key: 1234 }]);
  });

  it('sem limite e sem cursor usa 50, nulos e o instante da requisicao', async () => {
    const f = clienteFalso(async () => ({ rows: [] }));
    await new PgDiscoveryStore(f.client).discover({ professionalId: PROF, at: AT });
    expect(f.chamadas[0].params).toEqual([PROF, 50, null, null, null, AT.toISOString()]);
  });

  it('limite ou cursor invalido falha antes de chamar o banco', async () => {
    const f = clienteFalso(async () => ({ rows: [] }));
    const loja = new PgDiscoveryStore(f.client);
    await expect(loja.discover({ professionalId: PROF, at: AT, limit: 0 })).rejects.toMatchObject({
      code: 'discovery_parametro_invalido',
    });
    await expect(
      loja.discover({ professionalId: PROF, at: AT, after: { group: 3 as 0, key: 0, requestId: 'x' } }),
    ).rejects.toBeInstanceOf(DiscoveryStoreError);
    expect(f.chamadas).toHaveLength(0);
  });

  it('erros do banco viram codigo fixo; texto desconhecido vira discovery_falhou sem repassar a mensagem', async () => {
    const raio = clienteFalso(async () => {
      throw new Error('discover_raio_invalido');
    });
    await expect(new PgDiscoveryStore(raio.client).discover({ professionalId: PROF, at: AT })).rejects.toMatchObject({
      code: 'discovery_raio_invalido',
    });
    const outro = clienteFalso(async () => {
      throw new Error('falha com -46.123457 e 12345');
    });
    const erro = await new PgDiscoveryStore(outro.client)
      .discover({ professionalId: PROF, at: AT })
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(DiscoveryStoreError);
    expect((erro as DiscoveryStoreError).message).toBe('discovery_falhou');
    expect((erro as DiscoveryStoreError).message).not.toContain('46.123457');
  });
});
