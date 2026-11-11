// H-016 | Testes puros da politica de senha do profissional (docs/factory/33-DESENHO-H016.md §3.1;
// CA-H016-03, CA-H016-04; T-H016-03). Sem rede, sem banco. Senhas e e-mails sao sinteticos.
import { describe, it, expect } from 'vitest';
import {
  PROFESSIONAL_COMMON_PASSWORDS,
  PROFESSIONAL_PASSWORD_MAX_BYTES,
  PROFESSIONAL_PASSWORD_MIN_CHARS,
  professionalPasswordProblem,
} from '../src/identity/index.js';

const EMAIL = 'pessoa.sintetica@example.test';

describe('T-H016-03 politica de senha do profissional (CA-H016-03)', () => {
  it('aceita senha com 8 caracteres que nao esta na lista', () => {
    expect(PROFESSIONAL_PASSWORD_MIN_CHARS).toBe(8);
    expect(professionalPasswordProblem('Tr4ns-Lamp', EMAIL)).toBeNull();
  });

  it('recusa senha com 7 caracteres como curta', () => {
    expect(professionalPasswordProblem('Tr4nsLa', EMAIL)).toBe('curta');
    expect(professionalPasswordProblem('', EMAIL)).toBe('curta');
  });

  it('conta caracteres e nao bytes: 8 letras acentuadas passam, 7 nao', () => {
    expect(professionalPasswordProblem('ação1234', EMAIL)).toBeNull();
    expect(professionalPasswordProblem('ação123', EMAIL)).toBe('curta');
  });

  it('teto de 72 bytes UTF-8: 36 acentos (72 bytes) passam e 37 (74 bytes) sao recusados', () => {
    expect(PROFESSIONAL_PASSWORD_MAX_BYTES).toBe(72);
    expect(professionalPasswordProblem('ç'.repeat(36), EMAIL)).toBeNull();
    expect(professionalPasswordProblem('ç'.repeat(37), EMAIL)).toBe('longa');
    expect(professionalPasswordProblem('a'.repeat(73), EMAIL)).toBe('longa');
  });

  it('recusa caracteres de controle (ex.: quebra de linha e tabulacao)', () => {
    expect(professionalPasswordProblem('abcd\nefgh1', EMAIL)).toBe('controle');
    expect(professionalPasswordProblem('abcd\tefgh1', EMAIL)).toBe('controle');
  });

  it('recusa senha igual ao e-mail, sem diferenciar caixa nem espacos nas bordas', () => {
    const email = 'Pessoa.Sintetica@Example.test';
    expect(professionalPasswordProblem('pessoa.sintetica@example.test', email)).toBe('igual_email');
    expect(professionalPasswordProblem(' PESSOA.SINTETICA@EXAMPLE.TEST ', email)).toBe('igual_email');
  });

  it('recusa senhas da lista comum, sem diferenciar caixa', () => {
    expect(professionalPasswordProblem('password', EMAIL)).toBe('comum');
    expect(professionalPasswordProblem('password123', EMAIL)).toBe('comum');
    expect(professionalPasswordProblem('PASSWORD123', EMAIL)).toBe('comum');
    expect(professionalPasswordProblem('Senha1234', EMAIL)).toBe('comum');
  });

  it('recusa valor que nao e texto, sem eco do valor', () => {
    expect(professionalPasswordProblem(12345678, EMAIL)).toBe('tipo');
    expect(professionalPasswordProblem(undefined, EMAIL)).toBe('tipo');
    expect(professionalPasswordProblem(null, EMAIL)).toBe('tipo');
  });

  it('a lista local tem itens minusculos, com 8 caracteres ou mais, e sem repeticao', () => {
    const itens = [...PROFESSIONAL_COMMON_PASSWORDS];
    expect(itens.length).toBeGreaterThan(50);
    for (const item of itens) {
      expect(item).toBe(item.toLowerCase());
      expect(item.length).toBeGreaterThanOrEqual(8);
    }
  });
});
