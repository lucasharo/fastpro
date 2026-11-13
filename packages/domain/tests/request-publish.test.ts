// H-031 (#44) | Testes unitarios da publicacao do pedido (110 §12.3). Sem rede, sem banco, relogio fixo.
import { describe, expect, it } from 'vitest';
import {
  PUBLISH_ACK_TTL_S,
  PUBLISH_ERROR_RESPONSES,
  isPublishIdempotencyKey,
  issueDuplicateAck,
  parsePublishBody,
  publishBodyHash,
  verifyDuplicateAck,
} from '../src/request/index.js';

const DRAFT = '11111111-2222-4333-8444-555555555555';
const SIMILAR = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const USER = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const CHAVE = 'x'.repeat(32);
const AGORA = Date.UTC(2026, 10, 13, 12, 0, 0);
const CLAIMS = { userId: USER, draftId: DRAFT, contentRev: 3, similarRequestId: SIMILAR };

describe('parsePublishBody', () => {
  it('aceita draft_id e content_rev e normaliza o id para minusculas', () => {
    const r = parsePublishBody({ draft_id: DRAFT.toUpperCase(), content_rev: 0 });
    expect(r).toEqual({ ok: true, body: { draftId: DRAFT, contentRev: 0 } });
  });

  it('aceita duplicate_ack opcional', () => {
    const r = parsePublishBody({ draft_id: DRAFT, content_rev: 2, duplicate_ack: 'tok.en' });
    expect(r).toEqual({ ok: true, body: { draftId: DRAFT, contentRev: 2, duplicateAck: 'tok.en' } });
  });

  it('recusa chave extra, tipo errado e campo ausente como corpo_invalido', () => {
    expect(parsePublishBody({ draft_id: DRAFT, content_rev: 0, owner: 'x' })).toEqual({ ok: false, code: 'corpo_invalido' });
    expect(parsePublishBody({ draft_id: DRAFT, content_rev: '0' })).toEqual({ ok: false, code: 'corpo_invalido' });
    expect(parsePublishBody({ draft_id: DRAFT, content_rev: -1 })).toEqual({ ok: false, code: 'corpo_invalido' });
    expect(parsePublishBody({ draft_id: 'nao-uuid', content_rev: 0 })).toEqual({ ok: false, code: 'corpo_invalido' });
    expect(parsePublishBody({ content_rev: 0 })).toEqual({ ok: false, code: 'corpo_invalido' });
    expect(parsePublishBody({ draft_id: DRAFT, content_rev: 1, duplicate_ack: '' })).toEqual({ ok: false, code: 'corpo_invalido' });
    expect(parsePublishBody(['x'])).toEqual({ ok: false, code: 'corpo_invalido' });
    expect(parsePublishBody(null)).toEqual({ ok: false, code: 'corpo_invalido' });
  });

  it('recusa corpo acima de 1 KB com corpo_grande', () => {
    expect(parsePublishBody({ draft_id: DRAFT, content_rev: 0 }, 1025)).toEqual({ ok: false, code: 'corpo_grande' });
    expect(parsePublishBody({ draft_id: DRAFT, content_rev: 0 }, 1024).ok).toBe(true);
  });
});

describe('isPublishIdempotencyKey', () => {
  it('aceita 16 a 64 caracteres de [A-Za-z0-9_-] e recusa o resto', () => {
    expect(isPublishIdempotencyKey('a'.repeat(16))).toBe(true);
    expect(isPublishIdempotencyKey('A-b_9'.repeat(12) + 'ZZZZ')).toBe(true);
    expect(isPublishIdempotencyKey('a'.repeat(15))).toBe(false);
    expect(isPublishIdempotencyKey('a'.repeat(65))).toBe(false);
    expect(isPublishIdempotencyKey('ab cdefghijklmnop')).toBe(false);
    expect(isPublishIdempotencyKey(undefined)).toBe(false);
  });
});

describe('publishBodyHash', () => {
  it('e determinista, muda com o conteudo e com o token de duplicidade', () => {
    const base = publishBodyHash({ draftId: DRAFT, contentRev: 1 });
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(publishBodyHash({ draftId: DRAFT, contentRev: 1 })).toBe(base);
    expect(publishBodyHash({ draftId: DRAFT, contentRev: 2 })).not.toBe(base);
    expect(publishBodyHash({ draftId: DRAFT, contentRev: 1, duplicateAck: 'tok' })).not.toBe(base);
  });
});

describe('token de reconhecimento de duplicidade', () => {
  it('valida dentro de 300 s para as mesmas reivindicacoes', () => {
    const { token, expiresAtMs } = issueDuplicateAck(CHAVE, CLAIMS, AGORA);
    expect(expiresAtMs).toBe(AGORA + PUBLISH_ACK_TTL_S * 1000);
    expect(verifyDuplicateAck(CHAVE, token, CLAIMS, AGORA + 10_000)).toBe(true);
  });

  it('expira depois de 300 s', () => {
    const { token } = issueDuplicateAck(CHAVE, CLAIMS, AGORA);
    expect(verifyDuplicateAck(CHAVE, token, CLAIMS, AGORA + 300_000)).toBe(false);
    expect(verifyDuplicateAck(CHAVE, token, CLAIMS, AGORA + 299_000)).toBe(true);
  });

  it('recusa outro rascunho, versao, usuario, pedido semelhante, chave ou token adulterado', () => {
    const { token } = issueDuplicateAck(CHAVE, CLAIMS, AGORA);
    const agora = AGORA + 1000;
    expect(verifyDuplicateAck(CHAVE, token, { ...CLAIMS, draftId: SIMILAR }, agora)).toBe(false);
    expect(verifyDuplicateAck(CHAVE, token, { ...CLAIMS, contentRev: 4 }, agora)).toBe(false);
    expect(verifyDuplicateAck(CHAVE, token, { ...CLAIMS, userId: DRAFT }, agora)).toBe(false);
    expect(verifyDuplicateAck(CHAVE, token, { ...CLAIMS, similarRequestId: DRAFT }, agora)).toBe(false);
    expect(verifyDuplicateAck('y'.repeat(32), token, CLAIMS, agora)).toBe(false);
    const [payload, assinatura] = token.split('.') as [string, string];
    const trocado = `${payload.slice(0, -2)}${payload.endsWith('A') ? 'B' : 'A'}A.${assinatura}`;
    expect(verifyDuplicateAck(CHAVE, trocado, CLAIMS, agora)).toBe(false);
    expect(verifyDuplicateAck(CHAVE, 'lixo', CLAIMS, agora)).toBe(false);
    expect(verifyDuplicateAck(CHAVE, 'a.b.c', CLAIMS, agora)).toBe(false);
  });

  it('exige chave HMAC de pelo menos 32 caracteres', () => {
    expect(() => issueDuplicateAck('curta', CLAIMS, AGORA)).toThrow('publish_hmac_chave_curta');
    expect(() => verifyDuplicateAck('curta', 'a.b', CLAIMS, AGORA)).toThrow('publish_hmac_chave_curta');
  });
});

describe('PUBLISH_ERROR_RESPONSES', () => {
  it('mapeia cada desfecho ao status de 110 §3.1 e §3.3, com Retry-After onde o desenho pede', () => {
    expect(PUBLISH_ERROR_RESPONSES.publicacao_indisponivel).toEqual({ status: 503, code: 'publicacao_indisponivel' });
    expect(PUBLISH_ERROR_RESPONSES.conteudo_alterado?.status).toBe(409);
    expect(PUBLISH_ERROR_RESPONSES.limite?.status).toBe(429);
    expect(PUBLISH_ERROR_RESPONSES.fotos_em_processamento?.retryAfter).toBe(5);
    expect(PUBLISH_ERROR_RESPONSES.aguardando_geocodificacao).toEqual({ status: 202, code: 'aguardando_geocodificacao', retryAfter: 30 });
    expect(PUBLISH_ERROR_RESPONSES.indisponivel?.retryAfter).toBe(10);
    expect(PUBLISH_ERROR_RESPONSES.conflito?.code).toBe('chave_reutilizada');
  });
});
