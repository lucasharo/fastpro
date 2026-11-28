// Issue 56 (H-043) | Varredura dos textos do perfil publico (docs/factory/143-DESENHO-H043.md, §6.2; T43-05).
import { describe, expect, it } from 'vitest';
import { PUBLIC_PROFILE_FORBIDDEN_PHRASES, PUBLIC_PROFILE_TEXTS } from './index.js';

const LIMITACAO_EXATA =
  'Identidade verificada: este profissional apresentou documento oficial (CPF ou CNPJ) validado pela equipe do FastPro. O selo atesta apenas a conferência de identificação cadastral e não constitui garantia de qualidade, certificação técnica, recomendação ou cobertura securitária sobre os serviços prestados.';

describe('T43-05 texto do selo', () => {
  it('rotulo e texto de limitacao exatos', () => {
    expect(PUBLIC_PROFILE_TEXTS.rotuloSelo).toBe('Identidade verificada');
    expect(PUBLIC_PROFILE_TEXTS.textoLimitacaoSelo).toBe(LIMITACAO_EXATA);
  });

  it('o texto de limitacao nega garantia, certificacao e cobertura', () => {
    expect(PUBLIC_PROFILE_TEXTS.textoLimitacaoSelo).toContain('não constitui garantia');
  });

  it('nenhuma frase proibida aparece em nenhum texto do perfil', () => {
    const todos = Object.values(PUBLIC_PROFILE_TEXTS).join(' ').toLowerCase();
    for (const frase of PUBLIC_PROFILE_FORBIDDEN_PHRASES) {
      expect(todos.includes(frase.toLowerCase())).toBe(false);
    }
  });

  it('as palavras de garantia, certificacao e securitaria so aparecem dentro do texto de limitacao', () => {
    const fora = Object.entries(PUBLIC_PROFILE_TEXTS)
      .filter(([chave]) => chave !== 'textoLimitacaoSelo')
      .map(([, valor]) => valor.toLowerCase())
      .join(' ');
    for (const palavra of ['garantia', 'certificação', 'certificacao', 'securitária', 'securitaria']) {
      expect(fora.includes(palavra)).toBe(false);
    }
  });
});
