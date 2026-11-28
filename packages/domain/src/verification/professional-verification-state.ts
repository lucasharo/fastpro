// Issue 54 (H-041) | Estado visivel ao profissional (docs/factory/141-DESENHO-H041.md §4.1 e §6.1). Dominio puro.
// Revalida a linha que o banco devolveu: so o vocabulario publico, so motivos da lista, explicacao ate 500 caracteres.
// Falha fechada: vocabulario desconhecido devolve nulo, e o chamador responde erro generico.
import { estadoPublicoDoProfissional } from './professional-status-message.js';

export const ESTADOS_PUBLICOS_VERIFICACAO = ['sem_envio', 'em_analise', 'aprovada', 'recusada', 'suspensa'] as const;
export type EstadoPublicoVerificacao = (typeof ESTADOS_PUBLICOS_VERIFICACAO)[number];

export const SITUACOES_RECURSO = ['indisponivel', 'disponivel', 'recebido', 'analisado'] as const;
export type SituacaoRecurso = (typeof SITUACOES_RECURSO)[number];

/** Motivos que o profissional pode ver. duplicidade_suspeita e aprovado nunca entram aqui (dec. 544, 545). */
export const MOTIVOS_VISIVEIS = [
  'documento_ilegivel',
  'documento_divergente',
  'tipo_nao_aceito',
  'certificacao_insuficiente',
  'outro',
] as const;
export type MotivoVisivel = (typeof MOTIVOS_VISIVEIS)[number];

export const EXPLICACAO_MAX_CARACTERES = 500;

/** Linha devolvida por private.professional_verification_state (nomes de coluna do banco). */
export interface LinhaEstadoVerificacao {
  readonly out_state: string;
  readonly out_reason_code: string | null;
  readonly out_explanation: string | null;
  readonly out_decided_at: Date | string | null;
  readonly out_appeal: string;
}

/** Resposta da leitura (lista branca, 141 §5). Campos ausentes nao sao montados. */
export interface EstadoVerificacaoProfissional {
  readonly estado: EstadoPublicoVerificacao;
  readonly motivo?: MotivoVisivel;
  readonly explicacao?: string;
  readonly decididoEm?: string;
  readonly recurso: { readonly situacao: SituacaoRecurso };
}

function pertence<T extends string>(lista: readonly T[], valor: unknown): valor is T {
  return typeof valor === 'string' && (lista as readonly string[]).includes(valor);
}

function dataIso(valor: Date | string | null): string | undefined {
  if (valor === null) return undefined;
  const data = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(data.getTime()) ? undefined : data.toISOString();
}

/** Converte a linha do banco no estado visivel; nulo quando algum campo nao esta no vocabulario. */
export function montarEstadoVisivel(linha: LinhaEstadoVerificacao): EstadoVerificacaoProfissional | null {
  const estado = estadoPublicoDoProfissional(linha.out_state);
  if (!pertence(ESTADOS_PUBLICOS_VERIFICACAO, estado)) return null;
  if (!pertence(SITUACOES_RECURSO, linha.out_appeal)) return null;
  const recurso = { situacao: linha.out_appeal };

  if (estado === 'aprovada') {
    const decididoEm = dataIso(linha.out_decided_at);
    return { estado, recurso, ...(decididoEm ? { decididoEm } : {}) };
  }

  if (estado !== 'recusada') return { estado, recurso };

  const decididoEm = dataIso(linha.out_decided_at);
  const motivo = pertence(MOTIVOS_VISIVEIS, linha.out_reason_code) ? linha.out_reason_code : undefined;
  const explicacao =
    motivo !== undefined &&
    typeof linha.out_explanation === 'string' &&
    linha.out_explanation.length <= EXPLICACAO_MAX_CARACTERES
      ? linha.out_explanation
      : undefined;
  return {
    estado,
    recurso,
    ...(decididoEm ? { decididoEm } : {}),
    ...(motivo !== undefined ? { motivo } : {}),
    ...(explicacao !== undefined ? { explicacao } : {}),
  };
}
