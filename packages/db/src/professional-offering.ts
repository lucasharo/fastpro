// H-036 | Adaptador Pg de servicos, base e raio do perfil profissional (docs/factory/99-DESENHO-H036.md, §2, §4, §5).
// So chama as funcoes private.professional_* (migracao 20261112160000) com o papel app_system. Nenhuma regra de
// negocio mora aqui: o banco decide (modalidade, base, limite de mudanca, status) e este modulo so traduz o resultado.
// Nenhuma coordenada, identificador de ponto, celula ou hash sai daqui exceto por professionalAreaAt, que e
// o contrato interno para #36/H-031 (usado por junção no banco).
import type { OfferingModality, ServiceRow } from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';

/** Status de verificacao do perfil (app.professional_profile.verification_status). */
export type ProfessionalOfferingProfileStatus =
  | 'pendente'
  | 'em_revisao'
  | 'aprovada'
  | 'retida_duplicidade'
  | 'recusada'
  | 'suspensa';

/** Base e raio vigentes, para o dono. Sem ponto, sem celula, sem identificador. */
export interface ProfessionalAreaView {
  readonly addressLabel: string;
  readonly radiusKm: number;
  readonly since: string;
  readonly changesRemaining: number;
  readonly nextChangeAt: string | null;
}

export type ProfessionalPrecheckStatus =
  | 'ok'
  | 'sem_perfil'
  | 'suspenso'
  | 'limite_escrita'
  | 'limite_mudanca'
  | 'limite_tentativas';

export interface ProfessionalPrecheckOutcome {
  readonly status: ProfessionalPrecheckStatus;
  readonly retryAfterS: number | null;
  readonly callsCap: number | null;
}

export type ProfessionalAreaSaveStatus =
  | 'definida'
  | 'alterada'
  | 'unchanged'
  | 'sem_perfil'
  | 'suspenso'
  | 'limite_mudanca'
  | 'dados_incompletos'
  | 'ponto_invalido'
  | 'raio_invalido';

export interface ProfessionalAreaSaveOutcome {
  readonly status: ProfessionalAreaSaveStatus;
  readonly retryAfterS: number | null;
}

export type ProfessionalServicesSaveStatus =
  | 'saved'
  | 'unchanged'
  | 'sem_perfil'
  | 'suspenso'
  | 'formato'
  | 'servico_indisponivel'
  | 'modalidade_incompativel'
  | 'base_obrigatoria'
  | 'limite_servicos'
  | 'limite_escrita';

export interface ProfessionalServicesSaveOutcome {
  readonly status: ProfessionalServicesSaveStatus;
  /** Posicao (0-based) do item na lista enviada ao banco, quando o erro aponta um item. */
  readonly index: number | null;
  readonly retryAfterS: number | null;
}

export interface ProfessionalServiceItem {
  readonly serviceId: string;
  readonly modality: OfferingModality;
}

/** Ponto de #36/H-031: base e raio vigentes num instante. Uso interno de junção; nunca vai para resposta. */
export interface ProfessionalAreaAtOutcome {
  readonly geocodePointId: string;
  readonly radiusM: number;
}

const PROFILE_STATUS = new Set([
  'pendente',
  'em_revisao',
  'aprovada',
  'retida_duplicidade',
  'recusada',
  'suspensa',
]);
const PRECHECK_STATUS = new Set([
  'ok',
  'sem_perfil',
  'suspenso',
  'limite_escrita',
  'limite_mudanca',
  'limite_tentativas',
]);
const AREA_SAVE_STATUS = new Set([
  'definida',
  'alterada',
  'unchanged',
  'sem_perfil',
  'suspenso',
  'limite_mudanca',
  'dados_incompletos',
  'ponto_invalido',
  'raio_invalido',
]);
const SERVICES_SAVE_STATUS = new Set([
  'saved',
  'unchanged',
  'sem_perfil',
  'suspenso',
  'formato',
  'servico_indisponivel',
  'modalidade_incompativel',
  'base_obrigatoria',
  'limite_servicos',
  'limite_escrita',
]);

const SQL_PROFILE_STATUS =
  'select p.verification_status from app.professional_profile p where p.user_id = $1::uuid';
const SQL_PRECHECK =
  'select out_status, out_retry_after, out_calls_cap from private.professional_area_precheck($1::uuid, $2::text, $3::text, $4::boolean, $5::timestamptz)';
const SQL_AREA_SAVE =
  'select out_status, out_retry_after from private.professional_area_save($1::uuid, $2::uuid, $3::text, $4::integer, $5::timestamptz)';
const SQL_SERVICES_SAVE =
  'select out_status, out_index, out_retry_after from private.professional_services_save($1::uuid, $2::jsonb, $3::timestamptz, $4::text)';
const SQL_SERVICES_LIST =
  'select out_service_id, out_name, out_regulated, out_active, out_modality from private.professional_services_list($1::uuid)';
const SQL_AREA_GET =
  'select out_configured, out_label, out_radius_m, out_valid_since, out_changes_remaining, out_next_change_at from private.professional_area_get($1::uuid, $2::timestamptz)';
const SQL_AREA_AT =
  'select out_geocode_point_id, out_radius_m from private.professional_area_at($1::uuid, $2::timestamptz)';
const SQL_PURGE = 'select private.professional_offering_purge($1::uuid) as ok';

function linha(rows: unknown[]): Record<string, unknown> | undefined {
  return rows[0] as Record<string, unknown> | undefined;
}

function inteiroOuNulo(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function isoOuNulo(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  const data = valor instanceof Date ? valor : new Date(String(valor));
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

/** Segundos para o Retry-After; quando o banco nao informa, nulo (a rota decide o texto). */
function segundos(valor: unknown): number | null {
  return inteiroOuNulo(valor);
}

export interface PgProfessionalOfferingDeps {
  readonly client: SqlClient;
}

export class PgProfessionalOffering {
  constructor(private readonly deps: PgProfessionalOfferingDeps) {}

  /** Status do perfil da conta, ou nulo quando a conta nao e profissional. */
  async profileStatus(userId: string): Promise<ProfessionalOfferingProfileStatus | null> {
    const res = await this.deps.client.query(SQL_PROFILE_STATUS, [userId]);
    const r = linha(res.rows);
    if (r === undefined) return null;
    const status = String(r.verification_status ?? '');
    if (!PROFILE_STATUS.has(status)) throw new Error('status_profissional_invalido');
    return status as ProfessionalOfferingProfileStatus;
  }

  /** Base e raio do dono; nulo quando ainda nao ha base. */
  async areaGet(userId: string, nowMs: number): Promise<ProfessionalAreaView | null> {
    const res = await this.deps.client.query(SQL_AREA_GET, [userId, new Date(nowMs).toISOString()]);
    const r = linha(res.rows);
    if (r === undefined || r.out_configured !== true) return null;
    const radiusM = inteiroOuNulo(r.out_radius_m) ?? 0;
    return {
      addressLabel: String(r.out_label ?? ''),
      radiusKm: radiusM / 1000,
      since: isoOuNulo(r.out_valid_since) ?? '',
      changesRemaining: inteiroOuNulo(r.out_changes_remaining) ?? 0,
      nextChangeAt: isoOuNulo(r.out_next_change_at),
    };
  }

  /** Pre-verificacao antes de qualquer chamada paga (desenho §5, passo 3). */
  async precheck(input: {
    readonly userId: string;
    readonly writeKey: string;
    readonly geocodeKey: string;
    readonly willGeocode: boolean;
    readonly nowMs: number;
  }): Promise<ProfessionalPrecheckOutcome> {
    const res = await this.deps.client.query(SQL_PRECHECK, [
      input.userId,
      input.writeKey,
      input.geocodeKey,
      input.willGeocode,
      new Date(input.nowMs).toISOString(),
    ]);
    const r = linha(res.rows);
    const status = String(r?.out_status ?? '');
    if (!PRECHECK_STATUS.has(status)) throw new Error('precheck_resultado_invalido');
    return {
      status: status as ProfessionalPrecheckStatus,
      retryAfterS: segundos(r?.out_retry_after),
      callsCap: inteiroOuNulo(r?.out_calls_cap),
    };
  }

  /**
   * Gravacao atomica da base e do raio. `pointId` e `label` nulos mantem o atual; `radiusKm` nulo mantem o raio.
   * Primeira definicao exige os tres (o banco responde dados_incompletos).
   */
  async areaSave(input: {
    readonly userId: string;
    readonly pointId: string | null;
    readonly label: string | null;
    readonly radiusKm: number | null;
    readonly nowMs: number;
  }): Promise<ProfessionalAreaSaveOutcome> {
    const res = await this.deps.client.query(SQL_AREA_SAVE, [
      input.userId,
      input.pointId,
      input.label,
      input.radiusKm,
      new Date(input.nowMs).toISOString(),
    ]);
    const r = linha(res.rows);
    const status = String(r?.out_status ?? '');
    if (!AREA_SAVE_STATUS.has(status)) throw new Error('area_resultado_invalido');
    return { status: status as ProfessionalAreaSaveStatus, retryAfterS: segundos(r?.out_retry_after) };
  }

  /** Substitui o conjunto de servicos. `index` devolve a posicao na lista enviada (a rota converte). */
  async servicesSave(input: {
    readonly userId: string;
    readonly items: readonly ProfessionalServiceItem[];
    readonly writeKey: string;
    readonly nowMs: number;
  }): Promise<ProfessionalServicesSaveOutcome> {
    const payload = JSON.stringify(
      input.items.map((i) => ({ service_id: i.serviceId, modality: i.modality })),
    );
    const res = await this.deps.client.query(SQL_SERVICES_SAVE, [
      input.userId,
      payload,
      new Date(input.nowMs).toISOString(),
      input.writeKey,
    ]);
    const r = linha(res.rows);
    const status = String(r?.out_status ?? '');
    if (!SERVICES_SAVE_STATUS.has(status)) throw new Error('servicos_resultado_invalido');
    return {
      status: status as ProfessionalServicesSaveStatus,
      index: inteiroOuNulo(r?.out_index),
      retryAfterS: segundos(r?.out_retry_after),
    };
  }

  /** Uma linha por (servico, modalidade) do dono. */
  async servicesList(userId: string): Promise<ServiceRow[]> {
    const res = await this.deps.client.query(SQL_SERVICES_LIST, [userId]);
    return res.rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        serviceId: String(row.out_service_id),
        name: String(row.out_name ?? ''),
        regulated: row.out_regulated === true,
        active: row.out_active === true,
        modality: String(row.out_modality) as OfferingModality,
      };
    });
  }

  /**
   * Contrato para #36 e H-031 (decisao 110): base e raio vigentes em `atMs`. Nulo quando nao havia base.
   * Uso interno de junção: o ponto nunca vai para resposta de API.
   */
  async areaAt(professionalId: string, atMs: number): Promise<ProfessionalAreaAtOutcome | null> {
    const res = await this.deps.client.query(SQL_AREA_AT, [professionalId, new Date(atMs).toISOString()]);
    const r = linha(res.rows);
    if (r === undefined || r.out_geocode_point_id === null || r.out_geocode_point_id === undefined) return null;
    return { geocodePointId: String(r.out_geocode_point_id), radiusM: inteiroOuNulo(r.out_radius_m) ?? 0 };
  }

  /** Expurgo do assunto (retencao e exclusao de conta). So para job de retencao e testes. */
  async purge(userId: string): Promise<void> {
    await this.deps.client.query(SQL_PURGE, [userId]);
  }
}
