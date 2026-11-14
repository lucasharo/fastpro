// Issue 37 (H-024) | Campo booleano do dono e textos [PROPOSTA] (regras puras; sem banco, sem rede).
import { describe, expect, it } from 'vitest';
import { COVERAGE_TEXTS_PROPOSTA, coverageFlag, coverageIsOpen, type CoverageResult } from '../src/coverage/coverage-rules.js';
import { ELIGIBLE_PROFESSIONAL_KEYS, OWNER_KEYS } from '../src/request/visibility.js';

const AGORA = Date.UTC(2026, 10, 14, 12, 0, 0);
const PRAZO = AGORA + 3600_000;

describe('campo cobertura do dono (CA-01, CA-02, CA-07, CA-08)', () => {
  it('com vira true; sem vira false; limite e indisponivel viram null (sem detalhe)', () => {
    const casos: Array<[CoverageResult, boolean | null]> = [
      ['com', true],
      ['sem', false],
      ['limite', null],
      ['indisponivel', null],
    ];
    for (const [resultado, esperado] of casos) expect(coverageFlag(resultado), resultado).toBe(esperado);
  });

  it('pedido aberto: publicado e antes do prazo; qualquer outro estado ou prazo vencido nao e aberto', () => {
    expect(coverageIsOpen('publicado', PRAZO, AGORA)).toBe(true);
    expect(coverageIsOpen('publicado', PRAZO, PRAZO)).toBe(false);
    expect(coverageIsOpen('publicado', PRAZO, PRAZO + 1)).toBe(false);
    for (const estado of ['selecionado', 'concluido', 'cancelado', 'rascunho']) {
      expect(coverageIsOpen(estado, PRAZO, AGORA), estado).toBe(false);
    }
    expect(coverageIsOpen('publicado', Number.NaN, AGORA)).toBe(false);
  });

  it('cobertura existe na lista do dono e nunca na lista do profissional', () => {
    expect(OWNER_KEYS.filter((chave) => chave === 'cobertura')).toHaveLength(1);
    expect(ELIGIBLE_PROFESSIONAL_KEYS).not.toContain('cobertura');
  });
});

describe('textos da cobertura [PROPOSTA] (CA-11, pendente de BK-5)', () => {
  it('existem os dois textos, sem numero, sem arroba e sem promessa de aviso por e-mail', () => {
    for (const texto of [COVERAGE_TEXTS_PROPOSTA.true, COVERAGE_TEXTS_PROPOSTA.false]) {
      expect(texto.length).toBeGreaterThan(0);
      expect(texto).not.toMatch(/[0-9@]/);
      expect(texto.toLowerCase()).not.toContain('e-mail');
      expect(texto.toLowerCase()).not.toContain('avisaremos');
    }
  });
});
