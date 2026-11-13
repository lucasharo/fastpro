// E3 (Issue 141, CA-09 sem banco) | Contrato estatico entre o adaptador PgMediaGallery e a migracao 20261112190000.
// Le o SQL da migracao e confere: nomes das funcoes, ordem e tipos dos parametros (os casts $n::tipo do adaptador),
// colunas devolvidas (as que o adaptador le) e codigos de retorno. A prova em banco real fica no dbtest
// (packages/db/tests/media-gallery.dbtest.mjs), que nao roda sem o banco de desenvolvimento.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SQL_MEDIA_DELETE,
  SQL_MEDIA_LIST,
  SQL_MEDIA_READ_TARGET,
  SQL_MEDIA_REORDER,
} from '../src/media-gallery.js';

const MIGRACAO = new URL('../../../supabase/migrations/20261112190000_media_expand_photo_order.sql', import.meta.url);
const SQL = readFileSync(MIGRACAO, 'utf8');

interface Funcao {
  readonly nome: string;
  readonly tipos: readonly string[];
  readonly colunas: readonly string[];
  readonly corpo: string;
}

/** Extrai cada funcao private.media_* da migracao: parametros (tipos em ordem) e colunas de returns table. */
function funcoes(): Map<string, Funcao> {
  const mapa = new Map<string, Funcao>();
  // Cada funcao vai do "create or replace function" ate o proximo (ou ao fim do arquivo).
  for (const bloco of SQL.split(/create or replace function /).slice(1)) {
    const cab = bloco.match(/^private\.(media_\w+)\(([^)]*)\)\s*returns table \(([^)]*)\)/);
    if (cab === null) continue;
    const nome = cab[1] as string;
    const tipos = (cab[2] as string)
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p !== '')
      .map((p) => p.split(/\s+/).at(-1) as string);
    const colunas = (cab[3] as string).split(',').map((c) => c.trim().split(/\s+/)[0] as string);
    mapa.set(nome, { nome, tipos, colunas, corpo: bloco });
  }
  return mapa;
}

/** Tipos dos casts $n::tipo de uma constante SQL, na ordem dos placeholders. */
function castsDoAdaptador(sql: string): string[] {
  return [...sql.matchAll(/\$(\d+)::([a-z]+(?:\[\])?)/g)].map((m) => m[2] as string);
}

/** Nome da funcao chamada pelo SQL do adaptador. */
function funcaoDoAdaptador(sql: string): string {
  const m = sql.match(/private\.(media_\w+)\(/);
  return m?.[1] as string;
}

const F = funcoes();

describe('E3 galeria: contrato do adaptador PgMediaGallery com a migracao 20261112190000 (CA-09, sem banco)', () => {
  it('a migracao define as quatro funcoes da galeria', () => {
    expect([...F.keys()].sort()).toEqual(['media_delete', 'media_list', 'media_read_target', 'media_reorder']);
  });

  it.each([
    ['SQL_MEDIA_LIST', SQL_MEDIA_LIST],
    ['SQL_MEDIA_DELETE', SQL_MEDIA_DELETE],
    ['SQL_MEDIA_REORDER', SQL_MEDIA_REORDER],
    ['SQL_MEDIA_READ_TARGET', SQL_MEDIA_READ_TARGET],
  ])('%s chama uma funcao da migracao com a mesma ordem e os mesmos tipos de parametro', (_rotulo, sql) => {
    const funcao = F.get(funcaoDoAdaptador(sql));
    expect(funcao).toBeDefined();
    expect(castsDoAdaptador(sql)).toEqual(funcao?.tipos);
  });

  it('os tipos dos parametros batem com o contrato: texto (hash), uuid ou uuid[], e timestamptz (agora)', () => {
    expect(F.get('media_list')?.tipos).toEqual(['text', 'timestamptz']);
    expect(F.get('media_delete')?.tipos).toEqual(['text', 'uuid', 'timestamptz']);
    expect(F.get('media_reorder')?.tipos).toEqual(['text', 'uuid[]', 'uuid[]', 'timestamptz']);
    expect(F.get('media_read_target')?.tipos).toEqual(['text', 'uuid', 'timestamptz']);
  });

  it('as colunas devolvidas são as que o adaptador le (out_id, out_state, out_reject_code, out_pos, out_code, out_bytes)', () => {
    expect(F.get('media_list')?.colunas).toEqual(['out_id', 'out_state', 'out_reject_code', 'out_pos']);
    expect(F.get('media_delete')?.colunas).toEqual(['out_code']);
    expect(F.get('media_reorder')?.colunas).toEqual(['out_code']);
    expect(F.get('media_read_target')?.colunas).toEqual(['out_bytes']);
  });

  it('os codigos de exclusao e de ordem sao exatamente os que o adaptador aceita', () => {
    const codigos = (nome: string) =>
      [...new Set([...(F.get(nome)?.corpo ?? '').matchAll(/out_code := '([a-z_]+)'/g)].map((m) => m[1] as string))].sort();
    expect(codigos('media_delete')).toEqual(['already', 'deleted', 'not_found']);
    expect(codigos('media_reorder')).toEqual(['changed', 'invalid', 'not_found', 'ok', 'unchanged']);
  });

  it('as quatro funcoes sao concedidas so ao papel app_api', () => {
    const bloco = SQL.slice(SQL.indexOf('grant execute on function'));
    for (const nome of ['media_list', 'media_delete', 'media_reorder', 'media_read_target']) {
      expect(bloco).toContain(`private.${nome}(`);
    }
    expect(bloco).toMatch(/to app_api;/);
    const PAPEL_SERVICO = ['service', 'role'].join('_');
    expect(bloco).not.toMatch(new RegExp(`\\bto (public|anon|authenticated|${PAPEL_SERVICO})\\b`));
  });
});
