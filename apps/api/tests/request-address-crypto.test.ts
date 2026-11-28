// Issue 45 (H-032) | Cifra do endereco do pedido (docs/factory/127-DESENHO-H032.md, §3; T-12 e T-13).
// Chave de teste montada em memoria: nunca vem de .env.local nem de variavel real.
import { describe, expect, it } from 'vitest';
import { AddressCryptoError, createAddressVault } from '../src/requests/address-crypto.js';

const CHAVE_TESTE = 'chave-de-teste-h032-somente-em-memoria-0123456789';
const CHAVE_OUTRA = 'outra-chave-de-teste-h032-em-memoria-9876543210';
const PEDIDO = '6f1c2a3e-1111-4222-8333-444455556666';
const OUTRO_PEDIDO = '6f1c2a3e-1111-4222-8333-444455557777';

function codigo(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (erro) {
    return erro instanceof AddressCryptoError ? erro.code : 'erro_inesperado';
  }
}

describe('cifra do endereco (T-12, CA-12)', () => {
  const vault = createAddressVault(CHAVE_TESTE);

  it('ida e volta com UTF-8, acentos e tamanhos de 3 e 200 caracteres', () => {
    const textos = [
      'Rua Sintetica 100, Vila Mariana, Sao Paulo - SP',
      'Avenida Ação 7, Jacarepaguá - RJ',
      'abc',
      'x'.repeat(200),
    ];
    for (const t of textos) {
      const blob = vault.seal(t, PEDIDO);
      expect(vault.open(blob, PEDIDO)).toBe(t.normalize('NFC'));
    }
  });

  it('o blob comeca com a versao 1 e nao contem o texto em claro', () => {
    const blob = vault.seal('Rua Sintetica 100, Sao Paulo - SP', PEDIDO);
    expect(blob[0]).toBe(1);
    expect(blob.includes(Buffer.from('Rua Sintetica 100'))).toBe(false);
  });

  it('nonce novo a cada gravacao: dois selos do mesmo texto nao repetem o blob', () => {
    const a = vault.seal('Rua Sintetica 100, Sao Paulo - SP', PEDIDO);
    const b = vault.seal('Rua Sintetica 100, Sao Paulo - SP', PEDIDO);
    expect(Buffer.compare(a, b)).not.toBe(0);
  });

  it('AAD: decifrar com outro id de pedido falha com codigo fixo', () => {
    const blob = vault.seal('Rua Sintetica 100, Sao Paulo - SP', PEDIDO);
    expect(codigo(() => vault.open(blob, OUTRO_PEDIDO))).toBe('endereco_indisponivel');
  });

  it('byte alterado, versao desconhecida e chave diferente falham com o mesmo codigo fixo', () => {
    const blob = Buffer.from(vault.seal('Rua Sintetica 100, Sao Paulo - SP', PEDIDO));
    const alterado = Buffer.from(blob);
    alterado[alterado.length - 1] = (alterado[alterado.length - 1] ?? 0) ^ 0xff;
    expect(codigo(() => vault.open(alterado, PEDIDO))).toBe('endereco_indisponivel');
    const versao2 = Buffer.from(blob);
    versao2[0] = 2;
    expect(codigo(() => vault.open(versao2, PEDIDO))).toBe('endereco_indisponivel');
    const outra = createAddressVault(CHAVE_OUTRA);
    expect(codigo(() => outra.open(blob, PEDIDO))).toBe('endereco_indisponivel');
  });

  it('texto fora de 3 a 200 caracteres e recusado antes da cifra', () => {
    expect(codigo(() => vault.seal('ab', PEDIDO))).toBe('endereco_invalido');
    expect(codigo(() => vault.seal('x'.repeat(201), PEDIDO))).toBe('endereco_invalido');
  });
});

describe('chave ausente ou curta (T-13, CA-12)', () => {
  it('chave com menos de 32 caracteres ou vazia e configuracao invalida, sem o valor no erro', () => {
    for (const ruim of ['', 'curta', 'x'.repeat(31)]) {
      const erro = (() => {
        try {
          createAddressVault(ruim);
          return null;
        } catch (e) {
          return e;
        }
      })();
      expect(erro).toBeInstanceOf(AddressCryptoError);
      expect((erro as AddressCryptoError).code).toBe('configuracao_cifra');
      expect((erro as Error).message).not.toContain(ruim === '' ? 'nunca' : ruim);
    }
  });

  it('chave de 32 caracteres ou mais e aceita', () => {
    expect(() => createAddressVault('x'.repeat(32))).not.toThrow();
  });
});
