// H-097 (Issue 107) | Rota POST /v1/auth/challenges/verify (verificacao do codigo de 6 digitos).
// PROPOSTA de caminho: o desenho H-011/H-013 ainda nao fixa a rota; verifyChallengeCode existe sem rota.
// Quem decide o resultado e verifyChallengeCode (@fastpro/db). Esta rota so le o corpo com limite.
// Nao cria sessao: o passo seguinte da tela (H-013) decide. Nada aqui loga e-mail, codigo ou IP.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { verifyChallengeCode, type VerifyChallengeDeps } from '@fastpro/db';
import { assertChallengePurpose } from '@fastpro/domain';

export const CHALLENGE_VERIFY_PATH = '/v1/auth/challenges/verify';
/** Corpo legitimo e {email, code, purpose?}: cabe com folga. */
export const CHALLENGE_VERIFY_BODY_LIMIT_BYTES = 2048;

export interface ChallengeVerifyRouteOptions {
  readonly deps: VerifyChallengeDeps;
}

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
    req.on('end', () => resolve({ text: Buffer.concat(partes).toString('utf8'), excedeu: total > limite }));
    req.on('error', reject);
  });
}

const INVALIDO = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' } as const;

export async function handleChallengeVerify(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ChallengeVerifyRouteOptions,
): Promise<void> {
  const { text, excedeu } = await lerCorpo(req, CHALLENGE_VERIFY_BODY_LIMIT_BYTES);
  let corpo: Record<string, unknown> = {};
  if (!excedeu) {
    try {
      const lido = JSON.parse(text) as unknown;
      if (lido !== null && typeof lido === 'object') corpo = lido as Record<string, unknown>;
    } catch {
      corpo = {};
    }
  }
  let purpose;
  try {
    purpose = assertChallengePurpose(typeof corpo.purpose === 'string' ? corpo.purpose : 'login');
  } catch {
    res.writeHead(422, INVALIDO);
    res.end(JSON.stringify({ code: 'codigo_invalido' }));
    return;
  }
  const r = await verifyChallengeCode(opts.deps, {
    email: typeof corpo.email === 'string' ? corpo.email : '',
    code: typeof corpo.code === 'string' ? corpo.code : '',
    purpose,
    clientIp: req.socket.remoteAddress ?? null,
  });
  res.writeHead(r.status, { ...r.headers, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(r.body));
}
