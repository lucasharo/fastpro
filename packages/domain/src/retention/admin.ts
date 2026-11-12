// H-109 (Issue 118) | Cadastro da politica e do hold (docs/factory/82-DESENHO-H109.md §5; 79 CA-H109-02 e 03).
// Logica pura: valida a forma do corpo, decide a proposta com decidirPolitica e traduz erros do banco
// em codigo fixo. Nenhum valor de entrada volta na resposta. A autoridade e o banco (funcoes private.*).
import { isRetentionClass, type MotivoPolitica } from './policy.js';
import type { RetentionClass } from './types.js';

/** Corpo de POST /v1/admin/retention/policy-changes, ja com a forma conferida. */
export interface MudancaPolitica {
  readonly dataClass: RetentionClass;
  readonly periodSeconds: number | null;
  readonly action: string | null;
  readonly legalBasisRef: string | null;
  readonly effectiveFrom: string | null;
  readonly enabled: boolean;
  readonly dryRun: boolean;
}

export type ResultadoForma<T> = { readonly ok: true; readonly valor: T } | { readonly ok: false; readonly code: string };

const CAMPOS_MUDANCA = [
  'dataClass',
  'periodSeconds',
  'action',
  'legalBasisRef',
  'effectiveFrom',
  'enabled',
  'dryRun',
] as const;

function nuloOuTexto(v: unknown, max: number): v is string | null {
  return v === null || (typeof v === 'string' && v.length >= 1 && v.length <= max);
}

/** Forma do corpo: campos fixos, tipos conferidos. Sem decisao de negocio aqui. */
export function interpretarMudancaPolitica(corpo: unknown): ResultadoForma<MudancaPolitica> {
  if (typeof corpo !== 'object' || corpo === null || Array.isArray(corpo)) {
    return { ok: false, code: 'corpo_invalido' };
  }
  const o = corpo as Record<string, unknown>;
  const extras = Object.keys(o).filter((k) => !(CAMPOS_MUDANCA as readonly string[]).includes(k));
  if (extras.length > 0) return { ok: false, code: 'campo_desconhecido' };
  if (!isRetentionClass(o.dataClass)) return { ok: false, code: 'classe_invalida' };
  const periodo = o.periodSeconds ?? null;
  if (periodo !== null && (typeof periodo !== 'number' || !Number.isSafeInteger(periodo))) {
    return { ok: false, code: 'periodo_invalido' };
  }
  if (!nuloOuTexto(o.action, 16) || !nuloOuTexto(o.legalBasisRef, 64)) {
    return { ok: false, code: 'corpo_invalido' };
  }
  if (!nuloOuTexto(o.effectiveFrom, 40)) return { ok: false, code: 'corpo_invalido' };
  if (typeof o.enabled !== 'boolean' || typeof o.dryRun !== 'boolean') {
    return { ok: false, code: 'corpo_invalido' };
  }
  return {
    ok: true,
    valor: {
      dataClass: o.dataClass,
      periodSeconds: periodo as number | null,
      action: o.action as string | null,
      legalBasisRef: o.legalBasisRef as string | null,
      effectiveFrom: o.effectiveFrom as string | null,
      enabled: o.enabled,
      dryRun: o.dryRun,
    },
  };
}

/** Papeis de sujeito do hold (82 §1). */
export const SUJEITOS_HOLD = ['user', 'request'] as const;
export type SujeitoHold = (typeof SUJEITOS_HOLD)[number];

export function interpretarHold(
  corpo: unknown,
): ResultadoForma<{ readonly subjectType: SujeitoHold; readonly subjectId: string; readonly reasonCode: string }> {
  if (typeof corpo !== 'object' || corpo === null || Array.isArray(corpo)) {
    return { ok: false, code: 'corpo_invalido' };
  }
  const o = corpo as Record<string, unknown>;
  if (!(SUJEITOS_HOLD as readonly unknown[]).includes(o.subjectType)) return { ok: false, code: 'corpo_invalido' };
  if (typeof o.subjectId !== 'string' || !/^[0-9a-f-]{36}$/i.test(o.subjectId)) {
    return { ok: false, code: 'corpo_invalido' };
  }
  if (typeof o.reasonCode !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(o.reasonCode)) {
    return { ok: false, code: 'corpo_invalido' };
  }
  return {
    ok: true,
    valor: { subjectType: o.subjectType as SujeitoHold, subjectId: o.subjectId, reasonCode: o.reasonCode },
  };
}

/** Porta do cadastro. As implementacoes chamam as funcoes private.retention_* e private.legal_hold_*. */
export interface RetentionAdminPort {
  /** Politica atual da classe e se ha simulacao registrada. Nulo = classe inexistente. */
  lerPolitica(classe: RetentionClass): Promise<{ readonly id: string; readonly simulacaoRegistrada: boolean } | null>;
  proporPolitica(
    actorId: string,
    mudanca: MudancaPolitica,
    politicaId: string,
    changeId: string,
    nowMs: number,
  ): Promise<{ readonly approvalRequestId: string }>;
  registrarNegacaoPolitica(actorId: string, classe: RetentionClass, motivo: MotivoPolitica, nowMs: number): Promise<void>;
  /** Voto de aprovacao (H-102). Devolve o estado do pedido. */
  votar(approvalId: string, approverId: string, nowMs: number): Promise<'pendente' | 'aprovada' | 'expirada'>;
  aplicarPolitica(actorId: string, changeId: string, nowMs: number): Promise<void>;
  colocarHold(
    actorId: string,
    hold: { readonly subjectType: SujeitoHold; readonly subjectId: string; readonly reasonCode: string },
    nowMs: number,
  ): Promise<{ readonly holdId: string }>;
  proporLiberacaoHold(actorId: string, holdId: string, nowMs: number): Promise<{ readonly approvalRequestId: string }>;
  liberarHold(actorId: string, holdId: string, approvalId: string, nowMs: number): Promise<void>;
}

/** Erro do banco com codigo fixo (mensagem da funcao ou SQLSTATE traduzido pelo adaptador). Sem dado. */
export class RetentionAdminError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = 'RetentionAdminError';
    this.code = code;
  }
}

/** Codigos que o banco e o adaptador podem devolver, e o que cada um significa para a API. */
export const CODIGOS_RETENCAO = [
  'permissao_negada',
  'aprovador_sem_permissao',
  'aprovador_nao_ativo',
  'aprovador_nao_superadmin',
  'aprovacao_propria',
  'aprovacao_invalida',
  'aprovacao_inexistente',
  'aprovacao_nao_pendente',
  'alteracao_invalida',
  'classe_invalida',
  'classe_inexistente',
  'acao_nao_permitida',
  'periodo_invalido',
  'habilitacao_incompleta',
  'simulacao_pendente',
  'hold_inexistente',
  'retencao_entrada_invalida',
  'politica_inexistente',
] as const;

/** Codigo do banco reconhecido (mensagem do RAISE), ou nulo: desconhecido vira 503 generico. */
export function codigoDeRetencao(mensagem: string): string | null {
  return (CODIGOS_RETENCAO as readonly string[]).includes(mensagem) ? mensagem : null;
}

/** Traduz o codigo do banco: 404 para ausencia de permissao (sem revelar a rota), 403/409/422 para regras. */
export function statusDoErroRetencao(code: string): { readonly status: number; readonly code: string } {
  switch (code) {
    case 'permissao_negada':
      return { status: 404, code: 'nao_encontrado' };
    case 'aprovador_sem_permissao':
    case 'aprovador_nao_ativo':
    case 'aprovador_nao_superadmin':
    case 'aprovacao_propria':
      return { status: 403, code };
    case 'aprovacao_inexistente':
    case 'hold_inexistente':
    case 'classe_inexistente':
    case 'politica_inexistente':
      return { status: 404, code: 'nao_encontrado' };
    case 'aprovacao_nao_pendente':
    case 'aprovacao_invalida':
    case 'alteracao_invalida':
      return { status: 409, code };
    case 'classe_invalida':
    case 'acao_nao_permitida':
    case 'periodo_invalido':
    case 'habilitacao_incompleta':
    case 'simulacao_pendente':
      return { status: 422, code };
    case 'retencao_entrada_invalida':
      return { status: 400, code: 'corpo_invalido' };
    default:
      return { status: 503, code: 'retencao_indisponivel' };
  }
}
