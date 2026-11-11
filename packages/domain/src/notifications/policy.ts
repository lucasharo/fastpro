// H-092 | Politica por categoria (docs/factory/35-DESENHO-H092.md, secao 2; 08 §12.1; 04 RF-115..119).
// Logica pura, sem I/O. A classe e declarada por email_type (lembrete de trial e categoria acesso,
// classe lembrete). Combinacao nao listada e recusada (falha fechada).

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
  aceite_aviso: { category: 'aceite', mailClass: 'digest', params: ['request_ref', 'count'] },
  aceite_resumo: { category: 'aceite', mailClass: 'digest', params: ['request_ref', 'count'] },
  mensagem_aviso: {
    category: 'mensagem',
    mailClass: 'digest',
    params: ['conversation_ref', 'count'],
  },
  mensagem_resumo: {
    category: 'mensagem',
    mailClass: 'digest',
    params: ['conversation_ref', 'count'],
  },
  // Seleção e cancelamento: sem referencia ao profissional selecionado (35 §6; CA-H092-15).
  selecao: { category: 'selecao', mailClass: 'critico', params: REQUEST },
  cancelamento: { category: 'cancelamento', mailClass: 'critico', params: REQUEST },
  desistencia: { category: 'desistencia', mailClass: 'critico', params: REQUEST },
  verificacao: { category: 'verificacao', mailClass: 'critico', params: [] },
  prazo_t24: { category: 'prazo', mailClass: 'lembrete', params: REQUEST },
  prazo_t0: { category: 'prazo', mailClass: 'lembrete', params: REQUEST },
  acesso_login: { category: 'acesso', mailClass: 'auth', params: [] },
  acesso_conta: { category: 'acesso', mailClass: 'auth', params: [] },
  acesso_trial: { category: 'acesso', mailClass: 'lembrete', params: [] },
  acesso_ciclo: { category: 'acesso', mailClass: 'lembrete', params: [] },
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
