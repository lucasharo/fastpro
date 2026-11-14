// Issue 56 (H-043) | Rota publica GET /v1/public/professionals/:slug (docs/factory/143-DESENHO-H043.md, §5).
// Sem sessao: o cookie e ignorado e nunca ha Set-Cookie. Ordem: limite de taxa por IP (antes do banco),
// formato do slug, leitura, montagem pelo dominio, validacao do contrato, resposta.
// 404 uniforme: o mesmo corpo e os mesmos cabecalhos para inexistente, mal formado, nao aprovado, retido, suspenso etc.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { montarPerfilPublico, type PublicProfilePort } from '@fastpro/domain';

export const PUBLIC_PROFILE_ROUTE_PREFIX = '/v1/public/professionals/' as const;
/** Diretiva de robos do DEV (dec. 599 e 655). Troca para 'index, follow' so no lancamento M4, por decisao humana. */
export const PUBLIC_PROFILE_ROBOTS_DIRECTIVE = 'noindex, nofollow' as const;
export const PUBLIC_PROFILE_CACHE_200 = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600' as const;
/** Limite por IP (dec. 596): 60 requisicoes por minuto. */
export const PUBLIC_PROFILE_RATE_LIMIT = 60;
export const PUBLIC_PROFILE_RATE_WINDOW_MS = 60_000;

const SLUG_FORMATO = /^[a-z0-9][a-z0-9-]{0,99}$/;
const CORPO_NAO_ENCONTRADO = JSON.stringify({ code: 'professional_not_found' });

export type ResultadoLimite = { readonly ok: true } | { readonly ok: false; readonly retryAfterS: number };

export interface PublicProfileRateLimit {
  /** Conta uma requisicao do IP e informa se ela passa. Chamado antes de qualquer leitura de banco. */
  consumir(ip: string, agoraMs: number): ResultadoLimite;
}

/**
 * Limite em memoria por instancia (dec. 654, declarado como limite do DEV). Em varias instancias o limite
 * vale por instancia; o limite definitivo fica no gateway do lancamento.
 */
export function criarLimiteMemoria(
  limite: number = PUBLIC_PROFILE_RATE_LIMIT,
  janelaMs: number = PUBLIC_PROFILE_RATE_WINDOW_MS,
): PublicProfileRateLimit {
  const janelas = new Map<string, { inicio: number; contagem: number }>();
  return {
    consumir(ip, agoraMs) {
      const atual = janelas.get(ip);
      if (atual === undefined || agoraMs - atual.inicio >= janelaMs) {
        janelas.set(ip, { inicio: agoraMs, contagem: 1 });
        return { ok: true };
      }
      if (atual.contagem < limite) {
        atual.contagem += 1;
        return { ok: true };
      }
      const restante = janelaMs - (agoraMs - atual.inicio);
      return { ok: false, retryAfterS: Math.max(1, Math.ceil(restante / 1000)) };
    },
  };
}

export interface PublicProfileRouteOptions {
  readonly port: PublicProfilePort;
  readonly limite: PublicProfileRateLimit;
  /** Relogio injetado para o limite de taxa (padrao: Date.now). */
  readonly agoraMs?: () => number;
}

/** Cabecalhos comuns a toda resposta da rota: sem cookie, sem sniffing, sem indexacao no DEV. */
function cabecalhosComuns(): Record<string, string> {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': PUBLIC_PROFILE_ROBOTS_DIRECTIVE,
  };
}

function enviar(res: ServerResponse, status: number, corpo: string, extra: Record<string, string>): void {
  res.writeHead(status, { ...cabecalhosComuns(), ...extra });
  res.end(corpo);
}

function ipDoPedido(req: IncomingMessage): string {
  // So o endereco do socket: cabecalho repassado pelo cliente nao e confiavel (ver docs 143, §5).
  return req.socket.remoteAddress ?? 'desconhecido';
}

/** Extrai o slug do caminho; devolve undefined quando o caminho nao segue o formato da rota. */
function slugDoCaminho(url: string | undefined): string | undefined {
  const caminho = (url ?? '').split('?')[0] ?? '';
  if (!caminho.startsWith(PUBLIC_PROFILE_ROUTE_PREFIX)) return undefined;
  const resto = caminho.slice(PUBLIC_PROFILE_ROUTE_PREFIX.length);
  if (resto.length === 0 || resto.includes('/')) return undefined;
  try {
    return decodeURIComponent(resto);
  } catch {
    return undefined;
  }
}

export async function handlePublicProfileGet(
  req: IncomingMessage,
  res: ServerResponse,
  opts: PublicProfileRouteOptions,
): Promise<void> {
  const agora = (opts.agoraMs ?? Date.now)();
  const taxa = opts.limite.consumir(ipDoPedido(req), agora);
  if (!taxa.ok) {
    enviar(res, 429, JSON.stringify({ code: 'muitas_requisicoes' }), {
      'Cache-Control': 'no-store',
      'Retry-After': String(taxa.retryAfterS),
    });
    return;
  }

  const semCache = { 'Cache-Control': 'no-store' };
  const slug = slugDoCaminho(req.url);
  if (slug === undefined || !SLUG_FORMATO.test(slug)) {
    enviar(res, 404, CORPO_NAO_ENCONTRADO, semCache);
    return;
  }

  try {
    const linha = await opts.port.lerPorSlug(slug);
    if (linha === null) {
      enviar(res, 404, CORPO_NAO_ENCONTRADO, semCache);
      return;
    }
    const montado = montarPerfilPublico(linha);
    if (!montado.ok) {
      enviar(res, 500, JSON.stringify({ code: 'erro_interno' }), semCache);
      return;
    }
    enviar(res, 200, JSON.stringify(montado.perfil), { 'Cache-Control': PUBLIC_PROFILE_CACHE_200 });
  } catch {
    // Sem detalhe: falha do banco ou do dominio vira 500 generico, nunca o texto do erro.
    if (!res.headersSent) enviar(res, 500, JSON.stringify({ code: 'erro_interno' }), semCache);
  }
}
