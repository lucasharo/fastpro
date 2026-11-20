// Issue 71 (H-058) | Rota POST /v1/requests/:id/acceptances (docs/factory/162-DESENHO-H058.md, §3.1 a §3.4, §8 fatia 5).
// Ordem fixa: metodo/caminho -> Origin (mutacao; ausente ou de outro site = 403 origem_invalida) -> formato do id
// (mal formado = 404 sem tocar o banco, A-9) -> query (qualquer parametro = 400) -> cookie de sessao (ausente = 401)
// -> sessao no banco (nula = 401) -> perfil profissional (403) -> limite de 20 por minuto (429, com Retry-After)
// -> Idempotency-Key UUID v4 (400) -> corpo (vazio ou {} aceito; JSON invalido, acima de 1 KiB ou Content-Type
// que nao seja application/json com corpo = 400 corpo_invalido; chave extra = 422) -> servico.
// Toda resposta (inclusive 4xx e 5xx) sai com Cache-Control no-store, Referrer-Policy no-referrer e JSON UTF-8.
// Sem CORS. Nenhum log de corpo, cookie, chave de idempotencia ou id de pedido.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ACCEPTANCE_BODY_MAX_BYTES,
  SESSION_COOKIE_NAME,
  checkDraftOrigin,
  cookieValue,
  isAcceptanceRequestId,
  normalizeAcceptanceIdempotencyKey,
  siteOriginOf,
  validarCorpoAceite,
  type RateWindowDecision,
} from '@fastpro/domain';
import { hashSessionSecret, type AcceptanceResult } from '@fastpro/db';
import { aceitarTrabalho, type AcceptanceServiceDeps } from './acceptance-service.js';
import { PEDIDO_NAO_ENCONTRADO_BODY } from './detail-service.js';

/** Prefixo fixo da rota (o id entra no meio do caminho). */
const ACCEPTANCE_PATH_RE = /^\/v1\/requests\/([^/]+)\/acceptances$/;

/** Cabecalhos iguais em toda resposta desta rota (§3.2). */
const CABECALHOS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Type': 'application/json; charset=utf-8',
} as const;

export interface AcceptanceRouteOptions {
  /** SITE_URL: a origem dela e a unica aceita em Origin nas mutacoes (mesma regra da publicacao e do contato). */
  readonly siteUrl: string;
  /** Sessao do profissional (mesmo cookie das demais rotas autenticadas). */
  readonly sessions: { authenticate(hash: string, nowMs: number): Promise<{ readonly userId: string } | null> };
  /** Conta com perfil profissional. Falso = 403 perfil_profissional_obrigatorio. */
  readonly profissional: { existe(userId: string): Promise<boolean> };
  /** Limite de 20 por minuto por profissional (decisao 869), sobre o balde do banco. */
  readonly limite: {
    check(professionalId: string, nowMs: number): Promise<RateWindowDecision>;
    record(professionalId: string, nowMs: number): Promise<void>;
  };
  /** Servico do aceite (porta do adaptador de banco e relogio). */
  readonly service: AcceptanceServiceDeps;
}

/** Caminho do aceite: devolve o id do pedido (ainda sem validar o formato) ou null se o caminho nao e este. */
export function acceptanceRouteId(path: string): string | null {
  const casado = ACCEPTANCE_PATH_RE.exec(path);
  return casado === null ? null : (casado[1] ?? '');
}

/** Reconhece a rota pelo metodo e pelo caminho. So POST existe; o resto segue para o 404 do roteador. */
export function isAcceptanceRoute(metodo: string, path: string): boolean {
  return metodo === 'POST' && acceptanceRouteId(path) !== null;
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

function enviar(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...CABECALHOS, ...extra });
  res.end(JSON.stringify(body));
}

/** Le o corpo guardando no maximo o limite + 1 byte; o restante so e contado (sem reset de conexao). */
function lerCorpo(req: IncomingMessage, limite: number): Promise<{ readonly text: string; readonly bytes: number }> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    let guardados = 0;
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (guardados <= limite) {
        partes.push(chunk);
        guardados += chunk.length;
      }
    });
    req.on('end', () => resolve({ text: Buffer.concat(partes).toString('utf8'), bytes: total }));
    req.on('error', reject);
  });
}

/** Content-Type de JSON (parametros como charset sao aceitos). Usado so quando ha corpo. */
function ehJson(contentType: string | undefined): boolean {
  const midia = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return midia === 'application/json';
}

/** Corpo do resultado de negocio: so o codigo, e a mensagem neutra quando o dominio define uma. */
function corpoDoErro(resultado: Extract<AcceptanceResult, { ok: false }>): Record<string, string> {
  return resultado.message !== undefined ? { code: resultado.code, message: resultado.message } : { code: resultado.code };
}

export async function handleAcceptanceRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  opts: AcceptanceRouteOptions,
): Promise<void> {
  try {
    const origem = checkDraftOrigin(
      { origin: cabecalho(req.headers.origin), secFetchSite: cabecalho(req.headers['sec-fetch-site']) },
      siteOriginOf(opts.siteUrl),
      true,
    );
    if (!origem.ok) return enviar(res, 403, { code: 'origem_invalida' });

    const idBruto = acceptanceRouteId(path);
    if (idBruto === null || !isAcceptanceRequestId(idBruto)) return enviar(res, 404, PEDIDO_NAO_ENCONTRADO_BODY);

    const url = new URL(req.url ?? '/', 'http://localhost');
    if ([...url.searchParams.keys()].length > 0) return enviar(res, 400, { code: 'parametro_invalido' });

    const segredo = cookieValue(cabecalho(req.headers.cookie), SESSION_COOKIE_NAME);
    if (segredo === undefined) return enviar(res, 401, { code: 'sessao_necessaria' });

    const agora = opts.service.clock.nowMs();
    const sessao = await opts.sessions.authenticate(hashSessionSecret(segredo), agora);
    if (sessao === null) return enviar(res, 401, { code: 'sessao_necessaria' });

    if (!(await opts.profissional.existe(sessao.userId))) {
      return enviar(res, 403, { code: 'perfil_profissional_obrigatorio' });
    }

    const cota = await opts.limite.check(sessao.userId, agora);
    if (cota.decision === 'barrado') {
      return enviar(res, 429, { code: 'muitas_requisicoes' }, { 'Retry-After': String(cota.retryAfterSeconds) });
    }
    await opts.limite.record(sessao.userId, agora);

    const chaveBruta = cabecalho(req.headers['idempotency-key']);
    if (chaveBruta === undefined || chaveBruta === '') {
      return enviar(res, 400, { code: 'chave_idempotencia_obrigatoria' });
    }
    const chave = normalizeAcceptanceIdempotencyKey(chaveBruta);
    if (chave === null) return enviar(res, 400, { code: 'chave_idempotencia_invalida' });

    const { text, bytes } = await lerCorpo(req, ACCEPTANCE_BODY_MAX_BYTES);
    if (bytes > 0 && !ehJson(cabecalho(req.headers['content-type']))) {
      return enviar(res, 400, { code: 'corpo_invalido' });
    }
    let bruto: unknown;
    if (text.trim() !== '') {
      try {
        bruto = JSON.parse(text) as unknown;
      } catch {
        return enviar(res, 400, { code: 'corpo_invalido' });
      }
    }
    const corpo = validarCorpoAceite(bruto, bytes);
    if (!corpo.ok) {
      return enviar(res, corpo.code === 'corpo_invalido' ? 400 : 422, { code: corpo.code });
    }

    const resultado = await aceitarTrabalho(
      { requestId: idBruto.toLowerCase(), professionalId: sessao.userId, key: chave },
      opts.service,
    );
    if (resultado.ok) return enviar(res, resultado.status, resultado.envelope);
    return enviar(
      res,
      resultado.status,
      corpoDoErro(resultado),
      resultado.retryAfterSeconds !== undefined ? { 'Retry-After': String(resultado.retryAfterSeconds) } : {},
    );
  } catch {
    // Falha nossa vira 503 fixo: sem texto de banco, de cifra ou de sessao na resposta nem no registro.
    if (!res.headersSent) enviar(res, 503, { code: 'servico_indisponivel' });
  }
}
