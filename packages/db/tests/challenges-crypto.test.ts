// H-011 | T-H011-02 (cifra) e parte de T-H011-01 (HMAC e geracao). Sem banco, sem rede.
// Chaves e valores sao sinteticos; nenhum valor real e lido do ambiente.
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  ChallengeCryptoError,
  challengeAad,
  challengeHmacHex,
  challengeSha256Hex,
  generateChallengeCode,
  generateChallengeToken,
  loadChallengeKey,
  openChallengeBlob,
  sealChallengeBlob,
} from '../src/challenges-crypto.js';

const ID = '11111111-2222-4333-8444-555555555555';
const OTHER_ID = '66666666-7777-4888-8999-000000000000';
const SENTINEL = 'cliente.sentinela@example.test';
const key = randomBytes(32);
const chaveOutra = randomBytes(32);

describe('T-H011-02 cifra do desafio', () => {
  it('ida e volta com a AAD correta', () => {
    const blob = sealChallengeBlob(key, SENTINEL, challengeAad(ID, 'email_enc'));
    expect(openChallengeBlob(key, blob, challengeAad(ID, 'email_enc'))).toBe(SENTINEL);
  });

  it('o blob nao contem o texto em claro', () => {
    const blob = sealChallengeBlob(key, SENTINEL, challengeAad(ID, 'email_enc'));
    expect(blob.toString('latin1').includes(SENTINEL)).toBe(false);
  });

  it('dois blobs do mesmo texto diferem (nonce aleatorio)', () => {
    const a = sealChallengeBlob(key, SENTINEL, challengeAad(ID, 'email_enc'));
    const b = sealChallengeBlob(key, SENTINEL, challengeAad(ID, 'email_enc'));
    expect(a.equals(b)).toBe(false);
  });

  it('falha com AAD de outro desafio, com coluna trocada, com byte adulterado e com chave errada', () => {
    const blob = sealChallengeBlob(key, SENTINEL, challengeAad(ID, 'email_enc'));
    const falha = (fn: () => unknown) => expect(fn).toThrow(ChallengeCryptoError);
    falha(() => openChallengeBlob(key, blob, challengeAad(OTHER_ID, 'email_enc')));
    falha(() => openChallengeBlob(key, blob, challengeAad(ID, 'secrets_enc')));
    const adulterado = Buffer.from(blob);
    adulterado[adulterado.length - 1] = (adulterado[adulterado.length - 1] ?? 0) ^ 0x01;
    falha(() => openChallengeBlob(key, adulterado, challengeAad(ID, 'email_enc')));
    falha(() => openChallengeBlob(chaveOutra, blob, challengeAad(ID, 'email_enc')));
  });

  it('chave ausente ou invalida = erro de configuracao, sem o valor na mensagem', () => {
    const segredo = 'valor-que-nao-pode-vazar';
    expect(() => loadChallengeKey({})).toThrow(ChallengeCryptoError);
    expect(() => loadChallengeKey({ AUTH_CHALLENGE_KEY: '' })).toThrow(ChallengeCryptoError);
    try {
      loadChallengeKey({ AUTH_CHALLENGE_KEY: segredo });
      throw new Error('deveria falhar');
    } catch (err) {
      expect(err).toBeInstanceOf(ChallengeCryptoError);
      expect((err as Error).message).not.toContain(segredo);
      expect((err as ChallengeCryptoError).code).toBe('configuracao_cifra');
    }
  });

  it('chave valida em base64 de 32 bytes e aceita', () => {
    const bytes = randomBytes(32).toString('base64');
    const k = loadChallengeKey({ AUTH_CHALLENGE_KEY: bytes });
    expect(k.length).toBe(32);
  });
});

describe('T-H011-01 HMAC, hash e geracao', () => {
  it('HMAC e hash em 64 caracteres hexadecimais, estaveis e distintos por entrada', () => {
    const h1 = challengeHmacHex('pepper-sintetico', 'a@example.test');
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(challengeHmacHex('pepper-sintetico', 'a@example.test')).toBe(h1);
    expect(challengeHmacHex('pepper-sintetico', 'b@example.test')).not.toBe(h1);
    expect(challengeSha256Hex('token')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('token com 256 bits em base64url e codigo com 6 digitos', () => {
    expect(Buffer.from(generateChallengeToken(), 'base64url').length).toBe(32);
    for (let i = 0; i < 1000; i += 1) {
      expect(generateChallengeCode()).toMatch(/^[0-9]{6}$/);
    }
  });
});
