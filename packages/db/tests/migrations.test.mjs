import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checksum, listMigrations, plan } from '../scripts/lib/migrations.mjs';
import { parseEnv, safeError } from '../scripts/lib/env.mjs';

function dirWith(files) {
  const dir = mkdtempSync(join(tmpdir(), 'fastpro-mig-'));
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  return dir;
}

describe('listMigrations', () => {
  it('ordena por versao e calcula checksum estavel (CRLF = LF)', () => {
    const dir = dirWith({
      '20261110130000_app_create_b.sql': 'select 2;\n',
      '20261110120000_app_create_a.sql': 'select 1;\r\n',
    });
    const list = listMigrations(dir);
    expect(list.map((m) => m.version)).toEqual(['20261110120000', '20261110130000']);
    expect(list[0].checksum).toBe(checksum('select 1;\n'));
    expect(list[0].checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejeita nome invalido e versao repetida', () => {
    expect(() => listMigrations(dirWith({ 'qualquer.sql': 'x' }))).toThrow(/invalido/);
    expect(() =>
      listMigrations(dirWith({ '20261110120000_a_b.sql': 'x', '20261110120000_a_c.sql': 'y' })),
    ).toThrow(/repetida/);
  });
});

describe('plan', () => {
  const f = (version, sql) => ({ version, file: `${version}_x.sql`, checksum: checksum(sql) });
  const files = [f('20261110120000', 'a'), f('20261110130000', 'b')];

  it('separa aplicadas de pendentes', () => {
    const r = plan(files, [{ version: '20261110120000', checksum: checksum('a') }]);
    expect(r.pending.map((m) => m.version)).toEqual(['20261110130000']);
    expect(r.problems).toEqual([]);
  });

  it('denuncia checksum alterado, aplicada sem arquivo e pendente fora de ordem', () => {
    expect(plan(files, [{ version: '20261110120000', checksum: checksum('z') }]).problems).toEqual([
      'checksum alterado apos aplicar: 20261110120000',
    ]);
    expect(plan(files, [{ version: '20250101000000', checksum: 'x' }]).problems[0]).toMatch(
      /sem arquivo/,
    );
    const r = plan(files, [{ version: '20261110130000', checksum: checksum('b') }]);
    expect(r.problems).toEqual(['pendente fora de ordem: 20261110120000']);
  });
});

describe('env', () => {
  it('interpreta NOME=valor, aspas e comentarios', () => {
    const env = parseEnv('# c\nA=1\nB="dois"\n\nC = tres\nsemigual\n');
    expect(env).toEqual({ A: '1', B: 'dois', C: 'tres' });
  });

  it('safeError nao vaza mensagem de conexao', () => {
    const net = Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), {
      code: 'ECONNREFUSED',
    });
    expect(safeError(net)).toBe('falha de conexao (ECONNREFUSED)');
    const srv = Object.assign(new Error('relation does not exist'), {
      code: '42P01',
      severity: 'ERROR',
    });
    expect(safeError(srv)).toBe('42P01: relation does not exist');
  });

  it('safeError mostra so o codigo em erros de autenticacao (28xxx)', () => {
    for (const code of ['28P01', '28000']) {
      const auth = Object.assign(
        new Error('password authentication failed for user "postgres.abcdefgh"'),
        { code, severity: 'FATAL' },
      );
      const out = safeError(auth);
      expect(out).toBe(`${code}: falha de autenticacao`);
      expect(out).not.toMatch(/postgres\.abcdefgh|password/);
    }
  });
});
