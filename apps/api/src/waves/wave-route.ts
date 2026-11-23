// Pacote C (H-060, H-082, H-083) | Rotas da segunda onda e da republicacao do pedido do dono.
//   GET  /v1/requests/:id/actions              dono: { canCallMore, canRepublish }
//   POST /v1/requests/:id/more-professionals   dono: abre a segunda onda (uma vez)  -> { status }
//   POST /v1/requests/:id/republish            dono: cria um rascunho novo do pedido -> 201 { status: 'rascunho_criado' }
// Ordem: rota e metodo -> Origin (so mutacoes) -> id -> sessao (401) -> banco. Quem nao e dono recebe o mesmo 404.
// Sem CORS; sem log de corpo, cookie, endereco ou id. O endereco decifrado so existe em memoria, para o rascunho.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  DRAFT_LIVE_CAP_DEFAULT,
  DRAFT_TTL_DAYS,
  SESSION_COOKIE_NAME,
  checkDraftOrigin,
  cookieValue,
  draftCookieHeader,
  normalizeClientIp,
  siteOriginOf,
} from '@fastpro/domain';
import { hashSessionSecret, type PgRequestWaveStore } from '@fastpro/db';
import type { DraftHasher } from '../drafts/draft-hash.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CABECALHOS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Type': 'application/json; charset=utf-8',
} as const;
const NAO_ENCONTRADO = { code: 'nao_encontrado' } as const;

/** Endereco em texto do pedido do dono, decifrado (cofre do pedido). Null = pedido inexistente ou de outro dono. */
export interface OrigemRepublicacao {
  enderecoDoDono(userId: string, requestId: string): Promise<string | null>;
}

export interface WaveRouteOptions {
  readonly siteUrl: string;
  readonly sessions: { authenticate(hash: string, nowMs: number): Promise<{ readonly userId: string } | null> };
  readonly store: Pick<PgRequestWaveStore, 'acoes' | 'abrirOnda2' | 'republicar'>;
  readonly origem: OrigemRepublicacao;
  /** Hash do segredo do cookie do rascunho e gerador do segredo novo (mesmas regras do rascunho). */
  readonly rascunho: { readonly hasher: Pick<DraftHasher, 'secretHash' | 'ipHmac'>; readonly novoSegredo: () => string };
  readonly clock: { nowMs(): number };
}

type Rota =
  | { readonly tipo: 'acoes'; readonly id: string }
  | { readonly tipo: 'onda'; readonly id: string }
  | { readonly tipo: 'republicar'; readonly id: string };

export function waveRoute(metodo: string, path: string): Rota | null {
  let m = /^\/v1\/requests\/([^/]+)\/actions$/.exec(path);
  if (m && metodo === 'GET') return { tipo: 'acoes', id: m[1] ?? '' };
  m = /^\/v1\/requests\/([^/]+)\/more-professionals$/.exec(path);
  if (m && metodo === 'POST') return { tipo: 'onda', id: m[1] ?? '' };
  m = /^\/v1\/requests\/([^/]+)\/republish$/.exec(path);
  if (m && metodo === 'POST') return { tipo: 'republicar', id: m[1] ?? '' };
  return null;
}

export function isWaveRoute(metodo: string, path: string): boolean {
  return waveRoute(metodo, path) !== null;
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

function enviar(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...CABECALHOS, ...extra });
  res.end(JSON.stringify(body));
}

export async function handleWaveRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  opts: WaveRouteOptions,
): Promise<void> {
  try {
    const rota = waveRoute(req.method ?? '', path);
    if (rota === null) return enviar(res, 404, NAO_ENCONTRADO);
    if (rota.tipo !== 'acoes') {
      const origem = checkDraftOrigin(
        { origin: cabecalho(req.headers.origin), secFetchSite: cabecalho(req.headers['sec-fetch-site']) },
        siteOriginOf(opts.siteUrl),
        true,
      );
      if (!origem.ok) return enviar(res, 403, { code: 'origem_invalida' });
    }
    if (!UUID_RE.test(rota.id)) return enviar(res, 404, NAO_ENCONTRADO);

    const segredo = cookieValue(cabecalho(req.headers.cookie), SESSION_COOKIE_NAME);
    if (segredo === undefined) return enviar(res, 401, { code: 'sessao_necessaria' });
    const agora = opts.clock.nowMs();
    const sessao = await opts.sessions.authenticate(hashSessionSecret(segredo), agora);
    if (sessao === null) return enviar(res, 401, { code: 'sessao_necessaria' });

    switch (rota.tipo) {
      case 'acoes': {
        const acoes = await opts.store.acoes(rota.id, sessao.userId, new Date(agora));
        if (acoes === null) return enviar(res, 404, NAO_ENCONTRADO);
        return enviar(res, 200, { canCallMore: acoes.canCallMore, canRepublish: acoes.canRepublish });
      }
      case 'onda': {
        const r = await opts.store.abrirOnda2(rota.id, sessao.userId, new Date(agora));
        if (r.outcome === 'aberta' || r.outcome === 'sem_mudanca') return enviar(res, 200, { status: r.outcome });
        if (r.outcome === 'nao_encontrado') return enviar(res, 404, NAO_ENCONTRADO);
        return enviar(res, 409, { code: r.outcome });
      }
      case 'republicar': {
        const endereco = await opts.origem.enderecoDoDono(sessao.userId, rota.id);
        if (endereco === null) return enviar(res, 404, NAO_ENCONTRADO);
        const novo = opts.rascunho.novoSegredo();
        const ip = normalizeClientIp(req.socket.remoteAddress).value;
        const r = await opts.store.republicar({
          originId: rota.id,
          customerId: sessao.userId,
          secretHash: opts.rascunho.hasher.secretHash(novo),
          ipHmac: opts.rascunho.hasher.ipHmac(ip),
          agora: new Date(agora),
          ttlDays: DRAFT_TTL_DAYS,
          liveCap: DRAFT_LIVE_CAP_DEFAULT,
          addressText: endereco,
        });
        if (r.outcome === 'rascunho_criado') {
          return enviar(res, 201, { status: 'rascunho_criado' }, { 'Set-Cookie': draftCookieHeader(novo) });
        }
        if (r.outcome === 'ja_existe') return enviar(res, 200, { status: 'ja_existe' });
        if (r.outcome === 'nao_encontrado') return enviar(res, 404, NAO_ENCONTRADO);
        if (r.outcome === 'teto_global') return enviar(res, 503, { code: 'indisponivel' }, { 'Retry-After': '60' });
        return enviar(res, 409, { code: r.outcome });
      }
    }
  } catch {
    if (!res.headersSent) enviar(res, 503, { code: 'indisponivel' });
  }
}
