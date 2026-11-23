// Pacote B (H-086, H-088, H-089) | Tipos, mensagens e regras de exibicao das avaliacoes.
// Contrato da API: apps/api/src/reviews/review-route.ts. O autor e sempre "Cliente do FastPro" (nunca nome, e-mail ou id).
import { MENSAGEM_INDISPONIVEL } from './api';
import { formatarDataHora } from './formatos';

export const AUTOR_AVALIACAO = 'Cliente do FastPro' as const;
export const COMENTARIO_MAX = 1000;
export const DIAS_PARA_EDITAR = 7;

export interface AvaliacaoPublicada {
  readonly rating: number;
  readonly comment: string | null;
  readonly publishedAt: string | null;
  readonly replyText: string | null;
  readonly repliedAt: string | null;
  readonly author?: string;
}

export interface AvaliacaoDoPedido {
  readonly reviewId: string;
  readonly rating: number;
  readonly comment: string | null;
  readonly publishedAt: string | null;
  readonly editedAt: string | null;
  readonly replyText: string | null;
  readonly repliedAt: string | null;
  readonly prazoEncerrado: boolean;
}

const MENSAGENS: Readonly<Record<string, string>> = {
  nota_invalida: 'Escolha uma nota de 1 a 5 estrelas.',
  comentario_invalido: `O comentário passa do limite de ${COMENTARIO_MAX} caracteres.`,
  conteudo_nao_permitido: 'Não envie e-mail, telefone ou link no texto.',
  pedido_nao_concluido: 'Só é possível avaliar depois que o pedido for concluído.',
  sem_profissional: 'Este pedido não tem um profissional escolhido para avaliar.',
  ja_existe: 'Este serviço já foi avaliado.',
  prazo_encerrado: 'O prazo para editar esta avaliação terminou.',
  nao_encontrado: 'Avaliação não encontrada.',
  nao_encontrada: 'Avaliação não encontrada.',
  ja_respondida: 'Você já respondeu esta avaliação.',
  texto_invalido: `Escreva uma resposta de 1 a ${COMENTARIO_MAX} caracteres.`,
};

/** Mensagem da recusa vinda da API. Codigo desconhecido vira o aviso generico. */
export function mensagemAvaliacao(codigo: string): string {
  return MENSAGENS[codigo] ?? MENSAGEM_INDISPONIVEL;
}

/** Data limite para editar a avaliacao (7 dias depois da publicacao), ou null sem data. */
export function prazoEdicaoAte(publicadaEm: string | null): string | null {
  if (!publicadaEm) return null;
  const limite = new Date(new Date(publicadaEm).getTime() + DIAS_PARA_EDITAR * 24 * 60 * 60 * 1000);
  return Number.isNaN(limite.getTime()) ? null : formatarDataHora(limite.toISOString());
}

/** Media da lista com 1 casa decimal (null sem avaliacoes), para o resumo do profissional. */
export function mediaDe(notas: readonly number[]): number | null {
  if (notas.length === 0) return null;
  return Math.round((notas.reduce((a, b) => a + b, 0) / notas.length) * 10) / 10;
}
