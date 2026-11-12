// H-097 (Issue 107) | Rota POST /v1/auth/challenges (pedido de acesso por link ou codigo; 39 §2, RF-039).
// Quem decide status, corpo e cabecalhos e requestChallenge (@fastpro/db): a rota so le o corpo com
// limite, passa o IP do socket e devolve a resposta. Nada aqui le conta, loga corpo, e-mail ou IP.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { requestChallenge, type RequestChallengeDeps } from '@fastpro/db';

export const CHALLENGE_REQUEST_PATH = '/v1/auth/challenges';
/** Corpo legitimo e {email, purpose?, draft_id?}: cabe com folga. Acima disso o pedido vira 422 uniforme. */
export const CHALLENGE_REQUEST_BODY_LIMIT_BYTES = 4096;

export interface ChallengeRequestRouteOptions {
  /** Dependencias do pedido (store, segredos, relogio, despacho pos-resposta e limites). */
  readonly deps: RequestChallengeDeps;
}

/** Le o corpo guardando no maximo o limite; o restante so e contado (memoria limitada). */
function lerCorpo(
  req: IncomingMessage,
  limite: number,
): Promise<{ readonly text: string; readonly excedeu: boolean }> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total <= limite) partes.push(chunk);
    });
    req.on('end', () =>
      resolve({ text: Buffer.concat(partes).toString('utf8'), excedeu: total > limite }),
    );
    req.on('error', reject);
  });
}

/** POST /v1/auth/challenges. Corpo invalido, grande ou ausente cai no 422 de requestChallenge. */
export async function handleChallengeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ChallengeRequestRouteOptions,
): Promise<void> {
  const { text, excedeu } = await lerCorpo(req, CHALLENGE_REQUEST_BODY_LIMIT_BYTES);
  let corpo: unknown;
  if (!excedeu) {
    try {
      corpo = JSON.parse(text) as unknown;
    } catch {
      corpo = undefined;
    }
  }
  const r = await requestChallenge(opts.deps, corpo, req.socket.remoteAddress ?? null);
  res.writeHead(r.status, { ...r.headers, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(r.body));
}
