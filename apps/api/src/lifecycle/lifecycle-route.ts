// Pacote A (H-061, H-077, H-078, H-080) | Rotas de ciclo do pedido e do aceite. Todas sao mutacoes (Origin obrigatorio).
//   POST /v1/requests/:id/complete      dono: marca como concluido (so com selecionado)
//   POST /v1/requests/:id/uncomplete    dono: desfaz a conclusao (ate 24 h)
//   POST /v1/requests/:id/cancel        dono: cancela o pedido (publicado ou selecionado)
//   POST /v1/acceptances/:id/withdraw   profissional: retira o proprio aceite (corpo {}); se era o selecionado, desiste
// Ordem: rota e metodo -> Origin (403) -> ids (404) -> sessao (401) -> corpo (400) -> banco. Quem nao e dono ou
// nao e o profissional do aceite recebe o mesmo 404. Sem CORS; sem log de corpo, cookie ou id.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SESSION_COOKIE_NAME, checkDraftOrigin, cookieValue, siteOriginOf } from '@fastpro/domain';
import { hashSessionSecret, type PgRequestLifecycleStore } from '@fastpro/db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CORPO_MAX_BYTES = 1024;
const CABECALHOS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Type': 'application/json; charset=utf-8',
} as const;
const NAO_ENCONTRADO = { code: 'nao_encontrado' } as const;

export interface LifecycleRouteOptions {
  readonly siteUrl: string;
  readonly sessions: { authenticate(hash: string, nowMs: number): Promise<{ readonly userId: string } | null> };
  readonly store: Pick<PgRequestLifecycleStore, 'concluir' | 'desfazerConclusao' | 'cancelar' | 'retirarAceite'>;
  readonly clock: { nowMs(): number };
}

type Rota =
  | { readonly tipo: 'concluir' | 'desfazer' | 'cancelar'; readonly id: string }
  | { readonly tipo: 'retirar'; readonly id: string };

export function lifecycleRoute(metodo: string, path: string): Rota | null {
  if (metodo !== 'POST') return null;
  let m = /^\/v1\/requests\/([^/]+)\/complete$/.exec(path);
  if (m) return { tipo: 'concluir', id: m[1] ?? '' };
  m = /^\/v1\/requests\/([^/]+)\/uncomplete$/.exec(path);
  if (m) return { tipo: 'desfazer', id: m[1] ?? '' };
  m = /^\/v1\/requests\/([^/]+)\/cancel$/.exec(path);
  if (m) return { tipo: 'cancelar', id: m[1] ?? '' };
  m = /^\/v1\/acceptances\/([^/]+)\/withdraw$/.exec(path);
  if (m) return { tipo: 'retirar', id: m[1] ?? '' };
  return null;
}

export function isLifecycleRoute(metodo: string, path: string): boolean {
  return lifecycleRoute(metodo, path) !== null;
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

function enviar(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, CABECALHOS);
  res.end(JSON.stringify(body));
}

/** Corpo vazio ou {} sem chaves. Qualquer outro conteudo (chave extra, JSON invalido, corpo grande) e recusado. */
function corpoVazio(req: IncomingMessage): Promise<boolean> {
  return new Promise((resolve) => {
    const partes: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total <= CORPO_MAX_BYTES) partes.push(c);
    });
    req.on('end', () => {
      if (total > CORPO_MAX_BYTES) return resolve(false);
      const texto = Buffer.concat(partes).toString('utf8').trim();
      if (texto === '') return resolve(true);
      try {
        const v: unknown = JSON.parse(texto);
        resolve(v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
      } catch {
        resolve(false);
      }
    });
    req.on('error', () => resolve(false));
  });
}

export async function handleLifecycleRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  opts: LifecycleRouteOptions,
): Promise<void> {
  try {
    const rota = lifecycleRoute(req.method ?? '', path);
    if (rota === null) return enviar(res, 404, NAO_ENCONTRADO);
    const origem = checkDraftOrigin(
      { origin: cabecalho(req.headers.origin), secFetchSite: cabecalho(req.headers['sec-fetch-site']) },
      siteOriginOf(opts.siteUrl),
      true,
    );
    if (!origem.ok) return enviar(res, 403, { code: 'origem_invalida' });
    if (!UUID_RE.test(rota.id)) return enviar(res, 404, NAO_ENCONTRADO);

    const segredo = cookieValue(cabecalho(req.headers.cookie), SESSION_COOKIE_NAME);
    if (segredo === undefined) return enviar(res, 401, { code: 'sessao_necessaria' });
    const agora = opts.clock.nowMs();
    const sessao = await opts.sessions.authenticate(hashSessionSecret(segredo), agora);
    if (sessao === null) return enviar(res, 401, { code: 'sessao_necessaria' });

    if (rota.tipo === 'retirar') {
      if (!(await corpoVazio(req))) return enviar(res, 400, { code: 'corpo_invalido' });
      const r = await opts.store.retirarAceite(rota.id, sessao.userId, new Date(agora));
      if (r.outcome === 'nao_encontrado') return enviar(res, 404, NAO_ENCONTRADO);
      if (r.outcome === 'estado_invalido') return enviar(res, 409, { code: 'estado_invalido' });
      return enviar(res, 200, {
        status: r.outcome,
        acceptanceId: r.acceptanceId,
        requestId: r.requestId,
        withdrawnAt: r.withdrawnAt,
      });
    }

    if (!(await corpoVazio(req))) return enviar(res, 400, { code: 'corpo_invalido' });
    const quando = new Date(agora);
    const r =
      rota.tipo === 'concluir'
        ? await opts.store.concluir(rota.id, sessao.userId, quando)
        : rota.tipo === 'desfazer'
          ? await opts.store.desfazerConclusao(rota.id, sessao.userId, quando)
          : await opts.store.cancelar(rota.id, sessao.userId, quando);

    if (r.outcome === 'nao_encontrado') return enviar(res, 404, NAO_ENCONTRADO);
    if (r.outcome === 'estado_invalido' || r.outcome === 'prazo_encerrado') return enviar(res, 409, { code: r.outcome });
    const pedidoStatus = r.status;
    if (rota.tipo === 'cancelar') {
      return enviar(res, 200, { status: r.outcome, pedidoStatus, cancelledAt: r.cancelledAt });
    }
    return enviar(res, 200, { status: r.outcome, pedidoStatus, completedAt: r.completedAt });
  } catch {
    if (!res.headersSent) enviar(res, 503, { code: 'indisponivel' });
  }
}
