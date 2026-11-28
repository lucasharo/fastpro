// Geocodificacao permanente pelo OpenStreetMap (Nominatim). Decisao do dono (2026-11-22): o Mapbox fica so no
// autocompletar e no mapa; a coordenada gravada vem do OpenStreetMap (gratuito; a licenca ODbL permite guardar).
// Uma consulta: rua, numero e cidade saem do rotulo do autocompletar ("Rua X 100, Bairro, Cidade - Estado, CEP, Brasil")
// e so vale candidato da mesma cidade (de preferencia do mesmo CEP). Sem cidade no texto, consulta livre.
// Mesmo contrato do adaptador Mapbox: nunca lanca, sem cookie, tempo maximo, falha vira codigo fixo.
import { isInsideBrazilBox, providerErrorCode, type PermanentPrecision } from '@fastpro/domain';
import type { GeocodingPermanentPort, PermanentLookup } from './permanent-ports.js';

export const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search' as const;
export const OSM_PERMANENT_TIMEOUT_MS = 4_000;
/** Identificacao generica exigida pela politica de uso do Nominatim (sem dado pessoal). */
export const GEOCODER_USER_AGENT = 'FastPro-DEV/0.1 (geocodificacao de enderecos)' as const;

export interface PartesEndereco {
  readonly rua?: string;
  readonly numero?: string;
  readonly cidade?: string;
  readonly estado?: string;
  /** CEP com 8 digitos, sem traco (so para preferir o candidato do mesmo CEP). */
  readonly cep?: string;
}

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Separa "Rua X 100, Bairro, Cidade - Estado, 01310-100, Brasil" (e "Rua X, 100, Cidade, UF"). */
export function separarEndereco(texto: string): PartesEndereco {
  const partes = texto.split(',').map((p) => p.trim()).filter((p) => p !== '');
  if (/^(brasil|brazil)$/i.test(partes[partes.length - 1] ?? '')) partes.pop();
  let cep: string | undefined;
  if (/^\d{5}(-?\d{3})?$/.test(partes[partes.length - 1] ?? '')) {
    const bruto = (partes.pop() ?? '').replace('-', '');
    if (bruto.length === 8) cep = bruto;
  }
  let cidade: string | undefined;
  let estado: string | undefined;
  const ultima = partes[partes.length - 1];
  if (partes.length > 1 && ultima !== undefined) {
    const m = /^(.+?)\s+-\s+(.+)$/.exec(ultima);
    if (m) {
      cidade = m[1]?.trim();
      estado = m[2]?.trim();
      partes.pop();
    } else if (/^[A-Z]{2}$/.test(ultima) && partes.length > 2) {
      estado = ultima;
      partes.pop();
      cidade = partes.pop();
    }
  }
  let rua = partes[0];
  let numero: string | undefined;
  if (rua !== undefined) {
    const m = /^(.*?\D)\s+(\d{1,6}[A-Za-z]?)$/.exec(rua);
    if (m) {
      rua = m[1]?.trim();
      numero = m[2];
    } else if (/^\d{1,6}[A-Za-z]?$/.test(partes[1] ?? '')) {
      numero = partes[1];
    }
  }
  return {
    ...(rua ? { rua } : {}),
    ...(numero ? { numero } : {}),
    ...(cidade ? { cidade } : {}),
    ...(estado ? { estado } : {}),
    ...(cep ? { cep } : {}),
  };
}

/** Precisao pelo place_rank do Nominatim (30 = imovel, 26 = rua, 17 a 25 = bairro, abaixo = cidade). */
export function precisaoNominatim(rank: number): PermanentPrecision {
  if (rank >= 28) return 'endereco';
  if (rank >= 26) return 'rua';
  if (rank >= 17) return 'bairro';
  return 'localidade';
}

function numero(v: unknown): number {
  return typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
}

function objeto(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Candidato da mesma cidade (quando conhecida), de preferencia o do mesmo CEP. Null = resposta fora do formato. */
export function escolherCandidato(corpo: unknown, partes: PartesEndereco): PermanentLookup | null {
  if (!Array.isArray(corpo)) return null;
  const cidade = partes.cidade ? normalizar(partes.cidade) : undefined;
  const validos = corpo
    .map(objeto)
    .filter((c) => isInsideBrazilBox(numero(c.lon), numero(c.lat)))
    .filter((c) => {
      if (cidade === undefined) return true;
      const a = objeto(c.address);
      return [a.city, a.town, a.village, a.municipality].some((n) => typeof n === 'string' && normalizar(n) === cidade);
    });
  const cepDe = (c: Record<string, unknown>) => String(objeto(c.address).postcode ?? '').replace(/\D/g, '');
  const escolhido = (partes.cep ? validos.find((c) => cepDe(c) === partes.cep) : undefined) ?? validos[0];
  if (escolhido === undefined) return { status: 'sem_resultado' };
  const rank = numero(escolhido.place_rank);
  return {
    status: 'ponto',
    point: {
      lon: numero(escolhido.lon),
      lat: numero(escolhido.lat),
      precision: precisaoNominatim(Number.isFinite(rank) ? rank : 0),
    },
  };
}

/** URL da consulta: estruturada (rua com numero, cidade, estado) quando ha rua e cidade; senao texto livre. */
export function urlNominatim(query: string, partes: PartesEndereco): URL {
  const url = new URL(NOMINATIM_SEARCH_URL);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '5');
  url.searchParams.set('countrycodes', 'br');
  url.searchParams.set('accept-language', 'pt-BR');
  if (partes.rua && partes.cidade) {
    url.searchParams.set('street', partes.numero ? `${partes.numero} ${partes.rua}` : partes.rua);
    url.searchParams.set('city', partes.cidade);
    if (partes.estado) url.searchParams.set('state', partes.estado);
  } else {
    url.searchParams.set('q', query);
  }
  return url;
}

export function createOsmPermanentAdapter(opts: { readonly fetchImpl: typeof fetch }): GeocodingPermanentPort {
  return {
    async geocode(query: string): Promise<PermanentLookup> {
      const partes = separarEndereco(query);
      const init: RequestInit & { readonly cache: 'no-store' } = {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        headers: { Accept: 'application/json', 'User-Agent': GEOCODER_USER_AGENT },
        signal: AbortSignal.timeout(OSM_PERMANENT_TIMEOUT_MS),
      };
      let res: Response;
      try {
        res = await opts.fetchImpl(urlNominatim(query, partes), init);
      } catch {
        return { status: 'falha', code: 'provider_timeout' };
      }
      if (!res.ok) return { status: 'falha', code: providerErrorCode(res.status) };
      let corpo: unknown;
      try {
        corpo = await res.json();
      } catch {
        return { status: 'falha', code: 'provider_shape' };
      }
      return escolherCandidato(corpo, partes) ?? { status: 'falha', code: 'provider_shape' };
    },
  };
}
