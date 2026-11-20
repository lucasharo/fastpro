// H-058 (Issue #71) | Aceite idempotente: regras puras (docs/factory/162-DESENHO-H058.md, §2, §3, §8 fatia 1).
// Sem I/O: formato da chave, corpo vazio, hash do pedido, capacidade por onda, modelo da mensagem de sistema,
// mapa outcome -> resposta HTTP e montagem do envelope. Banco e relogio ficam fora do dominio.
import { createHash } from 'node:crypto';

/** Vagas na primeira onda (sem 2a onda). */
export const ACCEPTANCE_CAPACITY_WAVE1 = 4;
/** Vagas com a 2a onda aberta (teto de 8). */
export const ACCEPTANCE_CAPACITY_WAVE2 = 8;
/** Limite de posicao de vaga (slot_no entre 1 e 8). */
export const ACCEPTANCE_SLOT_MIN = 1;
export const ACCEPTANCE_SLOT_MAX = 8;
/** Corpo maximo aceito pela rota (decisao 852, padrao de 1 KiB). */
export const ACCEPTANCE_BODY_MAX_BYTES = 1024;
/** Nome da operacao na tabela de idempotencia (ops.idempotency_key.operation). */
export const ACCEPTANCE_OPERATION = 'request_acceptance';
/** Versao do modelo da mensagem de sistema (decisao 864). */
export const ACCEPTANCE_SYSTEM_TEMPLATE_VERSION = 1;
/** Texto fixo da mensagem de sistema do aceite (modelo versionado, nao gravado no banco). */
export const ACCEPTANCE_SYSTEM_MESSAGE_V1 = 'Estou disponível para trabalhar';
/** Mensagem neutra de 409 para sem_vagas e admissao_encerrada (sem contadores). */
export const ACCEPTANCE_NEUTRAL_MESSAGE =
  'O pedido não está mais disponível para novos atendimentos.';

const UUID_CANONICO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Id do pedido no caminho: UUID canonico. Malformado vira 404 sem tocar o banco (A-9). */
export function isAcceptanceRequestId(valor: unknown): valor is string {
  return typeof valor === 'string' && UUID_CANONICO.test(valor);
}

/** Cabecalho Idempotency-Key: UUID versao 4 com variante RFC (decisao 851 e refino). Devolve minusculas. */
export function normalizeAcceptanceIdempotencyKey(valor: unknown): string | null {
  if (typeof valor !== 'string' || !UUID_V4.test(valor)) return null;
  return valor.toLowerCase();
}

export type AcceptanceBodyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'corpo_invalido' | 'campos_extras_recusados' };

/**
 * Corpo do aceite: ausente ou objeto sem nenhuma chave. Qualquer outra coisa (propriedade, array, null,
 * texto) e recusada com campos_extras_recusados (decisao 852). Corpo acima de 1 KiB: corpo_invalido.
 * JSON malformado e tratado pela camada HTTP antes desta funcao.
 */
export function validarCorpoAceite(raw: unknown, bytes?: number): AcceptanceBodyResult {
  if (bytes !== undefined && bytes > ACCEPTANCE_BODY_MAX_BYTES)
    return { ok: false, code: 'corpo_invalido' };
  if (raw === undefined) return { ok: true };
  if (
    typeof raw === 'object' &&
    raw !== null &&
    !Array.isArray(raw) &&
    Object.keys(raw).length === 0
  ) {
    return { ok: true };
  }
  return { ok: false, code: 'campos_extras_recusados' };
}

/**
 * Hash do pedido de aceite (A-7): sha256('request_acceptance:v1:' || requestId || ':{}').
 * Inclui o id do pedido: a mesma chave em outro pedido vira conflito (422).
 */
export function requestAcceptanceHash(requestId: string): string {
  return createHash('sha256')
    .update(`request_acceptance:v1:${requestId.toLowerCase()}:{}`)
    .digest('hex');
}

/** Onda de uma vaga: 1 para 1..4, 2 para 5..8. Fora do intervalo lanca erro (bug de chamador). */
export function waveDoSlot(slotNo: number): 1 | 2 {
  if (!Number.isInteger(slotNo) || slotNo < ACCEPTANCE_SLOT_MIN || slotNo > ACCEPTANCE_SLOT_MAX) {
    throw new RangeError('slot_no fora de 1..8');
  }
  return slotNo <= ACCEPTANCE_CAPACITY_WAVE1 ? 1 : 2;
}

/** Capacidade do pedido: 4 sem a 2a onda; 8 depois de aberta. */
export function capacidadeDoPedido(segundaOndaAberta: boolean): number {
  return segundaOndaAberta ? ACCEPTANCE_CAPACITY_WAVE2 : ACCEPTANCE_CAPACITY_WAVE1;
}

/** Texto da mensagem de sistema pelo modelo versionado; null para versao desconhecida. */
export function renderAcceptanceSystemMessage(templateVersion: number): string | null {
  return templateVersion === ACCEPTANCE_SYSTEM_TEMPLATE_VERSION
    ? ACCEPTANCE_SYSTEM_MESSAGE_V1
    : null;
}

/** Resultado de negocio devolvido por private.acceptance_create (out_outcome). */
export const ACCEPTANCE_OUTCOMES = [
  'criado',
  'existente',
  'profissional_inelegivel',
  'pedido_nao_encontrado',
  'admissao_encerrada',
  'autoaceite_proibido',
  'servico_ou_raio_incompativel',
  'reaceite_proibido',
  'aceite_duplicado_identidade',
  'sem_vagas',
] as const;
export type AcceptanceOutcome = (typeof ACCEPTANCE_OUTCOMES)[number];

/** Codigos de erro HTTP da rota de aceite (a lista completa do contrato, §3.3 do desenho). */
export const ACCEPTANCE_ERROR_CODES = [
  'chave_idempotencia_obrigatoria',
  'chave_idempotencia_invalida',
  'corpo_invalido',
  'parametro_invalido',
  'sessao_necessaria',
  'perfil_profissional_obrigatorio',
  'profissional_inelegivel',
  'autoaceite_proibido',
  'servico_ou_raio_incompativel',
  'pedido_nao_encontrado',
  'admissao_encerrada',
  'sem_vagas',
  'reaceite_proibido',
  'aceite_duplicado_identidade',
  'operacao_em_andamento',
  'contencao_temporaria',
  'campos_extras_recusados',
  'chave_reutilizada_com_corpo_diferente',
  'muitas_requisicoes',
  'servico_indisponivel',
  'erro_interno',
] as const;
export type AcceptanceErrorCode = (typeof ACCEPTANCE_ERROR_CODES)[number];

export interface AcceptanceHttpResponse {
  readonly status: number;
  readonly code?: AcceptanceErrorCode;
  /** Presente apenas em sem_vagas e admissao_encerrada (texto neutro, sem contadores). */
  readonly message?: string;
}

/**
 * Mapa outcome -> HTTP (§3.3). Nao devolve contador, onda nem motivo financeiro ou documental.
 * profissional_inelegivel e uniforme: nao revela o motivo (guarda de elegibilidade).
 */
export function acceptanceOutcomeResponse(outcome: AcceptanceOutcome): AcceptanceHttpResponse {
  switch (outcome) {
    case 'criado':
      return { status: 201 };
    case 'existente':
      return { status: 200 };
    case 'profissional_inelegivel':
      return { status: 403, code: 'profissional_inelegivel' };
    case 'pedido_nao_encontrado':
      return { status: 404, code: 'pedido_nao_encontrado' };
    case 'admissao_encerrada':
      return { status: 409, code: 'admissao_encerrada', message: ACCEPTANCE_NEUTRAL_MESSAGE };
    case 'autoaceite_proibido':
      return { status: 403, code: 'autoaceite_proibido' };
    case 'servico_ou_raio_incompativel':
      return { status: 403, code: 'servico_ou_raio_incompativel' };
    case 'reaceite_proibido':
      return { status: 409, code: 'reaceite_proibido' };
    case 'aceite_duplicado_identidade':
      return { status: 409, code: 'aceite_duplicado_identidade' };
    case 'sem_vagas':
      return { status: 409, code: 'sem_vagas', message: ACCEPTANCE_NEUTRAL_MESSAGE };
  }
}

/** Registro do aceite lido do banco (criado ou existente), ja com o primeiro nome decidido pelo banco. */
export interface AcceptanceRecord {
  readonly id: string;
  readonly requestId: string;
  readonly slotNo: number;
  readonly wave: number;
  readonly status: 'ativo' | 'retirado' | 'removido_por_seguranca';
  /** Instante ISO 8601 em UTC. */
  readonly acceptedAt: string;
  readonly conversationId: string;
  readonly conversationState: 'ativa' | 'somente_leitura';
  readonly firstName: string | null;
}

/** Envelope de sucesso (201/200). Campos fixos; sem telefone, e-mail, sobrenome, endereco ou contador. */
export interface AcceptanceEnvelope {
  readonly acceptance: {
    readonly id: string;
    readonly requestId: string;
    readonly slotNo: number;
    readonly wave: number;
    readonly status: AcceptanceRecord['status'];
    readonly acceptedAt: string;
  };
  readonly conversation: {
    readonly id: string;
    readonly state: AcceptanceRecord['conversationState'];
  };
  readonly customer: { readonly firstName: string | null };
}

/**
 * Monta o envelope (A-8). O primeiro nome so aparece com aceite ativo; senao null.
 */
export function montarEnvelopeAceite(registro: AcceptanceRecord): AcceptanceEnvelope {
  const ativo = registro.status === 'ativo';
  return {
    acceptance: {
      id: registro.id,
      requestId: registro.requestId,
      slotNo: registro.slotNo,
      wave: registro.wave,
      status: registro.status,
      acceptedAt: registro.acceptedAt,
    },
    conversation: { id: registro.conversationId, state: registro.conversationState },
    customer: { firstName: ativo ? registro.firstName : null },
  };
}
