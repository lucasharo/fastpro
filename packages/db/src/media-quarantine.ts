// H-026 (Issue #39) | Adaptadores da quarentena de fotos (docs/factory/88-DESENHO-H026.md, §1, §2, §4).
// PgMediaStore: so funcoes private.media_* (migracao 20261112120000), via SqlClient injetado.
// SupabaseQuarantineStorage: API REST do Storage, bucket fixo 'quarantine', chave 'd/<uuid>'. A chave de servico
// vem do ambiente do servidor, nunca de tabela, log ou resposta. Nenhum metodo baixa o conteudo do arquivo.
import {
  MEDIA_BUCKET,
  MEDIA_MAX_BYTES,
  MEDIA_REDUCED_BUCKET,
  isMediaId,
  isMediaRejectCode,
  mediaIdFromKey,
  mediaReducedKey,
  type MediaFinalizeResult,
  type MediaIssueInput,
  type MediaIssueResult,
  type MediaRecord,
  type MediaReduceBeginResult,
  type MediaReduceDoneCode,
  type MediaReduceRejectOut,
  type MediaReduceStoragePort,
  type MediaRejectCode,
  type MediaStorePort,
  type QuarantineStoragePort,
} from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';

export const SQL_MEDIA_ISSUE =
  'select out_code, out_id, out_status, out_confirmed from private.media_issue($1, $2::uuid, $3, $4::integer, $5::timestamptz, $6::integer)';
export const SQL_MEDIA_GET = 'select out_id, out_status, out_confirmed from private.media_get($1, $2::uuid, $3::timestamptz)';
export const SQL_MEDIA_FINALIZE =
  'select out_code, out_id, out_status, out_confirmed from private.media_finalize($1, $2::uuid, $3::integer, $4::timestamptz)';
export const SQL_MEDIA_SWEEP = 'select out_id from private.media_sweep($1::timestamptz, $2::integer)';
export const SQL_MEDIA_PURGE_DONE = 'select private.media_purge_done($1::uuid[]) as n';
export const SQL_MEDIA_KNOWN = 'select id from private.media_known($1::uuid[]) as id';
// H-027 (Issue #40): reducao (docs/factory/93-DESENHO-H027.md, §3 e §4). Todas via private.media_* (app_api).
export const SQL_MEDIA_REDUCE_BEGIN =
  'select out_code, out_attempt, out_reject_code, out_original_pending from private.media_reduce_begin($1::text, $2::uuid, $3::timestamptz, $4::integer)';
export const SQL_MEDIA_REDUCE_DONE =
  'select out_code from private.media_reduce_done($1::uuid, $2::smallint, $3::integer, $4::integer, $5::integer, $6::timestamptz)';
export const SQL_MEDIA_REDUCE_REJECT = 'select out_code from private.media_reduce_reject($1::uuid, $2::smallint, $3::text, $4::timestamptz)';
export const SQL_MEDIA_REDUCE_RELEASE = 'select private.media_reduce_release($1::uuid, $2::smallint, $3::boolean) as ok';
export const SQL_MEDIA_ORIGINAL_REMOVED = 'select private.media_original_removed($1::uuid, $2::timestamptz) as ok';
export const SQL_MEDIA_ORIGINAL_CLEANUP = 'select private.media_original_cleanup_list($1::integer) as ids';

const iso = (ms: number): string => new Date(ms).toISOString();

interface LinhaMidia {
  readonly out_code?: unknown;
  readonly out_id: unknown;
  readonly out_status: unknown;
  readonly out_confirmed: unknown;
}

function paraRegistro(row: LinhaMidia): MediaRecord {
  if (typeof row.out_id !== 'string' || typeof row.out_status !== 'string' || typeof row.out_confirmed !== 'boolean') {
    throw new Error('midia_resposta_invalida');
  }
  return {
    id: row.out_id,
    status: row.out_status as MediaRecord['status'],
    confirmed: row.out_confirmed,
  };
}

/** photo_limit vem do trigger de limite (23514); qualquer outra falha sobe sem texto de banco. */
function ehLimiteFotos(erro: unknown): boolean {
  return erro instanceof Error && erro.message === 'photo_limit';
}

export class PgMediaStore implements MediaStorePort {
  constructor(private readonly client: SqlClient) {}

  async issue(input: MediaIssueInput): Promise<MediaIssueResult> {
    let row: LinhaMidia | undefined;
    try {
      const res = await this.client.query(SQL_MEDIA_ISSUE, [
        input.secretHash,
        input.clientUploadId,
        input.type,
        input.bytes,
        iso(input.nowMs),
        input.globalCap,
      ]);
      row = res.rows[0] as LinhaMidia | undefined;
    } catch (erro) {
      if (ehLimiteFotos(erro)) return { code: 'photo_limit', media: null };
      throw erro;
    }
    if (row === undefined) throw new Error('midia_resposta_invalida');
    const code = row.out_code;
    if (code !== 'new' && code !== 'replay' && code !== 'not_found' && code !== 'photo_limit' && code !== 'cap') {
      throw new Error('midia_resposta_invalida');
    }
    if (code === 'not_found' || code === 'photo_limit' || code === 'cap') return { code, media: null };
    return { code, media: paraRegistro(row) };
  }

  async get(secretHash: string, id: string, nowMs: number): Promise<MediaRecord | null> {
    const res = await this.client.query(SQL_MEDIA_GET, [secretHash, id, iso(nowMs)]);
    const row = res.rows[0] as LinhaMidia | undefined;
    return row === undefined ? null : paraRegistro(row);
  }

  async finalize(secretHash: string, id: string, storedBytes: number | null, nowMs: number): Promise<MediaFinalizeResult> {
    const res = await this.client.query(SQL_MEDIA_FINALIZE, [secretHash, id, storedBytes, iso(nowMs)]);
    const row = res.rows[0] as LinhaMidia | undefined;
    if (row === undefined) throw new Error('midia_resposta_invalida');
    const code = row.out_code;
    if (
      code !== 'confirmed' &&
      code !== 'replay' &&
      code !== 'not_found' &&
      code !== 'expired' &&
      code !== 'missing' &&
      code !== 'too_large'
    ) {
      throw new Error('midia_resposta_invalida');
    }
    if (code === 'not_found' || code === 'expired' || code === 'missing' || code === 'too_large') {
      return { code, media: null };
    }
    return { code, media: paraRegistro(row) };
  }

  async sweep(nowMs: number, limit: number): Promise<readonly string[]> {
    const res = await this.client.query(SQL_MEDIA_SWEEP, [iso(nowMs), limit]);
    return res.rows.map((r) => String((r as { out_id: unknown }).out_id));
  }

  async purgeDone(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const res = await this.client.query(SQL_MEDIA_PURGE_DONE, [ids]);
    const n = (res.rows[0] as { n?: unknown } | undefined)?.n;
    return typeof n === 'number' ? n : Number(n ?? 0);
  }

  async known(ids: readonly string[]): Promise<readonly string[]> {
    if (ids.length === 0) return [];
    const res = await this.client.query(SQL_MEDIA_KNOWN, [ids]);
    return res.rows.map((r) => String((r as { id: unknown }).id));
  }

  async reduceBegin(secretHash: string, id: string, nowMs: number, leaseS: number): Promise<MediaReduceBeginResult> {
    const res = await this.client.query(SQL_MEDIA_REDUCE_BEGIN, [secretHash, id, iso(nowMs), leaseS]);
    const row = res.rows[0] as
      | { out_code?: unknown; out_attempt?: unknown; out_reject_code?: unknown; out_original_pending?: unknown }
      | undefined;
    const code = row?.out_code;
    if (
      row === undefined ||
      (code !== 'begin' && code !== 'ready' && code !== 'rejected' && code !== 'busy' && code !== 'not_confirmed' && code !== 'not_found') ||
      typeof row.out_original_pending !== 'boolean'
    ) {
      throw new Error('midia_resposta_invalida');
    }
    const attempt = row.out_attempt === null || row.out_attempt === undefined ? null : Number(row.out_attempt);
    const rejectCode = isMediaRejectCode(row.out_reject_code) ? row.out_reject_code : null;
    return { code, attempt, rejectCode, originalPending: row.out_original_pending };
  }

  async reduceDone(id: string, attempt: number, bytes: number, width: number, height: number, nowMs: number): Promise<MediaReduceDoneCode> {
    const res = await this.client.query(SQL_MEDIA_REDUCE_DONE, [id, attempt, bytes, width, height, iso(nowMs)]);
    const code = (res.rows[0] as { out_code?: unknown } | undefined)?.out_code;
    if (code !== 'done' && code !== 'lost' && code !== 'gone') throw new Error('midia_resposta_invalida');
    return code;
  }

  async reduceReject(id: string, attempt: number, code: MediaRejectCode, nowMs: number): Promise<MediaReduceRejectOut> {
    const res = await this.client.query(SQL_MEDIA_REDUCE_REJECT, [id, attempt, code, iso(nowMs)]);
    const out = (res.rows[0] as { out_code?: unknown } | undefined)?.out_code;
    if (out !== 'rejected' && out !== 'lost' && out !== 'gone') throw new Error('midia_resposta_invalida');
    return out;
  }

  async reduceRelease(id: string, attempt: number, count: boolean): Promise<boolean> {
    const res = await this.client.query(SQL_MEDIA_REDUCE_RELEASE, [id, attempt, count]);
    return (res.rows[0] as { ok?: unknown } | undefined)?.ok === true;
  }

  async originalRemoved(id: string, nowMs: number): Promise<boolean> {
    const res = await this.client.query(SQL_MEDIA_ORIGINAL_REMOVED, [id, iso(nowMs)]);
    return (res.rows[0] as { ok?: unknown } | undefined)?.ok === true;
  }

  async originalCleanupList(limit: number): Promise<readonly string[]> {
    const res = await this.client.query(SQL_MEDIA_ORIGINAL_CLEANUP, [limit]);
    const ids = (res.rows[0] as { ids?: unknown } | undefined)?.ids;
    return Array.isArray(ids) ? ids.map((x) => String(x)) : [];
  }
}

/** Falha do Storage com codigo fixo: sem URL, chave, token ou caminho na mensagem. */
export class QuarantineStorageError extends Error {
  readonly code = 'storage_falha' as const;
  constructor() {
    super('storage_falha');
    this.name = 'QuarantineStorageError';
  }
}

export interface QuarantineStorageOpcoes {
  /** URL base do projeto (sem barra final). Vem do ambiente. */
  readonly baseUrl: string;
  /** Chave de servico do Storage. Vem do ambiente do servidor; nunca e registrada. */
  readonly serviceKey: string;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Adaptador REST do bucket quarantine. Endpoints [NAO VERIFICADO] contra o Storage remoto (o bucket ainda nao
 * existe la; ver a entrega): upload/sign, object/info, object/list e DELETE em object/{bucket}/{key}.
 */
export class SupabaseQuarantineStorage implements QuarantineStoragePort {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: QuarantineStorageOpcoes) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private cabecalhos(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: `Bearer ${this.opts.serviceKey}`, apikey: this.opts.serviceKey, ...extra };
  }

  private caminho(key: string): string {
    const id = mediaIdFromKey(key);
    if (id === null) throw new QuarantineStorageError();
    return `d/${id}`;
  }

  private async chamar(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, init);
    } catch {
      throw new QuarantineStorageError();
    }
  }

  /**
   * O validade do token e a do proprio Storage (nao ha parametro de TTL nesta chamada). O prazo do pendente
   * (30 min) e aplicado pelo banco; a validade real do token fica [NAO VERIFICADO] (88 §3, R2).
   */
  async createUploadUrl(key: string): Promise<{ readonly url: string }> {
    const path = this.caminho(key);
    const res = await this.chamar(`${this.opts.baseUrl}/storage/v1/object/upload/sign/${MEDIA_BUCKET}/${path}`, {
      method: 'POST',
      headers: this.cabecalhos({ 'content-type': 'application/json' }),
      body: '{}',
    });
    if (!res.ok) throw new QuarantineStorageError();
    const corpo = (await res.json().catch(() => null)) as { url?: unknown } | null;
    if (corpo === null || typeof corpo.url !== 'string' || corpo.url.length === 0) throw new QuarantineStorageError();
    const relativo = corpo.url.startsWith('/storage/v1') ? corpo.url : `/storage/v1${corpo.url}`;
    return { url: `${this.opts.baseUrl}${relativo}` };
  }

  async stat(key: string): Promise<{ readonly bytes: number } | null> {
    const path = this.caminho(key);
    const res = await this.chamar(`${this.opts.baseUrl}/storage/v1/object/info/${MEDIA_BUCKET}/${path}`, {
      method: 'GET',
      headers: this.cabecalhos(),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new QuarantineStorageError();
    const corpo = (await res.json().catch(() => null)) as { size?: unknown; metadata?: { size?: unknown } } | null;
    const tamanho = corpo?.size ?? corpo?.metadata?.size;
    if (typeof tamanho !== 'number' || !Number.isFinite(tamanho)) throw new QuarantineStorageError();
    return { bytes: tamanho };
  }

  async remove(key: string): Promise<void> {
    const path = this.caminho(key);
    const res = await this.chamar(`${this.opts.baseUrl}/storage/v1/object/${MEDIA_BUCKET}/${path}`, {
      method: 'DELETE',
      headers: this.cabecalhos(),
    });
    if ((res.status >= 200 && res.status < 300) || res.status === 404) return;
    throw new QuarantineStorageError();
  }

  async listOlderThan(antesDeMs: number, limite: number): Promise<readonly string[]> {
    const res = await this.chamar(`${this.opts.baseUrl}/storage/v1/object/list/${MEDIA_BUCKET}`, {
      method: 'POST',
      headers: this.cabecalhos({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        prefix: 'd',
        limit: limite,
        offset: 0,
        sortBy: { column: 'created_at', order: 'asc' },
      }),
    });
    if (!res.ok) throw new QuarantineStorageError();
    const itens = (await res.json().catch(() => null)) as unknown;
    if (!Array.isArray(itens)) throw new QuarantineStorageError();
    const chaves: string[] = [];
    for (const item of itens as { name?: unknown; created_at?: unknown }[]) {
      if (typeof item.name !== 'string' || typeof item.created_at !== 'string') continue;
      if (Date.parse(item.created_at) >= antesDeMs) continue;
      if (isMediaId(item.name)) chaves.push(`d/${item.name.toLowerCase()}`);
    }
    return chaves;
  }
}

/**
 * H-027 (Issue #40) | Storage da reducao (93 §4.1). Unico lugar que le o original 'd/<uuid>' (so para reduzir,
 * chamado por reduceMedia) e o unico que grava/remove 'p/<uuid>' no bucket request-photos. Sem URL de leitura
 * para visitante, sem assinatura, sem download exposto a rota. Endpoints [NAO VERIFICADO] contra o Storage remoto.
 */
export class SupabaseMediaReduceStorage implements MediaReduceStoragePort {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: QuarantineStorageOpcoes) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private cabecalhos(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: `Bearer ${this.opts.serviceKey}`, apikey: this.opts.serviceKey, ...extra };
  }

  private url(bucket: string, path: string): string {
    return `${this.opts.baseUrl}/storage/v1/object/${bucket}/${path}`;
  }

  private async chamar(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, init);
    } catch {
      throw new QuarantineStorageError();
    }
  }

  private chaveOriginal(id: string): string {
    if (!isMediaId(id)) throw new QuarantineStorageError();
    return `d/${id.toLowerCase()}`;
  }

  private chaveReduzida(id: string): string {
    if (!isMediaId(id)) throw new QuarantineStorageError();
    return mediaReducedKey(id.toLowerCase());
  }

  async readOriginal(id: string): Promise<Uint8Array | null> {
    const res = await this.chamar(this.url(MEDIA_BUCKET, this.chaveOriginal(id)), {
      method: 'GET',
      headers: this.cabecalhos(),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new QuarantineStorageError();
    const declarado = Number(res.headers.get('content-length') ?? '0');
    if (declarado > MEDIA_MAX_BYTES) {
      await res.body?.cancel().catch(() => undefined);
      throw new QuarantineStorageError();
    }
    const bytes = new Uint8Array(await res.arrayBuffer().catch(() => new ArrayBuffer(0)));
    if (bytes.byteLength === 0 || bytes.byteLength > MEDIA_MAX_BYTES) throw new QuarantineStorageError();
    return bytes;
  }

  async putReduced(id: string, bytes: Uint8Array): Promise<void> {
    const res = await this.chamar(this.url(MEDIA_REDUCED_BUCKET, this.chaveReduzida(id)), {
      method: 'POST',
      headers: this.cabecalhos({ 'content-type': 'image/jpeg', 'x-upsert': 'true' }),
      body: new Blob([bytes], { type: 'image/jpeg' }),
    });
    if (!res.ok) throw new QuarantineStorageError();
  }

  async statReduced(id: string): Promise<{ readonly bytes: number } | null> {
    const res = await this.chamar(`${this.opts.baseUrl}/storage/v1/object/info/${MEDIA_REDUCED_BUCKET}/${this.chaveReduzida(id)}`, {
      method: 'GET',
      headers: this.cabecalhos(),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new QuarantineStorageError();
    const corpo = (await res.json().catch(() => null)) as { size?: unknown; metadata?: { size?: unknown } } | null;
    const tamanho = corpo?.size ?? corpo?.metadata?.size;
    if (typeof tamanho !== 'number' || !Number.isFinite(tamanho)) throw new QuarantineStorageError();
    return { bytes: tamanho };
  }

  async removeOriginal(id: string): Promise<void> {
    const res = await this.chamar(this.url(MEDIA_BUCKET, this.chaveOriginal(id)), {
      method: 'DELETE',
      headers: this.cabecalhos(),
    });
    if ((res.status >= 200 && res.status < 300) || res.status === 404) return;
    throw new QuarantineStorageError();
  }

  async removeReduced(id: string): Promise<void> {
    const res = await this.chamar(this.url(MEDIA_REDUCED_BUCKET, this.chaveReduzida(id)), {
      method: 'DELETE',
      headers: this.cabecalhos(),
    });
    if ((res.status >= 200 && res.status < 300) || res.status === 404) return;
    throw new QuarantineStorageError();
  }
}
