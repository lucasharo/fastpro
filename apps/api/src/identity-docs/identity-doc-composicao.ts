// H-037 (Issue #50) | Composicao dos documentos de identidade (docs/factory/107-DESENHO-H037.md, §9; decisoes 171 e 219).
// Trava 1: a rota so abre com IDENTITY_DOCS_ENABLED=1. Trava 2: com VERCEL_ENV=production, tambem exige
// IDENTITY_DOCS_L1_PARECER=1 (dado C3 sem prazo; so depois do parecer L1). Fechado = 404 uniforme, zero chamadas.
// Pendencias saem so com NOMES de variaveis, nunca com valores. As portas reais (banco, Storage, redutor, cota) chegam
// prontas por opcao: a montagem na raiz (composicao.ts, vercel.ts, app.ts) e da fase 2, depois da Issue 141.
import type { IdentityDocRouteOptions } from './identity-doc-route.js';

export interface IdentityDocComposicaoOpcoes {
  /** Opcoes da rota ja montadas com as portas reais (fase 2 entrega a montagem). */
  readonly rota: Omit<IdentityDocRouteOptions, 'siteUrl'>;
  readonly siteUrl: string;
}

export interface IdentityDocComposicao {
  /** Opcoes da rota quando a trava abre; null quando fechado (responder com 404 uniforme). */
  readonly options: IdentityDocRouteOptions | null;
  /** Nomes de variaveis que faltam para abrir. Sem valores. */
  readonly pendencias: readonly string[];
}

export type IdentityDocAmbiente = Readonly<Record<string, string | undefined>>;

export function montarDocumentosIdentidade(
  env: IdentityDocAmbiente,
  opcoes: IdentityDocComposicaoOpcoes,
): IdentityDocComposicao {
  if (env['IDENTITY_DOCS_ENABLED'] !== '1') return { options: null, pendencias: [] };

  const producao = env['VERCEL_ENV'] === 'production';
  if (producao && env['IDENTITY_DOCS_L1_PARECER'] !== '1') {
    return { options: null, pendencias: ['IDENTITY_DOCS_L1_PARECER'] };
  }

  return {
    options: { ...opcoes.rota, siteUrl: opcoes.siteUrl },
    pendencias: [],
  };
}
