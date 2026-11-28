// Issue 47 (H-034) | Testes unitarios do adaptador da lista (docs/factory/133-DESENHO-H034.md, §5, §8; T-15 parte de codigo).
// Cliente falso: confere a chamada (sql e parametros), o mapeamento fechado e o erro fixo sem texto do driver.
import { describe, expect, it } from 'vitest';
import { LISTA_BANCO_FALHOU, PgRequestListStore, SQL_LIST_OWNER } from '../src/request-list.js';
import type { SqlClient } from '../src/jobs-tick.js';

const UUID = '3f2b8c1e-9d4a-4b7e-8f10-2c5d6e7f8a9b';
const NOW_MS = Date.parse('2099-08-15T12:00:00.000Z');

function clienteFalso(rows: Record<string, unknown>[] | Error) {
  const chamadas: { sql: string; params: unknown[] }[] = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      chamadas.push({ sql, params });
      if (rows instanceof Error) throw rows;
      return { rows };
    },
  } as unknown as SqlClient;
  return { client, chamadas };
}

describe('chamada da funcao de lista', () => {
  it('passa usuario, relogio em ISO, cursor e limite na ordem da funcao, sem concatenar texto', async () => {
    const f = clienteFalso([]);
    await new PgRequestListStore(f.client).listOwner(UUID, NOW_MS, null, 21);
    expect(f.chamadas).toHaveLength(1);
    expect(f.chamadas[0]?.sql).toBe(SQL_LIST_OWNER);
    expect(SQL_LIST_OWNER).toContain('private.request_list_owner($1::uuid, $2::timestamptz, $3::timestamptz, $4::uuid, $5::integer)');
    expect(f.chamadas[0]?.params).toEqual([UUID, '2099-08-15T12:00:00.000Z', null, null, 21]);
  });

  it('o cursor chega como texto com microssegundos, sem passar por Date', async () => {
    const f = clienteFalso([]);
    await new PgRequestListStore(f.client).listOwner(UUID, NOW_MS, { publishedAt: '2099-08-14T09:00:00.123456Z', id: UUID }, 21);
    expect(f.chamadas[0]?.params).toEqual([UUID, '2099-08-15T12:00:00.000Z', '2099-08-14T09:00:00.123456Z', UUID, 21]);
  });
});

describe('mapeamento fechado (CA-16)', () => {
  it('mapeia so as chaves da lista e o prazo; nao expoe colunas extras que o banco devolvesse', async () => {
    const f = clienteFalso([
      {
        out_id: UUID,
        out_service_name: 'Pintura sintetica',
        out_status: 'publicado',
        out_deadline_state: 'aberto',
        out_published_at: new Date('2099-08-10T10:00:00.000Z'),
        out_deadline_at: new Date('2099-08-17T10:00:00.000Z'),
        out_cursor_ts: '2099-08-10T10:00:00.000000Z',
        out_address_text: 'Rua sintetica 1',
        out_customer_user_id: UUID,
        out_acceptances_count: 3,
      },
    ]);
    const [linha] = await new PgRequestListStore(f.client).listOwner(UUID, NOW_MS, null, 21);
    expect(Object.keys(linha ?? {}).sort()).toEqual(
      ['acceptanceDeadlineAt', 'cursorTs', 'id', 'prazo', 'publishedAt', 'serviceName', 'status'].sort(),
    );
    expect(linha?.prazo).toBe('aberto');
    expect(linha?.cursorTs).toBe('2099-08-10T10:00:00.000000Z');
    expect(linha?.publishedAt).toBe('2099-08-10T10:00:00.000Z');
  });

  it('estado de prazo fora do conjunto vira null (nunca um texto livre)', async () => {
    const f = clienteFalso([{ out_id: UUID, out_status: 'selecionado', out_deadline_state: null, out_cursor_ts: 'x' }]);
    const [linha] = await new PgRequestListStore(f.client).listOwner(UUID, NOW_MS, null, 21);
    expect(linha?.prazo).toBeNull();
  });
});

describe('erro fixo do banco', () => {
  it('falha do driver vira LISTA_BANCO_FALHOU, sem o texto original', async () => {
    const f = clienteFalso(new Error('connection to 10.0.0.1 failed: senha sintetica'));
    const erro = await new PgRequestListStore(f.client).listOwner(UUID, NOW_MS, null, 21).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).toBe(LISTA_BANCO_FALHOU);
    expect((erro as Error).message).not.toContain('senha');
  });
});
