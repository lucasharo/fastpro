// H-105 (Issue 114) | Teste estatico da migracao 20261111460000 (docs/factory/80-DESENHO-H105.md §2 e §6, T-H105-10
// e T-H105-11). Sem banco e sem rede: le o SQL e confere a forma (tipos, constraints, funcoes, auditoria,
// privilegios e rollback). A prova no Postgres (corrida de 20 votos, regressao sobre dados antigos e
// rollback real) fica no teste de banco, que roda na etapa de banco.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url);
const ROLLBACKS = new URL('../../../supabase/rollbacks/', import.meta.url);
const FILE = '20261111460000_admin_approval_estorno_suspensao.sql';
const DOWN = '20261111460000_admin_approval_estorno_suspensao.down.sql';

const semComentario = (texto) =>
  texto
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');
const sql = semComentario(readFileSync(new URL(FILE, MIGRATIONS), 'utf8')).toLowerCase().replace(/\s+/g, ' ');
const rb = semComentario(readFileSync(new URL(DOWN, ROLLBACKS), 'utf8')).toLowerCase().replace(/\s+/g, ' ');

/** Corpo de uma funcao: do 'create or replace function <nome>' ate o '$$;' que fecha o corpo. */
function corpo(texto, nome) {
  const inicio = texto.indexOf(`create or replace function ${nome}`);
  if (inicio < 0) return '';
  const fim = texto.indexOf('$$;', texto.indexOf('as $$', inicio));
  return texto.slice(inicio, fim + 3);
}

describe('T-H105-10 migracao 20261111460000 (teste estatico, sem banco)', () => {
  it('migracao e rollback existem com o nome do padrao', () => {
    expect(existsSync(new URL(FILE, MIGRATIONS))).toBe(true);
    expect(existsSync(new URL(DOWN, ROLLBACKS))).toBe(true);
  });

  it('lista de tipos de acao e exatamente a vigente (5 tipos)', () => {
    expect(sql).toContain(
      "check (action_type in ('papel_superadmin', 'mfa_reenroll', 'acesso_conversa', 'estorno', 'suspensao_permanente'))",
    );
  });

  it('colunas novas sao anulaveis e sem default (linhas antigas nao mudam)', () => {
    expect(sql).toContain('add column if not exists subject_ref uuid;');
    expect(sql).toContain('add column if not exists amount_cents integer;');
    expect(sql).toContain('add column if not exists reason text;');
    expect(sql).not.toMatch(/subject_ref uuid not null/);
    expect(sql).not.toMatch(/amount_cents integer not null/);
  });

  it('numero de votos: 1 a 2 em geral; estorno pelo valor (20000 e 2 acima); suspensao sempre 2', () => {
    expect(sql).toContain('check (required_approvals in (1, 2))');
    expect(sql).toContain('required_approvals = case when amount_cents <= 20000 then 1 else 2 end');
    expect(sql).toContain("(action_type = 'suspensao_permanente' and required_approvals = 2)");
    expect(sql).toContain("(action_type not in ('estorno', 'suspensao_permanente') and required_approvals = 1)");
  });

  it('campos por tipo: estorno exige alvo, valor e motivo; suspensao alvo e motivo sem valor', () => {
    expect(sql).toContain('approval_request_campos_por_tipo');
    expect(sql).toMatch(/action_type = 'estorno' and subject_ref is not null and amount_cents is not null and reason is not null/);
    expect(sql).toMatch(/action_type = 'suspensao_permanente' and subject_ref is not null and amount_cents is null and reason is not null/);
  });

  it('motivo entre 10 e 500 caracteres apos aparar; valor positivo', () => {
    expect(sql).toContain('check (reason is null or char_length(btrim(reason)) between 10 and 500)');
    expect(sql).toContain('check (amount_cents is null or amount_cents > 0)');
  });

  it('um pedido aberto por alvo (indice unico parcial sobre pendente e aprovada)', () => {
    expect(sql).toMatch(
      /create unique index if not exists approval_request_alvo_aberto_key on app\.approval_request \(action_type, subject_ref\) where status in \('pendente', 'aprovada'\) and subject_ref is not null/,
    );
  });

  it('campos do pedido sao imutaveis depois de gravados (gatilho de atualizacao)', () => {
    const f = corpo(sql, 'private.approval_request_guard_update');
    for (const campo of ['action_type', 'subject_ref', 'amount_cents', 'reason', 'requested_by', 'required_approvals', 'expires_at']) {
      expect(f, campo).toContain(`new.${campo} is distinct from old.${campo}`);
    }
    expect(sql).toContain('before update on app.approval_request');
  });

  it('gatilho de voto recusa autoaprovacao do alvo de suspensao e exige a permissao do tipo', () => {
    const f = corpo(sql, 'private.approval_vote_guard');
    expect(f).toContain("v_req.action_type = 'estorno'");
    expect(f).toContain("private.admin_has_permission(new.approver_id, 'finance.refund.approve')");
    expect(f).toContain("v_req.action_type = 'suspensao_permanente'");
    expect(f).toContain('new.approver_id = v_req.subject_ref');
    expect(f).toContain("private.admin_has_permission(new.approver_id, 'account.suspend.approve')");
    expect(f).toContain("raise exception 'aprovador_nao_ativo'");
  });

  it('suspensao: trocar para suspensa so com pedido consumido no mesmo instante (guarda do perfil)', () => {
    const f = corpo(sql, 'private.professional_profile_guard_update');
    expect(f).toContain("new.verification_status = 'suspensa'");
    expect(f).toContain("r.action_type = 'suspensao_permanente'");
    expect(f).toContain("r.status = 'consumida'");
    expect(f).toContain('r.consumed_at = new.suspended_at');
    expect(f).toContain("raise exception 'professional_status_protegido'");
  });

  it('permissoes novas: Suporte pede, Moderador aprova; Superadmin nao recebe', () => {
    expect(sql).toContain("('account.suspend.request', 'solicitar suspensao de conta')");
    expect(sql).toContain("('account.suspend.approve', 'aprovar suspensao de conta')");
    expect(sql).toContain("('suporte', 'account.suspend.request')");
    expect(sql).toContain("('moderador', 'account.suspend.approve')");
    expect(sql).not.toMatch(/'superadmin', 'account\.suspend/);
  });

  it('acoes de auditoria do catalogo (T-H105-08) e nenhuma delas leva o motivo', () => {
    for (const acao of ['approval.requested', 'approval.voted', 'approval.cancelled', 'approval.expired', 'approval.vote_denied']) {
      expect(sql).toContain(`('${acao}', 'approval_request'`);
    }
    expect(sql).toContain("('approval.vote_denied', 'approval_request', true, array['status']");
    // Chaves de estado do catalogo novo: nenhuma e o motivo livre.
    const catalogo = sql.slice(sql.indexOf("('approval.requested'"), sql.indexOf('on conflict (action) do nothing', sql.indexOf("('approval.requested'")));
    expect(catalogo).not.toMatch(/array\[[^\]]*'reason'/);
  });

  it('funcoes de dupla aprovacao existem, sao security definer com search_path vazio e chamam a auditoria', () => {
    for (const nome of [
      'private.approval_dual_open',
      'private.approval_dual_vote',
      'private.approval_dual_cancel',
      'private.approval_dual_denied_record',
      'private.approval_dual_list',
    ]) {
      const f = corpo(sql, nome);
      expect(f, nome).not.toBe('');
      expect(f, nome).toContain('security definer');
      expect(f, nome).toContain('set search_path = \'\'');
    }
    expect(corpo(sql, 'private.approval_dual_open')).toContain("'approval.requested'");
    expect(corpo(sql, 'private.approval_dual_vote')).toContain("'approval.voted'");
    expect(corpo(sql, 'private.approval_dual_vote')).toContain("'professional.suspended'");
    expect(corpo(sql, 'private.approval_dual_cancel')).toContain("'approval.cancelled'");
    expect(corpo(sql, 'private.approval_dual_vote')).toContain("'approval.expired'");
  });

  it('o motivo nunca entra em auditoria nem em listagem alheia', () => {
    // Campo do motivo e 'reason' ligado a tabela (.reason); p_reason_code e so o codigo da negacao.
    const lista = corpo(sql, 'private.approval_dual_list');
    expect(lista).not.toMatch(/\.reason\b/);
    expect(corpo(sql, 'private.approval_dual_denied_record')).not.toMatch(/\.reason\b/);
    expect(corpo(sql, 'private.approval_dual_open')).toMatch(/'approval\.requested'[\s\S]*?'\{\}'::jsonb/);
  });

  it('votos vencidos nao desfazem a expiracao: devolvem status expirada, sem raise', () => {
    const f = corpo(sql, 'private.approval_dual_vote');
    const trecho = f.slice(f.indexOf('if v_req.expires_at <= p_now then'), f.indexOf("return jsonb_build_object('status', 'expirada'"));
    expect(trecho).toContain('private.admin_approval_vote(p_id, p_actor, p_now)');
    expect(trecho).not.toMatch(/raise exception/);
  });

  it('suspensao aprovada consome o pedido antes de suspender (mesma transacao)', () => {
    const f = corpo(sql, 'private.approval_dual_vote');
    expect(f.indexOf("set status = 'consumida'")).toBeGreaterThan(-1);
    expect(f.indexOf("set status = 'consumida'")).toBeLessThan(f.indexOf("verification_status = 'suspensa'"));
  });

  it('funcoes novas: revoke de publico e papeis de API; execute so para app_system', () => {
    expect(sql).toContain('revoke all on function');
    // Revoke cobre todos os papeis de API (o ultimo da lista e o de servico, sem nomea-lo aqui).
    expect(sql).toMatch(/from public, anon, authenticated, \w+, app_api;/);
    expect(sql).toMatch(/grant execute on function[\s\S]*to app_system;/);
    // Nenhum grant de execucao para outro papel que nao app_system.
    expect(sql).not.toMatch(/grant execute on function[^;]*?\bto (?!app_system\b)\w+/);
  });

  it('negacao de voto fica fora da funcao de voto (transacao propria da API)', () => {
    expect(corpo(sql, 'private.approval_dual_vote')).not.toContain('approval.vote_denied');
    expect(corpo(sql, 'private.approval_dual_denied_record')).toContain("'approval.vote_denied'");
  });
});

describe('T-H105-10 rollback 20261111460000 (teste estatico, sem banco)', () => {
  it('aborta se houver linha dos tipos novos, antes de qualquer alteracao', () => {
    const aborta = rb.indexOf("exists (select 1 from app.approval_request where action_type in ('estorno', 'suspensao_permanente'))");
    expect(aborta).toBeGreaterThan(-1);
    expect(rb.indexOf('raise exception')).toBeGreaterThan(-1);
    expect(rb.indexOf('raise exception')).toBeLessThan(rb.indexOf('drop function if exists private.approval_dual_list'));
  });

  it('restaura a lista de tipos, o limite de um voto e as guardas anteriores', () => {
    expect(rb).toContain("check (action_type in ('papel_superadmin', 'mfa_reenroll', 'acesso_conversa'))");
    expect(rb).toContain('check (required_approvals = 1)');
    expect(rb).toContain("new.verification_status in ('pendente', 'retida_duplicidade')");
    expect(rb).not.toContain("'suspensa'");
    expect(rb).toContain("raise exception 'aprovador_nao_superadmin'");
  });

  it('remove funcoes, permissoes, catalogo, colunas e registro da migracao', () => {
    expect(rb).toContain('drop column if exists subject_ref');
    expect(rb).toContain('drop column if exists amount_cents');
    expect(rb).toContain('drop column if exists reason');
    expect(rb).toContain("delete from ops.schema_migration where version = '20261111460000'");
    expect(rb).toContain("delete from app.admin_permission");
  });
});
