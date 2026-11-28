// H-026 (Issue #39) | Verificacao estatica da migracao 20261112120000 (docs/factory/88-DESENHO-H026.md, §7; M-09, M-14).
// H-027 (Issue #40) | Verificacao estatica da migracao 20261112140000 (docs/factory/93-DESENHO-H027.md, §7; R-14).
// Le os arquivos da migracao e do desfazer; nao abre conexao. As provas no Postgres ficam no dbtest.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = join(__dirname, '..', '..', '..');
const MIG = readFileSync(join(RAIZ, 'supabase', 'migrations', '20261112120000_media_create_asset_quarantine.sql'), 'utf8');
const DOWN = readFileSync(join(RAIZ, 'supabase', 'rollbacks', '20261112120000_media_create_asset_quarantine.down.sql'), 'utf8');
const MIG40 = readFileSync(join(RAIZ, 'supabase', 'migrations', '20261112140000_media_expand_reduce_ready.sql'), 'utf8');
const DOWN40 = readFileSync(join(RAIZ, 'supabase', 'rollbacks', '20261112140000_media_expand_reduce_ready.down.sql'), 'utf8');

describe('H-026 | migracao 20261112120000 (estatica; M-09 vale so para este arquivo)', () => {
  it('M-09: a migracao da #39 nao grava status ready nem copia, baixa ou assina o objeto', () => {
    expect(MIG).not.toMatch(/status\s*=\s*'ready'/);
    expect(MIG).not.toMatch(/:=\s*'ready'/);
    expect(MIG).not.toMatch(/download|createSignedUrl|copy_object/i);
  });

  it('M-08 (estatica): nenhuma politica em storage.objects; todo grant da migracao vai so para app_api', () => {
    expect(MIG).not.toMatch(/create\s+policy/i);
    expect(MIG).not.toMatch(/alter\s+table\s+storage\.objects/i);
    const grants = MIG.match(/^\s*grant\s[^;]*;/gim) ?? [];
    expect(grants.length).toBeGreaterThan(0);
    for (const g of grants) expect(g).toMatch(/\bto\s+app_api\s*;/i);
    expect(MIG).toMatch(/'quarantine', 'quarantine', false/);
  });

  it('M-14: RLS habilitada e forcada na tabela; revoke amplo antes de qualquer grant', () => {
    expect(MIG).toMatch(/alter table app\.media_asset enable row level security;/);
    expect(MIG).toMatch(/alter table app\.media_asset force row level security;/);
    const revoke = MIG.indexOf('revoke all on app.media_asset');
    expect(revoke).toBeGreaterThan(0);
    expect(revoke).toBeLessThan(MIG.indexOf('grant execute'));
  });

  it('M-14: toda funcao criada tem search_path vazio e security definer', () => {
    const funcoes = (MIG.match(/create or replace function private\./g) ?? []).length;
    const vazios = (MIG.match(/set search_path = ''/g) ?? []).length;
    const definer = (MIG.match(/security definer/g) ?? []).length;
    expect(funcoes).toBe(7);
    expect(vazios).toBe(funcoes);
    expect(definer).toBe(funcoes);
  });

  it('o limite de vagas e o TTL de 30 min estao no SQL com os mesmos valores do dominio', () => {
    expect(MIG).toMatch(/v_vivas >= 5/);
    expect(MIG).toMatch(/interval '30 minutes'/);
    expect(MIG).toMatch(/10485760/);
  });

  it('desfazer: nao apaga o bucket por SQL (bloqueado pelo Supabase) e recusa com linhas', () => {
    expect(DOWN).not.toMatch(/delete from storage\.buckets/i);
    expect(DOWN).toMatch(/media_desfazer_recusado/);
  });
});

/** Corpo de uma funcao da migracao 20261112140000, do 'create or replace function' ate o 'end;' seguinte. */
function corpoDe(nome: string): string {
  const inicio = MIG40.indexOf(`create or replace function private.${nome}(`);
  if (inicio < 0) return '';
  const fim = MIG40.indexOf('\n$$;', inicio);
  return MIG40.slice(inicio, fim);
}

describe('H-027 | migracao 20261112140000 (estatica; R-14)', () => {
  it('R-14: so private.media_reduce_done grava status ready (set status = ready)', () => {
    const atribuicoes = [...MIG40.matchAll(/set\s+status\s*=\s*'ready'/g)];
    expect(atribuicoes.length).toBe(1);
    const corpo = corpoDe('media_reduce_done');
    expect(corpo).toMatch(/set\s+status\s*=\s*'ready'/);
    for (const nome of ['media_reduce_begin', 'media_reduce_reject', 'media_reduce_release', 'media_original_removed']) {
      expect(corpoDe(nome)).not.toMatch(/set\s+status\s*=\s*'ready'/);
    }
  });

  it('R-14: nenhuma funcao nova copia, baixa ou assina o objeto; sem politica em storage.objects', () => {
    expect(MIG40).not.toMatch(/download|createSignedUrl|copy_object/i);
    expect(MIG40).not.toMatch(/create\s+policy/i);
    expect(MIG40).not.toMatch(/alter\s+table\s+storage\.objects/i);
  });

  it('R-14: seis funcoes novas, todas security definer com search_path vazio; grants so para app_api', () => {
    const funcoes = (MIG40.match(/create or replace function private\./g) ?? []).length;
    expect(funcoes).toBe(6);
    expect((MIG40.match(/set search_path = ''/g) ?? []).length).toBe(funcoes);
    expect((MIG40.match(/security definer/g) ?? []).length).toBe(funcoes);
    const grants = MIG40.match(/^\s*grant\s[^;]*;/gim) ?? [];
    expect(grants.length).toBe(funcoes);
    for (const g of grants) expect(g).toMatch(/\bto\s+app_api\s*;/i);
  });

  it('R-14: o bucket request-photos e privado, com teto de 750000 bytes e so JPEG', () => {
    expect(MIG40).toMatch(/'request-photos', 'request-photos', false, 750000, array\['image\/jpeg'\]/);
  });

  it('R-14: nenhuma funcao da #39 e redefinida pela migracao nova (expansao)', () => {
    for (const nome of ['media_issue', 'media_get', 'media_finalize', 'media_sweep', 'media_purge_done', 'media_known', 'media_asset_limite']) {
      expect(MIG40).not.toMatch(new RegExp(`create or replace function private\\.${nome}\\(`));
    }
  });

  it('R-14: desfazer recusa com foto ready/rejected ou objeto em request-photos, e nao apaga o bucket por SQL', () => {
    expect(DOWN40).toMatch(/media_desfazer_recusado/);
    expect(DOWN40).toMatch(/request-photos/);
    expect(DOWN40).not.toMatch(/delete from storage\.buckets/i);
  });
});
