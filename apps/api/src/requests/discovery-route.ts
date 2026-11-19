// Issue 68 (H-055) | Rota GET /v1/professional/discovery/requests (docs/factory/153-DESENHO-H055.md, §3.1, §3.2; decisoes 607, 610, 618, 619).
// Ordem fixa: metodo (so GET; outro = 404 uniforme) -> sessao (ausente ou nula = 401) -> perfil profissional (ausente = 403)
// -> query (400 parametro_invalido) -> limite de 60 por minuto (429 com Retry-After) -> servico (cursor 400, falha 503, 200).
// O cursor so e decifrado depois do limite (A-3). Cabecalhos iguais em toda resposta: no-store, no-referrer, JSON UTF-8.
// Sem CORS. Nenhum log de cookie, cursor, id de pedido ou descricao.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SESSION_COOKIE_NAME, cookieValue, parseDiscoveryQuery, type RateWindowDecision } from '@fastpro/domain';
import { hashSessionSecret } from '@fastpro/db';
import { PEDIDO_NAO_ENCONTRADO_BODY } from './detail-service.js';
import {
  DESCOBERTA_INDISPONIVEL_BODY,
  discoverRequests,
  type DiscoveryServiceDeps,
} from './discovery-service.js';

/** Caminho exato da lista do profissional. Qualquer sufixo ou barra extra nao casa (404 pela aplicacao). */
export const DISCOVERY_PATH = '/v1/professional/discovery/requests' as const;

/** Cabecalhos iguais em toda resposta desta rota (§3.2). */
const CABECALHOS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Type': 'application/json; charset=utf-8',
} as const;

const SESSAO_NECESSARIA_BODY = { code: 'sessao_necessaria' } as const;
const PERFIL_OBRIGATORIO_BODY = { code: 'perfil_profissional_obrigatorio' } as const;
const PARAMETRO_INVALIDO_BODY = { code: 'parametro_invalido' } as const;
const MUITAS_REQUISICOES_BODY = { code: 'muitas_requisicoes' } as const;

export interface DiscoveryRouteOptions {
  /** Sessao do profissional (mesmo cookie das demais rotas autenticadas). */
  readonly sessions: { authenticate(hash: string, nowMs: number): Promise<{ readonly userId: string } | null> };
  /** Conta com perfil profissional (decisao 607). Falso = 403, sem revelar verificacao, plano ou pagamento. */
  readonly profissional: { existe(userId: string): Promise<boolean> };
  /** Limite de 60 por minuto por profissional (decisao 610), sobre o balde do banco. */
  readonly limite: {
    check(professionalId: string, nowMs: number): Promise<RateWindowDecision>;
    record(professionalId: string, nowMs: number): Promise<void>;
  };
  /** Servico da descoberta (store, projecao, fotos, codec do cursor e relogio). */
  readonly service: DiscoveryServiceDeps;
}

export function isDiscoveryRoute(path: string): boolean {
  return path === DISCOVERY_PATH;
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

function enviar(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...CABECALHOS, ...extra });
  res.end(JSON.stringify(body));
}

export async function handleDiscoveryRoute(
  req: IncomingMessage,
  res: ServerResponse,
  opts: DiscoveryRouteOptions,
): Promise<void> {
  try {
    if (req.method !== 'GET') return enviar(res, 404, PEDIDO_NAO_ENCONTRADO_BODY);
    const segredo = cookieValue(cabecalho(req.headers.cookie), SESSION_COOKIE_NAME);
    if (segredo === undefined) return enviar(res, 401, SESSAO_NECESSARIA_BODY);

    const agora = opts.service.clock.nowMs();
    const sessao = await opts.sessions.authenticate(hashSessionSecret(segredo), agora);
    if (sessao === null) return enviar(res, 401, SESSAO_NECESSARIA_BODY);
    if (!(await opts.profissional.existe(sessao.userId))) return enviar(res, 403, PERFIL_OBRIGATORIO_BODY);

    const url = new URL(req.url ?? '/', 'http://localhost');
    const consulta = parseDiscoveryQuery([...url.searchParams.entries()]);
    if (!consulta.ok) return enviar(res, 400, PARAMETRO_INVALIDO_BODY);

    const cota = await opts.limite.check(sessao.userId, agora);
    if (cota.decision === 'barrado') {
      return enviar(res, 429, MUITAS_REQUISICOES_BODY, { 'Retry-After': String(cota.retryAfterSeconds) });
    }
    await opts.limite.record(sessao.userId, agora);

    const resultado = await discoverRequests(
      sessao.userId,
      { limit: consulta.limit, cursor: consulta.cursor },
      opts.service,
    );
    return enviar(res, resultado.status, resultado.body);
  } catch {
    // Falha nossa vira 503 fixo: sem texto de banco, de cifra ou de sessao na resposta nem no registro.
    if (!res.headersSent) enviar(res, 503, DESCOBERTA_INDISPONIVEL_BODY);
  }
}
