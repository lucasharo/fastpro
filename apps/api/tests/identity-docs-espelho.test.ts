// H-037 (Issue #50) | Paridade do espelho da API com o dominio (apps/api/src/identity-docs/espelho). Enquanto o barril do
// dominio nao exporta identity-docs (fase 2), a API roda uma copia; este teste garante que a copia e o dominio
// dao o mesmo resultado sobre o mesmo corpus. Importa o codigo-fonte do dominio direto (so no teste).
import { describe, expect, it } from 'vitest';
import * as domConst from '../../../packages/domain/src/identity-docs/constants.js';
import * as espConst from '../src/identity-docs/espelho/constants.js';
import * as domBody from '../../../packages/domain/src/identity-docs/body.js';
import * as espBody from '../src/identity-docs/espelho/body.js';
import * as domKeys from '../../../packages/domain/src/identity-docs/keys.js';
import * as espKeys from '../src/identity-docs/espelho/keys.js';
import * as domPdf from '../../../packages/domain/src/identity-docs/pdf.js';
import * as espPdf from '../src/identity-docs/espelho/pdf.js';
import * as domTipo from '../../../packages/domain/src/identity-docs/tipo.js';
import * as espTipo from '../src/identity-docs/espelho/tipo.js';

const UUID = '0a0b0c0d-0e0f-4102-8132-334455667788';

describe('H-037 | paridade do espelho com o dominio', () => {
  it('constantes: mesmos nomes e mesmos valores', () => {
    const nomes = Object.keys(domConst).sort();
    expect(Object.keys(espConst).sort()).toEqual(nomes);
    for (const n of nomes) {
      const e = (espConst as Record<string, unknown>)[n];
      const d = (domConst as Record<string, unknown>)[n];
      // Funcoes sao objetos diferentes em cada modulo: compara o codigo-fonte. Demais valores, por igualdade profunda.
      if (typeof d === 'function') expect(String(e)).toBe(String(d));
      else expect(e).toEqual(d);
    }
  });

  it('corpo de emissao: mesmo resultado para cada entrada do corpus', () => {
    const corpus: [string, number][] = [
      [JSON.stringify({ client_upload_id: UUID, content_type: 'image/jpeg', size_bytes: 10 }), 80],
      [JSON.stringify({ client_upload_id: UUID.toUpperCase(), content_type: 'application/pdf', size_bytes: 2_097_152 }), 90],
      [JSON.stringify({ client_upload_id: UUID, content_type: 'application/pdf', size_bytes: 2_097_153 }), 90],
      [JSON.stringify({ client_upload_id: UUID, content_type: 'image/gif', size_bytes: 10 }), 90],
      [JSON.stringify({ client_upload_id: UUID, content_type: 'image/jpeg', size_bytes: 10, filename: 'rg.jpg' }), 120],
      [JSON.stringify({ client_upload_id: UUID, content_type: 'image/jpeg' }), 60],
      [JSON.stringify({ client_upload_id: 'nao-uuid', content_type: 'image/png', size_bytes: 1 }), 60],
      [JSON.stringify({ client_upload_id: UUID, content_type: 'image/png', size_bytes: 1.5 }), 60],
      [JSON.stringify({ client_upload_id: UUID, content_type: 'image/webp', size_bytes: 0 }), 60],
      [JSON.stringify([1, 2]), 10],
      ['{nao json', 10],
      ['   ', 0],
      [JSON.stringify({ client_upload_id: UUID, content_type: 'image/jpeg', size_bytes: 1 }), 5000],
    ];
    for (const [texto, bytes] of corpus) {
      expect(espBody.parseIdentityDocEmissaoBody(texto, bytes)).toEqual(domBody.parseIdentityDocEmissaoBody(texto, bytes));
    }
  });

  it('chaves de objeto: mesmo resultado, inclusive a recusa de id fora do formato', () => {
    for (const id of [UUID, UUID.toUpperCase(), '../x', '']) {
      const d = (() => {
        try {
          return domKeys.identityDocIncomingKey(id);
        } catch {
          return 'erro';
        }
      })();
      const e = (() => {
        try {
          return espKeys.identityDocIncomingKey(id);
        } catch {
          return 'erro';
        }
      })();
      expect(e).toBe(d);
      expect(() => espKeys.identityDocFinalKey(id)).toEqual(expect.any(Function));
    }
  });

  it('validador de PDF: mesmo codigo para cada arquivo do corpus', () => {
    const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
    const corpus = [
      enc('%PDF-1.7\n%%EOF\n'),
      enc('%PDF-1.4\n/JavaScript 1 0 R\n%%EOF\n'),
      enc('%PDF-1.4\n/JSON 1\n%%EOF\n'),
      enc('%PDF-1.4\n/Encrypt 2 0 R\n%%EOF\n'),
      enc('%PDF-1.4\n/J#61vaScript x\n%%EOF\n'),
      enc('lixo %PDF-1.7\n%%EOF\n'),
      enc('%PDF-9.9\n%%EOF\n'),
      enc('%PDF-1.7 sem fim'),
      new Uint8Array(0),
      new Uint8Array([0x25]),
    ];
    for (const b of corpus) expect(espPdf.validarPdf(b)).toEqual(domPdf.validarPdf(b));
  });

  it('tipo pelo conteudo: mesmo resultado (JPEG, PNG, WebP, PDF, texto e vazio)', () => {
    const corpus = [
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]),
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '),
      new TextEncoder().encode('%PDF-1.7'),
      new TextEncoder().encode('GIF89a'),
      new Uint8Array(0),
    ];
    for (const b of corpus) expect(espTipo.detectarTipoDocumento(b)).toEqual(domTipo.detectarTipoDocumento(b));
  });
});
