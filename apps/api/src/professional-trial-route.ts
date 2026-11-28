// Issue 57 (H-044) | Rota de ativacao do trial de 14 dias (docs/factory/135-DESENHO-H044.md, §5.1 e §5.4).
//   POST /v1/billing/trial/activate  201 {starts_at, ends_at} | 403 {error:"not_verified"} |
//                                    409 {error:"trial_used"} | 409 {error:"paid_access_active"} |
//                                    401 | 400 {error:"invalid_body"} | 405 (Allow: POST) | 503.
// O professional_id vem SEMPRE da sessao; corpo vazio ou {} e o unico aceito. Sem Idempotency-Key.
// Negacoes de negocio sao codigos; falha tecnica vira 503 generico, sem mensagem de banco.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { hashSessionSecret } from '@fastpro/db';
import {
  SESSION_COOKIE_NAME,
  ativarTrial,
  cookieValue,
  type Clock,
  type SessionRecord,
  type SessionRepositoryPort,
  type TrialActivationPort,
} from '@fastpro/domain';

export const TRIAL_ACTIVATE_PATH = '/v1/billing/trial/activate';

/** Corpo maximo aceito pela rota (igual ao do cadastro do perfil). */
const CORPO_LIMITE = 4096;
const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } as const;

export interface ProfessionalTrialRouteOptions {
  readonly sessions: SessionRepositoryPort;
  readonly trial: TrialActivationPort;
  readonly clock: Clock;
}

async function enviar(res: ServerResponse, status: number, body: unknown): Promise<void> {
  res.writeHead(status, { ...NO_STORE, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function sessaoDoPedido(req: IncomingMessage, opts: ProfessionalTrialRouteOptions): Promise<SessionRecord | null> {
  const cabecalho = typeof req.headers.cookie === 'string' ? req.headers.cookie : undefined;
  const segredo = cookieValue(cabecalho, SESSION_COOKIE_NAME);
  if (segredo === undefined) return null;
  return opts.sessions.authenticate(hashSessionSecret(segredo), opts.clock.now().getTime());
}

/** Le o corpo e devolve true apenas se estiver vazio ou for um objeto JSON sem chaves. */
function lerCorpoVazio(req: IncomingMessage): Promise<boolean> {
  return new Promise((resolve) => {
    const partes: Buffer[] = [];
    let total = 0;
    let excedeu = false;
    req.on('data', (parte: Buffer) => {
      total += parte.length;
      if (total > CORPO_LIMITE) {
        excedeu = true;
        return;
      }
      partes.push(parte);
    });
    req.on('end', () => {
      if (excedeu) return resolve(false);
      const texto = Buffer.concat(partes).toString('utf8').trim();
      if (texto === '') return resolve(true);
      try {
        const valor: unknown = JSON.parse(texto);
        resolve(typeof valor === 'object' && valor !== null && !Array.isArray(valor) && Object.keys(valor).length === 0);
      } catch {
        resolve(false);
      }
    });
    req.on('error', () => resolve(false));
  });
}

export async function handleProfessionalTrialRoute(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProfessionalTrialRouteOptions,
): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405, { ...NO_STORE, Allow: 'POST' });
    res.end();
    return;
  }
  let sessao: SessionRecord | null;
  try {
    sessao = await sessaoDoPedido(req, opts);
  } catch {
    return enviar(res, 503, { error: 'servico_indisponivel' });
  }
  if (sessao === null) return enviar(res, 401, { error: 'nao_autenticado' });

  const corpoOk = await lerCorpoVazio(req);
  if (!corpoOk) return enviar(res, 400, { error: 'invalid_body' });

  try {
    const r = await ativarTrial(opts.trial, opts.clock, sessao.userId);
    if (r.code === 'ok') {
      return enviar(res, 201, { starts_at: r.startsAt.toISOString(), ends_at: r.endsAt.toISOString() });
    }
    if (r.code === 'not_verified') return enviar(res, 403, { error: 'not_verified' });
    if (r.code === 'trial_used') return enviar(res, 409, { error: 'trial_used' });
    return enviar(res, 409, { error: 'paid_access_active' });
  } catch {
    return enviar(res, 503, { error: 'servico_indisponivel' });
  }
}
