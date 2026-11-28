// Pacote B (2026-11-23) | Adaptador das funcoes de avaliacao e resposta (migracao 20261123120000_reviews_public_profile).
// Papel app_system; cada funcao confere o dono do pedido ou o profissional avaliado. Sem nome, e-mail ou id do cliente.
import type { SqlClient } from './jobs-tick.js';

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null);
const texto = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const numero = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const recusaAvaliacao = (v: string): CodigoRecusaAvaliacao => RECUSAS_AVALIACAO.find((c) => c === v) ?? 'nao_encontrado';

export interface AvaliacaoPublica {
  readonly rating: number;
  readonly comment: string | null;
  readonly publishedAt: string | null;
  readonly replyText: string | null;
  readonly repliedAt: string | null;
}

export interface ResumoAvaliacoes {
  /** Media com 1 casa decimal; null quando nao ha avaliacoes. */
  readonly average: number | null;
  readonly count: number;
}

export interface AvaliacaoDoDono {
  readonly reviewId: string;
  readonly rating: number;
  readonly comment: string | null;
  readonly publishedAt: string | null;
  readonly editedAt: string | null;
  readonly replyText: string | null;
  readonly repliedAt: string | null;
  readonly prazoEncerrado: boolean;
}

export interface PedidoParaAvaliar {
  readonly requestStatus: string;
  readonly selected: boolean;
  readonly review: AvaliacaoDoDono | null;
}

export interface AvaliacaoRecebida {
  readonly reviewId: string;
  readonly rating: number;
  readonly comment: string | null;
  readonly publishedAt: string | null;
  readonly replyText: string | null;
  readonly repliedAt: string | null;
}

/** Codigos fixos de recusa das funcoes de avaliacao e resposta (out_outcome). */
export type CodigoRecusaAvaliacao =
  | 'nao_encontrado'
  | 'nota_invalida'
  | 'comentario_invalido'
  | 'conteudo_nao_permitido'
  | 'ja_existe'
  | 'pedido_nao_concluido'
  | 'sem_profissional'
  | 'prazo_encerrado';

export type CodigoRecusaResposta = 'nao_encontrada' | 'ja_respondida' | 'texto_invalido' | 'conteudo_nao_permitido';

const RECUSAS_AVALIACAO: readonly CodigoRecusaAvaliacao[] = [
  'nao_encontrado',
  'nota_invalida',
  'comentario_invalido',
  'conteudo_nao_permitido',
  'ja_existe',
  'pedido_nao_concluido',
  'sem_profissional',
  'prazo_encerrado',
];

const RECUSAS_RESPOSTA: readonly CodigoRecusaResposta[] = [
  'nao_encontrada',
  'ja_respondida',
  'texto_invalido',
  'conteudo_nao_permitido',
];

export type ResultadoEscritaAvaliacao =
  | { readonly outcome: 'criada'; readonly reviewId: string; readonly publishedAt: string | null }
  | { readonly outcome: 'atualizada'; readonly reviewId: string; readonly editedAt: string | null }
  | { readonly outcome: CodigoRecusaAvaliacao };

export type ResultadoResposta =
  | { readonly outcome: 'respondida'; readonly repliedAt: string | null }
  | { readonly outcome: CodigoRecusaResposta };

export class PgReviewStore {
  constructor(private readonly client: SqlClient) {}

  async doPedido(requestId: string, customerId: string): Promise<PedidoParaAvaliar | null> {
    const r = await this.client.query('select * from private.review_for_request($1, $2)', [requestId, customerId]);
    const l = r.rows[0];
    if (l === undefined) return null;
    const review =
      l.out_review_id === null || l.out_review_id === undefined
        ? null
        : {
            reviewId: String(l.out_review_id),
            rating: Number(l.out_rating),
            comment: texto(l.out_comment),
            publishedAt: iso(l.out_published_at),
            editedAt: iso(l.out_edited_at),
            replyText: texto(l.out_reply_text),
            repliedAt: iso(l.out_replied_at),
            prazoEncerrado: l.out_prazo_encerrado === true,
          };
    return { requestStatus: String(l.out_request_status), selected: l.out_has_selected === true, review };
  }

  async criar(
    requestId: string,
    customerId: string,
    nota: number,
    comentario: string | null,
    agora: Date,
    acceptanceId?: string,
  ): Promise<ResultadoEscritaAvaliacao> {
    const r = await this.client.query('select * from private.review_create($1, $2, $3, $4, $5, $6)', [
      requestId,
      customerId,
      nota,
      comentario,
      agora,
      acceptanceId ?? null,
    ]);
    const l = r.rows[0] ?? {};
    const outcome = String(l.out_outcome ?? '');
    if (outcome === 'criada') {
      return { outcome, reviewId: String(l.out_review_id), publishedAt: iso(l.out_published_at) };
    }
    return { outcome: recusaAvaliacao(outcome) };
  }

  async editar(requestId: string, customerId: string, nota: number, comentario: string | null, agora: Date): Promise<ResultadoEscritaAvaliacao> {
    const r = await this.client.query('select * from private.review_update($1, $2, $3, $4, $5)', [requestId, customerId, nota, comentario, agora]);
    const l = r.rows[0] ?? {};
    const outcome = String(l.out_outcome ?? '');
    if (outcome === 'atualizada') {
      const atual = await this.doPedido(requestId, customerId);
      if (atual?.review) return { outcome, reviewId: atual.review.reviewId, editedAt: iso(l.out_edited_at) };
      return { outcome: 'nao_encontrado' };
    }
    return { outcome: recusaAvaliacao(outcome) };
  }

  async responder(reviewId: string, professionalId: string, corpo: string, agora: Date): Promise<ResultadoResposta> {
    const r = await this.client.query('select * from private.review_reply($1, $2, $3, $4)', [reviewId, professionalId, corpo, agora]);
    const l = r.rows[0] ?? {};
    const outcome = String(l.out_outcome ?? '');
    if (outcome === 'respondida') return { outcome, repliedAt: iso(l.out_replied_at) };
    return { outcome: RECUSAS_RESPOSTA.find((c) => c === outcome) ?? 'nao_encontrada' };
  }

  /** Resumo do perfil publico. Null quando o perfil nao e visivel (o chamador responde 404). */
  async resumoPorSlug(slug: string): Promise<ResumoAvaliacoes | null> {
    const r = await this.client.query('select * from private.professional_rating_summary($1)', [slug]);
    const l = r.rows[0];
    if (l === undefined) return null;
    return { average: numero(l.out_average), count: Number(l.out_count ?? 0) };
  }

  async avaliacoesPorSlug(slug: string, limite: number): Promise<AvaliacaoPublica[]> {
    const r = await this.client.query('select * from private.reviews_for_professional_slug($1, $2)', [slug, limite]);
    return r.rows.map((l) => ({
      rating: Number(l.out_rating),
      comment: texto(l.out_comment),
      publishedAt: iso(l.out_published_at),
      replyText: texto(l.out_reply_text),
      repliedAt: iso(l.out_replied_at),
    }));
  }

  async doProfissional(professionalId: string): Promise<AvaliacaoRecebida[]> {
    const r = await this.client.query('select * from private.reviews_for_professional($1)', [professionalId]);
    return r.rows.map((l) => ({
      reviewId: String(l.out_review_id),
      rating: Number(l.out_rating),
      comment: texto(l.out_comment),
      publishedAt: iso(l.out_published_at),
      replyText: texto(l.out_reply_text),
      repliedAt: iso(l.out_replied_at),
    }));
  }
}
