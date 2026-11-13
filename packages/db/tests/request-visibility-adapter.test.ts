// Issue 45 (H-032) | Adaptador da leitura por papel com cliente falso (sem banco): ordem de parametros,
// mapeamento restrito e erro fixo (docs/factory/127-DESENHO-H032.md, §6.2, §6.3, §8).
import { describe, expect, it } from 'vitest';
import type { SqlClient } from '../src/jobs-tick.js';
import {
  PgRequestVisibilityStore,
  SQL_DETAIL_PROFESSIONAL,
  SQL_OWNER_GET,
  VISIBILIDADE_BANCO_FALHOU,
} from '../src/request-visibility.js';

const USER = '11111111-1111-4111-8111-111111111111';
const PEDIDO = '33333333-3333-4333-8333-333333333333';
const PROFISSIONAL = '44444444-4444-4444-8444-444444444444';
const AGORA = Date.UTC(2026, 10, 13, 12, 0, 0);

function clienteFalso(linhas: Record<string, unknown>[] | Error) {
  const chamadas: Array<{ sql: string; params: unknown[] }> = [];
  const client: SqlClient = {
    async query(sql: string, params: unknown[] = []) {
      chamadas.push({ sql, params });
      if (linhas instanceof Error) throw linhas;
      return { rows: linhas, rowCount: linhas.length } as never;
    },
  };
  return { client, chamadas };
}

describe('PgRequestVisibilityStore.readOwner', () => {
  it('chama so request_owner_get com dono e pedido, e devolve o blob cifrado (nunca coordenada)', async () => {
    const blob = Buffer.from([1, 2, 3]);
    const { client, chamadas } = clienteFalso([
      {
        out_id: PEDIDO,
        out_status: 'publicado',
        out_service_id: 'svc',
        out_service_name: 'Eletricista',
        out_urgency: 'normal',
        out_description: 'Troca de tomada',
        out_first_name: 'Ana',
        out_address_text: null,
        out_address_enc: blob,
        out_public_label: 'Sao Paulo - SP',
        out_published_at: new Date(AGORA),
        out_deadline_at: new Date(AGORA + 3600_000),
        out_acceptances_count: 0,
      },
    ]);
    const r = await new PgRequestVisibilityStore(client).readOwner(USER, PEDIDO);
    expect(chamadas).toEqual([{ sql: SQL_OWNER_GET, params: [USER, PEDIDO] }]);
    expect(r?.addressEnc).toEqual(blob);
    expect(r?.addressTextLegado).toBeNull();
    expect(r?.publishedAt).toBe(new Date(AGORA).toISOString());
    expect(Object.keys(r ?? {})).not.toContain('geocodePointId');
  });

  it('zero linhas (pedido de outro cliente) devolve null', async () => {
    const { client } = clienteFalso([]);
    expect(await new PgRequestVisibilityStore(client).readOwner(USER, PEDIDO)).toBeNull();
  });
});

describe('PgRequestVisibilityStore.readProfessional', () => {
  it('envia profissional, pedido e instante; devolve so as chaves da lista do profissional', async () => {
    const { client, chamadas } = clienteFalso([
      {
        out_id: PEDIDO,
        out_service_id: 'svc',
        out_service_name: 'Eletricista',
        out_urgency: 'normal',
        out_description: 'Troca de tomada',
        out_public_label: null,
        out_distance_km: '1.5',
        out_modality: 'presencial',
        out_published_at: new Date(AGORA),
        out_deadline_at: new Date(AGORA + 3600_000),
      },
    ]);
    const r = await new PgRequestVisibilityStore(client).readProfessional(PROFISSIONAL, PEDIDO, AGORA);
    expect(chamadas[0]).toEqual({
      sql: SQL_DETAIL_PROFESSIONAL,
      params: [PROFISSIONAL, PEDIDO, new Date(AGORA).toISOString()],
    });
    expect(r?.distanceKm).toBe(1.5);
    expect(r?.publicLabel).toBeNull();
    expect(Object.keys(r ?? {}).sort()).toEqual(
      [
        'acceptanceDeadlineAt',
        'description',
        'distanceKm',
        'id',
        'modality',
        'publicLabel',
        'publishedAt',
        'serviceId',
        'serviceName',
        'urgency',
      ].sort(),
    );
  });

  it('online nao tem distancia (null), e zero linhas devolve null', async () => {
    const online = clienteFalso([{ out_id: PEDIDO, out_distance_km: null, out_modality: 'online' }]);
    const r = await new PgRequestVisibilityStore(online.client).readProfessional(PROFISSIONAL, PEDIDO, AGORA);
    expect(r?.distanceKm).toBeNull();
    const vazio = clienteFalso([]);
    expect(await new PgRequestVisibilityStore(vazio.client).readProfessional(PROFISSIONAL, PEDIDO, AGORA)).toBeNull();
  });
});

describe('erro do banco vira codigo fixo', () => {
  it('nao repassa a mensagem do driver', async () => {
    const { client } = clienteFalso(new Error('relation app.service_request: detalhe interno'));
    const store = new PgRequestVisibilityStore(client);
    await expect(store.readOwner(USER, PEDIDO)).rejects.toThrow(VISIBILIDADE_BANCO_FALHOU);
    await expect(store.readOwner(USER, PEDIDO)).rejects.not.toThrow(/detalhe interno/);
  });
});
