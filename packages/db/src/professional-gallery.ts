// Galeria do profissional (2026-11-27): funcoes private.professional_photo_* (papel app_system) e o bucket privado
// professional-gallery. Erros nao carregam texto do driver nem do Storage.
import type { SqlClient } from './jobs-tick.js';

export const GALERIA_BUCKET = 'professional-gallery' as const;

export interface FotoGaleria {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

export type ResultadoFotoNova = 'ok' | 'limite' | 'sem_perfil' | 'suspenso';

function foto(l: Record<string, unknown>): FotoGaleria {
  return { id: String(l.out_id), width: Number(l.out_width), height: Number(l.out_height) };
}

export class PgProfessionalGalleryStore {
  constructor(private readonly client: SqlClient) {}

  async adicionar(userId: string, id: string, width: number, height: number, bytes: number, agora: Date): Promise<ResultadoFotoNova> {
    const r = await this.client.query('select * from private.professional_photo_add($1, $2, $3, $4, $5, $6)', [
      userId,
      id,
      width,
      height,
      bytes,
      agora,
    ]);
    const code = String(r.rows[0]?.out_code ?? '');
    if (code !== 'ok' && code !== 'limite' && code !== 'sem_perfil' && code !== 'suspenso') throw new Error('galeria_resposta_invalida');
    return code;
  }

  async doProfissional(userId: string): Promise<FotoGaleria[]> {
    const r = await this.client.query('select * from private.professional_photo_list($1)', [userId]);
    return r.rows.map(foto);
  }

  async doPerfil(slug: string): Promise<FotoGaleria[]> {
    const r = await this.client.query('select * from private.professional_photo_public_list($1)', [slug]);
    return r.rows.map(foto);
  }

  async excluir(userId: string, id: string): Promise<boolean> {
    const r = await this.client.query('select private.professional_photo_delete($1, $2) as ok', [userId, id]);
    return r.rows[0]?.ok === true;
  }
}

export interface GaleriaStorageOpcoes {
  readonly baseUrl: string;
  readonly serviceKey: string;
  readonly fetchImpl?: typeof fetch;
}

export class SupabaseGalleryStorage {
  constructor(private readonly opts: GaleriaStorageOpcoes) {}

  private chamar(id: string, init: RequestInit): Promise<Response> {
    const f = this.opts.fetchImpl ?? fetch;
    return f(`${this.opts.baseUrl}/storage/v1/object/${GALERIA_BUCKET}/${id}.jpg`, {
      ...init,
      headers: { Authorization: `Bearer ${this.opts.serviceKey}`, apikey: this.opts.serviceKey, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });
  }

  async gravar(id: string, bytes: Uint8Array): Promise<void> {
    const r = await this.chamar(id, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: new Uint8Array(bytes) });
    if (!r.ok) throw new Error('galeria_storage_gravar');
  }

  /** Bytes da foto, ou null se o objeto nao existir. */
  async ler(id: string): Promise<Uint8Array | null> {
    const r = await this.chamar(id, { method: 'GET' });
    if (r.status === 404 || r.status === 400) return null;
    if (!r.ok) throw new Error('galeria_storage_ler');
    return new Uint8Array(await r.arrayBuffer());
  }

  async apagar(id: string): Promise<void> {
    const r = await this.chamar(id, { method: 'DELETE' });
    if (!r.ok && r.status !== 404 && r.status !== 400) throw new Error('galeria_storage_apagar');
  }
}
