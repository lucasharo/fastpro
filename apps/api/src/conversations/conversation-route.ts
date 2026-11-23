// Ciclo central (2026-11-23) | Rotas de interessados, conversas, mensagens, selecao e o chat do Pacote E.
//   GET  /v1/requests/:id/acceptances          dono: quem aceitou, com a conversa de cada um e quem foi escolhido
//   POST /v1/requests/:id/selection            dono: escolhe (ou troca) o profissional  {acceptance_id}
//   GET  /v1/conversations                     cliente ou profissional: conversas da sessao (com nao lidas, arquivo, bloqueio)
//   GET  /v1/conversations/unread              total de nao lidas da caixa do usuario  -> {total}
//   GET  /v1/conversations/:id                 membro: mensagens da conversa (marca como lida)
//   POST /v1/conversations/:id/messages        membro: envia texto  {client_message_id, body}
//   POST /v1/conversations/:id/archive         membro: arquiva ou desarquiva (preferencia individual)  {archived}
//   POST /v1/conversations/:id/report          membro: denuncia  {reason, text?}
//   POST /v1/conversations/:id/block           membro: bloqueia a conversa para os dois lados
// Ordem: rota e metodo -> Origin (so mutacoes) -> ids -> sessao (401) -> corpo (400) -> banco. Quem nao participa
// recebe o mesmo 404. Sem CORS; sem log de corpo, cookie ou id. Sem anexos (so texto, H-067).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SESSION_COOKIE_NAME, checkDraftOrigin, cookieValue, siteOriginOf } from '@fastpro/domain';
import { hashSessionSecret, MOTIVOS_DENUNCIA, type PgConversationStore } from '@fastpro/db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CORPO_MAX_BYTES = 8 * 1024;
const TEXTO_DENUNCIA_MAX = 500;
const CABECALHOS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Type': 'application/json; charset=utf-8',
} as const;
const NAO_ENCONTRADO = { code: 'nao_encontrado' } as const;

export interface ConversationRouteOptions {
  readonly siteUrl: string;
  readonly sessions: { authenticate(hash: string, nowMs: number): Promise<{ readonly userId: string } | null> };
  readonly store: Pick<
    PgConversationStore,
    | 'interessados'
    | 'conversas'
    | 'conversa'
    | 'enviar'
    | 'selecionar'
    | 'naoLidas'
    | 'marcarLida'
    | 'arquivar'
    | 'denunciar'
    | 'bloquear'
  >;
  readonly clock: { nowMs(): number };
}

type Rota =
  | { readonly tipo: 'interessados' | 'selecao'; readonly id: string }
  | { readonly tipo: 'lista' | 'nao_lidas' }
  | { readonly tipo: 'conversa' | 'envio' | 'arquivo' | 'denuncia' | 'bloqueio'; readonly id: string };

export function conversationRoute(metodo: string, path: string): Rota | null {
  let m = /^\/v1\/requests\/([^/]+)\/acceptances$/.exec(path);
  if (m && metodo === 'GET') return { tipo: 'interessados', id: m[1] ?? '' };
  m = /^\/v1\/requests\/([^/]+)\/selection$/.exec(path);
  if (m && metodo === 'POST') return { tipo: 'selecao', id: m[1] ?? '' };
  if (path === '/v1/conversations' && metodo === 'GET') return { tipo: 'lista' };
  if (path === '/v1/conversations/unread' && metodo === 'GET') return { tipo: 'nao_lidas' };
  m = /^\/v1\/conversations\/([^/]+)$/.exec(path);
  if (m && metodo === 'GET') return { tipo: 'conversa', id: m[1] ?? '' };
  m = /^\/v1\/conversations\/([^/]+)\/messages$/.exec(path);
  if (m && metodo === 'POST') return { tipo: 'envio', id: m[1] ?? '' };
  m = /^\/v1\/conversations\/([^/]+)\/archive$/.exec(path);
  if (m && metodo === 'POST') return { tipo: 'arquivo', id: m[1] ?? '' };
  m = /^\/v1\/conversations\/([^/]+)\/report$/.exec(path);
  if (m && metodo === 'POST') return { tipo: 'denuncia', id: m[1] ?? '' };
  m = /^\/v1\/conversations\/([^/]+)\/block$/.exec(path);
  if (m && metodo === 'POST') return { tipo: 'bloqueio', id: m[1] ?? '' };
  return null;
}

export function isConversationRoute(metodo: string, path: string): boolean {
  return conversationRoute(metodo, path) !== null;
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

function somenteChaves(corpo: Record<string, unknown>, permitidas: readonly string[]): boolean {
  return Object.keys(corpo).every((k) => permitidas.includes(k));
}

export async function handleConversationRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  opts: ConversationRouteOptions,
): Promise<void> {
  try {
    const rota = conversationRoute(req.method ?? '', path);
    if (rota === null) return enviar(res, 404, NAO_ENCONTRADO);
    const mutacao = rota.tipo !== 'interessados' && rota.tipo !== 'lista' && rota.tipo !== 'nao_lidas' && rota.tipo !== 'conversa';
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
      case 'interessados': {
        const itens = await opts.store.interessados(rota.id, sessao.userId);
        return enviar(res, 200, { items: itens });
      }
      case 'lista': {
        const itens = await opts.store.conversas(sessao.userId);
        return enviar(res, 200, { items: itens });
      }
      case 'nao_lidas': {
        const total = await opts.store.naoLidas(sessao.userId);
        return enviar(res, 200, { total });
      }
      case 'conversa': {
        const conversa = await opts.store.conversa(rota.id, sessao.userId);
        if (conversa === null) return enviar(res, 404, NAO_ENCONTRADO);
        // Abrir a conversa marca como lida. Falhar aqui nao impede a leitura das mensagens.
        await opts.store.marcarLida(rota.id, sessao.userId, new Date(agora)).catch(() => false);
        return enviar(res, 200, conversa);
      }
      case 'envio': {
        const corpo = objeto(await lerCorpo(req));
        const chave = corpo?.client_message_id;
        const texto = corpo?.body;
        if (corpo === null || Object.keys(corpo).some((k) => k !== 'client_message_id' && k !== 'body')) {
          return enviar(res, 400, { code: 'corpo_invalido' });
        }
        if (typeof chave !== 'string' || !UUID_RE.test(chave) || typeof texto !== 'string') {
          return enviar(res, 400, { code: 'corpo_invalido' });
        }
        const r = await opts.store.enviar(rota.id, sessao.userId, chave, texto, new Date(agora));
        if (r.outcome === 'enviada' || r.outcome === 'repetida') {
          return enviar(res, r.outcome === 'enviada' ? 201 : 200, { id: r.messageId, createdAt: r.createdAt });
        }
        if (r.outcome === 'somente_leitura') return enviar(res, 409, { code: 'conversa_somente_leitura' });
        if (r.outcome === 'conversa_bloqueada') return enviar(res, 409, { code: 'conversa_bloqueada' });
        if (r.outcome === 'texto_invalido') return enviar(res, 422, { code: 'texto_invalido' });
        if (r.outcome === 'conteudo_nao_permitido') return enviar(res, 422, { code: 'conteudo_nao_permitido' });
        return enviar(res, 404, NAO_ENCONTRADO);
      }
      case 'arquivo': {
        const corpo = objeto(await lerCorpo(req));
        if (corpo === null || !somenteChaves(corpo, ['archived']) || typeof corpo.archived !== 'boolean') {
          return enviar(res, 400, { code: 'corpo_invalido' });
        }
        const r = await opts.store.arquivar(rota.id, sessao.userId, corpo.archived, new Date(agora));
        if (r === 'nao_encontrada') return enviar(res, 404, NAO_ENCONTRADO);
        return enviar(res, 200, { status: r, archived: r === 'arquivada' || (r === 'sem_mudanca' && corpo.archived) });
      }
      case 'denuncia': {
        const corpo = objeto(await lerCorpo(req));
        if (corpo === null || !somenteChaves(corpo, ['reason', 'text'])) return enviar(res, 400, { code: 'corpo_invalido' });
        const motivo = corpo.reason;
        const textoLivre = corpo.text;
        if (typeof motivo !== 'string' || !(MOTIVOS_DENUNCIA as readonly string[]).includes(motivo)) {
          return enviar(res, 400, { code: 'corpo_invalido' });
        }
        if (textoLivre !== undefined && textoLivre !== null && typeof textoLivre !== 'string') {
          return enviar(res, 400, { code: 'corpo_invalido' });
        }
        const limpo = typeof textoLivre === 'string' ? textoLivre.trim() : '';
        if (Array.from(limpo).length > TEXTO_DENUNCIA_MAX) return enviar(res, 422, { code: 'texto_invalido' });
        const r = await opts.store.denunciar(rota.id, sessao.userId, motivo, limpo === '' ? null : limpo, new Date(agora));
        if (r.outcome === 'registrada') return enviar(res, 201, { status: 'registrada', id: r.reportId });
        if (r.outcome === 'nao_encontrada') return enviar(res, 404, NAO_ENCONTRADO);
        return enviar(res, 422, { code: r.outcome });
      }
      case 'bloqueio': {
        const r = await opts.store.bloquear(rota.id, sessao.userId, new Date(agora));
        if (r === 'nao_encontrada') return enviar(res, 404, NAO_ENCONTRADO);
        return enviar(res, 200, { status: r });
      }
      case 'selecao': {
        const corpo = objeto(await lerCorpo(req));
        const aceite = corpo?.acceptance_id;
        if (corpo === null || Object.keys(corpo).length !== 1 || typeof aceite !== 'string' || !UUID_RE.test(aceite)) {
          return enviar(res, 400, { code: 'corpo_invalido' });
        }
        const r = await opts.store.selecionar(rota.id, sessao.userId, aceite, new Date(agora));
        if (r.outcome === 'selecionado' || r.outcome === 'sem_mudanca') {
          return enviar(res, 200, { status: r.outcome, selectedAcceptanceId: r.selectedAcceptanceId, selectedAt: r.selectedAt });
        }
        if (r.outcome === 'nao_encontrado') return enviar(res, 404, NAO_ENCONTRADO);
        return enviar(res, 409, { code: r.outcome });
      }
    }
  } catch {
    if (!res.headersSent) enviar(res, 503, { code: 'indisponivel' });
  }
}
