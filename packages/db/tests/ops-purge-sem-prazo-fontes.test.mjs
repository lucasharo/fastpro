// H-110 (Issue #119) | Busca de CA-H110-14 nos arquivos do H-110 (docs/factory/105-DESENHO-H110.md §7).
// Restrita aos arquivos novos do H-110: o auth_challenge_purge de H-011 tem interval '24 hours' legitimo e anterior.
// Nenhum prazo de dado (TTL) pode ser literal no codigo: vem de ops.app_config, lido a cada chamada (CA-H110-13).
// Permitidos: parametros tecnicos (statement_timeout, tamanho de lote, orcamento de tempo) e o teto tecnico de
// seguranca do intervalo em private.ops_purge_cfg. Nao sao prazo de dado.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const ARQUIVOS = [
  ['migracao', new URL('../../../supabase/migrations/20261112230000_ops_create_operational_purge.sql', import.meta.url)],
  ['rollback', new URL('../../../supabase/rollbacks/20261112230000_ops_create_operational_purge.down.sql', import.meta.url)],
  ['dominio', new URL('../../domain/src/ops-purge/orquestra.ts', import.meta.url)],
  ['dominio-tipos', new URL('../../domain/src/ops-purge/types.ts', import.meta.url)],
  ['db-store', new URL('../src/ops-purge-store.ts', import.meta.url)],
  ['db-jobs', new URL('../src/ops-purge-jobs.ts', import.meta.url)],
  ['db-storage', new URL('../src/ops-purge-storage.ts', import.meta.url)],
];

/** Remove comentarios de SQL (--) e de TypeScript (//, linhas iniciadas por * ou /*). */
function codigo(texto) {
  return texto
    .split(/\r?\n/)
    .map((l) => l.replace(/--.*$/, '').replace(/\/\/.*$/, ''))
    .filter((l) => !/^\s*(\*|\/\*)/.test(l))
    .join('\n');
}

const fontes = ARQUIVOS.map(([nome, url]) => [nome, codigo(readFileSync(url, 'utf8')).toLowerCase()]);

describe('CA-H110-14: sem literal de prazo de dado nos arquivos H-110', () => {
  it.each(fontes)('%s: sem interval com numero', (_nome, texto) => {
    expect(texto).not.toMatch(/interval\s*'\s*\d/);
  });

  it.each(fontes)('%s: sem make_interval com numero', (_nome, texto) => {
    expect(texto).not.toMatch(/make_interval\(\s*(secs|mins|hours|days|months|years)\s*=>\s*\d/);
  });

  it.each(fontes)('%s: sem segundos de calendario (86400, 604800, 2592000, 31536000) em literal', (_nome, texto) => {
    expect(texto).not.toMatch(/\b(86400|604800|2592000|31536000)\b/);
  });

  it('a migracao nao tem literal de prazo em nenhuma funcao ops_purge (so por chave de configuracao)', () => {
    const sql = fontes.find(([n]) => n === 'migracao')[1];
    const blocos = sql.split(/create or replace function /).slice(1).filter((b) => b.startsWith('private.ops_purge_'));
    expect(blocos.length).toBeGreaterThan(0);
    for (const b of blocos) {
      expect(b.slice(0, b.indexOf('$$;'))).not.toMatch(/'\s*\d+\s*(day|days|hour|hours|month|months|year|years)\s*'/);
    }
  });
});
