// H-016 | Recuperacao e redefinicao de senha do profissional (docs/factory/33-DESENHO-H016.md §6.1 e §9;
// CA-H016-15 a CA-H016-17). Recuperacao: 202 identico sempre, com excesso de pedidos 429 + Retry-After
// (igual para e-mail existente ou nao). Redefinicao: link invalido, vencido ou usado = 410 unico; senha fraca =
// 422 e o link continua valido. Nenhuma resposta ou log traz e-mail, senha ou token.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  isProfessionalLinkToken,
  LINK_INVALID_BODY,
  loginEmailOrNull,
  normalizeClientIp,
  PROFESSIONAL_ACCEPTED_BODY,
  professionalPasswordProblem,
  professionalSendRules,
  SERVICE_UNAVAILABLE_BODY,
  worstRetryAfter,
  type ProfessionalSendLimitPort,
  type RateWindowDecision,
} from '@fastpro/domain';
import { enviar, iniciarPiso, lerJson } from './professional-route.js';

export const PASSWORD_RECOVERY_PATH = '/v1/auth/password/recovery';
export const PASSWORD_RESET_PATH = '/v1/auth/password/reset';
export const PROFESSIONAL_RESEND_PATH = '/v1/auth/professional/verification/resend';

/** Porta da recuperacao. Implementada no Postgres (@fastpro/db) e em memoria nos testes. */
export interface ProfessionalRecoveryPort {
  /** Cria o desafio e envia o link quando a conta se aplica; nada faz e nada revela caso contrario. */
  requestRecovery(email: string, nowMs: number): Promise<void>;
  /** Novo link de verificacao para conta profissional ainda nao verificada (CA-H016-09). Nada se aplica: nada faz. */
  resendVerification(email: string, nowMs: number): Promise<void>;
  /** E-mail do link vivo, sem consumir. Nulo para link inexistente, usado, vencido ou substituido. */
  peekReset(token: string, nowMs: number): Promise<{ readonly email: string } | null>;
  /** Troca a senha e consome o link. false quando o link nao serve mais. */
  resetPassword(token: string, newPassword: string, nowMs: number): Promise<boolean>;
}

export interface ProfessionalRecoveryRouteOptions {
  readonly port: ProfessionalRecoveryPort;
  /** Mesmos limites de envio do cadastro (e-mail e IP), em balde separado (33 §6.1, §4.4). */
  readonly limits: ProfessionalSendLimitPort;
  readonly clock: { nowMs(): number };
  readonly responseFloorMs?: number;
}

/**
 * Pedido por e-mail com limites (intervalo, hora por e-mail e hora por IP) e resposta 202 identica.
 * O balde do e-mail e separado por prefixo (recuperacao:, reenvio:) para um nao gastar o outro.
 */
async function pedidoPorEmail(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProfessionalRecoveryRouteOptions,
  prefixo: 'recuperacao' | 'reenvio',
  acao: (email: string, nowMs: number) => Promise<void>,
): Promise<void> {
  const piso = iniciarPiso(opts);
  const corpo = await lerJson(req);
  if (!corpo.ok) return enviar(piso, res, corpo.status, {}, undefined);
  const dados = (corpo.value ?? {}) as { email?: unknown };
  const email = loginEmailOrNull(dados.email);
  // Forma invalida nao envia nada e responde igual: nao ha conta a revelar.
  if (email === null) return enviar(piso, res, 202, {}, PROFESSIONAL_ACCEPTED_BODY);

  const agora = opts.clock.nowMs();
  const regras = professionalSendRules(`${prefixo}:${email}`, normalizeClientIp(req.socket.remoteAddress).value);
  let decisoes: RateWindowDecision[];
  try {
    decisoes = await Promise.all(regras.map((regra) => opts.limits.check(regra, agora)));
  } catch {
    return enviar(piso, res, 503, {}, SERVICE_UNAVAILABLE_BODY);
  }
  const espera = worstRetryAfter(decisoes);
  if (espera !== null) {
    return enviar(piso, res, 429, { 'Retry-After': String(espera) }, { code: 'muitos_pedidos', retry_after_seconds: espera });
  }
  try {
    await Promise.all(regras.map((regra) => opts.limits.record(regra, agora)));
    await acao(email, agora);
  } catch {
    return enviar(piso, res, 503, {}, SERVICE_UNAVAILABLE_BODY);
  }
  return enviar(piso, res, 202, {}, PROFESSIONAL_ACCEPTED_BODY);
}

/** POST /v1/auth/password/recovery: 202 sempre, salvo corpo invalido, limite (429) ou falha de infra (503). */
export function handlePasswordRecovery(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProfessionalRecoveryRouteOptions,
): Promise<void> {
  return pedidoPorEmail(req, res, opts, 'recuperacao', (email, agora) => opts.port.requestRecovery(email, agora));
}

/**
 * POST /v1/auth/professional/verification/resend {email} (CA-H016-09): novo link para conta profissional
 * ainda nao verificada. 202 identico para conta existente ou nao; 429 com Retry-After no excesso.
 */
export function handleVerificationResend(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProfessionalRecoveryRouteOptions,
): Promise<void> {
  return pedidoPorEmail(req, res, opts, 'reenvio', (email, agora) => opts.port.resendVerification(email, agora));
}

/** POST /v1/auth/password/reset: 204 na troca; 410 unico para link que nao serve; 422 para senha fraca. */
export async function handlePasswordReset(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProfessionalRecoveryRouteOptions,
): Promise<void> {
  const piso = iniciarPiso(opts);
  const corpo = await lerJson(req);
  if (!corpo.ok) return enviar(piso, res, corpo.status, {}, undefined);
  const dados = (corpo.value ?? {}) as { token?: unknown; new_password?: unknown };
  const agora = opts.clock.nowMs();
  if (!isProfessionalLinkToken(dados.token)) return enviar(piso, res, 410, {}, LINK_INVALID_BODY);

  let alvo: { readonly email: string } | null;
  try {
    alvo = await opts.port.peekReset(dados.token, agora);
  } catch {
    return enviar(piso, res, 503, {}, SERVICE_UNAVAILABLE_BODY);
  }
  if (alvo === null) return enviar(piso, res, 410, {}, LINK_INVALID_BODY);

  // Politica antes de trocar: senha fraca responde 422 e o link continua valido (33 §6.1, passo 3).
  const problema = professionalPasswordProblem(dados.new_password, alvo.email);
  if (problema !== null) {
    return enviar(piso, res, 422, {}, { code: 'campo_invalido', campo: 'password', motivo: problema });
  }

  let trocou: boolean;
  try {
    trocou = await opts.port.resetPassword(dados.token, dados.new_password as string, agora);
  } catch {
    return enviar(piso, res, 503, {}, SERVICE_UNAVAILABLE_BODY);
  }
  return trocou ? enviar(piso, res, 204, {}, undefined) : enviar(piso, res, 410, {}, LINK_INVALID_BODY);
}
