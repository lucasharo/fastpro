// Issue 120 (H-111) | Testes estaticos da migracao das funcoes administrativas do DPO (147-DESENHO-H111 §4.2, §6.3,
// §7: T-ST-01, T-ST-03 e T-DB-03 na parte estatica). Nao conecta ao banco: le os arquivos e confere privilegios,
// search_path, termos proibidos, recusas explicitas, papeis semeados e o arquivo de desfazer.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { MIGRATION_NAME } from '../scripts/lib/migrations.mjs';

const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));
const VERSAO = '20261113520000';
const NOME = `${VERSAO}_privacy_create_dsr_admin_functions.sql`;
const MIGRACAO = join(RAIZ, 'supabase', 'migrations', NOME);
const DESFAZER = join(RAIZ, 'supabase', 'rollbacks', `${VERSAO}_privacy_create_dsr_admin_functions.down.sql`);

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
  'app.dsr_admin_list',
  'app.dsr_admin_get',
  'app.dsr_assign',
  'app.dsr_defer',
  'app.dsr_reject',
  'app.dsr_admin_generate_extract',
  'app.dsr_admin_anonymize',
];

describe('migracao das funcoes administrativas do DPO (Issue 120, fatia 7)', () => {
  it('nome e prefixo validos, depois da fatia 6 (510000) e com arquivo de desfazer', () => {
    const m = MIGRATION_NAME.exec(NOME);
    expect(m, 'nome segue a convencao').not.toBeNull();
    expect(m[1] > '20261113510000', 'prefixo posterior a fatia 6').toBe(true);
    expect(existsSync(MIGRACAO)).toBe(true);
    expect(existsSync(DESFAZER), 'arquivo de desfazer existe').toBe(true);
  });

  it('nenhum arquivo com fim de linha CRLF e a migracao nao registra a propria versao', () => {
    expect(sql.includes('\r'), 'migracao com CR').toBe(false);
    expect(down.includes('\r'), 'desfazer com CR').toBe(false);
    expect(minusculo.includes('ops.schema_migration')).toBe(false);
  });

  it('T-ST-01 | sem backup, exportacao de banco, historico de fotos, mapa, e-mail real, pagamento ou truncamento', () => {
    for (const termo of ['backup', 'media_access', 'pg_dump', 'mapbox', 'smtp', 'resend', 'billing.payment', 'truncate', 'delete from', 'drop table']) {
      expect(minusculo.includes(termo), `termo proibido: ${termo}`).toBe(false);
    }
    expect(minusculo.includes(PAPEL_SERVICO), 'papel de servico nao deve aparecer').toBe(false);
  });

  it('T-ST-01 | nenhum SELECT * ou RETURNING * devolve dados ao chamador', () => {
    expect(/select\s+\*\s+from/i.test(codigo), 'select * from').toBe(false);
    expect(/returning\s+\*/i.test(codigo), 'returning *').toBe(false);
  });

  it('T-DB-03 | cada funcao publica e SECURITY DEFINER com search_path vazio', () => {
    const blocos = codigo.split(/create or replace function /i).slice(1);
    for (const nome of [...FUNCOES_APP, 'private.dsr_admin_caso']) {
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

  it('T-API-08 | toda funcao publica confere a permissao pelo catalogo de papeis antes de qualquer escrita', () => {
    const blocos = codigo.split(/create or replace function /i).slice(1);
    for (const nome of FUNCOES_APP) {
      const bloco = blocos.find((b) => b.startsWith(nome + '('));
      if (nome === 'app.dsr_admin_get' || nome === 'app.dsr_admin_list') {
        expect(bloco.includes("private.admin_has_permission(p_actor, 'dsr.read')"), `leitura em ${nome}`).toBe(true);
      } else {
        expect(/private\.dsr_admin_caso\(p_actor, p_case, 'dsr\.decide'\)/.test(bloco), `decisao em ${nome}`).toBe(true);
      }
    }
    expect(codigo.includes("private.admin_has_permission(p_actor, p_permissao)")).toBe(true);
  });

  it('recusas explicitas das decisoes (nota, desfecho, tipo, titular, responsavel, correcao pendente)', () => {
    for (const codigoErro of [
      'dsr_operador_e_titular',
      'dsr_responsavel_invalido',
      'dsr_nao_atribuivel',
      'dsr_nao_deferivel',
      'dsr_nao_indeferivel',
      'nota_base_legal_obrigatoria',
      'desfecho_invalido',
      'correcao_pendente_de_implementacao',
      'dsr_tipo_invalido',
      'filtro_nao_permitido',
    ]) {
      expect(codigo.includes(codigoErro), `recusa: ${codigoErro}`).toBe(true);
    }
  });

  it('desenho §4.2 | cada decisao grava auditoria na mesma transacao com ator administrativo', () => {
    for (const acao of [
      'dsr.case_assigned',
      'dsr.case_deferred',
      'dsr.case_rejected',
      'dsr.extract_requested',
      'dsr.anonymization_requested',
    ]) {
      expect(codigo.includes(`'${acao}'`), `acao de auditoria ${acao}`).toBe(true);
    }
    expect(codigo.match(/'admin:' \|\| p_actor::text, 'admin'/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });

  it('desenho §6.3 | papel dpo e permissoes dsr.* semeados de forma idempotente', () => {
    expect(codigo.includes("('dpo', 'DPO/Encarregado')")).toBe(true);
    expect(codigo).toMatch(/on conflict \(code\) do nothing/);
    for (const perm of ['dsr.read', 'dsr.decide', 'dsr.open_assisted']) {
      expect(codigo.includes(`'${perm}'`), `permissao ${perm}`).toBe(true);
    }
    expect(codigo.includes("('suporte', 'dsr.read')")).toBe(true);
    expect(codigo.includes("('suporte', 'dsr.decide')")).toBe(false);
  });

  it('desfazer | remove funcoes, permissoes e papel dpo; recusa com papel dpo concedido; nao apaga casos', () => {
    expect(codigoDown).toMatch(/drop function if exists private\.dsr_admin_caso\(uuid, uuid, text\)/);
    for (const nome of FUNCOES_APP) expect(codigoDown.includes(`drop function if exists ${nome}(`), `drop de ${nome}`).toBe(true);
    expect(down).toMatch(/desfazer_recusado_ha_papel_dpo/);
    expect(codigoDown).toMatch(/delete from ops\.schema_migration where version = '20261113520000'/);
    expect(codigoDown).not.toMatch(/delete from app\.(dsr_case|app_user|dsr_export)/);
    expect(codigoDown).not.toMatch(/delete from audit\./);
    expect(codigoDown.toLowerCase()).not.toMatch(/truncate/);
  });
});
