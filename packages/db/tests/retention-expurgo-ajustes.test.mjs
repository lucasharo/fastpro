// H-109 (Issue #118) | Teste estatico da migracao 20261112110000 (docs/factory/82-DESENHO-H109.md §8, A-6 e A-7).
// Sem banco e sem rede: le o SQL e confere a postura. Nenhum prazo literal (CA-H109-11), idempotencia e os
// pontos da decisao da Arquitetura. A prova no Postgres fica em packages/db/tests/retention-h109.dbtest.mjs.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url);
const ROLLBACKS = new URL('../../../supabase/rollbacks/', import.meta.url);
const FILE = '20261112110000_retention_expurgo_ajustes.sql';
const DOWN = '20261112110000_retention_expurgo_ajustes.down.sql';

const semComentario = (texto) =>
  texto
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');

const bruto = readFileSync(new URL(FILE, MIGRATIONS), 'utf8');
const sql = semComentario(bruto).toLowerCase().replace(/\s+/g, ' ');
const rb = semComentario(readFileSync(new URL(DOWN, ROLLBACKS), 'utf8')).toLowerCase().replace(/\s+/g, ' ');

describe('T-H109 ajustes do expurgo 20261112110000 (teste estatico, sem banco)', () => {
  it('migracao e rollback existem com o nome do padrao', () => {
    expect(existsSync(new URL(FILE, MIGRATIONS))).toBe(true);
    expect(existsSync(new URL(DOWN, ROLLBACKS))).toBe(true);
  });

  it('nenhum prazo literal (CA-H109-11) na migracao nem no rollback', () => {
    for (const texto of [sql, rb]) {
      expect(texto).not.toMatch(/interval\s*'\s*\d+\s*(day|days|month|months|year|years|dia|dias|mes|meses|ano|anos)\b/);
      expect(texto).not.toMatch(/\b\d+\s*(anos|meses|dias)\b/);
    }
  });

  it('idempotente: drop constraint if exists antes de recriar, e create or replace nas funcoes', () => {
    expect(sql).toContain('drop constraint if exists professional_profile_cadastro_junto');
    expect(sql.match(/create or replace function/g)?.length).toBe(3);
    expect(sql).not.toMatch(/create function /);
  });

  it('regra de cadastro: nome e slug juntos, obrigatorios com documento e so depois do expurgo sem documento', () => {
    expect(sql).toContain('(public_name is null) = (slug is null)');
    expect(sql).toContain("retention_state is not distinct from 'expurgado'");
    expect(sql).toContain('(public_name is not null and slug is not null)');
  });

  it('guarda: nome e slug write-once tambem para perfil expurgado', () => {
    expect(sql).toContain("(old.document_hmac is not null or old.retention_state = 'expurgado')");
  });

  it('reentrada: set_document devolve ja_cadastrado quando ha retention_state', () => {
    expect(sql).toContain('v_expurgo is not null');
    expect(sql).toContain("return query select 'ja_cadastrado'::text;");
  });

  it('RC-02: anonimizacao limpa email_hmac', () => {
    expect(sql).toContain('email_hmac = null');
  });

  it('privilegios: revoke das funcoes recriadas e grant de set_document so para app_system', () => {
    expect(sql).toContain('to app_system');
    expect(sql).toMatch(/revoke all on function\s+private\.retention_finalize_rc02/);
  });

  it('rollback recusa restaurar com expurgo registrado', () => {
    expect(rb).toContain('rollback_recusado_ha_expurgo');
    expect(rb).toContain('retention_state is not null');
  });
});
