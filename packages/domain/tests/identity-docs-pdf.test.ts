// H-037 (Issue #50) | T-22: validador de PDF (107 §6.2, §13). PDFs sinteticos gerados no proprio teste (ADR-016).
import { describe, expect, it } from 'vitest';
import { validarPdf } from '../src/identity-docs/pdf.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function pdf(corpo: string, cabecalho = '%PDF-1.7\n', fim = '\n%%EOF\n'): Uint8Array {
  return enc(cabecalho + corpo + fim);
}

describe('H-037 | T-22 validarPdf: estrutura minima (CA-02, CA-04)', () => {
  it('aceita PDF minimo nas versoes 1.0 a 1.7 e 2.0', () => {
    for (const v of ['1.0', '1.4', '1.7', '2.0']) {
      expect(validarPdf(pdf('1 0 obj<<>>endobj\n', `%PDF-${v}\n`))).toEqual({ ok: true });
    }
  });

  it('recusa entrada vazia e de 1 byte sem lancar excecao', () => {
    expect(validarPdf(new Uint8Array(0))).toEqual({ ok: false, code: 'pdf_invalido' });
    expect(validarPdf(new Uint8Array([0x25]))).toEqual({ ok: false, code: 'pdf_invalido' });
  });

  it('recusa lixo antes do cabecalho (poliglota) e cabecalho deslocado', () => {
    expect(validarPdf(pdf('x', 'lixo %PDF-1.7\n'))).toEqual({ ok: false, code: 'pdf_invalido' });
    expect(validarPdf(pdf('x', ' %PDF-1.7\n'))).toEqual({ ok: false, code: 'pdf_invalido' });
  });

  it('recusa versao invalida', () => {
    expect(validarPdf(pdf('x', '%PDF-1.9\n'))).toEqual({ ok: false, code: 'pdf_invalido' });
    expect(validarPdf(pdf('x', '%PDF-3.0\n'))).toEqual({ ok: false, code: 'pdf_invalido' });
  });

  it('recusa PDF sem %%EOF e com %%EOF fora dos ultimos 1.024 bytes', () => {
    expect(validarPdf(enc('%PDF-1.7\n1 0 obj<<>>endobj\n'))).toEqual({ ok: false, code: 'pdf_invalido' });
    const longe = '%%EOF\n' + 'a'.repeat(2000);
    expect(validarPdf(enc('%PDF-1.7\n' + longe))).toEqual({ ok: false, code: 'pdf_invalido' });
  });
});

describe('H-037 | T-22 validarPdf: senha e acao embutida (decisoes 177, 178, 224)', () => {
  it('recusa PDF protegido por senha (/Encrypt, inclusive com escape #xx)', () => {
    expect(validarPdf(pdf('trailer<</Encrypt 5 0 R>>'))).toEqual({ ok: false, code: 'pdf_protegido' });
    expect(validarPdf(pdf('trailer<</Encr#79pt 5 0 R>>'))).toEqual({ ok: false, code: 'pdf_protegido' });
  });

  it('recusa acao embutida: JavaScript, JS, Launch, EmbeddedFile, GoToR', () => {
    expect(validarPdf(pdf('<</S/JavaScript>>'))).toEqual({ ok: false, code: 'pdf_ativo' });
    expect(validarPdf(pdf('<</S /JS /JS (x)>>'))).toEqual({ ok: false, code: 'pdf_ativo' });
    expect(validarPdf(pdf('<</S/Launch>>'))).toEqual({ ok: false, code: 'pdf_ativo' });
    expect(validarPdf(pdf('<</Type/EmbeddedFile>>'))).toEqual({ ok: false, code: 'pdf_ativo' });
    expect(validarPdf(pdf('<</S/GoToR>>'))).toEqual({ ok: false, code: 'pdf_ativo' });
  });

  it('decodifica escape de nome: /J#61vaScript e recusado', () => {
    expect(validarPdf(pdf('<</S/J#61vaScript>>'))).toEqual({ ok: false, code: 'pdf_ativo' });
  });

  it('nao confunde /JS com /JSON, nem /XJS com /JS', () => {
    expect(validarPdf(pdf('<</Meta/JSON>> <</X/XJS>>'))).toEqual({ ok: true });
  });

  it('nao recusa /OpenAction nem /AA (decisao 224)', () => {
    expect(validarPdf(pdf('<</OpenAction 3 0 R/AA<<>>>>'))).toEqual({ ok: true });
  });

  it('roda em tempo linear com 2 MiB (CA-02 e B2)', () => {
    const corpo = 'a'.repeat(2_097_000);
    const inicio = Date.now();
    const r = validarPdf(pdf(corpo));
    const dur = Date.now() - inicio;
    expect(r).toEqual({ ok: true });
    expect(dur).toBeLessThan(3000);
  });
});
