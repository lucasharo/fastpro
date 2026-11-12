// H-016 | Troca de senha do profissional logado (docs/factory/33-DESENHO-H016.md §6.2 e §9; CA-H016-20).
// POST /v1/professional/password/change {new_password}: 204 na troca; 401 sem sessao valida ou com prova
// recente vencida (step_up_required); 403 com e-mail nao verificado (sessao restrita nao troca senha);
// 422 para senha fraca. Nenhuma resposta ou log traz senha, token ou e-mail.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  cookieValue,
  professionalPasswordProblem,
  SERVICE_UNAVAILABLE_BODY,
  SESSION_COOKIE_NAME,
  STEP_UP_WINDOW_SECONDS,
  UNAUTHENTICATED_BODY,
} from '@fastpro/domain';
import { enviar, iniciarPiso, lerJson } from './professional-route.js';

export const PROFESSIONAL_PASSWORD_CHANGE_PATH = '/v1/professional/password/change';

/** Sessao do profissional lida do banco para este pedido. */
export interface ProfessionalSessionAccount {
  readonly sessionId: string;
  readonly userId: string;
  readonly authUserId: string;
  readonly email: string;
  readonly emailVerified: boolean;
  /** Ultima prova recente de identidade da sessao (login por senha ou step-up), em ms. Nulo = nunca. */
  readonly recentAuthAtMs: number | null;
}

export interface ProfessionalPasswordPort {
  /** Sessao viva com perfil profissional, ou nulo. */
  sessionAccount(secret: string, nowMs: number): Promise<ProfessionalSessionAccount | null>;
  /** Troca a senha no Auth, revoga as outras sessoes (mantem a atual) e envia o aviso. */
  changePassword(account: ProfessionalSessionAccount, newPassword: string, nowMs: number): Promise<void>;
}

export interface ProfessionalPasswordRouteOptions {
  readonly port: ProfessionalPasswordPort;
  readonly clock: { nowMs(): number };
  readonly responseFloorMs?: number;
}

export async function handleProfessionalPasswordChange(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProfessionalPasswordRouteOptions,
): Promise<void> {
  const piso = iniciarPiso(opts);
  const corpo = await lerJson(req);
  if (!corpo.ok) return enviar(piso, res, corpo.status, {}, undefined);
  const dados = (corpo.value ?? {}) as { new_password?: unknown };
  const agora = opts.clock.nowMs();

  const secret = cookieValue(req.headers.cookie, SESSION_COOKIE_NAME);
  if (secret === undefined || secret === '') return enviar(piso, res, 401, {}, UNAUTHENTICATED_BODY);

  let conta: ProfessionalSessionAccount | null;
  try {
    conta = await opts.port.sessionAccount(secret, agora);
  } catch {
    return enviar(piso, res, 503, {}, SERVICE_UNAVAILABLE_BODY);
  }
  if (conta === null) return enviar(piso, res, 401, {}, UNAUTHENTICATED_BODY);

  // Sessao restrita (e-mail nao verificado) nao troca senha, mesmo com prova recente (33 §5.2).
  if (!conta.emailVerified) return enviar(piso, res, 403, {}, { code: 'email_not_verified' });

  // Janela de 30 min desde a ultima prova: vencida, pede nova confirmacao antes da troca (CA-H016-20).
  const provaRecente =
    conta.recentAuthAtMs !== null && agora - conta.recentAuthAtMs <= STEP_UP_WINDOW_SECONDS * 1000;
  if (!provaRecente) {
    return enviar(piso, res, 401, {}, { code: 'step_up_required' });
  }

  const problema = professionalPasswordProblem(dados.new_password, conta.email);
  if (problema !== null) {
    return enviar(piso, res, 422, {}, { code: 'campo_invalido', campo: 'password', motivo: problema });
  }

  try {
    await opts.port.changePassword(conta, dados.new_password as string, agora);
  } catch {
    return enviar(piso, res, 503, {}, SERVICE_UNAVAILABLE_BODY);
  }
  return enviar(piso, res, 204, {}, undefined);
}
