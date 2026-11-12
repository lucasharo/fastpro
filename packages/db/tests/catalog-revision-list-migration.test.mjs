// H-107 (Issue 116) | Teste estatico da migracao 20261111450000 (docs/factory/81-DESENHO-H107.md §2).
// Sem banco e sem rede: le o SQL e confere a postura (verificacao de administrador primeiro, security definer com
// search_path vazio, sem execucao para public/anon/authenticated, sem tabela, politica ou grant de escrita novos,
// rollback que remove so a funcao). A prova no Postgres fica no teste de banco (catalog-service.dbtest.mjs), que
// nao roda nesta etapa.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url);
const ROLLBACKS = new URL('../../../supabase/rollbacks/', import.meta.url);
const FILE = '20261111450000_catalog_revision_list.sql';
const DOWN = '20261111450000_catalog_revision_list.down.sql';

const semComentario = (texto) =>
  texto
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');
const sql = semComentario(readFileSync(new URL(FILE, MIGRATIONS), 'utf8')).toLowerCase().replace(/\s+/g, ' ');
const rb = semComentario(readFileSync(new URL(DOWN, ROLLBACKS), 'utf8')).toLowerCase().replace(/\s+/g, ' ');

/** Corpo da funcao: do 'create or replace function <nome>' ate o '$$;' que fecha o bloco. */
function corpo(nome) {
  const inicio = sql.indexOf(`create or replace function ${nome}`);
  if (inicio < 0) return '';
  const fim = sql.indexOf('$$;', sql.indexOf('as $$', inicio));
  return sql.slice(inicio, fim + 3);
}

describe('T-H107-M1 migracao 20261111450000 catalog_revision_list (teste estatico, sem banco)', () => {
  it('arquivo de migracao e rollback existem com o nome do padrao', () => {
    expect(existsSync(new URL(FILE, MIGRATIONS))).toBe(true);
    expect(existsSync(new URL(DOWN, ROLLBACKS))).toBe(true);
  });

  it('a funcao e security definer, com search_path vazio e estavel', () => {
    const f = corpo('private.catalog_revision_list');
    expect(f).not.toBe('');
    expect(f).toContain('security definer');
    expect(f).toContain("set search_path = ''");
    expect(f).toContain('stable');
    expect(f).toMatch(/returns jsonb/);
  });

  it('verifica o administrador antes de ler qualquer dado', () => {
    const f = corpo('private.catalog_revision_list');
    const verificacao = f.indexOf('perform private.catalog_assert_admin()');
    const leitura = f.indexOf('from app.catalog_revision');
    expect(verificacao).toBeGreaterThan(0);
    expect(leitura).toBeGreaterThan(verificacao);
  });

  it('aceita so as tres entidades e recusa identificador nulo', () => {
    const f = corpo('private.catalog_revision_list');
    expect(f).toContain("p_entity not in ('group', 'service', 'synonym')");
    expect(f).toContain('p_id is null');
  });

  it('saida so com as colunas da tela: versao, antes, depois, instante e ator', () => {
    const f = corpo('private.catalog_revision_list');
    for (const chave of ["'version'", "'before'", "'after'", "'at'", "'actor'"]) expect(f).toContain(chave);
    expect(f).toContain("r.after ->> 'updated_by_ref'");
  });

  it('nao executa para public, anon nem authenticated; execucao so para app_api e app_system', () => {
    expect(sql).toContain(
      'revoke all on function private.catalog_revision_list(text, uuid) from public, anon, authenticated;',
    );
    expect(sql).toContain(
      'grant execute on function private.catalog_revision_list(text, uuid) to app_api, app_system;',
    );
  });

  it('nenhuma tabela, politica, coluna ou grant de escrita nova', () => {
    expect(sql).not.toMatch(/create table/);
    expect(sql).not.toMatch(/create policy/);
    expect(sql).not.toMatch(/alter table/);
    expect(sql).not.toMatch(/\bgrant (insert|update|delete|select)\b/);
    expect(sql).not.toMatch(/grant [^;]*on (table )?app\.catalog_revision/);
  });

  it('rollback remove so a funcao e tira a migracao do registro', () => {
    expect(rb).toContain('drop function if exists private.catalog_revision_list(text, uuid);');
    expect(rb).toContain("delete from ops.schema_migration where version = '20261111450000';");
    expect(rb).not.toMatch(/drop table/);
    expect(rb).not.toMatch(/app\.catalog_revision/);
  });
});
