// H-012 | Rota POST /v1/auth/challenges/consume (docs/factory/46-DESENHO-H012.md, §1, §2 e §5).
// Ordem fixa: Origin e Content-Type conferidos ANTES de ler o corpo; depois o corpo (so {token}),
// e so entao o consumo (uma chamada ao handler de @fastpro/db). Sem CORS. Sem log de corpo.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  CONSUME_BODY_LIMIT_BYTES,
  CONSUME_HEADERS,
  checkConsumeHeaders,
  parseConsumeBody,
  siteOriginOf,
} from '@fastpro/domain';
import { consumeChallenge, type ConsumeDeps } from '@fastpro/db';

export interface ConsumeRouteOptions {
  /** Dependencias do consumo (repositorio, conta, etapa, decifra). Montadas por buildConsumeDeps. */
  readonly deps: ConsumeDeps;
  /** SITE_URL: a origem dela e a unica aceita em Origin (46 §1). */
  readonly siteUrl: string;
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

/**
 * Le o corpo. Guarda no maximo o limite + 1 byte (memoria limitada); o restante so e contado,
 * para que o pedido grande receba a resposta 422 sem reset de conexao no meio do envio.
 */
function lerCorpo(
  req: IncomingMessage,
  limite: number,
): Promise<{ readonly text: string; readonly bytes: number }> {
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
    req.on('end', () =>
      resolve({ text: Buffer.concat(partes).toString('utf8'), bytes: total }),
    );
    req.on('error', reject);
  });
}

function enviar(
  res: ServerResponse,
  status: number,
  corpo: Record<string, string>,
  extra: Readonly<Record<string, string>> = {},
): void {
  res.writeHead(status, { ...CONSUME_HEADERS, ...extra });
  res.end(JSON.stringify(corpo));
}

/** Resposta de falha nossa fora do consumo (503 acesso_indisponivel), sem detalhe. */
function indisponivel(res: ServerResponse): void {
  if (res.headersSent) return;
  enviar(res, 503, { code: 'acesso_indisponivel' });
}

export async function handleConsume(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ConsumeRouteOptions,
): Promise<void> {
  try {
    const cabecalhos = checkConsumeHeaders(
      {
        origin: cabecalho(req.headers.origin),
        secFetchSite: cabecalho(req.headers['sec-fetch-site']),
        contentType: cabecalho(req.headers['content-type']),
      },
      siteOriginOf(opts.siteUrl),
    );
    if (!cabecalhos.ok) {
      // Nada foi lido do corpo e nada foi consumido (46 §1, CA-H012-09).
      enviar(res, cabecalhos.status, { code: cabecalhos.code });
      return;
    }

    const { text, bytes } = await lerCorpo(req, CONSUME_BODY_LIMIT_BYTES);
    const corpo = parseConsumeBody(text, bytes);
    if (!corpo.ok) {
      enviar(res, 422, { code: 'pedido_invalido' });
      return;
    }

    const r = await consumeChallenge(opts.deps, corpo.token);
    enviar(res, r.status, r.body, r.setCookie ? { 'Set-Cookie': r.setCookie } : {});
  } catch {
    // Sem detalhe de erro na resposta nem no registro (token, e-mail e segredo nunca saem).
    indisponivel(res);
  }
}
