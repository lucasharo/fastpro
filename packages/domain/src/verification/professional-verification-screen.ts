// Issue 54 (H-041) | View-model da tela de situacao do profissional (docs/factory/141-DESENHO-H041.md §6.1 e §6.4).
// Dominio puro: sem DOM, sem rede. O renderizador de apps/web so desenha o que recebe daqui.
import type { EstadoVerificacaoProfissional } from './professional-verification-state.js';
import {
  ROTULO_DATA_DECISAO,
  ROTULO_ENVIAR_DOCUMENTOS,
  ROTULO_EXPLICACAO,
  ROTULO_MOTIVO,
  ROTULO_PEDIR_REVISAO,
  TEXTOS_ESTADO,
  TEXTO_CARREGANDO,
  TEXTO_ERRO_CARREGAMENTO,
  TEXTO_MOTIVO,
  TEXTO_RECURSO_ANALISADO,
  TEXTO_RECURSO_INDISPONIVEL,
  TEXTO_RECURSO_RECEBIDO,
} from './professional-verification-texts.js';

export const TIPOS_TELA = [
  'carregando',
  'sem_envio',
  'em_analise',
  'aprovada',
  'recusada',
  'suspensa',
  'recurso_recebido',
  'erro',
  'recurso_indisponivel',
] as const;
export type TipoTela = (typeof TIPOS_TELA)[number];

export interface AcaoTela {
  readonly rotulo: string;
  readonly destino: 'documentos' | 'recurso';
  readonly desabilitada: boolean;
}

export interface TelaVerificacao {
  readonly tipo: TipoTela;
  /** Frase principal da tela (texto de 141 §6.3). */
  readonly titulo: string;
  readonly motivoRotulo?: string;
  readonly motivoTexto?: string;
  readonly explicacaoRotulo?: string;
  readonly explicacao?: string;
  readonly dataRotulo?: string;
  /** Data em dd/mm/aaaa (UTC), sem hora. */
  readonly dataValor?: string;
  readonly acao?: AcaoTela;
  /** Aviso secundario: recurso recebido ou analisado. */
  readonly aviso?: string;
}

export type EntradaTela =
  | { readonly tipo: 'carregando' }
  | { readonly tipo: 'erro' }
  | { readonly tipo: 'recurso_indisponivel' }
  | { readonly tipo: 'recurso_recebido' }
  | { readonly tipo: 'estado'; readonly estado: EstadoVerificacaoProfissional };

/** ISO 8601 para dd/mm/aaaa em UTC. Entrada invalida devolve vazio (a tela omite a data). */
export function formatarDataIso(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function telaDeEstado(estado: EstadoVerificacaoProfissional): TelaVerificacao {
  const { situacao } = estado.recurso;
  const aviso = situacao === 'recebido' ? TEXTO_RECURSO_RECEBIDO : situacao === 'analisado' ? TEXTO_RECURSO_ANALISADO : undefined;
  const data = estado.decididoEm ? formatarDataIso(estado.decididoEm) : '';
  const base = { ...(aviso ? { aviso } : {}) };

  switch (estado.estado) {
    case 'sem_envio':
      return {
        tipo: 'sem_envio',
        titulo: TEXTOS_ESTADO.sem_envio,
        acao: { rotulo: ROTULO_ENVIAR_DOCUMENTOS, destino: 'documentos', desabilitada: false },
      };
    case 'em_analise':
      return { tipo: 'em_analise', titulo: TEXTOS_ESTADO.em_analise, ...base };
    case 'aprovada':
      return {
        tipo: 'aprovada',
        titulo: TEXTOS_ESTADO.aprovada,
        ...(data ? { dataRotulo: ROTULO_DATA_DECISAO, dataValor: data } : {}),
      };
    case 'suspensa':
      return { tipo: 'suspensa', titulo: TEXTOS_ESTADO.suspensa };
    case 'recusada': {
      const motivo = estado.motivo;
      return {
        tipo: 'recusada',
        titulo: TEXTOS_ESTADO.recusada,
        ...(motivo ? { motivoRotulo: ROTULO_MOTIVO, motivoTexto: TEXTO_MOTIVO[motivo] } : {}),
        ...(estado.explicacao ? { explicacaoRotulo: ROTULO_EXPLICACAO, explicacao: estado.explicacao } : {}),
        ...(data ? { dataRotulo: ROTULO_DATA_DECISAO, dataValor: data } : {}),
        ...(situacao === 'disponivel'
          ? { acao: { rotulo: ROTULO_PEDIR_REVISAO, destino: 'recurso', desabilitada: false } }
          : {}),
        ...(situacao === 'recebido'
          ? { acao: { rotulo: ROTULO_PEDIR_REVISAO, destino: 'recurso', desabilitada: true } }
          : {}),
        ...base,
      };
    }
    default:
      return { tipo: 'erro', titulo: TEXTO_ERRO_CARREGAMENTO };
  }
}

/** Monta a tela a partir do estado visivel ou de um evento de carregamento, erro ou recurso. */
export function construirTela(entrada: EntradaTela): TelaVerificacao {
  switch (entrada.tipo) {
    case 'carregando':
      return { tipo: 'carregando', titulo: TEXTO_CARREGANDO };
    case 'erro':
      return { tipo: 'erro', titulo: TEXTO_ERRO_CARREGAMENTO };
    case 'recurso_indisponivel':
      return { tipo: 'recurso_indisponivel', titulo: TEXTO_RECURSO_INDISPONIVEL };
    case 'recurso_recebido':
      return { tipo: 'recurso_recebido', titulo: TEXTO_RECURSO_RECEBIDO };
    case 'estado':
      return telaDeEstado(entrada.estado);
  }
}
