// Testes OFFLINE do keep-alive manual (H-010; T-KA-01 a T-KA-04). Banco falso com dados sinteticos.
// T-KA-05 (efeito contra a pausa, 7 dias no painel) nao cabe em teste: fica NAO_EXECUTADO na Issue.
import { describe, it, expect } from 'vitest';
import { runKeepAlive, lastOkAgeDays, KEEPALIVE_QUERY } from '../scripts/lib/keepalive.mjs';
import { keepAliveLine } from '../scripts/lib/backup.mjs';
import { makeFakeDb } from './fixtures/fake-db.mjs';

const NOW = new Date('2026-11-10T12:00:00Z');
const noPause = async () => {};

function snapshot(state) {
  return JSON.stringify({ tables: state.tables, privileges: state.privileges });
}

describe('T-KA-01: execucoes nao mudam contagens nem objetos', () => {
  it('3 execucoes: tabelas iguais antes e depois, so consultas de leitura', async () => {
    const db = makeFakeDb();
    const before = snapshot(db.state);
    for (let i = 0; i < 3; i += 1) {
      const res = await runKeepAlive({ connect: db.connect, pause: noPause });
      expect(res.ok).toBe(true);
    }
    expect(snapshot(db.state)).toBe(before);
    expect(db.state.connects).toBe(3);
    expect(db.state.ended).toBe(3);
    expect(db.state.statements).toEqual([KEEPALIVE_QUERY, KEEPALIVE_QUERY, KEEPALIVE_QUERY]);
  });
});

describe('T-KA-02: sem escrita, DDL ou privilegio em tabela', () => {
  it('a consulta do keep-alive nao contem instrucao de escrita', () => {
    expect(
      /\b(insert|update|delete|create|alter|drop|truncate|grant|revoke)\b/i.test(KEEPALIVE_QUERY),
    ).toBe(false);
    expect(/^\s*\/\*fp:keepalive\*\/\s*select\b/i.test(KEEPALIVE_QUERY)).toBe(true);
  });
});

describe('T-KA-03: falha de conexao (senha errada ou host inalcancavel)', () => {
  it('ate 3 tentativas, falha na etapa conectar, nada gravado no banco, sem credencial no registro', async () => {
    for (const code of ['28P01', 'ENOTFOUND']) {
      const db = makeFakeDb({ connectError: Object.assign(new Error('x'), { code }) });
      const res = await runKeepAlive({ connect: db.connect, pause: noPause });
      expect(res).toEqual({ ok: false, etapa: 'conectar', tentativas: 3 });
      expect(db.state.connects).toBe(3);
      expect(db.state.statements).toEqual([]);
      const line = keepAliveLine(NOW, res);
      expect(line).toBe('20261110T120000Z falha etapa=conectar');
      expect(line.includes('28P01')).toBe(false);
    }
  });

  it('erro de consulta e timeout tem etapas proprias', async () => {
    const db1 = makeFakeDb({ queryError: Object.assign(new Error('x'), { code: '42501' }) });
    expect(await runKeepAlive({ connect: db1.connect, pause: noPause })).toMatchObject({
      ok: false,
      etapa: 'consultar',
    });
    const db2 = makeFakeDb({ queryError: Object.assign(new Error('x'), { code: '57014' }) });
    expect(await runKeepAlive({ connect: db2.connect, pause: noPause })).toMatchObject({
      ok: false,
      etapa: 'timeout',
    });
  });
});

describe('T-KA-04: registro so com data, hora, resultado e etapa', () => {
  it('linhas seguem o formato fixo', () => {
    expect(keepAliveLine(NOW, { ok: true, etapa: null, tentativas: 1 })).toMatch(
      /^\d{8}T\d{6}Z ok$/,
    );
    expect(keepAliveLine(NOW, { ok: false, etapa: 'timeout' })).toMatch(
      /^\d{8}T\d{6}Z falha etapa=timeout$/,
    );
  });

  it('idade da ultima execucao ok e lida do registro', () => {
    const log = '20261105T120000Z ok\n20261106T120000Z falha etapa=conectar\n';
    expect(lastOkAgeDays(log, NOW)).toBe(5);
    expect(lastOkAgeDays('', NOW)).toBeNull();
  });
});
