// H-056 (Issue 69) | Rotas das fotos elegiveis (docs/factory/167-DESENHO-H056.md, §4.1, A-14).
// Profissional: GET /v1/professional/requests/:id/photos e .../:photoId/view. Dono: GET /v1/requests/:id/photos e .../view.
// Ordem fixa: metodo (so GET; outro = 404 uniforme) -> sessao (401) -> perfil (403, so profissional)
// -> query (400) -> limite de 60 por minuto (429) -> servico. Cabecalhos iguais: no-store, no-referrer, JSON UTF-8.
// Sem CORS. Nenhum log de cookie, token, id de pedido ou id de foto.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  SESSION_COOKIE_NAME,
  cookieValue,
  parsePhotoVariant,
  type PhotoTokenMode,
  type RateWindowDecision,
} from '@fastpro/domain';
import { hashSessionSecret } from '@fastpro/db';
import {
  FOTO_INDISPONIVEL_BODY,
  FOTO_NAO_ENCONTRADA_BODY,
  emitirLink,
  listarFotos,
  type PhotoViewServiceDeps,
} from './photo-view-service.js';

/** Cabecalhos iguais em toda resposta desta rota. */
const CABECALHOS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Type': 'application/json; charset=utf-8',
} as const;

const SESSAO_NECESSARIA_BODY = { code: 'sessao_necessaria' } as const;
const PERFIL_OBRIGATORIO_BODY = { code: 'perfil_profissional_obrigatorio' } as const;
const PARAMETRO_INVALIDO_BODY = { code: 'parametro_invalido' } as const;
const MUITAS_REQUISICOES_BODY = { code: 'muitas_requisicoes' } as const;

export interface PhotoViewRouteOptions {
  /** Sessao (mesmo cookie das rotas autenticadas). */
  readonly sessions: { authenticate(hash: string, nowMs: number): Promise<{ readonly userId: string } | null> };
  /** Conta com perfil profissional. Exigido so nas rotas do profissional. */
  readonly profissional: { existe(userId: string): Promise<boolean> };
  /** Limite de 60 por minuto por usuario (politica da foto, sobre o balde do banco). */
  readonly limite: {
    check(usuarioId: string, nowMs: number): Promise<RateWindowDecision>;
    record(usuarioId: string, nowMs: number): Promise<void>;
  };
  readonly service: PhotoViewServiceDeps;
}

export interface RotaFotos {
  readonly papel: PhotoTokenMode;
  readonly acao: 'lista' | 'view';
  readonly id: string;
  readonly photoId: string;
}

const ROTAS: ReadonlyArray<{ readonly re: RegExp; readonly papel: PhotoTokenMode; readonly acao: 'lista' | 'view' }> = [
  { re: /^\/v1\/professional\/requests\/([^/]+)\/photos$/, papel: 'professional', acao: 'lista' },
  { re: /^\/v1\/professional\/requests\/([^/]+)\/photos\/([^/]+)\/view$/, papel: 'professional', acao: 'view' },
  { re: /^\/v1\/requests\/([^/]+)\/photos$/, papel: 'owner', acao: 'lista' },
  { re: /^\/v1\/requests\/([^/]+)\/photos\/([^/]+)\/view$/, papel: 'owner', acao: 'view' },
];

/** Casa o caminho exato das quatro rotas de foto. Qualquer outro caminho devolve null. */
export function photoViewRoute(path: string): RotaFotos | null {
  for (const rota of ROTAS) {
    const m = rota.re.exec(path);
    if (m !== null) return { papel: rota.papel, acao: rota.acao, id: m[1] ?? '', photoId: m[2] ?? '' };
  }
  return null;
}

export function isPhotoViewRoute(path: string): boolean {
  return photoViewRoute(path) !== null;
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

function enviar(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...CABECALHOS, ...extra });
  res.end(JSON.stringify(body));
}

export async function handlePhotoViewRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  opts: PhotoViewRouteOptions,
): Promise<void> {
  try {
    const rota = photoViewRoute(path);
    if (rota === null || req.method !== 'GET') return enviar(res, 404, FOTO_NAO_ENCONTRADA_BODY);
    const segredo = cookieValue(cabecalho(req.headers.cookie), SESSION_COOKIE_NAME);
    if (segredo === undefined) return enviar(res, 401, SESSAO_NECESSARIA_BODY);

    const agora = opts.service.clock.nowMs();
    const sessao = await opts.sessions.authenticate(hashSessionSecret(segredo), agora);
    if (sessao === null) return enviar(res, 401, SESSAO_NECESSARIA_BODY);
    if (rota.papel === 'professional' && !(await opts.profissional.existe(sessao.userId))) {
      return enviar(res, 403, PERFIL_OBRIGATORIO_BODY);
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    const parametros = [...url.searchParams.keys()];
    const variantes = url.searchParams.getAll('variant');
    if (rota.acao === 'lista' && parametros.length > 0) return enviar(res, 400, PARAMETRO_INVALIDO_BODY);
    if (rota.acao === 'view' && (parametros.some((p) => p !== 'variant') || variantes.length > 1)) {
      return enviar(res, 400, PARAMETRO_INVALIDO_BODY);
    }
    // Sem 'variant' = 'full' (padrao, decisao 836); valor fora de preview/full = 400.
    const variante = parsePhotoVariant(variantes[0] ?? null);
    if (variante === null) return enviar(res, 400, PARAMETRO_INVALIDO_BODY);

    const cota = await opts.limite.check(sessao.userId, agora);
    if (cota.decision === 'barrado') {
      return enviar(res, 429, MUITAS_REQUISICOES_BODY, { 'Retry-After': String(cota.retryAfterSeconds) });
    }
    await opts.limite.record(sessao.userId, agora);

    const resultado =
      rota.acao === 'lista'
        ? await listarFotos(rota.papel, sessao.userId, rota.id, opts.service)
        : await emitirLink(rota.papel, sessao.userId, rota.id, rota.photoId, variante, opts.service);
    return enviar(res, resultado.status, resultado.body);
  } catch {
    // Falha nossa vira 503 fixo: sem texto de banco, de cifra ou de sessao na resposta nem no registro.
    if (!res.headersSent) enviar(res, 503, FOTO_INDISPONIVEL_BODY);
  }
}
