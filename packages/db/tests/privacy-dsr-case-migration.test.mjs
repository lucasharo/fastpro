// Issue 120 (H-111) | Testes estaticos da migracao do caso de direitos do titular (147-DESENHO-H111 §3 e §7, T-DB-01,
// T-DB-02, T-DB-09, T-ST-01 e T-ST-03). Nao conecta ao banco: le os arquivos e confere RLS, privilegios, gatilhos,
// estados, parametros, rollback e ausencia de itens fora de escopo.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { MIGRATION_NAME } from '../scripts/lib/migrations.mjs';

const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));
const VERSAO = '20261113460000';
const NOME = `${VERSAO}_privacy_create_dsr_case.sql`;
const MIGRACAO = join(RAIZ, 'supabase', 'migrations', NOME);
const DESFAZER = join(RAIZ, 'supabase', 'rollbacks', `${VERSAO}_privacy_create_dsr_case.down.sql`);

const sql = readFileSync(MIGRACAO, 'utf8');
const down = readFileSync(DESFAZER, 'utf8');
// Sem comentarios de linha, para que textos explicativos nao mascarem o SQL real.
const codigo = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const codigoDown = down.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const PAPEL_SERVICO = ['service', 'role'].join('_');
const instrucoes = codigo.split(';').map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase());

const ESTADOS = ['aberto', 'em_analise', 'deferido', 'indeferido_parcial', 'indeferido_total', 'concluido', 'cancelado'];

describe('migracao do caso de direitos do titular (Issue 120, fatia 1)', () => {
  it('nome e prefixo validos e prefixo dentro da faixa permitida (>= 20261113460000)', () => {
    const m = MIGRATION_NAME.exec(NOME);
    expect(m, 'nome segue a convencao').not.toBeNull();
    expect(m[1] >= '20261113460000', 'prefixo fora da faixa').toBe(true);
    expect(existsSync(MIGRACAO)).toBe(true);
    expect(existsSync(DESFAZER), 'arquivo de desfazer existe').toBe(true);
  });

  it('nenhum arquivo com fim de linha CRLF', () => {
    expect(sql.includes('\r'), 'migracao com CR').toBe(false);
    expect(down.includes('\r'), 'desfazer com CR').toBe(false);
  });

  it('T-ST-01 | nenhuma rotina de backup, exportacao de banco, histograma de fotos ou mapa no SQL', () => {
    for (const termo of ['backup', 'media_access', 'pg_dump', 'mapbox', 'cron', 'create event trigger', 'ops.job']) {
      expect(codigo.toLowerCase().includes(termo), `termo proibido: ${termo}`).toBe(false);
    }
  });

  it('T-ST-03 | nenhuma concessao a papel de servico, publico, anon ou authenticated; so app_system recebe grant', () => {
    expect(codigo.toLowerCase().includes(PAPEL_SERVICO), 'papel de servico nao deve aparecer').toBe(false);
    const concessoes = instrucoes.filter((s) => s.startsWith('grant '));
    expect(concessoes).toEqual(['grant select on app.dsr_case, app.dsr_case_event to app_system']);
    for (const s of concessoes) expect(s, s).toMatch(/to app_system$/);
  });

  it('T-DB-02 | RLS habilitada e forcada nas duas tabelas', () => {
    for (const tabela of ['app.dsr_case', 'app.dsr_case_event']) {
      expect(instrucoes.includes(`alter table ${tabela} enable row level security`), `enable ${tabela}`).toBe(true);
      expect(instrucoes.includes(`alter table ${tabela} force row level security`), `force ${tabela}`).toBe(true);
    }
  });

  it('T-DB-02 | revoke total nas duas tabelas para public, anon, authenticated e app_api', () => {
    expect(instrucoes.some((s) => s.startsWith('revoke all on app.dsr_case, app.dsr_case_event')
      && /from public, anon, authenticated, app_api$/.test(s)), 'revoke total').toBe(true);
  });

  it('T-DB-01 | colunas essenciais e tipos de estado, tipo, canal e desfecho nos conjuntos do desenho', () => {
    const colunas = ['id', 'protocol', 'subject_user_id', 'kind', 'status', 'channel', 'opened_by_operator_id',
      'request_details', 'legal_basis_note', 'outcome', 'assigned_to', 'opened_at', 'deadline_at', 'closed_at',
      'approval_request_id', 'created_at', 'updated_at'];
    for (const c of colunas) expect(new RegExp(`\\b${c}\\s`).test(codigo), `coluna ${c}`).toBe(true);
    for (const e of ESTADOS) expect(codigo.includes(`'${e}'`), `estado ${e}`).toBe(true);
    for (const k of ['acesso', 'correcao', 'eliminacao', 'bloqueio', 'confirmacao']) expect(codigo.includes(`'${k}'`), k).toBe(true);
    for (const d of ['extrato_disponibilizado', 'dados_corrigidos', 'conta_anonimizada', 'recusado_impedimento_legal',
      'recusado_fraude_identidade', 'cancelado_pelo_titular']) expect(codigo.includes(`'${d}'`), d).toBe(true);
    expect(codigo.includes("'titular', 'dpo_externo'"), 'canais').toBe(true);
  });

  it('T-DB-04 | indice unico parcial por titular e tipo cobre aberto, em_analise e deferido (D-A1)', () => {
    expect(instrucoes.some((s) => s.startsWith('create unique index if not exists dsr_case_um_ativo_por_tipo_uk on app.dsr_case (subject_user_id, kind)')
      && /where status in \('aberto', 'em_analise', 'deferido'\)$/.test(s)), 'indice unico parcial').toBe(true);
  });

  it('T-DB-05 | a funcao de transicao contem exatamente as transicoes do desenho §2', () => {
    const bloco = codigo.split('create or replace function private.dsr_case_transition_allowed')[1].split('$$')[1];
    const pares = [...bloco.matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/g)].map((m) => `${m[1]}>${m[2]}`).sort();
    expect(pares).toEqual([
      'aberto>cancelado', 'aberto>deferido', 'aberto>em_analise', 'aberto>indeferido_parcial', 'aberto>indeferido_total',
      'deferido>concluido', 'em_analise>deferido', 'em_analise>indeferido_parcial', 'em_analise>indeferido_total',
    ]);
  });

  it('T-DB-06/07/08 | gatilhos esperados (imutabilidade, maquina, base legal, criacao, sem exclusao, linha do tempo imutavel)', () => {
    const gatilhos = [...codigo.matchAll(/create\s+trigger\s+([a-z_]+)/gi)].map((m) => m[1].toLowerCase()).sort();
    expect(gatilhos).toEqual(['dsr_case_event_no_mutation', 'dsr_case_guard', 'dsr_case_insert_guard', 'dsr_case_no_delete']);
    expect(/\bcreate\s+event\s+trigger\b/i.test(codigo), 'gatilho de evento de banco').toBe(false);
  });

  it('T-DB-09 | gatilho de exclusao cobre delete e truncate; linha do tempo recusa update, delete e truncate', () => {
    expect(instrucoes.includes('create trigger dsr_case_no_delete before delete or truncate on app.dsr_case for each statement execute function private.dsr_case_refuse_delete()')).toBe(true);
    expect(instrucoes.includes('create trigger dsr_case_event_no_mutation before update or delete or truncate on app.dsr_case_event for each statement execute function private.dsr_case_event_refuse_mutation()')).toBe(true);
  });

  it('funcoes de gatilho novas usam search_path vazio e nao sao SECURITY DEFINER', () => {
    const blocos = codigo.split(/create or replace function /i).slice(1).filter((b) => /^private\.dsr_case_/i.test(b));
    expect(blocos.length).toBe(5);
    for (const bloco of blocos) {
      const cabecalho = bloco.split(/\$\$/)[0];
      expect(cabecalho, `search_path em ${bloco.slice(0, 50)}`).toMatch(/set search_path = ''/i);
      expect(/security definer/i.test(cabecalho), 'nao deve ser security definer').toBe(false);
    }
  });

  it('parametros privacy.* com os quatro valores do desenho §3.2, somente de inclusao idempotente', () => {
    expect(instrucoes.some((s) => s.startsWith('insert into ops.app_config')), 'insert em app_config').toBe(true);
    for (const [chave, valor] of [['privacy.dsr_deadline_days', '15'], ['privacy.dsr_export_ttl_days', '7'],
      ['privacy.dsr_export_min_interval_days', '30'], ['privacy.dsr_step_up_minutes', '15']]) {
      expect(codigo.includes(`('${chave}', '${valor}'::jsonb)`), chave).toBe(true);
    }
    expect(codigo.includes('where not exists (select 1 from ops.app_config c where c.key = v.key)')).toBe(true);
  });

  it('nao altera app.app_user nem ops.schema_migration e nao abre transacao (o executor envolve cada arquivo)', () => {
    expect(/\balter\s+table\s+app\.app_user\b/i.test(codigo), 'altera app_user').toBe(false);
    expect(/\bschema_migration\b/i.test(codigo), 'toca o registro de migracoes').toBe(false);
    expect(/^\s*(begin|commit)\s*;/im.test(codigo), 'transacao explicita no arquivo').toBe(false);
  });

  it('desfazer | recusa com caso ou evento, remove na ordem inversa e apaga o registro da versao', () => {
    expect(codigoDown.includes("raise exception 'dsr_rollback_com_casos'")).toBe(true);
    expect(codigoDown.includes("raise exception 'dsr_rollback_com_eventos'")).toBe(true);
    const iEvento = codigoDown.indexOf('drop table if exists app.dsr_case_event');
    const iCaso = codigoDown.indexOf('drop table if exists app.dsr_case;');
    expect(iEvento > 0 && iCaso > iEvento, 'linha do tempo antes do caso').toBe(true);
    expect(codigoDown.includes(`delete from ops.schema_migration where version = '${VERSAO}';`)).toBe(true);
    expect(codigoDown.toLowerCase().includes(PAPEL_SERVICO)).toBe(false);
  });
});
