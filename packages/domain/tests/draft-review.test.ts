// H-030 (Issue #43) | Testes unitarios de review.ts: corpo do POST /confirm e decisao da revisao
// (docs/factory/90-DESENHO-H030.md §2.1, §2.2 e §7.3; CA-04, CA-05, CA-06, CA-11).
import { describe, expect, it } from 'vitest';
import {
  DRAFT_CONFIRM_BODY_LIMIT_BYTES,
  DRAFT_CONTENT_REV_MAX,
  DRAFT_REVIEW_FIELDS,
  decideReview,
  parseConfirmBody,
  type DraftReviewRecord,
} from '../src/draft/index.js';

const SERVICO = '0c9e2f7a-3b1d-4e8f-9a6b-1f2e3d4c5b6a';
const EXPIRA = '2026-11-19T12:00:00.000Z';

function registro(o: Partial<DraftReviewRecord> = {}): DraftReviewRecord {
  return {
    id: '7d1c2b3a-0000-4000-8000-000000000001',
    status: 'aberto',
    serviceId: SERVICO,
    serviceName: 'Eletricista',
    serviceActive: true,
    addressText: 'Rua Sintetica 100',
    urgency: 'imediato',
    description: 'Trocar tomada da cozinha',
    firstName: 'Ana',
    email: 'ana@example.test',
    emailVerified: true,
    confirmedAt: null,
    contentRev: 3,
    expiresAt: EXPIRA,
    ...o,
  };
}

describe('parseConfirmBody (CA-06, CA-07): so content_rev, inteiro de 0 a 2147483647', () => {
  const aceita = (texto: string) => parseConfirmBody(texto, new TextEncoder().encode(texto).length);

  it('aceita content_rev 0 e o maior inteiro da coluna', () => {
    expect(aceita('{"content_rev":0}')).toEqual({ ok: true, contentRev: 0 });
    expect(aceita(`{"content_rev":${DRAFT_CONTENT_REV_MAX}}`)).toEqual({ ok: true, contentRev: DRAFT_CONTENT_REV_MAX });
  });

  it('corpo acima de 1 KB vira 413 corpo_grande, mesmo com JSON valido', () => {
    const texto = '{"content_rev":0}';
    expect(parseConfirmBody(texto, DRAFT_CONFIRM_BODY_LIMIT_BYTES + 1)).toEqual({
      ok: false,
      status: 413,
      code: 'corpo_grande',
    });
    expect(parseConfirmBody(texto, DRAFT_CONFIRM_BODY_LIMIT_BYTES).ok).toBe(true);
  });

  it('chave extra, status ou confirmed_at no corpo viram 422 (sem atribuicao em massa)', () => {
    for (const texto of [
      '{"content_rev":0,"status":"publicado"}',
      '{"content_rev":0,"confirmed_at":"2026-11-12T00:00:00.000Z"}',
      '{"content_rev":0,"email":"x@example.test"}',
      '{"status":"confirmado"}',
    ]) {
      expect(aceita(texto)).toEqual({ ok: false, status: 422, code: 'corpo_invalido' });
    }
  });

  it('corpo vazio, JSON invalido, lista, nulo ou escalar vira 422 corpo_invalido', () => {
    for (const texto of ['', '{', '[]', '[{"content_rev":0}]', 'null', '"0"', '0', '{}']) {
      expect(aceita(texto)).toEqual({ ok: false, status: 422, code: 'corpo_invalido' });
    }
  });

  it('content_rev com tipo, faixa ou forma errada vira 422', () => {
    for (const texto of [
      '{"content_rev":"0"}',
      '{"content_rev":null}',
      '{"content_rev":1.5}',
      '{"content_rev":-1}',
      `{"content_rev":${DRAFT_CONTENT_REV_MAX + 1}}`,
      '{"content_rev":true}',
    ]) {
      expect(aceita(texto)).toEqual({ ok: false, status: 422, code: 'corpo_invalido' });
    }
  });
});

describe('decideReview (CA-04, CA-05, CA-10, CA-11): ordem campos -> e-mail -> pronto', () => {
  it('rascunho completo e e-mail confirmado: 200 com lista fechada de chaves e sem coordenada', () => {
    const d = decideReview(registro());
    expect(d.kind).toBe('pronto');
    if (d.kind !== 'pronto') return;
    expect(Object.keys(d.view).sort()).toEqual(
      ['address_text', 'confirmed_at', 'content_rev', 'description', 'email', 'expires_at', 'first_name', 'id', 'service', 'urgency'].sort(),
    );
    expect(d.view.service).toEqual({ id: SERVICO, name: 'Eletricista' });
    expect(d.view.content_rev).toBe(3);
    expect(d.view.confirmed_at).toBeNull();
    expect(JSON.stringify(d.view)).not.toMatch(/"(lat|lon|latitude|longitude|point|geom|phone|photos|ip_hmac|browser_nonce_hash)"/);
  });

  it('pedido ja confirmado devolve o instante gravado em confirmed_at', () => {
    const d = decideReview(registro({ confirmedAt: '2026-11-12T15:00:00.000Z' }));
    expect(d.kind === 'pronto' && d.view.confirmed_at).toBe('2026-11-12T15:00:00.000Z');
  });

  it('"Ainda nao defini" (nao_definido) conta como preenchido', () => {
    expect(decideReview(registro({ urgency: 'nao_definido' })).kind).toBe('pronto');
  });

  it('campos faltando saem na ordem fixa de DRAFT_REVIEW_FIELDS', () => {
    const d = decideReview(registro({ serviceId: null, serviceName: null, firstName: '', email: null }));
    expect(d).toEqual({ kind: 'campos_faltando', missing: ['service_id', 'first_name', 'email'] });
    const ordem = DRAFT_REVIEW_FIELDS as readonly string[];
    if (d.kind === 'campos_faltando') {
      expect([...d.missing]).toEqual([...d.missing].sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b)));
    }
  });

  it('servico inativo conta como service_id faltando', () => {
    expect(decideReview(registro({ serviceActive: false }))).toEqual({
      kind: 'campos_faltando',
      missing: ['service_id'],
    });
  });

  it('campos faltando vencem a falta de e-mail confirmado (422 antes de 409)', () => {
    const d = decideReview(registro({ emailVerified: false, addressText: '   ' }));
    expect(d).toEqual({ kind: 'campos_faltando', missing: ['address_text'] });
  });

  it('e-mail nao confirmado, ou rascunho aguardando_email, vira email_nao_confirmado sem dado do pedido', () => {
    expect(decideReview(registro({ emailVerified: false }))).toEqual({ kind: 'email_nao_confirmado' });
    expect(decideReview(registro({ status: 'aguardando_email' }))).toEqual({ kind: 'email_nao_confirmado' });
  });
});
