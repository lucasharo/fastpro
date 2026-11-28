// H-108 (Issue 117) | Teste estatico da migracao do painel operacional (docs/factory/76-DESENHO-H108.md §1.2, §2, §4).
// Sem banco e sem rede: le o SQL e confere a postura (RLS forcada, lista fechada, sem privilegio direto,
// permissao so do Superadmin, rollback presente). A prova no Postgres (T-H108-10 a 14: fila, cota,
// ops_metric, privilegios e PII) fica no teste de banco (dbtest), que roda na etapa de banco.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url);
const ROLLBACKS = new URL('../../../supabase/rollbacks/', import.meta.url);
const FILE = '20261111430000_ops_create_ops_metric_panel.sql';
const DOWN = '20261111430000_ops_create_ops_metric_panel.down.sql';

const semComentario = (texto) =>
  texto
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');
const bruto = readFileSync(new URL(FILE, MIGRATIONS), 'utf8');
const sql = semComentario(bruto).toLowerCase().replace(/\s+/g, ' ');
const rb = semComentario(readFileSync(new URL(DOWN, ROLLBACKS), 'utf8')).toLowerCase().replace(/\s+/g, ' ');

const CHAVES = [
  'webhook_falha',
  'webhook_latencia',
  'webhook_pendente_idade',
  'foto_upload_falha',
  'foto_reencode_falha',
  'rls_negacao',
];

/** Corpo de uma funcao: do 'create or replace function <nome>' ate o proximo '$$;' apos o 'as $$'. */
function corpo(nome) {
  const inicio = sql.indexOf(`create or replace function ${nome}`);
  if (inicio < 0) return '';
  const fim = sql.indexOf('$$;', sql.indexOf('as $$', inicio));
  return sql.slice(inicio, fim + 3);
}

describe('T-H108 migracao 20261111430000 (teste estatico, sem banco)', () => {
  it('arquivo de migracao e rollback existem com o nome do padrao', () => {
    expect(existsSync(new URL(FILE, MIGRATIONS))).toBe(true);
    expect(existsSync(new URL(DOWN, ROLLBACKS))).toBe(true);
  });

  it('ops.ops_metric: lista fechada de metric_key, dimension so com codigo, sem coluna de identificador', () => {
    expect(sql).toContain('create table if not exists ops.ops_metric');
    for (const chave of CHAVES) expect(sql).toContain(`'${chave}'`);
    expect(sql).toContain("dimension ~ '^([a-z][a-z0-9_]{0,39})?$'");
    expect(sql).toContain('constraint ops_metric_pkey primary key (metric_key, bucket_start, dimension)');
    const tabela = sql.slice(sql.indexOf('create table if not exists ops.ops_metric'), sql.indexOf(');', sql.indexOf('create table if not exists ops.ops_metric')));
    for (const proibida of ['jsonb', 'principal', 'user_id', 'email', 'text not null, ', 'payload', 'texto']) {
      expect(tabela, proibida).not.toContain(proibida);
    }
  });

  it('RLS habilitada e forcada na tabela; nenhuma politica criada', () => {
    expect(sql).toContain('alter table ops.ops_metric enable row level security');
    expect(sql).toContain('alter table ops.ops_metric force row level security');
    expect(sql).not.toMatch(/create policy/);
  });

  it('leitura e escrita so por funcao: nenhum GRANT direto na tabela e revoke de todos os papeis', () => {
    const revogados = sql.match(/revoke all on ops\.ops_metric from ([a-z_, ]+);/);
    expect(revogados).not.toBeNull();
    const papeis = revogados[1].split(', ');
    expect(papeis).toHaveLength(5);
    for (const papel of ['public', 'anon', 'authenticated', 'app_api']) expect(papeis).toContain(papel);
    expect(sql).not.toMatch(/grant [^;]*on (table )?ops\.ops_metric/);
  });

  it('escrita por upsert com soma, search_path vazio e security definer', () => {
    const f = corpo('private.ops_metric_incr');
    expect(f).toContain('security definer');
    expect(f).toContain("set search_path = ''");
    expect(f).toContain('on conflict (metric_key, bucket_start, dimension) do update');
    expect(f).toContain('ops.ops_metric.value + excluded.value');
    expect(f).toContain("date_trunc('hour', p_at)");
  });

  it('leitura do painel: stable, security definer, search_path vazio, sem coluna sensivel do outbox', () => {
    const f = corpo('private.ops_panel_read');
    expect(f).toContain('stable');
    expect(f).toContain('security definer');
    expect(f).toContain("set search_path = ''");
    expect(f).toContain('returns jsonb');
    for (const coluna of [
      'last_error',
      'template_params',
      'dedupe_key',
      'recipient_user_id',
      'provider_message_id',
      'select *',
    ]) {
      expect(f, coluna).not.toContain(coluna);
    }
    expect(f).toContain("at time zone 'utc'");
  });

  it('execucao das funcoes so para app_system; revoke dos demais papeis', () => {
    expect(sql).toContain('to app_system');
    expect(sql).toContain('revoke all on function');
    expect(sql).toMatch(/from public, anon, authenticated, [a-z_]+, app_api;/);
  });

  it('permissao ops.panel.read criada e concedida so ao superadmin', () => {
    expect(sql).toContain("insert into app.admin_permission (code, label)");
    expect(sql).toContain("('ops.panel.read'");
    expect(sql).toContain("('superadmin', 'ops.panel.read')");
    const concessoes = sql.match(/\('[a-z_]+', 'ops\.panel\.read'\)/g) ?? [];
    expect(concessoes).toEqual(["('superadmin', 'ops.panel.read')"]);
  });

  it('rollback remove funcoes, tabela, permissao e registro da migracao', () => {
    expect(rb).toContain('drop function if exists private.ops_panel_read');
    expect(rb).toContain('drop function if exists private.ops_metric_incr');
    expect(rb).toContain('drop table if exists ops.ops_metric');
    expect(rb).toContain("delete from app.admin_role_permission where permission_code = 'ops.panel.read'");
    expect(rb).toContain("delete from app.admin_permission where code = 'ops.panel.read'");
    expect(rb).toContain("delete from ops.schema_migration where version = '20261111430000'");
  });
});
