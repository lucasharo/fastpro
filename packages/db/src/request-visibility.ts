// Issue 45 (H-032) | Adaptador Pg da leitura do pedido por papel (docs/factory/127-DESENHO-H032.md, §6.2, §6.3, §8).
// So chama private.request_owner_get (dono) e private.request_detail_professional (profissional), papel app_system.
// Regras deste modulo:
//   - Recebe um SqlClient injetado: nao abre conexao, nao le variavel de ambiente, nao importa apps/*.
//   - Mapeia so as chaves da lista fechada (visibility.ts). Nenhuma coordenada, indice de celula, id de ponto
//     geocodificado, e-mail ou telefone volta ao chamador. O profissional nao recebe address_enc nem address_text.
//   - O dono recebe o blob cifrado (e, so em linha legada, o texto em claro); quem decifra e o servico da API.
//   - Erro do banco nunca e repassado: vira o codigo fixo VISIBILIDADE_BANCO_FALHOU.
import type { SqlClient } from './jobs-tick.js';

export const SQL_OWNER_GET = 'select * from private.request_owner_get($1::uuid, $2::uuid)';
export const SQL_DETAIL_PROFESSIONAL =
  'select * from private.request_detail_professional($1::uuid, $2::uuid, $3::timestamptz)';

/** Erro fixo: nunca carrega texto de driver, endereco ou identificador. */
export const VISIBILIDADE_BANCO_FALHOU = 'visibilidade_banco_falhou';

/** Linha do dono, antes da decifragem. addressEnc e o blob cifrado; addressTextLegado so existe ate a contracao (M2). */
export interface OwnerRequestRow {
  readonly id: string;
  readonly status: string;
  readonly serviceId: string;
  readonly serviceName: string;
  readonly urgency: string;
  readonly description: string;
  readonly firstName: string;
  readonly addressEnc: Uint8Array | null;
  readonly addressTextLegado: string | null;
  readonly publicLabel: string | null;
  readonly publishedAt: string;
  readonly acceptanceDeadlineAt: string;
}

/** Linha do profissional elegivel: so as chaves da RN-10 (sem coordenada, sem endereco). */
export interface ProfessionalRequestRow {
  readonly id: string;
  readonly serviceId: string;
  readonly serviceName: string;
  readonly urgency: string;
  readonly description: string;
  readonly publicLabel: string | null;
  readonly distanceKm: number | null;
  readonly modality: string;
  readonly publishedAt: string;
  readonly acceptanceDeadlineAt: string;
}

type Linha = Record<string, unknown>;

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : String(valor ?? '');
}

function textoOuNulo(valor: unknown): string | null {
  return valor === null || valor === undefined ? null : texto(valor);
}

function instante(valor: unknown): string {
  return valor instanceof Date ? valor.toISOString() : texto(valor);
}

function inteiro(valor: unknown): number {
  return typeof valor === 'number' ? valor : Number(valor ?? 0);
}

function bytes(valor: unknown): Uint8Array | null {
  if (valor === null || valor === undefined) return null;
  return valor instanceof Uint8Array ? valor : Buffer.from(texto(valor), 'utf8');
}

async function consultar(client: SqlClient, sql: string, params: unknown[]): Promise<Linha[]> {
  try {
    const r = await client.query(sql, params);
    return r.rows as Linha[];
  } catch {
    throw new Error(VISIBILIDADE_BANCO_FALHOU);
  }
}

export class PgRequestVisibilityStore {
  constructor(private readonly client: SqlClient) {}

  /** Le o pedido do dono. Devolve null (zero linhas) quando o pedido nao e dele: a rota responde 404 uniforme. */
  async readOwner(userId: string, requestId: string): Promise<OwnerRequestRow | null> {
    const rows = await consultar(this.client, SQL_OWNER_GET, [userId, requestId]);
    const r = rows[0];
    if (r === undefined) return null;
    return {
      id: texto(r.out_id),
      status: texto(r.out_status),
      serviceId: texto(r.out_service_id),
      serviceName: texto(r.out_service_name),
      urgency: texto(r.out_urgency),
      description: texto(r.out_description),
      firstName: texto(r.out_first_name),
      addressEnc: bytes(r.out_address_enc),
      addressTextLegado: textoOuNulo(r.out_address_text),
      publicLabel: textoOuNulo(r.out_public_label),
      publishedAt: instante(r.out_published_at),
      acceptanceDeadlineAt: instante(r.out_deadline_at),
    };
  }

  /**
   * Le o pedido para o profissional elegivel no instante dado. Devolve null quando a guarda falha, o pedido nao
   * existe, esta fechado, esta fora do raio ou nao casa: as quatro causas sao indistinguiveis para o chamador.
   */
  async readProfessional(
    professionalId: string,
    requestId: string,
    nowMs: number,
  ): Promise<ProfessionalRequestRow | null> {
    const rows = await consultar(this.client, SQL_DETAIL_PROFESSIONAL, [
      professionalId,
      requestId,
      new Date(nowMs).toISOString(),
    ]);
    const r = rows[0];
    if (r === undefined) return null;
    const distancia = r.out_distance_km;
    return {
      id: texto(r.out_id),
      serviceId: texto(r.out_service_id),
      serviceName: texto(r.out_service_name),
      urgency: texto(r.out_urgency),
      description: texto(r.out_description),
      publicLabel: textoOuNulo(r.out_public_label),
      distanceKm: distancia === null || distancia === undefined ? null : Number(distancia),
      modality: texto(r.out_modality),
      publishedAt: instante(r.out_published_at),
      acceptanceDeadlineAt: instante(r.out_deadline_at),
    };
  }
}
