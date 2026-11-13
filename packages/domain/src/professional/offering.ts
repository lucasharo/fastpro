// H-036 | Validacao pura da oferta do perfil profissional: servicos, base e raio (docs/factory/99-DESENHO-H036.md,
// §2.1, §2.2, §4.1, §4.2; decisoes 109 a 115). Sem I/O, sem banco e sem rede.
// A regra de negocio (modalidade, base, limite, status) fica no banco; aqui so ha formato, expansao de "ambos" e
// agrupamento para a resposta. Erros sao codigos fixos: nenhum eco do corpo, do texto, do raio ou de identificador.
import { permanentAddressKey } from '../geo/permanent-geocode.js';

/** Faixa do raio em km inteiros (CA-07, decisao 112). O banco guarda em metros. */
export const RADIUS_KM_MIN = 5;
export const RADIUS_KM_MAX = 100;

/** Modalidades que o profissional declara (a "ambos" do catalogo vira duas). */
export const OFFERING_MODALITIES = ['presencial', 'online'] as const;
export type OfferingModality = (typeof OFFERING_MODALITIES)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AreaFormatCode = 'formato' | 'raio_invalido' | 'endereco_invalido' | 'dados_incompletos';

export interface AreaInput {
  /** Texto normalizado (permanentAddressKey.query). Ausente quando so o raio muda. */
  readonly addressText?: string;
  /** Chave de comparacao (minusculas). Ausente quando so o raio muda. */
  readonly addressKey?: string;
  /** Raio em km inteiro (5..100). Ausente quando so o endereco muda. */
  readonly radiusKm?: number;
}

export type AreaInputCheck =
  | { readonly ok: true; readonly value: AreaInput }
  | { readonly ok: false; readonly code: AreaFormatCode };

const AREA_CAMPOS = new Set(['addressText', 'radiusKm']);

function objetoSimples(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/**
 * PUT /area: ao menos um campo; raio e inteiro JSON de 5 a 100 (`"5"`, `5.5`, `4`, `101` recusados);
 * texto e o endereco da sugestao (3..120 apos normalizacao). Campo extra recusa o corpo inteiro.
 */
export function checkProfessionalAreaInput(body: unknown): AreaInputCheck {
  if (!objetoSimples(body)) return { ok: false, code: 'formato' };
  for (const chave of Object.keys(body)) {
    if (!AREA_CAMPOS.has(chave)) return { ok: false, code: 'formato' };
  }
  const temEndereco = Object.prototype.hasOwnProperty.call(body, 'addressText');
  const temRaio = Object.prototype.hasOwnProperty.call(body, 'radiusKm');
  if (!temEndereco && !temRaio) return { ok: false, code: 'dados_incompletos' };

  const valor: { addressText?: string; addressKey?: string; radiusKm?: number } = {};
  if (temRaio) {
    const raio = body.radiusKm;
    if (typeof raio !== 'number' || !Number.isInteger(raio) || raio < RADIUS_KM_MIN || raio > RADIUS_KM_MAX) {
      return { ok: false, code: 'raio_invalido' };
    }
    valor.radiusKm = raio;
  }
  if (temEndereco) {
    const endereco = permanentAddressKey(body.addressText);
    if (!endereco.ok) return { ok: false, code: 'endereco_invalido' };
    valor.addressText = endereco.query;
    valor.addressKey = endereco.key;
  }
  return { ok: true, value: valor };
}

/** Um item por (servico, modalidade), na ordem do pedido. `index` aponta para o servico no pedido. */
export interface ServiceItem {
  readonly serviceId: string;
  readonly modality: OfferingModality;
  readonly index: number;
}

export interface ServiceRequest {
  readonly serviceId: string;
  readonly modalities: readonly OfferingModality[];
}

export type ServicesInputCheck =
  | { readonly ok: true; readonly services: readonly ServiceRequest[]; readonly items: readonly ServiceItem[] }
  | { readonly ok: false; readonly code: 'formato' | 'limite_servicos'; readonly index?: number };

function modalidadesValidas(valor: unknown): valor is OfferingModality[] {
  if (!Array.isArray(valor) || valor.length < 1 || valor.length > 2) return false;
  if (!valor.every((m) => (OFFERING_MODALITIES as readonly unknown[]).includes(m))) return false;
  return new Set(valor).size === valor.length;
}

/**
 * PUT /services: `{services:[{serviceId, modalities}]}`, ate `max` servicos distintos; modalidades 1 a 2 distintas.
 * "ambos" vira duas linhas (decisao 109). Campo extra, serviceId repetido ou formato errado recusam o corpo.
 * Lista vazia e valida (remove tudo).
 */
export function checkProfessionalServicesInput(body: unknown, max: number): ServicesInputCheck {
  if (!objetoSimples(body) || Object.keys(body).length !== 1 || !Array.isArray(body.services)) {
    return { ok: false, code: 'formato' };
  }
  const lista = body.services as unknown[];
  const services: ServiceRequest[] = [];
  const vistos = new Set<string>();
  for (let i = 0; i < lista.length; i += 1) {
    const item = lista[i];
    if (!objetoSimples(item)) return { ok: false, code: 'formato', index: i };
    const chaves = Object.keys(item);
    if (chaves.length !== 2 || !chaves.includes('serviceId') || !chaves.includes('modalities')) {
      return { ok: false, code: 'formato', index: i };
    }
    if (typeof item.serviceId !== 'string' || !UUID_RE.test(item.serviceId)) {
      return { ok: false, code: 'formato', index: i };
    }
    const id = item.serviceId.toLowerCase();
    if (vistos.has(id)) return { ok: false, code: 'formato', index: i };
    if (!modalidadesValidas(item.modalities)) return { ok: false, code: 'formato', index: i };
    vistos.add(id);
    services.push({ serviceId: id, modalities: item.modalities });
  }
  if (services.length > max) return { ok: false, code: 'limite_servicos' };

  const items: ServiceItem[] = [];
  services.forEach((s, index) => {
    for (const modality of s.modalities) items.push({ serviceId: s.serviceId, modality, index });
  });
  return { ok: true, services, items };
}

/** Campo de erro no formato da API: `services[i]` (indice do servico no pedido, nunca o valor). */
export function servicesFieldFor(index: number | undefined): string | null {
  return index === undefined ? null : `services[${index}]`;
}

/** Linha do banco (uma por modalidade) para a resposta: "ambos" aparece como duas modalidades num servico. */
export interface ServiceRow {
  readonly serviceId: string;
  readonly name: string;
  readonly regulated: boolean;
  readonly active: boolean;
  readonly modality: OfferingModality;
}

export interface ServiceView {
  readonly serviceId: string;
  readonly name: string;
  readonly regulated: boolean;
  readonly active: boolean;
  readonly modalities: OfferingModality[];
}

/** Agrupa as linhas por servico, na ordem por nome. Nao traz grupo interno nem dado de outro profissional. */
export function groupServiceRows(rows: readonly ServiceRow[]): ServiceView[] {
  const porServico = new Map<string, ServiceView & { modalities: OfferingModality[] }>();
  for (const r of rows) {
    const existente = porServico.get(r.serviceId);
    if (existente) {
      if (!existente.modalities.includes(r.modality)) existente.modalities.push(r.modality);
      continue;
    }
    porServico.set(r.serviceId, {
      serviceId: r.serviceId,
      name: r.name,
      regulated: r.regulated,
      active: r.active,
      modalities: [r.modality],
    });
  }
  return [...porServico.values()]
    .map((s) => ({ ...s, modalities: [...s.modalities].sort((a, b) => OFFERING_MODALITIES.indexOf(a) - OFFERING_MODALITIES.indexOf(b)) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}
