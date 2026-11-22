// Geocodificacao permanente sem Mapbox (decisao do dono, 2026-11-22): o Mapbox fica so no autocompletar e no mapa.
// O texto do endereco (rotulo do autocompletar: "Rua X 100, Bairro, Cidade - Estado, 01310-100, Brasil") e separado em
// rua, numero, cidade, estado e CEP. Com CEP de 8 digitos, a BrasilAPI (reserva: ViaCEP) completa rua, cidade e estado. A coordenada vem do
// Nominatim (OpenStreetMap), por consulta estruturada, aceitando so candidato da mesma cidade (e do mesmo CEP, quando
// houver). Ultimo recurso: a coordenada que a BrasilAPI devolve para o CEP, que e o centro da cidade (precisao localidade).
// BrasilAPI e OpenStreetMap sao gratuitos e permitem guardar a coordenada (OpenStreetMap: ODbL, credito "© OpenStreetMap").
// Mesmo contrato do adaptador Mapbox: nunca lanca, sem cookie, sem repasse de cabecalho, tempo maximo por chamada,
// falha vira codigo fixo e nada do texto ou da resposta bruta sai daqui.
import { isInsideBrazilBox, providerErrorCode, type PermanentPrecision } from '@fastpro/domain';
import type { GeocodingPermanentPort, PermanentLookup } from './permanent-ports.js';

export const BRASILAPI_CEP_URL = 'https://brasilapi.com.br/api/cep/v2/' as const;
export const VIACEP_URL = 'https://viacep.com.br/ws/' as const;
export const NOMINATIM_SEARCH_URL ='https://nominatim.openstreetmap.org/search' as const;
export const CEP_PERMANENT_TIMEOUT_MS = 3_500;
/** Identificacao generica exigida pela politica de uso do Nominatim (sem dado pessoal). */
export const GEOCODER_USER_AGENT = 'FastPro-DEV/0.1 (geocodificacao de enderecos)' as const;

export interface CepPermanentOptions {
  readonly fetchImpl: typeof fetch;
}

/** Partes do endereco. Todas opcionais: o texto pode ser livre. */
export interface PartesEndereco {
  readonly rua?: string;
  readonly numero?: string;
  readonly cidade?: string;
  readonly estado?: string;
  /** CEP com 8 digitos, sem traco. */
  readonly cep?: string;
}

/** Sem acento e em minusculas, para comparar nomes de cidade. */
export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** CEP de 8 digitos em qualquer parte do texto, ou null. */
export function extrairCep(texto: string): string | null {
  const m = /(?<!\d)(\d{5})-?(\d{3})(?!\d)/.exec(texto);
  return m ? `${m[1]}${m[2]}` : null;
}

/** Separa "Rua X 100, Bairro, Cidade - Estado, 01310-100, Brasil" (e variacoes com virgula antes do numero). */
export function separarEndereco(texto: string): PartesEndereco {
  const partes = texto
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '');
  if (partes.length > 0 && /^brasil$|^brazil$/i.test(partes[partes.length - 1] ?? '')) partes.pop();
  let cep: string | undefined;
  if (partes.length > 0 && /^\d{5}(-?\d{3})?$/.test(partes[partes.length - 1] ?? '')) {
    const bruto = (partes.pop() ?? '').replace('-', '');
    if (bruto.length === 8) cep = bruto;
  }
  cep ??= extrairCep(texto) ?? undefined;
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

/** Precisao a partir do place_rank do Nominatim (30 = imovel, 26 = rua, 17 a 25 = bairro, abaixo = cidade). */
export function precisaoNominatim(rank: number): PermanentPrecision {
  if (rank >= 28) return 'endereco';
  if (rank >= 26) return 'rua';
  if (rank >= 17) return 'bairro';
  return 'localidade';
}

type Chamada = { ok: true; corpo: unknown } | { ok: false; status: number | 'timeout' | 'shape' };

async function chamar(fetchImpl: typeof fetch, url: URL): Promise<Chamada> {
  const init: RequestInit & { readonly cache: 'no-store' } = {
    method: 'GET',
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    headers: { Accept: 'application/json', 'User-Agent': GEOCODER_USER_AGENT },
    signal: AbortSignal.timeout(CEP_PERMANENT_TIMEOUT_MS),
  };
  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch {
    return { ok: false, status: 'timeout' };
  }
  if (!res.ok) return { ok: false, status: res.status };
  try {
    return { ok: true, corpo: await res.json() };
  } catch {
    return { ok: false, status: 'shape' };
  }
}

function numero(v: unknown): number {
  return typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
}

function texto(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function objeto(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Resposta da BrasilAPI: campos do CEP e a coordenada dela (centro da cidade), quando valida. */
export function lerBrasilApi(corpo: unknown): {
  readonly rua?: string;
  readonly cidade?: string;
  readonly estado?: string;
  readonly centro: { lon: number; lat: number } | null;
} {
  const o = objeto(corpo);
  const coord = objeto(objeto(o.location).coordinates);
  const lon = numero(coord.longitude);
  const lat = numero(coord.latitude);
  const rua = texto(o.street);
  const cidade = texto(o.city);
  const estado = texto(o.state);
  return {
    ...(rua ? { rua } : {}),
    ...(cidade ? { cidade } : {}),
    ...(estado ? { estado } : {}),
    centro: isInsideBrazilBox(lon, lat) ? { lon, lat } : null,
  };
}

/** Resposta do ViaCEP ({erro: true} para CEP inexistente): so campos, sem coordenada. */
export function lerViaCep(corpo: unknown): { readonly rua?: string; readonly cidade?: string; readonly estado?: string } {
  const o = objeto(corpo);
  if (o.erro === true || o.erro === 'true') return {};
  const rua = texto(o.logradouro);
  const cidade = texto(o.localidade);
  const estado = texto(o.uf);
  return { ...(rua ? { rua } : {}), ...(cidade ? { cidade } : {}), ...(estado ? { estado } : {}) };
}

/** Escolhe o candidato do Nominatim: mesma cidade (quando conhecida), de preferencia o mesmo CEP. */
export function escolherCandidato(corpo: unknown, partes: PartesEndereco): PermanentLookup | null {
  if (!Array.isArray(corpo)) return null;
  const cidade = partes.cidade ? normalizar(partes.cidade) : undefined;
  const validos = corpo
    .map((c) => objeto(c))
    .filter((c) => isInsideBrazilBox(numero(c.lon), numero(c.lat)))
    .filter((c) => {
      if (cidade === undefined) return true;
      const a = objeto(c.address);
      const nomes = [a.city, a.town, a.village, a.municipality].map((n) => (typeof n === 'string' ? normalizar(n) : ''));
      return nomes.includes(cidade);
    });
  const cepDe = (c: Record<string, unknown>) => String(objeto(c.address).postcode ?? '').replace(/\D/g, '');
  const escolhido =
    (partes.cep ? validos.find((c) => cepDe(c) === partes.cep) : undefined) ?? validos[0];
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

function urlBase(): URL {
  const url = new URL(NOMINATIM_SEARCH_URL);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '5');
  url.searchParams.set('countrycodes', 'br');
  url.searchParams.set('accept-language', 'pt-BR');
  return url;
}

/** Consulta estruturada (rua com ou sem numero, cidade e estado). */
export function urlEstruturada(partes: PartesEndereco, comNumero: boolean): URL {
  const url = urlBase();
  const rua = partes.rua ?? '';
  url.searchParams.set('street', comNumero && partes.numero ? `${partes.numero} ${rua}` : rua);
  if (partes.cidade) url.searchParams.set('city', partes.cidade);
  if (partes.estado) url.searchParams.set('state', partes.estado);
  return url;
}

export function urlLivre(query: string): URL {
  const url = urlBase();
  url.searchParams.set('q', query);
  return url;
}

export function createCepPermanentAdapter(opts: CepPermanentOptions): GeocodingPermanentPort {
  return {
    async geocode(query: string): Promise<PermanentLookup> {
      let partes = separarEndereco(query);
      let centroDoCep: { lon: number; lat: number } | null = null;
      if (partes.cep) {
        const r = await chamar(opts.fetchImpl, new URL(`${BRASILAPI_CEP_URL}${partes.cep}`));
        // BrasilAPI fora do ar: o ViaCEP confirma rua, cidade e estado (ele nao tem coordenada).
        const via = r.ok ? null : await chamar(opts.fetchImpl, new URL(`${VIACEP_URL}${partes.cep}/json/`));
        if (via?.ok) {
          const v = lerViaCep(via.corpo);
          partes = {
            ...partes,
            ...(v.cidade ? { cidade: v.cidade } : {}),
            ...(v.estado ? { estado: v.estado } : {}),
            ...(partes.rua ? {} : v.rua ? { rua: v.rua } : {}),
          };
        }
        if (r.ok) {
          const b = lerBrasilApi(r.corpo);
          centroDoCep = b.centro;
          // O CEP manda na cidade e no estado; a rua do texto prevalece (traz o numero e a grafia escolhida).
          partes = {
            ...partes,
            ...(b.cidade ? { cidade: b.cidade } : {}),
            ...(b.estado ? { estado: b.estado } : {}),
            ...(partes.rua ? {} : b.rua ? { rua: b.rua } : {}),
          };
        }
      }

      const tentativas: URL[] = [];
      if (partes.rua && partes.cidade) {
        if (partes.numero) tentativas.push(urlEstruturada(partes, true));
        tentativas.push(urlEstruturada(partes, false));
      } else {
        tentativas.push(urlLivre(query));
      }

      let ultimaFalha: PermanentLookup | null = null;
      for (const url of tentativas) {
        const r = await chamar(opts.fetchImpl, url);
        if (!r.ok) {
          ultimaFalha = { status: 'falha', code: providerErrorCode(r.status) };
          continue;
        }
        const lido = escolherCandidato(r.corpo, partes);
        if (lido === null) {
          ultimaFalha = { status: 'falha', code: 'provider_shape' };
          continue;
        }
        if (lido.status === 'ponto') return lido;
      }
      if (centroDoCep !== null) return { status: 'ponto', point: { ...centroDoCep, precision: 'localidade' } };
      return ultimaFalha ?? { status: 'sem_resultado' };
    },
  };
}
