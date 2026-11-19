// Issue 68 (H-055) | Fotos prontas por pedido para a lista da descoberta (docs/factory/153-DESENHO-H055.md, §5.3).
// So chama private.request_discovery_photo_flags, com o papel app_system. Devolve apenas os ids que tem foto pronta.
// Erro do banco vira o codigo fixo discovery_fotos_falhou: nenhum texto do driver sai daqui.
import type { SqlClient } from './jobs-tick.js';

export const DISCOVERY_FOTOS_FALHOU = 'discovery_fotos_falhou';

/** Erro com texto fixo: o codigo e o unico detalhe que sai do adaptador. */
export class DiscoveryPhotoError extends Error {
  readonly code: typeof DISCOVERY_FOTOS_FALHOU;

  constructor() {
    super(DISCOVERY_FOTOS_FALHOU);
    this.name = 'DiscoveryPhotoError';
    this.code = DISCOVERY_FOTOS_FALHOU;
  }
}

const SQL_PHOTO_FLAGS = 'select out_request_id from private.request_discovery_photo_flags($1::uuid[])';

export class PgDiscoveryPhotoStore {
  constructor(private readonly client: SqlClient) {}

  /** Conjunto dos ids (da lista recebida) que tem ao menos uma foto pronta e sem expurgo pedido. */
  async withPhotos(requestIds: readonly string[]): Promise<ReadonlySet<string>> {
    if (requestIds.length === 0) return new Set<string>();
    try {
      const res = await this.client.query(SQL_PHOTO_FLAGS, [[...requestIds]]);
      return new Set(res.rows.map((r) => String((r as { out_request_id: unknown }).out_request_id)));
    } catch {
      throw new DiscoveryPhotoError();
    }
  }
}
