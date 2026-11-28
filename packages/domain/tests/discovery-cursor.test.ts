// Issue 68 (H-055) | Cursor cifrado da descoberta (docs/factory/153-DESENHO-H055.md, §4 e §7;
// T-H055-07, T-H055-08, T-H055-09, T-H055-25, T-H055-26). Sem rede e sem banco; relogio injetado.
import { describe, it, expect } from 'vitest';
import { createCipheriv, hkdfSync, randomBytes } from 'node:crypto';
import {
  DISCOVERY_CURSOR_TTL_MS,
  DiscoveryCursorError,
  createDiscoveryCursorCodec,
} from '../src/discovery/index.js';

const CHAVE = 'chave-de-teste-do-cursor-0123456789-abcdef';
const NOW = 1_800_000_000_000;
const PRO_A = '11111111-2222-4333-8444-555555555555';
const PRO_B = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const REQ = '7f0c2d1e-3a4b-4c5d-8e6f-9a0b1c2d3e4f';
const CURSOR = { group: 0 as const, key: 1250, requestId: REQ };

const codec = createDiscoveryCursorCodec(CHAVE);

function codigoDe(fn: () => unknown): string {
  try {
    fn();
  } catch (erro) {
    if (erro instanceof DiscoveryCursorError) return erro.code;
    throw erro;
  }
  return 'sem_erro';
}

function trocarBit(token: string, indice: number): string {
  const bytes = Buffer.from(token, 'base64url');
  bytes[indice] ^= 0x01;
  return bytes.toString('base64url');
}

/** Monta um token com a chave derivada da mesma forma que o codec (HKDF), para testar tipos do payload. */
function tokenForjado(payload: unknown, professionalId: string, versao = 1): string {
  const chave = Buffer.from(
    hkdfSync('sha256', Buffer.from(CHAVE), Buffer.from('fastpro-discovery-cursor-v1'), Buffer.from('cursor-aead'), 32),
  );
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', chave, nonce);
  cipher.setAAD(Buffer.from(`cur1|${professionalId}`, 'utf8'));
  const corpo = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')), cipher.final()]);
  return Buffer.concat([Buffer.from([versao]), nonce, cipher.getAuthTag(), corpo]).toString('base64url');
}

describe('ida e volta (T-H055-25)', () => {
  it('decifra o mesmo cursor para o mesmo profissional e instante', () => {
    const token = codec.seal(CURSOR, PRO_A, NOW);
    expect(codec.open(token, PRO_A, NOW)).toEqual(CURSOR);
  });

  it('preserva grupo online (1) com chave zero', () => {
    const online = { group: 1 as const, key: 0, requestId: REQ };
    expect(codec.open(codec.seal(online, PRO_A, NOW), PRO_A, NOW)).toEqual(online);
  });

  it('gera nonce novo a cada emissao: dois tokens do mesmo cursor sao diferentes', () => {
    const t1 = codec.seal(CURSOR, PRO_A, NOW);
    const t2 = codec.seal(CURSOR, PRO_A, NOW);
    expect(t1).not.toBe(t2);
    const b1 = Buffer.from(t1, 'base64url');
    const b2 = Buffer.from(t2, 'base64url');
    expect(b1.subarray(1, 13).equals(b2.subarray(1, 13))).toBe(false);
  });

  it('o token nao deixa a distancia nem o id do pedido legiveis', () => {
    const token = codec.seal(CURSOR, PRO_A, NOW);
    const claro = Buffer.from(token, 'base64url').toString('latin1');
    expect(claro).not.toContain('"k"');
    expect(claro).not.toContain('1250');
    expect(claro).not.toContain(REQ);
    expect(token).not.toContain(Buffer.from('"k":1250').toString('base64url'));
  });

  it('um token tipico fica abaixo do teto de 512 caracteres da entrada', () => {
    const token = codec.seal({ group: 0, key: 99999999, requestId: REQ }, PRO_A, NOW);
    expect(token.length).toBeLessThan(512);
  });
});

describe('recusas com um unico codigo (T-H055-07)', () => {
  const valido = codec.seal(CURSOR, PRO_A, NOW);

  it('truncado, bit trocado, lixo, versao 2, vazio, longo, fora do alfabeto e tipo errado', () => {
    const casos: unknown[] = [
      valido.slice(0, -4),
      trocarBit(valido, 40),
      'lixo-que-nao-e-cursor',
      tokenForjado({ g: 0, k: 1, id: REQ, iat: NOW }, PRO_A, 2),
      '',
      'A'.repeat(513),
      'ab c',
      'ab+/',
      null,
      123,
      undefined,
    ];
    for (const caso of casos) {
      expect(codigoDe(() => codec.open(caso, PRO_A, NOW))).toBe('cursor_invalido');
    }
  });

  it('a mensagem e o codigo fixos, sem eco do token', () => {
    try {
      codec.open('token-adulterado', PRO_A, NOW);
      throw new Error('deveria recusar');
    } catch (erro) {
      expect(erro).toBeInstanceOf(DiscoveryCursorError);
      expect((erro as Error).message).toBe('cursor_invalido');
      expect((erro as Error).message).not.toContain('token-adulterado');
    }
  });
});

describe('vinculo com o profissional (T-H055-08)', () => {
  it('cursor emitido ao profissional A recusado para B', () => {
    const token = codec.seal(CURSOR, PRO_A, NOW);
    expect(codigoDe(() => codec.open(token, PRO_B, NOW))).toBe('cursor_invalido');
    expect(codec.open(token, PRO_A, NOW)).toEqual(CURSOR);
  });

  it('chave diferente recusa o cursor com o mesmo codigo', () => {
    const outra = createDiscoveryCursorCodec('outra-chave-de-teste-0123456789-zzzzzz');
    const token = codec.seal(CURSOR, PRO_A, NOW);
    expect(codigoDe(() => outra.open(token, PRO_A, NOW))).toBe('cursor_invalido');
  });
});

describe('validade de 24 h e tolerancia de relogio (T-H055-09)', () => {
  it('aceita exatamente 24 h e recusa 24 h mais 1 ms', () => {
    const emitido = codec.seal(CURSOR, PRO_A, NOW - DISCOVERY_CURSOR_TTL_MS);
    expect(codec.open(emitido, PRO_A, NOW)).toEqual(CURSOR);
    const vencido = codec.seal(CURSOR, PRO_A, NOW - DISCOVERY_CURSOR_TTL_MS - 1);
    expect(codigoDe(() => codec.open(vencido, PRO_A, NOW))).toBe('cursor_invalido');
  });

  it('aceita iat ate 60 s no futuro e recusa a partir de 60 s mais 1 ms', () => {
    const dentro = codec.seal(CURSOR, PRO_A, NOW + 60_000);
    expect(codec.open(dentro, PRO_A, NOW)).toEqual(CURSOR);
    const alem = codec.seal(CURSOR, PRO_A, NOW + 60_001);
    expect(codigoDe(() => codec.open(alem, PRO_A, NOW))).toBe('cursor_invalido');
  });
});

describe('montagem com chave (T-H055-26)', () => {
  it('chave ausente, vazia ou com menos de 32 caracteres falha ao montar com configuracao_cursor', () => {
    expect(codigoDe(() => createDiscoveryCursorCodec(''))).toBe('configuracao_cursor');
    expect(codigoDe(() => createDiscoveryCursorCodec('a'.repeat(31)))).toBe('configuracao_cursor');
    expect(codigoDe(() => createDiscoveryCursorCodec(undefined as unknown as string))).toBe('configuracao_cursor');
  });

  it('chave com 32 caracteres e aceita', () => {
    expect(() => createDiscoveryCursorCodec('a'.repeat(32))).not.toThrow();
  });
});

describe('tipos exatos do payload (cursor com tag valida e conteudo invalido)', () => {
  const base = { g: 0, k: 1250, id: REQ, iat: NOW };

  it('controle: payload correto forjado com a mesma chave e aceito', () => {
    expect(codec.open(tokenForjado(base, PRO_A), PRO_A, NOW)).toEqual(CURSOR);
  });

  it('recusa grupo fora de 0/1, distancia negativa ou fracionaria, tipo errado, id e iat invalidos', () => {
    const ruins: unknown[] = [
      { ...base, g: 2 },
      { ...base, g: '0' },
      { ...base, k: -1 },
      { ...base, k: 1.5 },
      { ...base, k: '1250' },
      { ...base, id: 'nao-e-uuid' },
      { ...base, id: 42 },
      { ...base, iat: '1800000000000' },
      { ...base, iat: 1.5 },
      { g: 0, k: 1, id: REQ },
      { ...base, extra: 'x' },
      [1, 2, 3],
      'texto',
      null,
    ];
    for (const ruim of ruins) {
      expect(codigoDe(() => codec.open(tokenForjado(ruim, PRO_A), PRO_A, NOW))).toBe('cursor_invalido');
    }
  });

  it('JSON invalido dentro do envelope cifrado e recusado', () => {
    const chave = Buffer.from(
      hkdfSync('sha256', Buffer.from(CHAVE), Buffer.from('fastpro-discovery-cursor-v1'), Buffer.from('cursor-aead'), 32),
    );
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', chave, nonce);
    cipher.setAAD(Buffer.from(`cur1|${PRO_A}`, 'utf8'));
    const corpo = Buffer.concat([cipher.update(Buffer.from('{nao-json', 'utf8')), cipher.final()]);
    const envelope = Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), corpo]).toString('base64url');
    expect(codigoDe(() => codec.open(envelope, PRO_A, NOW))).toBe('cursor_invalido');
  });
});

describe('entrada invalida na emissao', () => {
  it('recusa grupo, chave, id ou profissional invalidos com cursor_invalido', () => {
    expect(codigoDe(() => codec.seal({ group: 2 as never, key: 1, requestId: REQ }, PRO_A, NOW))).toBe('cursor_invalido');
    expect(codigoDe(() => codec.seal({ group: 0, key: -1, requestId: REQ }, PRO_A, NOW))).toBe('cursor_invalido');
    expect(codigoDe(() => codec.seal({ group: 0, key: 1, requestId: 'nao-uuid' }, PRO_A, NOW))).toBe('cursor_invalido');
    expect(codigoDe(() => codec.seal(CURSOR, '', NOW))).toBe('cursor_invalido');
  });
});
