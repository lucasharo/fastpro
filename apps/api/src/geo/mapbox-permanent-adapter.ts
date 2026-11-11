// H-021 | Adaptador do Geocoding v6 em modo permanente (docs/factory/68-DESENHO-H021.md, §4).
// Somente servidor. Diferente do temporario (H-020): permanent=true, limit=1, sem autocomplete.
// Sem cookies, sem IP, sem repasse de cabecalhos, tempo maximo de 4 s e NENHUMA retentativa.
// Toda falha vira um codigo fixo: mensagem, causa e URL (com texto e token) nunca saem daqui.
// O formato da resposta v6 e NAO VERIFICADO (desenho §4); a leitura e defensiva (mapPermanentResponse).
import { mapPermanentResponse, providerErrorCode } from '@fastpro/domain';
import type { GeocodingPermanentPort, PermanentLookup } from './permanent-ports.js';

export const MAPBOX_FORWARD_URL = 'https://api.mapbox.com/search/geocode/v6/forward' as const;
export const MAPBOX_PERMANENT_TIMEOUT_MS = 4_000;

export interface MapboxPermanentOptions {
  /** Token dedicado de servidor (MAPBOX_ACCESS_TOKEN_SERVER). Nunca registrado nem devolvido. */
  readonly token: string;
  /** fetch injetado: nos testes e um simulador; em producao, o global. */
  readonly fetchImpl: typeof fetch;
}

/** URL da consulta permanente: uma unica feicao, sem autocomplete, tipos de endereco. */
export function buildPermanentForwardUrl(query: string, token: string): URL {
  const url = new URL(MAPBOX_FORWARD_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('permanent', 'true');
  url.searchParams.set('autocomplete', 'false');
  url.searchParams.set('limit', '1');
  url.searchParams.set('country', 'br');
  url.searchParams.set('language', 'pt');
  url.searchParams.set('types', 'address,street,neighborhood,locality');
  url.searchParams.set('access_token', token);
  return url;
}

export function createMapboxPermanentAdapter(opts: MapboxPermanentOptions): GeocodingPermanentPort {
  return {
    async geocode(query: string): Promise<PermanentLookup> {
      // `cache` nao esta no tipo RequestInit do Node; a intersecao o declara sem alargar o tipo.
      const init: RequestInit & { readonly cache: 'no-store' } = {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(MAPBOX_PERMANENT_TIMEOUT_MS),
      };
      let res: Response;
      try {
        res = await opts.fetchImpl(buildPermanentForwardUrl(query, opts.token), init);
      } catch {
        // Tempo esgotado ou falha de transporte: codigo fixo, sem a causa original.
        return { status: 'falha', code: 'provider_timeout' };
      }
      if (!res.ok) return { status: 'falha', code: providerErrorCode(res.status) };
      let corpo: unknown;
      try {
        corpo = await res.json();
      } catch {
        return { status: 'falha', code: 'provider_shape' };
      }
      const mapa = mapPermanentResponse(corpo);
      if (mapa.status === 'ponto') return { status: 'ponto', point: mapa.point };
      if (mapa.status === 'sem_resultado') return { status: 'sem_resultado' };
      return { status: 'falha', code: 'provider_shape' };
    },
  };
}
