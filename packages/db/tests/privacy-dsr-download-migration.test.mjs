// Issue 120 (H-111) | Testes estaticos da migracao do download do extrato (147-DESENHO-H111 D-A6, §7). Nao conecta ao
// banco: le os arquivos e confere a tabela de tokens, o privilegio, a validade de 5 minutos e o arquivo de desfazer.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));
const VERSAO = '20261120000000';
const NOME = `${VERSAO}_privacy_create_dsr_download.sql`;
const sql = readFileSync(join(RAIZ, 'supabase', 'migrations', NOME), 'utf8');
const down = readFileSync(join(RAIZ, 'supabase', 'rollbacks', `${VERSAO}_privacy_create_dsr_download.down.sql`), 'utf8');
const semComentario = (texto) =>
  texto
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
const codigo = semComentario(sql);
const codigoDown = semComentario(down);
const PAPEL_SERVICO = ['service', 'role'].join('_');

describe('migracao do download do extrato (estatica)', () => {
  it('versao esta acima da migracao 20261119100000, ja existente', () => {
    expect(Number(VERSAO)).toBeGreaterThan(20261119100000);
    expect(Number(VERSAO)).toBeLessThanOrEqual(20261120099999);
  });

  it('tabela de tokens tem RLS forcada e nao e concedida a papeis de aplicacao', () => {
    expect(codigo).toMatch(/alter table app\.dsr_download_token enable row level security;/);
    expect(codigo).toMatch(/alter table app\.dsr_download_token force row level security;/);
    expect(codigo).toMatch(/revoke all on app\.dsr_download_token from public, anon, authenticated, app_api;/);
    expect(codigo).not.toMatch(/grant [^;]*on app\.dsr_download_token/);
  });

  it('guarda so o hash do token (64 hex) e nunca a coluna do token em claro', () => {
    expect(codigo).toMatch(/token_hash\s+text primary key/);
    expect(codigo).toMatch(/token_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
    expect(codigo).not.toMatch(/\btoken\s+text\b/);
  });

  it('validade fixa de 5 minutos, limitada a validade do extrato (D-A6)', () => {
    expect(codigo).toMatch(/interval '5 minutes'/);
    expect(codigo).toMatch(/least\(v_agora \+ interval '5 minutes', v_export\.expires_at\)/);
  });

  it('consumo atomico com bloqueio de linha e recusa de uso repetido', () => {
    expect(codigo).toMatch(/for update;/);
    expect(codigo).toMatch(/raise exception 'dsr_token_usado'/);
    expect(codigo).toMatch(/raise exception 'dsr_token_expirado'/);
  });

  it('registro sem DELETE nem TRUNCATE (reusa o gatilho de registro do passo de extrato)', () => {
    expect(codigo).toMatch(/before delete or truncate on app\.dsr_download_token/);
    expect(codigo).toMatch(/private\.dsr_registro_refuse_delete\(\)/);
  });

  it('acao de auditoria no catalogo e funcoes so para app_system, sem papel de servico', () => {
    expect(codigo).toMatch(/'dsr\.extract_downloaded'/);
    expect(codigo).toMatch(/grant execute on function[\s\S]*to app_system;/);
    expect(codigo).not.toContain(PAPEL_SERVICO);
  });

  it('arquivo de desfazer recusa quando ha tokens e remove a versao do registro', () => {
    expect(codigoDown).toMatch(/dsr_download_token_com_registros/);
    expect(codigoDown).toMatch(/drop table if exists app\.dsr_download_token;/);
    expect(codigoDown).toMatch(/delete from ops\.schema_migration where version = '20261120000000';/);
  });
});
