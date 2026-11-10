// FONTE UNICA de cor, tipografia e medidas do EDS (RF-160; FA-033; H-002).
// Valores aprovados pelo usuario na sintese do EDS (04_DESIGN_SYSTEM_EDS.md). Nao altere cores
// aqui sem decisao do usuario. Este e o unico lugar do repositorio onde cor literal e permitida.
// Nenhum outro pacote ou app pode ter hex, rgb(), hsl() ou nome de cor CSS (scripts/check-hex.mjs).

export type ThemeName = 'light' | 'dark';

/** Papeis de cor semanticos. Todo papel existe nos dois temas. */
export const COLOR_ROLES = [
  'brand',
  'primary',
  'background',
  'surface',
  'field',
  'textPrimary',
  'textSecondary',
  'border',
  'buttonPrimaryBackground',
  'buttonPrimaryText',
  'buttonSecondaryBackground',
  'buttonSecondaryText',
  'successText',
  'successBackground',
  'errorText',
  'errorBackground',
  'warningText',
  'warningBackground',
  'infoText',
  'infoBackground',
] as const;

export type ColorRole = (typeof COLOR_ROLES)[number];
export type ThemeColors = Readonly<Record<ColorRole, string>>;

const light: ThemeColors = {
  brand: '#142D4E',
  primary: '#16A6A1',
  background: '#F4F6F8',
  surface: '#FFFFFF',
  field: '#F4F6F8',
  textPrimary: '#202B37',
  textSecondary: '#536373',
  border: '#DFE5EA',
  buttonPrimaryBackground: '#16A6A1',
  buttonPrimaryText: '#142D4E',
  buttonSecondaryBackground: '#000000',
  buttonSecondaryText: '#FFFFFF',
  successText: '#166534',
  successBackground: '#DCFCE7',
  errorText: '#991B1B',
  errorBackground: '#FEE2E2',
  warningText: '#854D0E',
  warningBackground: '#FEF3C7',
  infoText: '#1D4ED8',
  infoBackground: '#DBEAFE',
};

const dark: ThemeColors = {
  brand: '#142D4E',
  primary: '#16A6A1',
  // Grafite neutro: nem azul marinho nem preto puro (EDS §1).
  background: '#121212',
  surface: '#1E1E1E',
  field: '#2A2A2A',
  textPrimary: '#FFFFFF',
  textSecondary: '#B8B8B8',
  border: '#3A3A3A',
  buttonPrimaryBackground: '#16A6A1',
  buttonPrimaryText: '#142D4E',
  buttonSecondaryBackground: '#FFFFFF',
  buttonSecondaryText: '#000000',
  successText: '#86EFAC',
  successBackground: '#173223',
  errorText: '#FCA5A5',
  errorBackground: '#3F1D1D',
  warningText: '#FDE68A',
  warningBackground: '#3B2D12',
  infoText: '#93C5FD',
  infoBackground: '#1E293B',
};

export const colors: Readonly<Record<ThemeName, ThemeColors>> = { light, dark };

export const typography = {
  /** Roboto e a unica familia. Apenas a familia generica como reserva do navegador. */
  fontFamily: 'Roboto',
  fontFamilyFallback: 'sans-serif',
  /** Pesos aprovados: regular, medium, bold. */
  fontWeights: { regular: 400, medium: 500, bold: 700 },
} as const;

/** Escala de espacamento em multiplos de 4px (chave = multiplo). */
export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

export const radii = {
  /** Cards. */
  card: 16,
  /** Botoes. */
  button: 12,
} as const;

export const sizes = {
  /** Alturas de botao: 40 / 48 / 56 px. */
  buttonHeight: { sm: 40, md: 48, lg: 56 },
  /** Altura-base do input. */
  inputHeight: 52,
} as const;

/** Mobile < 768; tablet 768-1199; desktop >= 1200 (larguras minimas em px). */
export const breakpoints = { tablet: 768, desktop: 1200 } as const;

export const tokens = { colors, typography, spacing, radii, sizes, breakpoints } as const;
