// Issue 120 (H-111) | Testes estaticos da migracao de funcoes do titular (147-DESENHO-H111 §4.1, §7: T-DB-03,
// T-ST-01 e T-ST-03). Nao conecta ao banco: le os arquivos e confere privilegios, search_path, termos proibidos,
// rollback e ausencia de envio de e-mail ou de job nesta fatia.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { MIGRATION_NAME } from '../scripts/lib/migrations.mjs';

const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));
const VERSAO = '20261113490000';
const NOME = `${VERSAO}_privacy_create_dsr_user_functions.sql`;
const MIGRACAO = join(RAIZ, 'supabase', 'migrations', NOME);
const DESFAZER = join(RAIZ, 'supabase', 'rollbacks', `${VERSAO}_privacy_create_dsr_user_functions.down.sql`);

const sql = readFileSync(MIGRACAO, 'utf8');
const down = readFileSync(DESFAZER, 'utf8');
// Sem comentarios de linha, para que textos explicativos nao mascarem o SQL real.
const codigo = sql
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n');
const codigoDown = down
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n');
const PAPEL_SERVICO = ['service', 'role'].join('_');
const instrucoes = codigo
  .split(';')
  .map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase())
  .filter(Boolean);

const FUNCOES_TITULAR = [
  'app.dsr_open(uuid, text, jsonb, text, text)',
  'app.dsr_cancel(uuid, uuid)',
  'app.dsr_list_own(uuid, integer, timestamptz, uuid)',
  'app.dsr_get_own(uuid, uuid)',
];
const HELPERS = ['private.dsr_gerar_protocolo(timestamptz)', 'private.dsr_config_inteiro(text)'];

// Divide o SQL em blocos de funcao (cada "create or replace function" ate o proximo).
const blocosFuncao = codigo.split(/create or replace function /i).slice(1);

describe('migracao de funcoes do titular (Issue 120, fatia 4)', () => {
  it('nome e prefixo validos, depois da fatia 3 (480000) e com arquivo de desfazer', () => {
    const m = MIGRATION_NAME.exec(NOME);
    expect(m, 'nome segue a convencao').not.toBeNull();
    expect(m[1] > '20261113480000', 'prefixo posterior a fatia 3').toBe(true);
    expect(existsSync(MIGRACAO)).toBe(true);
    expect(existsSync(DESFAZER), 'arquivo de desfazer existe').toBe(true);
  });

  it('nenhum arquivo com fim de linha CRLF', () => {
    expect(sql.includes('\r'), 'migracao com CR').toBe(false);
    expect(down.includes('\r'), 'desfazer com CR').toBe(false);
  });

  it('T-ST-01 | sem backup, exportacao de banco, historico de fotos, mapa, agenda, job ou envio de e-mail', () => {
    for (const termo of [
      'backup',
      'media_access',
      'pg_dump',
      'mapbox',
      'cron',
      'create event trigger',
      'ops.job',
      'enfileirar',
      'pg_net',
    ]) {
      expect(codigo.toLowerCase().includes(termo), `termo proibido: ${termo}`).toBe(false);
    }
  });

  it('T-ST-03 | nenhuma concessao a papel de servico, publico, anon, authenticated ou app_api; so app_system executa', () => {
    expect(codigo.toLowerCase().includes(PAPEL_SERVICO), 'papel de servico nao deve aparecer').toBe(false);
    const concessoes = instrucoes.filter((s) => s.startsWith('grant '));
    expect(concessoes).toHaveLength(1);
    expect(concessoes[0]).toMatch(/^grant execute on function /);
    expect(concessoes[0]).toMatch(/to app_system$/);
    for (const f of FUNCOES_TITULAR) expect(concessoes[0].includes(f.toLowerCase()), f).toBe(true);
  });

  it('T-DB-03 | revoke total das funcoes para public, anon, authenticated e app_api', () => {
    const revogacoes = instrucoes.filter((s) => s.startsWith('revoke all on function'));
    expect(revogacoes).toHaveLength(2);
    for (const s of revogacoes) expect(s).toMatch(/from public, anon, authenticated, app_api$/);
  });

  it('T-DB-03 | toda funcao SECURITY DEFINER fixa search_path vazio; toda funcao fixa search_path', () => {
    expect(blocosFuncao.length).toBeGreaterThanOrEqual(6);
    for (const bloco of blocosFuncao) {
      const nome = bloco.split('(')[0].trim();
      expect(bloco.includes("set search_path = ''"), `search_path ausente em ${nome}`).toBe(true);
      if (/security definer/i.test(bloco)) {
        expect(/security definer/i.test(bloco)).toBe(true);
      }
    }
  });

  it('T-DB-03 | as quatro funcoes do titular e os dois helpers existem com a assinatura do desenho', () => {
    for (const assinatura of [...FUNCOES_TITULAR, ...HELPERS]) {
      const nome = assinatura.split('(')[0];
      expect(codigo.includes(`create or replace function ${nome}(`), `definicao de ${nome}`).toBe(true);
    }
    expect(codigo).toMatch(/create or replace function app\.dsr_open\([\s\S]*?\)\s*returns table/);
  });

  it('desenho §4.1 | a abertura consome step-up de forma atomica e grava idempotencia, evento, auditoria e e-mail', () => {
    const abertura = blocosFuncao.find((b) => b.startsWith('app.dsr_open('));
    expect(abertura, 'bloco de app.dsr_open').toBeDefined();
    expect(abertura).toMatch(/update app\.step_up_grant[\s\S]*consumed_at is null[\s\S]*returning g\.id/);
    expect(abertura).toMatch(/insert into ops\.idempotency_key/);
    expect(abertura).toMatch(/insert into app\.dsr_case_event/);
    expect(abertura).toMatch(/private\.audit_append\('customer:'/);
    expect(abertura).toMatch(/insert into ops\.email_outbox/);
    expect(abertura).toMatch(/set status = 'em_eliminacao'/);
    expect(abertura).toMatch(/app\.legal_hold/);
    expect(abertura).toMatch(/'publicado', 'selecionado'/);
  });

  it('desenho §3.2 e §6.1 | nenhuma funcao grava em tabela de step-up, extrato ou auditoria diretamente fora do fluxo', () => {
    expect(codigo).not.toMatch(/insert into app\.step_up_grant/);
    expect(codigo).not.toMatch(/insert into app\.dsr_export/);
    expect(codigo).not.toMatch(/delete from /);
    expect(codigo).not.toMatch(/update audit\./);
  });

  it('desenho §4.1 | o titular nao recebe nota interna: listagem e consulta nao expoem actor_ref', () => {
    const consulta = blocosFuncao.filter((b) => b.startsWith('app.dsr_list_own(') || b.startsWith('app.dsr_get_own('));
    expect(consulta).toHaveLength(2);
    for (const b of consulta) expect(b.includes('actor_ref')).toBe(false);
  });

  it('desfazer | remove as seis funcoes, o registro da versao e nao apaga casos, grants nem extratos', () => {
    for (const assinatura of [...FUNCOES_TITULAR, ...HELPERS]) {
      const nome = assinatura.split('(')[0];
      expect(codigoDown.includes(`drop function if exists ${nome}(`), `drop de ${nome}`).toBe(true);
    }
    expect(codigoDown).toMatch(/delete from ops\.schema_migration where version = '20261113490000'/);
    expect(codigoDown).not.toMatch(/delete from app\./);
    expect(codigoDown).not.toMatch(/truncate/);
  });
});
