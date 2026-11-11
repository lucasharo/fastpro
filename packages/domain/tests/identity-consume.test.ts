// H-012 | T-H012-01 (forma do corpo), T-H012-02 (Origin, Sec-Fetch-Site, Content-Type),
// T-H012-04 (atributos do cookie, parte pura) e T-H012-09 (cabecalhos fixos). Sem rede, sem banco.
// Desenho: docs/factory/46-DESENHO-H012.md §1, §3, §5, §6.
import { describe, it, expect } from 'vitest';
import {
  ACESSO_PAGE_HEADERS,
  CONSUME_BODY_LIMIT_BYTES,
  CONSUME_HEADERS,
  CONSUME_TOKEN_MAX_LENGTH,
  IDENT_COOKIE_NAME,
  checkConsumeHeaders,
  identCookieHeader,
  parseConsumeBody,
  siteOriginOf,
} from '../src/identity/index.js';

const SITE = 'https://fastpro.example.test';
const ORIGIN = siteOriginOf(SITE);
const TOKEN43 = 'A'.repeat(43);

const json = (value: unknown) => JSON.stringify(value);
const parse = (text: string) => parseConsumeBody(text, Buffer.byteLength(text, 'utf8'));

describe('T-H012-01 forma do corpo', () => {
  it('aceita exatamente {token} com texto', () => {
    expect(parse(json({ token: TOKEN43 }))).toEqual({ ok: true, token: TOKEN43 });
  });

  it('recusa chaves extras (code, email) e corpo sem token', () => {
    expect(parse(json({ token: TOKEN43, code: '123456' })).ok).toBe(false);
    expect(parse(json({ token: TOKEN43, email: 'a@example.test' })).ok).toBe(false);
    expect(parse(json({ code: '123456' })).ok).toBe(false);
    expect(parse(json({})).ok).toBe(false);
  });

  it('recusa token que nao e texto ou passa de 512 caracteres', () => {
    expect(parse(json({ token: 123456 })).ok).toBe(false);
    expect(parse(json({ token: null })).ok).toBe(false);
    expect(parse(json({ token: ['x'] })).ok).toBe(false);
    expect(parse(json({ token: 'x'.repeat(CONSUME_TOKEN_MAX_LENGTH + 1) })).ok).toBe(false);
  });

  it('recusa corpo acima de 1 KiB, JSON invalido, lista e nulo', () => {
    const grande = json({ token: 'x'.repeat(CONSUME_BODY_LIMIT_BYTES) });
    expect(parse(grande).ok).toBe(false);
    expect(parse('{token:').ok).toBe(false);
    expect(parse('[]').ok).toBe(false);
    expect(parse('null').ok).toBe(false);
  });

  it('um token malformado passa na forma (o banco responde link_invalido, sem 422)', () => {
    expect(parse(json({ token: '123456' }))).toEqual({ ok: true, token: '123456' });
  });
});

describe('T-H012-02 cabecalhos antes do corpo', () => {
  const bom = {
    origin: ORIGIN,
    secFetchSite: 'same-origin',
    contentType: 'application/json',
  };

  it('aceita origem igual ao site, same-origin e JSON (com charset)', () => {
    expect(checkConsumeHeaders(bom, ORIGIN)).toEqual({ ok: true });
    expect(
      checkConsumeHeaders({ ...bom, contentType: 'application/json; charset=utf-8' }, ORIGIN),
    ).toEqual({ ok: true });
  });

  it('recusa Origin de outro site com 403, sem olhar o resto', () => {
    const r = checkConsumeHeaders({ ...bom, origin: 'https://atacante.example.test' }, ORIGIN);
    expect(r).toEqual({ ok: false, status: 403, code: 'origem_invalida' });
  });

  it('recusa Origin ausente com Sec-Fetch-Site cross-site (403)', () => {
    const r = checkConsumeHeaders(
      { origin: undefined, secFetchSite: 'cross-site', contentType: 'application/json' },
      ORIGIN,
    );
    expect(r).toEqual({ ok: false, status: 403, code: 'origem_invalida' });
  });

  it('recusa Sec-Fetch-Site diferente de same-origin mesmo com Origin igual', () => {
    const r = checkConsumeHeaders({ ...bom, secFetchSite: 'same-site' }, ORIGIN);
    expect(r.ok).toBe(false);
  });

  it('Origin correto com Sec-Fetch-Site cross-site: 403 origem_invalida (S-2)', () => {
    const r = checkConsumeHeaders({ ...bom, secFetchSite: 'cross-site' }, ORIGIN);
    expect(r).toEqual({ ok: false, status: 403, code: 'origem_invalida' });
  });

  it('recusa Content-Type diferente de JSON com 415', () => {
    const r = checkConsumeHeaders({ ...bom, contentType: 'text/plain' }, ORIGIN);
    expect(r).toEqual({ ok: false, status: 415, code: 'tipo_invalido' });
    expect(checkConsumeHeaders({ ...bom, contentType: undefined }, ORIGIN).ok).toBe(false);
  });
});

describe('T-H012-04 cookie da etapa (parte pura)', () => {
  const SECRET = 'B'.repeat(43);

  it('tem __Host-, HttpOnly, Secure, SameSite=Strict, Path=/ e 15 min, sem Domain', () => {
    const c = identCookieHeader(SECRET);
    expect(c.startsWith(`${IDENT_COOKIE_NAME}=${SECRET};`)).toBe(true);
    for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=900']) {
      expect(c.split('; ')).toContain(attr);
    }
    expect(c.toLowerCase()).not.toContain('domain=');
  });

  it('recusa segredo que nao tem 43 caracteres base64url', () => {
    expect(() => identCookieHeader('curto')).toThrow(RangeError);
    expect(() => identCookieHeader('C'.repeat(42) + '+')).toThrow(RangeError);
  });
});

describe('T-H012-09 cabecalhos fixos (CA-H012-10)', () => {
  it('toda resposta do POST traz no-store, no-referrer e nosniff', () => {
    expect(CONSUME_HEADERS['Cache-Control']).toBe('no-store');
    expect(CONSUME_HEADERS['Referrer-Policy']).toBe('no-referrer');
    expect(CONSUME_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(Object.keys(CONSUME_HEADERS).some((k) => k.toLowerCase() === 'set-cookie')).toBe(false);
  });

  it('a pagina de acesso proibe moldura e script de terceiros (CSP de 46 §5)', () => {
    const csp = ACESSO_PAGE_HEADERS['Content-Security-Policy'] ?? '';
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("form-action 'none'");
    expect(ACESSO_PAGE_HEADERS['X-Frame-Options']).toBe('DENY');
    expect(ACESSO_PAGE_HEADERS['X-Robots-Tag']).toBe('noindex');
  });
});
