// H-020 | Adaptador do Geocoding v6 em modo temporario (docs/factory/56-DESENHO-H020.md, §2.4, §5).
// Somente servidor. Sem `permanent` (resultado temporario), sem cookies, sem IP, sem repasse de cabecalhos.
// Tempo maximo de 2,5 s e nenhuma retentativa. Qualquer falha vira um codigo fixo: a mensagem, a causa e
// a URL da biblioteca (que contem o texto e o token) nunca saem daqui. O formato real da resposta e
// NAO VERIFICADO (S-04 §8); a leitura e defensiva.
import { providerErrorCode } from '@fastpro/domain';
import type { GeocodingTempPort, ProviderResult } from './ports.js';

export const MAPBOX_FORWARD_URL = 'https://api.mapbox.com/search/geocode/v6/forward' as const;
export const MAPBOX_TIMEOUT_MS = 2_500;

export interface MapboxTempOptions {
  /** Token dedicado de servidor (MAPBOX_ACCESS_TOKEN). Nunca registrado. */
  readonly token: string;
  /** fetch injetado: nos testes e uma fixture sintetica; em producao, o global. */
  readonly fetchImpl: typeof fetch;
}

/** Monta a URL da consulta temporaria. Nenhum parametro de permanencia. */
export function buildForwardUrl(q: string, token: string): URL {
  const url = new URL(MAPBOX_FORWARD_URL);
  url.searchParams.set('q', q);
  url.searchParams.set('autocomplete', 'true');
  url.searchParams.set('country', 'br');
  url.searchParams.set('language', 'pt');
  url.searchParams.set('limit', '5');
  url.searchParams.set('types', 'address,street,neighborhood,locality');
  url.searchParams.set('access_token', token);
  return url;
}

export function createMapboxTempAdapter(opts: MapboxTempOptions): GeocodingTempPort {
  return {
    async suggest(q: string): Promise<ProviderResult> {
      // `cache` nao esta no tipo RequestInit do Node; a intersecao o declara sem alargar o tipo.
      const init: RequestInit & { readonly cache: 'no-store' } = {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(MAPBOX_TIMEOUT_MS),
      };
      let res: Response;
      try {
        res = await opts.fetchImpl(buildForwardUrl(q, opts.token), init);
      } catch {
        // Tempo esgotado ou falha de transporte: um codigo fixo, sem a causa original.
        return { ok: false, code: 'provider_timeout' };
      }
      if (!res.ok) return { ok: false, code: providerErrorCode(res.status) };
      let corpo: unknown;
      try {
        corpo = await res.json();
      } catch {
        return { ok: false, code: 'provider_shape' };
      }
      const features =
        typeof corpo === 'object' && corpo !== null && 'features' in corpo
          ? (corpo as { features: unknown }).features
          : undefined;
      if (features === undefined) return { ok: false, code: 'provider_shape' };
      return { ok: true, features };
    },
  };
}
