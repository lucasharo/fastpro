// Testes de caracterizacao do D-06 do runbook de incidente (H-114, Issue #123; desenho 165 §4 S3).
// Nao muda formato nem codigo de producao: prova o comportamento ATUAL de address-crypto,
// phone-crypto e webhook-signature, e marca as lacunas que o runbook precisa conhecer:
//   L-1 (D-06a): o leitor aceita somente o byte de versao 1 e nao tem identificador de chave;
//                nao existe janela de leitura com a chave anterior.
//   L-2 (D-06b): a verificacao do webhook aceita um unico segredo; nao existe janela com o anterior.
// Chaves e segredos sao sinteticos, marcados [TESTE-H114]. Nada chama rede.
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { createAddressVault, AddressCryptoError } from '../src/requests/address-crypto';
import { createPhoneVault } from '../src/contact/phone-crypto';
import { verificarAssinaturaMercadoPago } from '../src/billing/webhook-signature';

const CHAVE_A = '[TESTE-H114]-chave-sintetica-A-0123456789abcdefghijklmnop';
const CHAVE_B = '[TESTE-H114]-chave-sintetica-B-0123456789abcdefghijklmnop';
const PEDIDO = '[TESTE-H114]-pedido-0001';
const ENDERECO = 'Rua de Teste H114, 100 (sintetico)';

describe('D-06a: cifra de endereco e telefone (caracterizacao)', () => {
  it('V1: sela e abre com a mesma chave e o mesmo pedido', () => {
    const cofre = createAddressVault(CHAVE_A);
    const blob = cofre.seal(ENDERECO, PEDIDO);
    expect(blob[0]).toBe(1);
    expect(cofre.open(blob, PEDIDO)).toBe(ENDERECO);
  });

  it('L-1: byte de versao 2 e recusado (nao existe leitura de segunda versao)', () => {
    const cofre = createAddressVault(CHAVE_A);
    const blob = Buffer.from(cofre.seal(ENDERECO, PEDIDO));
    blob[0] = 2;
    expect(() => cofre.open(blob, PEDIDO)).toThrow(AddressCryptoError);
    try {
      cofre.open(blob, PEDIDO);
    } catch (e) {
      expect((e as AddressCryptoError).code).toBe('endereco_indisponivel');
    }
  });

  it('L-1: chave anterior nao decifra blob da chave nova (nao ha janela de leitura)', () => {
    const blob = createAddressVault(CHAVE_A).seal(ENDERECO, PEDIDO);
    expect(() => createAddressVault(CHAVE_B).open(blob, PEDIDO)).toThrow(AddressCryptoError);
  });

  it('AAD: blob de um pedido nao abre com outro pedido', () => {
    const cofre = createAddressVault(CHAVE_A);
    const blob = cofre.seal(ENDERECO, PEDIDO);
    expect(() => cofre.open(blob, '[TESTE-H114]-pedido-0002')).toThrow(AddressCryptoError);
  });

  it('chaves de endereco e de telefone sao separadas: blob de um nao abre no outro', () => {
    const blobEndereco = createAddressVault(CHAVE_A).seal(ENDERECO, PEDIDO);
    const cofreFone = createPhoneVault(CHAVE_A);
    expect(() => cofreFone.open(blobEndereco, PEDIDO)).toThrow();
  });

  it('telefone: V1 sela e abre; byte de versao 2 e recusado', () => {
    const cofre = createPhoneVault(CHAVE_A);
    // Telefone sintetico ja em E.164 (o cofre recusa formato fora dessa forma).
    const fone = '+5511912345678';
    const blob = Buffer.from(cofre.seal(fone, PEDIDO));
    expect(blob[0]).toBe(1);
    expect(cofre.open(blob, PEDIDO)).toBe(fone);
    blob[0] = 2;
    expect(() => cofre.open(blob, PEDIDO)).toThrow();
  });
});

describe('D-06b: assinatura do webhook (caracterizacao)', () => {
  // Identificador alfanumerico (o modulo so minusculiza dataId alfanumerico).
  const DATA_ID = 'TESTEH114ABC123';
  const REQUEST_ID = '[TESTE-H114]-req-0001';
  const TS = '1763640000';

  function assinar(segredo: string): string {
    const manifesto = `id:${DATA_ID.toLowerCase()};request-id:${REQUEST_ID};ts:${TS};`;
    const hex = createHmac('sha256', segredo).update(manifesto).digest('hex');
    return `ts=${TS},v1=${hex}`;
  }

  it('aceita assinatura feita com o segredo configurado', () => {
    expect(
      verificarAssinaturaMercadoPago({
        secret: CHAVE_A,
        xSignature: assinar(CHAVE_A),
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
      }),
    ).toBe(true);
  });

  it('L-2: assinatura feita com o segredo anterior e recusada (nao ha janela de dois segredos)', () => {
    expect(
      verificarAssinaturaMercadoPago({
        secret: CHAVE_B,
        xSignature: assinar(CHAVE_A),
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
      }),
    ).toBe(false);
  });

  it('sem segredo configurado a verificacao falha fechada', () => {
    expect(
      verificarAssinaturaMercadoPago({
        secret: undefined,
        xSignature: assinar(CHAVE_A),
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
      }),
    ).toBe(false);
  });
});
