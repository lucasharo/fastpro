// Contraste WCAG 2.2 (SC 1.4.3 texto 4.5:1; SC 1.4.11 nao-texto 3:1). Sem dependencias.
import { colors, type ColorRole, type ThemeName } from './tokens.js';

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** Luminancia relativa de uma cor #RRGGBB. */
export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m?.[1]) throw new Error(`Cor invalida (esperado #RRGGBB): ${hex}`);
  const n = parseInt(m[1], 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export interface ContrastPair {
  readonly id: string;
  readonly foreground: ColorRole;
  readonly background: ColorRole;
  /** 4.5 para texto (AA); 3 para componentes de interface/nao-texto. */
  readonly minimum: 4.5 | 3;
}

const text = (id: string, foreground: ColorRole, background: ColorRole): ContrastPair => ({
  id,
  foreground,
  background,
  minimum: 4.5,
});

/** Pares texto/fundo DECLARADOS no EDS. Devem atingir AA (4.5:1) nos dois temas. */
export const textContrastPairs: readonly ContrastPair[] = [
  text('textPrimary/background', 'textPrimary', 'background'),
  text('textPrimary/surface', 'textPrimary', 'surface'),
  text('textPrimary/field', 'textPrimary', 'field'),
  text('textSecondary/background', 'textSecondary', 'background'),
  text('textSecondary/surface', 'textSecondary', 'surface'),
  text('textSecondary/field', 'textSecondary', 'field'),
  text('buttonPrimary', 'buttonPrimaryText', 'buttonPrimaryBackground'),
  text('buttonSecondary', 'buttonSecondaryText', 'buttonSecondaryBackground'),
  text('success', 'successText', 'successBackground'),
  text('error', 'errorText', 'errorBackground'),
  text('warning', 'warningText', 'warningBackground'),
  text('info', 'infoText', 'infoBackground'),
];

/**
 * Pares NAO-TEXTO (SC 1.4.11, 3:1) apenas INFORMATIVOS: o EDS nao declara esses pares como
 * obrigatorios. Os resultados sao reportados; cores aprovadas NAO sao alteradas aqui.
 */
export const informationalPairs: readonly ContrastPair[] = [
  { id: 'border/surface', foreground: 'border', background: 'surface', minimum: 3 },
  { id: 'border/field', foreground: 'border', background: 'field', minimum: 3 },
  { id: 'primary/background', foreground: 'primary', background: 'background', minimum: 3 },
  { id: 'primary/surface', foreground: 'primary', background: 'surface', minimum: 3 },
];

export interface ContrastResult {
  readonly theme: ThemeName;
  readonly pair: ContrastPair;
  readonly ratio: number;
  readonly passes: boolean;
}

export function evaluatePairs(pairs: readonly ContrastPair[]): ContrastResult[] {
  const results: ContrastResult[] = [];
  for (const theme of ['light', 'dark'] as const) {
    for (const pair of pairs) {
      const ratio = contrastRatio(colors[theme][pair.foreground], colors[theme][pair.background]);
      results.push({ theme, pair, ratio, passes: ratio >= pair.minimum });
    }
  }
  return results;
}
