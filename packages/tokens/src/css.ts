// Gera as CSS variables a partir de tokens.ts (a fonte unica). Nada aqui define valor proprio.
import { COLOR_ROLES, colors, typography, spacing, radii, sizes, breakpoints } from './tokens.js';
import type { ThemeName } from './tokens.js';

/** textPrimary -> --color-text-primary */
export function cssVarName(role: string): string {
  return `--color-${role.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
}

function themeBlock(theme: ThemeName, indent: string): string {
  return COLOR_ROLES.map((r) => `${indent}${cssVarName(r)}: ${colors[theme][r]};`).join('\n');
}

function staticVars(): string {
  const lines: string[] = [];
  lines.push(`  --font-family: '${typography.fontFamily}', ${typography.fontFamilyFallback};`);
  for (const [name, w] of Object.entries(typography.fontWeights)) {
    lines.push(`  --font-weight-${name}: ${w};`);
  }
  for (const [k, v] of Object.entries(spacing)) lines.push(`  --space-${k}: ${v}px;`);
  lines.push(`  --radius-card: ${radii.card}px;`, `  --radius-button: ${radii.button}px;`);
  for (const [k, v] of Object.entries(sizes.buttonHeight)) {
    lines.push(`  --button-height-${k}: ${v}px;`);
  }
  lines.push(`  --input-height: ${sizes.inputHeight}px;`);
  lines.push(`  --breakpoint-tablet: ${breakpoints.tablet}px;`);
  lines.push(`  --breakpoint-desktop: ${breakpoints.desktop}px;`);
  return lines.join('\n');
}

/**
 * Tema inicial segue a preferencia do dispositivo; data-theme="light|dark" no elemento raiz
 * sobrepoe a preferencia (escolha persistida pelo usuario).
 */
export function generateCss(): string {
  return `/* GERADO por @fastpro/tokens (src/css.ts). Nao edite. */
:root {
${staticVars()}
${themeBlock('light', '  ')}
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
${themeBlock('dark', '    ')}
    color-scheme: dark;
  }
}

:root[data-theme='dark'] {
${themeBlock('dark', '  ')}
  color-scheme: dark;
}
`;
}
