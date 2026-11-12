// H-035 | Testes puros do documento (CPF/CNPJ), do nome publico e do slug (docs/factory/75-DESENHO-H035.md §1;
// CA-01 a CA-04). Valores sinteticos e de dominio publico (digitos verificadores validos conhecidos).
import { describe, it, expect } from 'vitest';
import {
  checkProfessionalDocument,
  checkProfessionalProfileInput,
  checkPublicName,
  slugBaseFromName,
  stripDocumentMask,
} from '../src/identity/index.js';

const CPF_OK = '52998224725';
const CPF_OK_MASCARA = '529.982.247-25';
const CPF_CA04 = '123.456.789-09';
const CNPJ_OK = '11222333000181';
const CNPJ_OK_MASCARA = '11.222.333/0001-81';

describe('T-H035-DOC CPF (CA-01, CA-03, CA-04)', () => {
  it('aceita CPF valido com e sem mascara, com o mesmo digitos normalizados (CA-04)', () => {
    expect(checkProfessionalDocument('CPF', CPF_OK)).toEqual({ ok: true, digits: CPF_OK });
    expect(checkProfessionalDocument('CPF', CPF_OK_MASCARA)).toEqual({ ok: true, digits: CPF_OK });
    expect(checkProfessionalDocument('CPF', CPF_CA04)).toEqual({ ok: true, digits: '12345678909' });
    expect(checkProfessionalDocument('CPF', '12345678909')).toEqual({ ok: true, digits: '12345678909' });
  });

  it('recusa digito verificador errado (CA-03)', () => {
    expect(checkProfessionalDocument('CPF', '52998224726')).toEqual({ ok: false, reason: 'digito_verificador' });
    expect(checkProfessionalDocument('CPF', '123.456.789-10')).toEqual({ ok: false, reason: 'digito_verificador' });
  });

  it('recusa tamanho errado, com 10 digitos (CA-03) ou 12', () => {
    expect(checkProfessionalDocument('CPF', '1234567890')).toEqual({ ok: false, reason: 'tamanho' });
    expect(checkProfessionalDocument('CPF', '123456789090')).toEqual({ ok: false, reason: 'tamanho' });
  });

  it('recusa sequencias repetidas mesmo com digitos que fechariam o calculo', () => {
    for (const repetido of ['00000000000', '11111111111', '22222222222', '99999999999']) {
      expect(checkProfessionalDocument('CPF', repetido)).toEqual({ ok: false, reason: 'sequencia_repetida' });
    }
    expect(checkProfessionalDocument('CPF', '111.111.111-11')).toEqual({ ok: false, reason: 'sequencia_repetida' });
  });

  it('recusa letras e caracteres fora da mascara', () => {
    expect(checkProfessionalDocument('CPF', '1234567890a')).toEqual({ ok: false, reason: 'formato' });
    expect(checkProfessionalDocument('CPF', '123.456.789(09)')).toEqual({ ok: false, reason: 'formato' });
    expect(checkProfessionalDocument('CPF', '')).toEqual({ ok: false, reason: 'formato' });
    expect(checkProfessionalDocument('CPF', 12345678909)).toEqual({ ok: false, reason: 'formato' });
  });
});

describe('T-H035-DOC CNPJ (CA-02, CA-03)', () => {
  it('aceita CNPJ valido com e sem mascara', () => {
    expect(checkProfessionalDocument('CNPJ', CNPJ_OK)).toEqual({ ok: true, digits: CNPJ_OK });
    expect(checkProfessionalDocument('CNPJ', CNPJ_OK_MASCARA)).toEqual({ ok: true, digits: CNPJ_OK });
  });

  it('recusa digito verificador errado e tamanho errado', () => {
    expect(checkProfessionalDocument('CNPJ', '11222333000182')).toEqual({ ok: false, reason: 'digito_verificador' });
    expect(checkProfessionalDocument('CNPJ', '1122233300018')).toEqual({ ok: false, reason: 'tamanho' });
    expect(checkProfessionalDocument('CNPJ', '11111111111111')).toEqual({ ok: false, reason: 'sequencia_repetida' });
  });

  it('CNPJ alfanumerico fica fora (D2): letras sao recusadas como formato', () => {
    expect(checkProfessionalDocument('CNPJ', '1122233300018A')).toEqual({ ok: false, reason: 'formato' });
  });
});

describe('T-H035-DOC mascara e formato', () => {
  it('stripDocumentMask tira so ponto, traco, barra e espaco', () => {
    expect(stripDocumentMask(' 11.222.333/0001-81 ')).toBe('11222333000181');
    expect(stripDocumentMask('1_2')).toBe('1_2');
  });
});

describe('T-H035-NOME nome publico e slug', () => {
  it('aplica trim e limites de 2 a 80 caracteres', () => {
    expect(checkPublicName('  Ana  ')).toEqual({ ok: true, value: 'Ana' });
    expect(checkPublicName('A')).toEqual({ ok: false, reason: 'tamanho' });
    expect(checkPublicName('   ')).toEqual({ ok: false, reason: 'obrigatorio' });
    expect(checkPublicName(undefined)).toEqual({ ok: false, reason: 'obrigatorio' });
    expect(checkPublicName('a'.repeat(80))).toEqual({ ok: true, value: 'a'.repeat(80) });
    expect(checkPublicName('a'.repeat(81))).toEqual({ ok: false, reason: 'tamanho' });
  });

  it('conta caracteres e nao bytes ao medir o nome', () => {
    expect(checkPublicName('ç'.repeat(80))).toEqual({ ok: true, value: 'ç'.repeat(80) });
  });

  it('gera slug sem acento, em minusculo e com traco; nome sem letras cai em profissional', () => {
    expect(slugBaseFromName('José  da Silva!')).toBe('jose-da-silva');
    expect(slugBaseFromName('  --  ')).toBe('profissional');
    expect(slugBaseFromName('A'.repeat(100)).length).toBeLessThanOrEqual(60);
  });
});

describe('T-H035-FORMA entrada do PUT', () => {
  it('aceita o corpo completo e devolve so digitos', () => {
    expect(
      checkProfessionalProfileInput({ publicName: ' Ana Lima ', documentType: 'CPF', document: CPF_OK_MASCARA }),
    ).toEqual({
      ok: true,
      value: { publicName: 'Ana Lima', documentType: 'CPF', digits: CPF_OK },
    });
  });

  it('lista os campos com erro, sem eco do valor', () => {
    const r = checkProfessionalProfileInput({ publicName: 'A', documentType: 'RG', document: 'segredo-123' });
    expect(r).toEqual({
      ok: false,
      fields: [
        { field: 'publicName', reason: 'tamanho' },
        { field: 'documentType', reason: 'tipo_invalido' },
      ],
    });
    expect(JSON.stringify(r)).not.toContain('segredo-123');
  });

  it('documento invalido aparece como campo document', () => {
    const r = checkProfessionalProfileInput({ publicName: 'Ana', documentType: 'CPF', document: '52998224726' });
    expect(r).toEqual({ ok: false, fields: [{ field: 'document', reason: 'digito_verificador' }] });
  });

  it('corpo que nao e objeto acusa todos os campos', () => {
    const r = checkProfessionalProfileInput('texto');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fields.map((f) => f.field)).toEqual(['publicName', 'documentType']);
  });
});
