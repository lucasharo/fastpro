// Testes unitarios de redacao do runbook de incidente (H-114, Issue #123; desenho 165 §5 CA-17).
// Offline: sem banco, sem rede. Entradas sinteticas marcadas com [TESTE-H114].
import { describe, it, expect } from 'vitest';
import {
  MARCADOR_TESTE,
  TEXTO_LIVRE_REMOVIDO,
  mascararEmail,
  mascararDocumento,
  mascararTelefone,
  redactForRunbook,
  redigirTexto,
} from '../scripts/lib/runbook-h114.mjs';
import {
  ACHADOS_RMP_SINTETICOS,
  PII_SINTETICA,
  RELATORIO_INCIDENTE_SINTETICO,
} from './fixtures/runbook-h114-fixtures.mjs';

// Padroes que nunca podem aparecer em claro numa saida (CA-17).
const RE_EMAIL_CLARO = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const RE_CPF_CNPJ_CLARO = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/;
const RE_TELEFONE_CLARO = /\+55|\(\d{2}\)\s?\d{4,5}-\d{4}/;

describe('mascaramento de cada tipo de dado', () => {
  it('e-mail vira u***@d***.tld, no formato do runbook', () => {
    expect(mascararEmail(PII_SINTETICA.email)).toBe('t***@e***.invalid');
  });

  it('CPF e CNPJ mantem so os 4 ultimos digitos', () => {
    expect(mascararDocumento(PII_SINTETICA.cpf)).toBe('***8909');
    expect(mascararDocumento(PII_SINTETICA.cnpj)).toBe('***0195');
  });

  it('telefone mantem so os 2 ultimos digitos', () => {
    expect(mascararTelefone(PII_SINTETICA.telefone)).toBe('***78');
  });
});

describe('redigirTexto', () => {
  it('substitui e-mail, documento e telefone em um texto livre', () => {
    const entrada = `contato ${PII_SINTETICA.email}, cpf ${PII_SINTETICA.cpf}, fone ${PII_SINTETICA.telefone}`;
    const saida = redigirTexto(entrada);
    expect(saida).not.toMatch(RE_EMAIL_CLARO);
    expect(saida).not.toMatch(RE_CPF_CNPJ_CLARO);
    expect(saida).not.toMatch(RE_TELEFONE_CLARO);
    expect(saida).toContain('t***@e***.invalid');
  });

  it('e idempotente: redigir de novo nao muda o resultado', () => {
    const uma = redigirTexto(PII_SINTETICA.email);
    expect(redigirTexto(uma)).toBe(uma);
  });

  it('nao mexe em texto sem dado pessoal', () => {
    expect(redigirTexto(`${MARCADOR_TESTE} rota de teste`)).toBe(`${MARCADOR_TESTE} rota de teste`);
  });
});

describe('redactForRunbook sobre estruturas', () => {
  it('nao altera a entrada (copia profunda antes e depois)', () => {
    const entrada = JSON.parse(JSON.stringify(RELATORIO_INCIDENTE_SINTETICO));
    const antes = JSON.stringify(entrada);
    redactForRunbook(entrada);
    expect(JSON.stringify(entrada)).toBe(antes);
  });

  it('CA-17: nenhuma saida do relatorio sintetico contem e-mail, telefone ou CPF em claro', () => {
    const saida = JSON.stringify(redactForRunbook(RELATORIO_INCIDENTE_SINTETICO));
    expect(saida).not.toMatch(RE_EMAIL_CLARO);
    expect(saida).not.toMatch(RE_CPF_CNPJ_CLARO);
    expect(saida).not.toMatch(RE_TELEFONE_CLARO);
  });

  it('CA-17: nenhuma saida dos achados R-MP sinteticos contem PII em claro', () => {
    const saida = JSON.stringify(redactForRunbook(ACHADOS_RMP_SINTETICOS));
    expect(saida).not.toMatch(RE_EMAIL_CLARO);
    expect(saida).not.toMatch(RE_TELEFONE_CLARO);
  });

  it('campos de texto livre perdem o valor inteiro', () => {
    const saida = redactForRunbook(RELATORIO_INCIDENTE_SINTETICO);
    expect(saida.descricao).toBe(TEXTO_LIVRE_REMOVIDO);
  });

  it('o marcador [TESTE-H114] e preservado (nao e dado pessoal)', () => {
    const saida = redactForRunbook(RELATORIO_INCIDENTE_SINTETICO);
    expect(saida.titulo).toContain(MARCADOR_TESTE);
    expect(saida.responsavel.nome).toContain(MARCADOR_TESTE);
  });

  it('valores nao textuais passam sem alteracao; datas viram ISO 8601 UTC', () => {
    const saida = redactForRunbook({
      contagemTitulares: 2,
      ativo: true,
      nulo: null,
      quando: new Date('2026-11-20T12:00:00.000Z'),
      lista: [1, 'x'],
    });
    expect(saida).toEqual({
      contagemTitulares: 2,
      ativo: true,
      nulo: null,
      quando: '2026-11-20T12:00:00.000Z',
      lista: [1, 'x'],
    });
  });

  it('e idempotente sobre o relatorio inteiro', () => {
    const uma = redactForRunbook(RELATORIO_INCIDENTE_SINTETICO);
    expect(redactForRunbook(uma)).toEqual(uma);
  });
});
