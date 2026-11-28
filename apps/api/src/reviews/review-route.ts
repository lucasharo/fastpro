// Pacote B (2026-11-23) | Rotas de avaliacao do servico, resposta do profissional e perfil publico de avaliacoes.
//   GET    /v1/requests/:id/review          dono: pedido, selecao e avaliacao (ou null) {status, selected, review}
//   POST   /v1/requests/:id/review          dono: cria a avaliacao {rating, comment?, acceptance_id?}
//   PATCH  /v1/requests/:id/review          dono: edita ate 7 dias depois da publicacao {rating, comment?}
//   POST   /v1/reviews/:id/reply            profissional avaliado: resposta unica {body}
//   GET    /v1/professional/reviews         profissional logado: avaliacoes recebidas {items, summary}
//   GET    /v1/public/professionals/:slug/reviews   sem sessao: {summary, items} (autor sempre "Cliente do FastPro")
// Ordem: rota e metodo -> Origin (so mutacoes) -> ids -> sessao (401) -> corpo (400) -> banco. Quem nao participa
// recebe o mesmo 404. Sem CORS; sem log de corpo, cookie ou id. A rota publica ignora o cookie e nunca envia Set-Cookie.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SESSION_COOKIE_NAME, checkDraftOrigin, cookieValue, siteOriginOf } from '@fastpro/domain';
import { hashSessionSecret, type PgReviewStore } from '@fastpro/db';
import {
  PUBLIC_PROFILE_CACHE_200,
  PUBLIC_PROFILE_ROBOTS_DIRECTIVE,
  type PublicProfileRateLimit,
} from '../public-profile-route.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;
const CORPO_MAX_BYTES = 8 * 1024;
const COMENTARIO_MAX = 1000;
const LIMITE_PUBLICO = 20;
export const AUTOR_PUBLICO = 'Cliente do FastPro' as const;
const CABECALHOS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Type': 'application/json; charset=utf-8',
} as const;
const NAO_ENCONTRADO = { code: 'nao_encontrado' } as const;

export interface ReviewRouteOptions {
  readonly siteUrl: string;
  readonly sessions: { authenticate(hash: string, nowMs: number): Promise<{ readonly userId: string } | null> };
  readonly store: Pick<
    PgReviewStore,
    'doPedido' | 'criar' | 'editar' | 'responder' | 'resumoPorSlug' | 'avaliacoesPorSlug' | 'doProfissional'
  >;
  readonly clock: { nowMs(): number };
  /** Limite por IP da rota publica (60 por minuto, como o perfil publico). */
  readonly limitePublico: PublicProfileRateLimit;
}

type Rota =
  | { readonly tipo: 'ver' | 'criar' | 'editar' | 'responder'; readonly id: string }
  | { readonly tipo: 'recebidas' }
  | { readonly tipo: 'publica'; readonly slug: string };

export function reviewRoute(metodo: string, path: string): Rota | null {
  let m = /^\/v1\/requests\/([^/]+)\/review$/.exec(path);
  if (m) {
    const id = m[1] ?? '';
    if (metodo === 'GET') return { tipo: 'ver', id };
    if (metodo === 'POST') return { tipo: 'criar', id };
    if (metodo === 'PATCH') return { tipo: 'editar', id };
    return null;
  }
  m = /^\/v1\/reviews\/([^/]+)\/reply$/.exec(path);
  if (m && metodo === 'POST') return { tipo: 'responder', id: m[1] ?? '' };
  if (path === '/v1/professional/reviews' && metodo === 'GET') return { tipo: 'recebidas' };
  m = /^\/v1\/public\/professionals\/([^/]+)\/reviews$/.exec(path);
  if (m && metodo === 'GET') return { tipo: 'publica', slug: m[1] ?? '' };
  return null;
}

export function isReviewRoute(metodo: string, path: string): boolean {
  return reviewRoute(metodo, path) !== null;
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

function enviar(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, CABECALHOS);
  res.end(JSON.stringify(body));
}

function lerCorpo(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const partes: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total <= CORPO_MAX_BYTES) partes.push(c);
    });
    req.on('end', () => {
      if (total > CORPO_MAX_BYTES) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(partes).toString('utf8')));
      } catch {
        resolve(undefined);
      }
    });
    req.on('error', () => resolve(undefined));
  });
}

function objeto(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Valida {rating, comment?}. Devolve null quando o corpo nao segue o contrato. */
function corpoAvaliacao(corpo: Record<string, unknown> | null): { nota: number; comentario: string | null } | null {
  if (corpo === null || Object.keys(corpo).some((k) => k !== 'rating' && k !== 'comment')) return null;
  const nota = corpo.rating;
  if (typeof nota !== 'number' || !Number.isInteger(nota)) return null;
  const comentario = corpo.comment;
  if (comentario !== undefined && comentario !== null && typeof comentario !== 'string') return null;
  return { nota, comentario: typeof comentario === 'string' ? comentario : null };
}

/** Codigos de regra devolvidos pelo banco e o status HTTP de cada um. */
const STATUS_DO_CODIGO: Readonly<Record<string, number>> = {
  nota_invalida: 422,
  comentario_invalido: 422,
  conteudo_nao_permitido: 422,
  texto_invalido: 422,
  pedido_nao_concluido: 409,
  sem_profissional: 409,
  ja_existe: 409,
  prazo_encerrado: 409,
  ja_respondida: 409,
};

function slugDecodificado(bruto: string): string | null {
  try {
    return decodeURIComponent(bruto);
  } catch {
    return null;
  }
}

async function responderPublica(req: IncomingMessage, res: ServerResponse, slugBruto: string, opts: ReviewRouteOptions): Promise<void> {
  const cabecalhosPublicos = {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': PUBLIC_PROFILE_ROBOTS_DIRECTIVE,
  };
  const taxa = opts.limitePublico.consumir(req.socket.remoteAddress ?? 'desconhecido', opts.clock.nowMs());
  if (!taxa.ok) {
    res.writeHead(429, { ...cabecalhosPublicos, 'Cache-Control': 'no-store', 'Retry-After': String(taxa.retryAfterS) });
    res.end(JSON.stringify({ code: 'muitas_requisicoes' }));
    return;
  }
  const slug = slugDecodificado(slugBruto);
  if (slug === null || !SLUG_RE.test(slug)) {
    res.writeHead(404, { ...cabecalhosPublicos, 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ code: 'professional_not_found' }));
    return;
  }
  try {
    const resumo = await opts.store.resumoPorSlug(slug);
    if (resumo === null) {
      res.writeHead(404, { ...cabecalhosPublicos, 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ code: 'professional_not_found' }));
      return;
    }
    const itens = await opts.store.avaliacoesPorSlug(slug, LIMITE_PUBLICO);
    res.writeHead(200, { ...cabecalhosPublicos, 'Cache-Control': PUBLIC_PROFILE_CACHE_200 });
    res.end(JSON.stringify({ summary: resumo, items: itens.map((i) => ({ ...i, author: AUTOR_PUBLICO })) }));
  } catch {
    if (!res.headersSent) {
      res.writeHead(500, { ...cabecalhosPublicos, 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ code: 'erro_interno' }));
    }
  }
}

export async function handleReviewRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  opts: ReviewRouteOptions,
): Promise<void> {
  try {
    const rota = reviewRoute(req.method ?? '', path);
    if (rota === null) return enviar(res, 404, NAO_ENCONTRADO);
    if (rota.tipo === 'publica') return await responderPublica(req, res, rota.slug, opts);

    const mutacao = rota.tipo === 'criar' || rota.tipo === 'editar' || rota.tipo === 'responder';
    if (mutacao) {
      const origem = checkDraftOrigin(
        { origin: cabecalho(req.headers.origin), secFetchSite: cabecalho(req.headers['sec-fetch-site']) },
        siteOriginOf(opts.siteUrl),
        true,
      );
      if (!origem.ok) return enviar(res, 403, { code: 'origem_invalida' });
    }
    if ('id' in rota && !UUID_RE.test(rota.id)) return enviar(res, 404, NAO_ENCONTRADO);

    const segredo = cookieValue(cabecalho(req.headers.cookie), SESSION_COOKIE_NAME);
    if (segredo === undefined) return enviar(res, 401, { code: 'sessao_necessaria' });
    const agora = opts.clock.nowMs();
    const sessao = await opts.sessions.authenticate(hashSessionSecret(segredo), agora);
    if (sessao === null) return enviar(res, 401, { code: 'sessao_necessaria' });

    switch (rota.tipo) {
      case 'ver': {
        const pedido = await opts.store.doPedido(rota.id, sessao.userId);
        return pedido === null ? enviar(res, 404, NAO_ENCONTRADO) : enviar(res, 200, pedido);
      }
      case 'criar':
      case 'editar': {
        const recebido = objeto(await lerCorpo(req));
        // So a criacao aceita acceptance_id (qual profissional que aceitou esta sendo avaliado).
        let aceite: string | undefined;
        let semAceite = recebido;
        if (rota.tipo === 'criar' && recebido !== null && 'acceptance_id' in recebido) {
          const { acceptance_id: valor, ...resto } = recebido;
          if (typeof valor !== 'string' || !UUID_RE.test(valor)) return enviar(res, 400, { code: 'corpo_invalido' });
          aceite = valor;
          semAceite = resto;
        }
        const entrada = corpoAvaliacao(semAceite);
        if (entrada === null) return enviar(res, 400, { code: 'corpo_invalido' });
        if (entrada.comentario !== null && entrada.comentario.trim().length > COMENTARIO_MAX) {
          return enviar(res, 422, { code: 'comentario_invalido' });
        }
        const r =
          rota.tipo === 'criar'
            ? await opts.store.criar(
                rota.id,
                sessao.userId,
                entrada.nota,
                entrada.comentario,
                new Date(agora),
                ...(aceite === undefined ? [] : ([aceite] as const)),
              )
            : await opts.store.editar(rota.id, sessao.userId, entrada.nota, entrada.comentario, new Date(agora));
        if (r.outcome === 'criada') return enviar(res, 201, { id: r.reviewId, publishedAt: r.publishedAt });
        if (r.outcome === 'atualizada') return enviar(res, 200, { id: r.reviewId, editedAt: r.editedAt });
        if (r.outcome === 'nao_encontrado') return enviar(res, 404, NAO_ENCONTRADO);
        return enviar(res, STATUS_DO_CODIGO[r.outcome] ?? 409, { code: r.outcome });
      }
      case 'responder': {
        const corpo = objeto(await lerCorpo(req));
        const texto = corpo?.body;
        if (corpo === null || Object.keys(corpo).length !== 1 || typeof texto !== 'string') {
          return enviar(res, 400, { code: 'corpo_invalido' });
        }
        const r = await opts.store.responder(rota.id, sessao.userId, texto, new Date(agora));
        if (r.outcome === 'respondida') return enviar(res, 201, { repliedAt: r.repliedAt });
        if (r.outcome === 'nao_encontrada') return enviar(res, 404, NAO_ENCONTRADO);
        return enviar(res, STATUS_DO_CODIGO[r.outcome] ?? 409, { code: r.outcome });
      }
      case 'recebidas': {
        const itens = await opts.store.doProfissional(sessao.userId);
        const notas = itens.map((i) => i.rating);
        const media = notas.length === 0 ? null : Math.round((notas.reduce((a, b) => a + b, 0) / notas.length) * 10) / 10;
        return enviar(res, 200, { items: itens, summary: { average: media, count: notas.length } });
      }
    }
  } catch {
    if (!res.headersSent) enviar(res, 503, { code: 'indisponivel' });
  }
}
