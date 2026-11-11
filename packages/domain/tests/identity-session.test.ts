// H-014 | Testes puros da sessao de 7 dias e do step-up (docs/factory/52-DESENHO-H014.md §1 a §4).
// T-H014-01 (cookie e Max-Age), T-H014-02 (conversao negada), T-H014-03 (guarda de sessao),
// T-H014-04 (requireRecentAuth), T-H014-05 (lista de acoes criticas), T-H014-08 (contrato do step-up).
// Sem rede, sem banco, relogio injetado. E-mails e segredos sinteticos.
import { describe, it, expect } from 'vitest';
import {
  ACCESS_EXPIRED_BODY,
  CRITICAL_ACTIONS,
  IDENT_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  STEP_UP_WINDOW_SECONDS,
  UNAUTHENTICATED_BODY,
  checkStepUpMethod,
  clearCookieHeader,
  decideConversion,
  isCriticalAction,
  isSessionUsable,
  maxAgeSecondsFor,
  parseStepUpBody,
  requireRecentAuth,
  sessionCookieHeader,
  stepUpMethodFor,
  type SessionRow,
} from '../src/identity/index.js';

const T0 = Date.parse('2099-01-01T12:00:00.000Z');
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const SECRET = 'A'.repeat(43);
const SEG = 1000;

const etapa = (over: Partial<SessionRow> = {}): SessionRow => ({
  stage: 'identificacao',
  revokedAtMs: null,
  expiresAtMs: T0 + 15 * 60 * SEG,
  absoluteExpiresAtMs: T0 + SEVEN_DAYS_MS,
  userActive: true,
  ...over,
});

const ativa = (over: Partial<SessionRow> = {}): SessionRow =>
  etapa({
    stage: 'ativa',
    expiresAtMs: T0 + SEVEN_DAYS_MS,
    ...over,
  });

describe('T-H014-01 cookie da sessao e Max-Age', () => {
  it('cookie __Host-fp_sess: HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age informado', () => {
    expect(SESSION_COOKIE_NAME).toBe('__Host-fp_sess');
    expect(sessionCookieHeader(SECRET, SESSION_MAX_AGE_SECONDS)).toBe(
      `__Host-fp_sess=${SECRET}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`,
    );
  });

  it('recusa segredo fora do formato de 256 bits em base64url', () => {
    expect(() => sessionCookieHeader('curto', 60)).toThrow(RangeError);
    expect(() => sessionCookieHeader(`${SECRET}=`, 60)).toThrow(RangeError);
  });

  it('recusa Max-Age zero ou negativo, e acima do teto de 7 dias', () => {
    expect(() => sessionCookieHeader(SECRET, 0)).toThrow(RangeError);
    expect(() => sessionCookieHeader(SECRET, -5)).toThrow(RangeError);
    expect(() => sessionCookieHeader(SECRET, SESSION_MAX_AGE_SECONDS + 1)).toThrow(RangeError);
  });

  it('Max-Age = absolute - agora: no clique, 604800; 1 s depois, 604799', () => {
    expect(maxAgeSecondsFor(T0 + SEVEN_DAYS_MS, T0)).toBe(604800);
    expect(maxAgeSecondsFor(T0 + SEVEN_DAYS_MS, T0 + SEG)).toBe(604799);
  });

  it('Max-Age nunca passa de 604800 e nunca fica negativo', () => {
    expect(maxAgeSecondsFor(T0 + 2 * SEVEN_DAYS_MS, T0)).toBe(SESSION_MAX_AGE_SECONDS);
    expect(maxAgeSecondsFor(T0, T0 + SEG)).toBe(0);
  });

  it('apagar cookies: fp_ident sai com SameSite=Strict (como foi gravado); fp_sess com Lax', () => {
    expect(IDENT_COOKIE_NAME).toBe('__Host-fp_ident');
    expect(clearCookieHeader('identificacao')).toBe(
      '__Host-fp_ident=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0',
    );
    expect(clearCookieHeader('sessao')).toBe(
      '__Host-fp_sess=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
    );
  });
});

describe('T-H014-02 conversao da etapa: so a etapa valida converte', () => {
  it('etapa valida (antes dos 15 min) converte', () => {
    expect(decideConversion(etapa(), T0)).toEqual({ ok: true });
    expect(decideConversion(etapa(), T0 + 15 * 60 * SEG - SEG)).toEqual({ ok: true });
  });

  it('sem linha (cookie ausente ou desconhecido) nao converte', () => {
    expect(decideConversion(null, T0)).toEqual({ ok: false });
  });

  it('etapa ja convertida (ativa) nao converte de novo', () => {
    expect(decideConversion(ativa(), T0)).toEqual({ ok: false });
  });

  it('vencida no instante exato de expires_at e 1 s depois: nao converte', () => {
    const exp = T0 + 15 * 60 * SEG;
    expect(decideConversion(etapa(), exp)).toEqual({ ok: false });
    expect(decideConversion(etapa(), exp + SEG)).toEqual({ ok: false });
  });

  it('revogada ou usuario bloqueado: nao converte', () => {
    expect(decideConversion(etapa({ revokedAtMs: T0 }), T0)).toEqual({ ok: false });
    expect(decideConversion(etapa({ userActive: false }), T0)).toEqual({ ok: false });
  });

  it('a negacao usa o corpo fixo de acesso expirado', () => {
    expect(ACCESS_EXPIRED_BODY).toEqual({ code: 'acesso_expirado' });
  });
});

describe('T-H014-03 guarda de sessao: 7 dias absolutos, sem renovacao', () => {
  it('ativa no ultimo segundo util (7 d - 1 s) serve; no instante exato de 7 dias, nao', () => {
    const s = ativa();
    expect(isSessionUsable(s, T0 + SEVEN_DAYS_MS - SEG)).toBe(true);
    expect(isSessionUsable(s, T0 + SEVEN_DAYS_MS)).toBe(false);
    expect(isSessionUsable(s, T0 + SEVEN_DAYS_MS + SEG)).toBe(false);
  });

  it('etapa de identificacao nunca serve em rota de recurso, mesmo dentro dos 15 min', () => {
    expect(isSessionUsable(etapa(), T0)).toBe(false);
  });

  it('revogada ou com usuario bloqueado nao serve', () => {
    expect(isSessionUsable(ativa({ revokedAtMs: T0 }), T0)).toBe(false);
    expect(isSessionUsable(ativa({ userActive: false }), T0)).toBe(false);
  });

  it('o corpo do 401 de recurso e fixo (nao_autenticado)', () => {
    expect(UNAUTHENTICATED_BODY).toEqual({ code: 'nao_autenticado' });
  });
});

describe('T-H014-04 requireRecentAuth: janela de 30 min, sempre 401 step_up_required', () => {
  const window = STEP_UP_WINDOW_SECONDS * 1000;

  it('janela de 30 min', () => {
    expect(STEP_UP_WINDOW_SECONDS).toBe(1800);
  });

  it('no limite exato de 30 min passa; 1 s depois, nao', () => {
    expect(requireRecentAuth({ recentAuthAtMs: T0, authMethod: 'link' }, T0 + window)).toEqual({
      ok: true,
    });
    const r = requireRecentAuth({ recentAuthAtMs: T0, authMethod: 'link' }, T0 + window + SEG);
    expect(r).toEqual({
      ok: false,
      status: 401,
      body: { code: 'step_up_required', method: 'code' },
    });
  });

  it('sem recent_auth_at: 401 step_up_required', () => {
    expect(requireRecentAuth({ recentAuthAtMs: null, authMethod: 'link' }, T0)).toMatchObject({
      ok: false,
      status: 401,
      body: { code: 'step_up_required' },
    });
  });

  it('o metodo da prova vem da sessao: link -> code, password -> password', () => {
    expect(stepUpMethodFor('link')).toBe('code');
    expect(stepUpMethodFor('password')).toBe('password');
    const r = requireRecentAuth({ recentAuthAtMs: null, authMethod: 'password' }, T0);
    expect(r).toMatchObject({ body: { method: 'password' } });
  });

  it('a negacao nunca e 403 nem 404 e nao traz cookie', () => {
    const r = requireRecentAuth({ recentAuthAtMs: null, authMethod: 'link' }, T0);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(401);
    expect(Object.keys(r)).not.toContain('setCookie');
  });
});

describe('T-H014-05 lista de acoes criticas (08 §5.4)', () => {
  it('lista exata, com selecionar e trocar_selecionado', () => {
    expect([...CRITICAL_ACTIONS]).toEqual([
      'cancelar',
      'concluir',
      'corrigir_conclusao',
      'compartilhar_contato',
      'revogar_contato',
      'selecionar',
      'trocar_selecionado',
    ]);
  });

  it('isCriticalAction aceita so os nomes da lista', () => {
    expect(isCriticalAction('cancelar')).toBe(true);
    expect(isCriticalAction('trocar_selecionado')).toBe(true);
    expect(isCriticalAction('listar')).toBe(false);
    expect(isCriticalAction('CANCELAR')).toBe(false);
  });
});

describe('T-H014-08 contrato unico do step-up, com dois metodos', () => {
  const parse = (value: unknown) => {
    const text = JSON.stringify(value);
    return parseStepUpBody(text, Buffer.byteLength(text, 'utf8'));
  };

  it('aceita {method:"code", code:"123456"} com chaves exatas', () => {
    expect(parse({ method: 'code', code: '123456' })).toEqual({
      ok: true,
      method: 'code',
      code: '123456',
    });
  });

  it('aceita {method:"password", password} com chaves exatas', () => {
    // Valor sintetico montado em tempo de execucao (nao literal de segredo).
    const SENHA = ['senha', 'sintetica', '1'].join('-');
    expect(parse({ method: 'password', password: SENHA })).toEqual({
      ok: true,
      method: 'password',
      password: SENHA,
    });
  });

  it('recusa chave a mais, chave de outro metodo e metodo desconhecido', () => {
    expect(parse({ method: 'code', code: '123456', extra: 1 }).ok).toBe(false);
    expect(parse({ method: 'code', code: '123456', password: 'x' }).ok).toBe(false);
    expect(parse({ method: 'password', code: '123456' }).ok).toBe(false);
    expect(parse({ method: 'sms', code: '123456' }).ok).toBe(false);
    expect(parse({ code: '123456' }).ok).toBe(false);
  });

  it('codigo precisa ter 6 digitos numericos', () => {
    expect(parse({ method: 'code', code: '12345' }).ok).toBe(false);
    expect(parse({ method: 'code', code: '1234567' }).ok).toBe(false);
    expect(parse({ method: 'code', code: '12a456' }).ok).toBe(false);
    expect(parse({ method: 'code', code: 123456 }).ok).toBe(false);
  });

  it('senha vazia ou com mais de 256 caracteres e recusada', () => {
    expect(parse({ method: 'password', password: '' }).ok).toBe(false);
    expect(parse({ method: 'password', password: 'x'.repeat(257) }).ok).toBe(false);
  });

  it('corpo acima de 1 KiB, JSON invalido, lista ou nulo sao recusados', () => {
    expect(parseStepUpBody('{}', 1025).ok).toBe(false);
    expect(parseStepUpBody('{nao json', 9).ok).toBe(false);
    expect(parse([]).ok).toBe(false);
    expect(parse(null).ok).toBe(false);
  });

  it('metodo da requisicao precisa bater com o da sessao (senao 422 metodo_invalido)', () => {
    expect(checkStepUpMethod('link', 'code')).toBe(true);
    expect(checkStepUpMethod('link', 'password')).toBe(false);
    expect(checkStepUpMethod('password', 'password')).toBe(true);
    expect(checkStepUpMethod('password', 'code')).toBe(false);
  });
});
