// H-097 (Issue 107) + H-013 (Issue 26) | Rota POST /v1/auth/challenges/verify (verificacao do codigo de 6 digitos).
// Desenho: docs/factory/91-DESENHO-H013.md, §1.2. Ordem fixa: Origin e Content-Type conferidos ANTES de ler o
// corpo (mesmo rigor de /consume, porque a rota emite cookie de etapa); depois o corpo com limite e
// verifyChallengeCode. 200 traz Set-Cookie __Host-fp_ident; sem Origin valida nada e lido nem consumido.
// Quem decide o resultado e verifyChallengeCode (@fastpro/db). Nada aqui loga e-mail, codigo ou IP.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { verifyChallengeCode, type VerifyChallengeDeps } from '@fastpro/db';
import { assertChallengePurpose, CONSUME_HEADERS, checkConsumeHeaders, siteOriginOf } from '@fastpro/domain';
import { lerCorpoLimitado } from './corpo-limitado.js';
import { draftNonceHashFromRequest } from './drafts/draft-nonce.js';

export const CHALLENGE_VERIFY_PATH = '/v1/auth/challenges/verify';
/** Corpo legitimo e {email, code, purpose?}: cabe com folga. */
export const CHALLENGE_VERIFY_BODY_LIMIT_BYTES = 2048;

export interface ChallengeVerifyRouteOptions {
  readonly deps: VerifyChallengeDeps;
  /** SITE_URL: a origem dela e a unica aceita em Origin (como /consume). */
  readonly siteUrl: string;
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

function enviar(res: ServerResponse, status: number, corpo: Record<string, string>): void {
  res.writeHead(status, CONSUME_HEADERS);
  res.end(JSON.stringify(corpo));
}

export async function handleChallengeVerify(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ChallengeVerifyRouteOptions,
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
      // Nada foi lido do corpo e nada foi consumido (91 §1.2, R-13).
      enviar(res, cabecalhos.status, { code: cabecalhos.code });
      return;
    }

    const { text, excedeu } = await lerCorpoLimitado(req, CHALLENGE_VERIFY_BODY_LIMIT_BYTES);
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
      enviar(res, 422, { code: 'codigo_invalido' });
      return;
    }
    const r = await verifyChallengeCode(opts.deps, {
      email: typeof corpo.email === 'string' ? corpo.email : '',
      code: typeof corpo.code === 'string' ? corpo.code : '',
      purpose,
      clientIp: req.socket.remoteAddress ?? null,
      browserNonceHash: draftNonceHashFromRequest(req),
    });
    const extra: Record<string, string> = { ...r.headers, 'Content-Type': 'application/json; charset=utf-8' };
    if (r.setCookie !== undefined) extra['Set-Cookie'] = r.setCookie;
    res.writeHead(r.status, extra);
    res.end(JSON.stringify(r.body));
  } catch {
    // Sem detalhe de erro na resposta nem no registro (codigo, e-mail e segredo nunca saem).
    if (!res.headersSent) enviar(res, 503, { code: 'acesso_indisponivel' });
  }
}
