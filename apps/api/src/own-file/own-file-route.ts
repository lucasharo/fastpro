// O profissional ve o proprio arquivo de verificacao (pedido do dono, 2026-11-27):
//   GET /v1/professional/documents/:id/file  -> a imagem (JPEG) ou o PDF, para conferir se enviou o certo.
// So o dono da sessao, so arquivo recebido que aparece na lista dele. Sem URL publica, sem cache; leitura com a
// credencial do leitor do bucket. Qualquer recusa = o mesmo 404.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SESSION_COOKIE_NAME, cookieValue } from '@fastpro/domain';
import { hashSessionSecret } from '@fastpro/db';

const CAMINHO_RE = /^\/v1\/professional\/documents\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/file$/i;

export interface OwnFileRouteOptions {
  readonly sessions: { authenticate(hash: string, nowMs: number): Promise<{ readonly userId: string } | null> };
  readonly lista: {
    list(userId: string): Promise<{ readonly documents: readonly { readonly id: string; readonly kind: 'pdf' | 'imagem'; readonly status: string }[] }>;
  };
  /** Bytes do objeto final pela chave i/<id>, ou null se ausente. */
  readonly storage: { lerBytes(chave: string, timeoutMs: number): Promise<Uint8Array | null> };
  readonly clock: { nowMs(): number };
}

export function isOwnFileRoute(metodo: string, path: string): boolean {
  return metodo === 'GET' && CAMINHO_RE.test(path);
}

function recusar(res: ServerResponse, status: number, code: string): void {
  res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ code }));
}

export async function handleOwnFileRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  opts: OwnFileRouteOptions,
): Promise<void> {
  try {
    const id = CAMINHO_RE.exec(path)?.[1]?.toLowerCase();
    if (id === undefined) return recusar(res, 404, 'nao_encontrado');
    const cabecalho = typeof req.headers.cookie === 'string' ? req.headers.cookie : undefined;
    const segredo = cookieValue(cabecalho, SESSION_COOKIE_NAME);
    if (segredo === undefined) return recusar(res, 401, 'sessao_necessaria');
    const sessao = await opts.sessions.authenticate(hashSessionSecret(segredo), opts.clock.nowMs());
    if (sessao === null) return recusar(res, 401, 'sessao_necessaria');
    const { documents } = await opts.lista.list(sessao.userId);
    const doc = documents.find((d) => d.id === id && d.status === 'recebido');
    if (doc === undefined) return recusar(res, 404, 'nao_encontrado');
    const bytes = await opts.storage.lerBytes(`i/${id}`, 8000);
    if (bytes === null) return recusar(res, 404, 'nao_encontrado');
    res.writeHead(200, {
      'Content-Type': doc.kind === 'pdf' ? 'application/pdf' : 'image/jpeg',
      'Content-Length': String(bytes.length),
      'Content-Disposition': `inline; filename="arquivo.${doc.kind === 'pdf' ? 'pdf' : 'jpg'}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(Buffer.from(bytes));
  } catch {
    if (!res.headersSent) recusar(res, 503, 'indisponivel');
  }
}
