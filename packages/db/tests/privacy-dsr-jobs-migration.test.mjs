// Issue 120 (H-111) | Testes estaticos da migracao de jobs e avisos dos direitos do titular (147-DESENHO-H111 §4.4, §7,
// §8: T-API-11, T-API-12, T-API-14 na parte de banco). Nao conecta ao banco: le os arquivos e confere gatilhos,
// privilegios, search_path, termos proibidos, ausencia de aviso final de eliminacao e o arquivo de desfazer.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { MIGRATION_NAME } from '../scripts/lib/migrations.mjs';

const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));
const VERSAO = '20261113530000';
const NOME = `${VERSAO}_privacy_create_dsr_jobs.sql`;
const MIGRACAO = join(RAIZ, 'supabase', 'migrations', NOME);
const DESFAZER = join(RAIZ, 'supabase', 'rollbacks', `${VERSAO}_privacy_create_dsr_jobs.down.sql`);

const sql = readFileSync(MIGRACAO, 'utf8');
const down = readFileSync(DESFAZER, 'utf8');
const semComentario = (texto) =>
  texto
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
const codigo = semComentario(sql);
const codigoDown = semComentario(down);
const minusculo = codigo.toLowerCase();
const PAPEL_SERVICO = ['service', 'role'].join('_');
const instrucoes = codigo
  .split(';')
  .map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase())
  .filter(Boolean);

const FUNCOES_APP = [
  'app.dsr_job_process_auto',
  'app.dsr_job_export_target',
  'app.dsr_job_export_mark_purged',
  'app.dsr_job_auth_cleanup_target',
];
const FUNCOES_GATILHO = [
  'private.dsr_case_enqueue_job',
  'private.dsr_usuario_enqueue_auth_cleanup',
  'private.dsr_export_enqueue_purge',
  'private.dsr_event_enqueue_email',
];

describe('migracao de jobs e avisos dos direitos do titular (Issue 120, fatia 8)', () => {
  it('nome e prefixo validos, depois da fatia 7 (520000) e com arquivo de desfazer', () => {
    const m = MIGRATION_NAME.exec(NOME);
    expect(m, 'nome segue a convencao').not.toBeNull();
    expect(m[1] > '20261113520000', 'prefixo posterior a fatia 7').toBe(true);
    expect(existsSync(MIGRACAO)).toBe(true);
    expect(existsSync(DESFAZER), 'arquivo de desfazer existe').toBe(true);
  });

  it('nenhum arquivo com fim de linha CRLF e a migracao nao registra a propria versao', () => {
    expect(sql.includes('\r'), 'migracao com CR').toBe(false);
    expect(down.includes('\r'), 'desfazer com CR').toBe(false);
    expect(minusculo.includes('ops.schema_migration')).toBe(false);
  });

  it('T-ST-01 | sem backup, exportacao, mapa, e-mail real, cobranca, truncamento ou remocao de dados', () => {
    for (const termo of ['backup', 'pg_dump', 'mapbox', 'smtp', 'resend', 'pg_net', 'cron', 'truncate', 'delete from', 'drop table', 'media_access']) {
      expect(minusculo.includes(termo), `termo proibido: ${termo}`).toBe(false);
    }
    expect(minusculo.includes(PAPEL_SERVICO), 'papel de servico nao deve aparecer').toBe(false);
    expect(/select\s+\*\s+from/i.test(codigo), 'select * from').toBe(false);
  });

  it('desenho §4.4 | os quatro jobs e o aviso de indeferimento estao registrados com chave de deduplicacao', () => {
    for (const kind of ["'dsr.process_auto'", "'dsr.auth_cleanup'", "'dsr.export_purge'"]) {
      expect(codigo.includes(kind), `job ${kind}`).toBe(true);
    }
    expect(codigo.includes("on conflict (dedupe_key) do nothing")).toBe(true);
    expect(codigo.includes("'dsr_indeferido'")).toBe(true);
    expect(codigo.includes("'dsr:' || new.case_id::text || ':' || v_tipo")).toBe(true);
  });

  it('decisao P5 | nao ha aviso final de eliminacao: o tipo de e-mail so existe para indeferimento', () => {
    expect(codigo.includes("'dsr_eliminacao'")).toBe(false);
    expect(codigo.includes("'dsr_conta_encerrada'")).toBe(false);
    expect(/new\.event <> 'rejected'/.test(codigo)).toBe(true);
    expect(minusculo.includes("'anonymized'")).toBe(false);
  });

  it('decisao P1 e P2 | o processamento automatico so age sobre conta sem perfil, sem pedido e sem bloqueio', () => {
    expect(codigo.includes('app.professional_profile p where p.user_id')).toBe(true);
    expect(codigo.includes('app.service_request r where r.customer_user_id')).toBe(true);
    expect(codigo.includes("h.subject_type = 'user'")).toBe(true);
    expect(codigo.includes("return 'nao_elegivel'")).toBe(true);
  });

  it('T-DB-03 | todas as funcoes publicas e de gatilho sao SECURITY DEFINER com search_path vazio', () => {
    const blocos = codigo.split(/create or replace function /i).slice(1);
    for (const nome of [...FUNCOES_APP, ...FUNCOES_GATILHO]) {
      const bloco = blocos.find((b) => b.startsWith(nome + '('));
      expect(bloco, `bloco de ${nome}`).toBeTruthy();
      expect(/security definer/i.test(bloco), `security definer em ${nome}`).toBe(true);
      expect(bloco.includes("set search_path = ''"), `search_path vazio em ${nome}`).toBe(true);
    }
  });

  it('T-DB-03 | revoke total para public, anon, authenticated e app_api; execute so para app_system', () => {
    const revogacoes = instrucoes.filter((s) => s.startsWith('revoke all on function'));
    expect(revogacoes).toHaveLength(2);
    for (const r of revogacoes) expect(r).toMatch(/from public, anon, authenticated, app_api$/);
    const concessoes = instrucoes.filter((s) => s.startsWith('grant execute on function'));
    expect(concessoes).toHaveLength(1);
    expect(concessoes[0]).toMatch(/to app_system$/);
    for (const nome of FUNCOES_APP) expect(concessoes[0].includes(nome + '('), `execute em ${nome}`).toBe(true);
  });

  it('desenho §4.4 | a limpeza de autenticacao so libera o identificador de conta anonimizada', () => {
    expect(codigo.includes("if v_usuario.status <> 'anonimizado' then")).toBe(true);
    expect(codigo.includes("return query select 'pronto'::text, v_usuario.auth_user_id;")).toBe(true);
  });

  it('desenho §4.4 | o expurgo so libera o caminho depois do vencimento e marca uma vez', () => {
    expect(codigo.includes("if v_extrato.expires_at > now() then")).toBe(true);
    expect(codigo.includes('update app.dsr_export set purged_at = now() where case_id = p_case;')).toBe(true);
    expect(codigo.includes("'dsr.export_purged'")).toBe(true);
  });

  it('desfazer | remove gatilhos e funcoes; recusa com job pendente; nao apaga dados', () => {
    for (const gatilho of ['dsr_case_event_enqueue_email', 'dsr_export_enqueue_purge', 'dsr_usuario_enqueue_auth_cleanup', 'dsr_case_enqueue_process_auto']) {
      expect(codigoDown.includes(`drop trigger if exists ${gatilho}`), `drop trigger ${gatilho}`).toBe(true);
    }
    for (const nome of FUNCOES_APP) expect(codigoDown.includes(`drop function if exists ${nome}(`), `drop de ${nome}`).toBe(true);
    expect(down).toMatch(/desfazer_recusado_ha_job_pendente/);
    expect(codigoDown).toMatch(/delete from ops\.schema_migration where version = '20261113530000'/);
    expect(codigoDown).not.toMatch(/delete from (app|ops)\.(dsr_case|app_user|dsr_export|job)/);
    expect(codigoDown.toLowerCase()).not.toMatch(/truncate/);
  });
});
