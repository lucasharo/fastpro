// Pacote D (H-095, H-096, H-098) | Porta de leitura do ciclo sobre as funcoes SQL de leitura minima
// (private.cycle_request_view, cycle_active_professionals e cycle_conversation_view, na migracao 20261123140000).
// Le so ids, status e o nome do servico. Nenhum e-mail, texto de mensagem ou documento passa por aqui.
import type {
  CycleConversationView,
  CycleRequestView,
  CycleSourcePort,
} from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';

const textoOuNulo = (valor: unknown): string | null => (valor == null ? null : String(valor));

/** Adaptador da porta do ciclo. Cada metodo e uma consulta a uma funcao SQL security definer de app_system. */
export class PgCycleSource implements CycleSourcePort {
  constructor(private readonly client: SqlClient) {}

  async requestView(requestId: string): Promise<CycleRequestView | null> {
    const r = await this.client.query(
      'select out_request_id, out_customer_user_id, out_status, out_selected_professional_id, out_service_name ' +
        'from private.cycle_request_view($1::uuid)',
      [requestId],
    );
    const row = r.rows[0];
    if (row === undefined) return null;
    return {
      requestId: String(row['out_request_id']),
      customerUserId: String(row['out_customer_user_id']),
      status: String(row['out_status']),
      selectedProfessionalId: textoOuNulo(row['out_selected_professional_id']),
      serviceName: textoOuNulo(row['out_service_name']),
    };
  }

  async activeProfessionals(requestId: string): Promise<readonly string[]> {
    const r = await this.client.query(
      'select out_professional_id from private.cycle_active_professionals($1::uuid)',
      [requestId],
    );
    return r.rows.map((row) => String(row['out_professional_id']));
  }

  async conversationView(conversationId: string): Promise<CycleConversationView | null> {
    const r = await this.client.query(
      'select out_request_id, out_customer_user_id, out_professional_id ' +
        'from private.cycle_conversation_view($1::uuid)',
      [conversationId],
    );
    const row = r.rows[0];
    if (row === undefined) return null;
    return {
      requestId: String(row['out_request_id']),
      customerUserId: String(row['out_customer_user_id']),
      professionalId: String(row['out_professional_id']),
    };
  }
}
