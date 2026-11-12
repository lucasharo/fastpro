// H-026 (Issue #39) | Verificacao estatica da migracao 20261112120000 (docs/factory/88-DESENHO-H026.md, §7; M-09, M-14).
// Le o arquivo da migracao e do desfazer; nao abre conexao. As provas no Postgres ficam no dbtest.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = join(__dirname, '..', '..', '..');
const MIG = readFileSync(join(RAIZ, 'supabase', 'migrations', '20261112120000_media_create_asset_quarantine.sql'), 'utf8');
const DOWN = readFileSync(join(RAIZ, 'supabase', 'rollbacks', '20261112120000_media_create_asset_quarantine.down.sql'), 'utf8');

describe('H-026 | migracao (estatica)', () => {
  it('M-09: nenhuma funcao grava status ready nem copia, baixa ou assina o objeto', () => {
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
