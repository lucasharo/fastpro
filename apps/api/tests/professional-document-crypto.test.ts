// H-035 | Cifra e HMAC do documento do profissional (docs/factory/75-DESENHO-H035.md §1; CA-08, CA-09).
// Chaves sinteticas geradas no teste. Sem banco, sem rede. Nenhuma asserção imprime chave ou documento.
import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  ProfessionalDocumentCryptoError,
  createProfessionalDocumentVault,
  loadProfessionalDocumentVault,
} from '../src/professional-document-crypto.js';

const chave = (): Buffer => randomBytes(32);
const curta = Buffer.alloc(16);
const pq = Buffer.alloc(8).toString('base64');
const DIGITOS = '12345678909';
const USUARIO_A = '6f1c2e0a-1111-4a2b-8c3d-000000000001';
const USUARIO_B = '6f1c2e0a-1111-4a2b-8c3d-000000000002';

function vaultPadrao(overrides: Partial<{ hmacKey: Buffer; activeVersion: number; enc: Map<number, Buffer> }> = {}) {
  return createProfessionalDocumentVault({
    hmacKey: overrides.hmacKey ?? chave(),
    activeVersion: overrides.activeVersion ?? 1,
    encKeys: overrides.enc ?? new Map([[1, chave()]]),
  });
}

function codigoDe(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (erro) {
    return erro instanceof ProfessionalDocumentCryptoError ? erro.code : 'outro';
  }
}

describe('T-H035-CIFRA ida e volta e formato (CA-08)', () => {
  it('decifra o que cifrou para o mesmo dono (roundtrip)', () => {
    const v = vaultPadrao();
    const blob = v.encrypt(USUARIO_A, DIGITOS);
    expect(v.open(USUARIO_A, blob)).toBe(DIGITOS);
  });

  it('o primeiro byte e a versao da chave e o blob nao contem os digitos em claro', () => {
    const v = vaultPadrao({ activeVersion: 3, enc: new Map([[3, chave()]]) });
    const blob = v.encrypt(USUARIO_A, DIGITOS);
    expect(blob[0]).toBe(3);
    expect(blob.toString('latin1').includes(DIGITOS)).toBe(false);
    expect(blob.toString('utf8').includes(DIGITOS)).toBe(false);
    expect(blob.length).toBe(1 + 12 + 16 + DIGITOS.length);
  });

  it('cada cifragem usa nonce novo (dois blobs do mesmo numero diferem)', () => {
    const v = vaultPadrao();
    expect(v.encrypt(USUARIO_A, DIGITOS).equals(v.encrypt(USUARIO_A, DIGITOS))).toBe(false);
  });
});

describe('T-H035-CIFRA AAD e chave errada', () => {
  it('AAD de outro user_id falha na decifragem', () => {
    const v = vaultPadrao();
    const blob = v.encrypt(USUARIO_A, DIGITOS);
    expect(codigoDe(() => v.open(USUARIO_B, blob))).toBe('documento_indisponivel');
  });

  it('chave errada (outro vault com a mesma versao) falha, sem vazar valor', () => {
    const cifrador = vaultPadrao();
    const outro = vaultPadrao();
    const blob = cifrador.encrypt(USUARIO_A, DIGITOS);
    expect(codigoDe(() => outro.open(USUARIO_A, blob))).toBe('documento_indisponivel');
  });

  it('blob adulterado (um bit do corpo) falha', () => {
    const v = vaultPadrao();
    const blob = v.encrypt(USUARIO_A, DIGITOS);
    blob[blob.length - 1] ^= 0x01;
    expect(codigoDe(() => v.open(USUARIO_A, blob))).toBe('documento_indisponivel');
  });

  it('versao desconhecida no primeiro byte falha', () => {
    const v = vaultPadrao();
    const blob = v.encrypt(USUARIO_A, DIGITOS);
    blob[0] = 9;
    expect(codigoDe(() => v.open(USUARIO_A, blob))).toBe('documento_indisponivel');
  });
});

describe('T-H035-CIFRA configuracao (sem valor em erro)', () => {
  it('chave de cifra da versao ativa ausente gera erro de configuracao', () => {
    expect(codigoDe(() => createProfessionalDocumentVault({ hmacKey: chave(), activeVersion: 2, encKeys: new Map([[1, chave()]]) }))).toBe(
      'configuracao_cifra',
    );
  });

  it('HMAC com tamanho errado gera erro de configuracao', () => {
    expect(codigoDe(() => createProfessionalDocumentVault({ hmacKey: curta, activeVersion: 1, encKeys: new Map([[1, chave()]]) }))).toBe(
      'configuracao_cifra',
    );
  });

  it('carregador do ambiente: falta da chave HMAC, versao invalida ou chave de tamanho errado', () => {
    const b64 = chave().toString('base64');
    expect(codigoDe(() => loadProfessionalDocumentVault({ DATA_ENC_KEY_V1: b64, DATA_ENC_KEY_ACTIVE_VERSION: '1' }))).toBe(
      'configuracao_cifra',
    );
    expect(
      codigoDe(() =>
        loadProfessionalDocumentVault({ DOCUMENT_HMAC_KEY: b64, DATA_ENC_KEY_V1: b64, DATA_ENC_KEY_ACTIVE_VERSION: '0' }),
      ),
    ).toBe('configuracao_cifra');
    expect(
      codigoDe(() =>
        loadProfessionalDocumentVault({
          DOCUMENT_HMAC_KEY: b64,
          DATA_ENC_KEY_V1: pq,
          DATA_ENC_KEY_ACTIVE_VERSION: '1',
        }),
      ),
    ).toBe('configuracao_cifra');
  });

  it('erro de configuracao nao carrega o valor da chave', () => {
    const segredo = Buffer.alloc(8, 7).toString('base64');
    try {
      loadProfessionalDocumentVault({ DOCUMENT_HMAC_KEY: segredo, DATA_ENC_KEY_V1: segredo, DATA_ENC_KEY_ACTIVE_VERSION: '1' });
      throw new Error('deveria falhar');
    } catch (erro) {
      expect(String((erro as Error).message)).not.toContain(segredo);
      expect((erro as ProfessionalDocumentCryptoError).code).toBe('configuracao_cifra');
    }
  });

  it('rotacao: blob de versao antiga continua aberto quando a chave antiga esta no ambiente', () => {
    const hmac = chave().toString('base64');
    const v1 = chave();
    const v2 = chave();
    const v1b64 = v1.toString('base64');
    const v2b64 = v2.toString('base64');
    const antigo = loadProfessionalDocumentVault({
      DOCUMENT_HMAC_KEY: hmac,
      DATA_ENC_KEY_V1: v1b64,
      DATA_ENC_KEY_ACTIVE_VERSION: '1',
    });
    const blobAntigo = antigo.encrypt(USUARIO_A, DIGITOS);
    const novo = loadProfessionalDocumentVault({
      DOCUMENT_HMAC_KEY: hmac,
      DATA_ENC_KEY_V1: v1b64,
      DATA_ENC_KEY_V2: v2b64,
      DATA_ENC_KEY_ACTIVE_VERSION: '2',
    });
    expect(novo.activeVersion).toBe(2);
    expect(novo.open(USUARIO_A, blobAntigo)).toBe(DIGITOS);
    expect(novo.encrypt(USUARIO_A, DIGITOS)[0]).toBe(2);
  });
});

describe('T-H035-HMAC identificador estavel (CA-04, CA-09)', () => {
  it('mesmo segredo e mesmo documento geram o mesmo HMAC (estavel), em 64 caracteres hex', () => {
    const hmacKey = chave();
    const v = vaultPadrao({ hmacKey });
    const h1 = v.hmac('CPF', DIGITOS);
    const h2 = createProfessionalDocumentVault({ hmacKey, activeVersion: 1, encKeys: new Map([[1, chave()]]) }).hmac(
      'CPF',
      DIGITOS,
    );
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(h2);
  });

  it('outro segredo de servidor gera outro HMAC para o mesmo numero (CA-09)', () => {
    const a = vaultPadrao({ hmacKey: chave() }).hmac('CPF', DIGITOS);
    const b = vaultPadrao({ hmacKey: chave() }).hmac('CPF', DIGITOS);
    expect(a).not.toBe(b);
  });

  it('tipo diferente gera HMAC diferente (CPF e CNPJ nao colidem)', () => {
    const v = vaultPadrao();
    expect(v.hmac('CPF', DIGITOS)).not.toBe(v.hmac('CNPJ', DIGITOS));
  });

  it('HMAC recusa entrada que nao seja so digitos', () => {
    const v = vaultPadrao();
    expect(codigoDe(() => v.hmac('CPF', '123.456.789-09'))).toBe('documento_indisponivel');
  });
});
