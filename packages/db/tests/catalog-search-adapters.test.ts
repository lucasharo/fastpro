// H-019 | Adaptadores Pg da busca de servico, com cliente falso (sem conexao real).
// Cobre: ordem da transacao, rollback, liberacao da conexao, chave HMAC do limite de taxa e formas de resposta.
import { describe, it, expect } from 'vitest';
import {
  CATALOG_RATE_KEY_PREFIX,
  PgCatalogRateLimit,
  PgCatalogSqlRunner,
  SQL_RL_CHECK,
  SQL_RL_HIT,
  type CatalogSearchConnection,
} from '../src/catalog-search.js';

const IP = '203.0.113.77';
const CHAVE = 'k'.repeat(40);

function conexaoFalsa(responder: (text: string, params: unknown[]) => Record<string, unknown>[]) {
  const chamadas: Array<{ text: string; params: unknown[] }> = [];
  let liberada = 0;
  const conn: CatalogSearchConnection = {
    query: async (text, params = []) => {
      chamadas.push({ text, params });
      return { rows: responder(text, params) };
    },
    release: () => {
      liberada += 1;
    },
  };
  return { conn, chamadas, liberadas: () => liberada };
}

describe('PgCatalogSqlRunner', () => {
  it('begin, depois a chamada da transacao, depois commit; devolve a conexao', async () => {
    const f = conexaoFalsa((text) => (text.includes('catalog_search') ? [{ group_id: 'g' }] : []));
    const runner = new PgCatalogSqlRunner(async () => f.conn);
    const out = await runner.transaction(async (tx) => {
      await tx.query("select set_config('app.principal_type', 'anonymous', true)", []);
      return tx.query('select 1 from private.catalog_search($1)', ['pedr']);
    });
    expect(out).toEqual([{ group_id: 'g' }]);
    expect(f.chamadas.map((c) => c.text)).toEqual([
      'begin',
      "select set_config('app.principal_type', 'anonymous', true)",
      'select 1 from private.catalog_search($1)',
      'commit',
    ]);
    expect(f.chamadas[2]?.params).toEqual(['pedr']);
    expect(f.liberadas()).toBe(1);
  });

  it('erro dentro da transacao: rollback, repasse do erro original e conexao liberada', async () => {
    const f = conexaoFalsa((text) => {
      if (text === 'boom') throw new Error('falha');
      return [];
    });
    const runner = new PgCatalogSqlRunner(async () => f.conn);
    await expect(
      runner.transaction(async (tx) => {
        await tx.query('boom', []);
      }),
    ).rejects.toThrow('falha');
    expect(f.chamadas.map((c) => c.text)).toContain('rollback');
    expect(f.chamadas.map((c) => c.text)).not.toContain('commit');
    expect(f.liberadas()).toBe(1);
  });

  it('falha no rollback nao mascara o erro original', async () => {
    const conn: CatalogSearchConnection = {
      query: async (text) => {
        if (text === 'rollback') throw new Error('rollback caiu');
        if (text === 'boom') throw new Error('erro original');
        return { rows: [] };
      },
      release: () => undefined,
    };
    const runner = new PgCatalogSqlRunner(async () => conn);
    await expect(
      runner.transaction(async (tx) => {
        await tx.query('boom', []);
      }),
    ).rejects.toThrow('erro original');
  });
});

describe('PgCatalogRateLimit', () => {
  it('rejeita chave HMAC curta na composicao', () => {
    const f = conexaoFalsa(() => []);
    expect(() => new PgCatalogRateLimit(f.conn, 'curta', () => 0)).toThrow('chave_taxa_busca_invalida');
  });

  it('check usa rl_check com janela 60 s, balde 10 s e limite 90, e chave sem o IP em claro', async () => {
    const f = conexaoFalsa(() => [{ out_ok: true, out_retry_after: 0 }]);
    const limite = new PgCatalogRateLimit(f.conn, CHAVE, () => Date.UTC(2026, 10, 11, 12, 0, 0));
    expect(await limite.check(IP)).toEqual({ ok: true });
    const [chamada] = f.chamadas;
    expect(chamada?.text).toBe(SQL_RL_CHECK);
    expect(chamada?.params).toEqual([
      expect.stringMatching(new RegExp(`^${CATALOG_RATE_KEY_PREFIX}[0-9a-f]{64}$`)),
      60,
      10,
      90,
      '2026-11-11T12:00:00.000Z',
    ]);
    expect(JSON.stringify(f.chamadas)).not.toContain(IP);
  });

  it('a chave muda com o IP e com a chave HMAC, e e estavel para o mesmo par', async () => {
    const f = conexaoFalsa(() => [{ out_ok: true, out_retry_after: 0 }]);
    const a = new PgCatalogRateLimit(f.conn, CHAVE, () => 0);
    const b = new PgCatalogRateLimit(f.conn, 'z'.repeat(40), () => 0);
    await a.check(IP);
    await a.check(IP);
    await a.check('198.51.100.1');
    await b.check(IP);
    const chaves = f.chamadas.map((c) => c.params[0]);
    expect(chaves[0]).toBe(chaves[1]);
    expect(chaves[0]).not.toBe(chaves[2]);
    expect(chaves[0]).not.toBe(chaves[3]);
  });

  it('negado: devolve retryAfterS do banco', async () => {
    const f = conexaoFalsa(() => [{ out_ok: false, out_retry_after: 42 }]);
    const limite = new PgCatalogRateLimit(f.conn, CHAVE, () => 0);
    expect(await limite.check(IP)).toEqual({ ok: false, retryAfterS: 42 });
  });

  it('resposta sem out_ok booleano: erro (a rota responde 503, nunca libera)', async () => {
    const f = conexaoFalsa(() => [{ out_ok: 'sim' }]);
    const limite = new PgCatalogRateLimit(f.conn, CHAVE, () => 0);
    await expect(limite.check(IP)).rejects.toThrow('rl_resposta_invalida');
    const vazio = conexaoFalsa(() => []);
    await expect(new PgCatalogRateLimit(vazio.conn, CHAVE, () => 0).check(IP)).rejects.toThrow(
      'rl_resposta_invalida',
    );
  });

  it('hit chama rl_hit com a mesma chave, balde de 10 s e o instante atual', async () => {
    const f = conexaoFalsa(() => []);
    const limite = new PgCatalogRateLimit(f.conn, CHAVE, () => Date.UTC(2026, 10, 11, 12, 0, 1));
    await limite.hit(IP);
    const [chamada] = f.chamadas;
    expect(chamada?.text).toBe(SQL_RL_HIT);
    expect(chamada?.params).toEqual([
      expect.stringMatching(new RegExp(`^${CATALOG_RATE_KEY_PREFIX}[0-9a-f]{64}$`)),
      10,
      '2026-11-11T12:00:01.000Z',
    ]);
  });
});
