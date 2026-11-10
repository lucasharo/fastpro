import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COLOR_ROLES,
  breakpoints,
  colors,
  contrastRatio,
  cssVarName,
  evaluatePairs,
  generateCss,
  informationalPairs,
  radii,
  sizes,
  spacing,
  textContrastPairs,
  typography,
} from '../src/index.js';

const HEX6 = /^#[0-9A-F]{6}$/;
const themes = ['light', 'dark'] as const;

describe('papeis de cor do EDS (FA-033)', () => {
  it.each(themes)('tema %s tem todos os papeis, em #RRGGBB, e nenhum a mais', (theme) => {
    expect(Object.keys(colors[theme]).sort()).toEqual([...COLOR_ROLES].sort());
    for (const role of COLOR_ROLES) expect(colors[theme][role]).toMatch(HEX6);
  });

  it('valores aprovados do EDS (secao 2) estao exatos', () => {
    expect(colors.light).toMatchObject({
      brand: '#142D4E',
      primary: '#16A6A1',
      background: '#F4F6F8',
      surface: '#FFFFFF',
      field: '#F4F6F8',
      textPrimary: '#202B37',
      textSecondary: '#536373',
      border: '#DFE5EA',
      buttonSecondaryBackground: '#000000',
      buttonSecondaryText: '#FFFFFF',
    });
    expect(colors.dark).toMatchObject({
      surface: '#1E1E1E',
      field: '#2A2A2A',
      textPrimary: '#FFFFFF',
      textSecondary: '#B8B8B8',
      border: '#3A3A3A',
      buttonSecondaryBackground: '#FFFFFF',
      buttonSecondaryText: '#000000',
    });
  });

  it('fundo escuro e grafite #121212 (nem preto puro nem azul marinho)', () => {
    expect(colors.dark.background).toBe('#121212');
    expect(colors.dark.background).not.toBe('#000000');
    expect(colors.dark.background).not.toBe(colors.dark.brand);
  });

  it('marca, primaria e botao primario sao iguais nos dois temas', () => {
    for (const role of [
      'brand',
      'primary',
      'buttonPrimaryBackground',
      'buttonPrimaryText',
    ] as const) {
      expect(colors.light[role]).toBe(colors.dark[role]);
    }
  });
});

describe('tipografia e medidas', () => {
  it('Roboto e a unica familia nomeada, pesos 400/500/700', () => {
    expect(typography.fontFamily).toBe('Roboto');
    expect(Object.values(typography.fontWeights).sort()).toEqual([400, 500, 700]);
    const css = generateCss();
    const families = [...css.matchAll(/--font-family:\s*([^;]+);/g)].map((m) => m[1]);
    expect(families).toEqual(["'Roboto', sans-serif"]);
    const weights = [...css.matchAll(/--font-weight-\w+:\s*(\d+);/g)].map((m) => Number(m[1]));
    expect(weights.sort()).toEqual([400, 500, 700]);
  });

  it('espacamento em multiplos de 4px; raios, alturas e breakpoints do EDS', () => {
    for (const px of Object.values(spacing)) expect(px % 4).toBe(0);
    expect(radii).toEqual({ card: 16, button: 12 });
    expect(sizes.buttonHeight).toEqual({ sm: 40, md: 48, lg: 56 });
    expect(sizes.inputHeight).toBe(52);
    expect(breakpoints).toEqual({ tablet: 768, desktop: 1200 });
  });
});

describe('contraste WCAG 2.2', () => {
  it('formula: preto/branco = 21 e cor igual = 1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#16A6A1', '#16A6A1')).toBeCloseTo(1, 5);
  });

  it('todos os pares texto/fundo declarados atingem AA (4.5:1) nos dois temas', () => {
    const results = evaluatePairs(textContrastPairs);
    expect(results).toHaveLength(textContrastPairs.length * 2);
    for (const r of results) {
      // eslint-disable-next-line no-console
      console.info(
        `[contraste] ${r.theme} ${r.pair.id}: ${r.ratio.toFixed(2)}:1 (min ${r.pair.minimum})`,
      );
    }
    const failing = results
      .filter((r) => !r.passes)
      .map((r) => `${r.theme} ${r.pair.id} ${r.ratio.toFixed(2)}`);
    expect(
      failing,
      `pares abaixo de 4.5:1 (reportar; nao alterar cores aprovadas): ${failing.join('; ')}`,
    ).toEqual([]);
  });

  it('pares nao-texto informativos (3:1) sao reportados; lacunas conhecidas ficam documentadas', () => {
    // O EDS aprovado nao declara estes pares como obrigatorios. O teste NAO falha por eles,
    // mas qualquer lacuna nova (fora desta lista) falha, para a mudanca ser percebida.
    const KNOWN_GAPS = new Set([
      'light border/surface',
      'light border/field',
      'light primary/background',
      'light primary/surface',
      'dark border/surface',
      'dark border/field',
    ]);
    const results = evaluatePairs(informationalPairs);
    for (const r of results) {
      // eslint-disable-next-line no-console
      console.info(
        `[contraste nao-texto] ${r.theme} ${r.pair.id}: ${r.ratio.toFixed(2)}:1 ${r.passes ? 'ok' : 'ABAIXO DE 3:1'}`,
      );
    }
    const gaps = results.filter((r) => !r.passes).map((r) => `${r.theme} ${r.pair.id}`);
    expect(gaps.filter((g) => !KNOWN_GAPS.has(g))).toEqual([]);
  });
});

describe('CSS variables geradas', () => {
  const css = generateCss();

  it('nomes das variaveis seguem os papeis', () => {
    expect(cssVarName('textPrimary')).toBe('--color-text-primary');
    expect(cssVarName('buttonSecondaryBackground')).toBe('--color-button-secondary-background');
  });

  it('cada papel aparece no tema claro (:root), no escuro por preferencia e por data-theme', () => {
    for (const role of COLOR_ROLES) {
      const name = cssVarName(role);
      const count = css.split(`${name}:`).length - 1;
      expect(count, name).toBe(3);
    }
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(":root:not([data-theme='light'])");
    expect(css).toContain(":root[data-theme='dark']");
    expect(css).toContain('--color-background: #121212;');
  });

  it('todo hex do CSS vem de tokens.ts', () => {
    const known = new Set([...Object.values(colors.light), ...Object.values(colors.dark)]);
    for (const m of css.matchAll(/#[0-9A-Fa-f]{3,8}\b/g)) expect(known.has(m[0])).toBe(true);
  });
});

describe('nenhum outro pacote/app tem cor literal (RF-160)', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const SRC_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|css|scss|svg)$/;
  const HEX = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])/;
  const COLOR_FN = /\b(?:rgba?|hsla?|oklch|oklab|hwb)\s*\(/i;

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist' || name === '.turbo') continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (SRC_EXT.test(name)) out.push(p);
    }
    return out;
  }

  it('varre apps/* e packages/* exceto packages/tokens', () => {
    const files: string[] = [];
    for (const group of ['apps', 'packages']) {
      const base = join(root, group);
      if (!existsSync(base)) continue;
      for (const pkg of readdirSync(base)) {
        if (group === 'packages' && pkg === 'tokens') continue;
        const dir = join(base, pkg);
        if (statSync(dir).isDirectory()) walk(dir, files);
      }
    }
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((f) => {
      const text = readFileSync(f, 'utf8');
      return HEX.test(text) || COLOR_FN.test(text);
    });
    expect(offenders.map((f) => relative(root, f))).toEqual([]);
  });
});
