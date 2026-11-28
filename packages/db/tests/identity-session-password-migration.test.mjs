// H-016 | Teste estatico da migracao de expand de app.app_session para login por senha
// (docs/factory/67-DESENHO-H016.md §6, item B; docs/factory/33-DESENHO-H016.md §2.5).
// Sem banco e sem rede: le o SQL. A validacao real dos CHECKs e do rollback no Postgres fica no teste de
// banco (dbtest) quando o banco de desenvolvimento estiver disponivel. Executar: pnpm test (vitest).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url);
const ROLLBACKS = new URL('../../../supabase/rollbacks/', import.meta.url);
const FILE = '20261111380000_identity_expand_session_password.sql';
const DOWN = '20261111380000_identity_expand_session_password.down.sql';

const raw = readFileSync(new URL(FILE, MIGRATIONS), 'utf8');
const down = readFileSync(new URL(DOWN, ROLLBACKS), 'utf8');
// SQL sem linhas de comentario (o cabecalho cita o desenho, de proposito).
const semComentario = (texto) =>
  texto
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');
const sql = semComentario(raw).toLowerCase().replace(/\s+/g, ' ');
const rb = semComentario(down).toLowerCase().replace(/\s+/g, ' ');

describe('T-H016-MIG expand de app.app_session (login por senha)', () => {
  it('torna challenge_id anulavel e nao remove nada (expand puro)', () => {
    expect(sql).toContain('alter table app.app_session alter column challenge_id drop not null;');
    expect(sql).not.toContain('drop column');
    expect(sql).not.toContain('delete from');
    expect(sql).not.toContain('set not null');
  });

  it('purpose aceita login, publish e password, pela constraint de nome conhecido', () => {
    expect(sql).toContain('alter table app.app_session drop constraint if exists app_session_purpose_check;');
    expect(sql).toContain(
      "add constraint app_session_purpose_check check (purpose in ('login', 'publish', 'password'));",
    );
  });

  it('sem desafio se e so se a sessao for por senha', () => {
    expect(sql).toContain(
      'add constraint app_session_desafio_por_senha check ((purpose = \'password\') = (challenge_id is null));',
    );
  });

  it('nao concede privilegio novo a nenhum papel', () => {
    expect(sql).not.toMatch(/\bgrant\b/);
    expect(sql).not.toMatch(/\bto (anon|authenticated|public)\b/);
  });

  it('e idempotente (drop if exists antes de cada constraint)', () => {
    expect(sql.match(/drop constraint if exists/g)?.length).toBe(2);
  });
});

describe('T-H016-MIG rollback de 20261111380000', () => {
  it('apaga as sessoes por senha antes de restaurar a obrigatoriedade de challenge_id', () => {
    const apaga = rb.indexOf("delete from app.app_session where purpose = 'password';");
    const restaura = rb.indexOf('alter table app.app_session alter column challenge_id set not null;');
    expect(apaga).toBeGreaterThanOrEqual(0);
    expect(restaura).toBeGreaterThan(apaga);
  });

  it('restaura o CHECK de purpose de 150000 e tira a migracao do registro', () => {
    expect(rb).toContain("check (purpose in ('login', 'publish'));");
    expect(rb).toContain("delete from ops.schema_migration where version = '20261111380000';");
  });

  it('roda em transacao unica', () => {
    expect(rb).toContain('begin;');
    expect(rb).toContain('commit;');
  });
});
