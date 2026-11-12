// H-026 (Issue #39) | Adaptadores da quarentena de fotos (docs/factory/88-DESENHO-H026.md, §1, §2, §4).
// PgMediaStore: so funcoes private.media_* (migracao 20261112120000), via SqlClient injetado.
// SupabaseQuarantineStorage: API REST do Storage, bucket fixo 'quarantine', chave 'd/<uuid>'. A chave de servico
// vem do ambiente do servidor, nunca de tabela, log ou resposta. Nenhum metodo baixa o conteudo do arquivo.
import {
  MEDIA_BUCKET,
  isMediaId,
  mediaIdFromKey,
  type MediaFinalizeResult,
  type MediaIssueInput,
  type MediaIssueResult,
  type MediaRecord,
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
