// H-021 | HMAC do endereco com chave propria (docs/factory/68-DESENHO-H021.md, §2.1). Sem banco e sem rede.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-021');
};

import { describe, expect, it } from 'vitest';
import {
  ADDRESS_HASH_KEY_ENV,
  ADDRESS_HASH_KEY_MIN_LENGTH,
  createAddressHasher,
} from '../src/geo/address-hash.js';

const CHAVE_SINTETICA = 'example-chave-sintetica-hash-endereco-h021-01';
const OUTRA_CHAVE = 'example-chave-sintetica-hash-endereco-h021-02';

describe('createAddressHasher (§2.1)', () => {
  it('usa o nome de ambiente proprio, sem reutilizar PEPPER_*', () => {
    expect(ADDRESS_HASH_KEY_ENV).toBe('ADDRESS_HASH_KEY');
    expect(ADDRESS_HASH_KEY_ENV.startsWith('PEPPER_')).toBe(false);
  });

  it('devolve 64 caracteres hexadecimais, deterministicos para a mesma chave e o mesmo texto', () => {
    const h = createAddressHasher(CHAVE_SINTETICA);
    const a = h('rua alfa sintetica, 10');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(h('rua alfa sintetica, 10')).toBe(a);
  });

  it('chave diferente produz hash diferente; o texto em claro nao aparece no resultado', () => {
    const texto = 'rua alfa sintetica, 10';
    const a = createAddressHasher(CHAVE_SINTETICA)(texto);
    const b = createAddressHasher(OUTRA_CHAVE)(texto);
    expect(a).not.toBe(b);
    expect(a).not.toContain('alfa');
  });

  it('recusa chave curta ou ausente antes de qualquer uso', () => {
    expect(() => createAddressHasher('')).toThrow('chave_hash_endereco_invalida');
    expect(() => createAddressHasher('x'.repeat(ADDRESS_HASH_KEY_MIN_LENGTH - 1))).toThrow(
      'chave_hash_endereco_invalida',
    );
  });
});
