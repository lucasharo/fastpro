// H-038 (Issue 51) | Dominio das certificacoes (docs/factory/148-DESENHO-H038.md §4 e §6): corpo com kind e service_id
// (CA-02, CA-07) e T-15 (texto neutro presente; vocabulos proibidos ausentes nas constantes de mensagem).
import { describe, expect, it } from 'vitest';
import { parseIdentityDocEmissaoBody } from '../src/identity-docs/body.js';
import { IDOC_TEXTOS } from '../src/identity-docs/textos.js';

const UUID = '0b7e3b52-1f0a-4c1e-9a7e-2d3f4a5b6c7d';
const SERVICO = '7a1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const MIB = 1024 * 1024;

function parse(obj: Record<string, unknown>) {
  const texto = JSON.stringify(obj);
  return parseIdentityDocEmissaoBody(texto, new TextEncoder().encode(texto).length);
}

const base = { client_upload_id: UUID, content_type: 'image/jpeg', size_bytes: 1000 };

describe('H-038 | corpo de emissao com kind e service_id', () => {
  it('certificacao com service_id valido passa e normaliza o uuid do servico', () => {
    const r = parse({ ...base, kind: 'certificacao', service_id: SERVICO.toUpperCase() });
    expect(r).toEqual({
      ok: true,
      corpo: { clientUploadId: UUID, contentType: 'image/jpeg', sizeBytes: 1000, kind: 'certificacao', serviceId: SERVICO },
    });
  });

  it('certificacao sem service_id responde 422 service_id_ausente', () => {
    expect(parse({ ...base, kind: 'certificacao' })).toEqual({ ok: false, status: 422, code: 'service_id_ausente' });
  });

  it('identidade com service_id responde 422 service_id_incoerente (sem vazar o valor)', () => {
    expect(parse({ ...base, kind: 'identidade', service_id: SERVICO })).toEqual({
      ok: false,
      status: 422,
      code: 'service_id_incoerente',
    });
  });

  it('service_id malformado em certificacao responde 422 service_id_invalido', () => {
    expect(parse({ ...base, kind: 'certificacao', service_id: 'nao-e-uuid' })).toEqual({
      ok: false,
      status: 422,
      code: 'service_id_invalido',
    });
  });

  it('kind fora da lista responde 422 kind_invalido', () => {
    expect(parse({ ...base, kind: 'licenca' })).toEqual({ ok: false, status: 422, code: 'kind_invalido' });
  });

  it('certificacao segue o mesmo teto de bytes da identidade (imagem 5 MiB, PDF 2 MiB)', () => {
    const img = parse({ ...base, kind: 'certificacao', service_id: SERVICO, size_bytes: 5 * MIB + 1 });
    expect(img).toEqual({ ok: false, status: 413, code: 'arquivo_grande' });
    const pdf = parse({ ...base, content_type: 'application/pdf', kind: 'certificacao', service_id: SERVICO, size_bytes: 2 * MIB + 1 });
    expect(pdf).toEqual({ ok: false, status: 413, code: 'arquivo_grande' });
  });

  it('tipo fora da lista (GIF) segue 415 mesmo como certificacao', () => {
    expect(parse({ ...base, content_type: 'image/gif', kind: 'certificacao', service_id: SERVICO })).toEqual({
      ok: false,
      status: 415,
      code: 'tipo_nao_aceito',
    });
  });
});

describe('H-038 | T-15: textos de mensagem (decisao 313 e varredura de vocabulario)', () => {
  const PROIBIDOS = ['garante', 'certificado de qualidade', 'seguro', 'aprovado pelo conselho'];

  it('o texto neutro da certificacao e exatamente o aprovado para DEV', () => {
    expect(IDOC_TEXTOS.certificacao_exigida).toBe('Esta atividade exige certificação. Envie o documento para continuar.');
  });

  it('nenhuma constante de mensagem de documentos usa vocabulario proibido', () => {
    for (const [codigo, texto] of Object.entries(IDOC_TEXTOS)) {
      const minusculo = texto.toLowerCase();
      for (const termo of PROIBIDOS) {
        expect(minusculo.includes(termo), `${codigo} usa "${termo}"`).toBe(false);
      }
    }
  });
});
