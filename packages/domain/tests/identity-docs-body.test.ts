// H-037 (Issue #50) | T-03 e T-04 (parte de dominio): corpo de emissao (107 §3; CA-03, CA-04, CA-10, CA-12).
import { describe, expect, it } from 'vitest';
import { parseIdentityDocEmissaoBody } from '../src/identity-docs/body.js';

const UUID = '0b7e3b52-1f0a-4c1e-9a7e-2d3f4a5b6c7d';
const MIB = 1024 * 1024;

function corpo(obj: Record<string, unknown>): { texto: string; bytes: number } {
  const texto = JSON.stringify(obj);
  return { texto, bytes: new TextEncoder().encode(texto).length };
}

function parse(obj: Record<string, unknown>) {
  const { texto, bytes } = corpo(obj);
  return parseIdentityDocEmissaoBody(texto, bytes);
}

describe('H-037 | corpo de emissao: aceitos (CA-01, CA-02, CA-03)', () => {
  it('aceita imagem de 4 MiB e normaliza o uuid para minusculas', () => {
    const r = parse({ client_upload_id: UUID.toUpperCase(), content_type: 'image/jpeg', size_bytes: 4 * MIB });
    expect(r).toEqual({
      ok: true,
      // H-038: kind ausente = identidade e service_id nulo (campos aditivos da certificacao).
      corpo: { clientUploadId: UUID, contentType: 'image/jpeg', sizeBytes: 4 * MIB, kind: 'identidade', serviceId: null },
    });
  });

  it('aceita a imagem exatamente em 5 MiB e o PDF exatamente em 2 MiB', () => {
    expect(parse({ client_upload_id: UUID, content_type: 'image/png', size_bytes: 5 * MIB }).ok).toBe(true);
    expect(parse({ client_upload_id: UUID, content_type: 'application/pdf', size_bytes: 2 * MIB }).ok).toBe(true);
  });
});

describe('H-037 | corpo de emissao: limites por tipo declarado (CA-03, T-03)', () => {
  it('PDF com 2 MiB + 1 byte e 413 arquivo_grande', () => {
    expect(parse({ client_upload_id: UUID, content_type: 'application/pdf', size_bytes: 2 * MIB + 1 })).toEqual({
      ok: false,
      status: 413,
      code: 'arquivo_grande',
    });
  });

  it('imagem com 5 MiB + 1 byte e 413 arquivo_grande', () => {
    expect(parse({ client_upload_id: UUID, content_type: 'image/webp', size_bytes: 5 * MIB + 1 })).toEqual({
      ok: false,
      status: 413,
      code: 'arquivo_grande',
    });
  });
});

describe('H-037 | corpo de emissao: tipos recusados (CA-04, T-04)', () => {
  it.each(['image/gif', 'image/heic', 'image/heif', 'image/svg+xml', 'text/plain', 'application/x-msdownload'])(
    'recusa %s com 415 tipo_nao_aceito',
    (tipo) => {
      expect(parse({ client_upload_id: UUID, content_type: tipo, size_bytes: 10 })).toEqual({
        ok: false,
        status: 415,
        code: 'tipo_nao_aceito',
      });
    },
  );

  it('sem content_type e 415 tipo_nao_aceito', () => {
    expect(parse({ client_upload_id: UUID, size_bytes: 10 })).toEqual({
      ok: false,
      status: 415,
      code: 'tipo_nao_aceito',
    });
  });
});

describe('H-037 | corpo de emissao: chaves e campos (CA-10, CA-12, CA-18)', () => {
  it.each(['filename', 'name', 'owner', 'professional_id', 'bucket', 'path', 'status'])(
    'campo %s e recusado com 422 campo_desconhecido',
    (campo) => {
      expect(parse({ client_upload_id: UUID, content_type: 'image/jpeg', size_bytes: 10, [campo]: 'x' })).toEqual({
        ok: false,
        status: 422,
        code: 'campo_desconhecido',
      });
    },
  );

  it('campo ausente, uuid invalido e tamanho invalido geram 422 com codigo fixo', () => {
    expect(parse({ client_upload_id: UUID, content_type: 'image/jpeg' })).toEqual({
      ok: false,
      status: 422,
      code: 'campo_ausente',
    });
    expect(parse({ client_upload_id: 'nao-uuid', content_type: 'image/jpeg', size_bytes: 10 })).toEqual({
      ok: false,
      status: 422,
      code: 'client_upload_id_invalido',
    });
    for (const tam of [0, 1.5, '10', -3]) {
      expect(parse({ client_upload_id: UUID, content_type: 'image/jpeg', size_bytes: tam })).toEqual({
        ok: false,
        status: 422,
        code: 'tamanho_invalido',
      });
    }
  });
});

describe('H-037 | corpo de emissao: formato do JSON', () => {
  it('corpo acima de 2 KB e 413 corpo_grande, medido antes de decodificar', () => {
    expect(parseIdentityDocEmissaoBody('{}', 2049)).toEqual({ ok: false, status: 413, code: 'corpo_grande' });
  });

  it('vazio, JSON invalido e array geram 422', () => {
    expect(parseIdentityDocEmissaoBody('   ', 3)).toEqual({ ok: false, status: 422, code: 'vazio' });
    expect(parseIdentityDocEmissaoBody('{nao json', 9)).toEqual({ ok: false, status: 422, code: 'corpo_invalido' });
    expect(parseIdentityDocEmissaoBody('[1,2]', 5)).toEqual({ ok: false, status: 422, code: 'corpo_invalido' });
  });
});
