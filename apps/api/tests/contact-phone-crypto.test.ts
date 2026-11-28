// Issue 46 (H-033) | T-17 e T-18 (docs/factory/129-DESENHO-H033.md, §8): cifra do telefone e chave ausente.
// Chave de teste montada em memoria por concatenacao (nao vem de .env). Telefones sinteticos (sentinela 98765).
import { describe, it, expect } from 'vitest';
import { createPhoneVault, PhoneCryptoError } from '../src/contact/phone-crypto.js';

const CHAVE_TESTE = ['chave', '-de-teste-', 'h033-', '0123456789', 'abcdefghij'].join('');
const CHAVE_OUTRA = ['outra', '-chave-', 'h033-', '0123456789', 'abcdefghij'].join('');
const PEDIDO_A = '5f1d2c3a-0000-4000-8000-00000000000a';
const PEDIDO_B = '5f1d2c3a-0000-4000-8000-00000000000b';
const NUMEROS = ['+5511987654321', '+551187654321', '+5521912345678', '+5548999887766'];

describe('H033 contato | cifra do telefone', () => {
  it('T-17 | round-trip de varios numeros (13 e 14 caracteres) devolve o mesmo valor', () => {
    const cofre = createPhoneVault(CHAVE_TESTE);
    for (const numero of NUMEROS) {
      const blob = cofre.seal(numero, PEDIDO_A);
      expect(cofre.open(blob, PEDIDO_A)).toBe(numero);
    }
  });

  it('T-17 | open falha com AAD de outro pedido, byte alterado, versao 2 e chave errada, com erro fixo', () => {
    const cofre = createPhoneVault(CHAVE_TESTE);
    const blob = cofre.seal('+5511987654321', PEDIDO_A);

    expect(() => cofre.open(blob, PEDIDO_B)).toThrow(PhoneCryptoError);
    const alterado = Buffer.from(blob);
    alterado[alterado.length - 1] ^= 0x01;
    expect(() => cofre.open(alterado, PEDIDO_A)).toThrow('telefone_indisponivel');
    const versao2 = Buffer.from(blob);
    versao2[0] = 2;
    expect(() => cofre.open(versao2, PEDIDO_A)).toThrow('telefone_indisponivel');
    expect(() => createPhoneVault(CHAVE_OUTRA).open(blob, PEDIDO_A)).toThrow('telefone_indisponivel');
  });

  it('T-17 | o blob gravado nao contem o numero nem sua forma sem mascara', () => {
    const cofre = createPhoneVault(CHAVE_TESTE);
    const blob = cofre.seal('+5511987654321', PEDIDO_A).toString('latin1');
    expect(blob).not.toContain('11987654321');
    expect(blob).not.toContain('98765');
    expect(blob).not.toContain('+55');
  });

  it('T-17 | seal recusa entrada que nao esta em E.164', () => {
    const cofre = createPhoneVault(CHAVE_TESTE);
    expect(() => cofre.seal('(11) 98765-4321', PEDIDO_A)).toThrow('telefone_invalido');
  });

  it('T-18 | chave ausente ou curta e configuracao invalida (o cofre nao e montado)', () => {
    expect(() => createPhoneVault('')).toThrow('configuracao_cifra');
    expect(() => createPhoneVault(CHAVE_TESTE.slice(0, 31))).toThrow('configuracao_cifra');
  });
});
