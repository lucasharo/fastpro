// Issue 120 (H-111) | Testes estaticos da migracao do step-up do titular (147-DESENHO-H111 §3.2, §5.1). Nao conecta ao
// banco: le os arquivos e confere a tabela de codigos, os privilegios, a configuracao e o arquivo de desfazer.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));
const VERSAO = '20261120600000';
const NOME = `${VERSAO}_privacy_create_dsr_step_up.sql`;
const sql = readFileSync(join(RAIZ, 'supabase', 'migrations', NOME), 'utf8');
const down = readFileSync(join(RAIZ, 'supabase', 'rollbacks', `${VERSAO}_privacy_create_dsr_step_up.down.sql`), 'utf8');
const semComentario = (texto) =>
  texto
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
const codigo = semComentario(sql);
const codigoDown = semComentario(down);
const PAPEL_SERVICO = ['service', 'role'].join('_');

describe('migracao do step-up do titular (estatica)', () => {
  it('versao esta na faixa de 20261120 (depois da migracao de download)', () => {
    expect(Number(VERSAO)).toBeGreaterThan(20261120000000);
    expect(Number(VERSAO)).toBeLessThanOrEqual(20261120999999);
  });

  it('tabela de codigos tem RLS forcada e nao e concedida a papeis de aplicacao', () => {
    expect(codigo).toMatch(/alter table app\.dsr_step_up_code enable row level security;/);
    expect(codigo).toMatch(/alter table app\.dsr_step_up_code force row level security;/);
    expect(codigo).toMatch(/revoke all on app\.dsr_step_up_code from public, anon, authenticated, app_api;/);
    expect(codigo).not.toMatch(/grant [^;]*on app\.dsr_step_up_code/);
  });

  it('guarda so o HMAC (64 hex) do codigo; o blob cifrado so pode ser apagado', () => {
    expect(codigo).toMatch(/code_hmac ~ '\^\[0-9a-f\]\{64\}\$'/);
    expect(codigo).toMatch(/if new\.code_enc is distinct from old\.code_enc and new\.code_enc is not null then/);
  });

  it('consumo e invalidacao acontecem uma vez; tentativas nunca regridem', () => {
    expect(codigo).toMatch(/dsr_step_up_tentativas_regressivas|dsr_step_up_code_tentativas_regressivas/);
    expect(codigo).toMatch(/dsr_step_up_code_ja_consumido/);
    expect(codigo).toMatch(/dsr_step_up_code_ja_invalidado/);
  });

  it('registro sem DELETE nem TRUNCATE (reusa o gatilho de registro)', () => {
    expect(codigo).toMatch(/before delete or truncate on app\.dsr_step_up_code/);
    expect(codigo).toMatch(/private\.dsr_registro_refuse_delete\(\)/);
  });

  it('configuracao de limites esta registrada com os valores do desenho (10 min, 5 tentativas, 15 min, 3 por hora)', () => {
    expect(codigo).toMatch(/'privacy\.dsr_step_up_code_minutes', '10'::jsonb/);
    expect(codigo).toMatch(/'privacy\.dsr_step_up_max_attempts', '5'::jsonb/);
    expect(codigo).toMatch(/'privacy\.dsr_step_up_lock_minutes', '15'::jsonb/);
    expect(codigo).toMatch(/'privacy\.dsr_step_up_max_per_hour', '3'::jsonb/);
  });

  it('e-mail usa tipo proprio dsr_stepup na classe auth, com so a referencia do codigo', () => {
    expect(codigo).toMatch(/private\.email_outbox_inserir\(p_user, 'acesso', 'auth', 'dsr_stepup', 'dsr_stepup'/);
    expect(codigo).toMatch(/jsonb_build_object\('challenge_ref', p_code_id\)/);
  });

  it('funcoes so para app_system, revogadas de public, anon, authenticated e app_api', () => {
    expect(codigo).toMatch(/revoke all on function[\s\S]*from public, anon, authenticated, app_api;/);
    expect(codigo).toMatch(/grant execute on function[\s\S]*to app_system;/);
    expect(codigo).not.toContain(PAPEL_SERVICO);
  });

  it('reaproveita o grant de step-up existente com purpose dsr_open (sem mudar o esquema)', () => {
    expect(codigo).toMatch(/insert into app\.step_up_grant \(user_id, purpose, token_hash, created_at, expires_at\)/);
    expect(codigo).toMatch(/values \(p_user, 'dsr_open', p_grant_hash, v_agora, v_validade\)/);
  });

  it('acoes de auditoria do step-up estao no catalogo', () => {
    expect(codigo).toMatch(/'dsr\.step_up_issued'/);
    expect(codigo).toMatch(/'dsr\.step_up_confirmed'/);
    expect(codigo).toMatch(/'dsr\.step_up_locked'/);
  });

  it('arquivo de desfazer existe e recusa quando ha codigos gravados', () => {
    expect(codigoDown).toMatch(/dsr_step_up_code/);
    expect(codigoDown).toMatch(/raise exception/);
  });
});
