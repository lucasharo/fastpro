// Issue 150 (docs/factory/118-DESENHO-REMOCAO-HISTORICO-ACESSO.md §2, §2.1, §7; decisoes 158 opcao A, 325, 326, 329, 330).
// Teste estatico da migracao que remove o historico de acesso as fotos e do seu rollback. Sem banco e sem rede:
// le o SQL e confere a postura. A prova no Postgres fica em ops-purge-h110.dbtest.mjs (CA-H150-02, 03, 06, 07).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url);
const ROLLBACKS = new URL('../../../supabase/rollbacks/', import.meta.url);
const FILE = '20261113180000_ops_remove_media_access_history.sql';
const DOWN = '20261113180000_ops_remove_media_access_history.down.sql';

const sql = readFileSync(new URL(FILE, MIGRATIONS), 'utf8');
const down = readFileSync(new URL(DOWN, ROLLBACKS), 'utf8');

/** Codigo sem linhas de comentario (o cabecalho cita nomes proibidos de proposito, como registro). */
function codigo(texto) {
  return texto
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('--'))
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
}

describe('migracao 20261113180000: remocao do historico de acesso (Issue 150)', () => {
  it('vem depois da anterior no diretorio (sem editar migracao antiga, CA-H150-17)', () => {
    // Desde a Issue 59 (H-046) ha migracao posterior a esta; o teste prova so a ordem relativa a H-045.
    const nomes = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
    const posicao = nomes.indexOf(FILE);
    expect(posicao).toBeGreaterThan(0);
    expect(nomes[posicao - 1]).toBe('20261113170000_billing_create_access_grant.sql');
  });

  it('tem rollback no mesmo prefixo, com a convencao .down.sql', () => {
    expect(down.length).toBeGreaterThan(0);
  });

  it('remove a funcao do bloco E8 com if exists, sem cascade', () => {
    expect(codigo(sql)).toMatch(/drop function if exists private\.ops_purge_media_access\(timestamptz,\s*integer\);/);
  });

  it('remove a tabela de resumo com if exists e sem cascade (sem dependentes conhecidos)', () => {
    const c = codigo(sql);
    expect(c).toMatch(/drop table if exists ops\.media_access_daily;/);
    expect(c).not.toMatch(/cascade/i);
  });

  it('apaga as duas chaves purge.media_access_* com guarda que aborta se sobrar alguma', () => {
    const c = codigo(sql);
    expect(c).toMatch(/delete from ops\.app_config\s+where key in \(\s*'purge\.media_access_rollup_after_seconds',\s*'purge\.media_access_detail_seconds'\s*\);/);
    expect(c).toContain("raise exception 'config_media_access_nao_removida' using errcode = '23514'");
  });

  it('nao cria, concede, insere, trunca nem altera nada (so remocao, CA-H150-05)', () => {
    const c = codigo(sql);
    for (const proibido of [/\bcreate\b/i, /\bgrant\b/i, /\brevoke\b/i, /\binsert\b/i, /\btruncate\b/i, /\balter\b/i]) {
      expect(c, String(proibido)).not.toMatch(proibido);
    }
  });

  it('nao derruba nem toca origens de log que nunca existiram, nem tabelas de auditoria ou de dados', () => {
    const c = codigo(sql);
    expect(c).not.toMatch(/drop\s+(table|function)[^;]*media_access_log/i);
    expect(c).not.toMatch(/audit_event|contact_reveal_log|media_asset|rate_counter|action_catalog/);
  });

  it('usa lock_timeout curto para falhar rapido se o job de expurgo segurar a funcao', () => {
    expect(codigo(sql)).toMatch(/set local lock_timeout = '5s';/);
  });

  it('nao tem begin nem commit (a transacao e do executor)', () => {
    const c = codigo(sql);
    expect(c).not.toMatch(/^\s*(begin|commit);/im);
  });
});

describe('rollback 20261113180000 (CA-H150-16): so estrutura vazia, sem codigo antigo', () => {
  it('e transacional e idempotente', () => {
    const c = codigo(down);
    expect(c).toMatch(/^\s*begin;/im);
    expect(c).toMatch(/^\s*commit;/im);
    expect(c).toMatch(/create table if not exists ops\.media_access_daily/);
  });

  it('recria a estrutura com as mesmas colunas e restricoes da migracao 20261112230000', () => {
    const c = codigo(down);
    expect(c).toMatch(/professional_id\s+uuid not null/);
    expect(c).toMatch(/day\s+date not null/);
    expect(c).toMatch(/outcome\s+text not null check \(outcome in \('ok', 'negado', 'limitado'\)\)/);
    expect(c).toMatch(/n\s+bigint not null check \(n >= 0\)/);
    expect(c).toMatch(/rolled_at\s+timestamptz not null/);
    expect(c).toMatch(/primary key \(professional_id, day, outcome\)/);
    expect(c).toMatch(/alter table ops\.media_access_daily enable row level security;/);
    expect(c).toMatch(/alter table ops\.media_access_daily force row level security;/);
    expect(c).toMatch(/revoke all on table ops\.media_access_daily\s+from public, anon, authenticated, [a-z_]+, app_api, app_backup_reader;/);
  });

  it('reinsere so a chave de rollup (86400) com on conflict do nothing, sem a chave de detalhe', () => {
    const c = codigo(down);
    expect(c).toMatch(/'purge\.media_access_rollup_after_seconds'/);
    expect(c).toMatch(/on conflict do nothing/);
    expect(c).not.toMatch(/purge\.media_access_detail_seconds/);
  });

  it('nao restaura a funcao, nao insere linhas do historico e nao cria origem de log', () => {
    const c = codigo(down);
    expect(c).not.toMatch(/create or replace function/i);
    expect(c).not.toMatch(/insert into ops\.media_access_daily/i);
    expect(c).not.toMatch(/media_access_log/);
  });
});
