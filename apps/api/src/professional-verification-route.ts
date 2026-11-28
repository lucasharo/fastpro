// Issue 54 (H-041) | Estado visivel e recurso do profissional (docs/factory/141-DESENHO-H041.md §5).
//   GET  /v1/professional/verificacao          200 {estado, motivo?, explicacao?, decididoEm?, recurso:{situacao}};
//                                              401 sem sessao; 404 nao_encontrado (sem perfil); 500 erro_interno; 503.
//   POST /v1/professional/verificacao/recurso  200 {recurso:'recebido'}; 403 origem_invalida; 401; 404 nao_encontrado;
//                                              409 recurso_indisponivel (sem caso, nao elegivel ou ja usado); 503.
// Profissional vem so da sessao (nunca do corpo ou da URL); o corpo do POST e ignorado. Respostas no-store.
// Nada disso entra em log. Sem console: a sessao de administrador usa outro cookie e nao chega aqui.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { hashSessionSecret } from '@fastpro/db';
import {
  CODIGO_RECURSO_INDISPONIVEL,
  SESSION_COOKIE_NAME,
  cookieValue,
  montarEstadoVisivel,
  siteOriginOf,
  type ProfessionalVerificationPort,
  type SessionRecord,
  type SessionRepositoryPort,
} from '@fastpro/domain';

export const PROFESSIONAL_VERIFICATION_PATH = '/v1/professional/verificacao';
export const PROFESSIONAL_VERIFICATION_APPEAL_PATH = '/v1/professional/verificacao/recurso';
const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } as const;

export interface ProfessionalVerificationRouteOptions {
  readonly sessions: SessionRepositoryPort;
  readonly verification: ProfessionalVerificationPort;
  /** SITE_URL: a origem dela e a unica aceita em Origin no POST. */
  readonly siteUrl: string;
  readonly clock: { nowMs(): number };
}

function enviar(res: ServerResponse, status: number, body?: unknown): void {
  const texto = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    ...NO_STORE,
    ...(texto === '' ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
  });
  res.end(texto);
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

/** Origin e Sec-Fetch-Site, com a mesma regra das rotas de profissional. */
function origemValida(req: IncomingMessage, siteOrigin: string): boolean {
  const origin = cabecalho(req.headers.origin);
  const fetchSite = cabecalho(req.headers['sec-fetch-site']);
  if (origin !== siteOrigin) return false;
  return fetchSite === undefined || fetchSite === 'same-origin';
}

/** So o cookie da sessao do profissional e conferido no banco a cada pedido. */
async function sessaoDoPedido(
  req: IncomingMessage,
  opts: ProfessionalVerificationRouteOptions,
): Promise<SessionRecord | null> {
  const segredo = cookieValue(cabecalho(req.headers.cookie), SESSION_COOKIE_NAME);
  if (segredo === undefined) return null;
  return opts.sessions.authenticate(hashSessionSecret(segredo), opts.clock.nowMs());
}

/** GET: estado visivel do proprio profissional. */
export async function handleProfessionalVerificationGet(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProfessionalVerificationRouteOptions,
): Promise<void> {
  let sessao: SessionRecord | null;
  try {
    sessao = await sessaoDoPedido(req, opts);
  } catch {
    return enviar(res, 503, { code: 'servico_indisponivel' });
  }
  if (sessao === null) return enviar(res, 401, { code: 'nao_autenticado' });

  let linha;
  try {
    linha = await opts.verification.lerEstado(sessao.userId);
  } catch {
    return enviar(res, 503, { code: 'servico_indisponivel' });
  }
  if (linha === null) return enviar(res, 404, { code: 'nao_encontrado' });

  const estado = montarEstadoVisivel(linha);
  if (estado === null) return enviar(res, 500, { code: 'erro_interno' });
  return enviar(res, 200, estado);
}

/** POST: pedido de revisao. Corpo ignorado; so recusada sem recurso anterior recebe 200. */
export async function handleProfessionalVerificationAppeal(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProfessionalVerificationRouteOptions,
): Promise<void> {
  req.resume();
  if (!origemValida(req, siteOriginOf(opts.siteUrl))) return enviar(res, 403, { code: 'origem_invalida' });

  let sessao: SessionRecord | null;
  try {
    sessao = await sessaoDoPedido(req, opts);
  } catch {
    return enviar(res, 503, { code: 'servico_indisponivel' });
  }
  if (sessao === null) return enviar(res, 401, { code: 'nao_autenticado' });

  try {
    if ((await opts.verification.lerEstado(sessao.userId)) === null) {
      return enviar(res, 404, { code: 'nao_encontrado' });
    }
    const resultado = await opts.verification.pedirRecurso(sessao.userId, new Date(opts.clock.nowMs()));
    if (resultado !== 'ok') return enviar(res, 409, { code: CODIGO_RECURSO_INDISPONIVEL });
  } catch {
    return enviar(res, 503, { code: 'servico_indisponivel' });
  }
  return enviar(res, 200, { recurso: 'recebido' });
}
