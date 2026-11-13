// H-110 (Issue #119) | Teste estatico da migracao dos expurgos operacionais (docs/factory/105-DESENHO-H110.md §4, §5, CA-H110-14).
// Sem banco e sem rede: le o SQL e confere a postura (security definer, search_path vazio, privilegios minimos,
// RLS forcada, sem literal de prazo, sem DML em audit_event nem em legal_hold, sem semente de TTL, agenda condicionada,
// rollback presente). A prova no Postgres fica em ops-purge-h110.dbtest.mjs.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url);
const ROLLBACKS = new URL('../../../supabase/rollbacks/', import.meta.url);
const FILE = '20261112230000_ops_create_operational_purge.sql';
const DOWN = '20261112230000_ops_create_operational_purge.down.sql';

const semComentario = (texto) =>
  texto
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');

const bruto = readFileSync(new URL(FILE, MIGRATIONS), 'utf8');
const sql = semComentario(bruto).toLowerCase().replace(/\s+/g, ' ');
const rbBruto = readFileSync(new URL(DOWN, ROLLBACKS), 'utf8');
const rb = semComentario(rbBruto).toLowerCase().replace(/\s+/g, ' ');

const FUNCOES = [
  'ops_purge_cfg',
  'ops_purge_check_limit',
  'ops_purge_auth_challenge',
  'ops_purge_session',
  'ops_purge_draft',
  'ops_purge_media_mark',
  'ops_purge_media_marcados',
  'ops_purge_media_orfaos',
  'ops_purge_provider_event',
  'ops_purge_outbox_event',
  'ops_purge_email_outbox',
  'ops_purge_idempotency',
  'ops_purge_media_access',
  'ops_purge_enqueue',
  'ops_purge_audit',
];

/** Cabecalho e corpo de uma funcao: de 'create or replace function <nome>' ate o '$$;' que fecha o corpo. */
function cabecalhoECorpo(nome) {
  const inicio = sql.indexOf(`create or replace function private.${nome}(`);
  if (inicio < 0) return '';
  const fim = sql.indexOf('$$;', sql.indexOf('as $$', inicio));
  return sql.slice(inicio, fim + 3);
}

describe('H-110 migracao 20261112230000 (teste estatico, sem banco)', () => {
  it('migracao e rollback existem com o nome do padrao', () => {
    expect(existsSync(new URL(FILE, MIGRATIONS))).toBe(true);
    expect(existsSync(new URL(DOWN, ROLLBACKS))).toBe(true);
  });

  it('cada funcao ops_purge_* existe com search_path vazio; as que tocam dado sao security definer', () => {
    // ops_purge_check_limit so valida um inteiro (sem tabela): invoker rights, search_path vazio.
    const SEM_DADO = new Set(['ops_purge_check_limit']);
    for (const nome of FUNCOES) {
      const bloco = cabecalhoECorpo(nome);
      expect(bloco, nome).not.toBe('');
      expect(bloco, nome).toContain("set search_path = ''");
      if (!SEM_DADO.has(nome)) expect(bloco, nome).toContain('security definer');
    }
  });

  it('nenhuma funcao ops_purge_* e concedida a PUBLIC, anon, authenticated, service_role ou app_api', () => {
    const concessoes = sql.split(';').filter((c) => c.includes('grant execute on function private.ops_purge_'));
    expect(concessoes).toHaveLength(FUNCOES.length);
    for (const c of concessoes) {
      expect(c).toContain('to app_system');
      expect(c).not.toMatch(/to (public|anon|authenticated|service_role|app_api)\b/);
    }
  });

  it('cada funcao ops_purge_* tem revoke de PUBLIC e dos papeis de API antes da concessao', () => {
    for (const nome of FUNCOES) {
      const re = new RegExp(`revoke all on function private\\.${nome}\\([^)]*\\) from public, anon, authenticated, service_role, app_api`);
      expect(re.test(sql), nome).toBe(true);
      expect(sql, nome).toContain(`grant execute on function private.${nome}(`);
    }
  });

  it('concede a H-026 so o necessario a app_system (sem recriar as funcoes)', () => {
    expect(sql).toContain('grant execute on function private.media_original_cleanup_list(integer) to app_system');
    expect(sql).toContain('grant execute on function private.media_original_removed(uuid, timestamptz) to app_system');
    expect(sql).toContain('grant execute on function private.media_purge_done(uuid[]) to app_system');
    expect(sql).not.toMatch(/create or replace function private\.media_(original_removed|original_cleanup_list|purge_done)\(/);
  });

  it('tabela de rollup tem RLS habilitada e forcada e nenhum DML direto para papel de aplicacao', () => {
    expect(sql).toContain('alter table ops.media_access_daily enable row level security');
    expect(sql).toContain('alter table ops.media_access_daily force row level security');
    expect(sql).toMatch(/revoke all on table ops\.media_access_daily from public, anon, authenticated, service_role, app_api, app_backup_reader/);
    expect(sql).not.toMatch(/grant [a-z, ]+ on (table )?ops\.media_access_daily/);
  });

  it('nenhuma funcao grava em audit.audit_event nem em app.legal_hold (so leitura, CA-H109-08)', () => {
    expect(sql).not.toMatch(/(insert into|update|delete from) audit\.audit_event/);
    expect(sql).not.toMatch(/(insert into|update|delete from) app\.legal_hold/);
  });

  it('nao semeia valor de TTL em ops.app_config (decisao 198)', () => {
    expect(sql).not.toMatch(/insert into ops\.app_config/);
    expect(sql).not.toMatch(/'purge\.[a-z_.]+'\s*,\s*'?\d/);
  });

  it('nenhum literal de prazo de dado: sem interval com numero e sem make_interval com numero (CA-H110-14)', () => {
    expect(sql).not.toMatch(/interval\s*'\s*\d/);
    expect(sql).not.toMatch(/make_interval\(\s*(secs|mins|hours|days|months|years)\s*=>\s*\d/);
  });

  it('agenda pg_cron somente se a extensao existir, com a chave ops-purge-daily (decisao 204)', () => {
    expect(sql).toContain("if exists (select 1 from pg_extension where extname = 'pg_cron') then");
    expect(sql).toContain("cron.schedule('ops-purge-daily', '23 3 * * *', 'select private.ops_purge_enqueue(now())')");
  });

  it('acao de auditoria ops.purge.executed e incluida no catalogo com on conflict do nothing', () => {
    expect(sql).toContain("'ops.purge.executed', 'ops_job'");
    expect(sql).toMatch(/insert into audit\.action_catalog[\s\S]*on conflict do nothing/);
  });

  it('criacoes sao idempotentes (create table if not exists, create or replace)', () => {
    expect(sql).toContain('create table if not exists ops.media_access_daily');
    expect(sql).not.toMatch(/create table (?!if not exists)ops\./);
  });

  it('rollback remove as funcoes, a agenda e a acao; a tabela so sai se vazia; nao toca chaves de config', () => {
    for (const nome of FUNCOES) {
      expect(rb, nome).toContain(`drop function if exists private.${nome}(`);
    }
    expect(rb).toContain("if v_linhas = 0 then drop table ops.media_access_daily;");
    expect(rb).toContain("else raise notice 'rollback_mantem_rollup_com_dados';");
    expect(rb).toContain("cron.unschedule('ops-purge-daily')");
    expect(rb).toContain("delete from audit.action_catalog where action = 'ops.purge.executed'");
    expect(rb).not.toMatch(/ops\.app_config/);
  });
});
