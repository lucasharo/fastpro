// Issue 45 (H-032) | Visibilidade de localizacao: listas fechadas por papel, distancia e rotulo publico (logica pura).
// Docs: docs/factory/127-DESENHO-H032.md, §5, §6, §7. Fonte unica das chaves que cada papel pode ver (CA-11, RN-10).
// Sem rede, sem banco e sem relogio. Nenhuma funcao daqui recebe ou devolve coordenada.

/** Papeis de leitura. participant e admin_with_case ficam so como lista e teste (Rodada 92, decisao 423). */
export const VISIBILITY_ROLES = ['owner', 'eligible_professional', 'participant', 'admin_with_case'] as const;
export type VisibilityRole = (typeof VISIBILITY_ROLES)[number];

/** Chaves do dono (GET /v1/requests/:id), lista fechada. */
export const OWNER_KEYS = [
  'id',
  'status',
  'serviceId',
  'serviceName',
  'urgency',
  'description',
  'firstName',
  'addressText',
  'publicLabel',
  'publishedAt',
  'acceptanceDeadlineAt',
] as const;

/** Chaves do profissional elegivel (GET /v1/pro/requests/:id), lista fechada (RN-10). */
export const ELIGIBLE_PROFESSIONAL_KEYS = [
  'id',
  'serviceId',
  'serviceName',
  'urgency',
  'description',
  'publicLabel',
  'distanceKm',
  'modality',
  'publishedAt',
  'acceptanceDeadlineAt',
] as const;

export type VisibilityKey = (typeof OWNER_KEYS)[number] | (typeof ELIGIBLE_PROFESSIONAL_KEYS)[number];

export interface VisibilityFlags {
  /** true quando o dono de address_share liberou o endereco ao participante (decisao 409). */
  readonly addressShared: boolean;
}

/**
 * Chaves visiveis por papel. owner e eligible_professional sao as listas fechadas acima.
 * participant: as do profissional + firstName; + addressText so com addressShared.
 * admin_with_case: as do participante com addressText. O chamador so pede este papel com caso de acesso aberto.
 */
export function visibleKeys(role: VisibilityRole, flags: VisibilityFlags): readonly string[] {
  if (role === 'owner') return OWNER_KEYS;
  if (role === 'eligible_professional') return ELIGIBLE_PROFESSIONAL_KEYS;
  const participante: string[] = [...ELIGIBLE_PROFESSIONAL_KEYS, 'firstName'];
  if (role === 'admin_with_case' || flags.addressShared) participante.push('addressText');
  return participante;
}

/** Passo da distancia exibida ao profissional, em km (decisao 426). */
const PASSO_KM = 0.5;
const METROS_POR_PASSO = PASSO_KM * 1000;

/**
 * Distancia exibida, arredondada PARA CIMA em passos de 0,5 km, com minimo de 0,5 km (nunca "0 km").
 * Nunca fica abaixo da distancia real. Recebe a distancia entre centros de celula, em metros.
 */
export function roundDistanceKm(meters: number): number {
  if (!Number.isFinite(meters) || meters < 0) throw new RangeError('distancia_invalida');
  return Math.max(PASSO_KM, Math.ceil(meters / METROS_POR_PASSO) * PASSO_KM);
}

/** As 27 siglas de UF do Brasil. */
const UFS: ReadonlySet<string> = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

/** Palavras de via: se aparecem na cidade, o texto tem endereco e o rotulo e recusado. */
const PALAVRAS_DE_VIA = /\b(rua|avenida|av|travessa|rodovia|estrada|alameda|praca)\b/;

const CIDADE_MAX = 60;
const ROTULO_MIN = 3;
const ROTULO_MAX = 80;

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Rotulo publico "Cidade - UF", derivado do texto digitado pelo cliente (decisao 420). Regra estrita:
 * o ultimo segmento (apos a ultima virgula) termina em "- UF" ou "/UF", ou o segmento e so a UF e a cidade
 * e o segmento anterior. Recusa (null) se a UF nao for uma das 27, se a cidade tiver digito, "@", mais de 60
 * caracteres ou palavra de via. Sem rede: nunca chama provedor. Nulo e o estado seguro (a tela diz "Regiao aproximada").
 */
export function derivePublicLabel(addressText: string): string | null {
  const texto = addressText.normalize('NFC').trim();
  const partes = texto.split(',');
  const ultimo = (partes[partes.length - 1] ?? '').trim();

  let cidade: string;
  let uf: string;
  const comSeparador = /^(.+?)\s*[-/]\s*([A-Za-z]{2})$/.exec(ultimo);
  if (comSeparador !== null) {
    cidade = comSeparador[1] ?? '';
    uf = comSeparador[2] ?? '';
  } else {
    const soUf = /^([A-Za-z]{2})$/.exec(ultimo);
    if (soUf === null || partes.length < 2) return null;
    cidade = (partes[partes.length - 2] ?? '').trim();
    uf = soUf[1] ?? '';
  }

  uf = uf.toUpperCase();
  cidade = cidade.trim();
  if (!UFS.has(uf)) return null;
  if (cidade === '' || cidade.length > CIDADE_MAX) return null;
  if (/[0-9@]/.test(cidade)) return null;
  if (PALAVRAS_DE_VIA.test(semAcento(cidade).toLowerCase())) return null;

  const rotulo = `${cidade} - ${uf}`;
  if (rotulo.length < ROTULO_MIN || rotulo.length > ROTULO_MAX || /[0-9@]/.test(rotulo)) return null;
  return rotulo;
}
