// H-110 (Issue 119) | Tipos da orquestracao dos expurgos operacionais (docs/factory/105-DESENHO-H110.md §2 e §6).
// Sem banco, sem Storage e sem dado pessoal: so contagens e codigos fixos.

/** Blocos na ordem de execucao (E1 a E9). E6 soma a saida de eventos (E6a) e a de e-mail (E6b). */
export const BLOCOS_OPS_PURGE = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9'] as const;
export type BlocoOpsPurge = (typeof BLOCOS_OPS_PURGE)[number];

export type EstadoBlocoOpsPurge =
  | 'ok'
  | 'desligado'
  | 'ocupado'
  | 'pulado_ausente'
  | 'pulado_incompativel'
  | 'falha'
  | 'nao_executado';

/** Resultado de um lote. `retidos` e uma contagem do estado atual (nao acumula entre lotes). */
export interface ResultadoLoteOpsPurge {
  readonly estado: EstadoBlocoOpsPurge;
  readonly removidos: number;
  readonly retidos: number;
  readonly falhos: number;
}

/** Executor de um bloco. Cada chamada processa no maximo `limite` linhas ou objetos. */
export interface ExecutorBlocoOpsPurge {
  readonly bloco: BlocoOpsPurge;
  lote(limite: number): Promise<ResultadoLoteOpsPurge>;
}

export interface OpcoesOpsPurge {
  readonly executores: readonly ExecutorBlocoOpsPurge[];
  /** Relogio em milissegundos (injetado para teste). */
  readonly agora: () => number;
  /** Linhas por lote. Padrao de codigo, nao e prazo de dado. */
  readonly limiteLote?: number;
  /** Orcamento de tempo do job, sempre menor que o tempo maximo do tick (30 s). */
  readonly orcamentoMs?: number;
  /** Teto de lotes por bloco nesta execucao. */
  readonly maxLotes?: number;
  readonly numeroExecucao?: number;
}

/** Chaves do evento de auditoria: run_no e, por bloco, _removidos, _retidos, _falhos, _pulado (37 chaves). */
export type ContagensOpsPurge = Readonly<Record<string, number>>;

export interface RelatorioOpsPurge {
  readonly contagens: ContagensOpsPurge;
  readonly estados: Readonly<Record<BlocoOpsPurge, EstadoBlocoOpsPurge>>;
  /** Verdadeiro se ainda havia elegiveis quando o orcamento ou o teto de lotes acabou. */
  readonly restante: boolean;
}

export const LIMITE_LOTE_PADRAO = 500;
export const ORCAMENTO_MS_PADRAO = 15_000;
export const MAX_LOTES_PADRAO = 50;
