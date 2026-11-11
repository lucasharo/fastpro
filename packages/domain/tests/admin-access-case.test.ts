// H-073 (#83) | Testes do dominio do caso de acesso excepcional (docs/factory/60-DESENHO-H073.md §5):
// T-H073-01 (abrir), T-H073-02 (aprovar), T-H073-03 (janela), T-H073-04 (respostas iguais),
// T-H073-06 (sem justificativa nem texto em respostas). T-H073-05 (registro de rotas) NAO coberto aqui.
// Sem rede, sem banco, relogio injetado. Valores sinteticos.
import { describe, it, expect } from 'vitest';
import {
  ADMIN_PERMISSION_DENIED,
  ACCESS_WINDOW_MS,
  decideAccessCaseApprove,
  decideAccessCaseOpen,
  decideAccessCaseRead,
  isAccessJustificationValid,
  isAccessWindowOpen,
  type AdminResponse,
} from '../src/admin/index.js';

const T0 = Date.parse('2099-01-01T12:00:00.000Z');
const MIN = 60 * 1000;
const JUST_OK = 'a'.repeat(20);
const SENTINELA = 'SENTINELA-JUST-H073-7731-zq';

const abrir = (over: Partial<Parameters<typeof decideAccessCaseOpen>[0]> = {}) =>
  decideAccessCaseOpen({
    hasOpenPermission: true,
    totpAtMs: T0,
    nowMs: T0,
    conversationId: 'conv-1',
    justification: JUST_OK,
    ...over,
  });

describe('T-H073-01 abrir caso', () => {
  it('sem permissao de abrir: 403 permission_denied', () => {
    expect(abrir({ hasOpenPermission: false })).toBe(ADMIN_PERMISSION_DENIED);
  });

  it('justificativa com 19 caracteres, 501, so espacos ou vazia: 422 justificativa_invalida', () => {
    for (const j of ['a'.repeat(19), 'a'.repeat(501), '   ', '', 42]) {
      expect(abrir({ justification: j })?.status, String(j)).toBe(422);
      expect(abrir({ justification: j })?.body).toEqual({ code: 'justificativa_invalida' });
    }
  });

  it('justificativa de 20 e de 500 caracteres passa (limites inclusivos)', () => {
    expect(isAccessJustificationValid('a'.repeat(20))).toBe(true);
    expect(isAccessJustificationValid('a'.repeat(500))).toBe(true);
    expect(abrir({ justification: 'a'.repeat(500) })).toBeNull();
  });

  it('sem conversa indicada: 422 conversa_invalida', () => {
    expect(abrir({ conversationId: null })?.body).toEqual({ code: 'conversa_invalida' });
    expect(abrir({ conversationId: '' })?.status).toBe(422);
  });

  it('prova do segundo fator a 29:59 passa; a 30:00 exige nova prova (403 step_up_required)', () => {
    expect(abrir({ nowMs: T0 + 29 * MIN + 59_000 })).toBeNull();
    const aos30 = abrir({ nowMs: T0 + 30 * MIN });
    expect(aos30?.status).toBe(403);
    expect(aos30?.body).toEqual({ code: 'step_up_required' });
  });

  it('sessao invalida (sem totp_at): 403 permission_denied, nada e criado', () => {
    expect(abrir({ totpAtMs: null })).toBe(ADMIN_PERMISSION_DENIED);
  });
});

const aprovar = (over: Partial<Parameters<typeof decideAccessCaseApprove>[0]> = {}) =>
  decideAccessCaseApprove({
    hasAuthorizePermission: true,
    totpAtMs: T0,
    nowMs: T0,
    requesterId: 'solicitante',
    approverId: 'aprovador',
    pendente: true,
    votaram: [],
    ...over,
  });

describe('T-H073-02 aprovar caso', () => {
  it('o proprio solicitante nao aprova: negado', () => {
    expect(aprovar({ approverId: 'solicitante' })).toBe(ADMIN_PERMISSION_DENIED);
  });

  it('o mesmo aprovador repetido nao aprova de novo: negado', () => {
    expect(aprovar({ votaram: ['aprovador'] })).toBe(ADMIN_PERMISSION_DENIED);
  });

  it('sem case.authorize_sensitive (Suporte, Auditor, Financeiro, Superadmin fora da permissao): negado', () => {
    for (const papel of ['suporte', 'auditor', 'financeiro']) {
      expect(aprovar({ hasAuthorizePermission: false }), papel).toBe(ADMIN_PERMISSION_DENIED);
    }
  });

  it('pedido vencido (24 h) ou ja consumido (caso nao pendente): negado', () => {
    expect(aprovar({ pendente: false })).toBe(ADMIN_PERMISSION_DENIED);
  });

  it('aprovador com permissao, outra pessoa, pendente e prova recente: passa', () => {
    expect(aprovar()).toBeNull();
  });
});

describe('T-H073-03 janela de 30 min (limite estrito)', () => {
  const aprovado = T0;
  const expira = T0 + ACCESS_WINDOW_MS;

  const ler = (nowMs: number, over: Partial<Parameters<typeof decideAccessCaseRead>[0]> = {}) =>
    decideAccessCaseRead({
      hasOpenPermission: true,
      caseFound: true,
      openedByActor: true,
      scopeMatches: true,
      approvedAtMs: aprovado,
      expiresAtMs: expira,
      closed: false,
      nowMs,
      ...over,
    });

  it('janela e 30 min exatos', () => {
    expect(ACCESS_WINDOW_MS).toBe(30 * MIN);
  });

  it('leitura em approved_at passa; expires_at - 1 ms passa; expires_at exato nega; +1 ms nega', () => {
    expect(ler(aprovado)).toBeNull();
    expect(ler(expira - 1)).toBeNull();
    expect(ler(expira)).toBe(ADMIN_PERMISSION_DENIED);
    expect(ler(expira + 1)).toBe(ADMIN_PERMISSION_DENIED);
    expect(isAccessWindowOpen(aprovado, expira, aprovado - 1)).toBe(false);
  });

  it('caso fechado ou revogado nega no mesmo instante', () => {
    expect(ler(T0 + MIN, { closed: true })).toBe(ADMIN_PERMISSION_DENIED);
  });

  it('outra conversa nega; outro admin (mesmo com permissao) nega', () => {
    expect(ler(T0 + MIN, { scopeMatches: false })).toBe(ADMIN_PERMISSION_DENIED);
    expect(ler(T0 + MIN, { openedByActor: false })).toBe(ADMIN_PERMISSION_DENIED);
  });

  it('sem caso ou sem permissao de abrir nega', () => {
    expect(ler(T0 + MIN, { caseFound: false })).toBe(ADMIN_PERMISSION_DENIED);
    expect(ler(T0 + MIN, { hasOpenPermission: false })).toBe(ADMIN_PERMISSION_DENIED);
  });
});

describe('T-H073-04 respostas de negacao identicas', () => {
  it('todas as negacoes de caso sao o MESMO objeto, com cabecalho no-store', () => {
    const negacoes: Array<AdminResponse | null> = [
      abrir({ hasOpenPermission: false }),
      aprovar({ approverId: 'solicitante' }),
      aprovar({ votaram: ['aprovador'] }),
      aprovar({ hasAuthorizePermission: false }),
      decideAccessCaseRead({
        hasOpenPermission: true, caseFound: false, openedByActor: false, scopeMatches: false,
        approvedAtMs: null, expiresAtMs: null, closed: false, nowMs: T0,
      }),
      decideAccessCaseRead({
        hasOpenPermission: true, caseFound: true, openedByActor: true, scopeMatches: true,
        approvedAtMs: T0, expiresAtMs: T0 + ACCESS_WINDOW_MS, closed: false, nowMs: T0 + ACCESS_WINDOW_MS,
      }),
    ];
    for (const r of negacoes) {
      expect(r).toBe(ADMIN_PERMISSION_DENIED);
      expect(JSON.stringify(r)).toBe(JSON.stringify(ADMIN_PERMISSION_DENIED));
    }
    expect(ADMIN_PERMISSION_DENIED.headers['Cache-Control']).toBe('no-store');
  });
});

describe('T-H073-06 sem justificativa, texto ou e-mail em respostas', () => {
  it('a justificativa com sentinela nao aparece em nenhuma resposta, inclusive as de validacao', () => {
    const respostas = [
      abrir({ justification: `${SENTINELA}` }),
      abrir({ hasOpenPermission: false, justification: SENTINELA }),
      abrir({ nowMs: T0 + 30 * MIN, justification: SENTINELA }),
      decideAccessCaseRead({
        hasOpenPermission: true, caseFound: false, openedByActor: false, scopeMatches: false,
        approvedAtMs: null, expiresAtMs: null, closed: false, nowMs: T0,
      }),
    ];
    for (const r of respostas) {
      expect(JSON.stringify(r ?? {})).not.toContain(SENTINELA);
    }
  });
});
