// H-056 (Issue #69) | Fotos elegiveis com marca d'agua: regras puras (167-DESENHO-H056.md, §4.2, A-5, A-8, A-11).
// Sem banco, sem Storage, sem sharp. Contem: codec do token de 60 s (HMAC-SHA-256), identificador opaco
// FP-XXXX-XXXX do profissional, variante da foto, SVG da marca (mosaico) e os contratos das portas.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { GLIFOS_5X7 } from './watermark-glyphs.js';

/** Validade do link de foto: 60 s (decisao 845 e §4.2). */
export const PHOTO_VIEW_TTL_S = 60 as const;
/** Largura maxima de cada variante (decisao 836). */
export const PHOTO_VARIANT_MAX_WIDTH = { preview: 320, full: 1280 } as const;
/** Tamanho minimo dos segredos do token e do identificador (decisao 842). */
export const WATERMARK_SECRET_MIN_LENGTH = 32 as const;

export type PhotoVariant = 'preview' | 'full';
export type PhotoTokenMode = 'professional' | 'owner';

export interface PhotoTokenClaims {
  readonly mode: PhotoTokenMode;
  readonly photoId: string;
  readonly requestId: string;
  readonly userId: string;
  readonly variant: PhotoVariant;
  readonly expSeconds: number;
}

export interface PhotoTokenCodec {
  sign(claims: Omit<PhotoTokenClaims, 'expSeconds'>, nowMs: number): string;
  /** null para qualquer defeito (formato, assinatura, versao, campo, expirado). Nunca lanca. */
  verify(token: string, nowMs: number): PhotoTokenClaims | null;
}

// Alfabeto sem caracteres ambiguos (sem 0, 1, I, O). 32 simbolos = 5 bits cada.
const ALFABETO_ID = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const TOKEN_MAX_LENGTH = 400;
const PAYLOAD_MAX_BYTES = 400;
const CHAVES_PAYLOAD = ['v', 'm', 'pid', 'rid', 'usr', 'var', 'exp'] as const;

function ehUuid(valor: unknown): valor is string {
  return typeof valor === 'string' && UUID_RE.test(valor);
}

/** Codec do token: payload JSON canonico em base64url, '.' e HMAC-SHA-256 do payload em base64url. */
export function createPhotoTokenCodec(secret: string): PhotoTokenCodec {
  if (typeof secret !== 'string' || secret.length < WATERMARK_SECRET_MIN_LENGTH) {
    // Mensagem fixa: nunca ecoa o valor do segredo.
    throw new Error('watermark_segredo_curto');
  }
  const assinar = (corpo: string): Buffer => createHmac('sha256', secret).update(corpo, 'utf8').digest();

  return {
    sign(claims, nowMs) {
      if (!ehUuid(claims.photoId) || !ehUuid(claims.requestId) || !ehUuid(claims.userId)) {
        throw new Error('watermark_token_entrada_invalida');
      }
      if (!Number.isFinite(nowMs)) throw new Error('watermark_token_relogio_invalido');
      const exp = Math.floor(nowMs / 1000) + PHOTO_VIEW_TTL_S;
      const payload = JSON.stringify({
        v: 1,
        m: claims.mode === 'professional' ? 'p' : 'o',
        pid: claims.photoId,
        rid: claims.requestId,
        usr: claims.userId,
        var: claims.variant === 'preview' ? 'p' : 'f',
        exp,
      });
      const corpo = Buffer.from(payload, 'utf8').toString('base64url');
      return `${corpo}.${assinar(corpo).toString('base64url')}`;
    },

    verify(token, nowMs) {
      try {
        if (typeof token !== 'string' || token.length === 0 || token.length > TOKEN_MAX_LENGTH) return null;
        if (!Number.isFinite(nowMs)) return null;
        const partes = token.split('.');
        if (partes.length !== 2) return null;
        const [corpo, assinatura] = partes as [string, string];
        if (!BASE64URL_RE.test(corpo) || !BASE64URL_RE.test(assinatura)) return null;

        const esperada = assinar(corpo);
        const recebida = Buffer.from(assinatura, 'base64url');
        if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return null;

        const bytes = Buffer.from(corpo, 'base64url');
        if (bytes.length === 0 || bytes.length > PAYLOAD_MAX_BYTES) return null;
        const obj: unknown = JSON.parse(bytes.toString('utf8'));
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null;
        const campos = Object.keys(obj).sort();
        if (campos.join(',') !== [...CHAVES_PAYLOAD].sort().join(',')) return null;
        const p = obj as Record<(typeof CHAVES_PAYLOAD)[number], unknown>;

        if (p.v !== 1) return null;
        if (p.m !== 'p' && p.m !== 'o') return null;
        if (p.var !== 'p' && p.var !== 'f') return null;
        if (!ehUuid(p.pid) || !ehUuid(p.rid) || !ehUuid(p.usr)) return null;
        if (typeof p.exp !== 'number' || !Number.isInteger(p.exp)) return null;
        if (p.exp < Math.floor(nowMs / 1000)) return null;

        return {
          mode: p.m === 'p' ? 'professional' : 'owner',
          photoId: p.pid,
          requestId: p.rid,
          userId: p.usr,
          variant: p.var === 'p' ? 'preview' : 'full',
          expSeconds: p.exp,
        };
      } catch {
        return null;
      }
    },
  };
}

/**
 * Identificador opaco do profissional impresso na marca: 'FP-XXXX-XXXX', 40 bits de HMAC-SHA-256(salt, id).
 * Estavel enquanto o salt nao muda; trocar o salt invalida o mapeamento (A-8). Nao contem o id nem PII.
 */
export function watermarkIdOf(professionalId: string, salt: string): string {
  if (!ehUuid(professionalId)) throw new Error('watermark_id_entrada_invalida');
  if (typeof salt !== 'string' || salt.length < WATERMARK_SECRET_MIN_LENGTH) throw new Error('watermark_salt_curto');
  const digest = createHmac('sha256', salt).update(professionalId.toLowerCase(), 'utf8').digest();
  let bits = 0n;
  for (let i = 0; i < 5; i += 1) bits = (bits << 8n) | BigInt(digest[i] as number);
  let simbolos = '';
  for (let k = 7; k >= 0; k -= 1) {
    simbolos += ALFABETO_ID[Number((bits >> BigInt(k * 5)) & 31n)] as string;
  }
  return `FP-${simbolos.slice(0, 4)}-${simbolos.slice(4)}`;
}

/** Variante pedida: ausente = 'full' (padrao); 'preview' ou 'full'; qualquer outro valor = null (400 na rota). */
export function parsePhotoVariant(valor: string | null): PhotoVariant | null {
  if (valor === null) return 'full';
  if (valor === 'preview' || valor === 'full') return valor;
  return null;
}

/** Linha da lista de fotos do profissional ou do dono (contrato de leitura, sem chave de bucket nem bytes). */
export interface PhotoViewRow {
  readonly id: string;
  readonly sortOrder: number;
  readonly width: number;
  readonly height: number;
}

/** Dados declarados de uma foto pronta, para conferir a leitura e dimensionar a marca. */
export interface PhotoTarget {
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
}

/** Porta de acesso (packages/db, so app_system). Lista e alvo: null = negado (404 uniforme); lista vazia = autorizado sem foto; lancar = erro interno (503). */
export interface PhotoViewStorePort {
  list(professionalId: string, requestId: string, nowMs: number): Promise<readonly PhotoViewRow[] | null>;
  target(professionalId: string, requestId: string, photoId: string, nowMs: number): Promise<PhotoTarget | null>;
  ownerList(customerId: string, requestId: string): Promise<readonly PhotoViewRow[] | null>;
  ownerTarget(customerId: string, requestId: string, photoId: string): Promise<PhotoTarget | null>;
  access(requestId: string, professionalId: string, photoId: string | null, nowMs: number): Promise<boolean>;
}

/** Porta do compositor (implementada em apps/api com sharp). label null = sem marca (dono). */
export interface WatermarkComposerPort {
  compose(
    input: Uint8Array,
    opts: { readonly variant: PhotoVariant; readonly label: string | null; readonly signal: AbortSignal },
  ): Promise<{ ok: true; jpeg: Uint8Array } | { ok: false; kind: 'unavailable' | 'invalid' }>;
}

const ROTULO_RE = /^[0-9A-Z-]{1,24}$/;
const PASSO_CARACTERE = 6; // 5 colunas do glifo + 1 de espaco
const LINHAS_GLIFO = 7;
const COLUNAS_GLIFO = 5;
const ANGULO_MOSAICO = -30;

// Cores da marca d'agua sao da IMAGEM (nao da interface): branco e preto com opacidade fixa (A-5).
const COR_CLARA = '#ffffff'; // check-hex:ignore: cor fixa da marca d'agua gravada na imagem, nao da interface
const COR_ESCURA = '#000000'; // check-hex:ignore: cor fixa da marca d'agua gravada na imagem, nao da interface
const OPACIDADE_CLARA = 0.22;
const OPACIDADE_ESCURA = 0.18;
const DESLOCAMENTO_SOMBRA = 1;

/** Caminho SVG (retangulos de 1 celula) das celulas acesas de um texto posicionado em (x0, y0). */
function caminhoTexto(texto: string, x0: number, y0: number, celula: number, deslocamento: number): string {
  let d = '';
  for (let i = 0; i < texto.length; i += 1) {
    const glifo = GLIFOS_5X7[texto[i] as string];
    if (glifo === undefined) throw new Error('watermark_glifo_ausente');
    const gx = x0 + i * PASSO_CARACTERE * celula + deslocamento;
    const gy = y0 + deslocamento;
    for (let r = 0; r < LINHAS_GLIFO; r += 1) {
      const linha = glifo[r] as string;
      for (let c = 0; c < COLUNAS_GLIFO; c += 1) {
        if (linha[c] !== '#') continue;
        d += `M${gx + c * celula} ${gy + r * celula}h${celula}v${celula}h-${celula}z`;
      }
    }
  }
  return d;
}

/**
 * SVG do mosaico da marca para uma imagem de largura x altura. Puro e deterministico: mesmo tamanho e mesmo
 * rotulo geram o mesmo texto. Rotulo so com 0-9, A-Z e hifen (ate 24 caracteres). Sem <text>: sem fonte.
 */
export function buildWatermarkSvg(largura: number, altura: number, rotulo: string): string {
  if (!Number.isInteger(largura) || !Number.isInteger(altura) || largura < 1 || altura < 1 || largura > 4096 || altura > 4096) {
    throw new Error('watermark_dimensao_invalida');
  }
  if (!ROTULO_RE.test(rotulo)) throw new Error('watermark_rotulo_invalido');

  const celula = Math.max(1, Math.round(largura / 400));
  const textoLargura = (rotulo.length * PASSO_CARACTERE - 1) * celula;
  const textoAltura = LINHAS_GLIFO * celula;
  const tileLargura = textoLargura + 4 * PASSO_CARACTERE * celula;
  const tileAltura = 5 * textoAltura;
  const meio = Math.round(tileAltura / 2);
  const meioLargura = Math.round(tileLargura / 2);

  // Duas posicoes por tile (linha cheia e linha deslocada meia largura), para a grade ficar alternada.
  const posicoes: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [meioLargura, meio],
  ];
  let claro = '';
  let escuro = '';
  for (const [x, y] of posicoes) {
    claro += caminhoTexto(rotulo, x, y, celula, 0);
    escuro += caminhoTexto(rotulo, x, y, celula, DESLOCAMENTO_SOMBRA);
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${altura}" viewBox="0 0 ${largura} ${altura}">` +
    `<defs><pattern id="marca" width="${tileLargura}" height="${tileAltura}" patternUnits="userSpaceOnUse" ` +
    `patternTransform="rotate(${ANGULO_MOSAICO})">` +
    `<path d="${escuro}" fill="${COR_ESCURA}" fill-opacity="${OPACIDADE_ESCURA}"/>` +
    `<path d="${claro}" fill="${COR_CLARA}" fill-opacity="${OPACIDADE_CLARA}"/>` +
    `</pattern></defs>` +
    `<rect width="${largura}" height="${altura}" fill="url(#marca)"/>` +
    `</svg>`
  );
}
