// Teste estatico da migracao da busca de servico (H-019, 64-DESENHO-H019 §5.1 T-H019-08). Sem banco e sem rede.
// Executar: pnpm test (vitest). Os testes de comportamento estao em catalog-search.dbtest.mjs (T-H019-09..15).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url);
const ROLLBACKS = new URL('../../../supabase/rollbacks/', import.meta.url);
const FILE = '20261111350000_catalog_search_function.sql';

const raw = readFileSync(new URL(FILE, MIGRATIONS), 'utf8');
// Codigo SQL sem linhas de comentario (o cabecalho cita a leitura antiga por nome, de proposito).
const code = (s) =>
  s
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');
const sql = code(raw);
const body = sql.slice(sql.indexOf('as $$'), sql.lastIndexOf('$$;'));
const lower = (s) => s.toLowerCase().replace(/\s+/g, ' ');

describe('T-H019-08 estatico da migracao catalog_search', () => {
  it('declara a funcao com a assinatura de texto, stable, security definer e search_path vazio', () => {
    const head = sql.slice(0, sql.indexOf('as $$'));
    expect(lower(head)).toContain('create or replace function private.catalog_search(p_term text)');
    expect(head).toMatch(/\bstable\b/i);
    expect(head).toMatch(/security definer/i);
    expect(lower(head)).toContain("set search_path = ''");
  });

  it('retorna exatamente os 7 campos publicos, sem sinonimo, termo ou rnk', () => {
    const cols = [
      'group_id',
      'group_name',
      'group_position',
      'service_id',
      'service_name',
      'modality',
      'regulated',
    ];
    const head = sql.slice(sql.indexOf('returns table ('), sql.indexOf('language sql'));
    const names = [...head.matchAll(/^\s+(\w+)\s+(uuid|text|integer|boolean)/gm)].map((m) => m[1]);
    expect(names).toEqual(cols);
    const list = lower(body.slice(body.lastIndexOf('select gid'), body.indexOf('from cand')));
    expect(list.trim()).toBe('select gid, gname, gpos, sid, sname, modality, regulated');
    expect(list).not.toMatch(/\brnk\b/); // rnk e interno: so aparece no where e no order by
  });

  it('nao usa LIKE/ILIKE: o termo e comparado por strpos (nunca como padrao)', () => {
    expect(body).not.toMatch(/\bi?like\b/i);
    expect(body).toMatch(/strpos\(/);
  });

  it('o termo aparece so como parametro normalizado, sem concatenar SQL', () => {
    expect(body).toMatch(/private\.catalog_norm\(p_term\)/);
    expect(body).not.toMatch(/\bexecute\b/i);
    expect(body).not.toMatch(/\|\|\s*p_term/);
  });

  it('nao grava nada e nao registra o termo (sem DML, sem raise)', () => {
    expect(body).not.toMatch(/\b(insert|update|delete|merge)\b/i);
    expect(sql).not.toMatch(/\braise\s+(notice|log|info|warning|exception|debug)\b/i);
  });

  it('limite de 10 resultados e minimo de 2 caracteres', () => {
    expect(body).toMatch(/limit 10/);
    expect(body).toMatch(/char_length\(q\.t\) >= 2/);
  });

  it('privilegios: revoke de public, anon, authenticated e grant so para app_api', () => {
    expect(lower(sql)).toContain(
      'revoke all on function private.catalog_search(text) from public, anon, authenticated;',
    );
    expect(lower(sql)).toContain(
      'grant execute on function private.catalog_search(text) to app_api;',
    );
    const grants = [...sql.matchAll(/grant\s+execute[^;]*;/gi)].map((m) => m[0]);
    expect(grants).toHaveLength(1);
  });

  it('nao altera catalog_public_list nem as tabelas do catalogo', () => {
    expect(sql).not.toMatch(/catalog_public_list/);
    expect(sql).not.toMatch(/\b(alter|drop|create)\s+table\b/i);
    expect(sql).not.toMatch(/\bcreate\s+policy\b/i);
  });

  it('tem o desfazer correspondente (somente drop da funcao)', () => {
    const down = code(readFileSync(new URL(FILE.replace('.sql', '.down.sql'), ROLLBACKS), 'utf8'));
    expect(readdirSync(ROLLBACKS)).toContain(FILE.replace('.sql', '.down.sql'));
    expect(down).toMatch(/drop function if exists private\.catalog_search\(text\)/);
    expect(down).not.toMatch(/catalog_public_list/);
  });
});
