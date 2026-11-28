// H-056 (Issue #69) | Testes unitarios das regras puras da marca d'agua (167-DESENHO-H056.md, §7, fatia 2).
// Sem rede, sem banco. Cobre o codec do token, o identificador FP-XXXX-XXXX, a variante e o SVG da marca.
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PHOTO_VIEW_TTL_S,
  buildWatermarkSvg,
  createPhotoTokenCodec,
  parsePhotoVariant,
  watermarkIdOf,
} from '../src/index.js';
import { GLIFOS_5X7 } from '../src/media/watermark-glyphs.js';

const SEGREDO = 'segredo-de-teste-h056-com-trinta-e-dois-caracteres';
const SEGREDO_B = 'outro-segredo-h056-com-trinta-e-dois-caracteres';
const SALT = 'salt-de-teste-h056-com-trinta-e-dois-caracteres';
const SALT_B = 'outro-salt-h056-com-trinta-e-dois-caracteres!!';
const AGORA = Date.parse('2099-08-15T12:00:00.000Z');
const PROF = '6f1c2b3a-4d5e-4f60-8a71-92b3c4d5e6f7';
const OUTRO_PROF = '7a2d3c4b-5e6f-4a71-9b82-a3c4d5e6f708';
const PEDIDO = '11111111-2222-4333-8444-555555555555';
const FOTO = '99999999-8888-4777-8666-555555555555';
const DONO = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const base = { mode: 'professional' as const, photoId: FOTO, requestId: PEDIDO, userId: PROF, variant: 'preview' as const };

function assinarManual(payload: object, segredo = SEGREDO): string {
  const corpo = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const assinatura = createHmac('sha256', segredo).update(corpo, 'utf8').digest('base64url');
  return `${corpo}.${assinatura}`;
}

describe('token do link de foto (codec HMAC)', () => {
  const codec = createPhotoTokenCodec(SEGREDO);

  it('ida e volta devolve as mesmas reivindicacoes e validade de 60 s', () => {
    const token = codec.sign(base, AGORA);
    const v = codec.verify(token, AGORA);
    expect(v).toEqual({
      mode: 'professional',
      photoId: FOTO,
      requestId: PEDIDO,
      userId: PROF,
      variant: 'preview',
      expSeconds: Math.floor(AGORA / 1000) + PHOTO_VIEW_TTL_S,
    });
    expect(PHOTO_VIEW_TTL_S).toBe(60);
  });

  it('aceita ate o ultimo segundo de validade e recusa depois', () => {
    const token = codec.sign(base, AGORA);
    expect(codec.verify(token, AGORA + 59_000)).not.toBeNull();
    expect(codec.verify(token, AGORA + 61_000)).toBeNull();
  });

  it('recusa 1 byte adulterado no corpo e na assinatura', () => {
    const token = codec.sign(base, AGORA);
    const [corpo, assinatura] = token.split('.') as [string, string];
    const trocado = corpo[0] === 'A' ? `B${corpo.slice(1)}` : `A${corpo.slice(1)}`;
    expect(codec.verify(`${trocado}.${assinatura}`, AGORA)).toBeNull();
    const assinaturaTrocada = assinatura[0] === 'A' ? `B${assinatura.slice(1)}` : `A${assinatura.slice(1)}`;
    expect(codec.verify(`${corpo}.${assinaturaTrocada}`, AGORA)).toBeNull();
  });

  it('recusa token assinado com outro segredo', () => {
    const outro = createPhotoTokenCodec(SEGREDO_B).sign(base, AGORA);
    expect(codec.verify(outro, AGORA)).toBeNull();
  });

  it('recusa formatos invalidos: vazio, partes a mais ou a menos, base64 invalido, tamanho acima do limite', () => {
    const token = codec.sign(base, AGORA);
    const [corpo, assinatura] = token.split('.') as [string, string];
    expect(codec.verify('', AGORA)).toBeNull();
    expect(codec.verify(corpo, AGORA)).toBeNull();
    expect(codec.verify(`${token}.extra`, AGORA)).toBeNull();
    expect(codec.verify(`${corpo}.${assinatura}!`, AGORA)).toBeNull();
    expect(codec.verify('a'.repeat(401), AGORA)).toBeNull();
    expect(codec.verify(null as unknown as string, AGORA)).toBeNull();
  });

  it('recusa payload assinado corretamente mas com campo, versao, modo, variante ou identificador invalidos', () => {
    const valido = { v: 1, m: 'p', pid: FOTO, rid: PEDIDO, usr: PROF, var: 'p', exp: Math.floor(AGORA / 1000) + 60 };
    expect(codec.verify(assinarManual(valido), AGORA)).not.toBeNull();
    expect(codec.verify(assinarManual({ ...valido, v: 2 }), AGORA)).toBeNull();
    expect(codec.verify(assinarManual({ ...valido, m: 'x' }), AGORA)).toBeNull();
    expect(codec.verify(assinarManual({ ...valido, var: 'x' }), AGORA)).toBeNull();
    expect(codec.verify(assinarManual({ ...valido, pid: 'nao-e-uuid' }), AGORA)).toBeNull();
    expect(codec.verify(assinarManual({ ...valido, exp: 'amanha' }), AGORA)).toBeNull();
    expect(codec.verify(assinarManual({ ...valido, extra: 1 }), AGORA)).toBeNull();
    const semCampo: Record<string, unknown> = { ...valido };
    delete semCampo.usr;
    expect(codec.verify(assinarManual(semCampo), AGORA)).toBeNull();
  });

  it('modo dono e variante full sao preservados', () => {
    const token = codec.sign({ ...base, mode: 'owner', userId: DONO, variant: 'full' }, AGORA);
    expect(codec.verify(token, AGORA)).toMatchObject({ mode: 'owner', userId: DONO, variant: 'full' });
  });

  it('recusa segredo curto sem ecoar o valor', () => {
    const valorSecreto = 'abc123DEF';
    let mensagem = '';
    try {
      createPhotoTokenCodec(valorSecreto);
    } catch (erro) {
      mensagem = erro instanceof Error ? erro.message : '';
    }
    expect(mensagem).toBe('watermark_segredo_curto');
    expect(mensagem).not.toContain(valorSecreto);
  });

  it('recusa entrada invalida no sign', () => {
    expect(() => codec.sign({ ...base, photoId: 'x' }, AGORA)).toThrow('watermark_token_entrada_invalida');
  });
});

describe('identificador FP-XXXX-XXXX do profissional', () => {
  it('tem o formato FP-XXXX-XXXX com alfabeto sem caracteres ambiguos', () => {
    const id = watermarkIdOf(PROF, SALT);
    expect(id).toMatch(/^FP-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
    expect(id).not.toMatch(/[01IO]/);
  });

  it('e deterministico para o mesmo profissional e salt, e diferente para outro salt ou outro profissional', () => {
    expect(watermarkIdOf(PROF, SALT)).toBe(watermarkIdOf(PROF, SALT));
    expect(watermarkIdOf(PROF, SALT)).not.toBe(watermarkIdOf(PROF, SALT_B));
    expect(watermarkIdOf(PROF, SALT)).not.toBe(watermarkIdOf(OUTRO_PROF, SALT));
  });

  it('nao contem o identificador do profissional nem partes dele', () => {
    const id = watermarkIdOf(PROF, SALT);
    expect(id).not.toContain(PROF.replace(/-/g, '').slice(0, 8).toUpperCase());
    expect(id.toLowerCase()).not.toContain(PROF.slice(0, 8));
  });

  it('recusa identificador invalido e salt curto sem ecoar valores', () => {
    expect(() => watermarkIdOf('nao-uuid', SALT)).toThrow('watermark_id_entrada_invalida');
    expect(() => watermarkIdOf(PROF, 'curto')).toThrow('watermark_salt_curto');
  });
});

describe('variante da foto', () => {
  it('ausente e full por padrao; preview e full explicitos; qualquer outro valor e null', () => {
    expect(parsePhotoVariant(null)).toBe('full');
    expect(parsePhotoVariant('preview')).toBe('preview');
    expect(parsePhotoVariant('full')).toBe('full');
    expect(parsePhotoVariant('grande')).toBeNull();
    expect(parsePhotoVariant('')).toBeNull();
    expect(parsePhotoVariant('PREVIEW')).toBeNull();
  });
});

describe('tabela de glifos e SVG da marca', () => {
  it('cada glifo tem 7 linhas de 5 colunas, e a tabela cobre 0-9, A-Z e hifen', () => {
    for (const [caractere, linhas] of Object.entries(GLIFOS_5X7)) {
      expect(linhas, caractere).toHaveLength(7);
      for (const linha of linhas) expect(linha, caractere).toMatch(/^[.#]{5}$/);
    }
    for (const c of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-') expect(GLIFOS_5X7[c], c).toBeDefined();
  });

  it('e deterministico, tem as dimensoes pedidas e nao usa elemento de texto (sem fonte)', () => {
    const id = watermarkIdOf(PROF, SALT);
    const a = buildWatermarkSvg(320, 240, id);
    expect(a).toBe(buildWatermarkSvg(320, 240, id));
    expect(a).toContain('width="320"');
    expect(a).toContain('height="240"');
    expect(a).toContain('viewBox="0 0 320 240"');
    expect(a).toContain('rotate(-30)');
    expect(a).not.toMatch(/<text/i);
    expect(a).not.toMatch(/<image|<script|href=/i);
  });

  it('e maior em resolucao maior sem mudar a proporcao do rotulo', () => {
    const pequeno = buildWatermarkSvg(320, 240, 'FP-ABCD-EFGH');
    const grande = buildWatermarkSvg(1280, 960, 'FP-ABCD-EFGH');
    expect(pequeno.length).toBeGreaterThan(0);
    expect(grande.length).toBeGreaterThan(0);
    expect(grande).toContain('width="1280"');
  });

  it('recusa rotulo com caracteres fora do alfabeto ou muito longo, e dimensao invalida', () => {
    expect(() => buildWatermarkSvg(320, 240, 'fp-abcd')).toThrow('watermark_rotulo_invalido');
    expect(() => buildWatermarkSvg(320, 240, '<b>')).toThrow('watermark_rotulo_invalido');
    expect(() => buildWatermarkSvg(320, 240, 'A'.repeat(25))).toThrow('watermark_rotulo_invalido');
    expect(() => buildWatermarkSvg(0, 240, 'FP-ABCD-EFGH')).toThrow('watermark_dimensao_invalida');
    expect(() => buildWatermarkSvg(320.5, 240, 'FP-ABCD-EFGH')).toThrow('watermark_dimensao_invalida');
  });
});
