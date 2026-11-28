// H-037 (Issue #50) | Constantes, chaves, tipo pelo conteudo e textos (107 §2, §3, §5; decisoes 173 a 175, 188 a 189,
// 213, 220, 224 a 226). Sintetico, sem I/O.
import { describe, expect, it } from 'vitest';
import {
  IDOC_BODY_LIMIT_BYTES,
  IDOC_DECLARED_TYPES,
  IDOC_FINAL_BUCKET,
  IDOC_FINAL_MAX_BYTES,
  IDOC_GLOBAL_BYTES_CAP,
  IDOC_IMAGE_MAX_BYTES,
  IDOC_INCOMING_BUCKET,
  IDOC_MAX_VIVOS,
  IDOC_PDF_MAX_BYTES,
  IDOC_RATE_EMISSAO_IP_DIA,
  IDOC_RATE_EMISSAO_IP_HORA,
  IDOC_RATE_EMISSAO_PROFISSIONAL_DIA,
  IDOC_RATE_EMISSAO_PROFISSIONAL_HORA,
  IDOC_RATE_FINALIZA_PROFISSIONAL,
  IDOC_RATE_LEITURA_IP,
  IDOC_TEXTOS,
  identityDocFinalKey,
  identityDocIncomingKey,
  detectarTipoDocumento,
  limiteEmissaoBytes,
} from '../src/identity-docs/index.js';

const UUID = '0b7e3b52-1f0a-4c1e-9a7e-2d3f4a5b6c7d';

describe('H-037 | constantes (CA-05, CA-07, CA-16, decisao 220)', () => {
  it('limites, buckets e teto global', () => {
    expect(IDOC_IMAGE_MAX_BYTES).toBe(5_242_880);
    expect(IDOC_PDF_MAX_BYTES).toBe(2_097_152);
    expect(IDOC_FINAL_MAX_BYTES).toBe(2_097_152);
    expect(IDOC_BODY_LIMIT_BYTES).toBe(2048);
    expect(IDOC_MAX_VIVOS).toBe(5);
    expect(IDOC_GLOBAL_BYTES_CAP).toBe(250_000_000);
    expect(IDOC_INCOMING_BUCKET).toBe('identity-incoming');
    expect(IDOC_FINAL_BUCKET).toBe('identity-docs');
    expect(IDOC_DECLARED_TYPES).toEqual(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
  });

  it('cotas de emissao, finalizacao e leitura (decisao 188 e 107 §5)', () => {
    expect([IDOC_RATE_EMISSAO_PROFISSIONAL_HORA.limit, IDOC_RATE_EMISSAO_PROFISSIONAL_DIA.limit]).toEqual([12, 25]);
    expect([IDOC_RATE_EMISSAO_IP_HORA.limit, IDOC_RATE_EMISSAO_IP_DIA.limit]).toEqual([40, 150]);
    expect(IDOC_RATE_FINALIZA_PROFISSIONAL.limit).toBe(30);
    expect(IDOC_RATE_LEITURA_IP.limit).toBe(120);
    expect(IDOC_RATE_LEITURA_IP.spanS).toBe(60);
  });

  it('limite de emissao por tipo declarado (CA-03)', () => {
    expect(limiteEmissaoBytes('application/pdf')).toBe(2_097_152);
    expect(limiteEmissaoBytes('image/jpeg')).toBe(5_242_880);
  });
});

describe('H-037 | chaves de objeto (CA-06, R6): so s/<uuid> e i/<uuid>', () => {
  it('deriva as chaves do id e normaliza para minusculas', () => {
    expect(identityDocIncomingKey(UUID.toUpperCase())).toBe(`s/${UUID}`);
    expect(identityDocFinalKey(UUID)).toBe(`i/${UUID}`);
  });

  it('recusa id que nao e uuid (nada de caminho ou nome de arquivo)', () => {
    expect(() => identityDocIncomingKey('../p/x')).toThrow();
    expect(() => identityDocFinalKey('rg-frente-maria.jpg')).toThrow();
  });
});

describe('H-037 | tipo pelo conteudo (B1, CA-04)', () => {
  it('reconhece JPEG, PNG, WebP e PDF pela assinatura', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
    const webp = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 \0\0\0\0');
    const pdf = new TextEncoder().encode('%PDF-1.7\n');
    expect(detectarTipoDocumento(jpeg)).toBe('image/jpeg');
    expect(detectarTipoDocumento(png)).toBe('image/png');
    expect(detectarTipoDocumento(webp)).toBe('image/webp');
    expect(detectarTipoDocumento(pdf)).toBe('application/pdf');
  });

  it('recusa GIF, texto e vazio (devolvem null)', () => {
    expect(detectarTipoDocumento(new TextEncoder().encode('GIF89a......'))).toBeNull();
    expect(detectarTipoDocumento(new TextEncoder().encode('MZ executavel'))).toBeNull();
    expect(detectarTipoDocumento(new Uint8Array(0))).toBeNull();
  });
});

describe('H-037 | textos da tela (106 §6, decisoes 186 e 226)', () => {
  it('todo codigo tem texto nao vazio, sem nome de arquivo nem codigo interno', () => {
    for (const texto of Object.values(IDOC_TEXTOS)) {
      expect(texto.trim().length).toBeGreaterThan(0);
      expect(texto).not.toMatch(/\.(jpg|png|webp|pdf)\b/i);
      expect(texto).not.toMatch(/\b(bucket|uuid|sha|s3|storage)\b/i);
    }
  });

  it('a recusa por conteudo usa o texto aprovado pela decisao 226', () => {
    expect(IDOC_TEXTOS.conteudo_recusado).toBe(
      'Não foi possível aceitar este arquivo. Envie outra foto ou outro PDF do documento.',
    );
  });
});
