// Ciclo central (2026-11-23) | Adaptador das funcoes de interessados, conversas, mensagens e selecao
// (migracao 20261123100000_chat_selection_core). Papel app_system; cada funcao confere a participacao.
import type { SqlClient } from './jobs-tick.js';

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null);
const texto = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export interface InteressadoPedido {
  readonly acceptanceId: string;
  readonly professionalName: string;
  readonly professionalSlug: string | null;
  readonly slotNo: number;
  readonly status: string;
  readonly acceptedAt: string | null;
  readonly conversationId: string | null;
  readonly conversationState: string | null;
  readonly selected: boolean;
}

export interface ConversaResumo {
  readonly conversationId: string;
  readonly requestId: string;
  readonly serviceName: string;
  readonly papel: 'cliente' | 'profissional';
  readonly otherName: string;
  readonly state: string;
  readonly requestStatus: string;
  readonly selected: boolean;
  readonly lastKind: string | null;
  readonly lastEvent: string | null;
  readonly lastBody: string | null;
  readonly lastAt: string | null;
  /** Aceite desta conversa (Pacote A): a tela do profissional usa para retirar o aceite. */
  readonly acceptanceId: string;
}

export interface MensagemConversa {
  readonly id: string;
  readonly kind: 'humana' | 'sistema';
  readonly mine: boolean;
  readonly body: string | null;
  readonly event: string | null;
  readonly createdAt: string | null;
}

export interface ConversaCompleta {
  readonly conversationId: string;
  readonly requestId: string;
  readonly serviceName: string;
  readonly papel: 'cliente' | 'profissional';
  readonly otherName: string;
  readonly state: string;
  readonly messages: readonly MensagemConversa[];
}

export type ResultadoEnvio =
  | { readonly outcome: 'enviada' | 'repetida'; readonly messageId: string; readonly createdAt: string | null }
  | { readonly outcome: 'nao_encontrada' | 'somente_leitura' | 'texto_invalido' };

export type ResultadoSelecao = {
  readonly outcome: 'selecionado' | 'sem_mudanca' | 'nao_encontrado' | 'estado_invalido' | 'aceite_invalido';
  readonly selectedAcceptanceId: string | null;
  readonly selectedAt: string | null;
};

export class PgConversationStore {
  constructor(private readonly client: SqlClient) {}

  async interessados(requestId: string, customerId: string): Promise<InteressadoPedido[]> {
    const r = await this.client.query('select * from private.request_acceptances_owner($1, $2)', [requestId, customerId]);
    return r.rows.map((l) => ({
      acceptanceId: String(l.out_acceptance_id),
      professionalName: texto(l.out_professional_name) ?? 'Profissional',
      professionalSlug: texto(l.out_professional_slug),
      slotNo: Number(l.out_slot_no),
      status: String(l.out_status),
      acceptedAt: iso(l.out_accepted_at),
      conversationId: texto(l.out_conversation_id),
      conversationState: texto(l.out_conversation_state),
      selected: l.out_selected === true,
    }));
  }

  async conversas(userId: string): Promise<ConversaResumo[]> {
    const r = await this.client.query('select * from private.conversation_list_for_user($1)', [userId]);
    return r.rows.map((l) => ({
      conversationId: String(l.out_conversation_id),
      requestId: String(l.out_request_id),
      serviceName: texto(l.out_service_name) ?? 'Serviço',
      papel: l.out_papel === 'cliente' ? 'cliente' : 'profissional',
      otherName: texto(l.out_other_name) ?? '',
      state: String(l.out_state),
      requestStatus: String(l.out_request_status),
      selected: l.out_selected === true,
      lastKind: texto(l.out_last_kind),
      lastEvent: texto(l.out_last_event),
      lastBody: texto(l.out_last_body),
      lastAt: iso(l.out_last_at),
      acceptanceId: String(l.out_acceptance_id),
    }));
  }

  async conversa(conversationId: string, userId: string): Promise<ConversaCompleta | null> {
    const r = await this.client.query('select * from private.conversation_messages_for_user($1, $2)', [conversationId, userId]);
    const primeira = r.rows[0];
    if (primeira === undefined) return null;
    return {
      conversationId,
      requestId: String(primeira.out_request_id),
      serviceName: texto(primeira.out_service_name) ?? 'Serviço',
      papel: primeira.out_papel === 'cliente' ? 'cliente' : 'profissional',
      otherName: texto(primeira.out_other_name) ?? '',
      state: String(primeira.out_state),
      messages: r.rows.map((l) => ({
        id: String(l.out_message_id),
        kind: l.out_kind === 'sistema' ? 'sistema' : 'humana',
        mine: l.out_mine === true,
        body: texto(l.out_body),
        event: texto(l.out_event),
        createdAt: iso(l.out_created_at),
      })),
    };
  }

  async enviar(conversationId: string, userId: string, clientMessageId: string, corpo: string, agora: Date): Promise<ResultadoEnvio> {
    const r = await this.client.query('select * from private.message_send($1, $2, $3, $4, $5)', [
      conversationId,
      userId,
      clientMessageId,
      corpo,
      agora,
    ]);
    const l = r.rows[0] ?? {};
    const outcome = String(l.out_outcome ?? 'nao_encontrada');
    if (outcome === 'enviada' || outcome === 'repetida') {
      return { outcome, messageId: String(l.out_message_id), createdAt: iso(l.out_created_at) };
    }
    if (outcome === 'somente_leitura' || outcome === 'texto_invalido') return { outcome };
    return { outcome: 'nao_encontrada' };
  }

  async selecionar(requestId: string, customerId: string, acceptanceId: string, agora: Date): Promise<ResultadoSelecao> {
    const r = await this.client.query('select * from private.request_select($1, $2, $3, $4)', [requestId, customerId, acceptanceId, agora]);
    const l = r.rows[0] ?? {};
    const validos = ['selecionado', 'sem_mudanca', 'nao_encontrado', 'estado_invalido', 'aceite_invalido'] as const;
    const outcome = validos.find((v) => v === l.out_outcome) ?? 'nao_encontrado';
    return { outcome, selectedAcceptanceId: texto(l.out_selected_acceptance_id), selectedAt: iso(l.out_selected_at) };
  }
}
