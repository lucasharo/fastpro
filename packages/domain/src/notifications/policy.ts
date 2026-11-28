// H-092 | Politica por categoria (docs/factory/35-DESENHO-H092.md, secao 2; 08 §12.1; 04 RF-115..119).
// Logica pura, sem I/O. A classe e declarada por email_type (lembrete de trial e categoria acesso,
// classe lembrete). Combinacao nao listada e recusada (falha fechada).

// H-100 | Marco de vigencia do pipeline (docs/factory/49-DESENHO-H100.md, D-1; decisao 27).
// Eventos de outbox anteriores a este instante so recebem dispatched_at: nenhum item, linha de envio
// ou chamada ao provedor (RF-122, sem e-mails retroativos). Literal fixo: nao vem de ambiente nem de
// configuracao; o verificador check:email-switch reprova qualquer outra origem.
export const NOTIFICATION_EFFECTIVE_FROM_MS = Date.UTC(2026, 10, 11);

export const CATEGORIES = [
  'aceite',
  'mensagem',
  'selecao',
  'cancelamento',
  'desistencia',
  'verificacao',
  'prazo',
  'acesso',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const MAIL_CLASSES = ['auth', 'critico', 'digest', 'lembrete'] as const;
export type MailClass = (typeof MAIL_CLASSES)[number];

export interface EmailTypePolicy {
  readonly category: Category;
  readonly mailClass: MailClass;
  /** Allowlist de template_params (35 §6). Vazia = so o endereco resolvido no envio. */
  readonly params: readonly string[];
}

export type PolicyErrorCode = 'tipo_nao_listado' | 'combinacao_invalida' | 'categoria_sem_janela';

export class PolicyError extends Error {
  readonly code: PolicyErrorCode;
  constructor(code: PolicyErrorCode) {
    super(code);
    this.name = 'PolicyError';
    this.code = code;
  }
}

const REQUEST = ['request_ref'] as const;

export const EMAIL_TYPE_POLICY: Readonly<Record<string, EmailTypePolicy>> = Object.freeze({
  // Pacote D (H-095): aviso do aceite leva o nome do servico (so no aviso imediato); o resumo agrupado nao.
  aceite_aviso: { category: 'aceite', mailClass: 'digest', params: ['request_ref', 'servico'] },
  aceite_resumo: { category: 'aceite', mailClass: 'digest', params: ['request_ref', 'count'] },
  // Pacote D (H-096): request_ref entra na allowlist; conversation_ref continua valido (compatibilidade).
  mensagem_aviso: {
    category: 'mensagem',
    mailClass: 'digest',
    params: ['conversation_ref', 'request_ref', 'count'],
  },
  mensagem_resumo: {
    category: 'mensagem',
    mailClass: 'digest',
    params: ['conversation_ref', 'request_ref', 'count'],
  },
  // Pacote D (H-096): mensagem para o profissional. Link fixo (/profissional/conversas), sem referencia.
  mensagem_profissional_aviso: { category: 'mensagem', mailClass: 'digest', params: [] },
  mensagem_profissional_resumo: { category: 'mensagem', mailClass: 'digest', params: ['count'] },
  // Seleção e cancelamento: sem referencia ao profissional selecionado (35 §6; CA-H092-15).
  selecao: { category: 'selecao', mailClass: 'critico', params: REQUEST },
  // Pacote D (H-098): aviso aos interessados que nao foram escolhidos. Sem identidade de ninguem.
  selecao_outro: { category: 'selecao', mailClass: 'critico', params: REQUEST },
  cancelamento: { category: 'cancelamento', mailClass: 'critico', params: REQUEST },
  desistencia: { category: 'desistencia', mailClass: 'critico', params: REQUEST },
  verificacao: { category: 'verificacao', mailClass: 'critico', params: [] },
  prazo_t24: { category: 'prazo', mailClass: 'lembrete', params: REQUEST },
  prazo_t0: { category: 'prazo', mailClass: 'lembrete', params: REQUEST },
  acesso_login: { category: 'acesso', mailClass: 'auth', params: ['challenge_ref'] },
  // H-014 (52 §4.3): codigo de step-up. Classe auth (prioridade maxima); so a referencia do desafio.
  acesso_stepup: { category: 'acesso', mailClass: 'auth', params: ['challenge_ref'] },
  // H-111 (147-DESENHO-H111 §5.1, P-A): codigo do step-up do titular. Classe auth; so a referencia do codigo.
  dsr_stepup: { category: 'acesso', mailClass: 'auth', params: ['challenge_ref'] },
  acesso_conta:{ category: 'acesso', mailClass: 'auth', params: [] },
  acesso_trial: { category: 'acesso', mailClass: 'lembrete', params: [] },
  acesso_ciclo: { category: 'acesso', mailClass: 'lembrete', params: [] },
  // H-099 (desenho 163 §3.3): lembretes de trial. Aditivo; acesso_trial e acesso_ciclo genericos ficam (R-08).
  acesso_trial_t3d: { category: 'acesso', mailClass: 'lembrete', params: [] },
  acesso_trial_t0: { category: 'acesso', mailClass: 'lembrete', params: [] },
});

/** Politica de um email_type. Tipo nao listado (inclui a categoria 'outro') e recusado. */
export function policyFor(emailType: string): EmailTypePolicy {
  if (!Object.prototype.hasOwnProperty.call(EMAIL_TYPE_POLICY, emailType)) {
    throw new PolicyError('tipo_nao_listado');
  }
  const policy = EMAIL_TYPE_POLICY[emailType];
  if (!policy) throw new PolicyError('tipo_nao_listado');
  return policy;
}

export function classFor(emailType: string): MailClass {
  return policyFor(emailType).mailClass;
}

/** Confere que categoria, tipo e classe combinam com a politica (combinacao invalida = recusa). */
export function assertCombination(
  category: Category,
  emailType: string,
  mailClass: MailClass,
): void {
  const policy = policyFor(emailType);
  if (policy.category !== category || policy.mailClass !== mailClass) {
    throw new PolicyError('combinacao_invalida');
  }
}

/** Somente categorias digest agrupam (RF-118): aceite e mensagem. */
export type DigestCategory = 'aceite' | 'mensagem';

export function isDigestCategory(category: Category): category is DigestCategory {
  return category === 'aceite' || category === 'mensagem';
}

/** Tipo de e-mail do resumo agrupado de uma categoria digest. */
export function summaryTypeFor(category: DigestCategory): string {
  return category === 'aceite' ? 'aceite_resumo' : 'mensagem_resumo';
}

/** Prefixo do escopo de mensagem do profissional (pro:<id do pedido>). O cliente usa so o id do pedido. */
export const PROFISSIONAL_SCOPE_PREFIX = 'pro:';

/** Escopo do digest de mensagem: o id do pedido para o cliente, pro:<id> para o profissional (Pacote D, H-096). */
export function escopoMensagem(papel: 'cliente' | 'profissional', requestId: string): string {
  return papel === 'profissional' ? `${PROFISSIONAL_SCOPE_PREFIX}${requestId}` : requestId;
}

/** Id do pedido embutido no escopo (inverso de escopoMensagem; aceite usa o id puro). */
export function requestIdDoEscopo(scopeKey: string): string {
  return scopeKey.startsWith(PROFISSIONAL_SCOPE_PREFIX)
    ? scopeKey.slice(PROFISSIONAL_SCOPE_PREFIX.length)
    : scopeKey;
}

/**
 * Tipo e parametros do resumo agrupado (flush). Quem decide e o escopo: o profissional nao recebe o id do pedido
 * no resumo, o cliente recebe. Usado pelo flush; o aviso imediato usa o tipo que a regra escolheu.
 */
export function summaryFor(
  category: DigestCategory,
  scopeKey: string,
): { readonly emailType: string; readonly params: Readonly<Record<string, unknown>> } {
  if (category === 'aceite') return { emailType: 'aceite_resumo', params: { request_ref: scopeKey } };
  if (scopeKey.startsWith(PROFISSIONAL_SCOPE_PREFIX)) {
    return { emailType: 'mensagem_profissional_resumo', params: {} };
  }
  return { emailType: 'mensagem_resumo', params: { request_ref: scopeKey } };
}

/** Chave de ops.app_config que guarda a janela de cada categoria digest (35 §2). */
export const WINDOW_SETTING: Readonly<Record<DigestCategory, string>> = Object.freeze({
  aceite: 'notification.accept.window_seconds',
  mensagem: 'notification.messages.window_seconds',
});

export const WINDOW_DEFAULT_SECONDS = 900;
export const WINDOW_MIN_SECONDS = 60;
export const WINDOW_MAX_SECONDS = 3600;

/** Janela valida (inteiro entre 60 e 3600 s) ou o padrao de 900 s. Valor ausente ou invalido = padrao. */
export function windowSecondsFrom(raw: unknown): number {
  if (
    typeof raw === 'number' &&
    Number.isInteger(raw) &&
    raw >= WINDOW_MIN_SECONDS &&
    raw <= WINDOW_MAX_SECONDS
  ) {
    return raw;
  }
  return WINDOW_DEFAULT_SECONDS;
}
