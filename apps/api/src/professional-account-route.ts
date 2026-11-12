// H-016 | GET /v1/professional/me (docs/factory/33-DESENHO-H016.md §5.2, §8; CA-H016-10, CA-H016-21).
// Sessao por cookie (__Host-fp_sess); o estado vem do banco a cada requisicao, nunca do token. Sem sessao
// valida, ou sem perfil profissional, responde 401 (sem dizer qual). Sem e-mail, senha ou token na resposta.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  cookieValue,
  professionalMeBody,
  SESSION_COOKIE_NAME,
  UNAUTHENTICATED_BODY,
  type ProfessionalVerificationStatus,
} from '@fastpro/domain';

export const PROFESSIONAL_ME_PATH = '/v1/professional/me';

/** Estado do profissional lido do banco para a sessao informada (nulo quando a sessao nao serve). */
export interface ProfessionalMeSnapshot {
  readonly emailVerified: boolean;
  readonly status: ProfessionalVerificationStatus;
}

export interface ProfessionalAccountPort {
  me(secret: string, nowMs: number): Promise<ProfessionalMeSnapshot | null>;
}

export interface ProfessionalAccountRouteOptions {
  readonly port: ProfessionalAccountPort;
  readonly clock: { nowMs(): number };
}

const HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Type': 'application/json; charset=utf-8',
} as const;

export async function handleProfessionalMe(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProfessionalAccountRouteOptions,
): Promise<void> {
  const secret = cookieValue(req.headers.cookie, SESSION_COOKIE_NAME);
  if (secret === undefined || secret === '') {
    res.writeHead(401, HEADERS);
    res.end(JSON.stringify(UNAUTHENTICATED_BODY));
    return;
  }
  let estado: ProfessionalMeSnapshot | null;
  try {
    estado = await opts.port.me(secret, opts.clock.nowMs());
  } catch {
    res.writeHead(503, HEADERS);
    res.end(JSON.stringify({ code: 'service_unavailable' }));
    return;
  }
  if (estado === null) {
    res.writeHead(401, HEADERS);
    res.end(JSON.stringify(UNAUTHENTICATED_BODY));
    return;
  }
  res.writeHead(200, HEADERS);
  res.end(JSON.stringify(professionalMeBody(estado)));
}
