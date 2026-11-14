// Issue 56 (H-043) | Montagem do perfil publico por lista fechada (docs/factory/143-DESENHO-H043.md, §4.2, §6.1).
// Reconstroi o objeto so com as chaves permitidas: nada da linha de origem e repassado por inteiro.
// Entrada fora do formato devolve erro de dominio (a rota responde 500 generico, sem detalhe).
import { PUBLIC_PROFILE_TEXTS } from './texts.js';

export const PUBLIC_PROFILE_FIELDS = ['publicName', 'slug', 'verified', 'services', 'rating'] as const;
export const PUBLIC_PROFILE_MODALITIES = ['online', 'presencial'] as const;
export type PublicProfileModality = (typeof PUBLIC_PROFILE_MODALITIES)[number];

const SLUG_FORMATO = /^[a-z0-9][a-z0-9-]{0,99}$/;

export interface PublicProfileItem {
  readonly name: string;
  readonly modalities: readonly PublicProfileModality[];
}

export interface PublicProfileGroup {
  readonly groupName: string;
  readonly items: readonly PublicProfileItem[];
}

export interface PublicProfile {
  readonly publicName: string;
  readonly slug: string;
  readonly verified: true;
  readonly verificationBadge: { readonly label: string; readonly disclaimer: string };
  readonly services: readonly PublicProfileGroup[];
  readonly rating: { readonly average: null; readonly count: 0; readonly label: string };
  readonly recentReviews: readonly [];
}

export type MontagemPerfilPublico =
  | { readonly ok: true; readonly perfil: PublicProfile }
  | { readonly ok: false; readonly motivo: 'entrada_invalida' };

const isObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Tamanho em caracteres (code points), como o char_length do banco. */
function texto(v: unknown, min: number, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const n = [...v].length;
  return n >= min && n <= max ? v : undefined;
}

function modalidades(v: unknown): readonly PublicProfileModality[] | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  const permitidas = v.every((m) => (PUBLIC_PROFILE_MODALITIES as readonly unknown[]).includes(m));
  if (!permitidas || new Set(v).size !== v.length) return undefined;
  return v as PublicProfileModality[];
}

function itens(v: unknown): readonly PublicProfileItem[] | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  const saida: PublicProfileItem[] = [];
  for (const i of v) {
    if (!isObjeto(i)) return undefined;
    const nome = texto(i.name, 1, 120);
    const mods = modalidades(i.modalities);
    if (nome === undefined || mods === undefined) return undefined;
    saida.push({ name: nome, modalities: mods });
  }
  return saida;
}

function grupos(v: unknown): readonly PublicProfileGroup[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const saida: PublicProfileGroup[] = [];
  for (const g of v) {
    if (!isObjeto(g)) return undefined;
    const nome = texto(g.groupName, 1, 80);
    const lista = itens(g.items);
    if (nome === undefined || lista === undefined) return undefined;
    saida.push({ groupName: nome, items: lista });
  }
  return saida;
}

/**
 * Monta o perfil publico a partir da linha do banco. Descarta qualquer chave fora da lista fechada e
 * acrescenta o selo e a reputacao a partir dos textos unicos. A reputacao e fixa (count 0) enquanto a E10 nao existe.
 */
export function montarPerfilPublico(linha: unknown): MontagemPerfilPublico {
  if (!isObjeto(linha)) return { ok: false, motivo: 'entrada_invalida' };
  const publicName = texto(linha.publicName, 2, 80);
  const slug = typeof linha.slug === 'string' && SLUG_FORMATO.test(linha.slug) ? linha.slug : undefined;
  const services = grupos(linha.services);
  if (publicName === undefined || slug === undefined || services === undefined) {
    return { ok: false, motivo: 'entrada_invalida' };
  }
  return {
    ok: true,
    perfil: {
      publicName,
      slug,
      verified: true,
      verificationBadge: {
        label: PUBLIC_PROFILE_TEXTS.rotuloSelo,
        disclaimer: PUBLIC_PROFILE_TEXTS.textoLimitacaoSelo,
      },
      services,
      rating: { average: null, count: 0, label: PUBLIC_PROFILE_TEXTS.reputacaoSemAvaliacoes },
      recentReviews: [],
    },
  };
}
