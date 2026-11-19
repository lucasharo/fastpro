// Issue 68 (H-055) | Adaptador de fotos prontas da descoberta (docs/factory/153-DESENHO-H055.md, §5.3).
// Cliente falso: prova a chamada (funcao, parametro em array) e o erro com codigo fixo. Sem banco.
import { describe, expect, it } from 'vitest';
import { DiscoveryPhotoError, PgDiscoveryPhotoStore } from '../src/discovery-photos.js';
import type { SqlClient } from '../src/jobs-tick.js';

const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';

function clienteFalso(resposta: () => Promise<{ rows: unknown[] }>) {
  const chamadas: { sql: string; params: unknown[] | undefined }[] = [];
  const client: SqlClient = {
    query: async (sql, params) => {
      chamadas.push({ sql, params });
      return resposta();
    },
  };
  return { client, chamadas };
}

describe('PgDiscoveryPhotoStore', () => {
  it('chama a funcao de fotos com a lista de ids e devolve so os ids com foto pronta', async () => {
    const { client, chamadas } = clienteFalso(async () => ({ rows: [{ out_request_id: A }] }));
    const r = await new PgDiscoveryPhotoStore(client).withPhotos([A, B]);
    expect([...r]).toEqual([A]);
    expect(chamadas[0]?.sql).toContain('private.request_discovery_photo_flags($1::uuid[])');
    expect(chamadas[0]?.params).toEqual([[A, B]]);
  });

  it('lista vazia nao consulta o banco', async () => {
    const { client, chamadas } = clienteFalso(async () => ({ rows: [] }));
    const r = await new PgDiscoveryPhotoStore(client).withPhotos([]);
    expect(r.size).toBe(0);
    expect(chamadas.length).toBe(0);
  });

  it('erro do banco vira codigo fixo, sem texto do driver', async () => {
    const { client } = clienteFalso(async () => {
      throw new Error('detalhe do driver que nao pode sair');
    });
    const erro = await new PgDiscoveryPhotoStore(client)
      .withPhotos([A])
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(DiscoveryPhotoError);
    expect((erro as DiscoveryPhotoError).code).toBe('discovery_fotos_falhou');
    expect((erro as Error).message).toBe('discovery_fotos_falhou');
  });
});
