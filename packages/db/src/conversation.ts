// Ciclo central (2026-11-23) | Adaptador das funcoes de interessados, conversas, mensagens e selecao
// (migracoes 20261123100000_chat_selection_core e 20261123150000_chat_unread_archive_report). Papel app_system;
// cada funcao confere a participacao.
import type { SqlClient } from './jobs-tick.js';

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null);
const texto = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const numero = (v: unknown): number => Number(v ?? 0);

export const MOTIVOS_DENUNCIA = ['assedio', 'golpe', 'ofensa', 'spam', 'outro'] as const;
export type MotivoDenuncia = (typeof MOTIVOS_DENUNCIA)[number];

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
  readonly unreadCount: number;
  readonly archived: boolean;
  readonly blocked: boolean;
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
  readonly archived: boolean;
  readonly blocked: boolean;
  readonly messages: readonly MensagemConversa[];
}

export type ResultadoEnvio =
  | { readonly outcome: 'enviada' | 'repetida'; readonly messageId: string; readonly createdAt: string | null }
  | {
      readonly outcome:
        | 'nao_encontrada'
        | 'somente_leitura'
        | 'texto_invalido'
        | 'conteudo_nao_permitido'
        | 'conversa_bloqueada';
    };

export type ResultadoSelecao = {
  readonly outcome: 'selecionado' | 'sem_mudanca' | 'nao_encontrado' | 'estado_invalido' | 'aceite_invalido';
  readonly selectedAcceptanceId: string | null;
  readonly selectedAt: string | null;
};

export type ResultadoArquivo = 'arquivada' | 'desarquivada' | 'sem_mudanca' | 'nao_encontrada';

export type ResultadoDenuncia =
  | { readonly outcome: 'registrada'; readonly reportId: string }
  | { readonly outcome: 'nao_encontrada' | 'motivo_invalido' | 'texto_invalido' };

export type ResultadoBloqueio = 'bloqueada' | 'sem_mudanca' | 'nao_encontrada';

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
      unreadCount: numero(l.out_unread_count),
      archived: l.out_archived === true,
      blocked: l.out_blocked === true,
    }));
  }

  /** Total de nao lidas na caixa do usuario (H-101). */
  async naoLidas(userId: string): Promise<number> {
    const r = await this.client.query('select * from private.conversation_unread_total($1)', [userId]);
    return numero(r.rows[0]?.out_total);
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
      archived: primeira.out_archived === true,
      blocked: primeira.out_blocked === true,
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

  /** Marca a conversa como lida para o usuario (chamado pela leitura das mensagens). */
  async marcarLida(conversationId: string, userId: string, agora: Date): Promise<boolean> {
    const r = await this.client.query('select * from private.conversation_mark_read($1, $2, $3)', [conversationId, userId, agora]);
    return String(r.rows[0]?.out_outcome ?? '') === 'marcada';
  }

  async arquivar(conversationId: string, userId: string, arquivar: boolean, agora: Date): Promise<ResultadoArquivo> {
    const r = await this.client.query('select * from private.conversation_archive($1, $2, $3, $4)', [
      conversationId,
      userId,
      arquivar,
      agora,
    ]);
    const outcome = String(r.rows[0]?.out_outcome ?? 'nao_encontrada');
    if (outcome === 'arquivada' || outcome === 'desarquivada' || outcome === 'sem_mudanca') return outcome;
    return 'nao_encontrada';
  }

  async denunciar(
    conversationId: string,
    userId: string,
    motivo: string,
    textoLivre: string | null,
    agora: Date,
  ): Promise<ResultadoDenuncia> {
    const r = await this.client.query('select * from private.conversation_report($1, $2, $3, $4, $5)', [
      conversationId,
      userId,
      motivo,
      textoLivre,
      agora,
    ]);
    const l = r.rows[0] ?? {};
    if (l.out_outcome === 'registrada') return { outcome: 'registrada', reportId: String(l.out_report_id) };
    if (l.out_outcome === 'motivo_invalido' || l.out_outcome === 'texto_invalido') return { outcome: l.out_outcome };
    return { outcome: 'nao_encontrada' };
  }

  async bloquear(conversationId: string, userId: string, agora: Date): Promise<ResultadoBloqueio> {
    const r = await this.client.query('select * from private.conversation_block($1, $2, $3)', [conversationId, userId, agora]);
    const outcome = String(r.rows[0]?.out_outcome ?? 'nao_encontrada');
    if (outcome === 'bloqueada' || outcome === 'sem_mudanca') return outcome;
    return 'nao_encontrada';
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
    if (
      outcome === 'somente_leitura' ||
      outcome === 'texto_invalido' ||
      outcome === 'conteudo_nao_permitido' ||
      outcome === 'conversa_bloqueada'
    ) {
      return { outcome };
    }
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
