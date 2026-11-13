// H-029 (Issue #42) | Adaptadores da galeria do dono (docs/factory/98-DESENHO-H029.md, §2 e §3).
// PgMediaGallery: so funcoes private.media_list / media_delete / media_reorder / media_read_target (migracao
// 20261112190000), via SqlClient injetado. SupabaseReducedPhotoReader: unico metodo que le 'p/<uuid>' no bucket
// request-photos, sem leitura do original. Nenhum texto de banco ou de Storage atravessa a porta.
import {
  MEDIA_REDUCED_BUCKET,
  isMediaId,
  mediaReducedKey,
  type GaleriaLinha,
  type MediaDeleteCode,
  type MediaGalleryStorePort,
  type MediaReorderCode,
  type ReducedPhotoReaderPort,
} from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';
import { QuarantineStorageError, type QuarantineStorageOpcoes } from './media-quarantine.js';

export const SQL_MEDIA_LIST =
  'select out_id, out_state, out_reject_code, out_pos from private.media_list($1::text, $2::timestamptz)';
export const SQL_MEDIA_DELETE = 'select out_code from private.media_delete($1::text, $2::uuid, $3::timestamptz)';
export const SQL_MEDIA_REORDER =
  'select out_code from private.media_reorder($1::text, $2::uuid[], $3::uuid[], $4::timestamptz)';
export const SQL_MEDIA_READ_TARGET = 'select out_bytes from private.media_read_target($1::text, $2::uuid, $3::timestamptz)';

const iso = (ms: number): string => new Date(ms).toISOString();

const CODIGOS_EXCLUSAO: readonly string[] = ['deleted', 'already', 'not_found'];
const CODIGOS_ORDEM: readonly string[] = ['ok', 'unchanged', 'changed', 'invalid', 'not_found'];

interface LinhaLista {
  readonly out_id: unknown;
  readonly out_state: unknown;
  readonly out_reject_code: unknown;
  readonly out_pos: unknown;
}

function linhaDeBanco(row: LinhaLista): GaleriaLinha {
  if (row.out_id !== null && typeof row.out_id !== 'string') throw new Error('galeria_resposta_invalida');
  if (row.out_state !== null && typeof row.out_state !== 'string') throw new Error('galeria_resposta_invalida');
  if (row.out_reject_code !== null && typeof row.out_reject_code !== 'string') {
    throw new Error('galeria_resposta_invalida');
  }
  if (row.out_pos !== null && typeof row.out_pos !== 'number') throw new Error('galeria_resposta_invalida');
  return {
    id: row.out_id,
    estado: row.out_state ?? '',
    motivo: row.out_reject_code,
    posicao: row.out_pos,
  };
}

export class PgMediaGallery implements MediaGalleryStorePort {
  constructor(private readonly client: SqlClient) {}

  async list(secretHash: string, nowMs: number): Promise<readonly GaleriaLinha[] | null> {
    const res = await this.client.query(SQL_MEDIA_LIST, [secretHash, iso(nowMs)]);
    if (res.rows.length === 0) return null;
    return (res.rows as unknown as LinhaLista[]).map(linhaDeBanco);
  }

  async remove(secretHash: string, id: string, nowMs: number): Promise<MediaDeleteCode> {
    const res = await this.client.query(SQL_MEDIA_DELETE, [secretHash, id, iso(nowMs)]);
    const code = (res.rows[0] as { out_code?: unknown } | undefined)?.out_code;
    if (typeof code !== 'string' || !CODIGOS_EXCLUSAO.includes(code)) throw new Error('galeria_resposta_invalida');
    return code as MediaDeleteCode;
  }

  async reorder(
    secretHash: string,
    atual: readonly string[],
    nova: readonly string[],
    nowMs: number,
  ): Promise<MediaReorderCode> {
    const res = await this.client.query(SQL_MEDIA_REORDER, [secretHash, [...atual], [...nova], iso(nowMs)]);
    const code = (res.rows[0] as { out_code?: unknown } | undefined)?.out_code;
    if (typeof code !== 'string' || !CODIGOS_ORDEM.includes(code)) throw new Error('galeria_resposta_invalida');
    return code as MediaReorderCode;
  }

  async readTarget(secretHash: string, id: string, nowMs: number): Promise<number | null> {
    const res = await this.client.query(SQL_MEDIA_READ_TARGET, [secretHash, id, iso(nowMs)]);
    if (res.rows.length === 0) return null;
    const bytes = (res.rows[0] as { out_bytes?: unknown }).out_bytes;
    if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes <= 0) throw new Error('galeria_resposta_invalida');
    return bytes;
  }
}

/** Leitura da versao reduzida 'p/<uuid>' (request-photos). Sem chave de original e sem URL assinada. */
export class SupabaseReducedPhotoReader implements ReducedPhotoReaderPort {
  // Campos privados (#): a chave de servico nao aparece em JSON.stringify, Object.keys nem em inspecao.
  readonly #baseUrl: string;
  readonly #serviceKey: string;
  readonly #fetchImpl: typeof fetch;

  constructor(opts: QuarantineStorageOpcoes) {
    this.#baseUrl = opts.baseUrl;
    this.#serviceKey = opts.serviceKey;
    this.#fetchImpl = opts.fetchImpl ?? fetch;
  }

  async readReduced(id: string): Promise<Uint8Array | null> {
    if (!isMediaId(id)) throw new QuarantineStorageError();
    const url = `${this.#baseUrl}/storage/v1/object/${MEDIA_REDUCED_BUCKET}/${mediaReducedKey(id.toLowerCase())}`;
    let res: Response;
    try {
      res = await this.#fetchImpl(url, {
        method: 'GET',
        headers: { authorization: `Bearer ${this.#serviceKey}`, apikey: this.#serviceKey },
      });
    } catch {
      throw new QuarantineStorageError();
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new QuarantineStorageError();
    return new Uint8Array(await res.arrayBuffer().catch(() => new ArrayBuffer(0)));
  }
}
