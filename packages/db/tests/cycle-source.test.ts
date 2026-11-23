// Pacote D (H-095, H-096, H-098) | Adaptador de leitura do ciclo: mapeamento das colunas out_* (cliente falso).
import { describe, it, expect } from 'vitest';
import { PgCycleSource, type SqlClient } from '../src/index.js';

const PEDIDO = '6f1c2b7e-3a4d-4e5f-8a9b-0c1d2e3f4a5b';
const CLIENTE = '11111111-1111-4111-8111-111111111111';
const PRO = '22222222-2222-4222-8222-222222222222';

function clienteFalso(linhas: Record<string, unknown>[]): { client: SqlClient; sql: string[]; params: unknown[][] } {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const client: SqlClient = {
    query: async (texto, valores) => {
      sql.push(texto);
      params.push(valores ?? []);
      return { rows: linhas };
    },
  };
  return { client, sql, params };
}

describe('PgCycleSource', () => {
  it('requestView mapeia as colunas e devolve null sem linha', async () => {
    const { client, sql, params } = clienteFalso([
      {
        out_request_id: PEDIDO,
        out_customer_user_id: CLIENTE,
        out_status: 'selecionado',
        out_selected_professional_id: PRO,
        out_service_name: 'Aulas práticas',
      },
    ]);
    const view = await new PgCycleSource(client).requestView(PEDIDO);
    expect(view).toEqual({
      requestId: PEDIDO,
      customerUserId: CLIENTE,
      status: 'selecionado',
      selectedProfessionalId: PRO,
      serviceName: 'Aulas práticas',
    });
    expect(sql[0]).toContain('private.cycle_request_view($1::uuid)');
    expect(params[0]).toEqual([PEDIDO]);

    const vazio = await new PgCycleSource(clienteFalso([]).client).requestView(PEDIDO);
    expect(vazio).toBeNull();
  });

  it('requestView aceita escolha e servico ausentes como null', async () => {
    const { client } = clienteFalso([
      { out_request_id: PEDIDO, out_customer_user_id: CLIENTE, out_status: 'publicado', out_selected_professional_id: null, out_service_name: null },
    ]);
    const view = await new PgCycleSource(client).requestView(PEDIDO);
    expect(view?.selectedProfessionalId).toBeNull();
    expect(view?.serviceName).toBeNull();
  });

  it('activeProfessionals devolve so os ids dos profissionais ativos', async () => {
    const { client, sql } = clienteFalso([{ out_professional_id: PRO }, { out_professional_id: CLIENTE }]);
    expect(await new PgCycleSource(client).activeProfessionals(PEDIDO)).toEqual([PRO, CLIENTE]);
    expect(sql[0]).toContain('private.cycle_active_professionals($1::uuid)');
  });

  it('conversationView mapeia pedido, cliente e profissional', async () => {
    const { client } = clienteFalso([{ out_request_id: PEDIDO, out_customer_user_id: CLIENTE, out_professional_id: PRO }]);
    expect(await new PgCycleSource(client).conversationView(PEDIDO)).toEqual({
      requestId: PEDIDO,
      customerUserId: CLIENTE,
      professionalId: PRO,
    });
  });
});
