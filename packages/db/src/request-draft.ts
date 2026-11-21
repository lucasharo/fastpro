// H-025 | Adaptadores Pg do rascunho sem conta (docs/factory/74-DESENHO-H025.md, §2, §3; D-10).
// Recebem um SqlClient injetado (sem abrir conexao, sem ler variavel de ambiente). A escrita passa so
// pelas funcoes private.draft_* (migracao 20261111440000). O IP nunca vai ao banco em claro: so o HMAC.
import {
  DRAFT_STATUSES,
  DRAFT_TTL_DAYS,
  type DraftCreateInput,
  type DraftIdentityRecord,
  type DraftIdentitySetInput,
  type DraftIdentityStorePort,
  type DraftPatchInput,
  type DraftRatePolicy,
  type DraftRatePort,
  type DraftRateCheck,
  type DraftRecord,
  type DraftStatus,
  type DraftStoreError,
  type DraftStorePort,
  type DraftUrgency,
  type DraftWriteResult,
  DRAFT_REVIEW_FIELDS,
  type DraftConfirmInput,
  type DraftConfirmResult,
  type DraftReviewField,
  type DraftReviewRecord,
  type DraftReviewStorePort,
} from '@fastpro/domain';
import { createHash } from 'node:crypto';
import type { SqlClient } from './jobs-tick.js';

export const SQL_DRAFT_GET = 'select * from private.draft_get($1, $2::timestamptz)';
export const SQL_DRAFT_CREATE =
  'select * from private.draft_create($1, $2, $3::timestamptz, $4::integer, $5, $6::jsonb, $7::integer)';
export const SQL_DRAFT_PATCH = 'select * from private.draft_patch($1, $2::timestamptz, $3::integer, $4::jsonb)';
export const SQL_DRAFT_DISCARD = 'select private.draft_discard($1, $2::timestamptz) as ok';
export const SQL_DRAFT_RL_CHECK =
  'select out_ok, out_retry_after from private.draft_rate_check($1, $2, $3, $4, $5::timestamptz)';
export const SQL_DRAFT_RL_HIT = 'select private.draft_rate_hit($1, $2, $3::timestamptz)';
/** H-013 (91 §2.5): identificacao do rascunho vivo, papel app_api. */
export const SQL_DRAFT_IDENTITY_GET = 'select * from private.draft_identity_get($1, $2::timestamptz)';
export const SQL_DRAFT_IDENTITY_SET =
  'select * from private.draft_identity_set($1, $2::timestamptz, $3, $4, $5)';
/** H-030 (90 §2.1, §2.2): revisao (so leitura) e confirmacao expressa, papel app_api. */
export const SQL_DRAFT_REVIEW_GET = 'select * from private.draft_review_get($1, $2::timestamptz)';
export const SQL_DRAFT_CONFIRM =
  'select * from private.draft_confirm($1, $2::timestamptz, $3::integer, $4::integer)';

/** Prefixo das chaves do limite de rascunho: separa do limite de busca e do de login. */
export const DRAFT_RATE_KEY_PREFIX = 'draft' as const;

const iso = (ms: number): string => new Date(ms).toISOString();

/** Linha de private.draft_* (colunas out_*). Datas podem vir como Date ou texto, conforme o driver. */
interface LinhaRascunho {
  readonly out_id: string;
  readonly out_status: string;
  readonly out_service_id: string | null;
  readonly out_address_text: string | null;
  readonly out_urgency: string | null;
  readonly out_description: string | null;
  readonly out_expires_at: Date | string;
  readonly out_updated_at: Date | string;
}

function isStatus(value: string): value is DraftStatus {
  return (DRAFT_STATUSES as readonly string[]).includes(value);
}

function paraRegistro(row: Record<string, unknown>): DraftRecord {
  const l = row as unknown as LinhaRascunho;
  if (typeof l.out_id !== 'string' || typeof l.out_status !== 'string' || !isStatus(l.out_status)) {
    throw new Error('rascunho_resposta_invalida');
  }
  return {
    id: l.out_id,
    status: l.out_status,
    serviceId: l.out_service_id,
    addressText: l.out_address_text,
    urgency: l.out_urgency as DraftUrgency | null,
    description: l.out_description,
    expiresAt: new Date(l.out_expires_at).toISOString(),
    updatedAt: new Date(l.out_updated_at).toISOString(),
  };
}

/** Codigos fixos que o banco pode levantar (mensagem da funcao). Qualquer outra falha sobe como erro. */
function codigoDoBanco(erro: unknown): DraftStoreError | null {
  const msg = erro instanceof Error ? erro.message : '';
  if (msg === 'servico_invalido') return 'servico_invalido';
  if (msg === 'teto_global_rascunhos') return 'teto_global';
  return null;
}

/** Linha de private.draft_identity_* (out_*). Valores nulos ficam nulos (rascunho sem identificacao). */
interface LinhaIdentidade {
  readonly out_first_name: string | null;
  readonly out_email: string | null;
  readonly out_email_verified: boolean | null;
}

function paraIdentidade(row: Record<string, unknown>): DraftIdentityRecord {
  const l = row as unknown as LinhaIdentidade;
  return {
    firstName: l.out_first_name ?? null,
    email: l.out_email ?? null,
    emailVerified: l.out_email_verified === true,
  };
}

/** H-030: linha de private.draft_review_get (out_*). Datas e arrays podem vir como Date, texto ou numero. */
interface LinhaRevisao {
  readonly out_id: string;
  readonly out_status: string;
  readonly out_service_id: string | null;
  readonly out_service_name: string | null;
  readonly out_service_active: boolean;
  readonly out_address_text: string | null;
  readonly out_urgency: string | null;
  readonly out_description: string | null;
  readonly out_first_name: string | null;
  readonly out_email: string | null;
  readonly out_email_verified: boolean;
  readonly out_confirmed_at: Date | string | null;
  readonly out_content_rev: number | string;
  readonly out_expires_at: Date | string;
}

function paraRevisao(row: Record<string, unknown>): DraftReviewRecord {
  const l = row as unknown as LinhaRevisao;
  if (typeof l.out_id !== 'string' || typeof l.out_status !== 'string' || !isStatus(l.out_status)) {
    throw new Error('revisao_resposta_invalida');
  }
  return {
    id: l.out_id,
    status: l.out_status,
    serviceId: l.out_service_id,
    serviceName: l.out_service_name,
    serviceActive: l.out_service_active === true,
    addressText: l.out_address_text,
    urgency: l.out_urgency as DraftUrgency | null,
    description: l.out_description,
    firstName: l.out_first_name,
    email: l.out_email,
    emailVerified: l.out_email_verified === true,
    confirmedAt: l.out_confirmed_at === null ? null : new Date(l.out_confirmed_at).toISOString(),
    contentRev: Number(l.out_content_rev),
    expiresAt: new Date(l.out_expires_at).toISOString(),
  };
}

/** H-030: linha de private.draft_confirm (out_result, out_confirmed_at, out_content_rev, out_missing). */
interface LinhaConfirmacao {
  readonly out_result: string | null;
  readonly out_confirmed_at: Date | string | null;
  readonly out_content_rev: number | string | null;
  readonly out_missing: string[] | null;
}

function isReviewField(value: string): value is DraftReviewField {
  return (DRAFT_REVIEW_FIELDS as readonly string[]).includes(value);
}

function paraConfirmacao(row: Record<string, unknown>): DraftConfirmResult {
  const l = row as unknown as LinhaConfirmacao;
  switch (l.out_result) {
    case 'ok':
      if (l.out_confirmed_at === null || l.out_content_rev === null) throw new Error('confirmacao_resposta_invalida');
      return {
        kind: 'ok',
        confirmedAt: new Date(l.out_confirmed_at).toISOString(),
        contentRev: Number(l.out_content_rev),
      };
    case 'nao_encontrado':
      return { kind: 'nao_encontrado' };
    case 'campos_faltando':
      return {
        kind: 'campos_faltando',
        missing: (l.out_missing ?? []).filter(isReviewField),
      };
    case 'email_nao_confirmado':
      return { kind: 'email_nao_confirmado' };
    case 'conteudo_alterado':
      return { kind: 'conteudo_alterado' };
    default:
      throw new Error('confirmacao_resposta_invalida');
  }
}

/** Rascunho no banco: leitura, criacao, salvamento, descarte, identificacao, revisao e confirmacao, por funcao. */
export class PgDraftStore implements DraftStorePort, DraftIdentityStorePort, DraftReviewStorePort {
  constructor(private readonly client: SqlClient) {}

  async reviewGet(secretHash: string, nowMs: number): Promise<DraftReviewRecord | null> {
    const res = await this.client.query(SQL_DRAFT_REVIEW_GET, [secretHash, iso(nowMs)]);
    const row = res.rows[0];
    return row === undefined ? null : paraRevisao(row);
  }

  async confirm(input: DraftConfirmInput): Promise<DraftConfirmResult> {
    const res = await this.client.query(SQL_DRAFT_CONFIRM, [
      input.secretHash,
      iso(input.nowMs),
      input.contentRev,
      input.ttlDays,
    ]);
    const row = res.rows[0];
    if (row === undefined) throw new Error('confirmacao_sem_linha');
    return paraConfirmacao(row);
  }

  async identityGet(secretHash: string, nowMs: number): Promise<DraftIdentityRecord | null> {
    const res = await this.client.query(SQL_DRAFT_IDENTITY_GET, [secretHash, iso(nowMs)]);
    const row = res.rows[0];
    return row === undefined ? null : paraIdentidade(row);
  }

  async identitySet(input: DraftIdentitySetInput): Promise<DraftIdentityRecord | null> {
    const res = await this.client.query(SQL_DRAFT_IDENTITY_SET, [
      input.secretHash,
      iso(input.nowMs),
      input.firstName,
      input.email,
      input.emailHmac,
    ]);
    const row = res.rows[0];
    return row === undefined ? null : paraIdentidade(row);
  }

  async find(secretHash: string, nowMs: number): Promise<DraftRecord | null> {
    const res = await this.client.query(SQL_DRAFT_GET, [secretHash, iso(nowMs)]);
    const row = res.rows[0];
    return row === undefined ? null : paraRegistro(row);
  }

  async create(input: DraftCreateInput): Promise<DraftWriteResult> {
    return this.escrever(
      SQL_DRAFT_CREATE,
      [
        input.secretHash,
        input.ipHmac,
        iso(input.nowMs),
        DRAFT_TTL_DAYS,
        input.expiredSecretHash,
        JSON.stringify(input.fields),
        input.liveCap,
      ],
      false,
    );
  }

  async patch(input: DraftPatchInput): Promise<DraftWriteResult> {
    return this.escrever(
      SQL_DRAFT_PATCH,
      [input.secretHash, iso(input.nowMs), DRAFT_TTL_DAYS, JSON.stringify(input.fields)],
      true,
    );
  }

  async discard(secretHash: string, nowMs: number): Promise<boolean> {
    const res = await this.client.query(SQL_DRAFT_DISCARD, [secretHash, iso(nowMs)]);
    return res.rows[0]?.['ok'] === true;
  }

  /**
   * Executa uma funcao de escrita. Sem linha: 'nao_encontrado' quando a ausencia e esperada (patch);
   * em criacao, sem linha e erro interno. 'servico_invalido' vira codigo; o resto sobe.
   */
  private async escrever(sql: string, params: unknown[], ausenciaEhNaoEncontrado: boolean): Promise<DraftWriteResult> {
    let rows: Record<string, unknown>[];
    try {
      rows = (await this.client.query(sql, params)).rows;
    } catch (erro) {
      const codigo = codigoDoBanco(erro);
      if (codigo !== null) return { ok: false, code: codigo };
      throw erro;
    }
    const row = rows[0];
    if (row === undefined) {
      if (ausenciaEhNaoEncontrado) return { ok: false, code: 'nao_encontrado' };
      throw new Error('rascunho_criacao_sem_linha');
    }
    return { ok: true, draft: paraRegistro(row) };
  }
}

/**
 * Limite de taxa do rascunho via private.rl_check / rl_hit (desenho §3, R1). A chave do balde e
 * 'draft:' + politica + ':' + valor, onde o valor ja vem em HMAC (IP) ou em hash (segredo).
 */
export class PgDraftRate implements DraftRatePort {
  constructor(private readonly client: SqlClient) {}

  /** rl_check/rl_hit exigem 64 hex (ops.rate_counter.key_hmac). O prefixo da politica entra no hash. */
  private chave(policy: DraftRatePolicy, key: string): string {
    return createHash('sha256').update(`${DRAFT_RATE_KEY_PREFIX}:${policy.id}:${key}`, 'utf8').digest('hex');
  }

  async check(policy: DraftRatePolicy, key: string, nowMs: number): Promise<DraftRateCheck> {
    const res = await this.client.query(SQL_DRAFT_RL_CHECK, [
      this.chave(policy, key),
      policy.spanS,
      policy.bucketS,
      policy.limit,
      iso(nowMs),
    ]);
    const row = res.rows[0] as { out_ok?: unknown; out_retry_after?: unknown } | undefined;
    if (typeof row?.out_ok !== 'boolean') throw new Error('rl_resposta_invalida');
    if (row.out_ok) return { ok: true };
    const espera = typeof row.out_retry_after === 'number' ? row.out_retry_after : policy.spanS;
    return { ok: false, retryAfterS: espera };
  }

  async hit(policy: DraftRatePolicy, key: string, nowMs: number): Promise<void> {
    await this.client.query(SQL_DRAFT_RL_HIT, [this.chave(policy, key), policy.bucketS, iso(nowMs)]);
  }
}
