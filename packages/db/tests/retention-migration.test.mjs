// H-109 (Issue 118) | Teste estatico da migracao 20261111450000 (docs/factory/82-DESENHO-H109.md §1, §7; CA-H109-11).
// Sem banco e sem rede: le o SQL e confere a postura. Nenhum prazo literal, periodo nulo na semeadura,
// RLS forcada, privilegios minimos, guarda de RC-06/RC-07 e audit_event intocado (CA-H109-08).
// A prova no Postgres (hold, lote, falha injetada) fica no teste de banco, que roda na etapa de banco.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url);
const ROLLBACKS = new URL('../../../supabase/rollbacks/', import.meta.url);
const FILE = '20261111470000_retention_create_policy.sql';
const DOWN = '20261111470000_retention_create_policy.down.sql';

const semComentario = (texto) =>
  texto
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');

const bruto = readFileSync(new URL(FILE, MIGRATIONS), 'utf8');
const sql = semComentario(bruto).toLowerCase().replace(/\s+/g, ' ');
const rb = semComentario(readFileSync(new URL(DOWN, ROLLBACKS), 'utf8')).toLowerCase().replace(/\s+/g, ' ');

/** Corpo de uma funcao: do 'create or replace function <nome>' ate o proximo '$$;' apos o 'as $$'. */
function corpo(nome) {
  const inicio = sql.indexOf(`create or replace function ${nome}(`);
  if (inicio < 0) return '';
  const fim = sql.indexOf('$$;', sql.indexOf('as $$', inicio));
  return sql.slice(inicio, fim + 3);
}

/** Bloco de criacao de tabela: do 'create table if not exists <nome>' ate o ');' seguinte. */
function tabela(nome) {
  const inicio = sql.indexOf(`create table if not exists ${nome} (`);
  if (inicio < 0) return '';
  return sql.slice(inicio, sql.indexOf(');', inicio) + 2);
}

const TABELAS = [
  'app.retention_policy',
  'app.retention_policy_change',
  'app.legal_hold',
  'app.retention_object_queue',
];

describe('T-H109 migracao 20261111470000 (teste estatico, sem banco)', () => {
  it('arquivo de migracao e rollback existem com o nome do padrao', () => {
    expect(existsSync(new URL(FILE, MIGRATIONS))).toBe(true);
    expect(existsSync(new URL(DOWN, ROLLBACKS))).toBe(true);
  });

  it('nenhum prazo literal (CA-H109-11): sem interval de dias, meses ou anos em nenhum lugar', () => {
    expect(sql).not.toMatch(/interval\s*'\s*\d+\s*(day|days|month|months|year|years|dia|dias|mes|meses|ano|anos)\b/);
    expect(sql).not.toMatch(/\b\d+\s*(anos|meses|dias)\b/);
    expect(rb).not.toMatch(/interval\s*'\s*\d+\s*(day|month|year)/);
  });

  it('semeadura sem periodo: nenhum insert de retention_policy define period, e enabled/dry_run sao falso/verdadeiro', () => {
    const seed = sql.slice(sql.indexOf('insert into app.retention_policy'), sql.indexOf('on conflict (data_class) do nothing'));
    expect(seed).toContain("'rc-01'");
    expect(seed).toContain("'rc-10'");
    expect(seed).not.toMatch(/\bperiod\b/);
    expect(seed).not.toMatch(/interval/);
    expect(seed.match(/, false, true, now\(\)\)/g)?.length).toBe(8);
    expect(sql).toContain('period interval check (period is null or period > interval');
    expect(sql).toContain('enabled boolean not null default false');
    expect(sql).toContain('dry_run boolean not null default true');
  });

  it('classes: so RC-01 a RC-07 e RC-10 (RC-08, RC-09 e RC-11 nao entram)', () => {
    const t = tabela('app.retention_policy');
    expect(t).toContain("data_class in ('rc-01', 'rc-02', 'rc-03', 'rc-04', 'rc-05', 'rc-06', 'rc-07', 'rc-10')");
    for (const fora of ['rc-08', 'rc-09', 'rc-11']) expect(t).not.toContain(fora);
  });

  it('guarda dura de RC-06 e RC-07: so reter (CHECK no banco) e RC-02 nao aceita excluir', () => {
    const t = tabela('app.retention_policy');
    expect(t).toContain("data_class not in ('rc-06', 'rc-07') or action is null or action = 'reter'");
    expect(t).toContain("data_class <> 'rc-02' or action is null or action <> 'excluir'");
  });

  it('habilitar exige periodo, acao, base legal, aprovador e vigencia (CHECK de habilitacao completa)', () => {
    const t = tabela('app.retention_policy');
    expect(t).toContain('not enabled or (period is not null and action is not null and legal_basis_ref is not null');
    expect(t).toContain('and approved_by is not null and effective_from is not null)');
    expect(tabela('app.retention_policy_change')).toContain('not enabled or (period is not null');
  });

  it('desligar a simulacao exige simulacao registrada', () => {
    expect(tabela('app.retention_policy')).toContain('dry_run or last_dry_run_at is not null');
  });

  it('quatro tabelas com RLS habilitada e forcada, sem politicas', () => {
    for (const t of TABELAS) {
      expect(sql, t).toContain(`alter table ${t} enable row level security`);
      expect(sql, t).toContain(`alter table ${t} force row level security`);
    }
    expect(sql).not.toMatch(/create policy/);
  });

  it('privilegios: revoke de todos os papeis de aplicacao e select apenas para app_system', () => {
    const revoke = sql.match(/revoke all on app\.retention_policy, [^;]*from ([a-z_, ]+);/);
    expect(revoke).not.toBeNull();
    const papeis = revoke[1].split(', ');
    const SERVICO = ['service', 'role'].join('_');
    for (const papel of ['public', 'anon', 'authenticated', SERVICO, 'app_api']) {
      expect(papeis).toContain(papel);
    }
    expect(sql).toMatch(/grant select on app\.retention_policy, app\.retention_policy_change, app\.legal_hold, app\.retention_object_queue\s+to app_system;/);
    expect(sql).not.toMatch(/grant (insert|update|delete)[^;]*app\.(retention_|legal_hold)/);
  });

  it('sem DELETE: nenhuma funcao de expurgo apaga linha de politica ou hold', () => {
    expect(sql).not.toMatch(/delete from app\.(retention_policy|legal_hold)/);
  });

  it('audit.audit_event intocado (CA-H109-08): nenhum DDL nem DML sobre a tabela de auditoria', () => {
    expect(sql).not.toMatch(/(alter|drop|create|truncate|update|delete from|insert into|grant|revoke)[^;]*audit\.audit_event/);
    expect(sql).not.toMatch(/on audit\.audit_event/);
  });

  it('escrita de auditoria so por private.audit_append, com ator admin ou system', () => {
    expect(sql).toContain("private.audit_append('system:retention', 'system', 'retention.batch.executed'");
    expect(sql).toContain("private.audit_append('admin:' || p_actor::text, 'admin', 'retention.policy.changed'");
    expect(sql).not.toMatch(/insert into audit\.audit_event/);
  });

  it('acoes de auditoria do catalogo com chaves de estado fixas, sem texto livre', () => {
    for (const acao of [
      'retention.policy.proposed',
      'retention.policy.changed',
      'retention.policy.denied',
      'retention.hold.placed',
      'retention.hold.released',
      'retention.batch.executed',
    ]) {
      expect(sql).toContain(`'${acao}'`);
    }
    const lote = sql.slice(sql.indexOf("'retention.batch.executed', 'retention_policy'"), sql.indexOf('(H-109)\'', sql.indexOf("'retention.batch.executed', 'retention_policy'")));
    expect(lote).toContain("array['data_class', 'action', 'eligible', 'processed', 'held', 'failed', 'dry_run', 'batch_no']");
  });

  it('aprovacao: tipo retencao_politica no CHECK e guarda de voto por permissao (superadmin nao herda)', () => {
    expect(sql).toContain("'suspensao_permanente', 'retencao_politica'");
    const guarda = corpo('private.approval_vote_guard');
    expect(guarda).toContain("v_req.action_type = 'retencao_politica'");
    expect(guarda).toContain("'retention.hold.manage' else 'retention.policy.manage'");
    expect(guarda).toContain("'aprovador_sem_permissao'");
  });

  it('papel governanca_dados com as duas permissoes, sem concessao ao superadmin', () => {
    expect(sql).toContain("('governanca_dados', 'retention.policy.manage')");
    expect(sql).toContain("('governanca_dados', 'retention.hold.manage')");
    expect(sql).not.toMatch(/\('superadmin', 'retention\./);
  });

  it('fases do expurgo: C reconfere hold, aplica a acao e grava o evento na mesma funcao', () => {
    const fase = corpo('private.retention_finalize_rc01');
    expect(fase).toContain('legal_hold');
    expect(fase).toContain('released_at is null');
    expect(fase).toContain("retention_state = null");
    const lote = corpo('private.retention_finalize_batch');
    expect(lote).toContain('private.retention_finalize_rc01(');
    expect(lote).toContain('private.audit_append(');
  });

  it('retencao so por ator autorizado nos cadastros; funcoes com search_path vazio e security definer', () => {
    for (const nome of [
      'private.retention_policy_propose',
      'private.retention_policy_apply',
      'private.retention_mark_batch',
      'private.retention_finalize_batch',
      'private.legal_hold_place',
      'private.legal_hold_release_apply',
    ]) {
      const f = corpo(nome);
      expect(f, nome).toContain('security definer');
      expect(f, nome).toContain("set search_path = ''");
    }
    expect(corpo('private.retention_policy_propose')).toContain("'retention.policy.manage'");
    expect(corpo('private.legal_hold_place')).toContain("'retention.hold.manage'");
  });

  it('expurgo so marca e retoma sujeitos; hold e reconferido e nunca apaga auditoria', () => {
    const marcar = corpo('private.retention_mark_batch');
    expect(marcar).toContain("retention_state = 'expurgando'");
    expect(marcar).toContain('not d.held');
    expect(marcar).toContain("v_pol.action = 'reter'");
  });

  it('guarda do perfil: excecao estreita so para expurgando -> expurgado com documento nulo (82 §3)', () => {
    const guarda = corpo('private.professional_profile_guard_update');
    expect(guarda).toContain("old.retention_state = 'expurgando' and new.retention_state = 'expurgado'");
    expect(guarda).toContain('new.document_enc is null and new.document_hmac is null');
    // o resto da guarda continua: public_name e slug protegidos e status protegido
    expect(guarda).toContain('new.public_name is distinct from old.public_name');
    expect(guarda).toContain('new.slug is distinct from old.slug');
    expect(guarda).toContain("'professional_status_protegido'");
    expect(guarda).toContain("'professional_documento_imutavel'");
  });

  it('expurgo RC-01: a finalizacao zera os tres campos do documento na funcao do banco', () => {
    const fase = corpo('private.retention_finalize_rc01');
    expect(fase).toContain('document_type = null, document_enc = null, document_hmac = null');
    expect(fase).toContain("retention_state = 'expurgado'");
  });

  it('rodizio: a fase A ordena por tentativas da fila antes do id, e nao por id puro', () => {
    const marcar = corpo('private.retention_mark_batch');
    expect(marcar).toContain('max(q.attempts)');
    expect(marcar).toMatch(/order by \(select coalesce\(max\(q\.attempts\), 0\)[^;]*d\.subject_id/);
  });

  it('simulacao so grava last_dry_run_at quando a vigencia ja passou', () => {
    const dry = corpo('private.retention_dry_run');
    expect(dry).toContain('if v_pol.effective_from is not null and v_pol.effective_from <= p_now then');
    expect(dry.indexOf('effective_from <= p_now')).toBeLessThan(dry.indexOf('set last_dry_run_at = p_now'));
  });

  it('rollback existe, restaura a guarda de H-073 e nao toca audit.audit_event', () => {
    expect(rb).toContain('begin;');
    expect(rb).toContain('commit;');
    expect(rb).toContain("check (action_type in ('papel_superadmin', 'mfa_reenroll', 'acesso_conversa', 'estorno', 'suspensao_permanente'))");
    expect(rb).not.toContain('retencao_politica');
    expect(rb).toContain("create or replace function private.approval_vote_guard()");
    expect(rb).toContain("create or replace function private.professional_profile_guard_update()");
    expect(rb).not.toContain("old.retention_state = 'expurgando'");
    expect(rb).toContain("'suspensao_permanente' then");
    expect(rb).not.toMatch(/audit\.audit_event/);
  });
});
