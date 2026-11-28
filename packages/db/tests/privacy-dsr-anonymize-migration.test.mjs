// Issue 120 (H-111) | Testes estaticos da migracao de anonimizacao do titular (147-DESENHO-H111 §4.3, §7: T-ST-01,
// T-ST-03, T-DB-03 e T-DB-17 na parte estatica). Nao conecta ao banco: le os arquivos e confere privilegios,
// search_path, termos proibidos, recusas explicitas e o arquivo de desfazer.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { MIGRATION_NAME } from '../scripts/lib/migrations.mjs';

const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));
const VERSAO = '20261113510000';
const NOME = `${VERSAO}_privacy_create_dsr_anonymize.sql`;
const MIGRACAO = join(RAIZ, 'supabase', 'migrations', NOME);
const DESFAZER = join(RAIZ, 'supabase', 'rollbacks', `${VERSAO}_privacy_create_dsr_anonymize.down.sql`);

const sql = readFileSync(MIGRACAO, 'utf8');
const down = readFileSync(DESFAZER, 'utf8');
// Sem comentarios de linha, para que textos explicativos nao mascarem o SQL real.
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

const FUNCAO = 'private.dsr_anonymize_subject(uuid)';

describe('migracao de anonimizacao do titular (Issue 120, fatia 6)', () => {
  it('nome e prefixo validos, depois da fatia 5 (500000) e com arquivo de desfazer', () => {
    const m = MIGRATION_NAME.exec(NOME);
    expect(m, 'nome segue a convencao').not.toBeNull();
    expect(m[1] > '20261113500000', 'prefixo posterior a fatia 5').toBe(true);
    expect(existsSync(MIGRACAO)).toBe(true);
    expect(existsSync(DESFAZER), 'arquivo de desfazer existe').toBe(true);
  });

  it('nenhum arquivo com fim de linha CRLF', () => {
    expect(sql.includes('\r'), 'migracao com CR').toBe(false);
    expect(down.includes('\r'), 'desfazer com CR').toBe(false);
  });

  it('a migracao nao registra a propria versao (o registro e feito no script de aplicacao)', () => {
    expect(minusculo.includes('ops.schema_migration')).toBe(false);
  });

  it('T-ST-01 | sem backup, exportacao de banco, historico de fotos, mapa, agenda, fila, envio de e-mail real ou pagamento', () => {
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
      'smtp',
      'billing.payment',
      'truncate',
    ]) {
      expect(minusculo.includes(termo), `termo proibido: ${termo}`).toBe(false);
    }
  });

  it('T-ST-01 | a funcao nao apaga nada: sem delete e sem escrita em auditoria', () => {
    expect(minusculo.includes('delete from'), 'delete proibido').toBe(false);
    expect(minusculo.includes('audit.audit_event'), 'tabela de auditoria nao e tocada').toBe(false);
    expect(/update\s+audit\./.test(minusculo), 'update em auditoria').toBe(false);
  });

  it('T-ST-03 | nenhuma concessao: a funcao e privada e nao recebe GRANT; nenhum papel de servico aparece', () => {
    expect(minusculo.includes(PAPEL_SERVICO), 'papel de servico nao deve aparecer').toBe(false);
    const concessoes = instrucoes.filter((s) => s.startsWith('grant '));
    expect(concessoes, 'nenhum GRANT nesta fatia').toHaveLength(0);
  });

  it('T-DB-03 | revoke total da funcao para public, anon, authenticated e app_api', () => {
    const revogacoes = instrucoes.filter((s) => s.startsWith('revoke all on function'));
    expect(revogacoes).toHaveLength(1);
    expect(revogacoes[0]).toMatch(/from public, anon, authenticated, app_api$/);
    expect(revogacoes[0].includes(FUNCAO)).toBe(true);
  });

  it('T-DB-03 | a funcao e SECURITY DEFINER com search_path vazio', () => {
    const bloco = codigo.split(/create or replace function /i).slice(1)[0];
    expect(bloco.startsWith(FUNCAO.split('(')[0] + '(')).toBe(true);
    expect(/security definer/i.test(bloco)).toBe(true);
    expect(bloco.includes("set search_path = ''")).toBe(true);
  });

  it('T-ST-01 | nenhum SELECT * que devolva dados ao chamador (carga em variavel local do plpgsql e permitida)', () => {
    expect(/select\s+\*\s+from/i.test(codigo), 'select * from encontrado').toBe(false);
    expect(/returning\s+\*/i.test(codigo), 'returning * encontrado').toBe(false);
  });

  it('recusas explicitas dos casos sem passo (perfil, pedido imutavel, aprovacao, bloqueio legal)', () => {
    for (const codigoErro of [
      'dsr_nao_deferido',
      'dsr_tipo_invalido',
      'dsr_aprovacao_indisponivel',
      'dsr_conta_fora_de_eliminacao',
      'eliminacao_profissional_pendente',
      'retencao_legal_ativa',
      'pedido_em_andamento',
      'pedido_conteudo_imutavel_pendente',
    ]) {
      expect(codigo.includes(codigoErro), `recusa: ${codigoErro}`).toBe(true);
    }
  });

  it('desenho §4.3 | o marcador de e-mail e anonimo, sem HMAC reutilizavel, e a conta fica anonimizada na mesma instrucao', () => {
    expect(codigo.includes("'anon-' || replace(gen_random_uuid()::text, '-', '') || '@anon.fastpro.internal'")).toBe(true);
    const atualizacao = codigo.slice(codigo.indexOf('update app.app_user u'), codigo.indexOf('update app.dsr_case c'));
    expect(atualizacao).toMatch(/email_hmac = null/);
    expect(atualizacao).toMatch(/status = 'anonimizado'/);
    expect(atualizacao).toMatch(/retention_state = 'expurgado'/);
    expect(atualizacao).toMatch(/anonymized_at = now\(\)/);
  });

  it('desenho §4.3 | o caso fecha como concluido com conta_anonimizada, linha do tempo e auditoria', () => {
    expect(codigo).toMatch(/status = 'concluido'/);
    expect(codigo).toMatch(/outcome = 'conta_anonimizada'/);
    expect(codigo).toMatch(/'anonymized'/);
    expect(codigo).toMatch(/'closed'/);
    expect(codigo).toMatch(/private\.audit_append\('system:dsr_anonymize', 'system', 'dsr\.subject_anonymized'/);
  });

  it('desenho §4.3 | sessoes e grants de step-up do titular sao encerrados', () => {
    expect(codigo).toMatch(/update app\.app_session/);
    expect(codigo).toMatch(/revoked_at = now\(\)/);
    expect(codigo).toMatch(/update app\.step_up_grant/);
    expect(codigo).toMatch(/least\(now\(\), g\.expires_at\)/);
  });

  it('desfazer | remove a funcao e o registro da versao, recusa se houver conta anonimizada e nao apaga dados', () => {
    expect(codigoDown).toMatch(/drop function if exists private\.dsr_anonymize_subject\(uuid\)/);
    expect(codigoDown).toMatch(/delete from ops\.schema_migration where version = '20261113510000'/);
    expect(down).toMatch(/desfazer_recusado_ha_anonimizacao/);
    expect(codigoDown).toMatch(/status = 'anonimizado'/);
    expect(codigoDown).toMatch(/outcome = 'conta_anonimizada'/);
    expect(codigoDown).not.toMatch(/delete from app\./);
    expect(codigoDown).not.toMatch(/delete from audit\./);
    expect(codigoDown.toLowerCase()).not.toMatch(/truncate/);
  });
});
