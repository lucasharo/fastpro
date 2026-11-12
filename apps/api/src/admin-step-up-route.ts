// H-073 (Issue 83, docs/factory/60-DESENHO-H073.md §4) | Rota POST /v1/admin/session/step-up via HTTP.
// Toda a decisao fica em stepUpAdmin (dominio): guarda da rota (sessao e Origin, 404 identico),
// limite por e-mail e IP, prova no provedor pelo mesmo caminho do login, conta igual a da sessao e,
// so entao, o banco avanca totp_at. Aqui: cookie, corpo limitado, IP do socket (nunca cabecalho
// encaminhado) e envio. Sem a opcao adminStepUp montada no app, a rota nao existe (404).
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ADMIN_SESSION_COOKIE,
  adminReply,
  cookieValue,
  stepUpAdmin,
  type AdminAuthPort,
  type AdminLogger,
  type AdminLoginLimits,
  type AdminRepository,
  type AdminResponse,
} from '@fastpro/domain';

/** Corpo {password, code} e pequeno: o mesmo limite de 1 KiB do step-up de H-014. Acima disso, corpo ausente. */
export const ADMIN_STEP_UP_BODY_LIMIT_BYTES = 1024;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export interface AdminStepUpRouteOptions {
  readonly repo: Pick<AdminRepository, 'guard' | 'sessionSubject' | 'stepUp'>;
  /** Porta do provedor de autenticacao (mesma do login de H-102). */
  readonly auth: AdminAuthPort;
  /** Limites de tentativas (H-015): 5 por e-mail e 20 por IP em 15 min. */
  readonly limits: AdminLoginLimits;
  /** Registro sem dado pessoal (o dominio so passa evento, resultado e motivo). */
  readonly log: AdminLogger;
  /** ADMIN_BASE_URL: a unica Origin aceita em mutacoes (54 §3). */
  readonly baseUrl: string;
  readonly clock: { nowMs(): number };
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

/** Le o corpo guardando no maximo o limite + 1 byte; o restante so e contado. */
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
    req.on('end', () => resolve({ text: Buffer.concat(partes).toString('utf8'), bytes: total }));
    req.on('error', reject);
  });
}

function enviar(res: ServerResponse, resposta: AdminResponse): void {
  if (resposta.status === 404) {
    // Mesmo 404 da rota inexistente (app.ts): corpo vazio, so Cache-Control.
    res.writeHead(404, NO_STORE);
    res.end();
    return;
  }
  res.writeHead(resposta.status, {
    ...resposta.headers,
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(resposta.body));
}

/** POST /v1/admin/session/step-up. Erros nao ecoam senha, codigo nem valores do provedor. */
export async function handleAdminStepUpRoute(
  req: IncomingMessage,
  res: ServerResponse,
  opts: AdminStepUpRouteOptions,
): Promise<void> {
  try {
    const nowMs = opts.clock.nowMs();
    const secret = cookieValue(cabecalho(req.headers.cookie), ADMIN_SESSION_COOKIE) ?? null;
    const { text, bytes } = await lerCorpo(req, ADMIN_STEP_UP_BODY_LIMIT_BYTES);

    let corpo: Record<string, unknown> = {};
    if (bytes <= ADMIN_STEP_UP_BODY_LIMIT_BYTES && text.length > 0) {
      try {
        const lido: unknown = JSON.parse(text);
        if (typeof lido === 'object' && lido !== null && !Array.isArray(lido)) {
          corpo = lido as Record<string, unknown>;
        }
      } catch {
        corpo = {}; // corpo nao-JSON segue como vazio: o dominio recusa com credenciais_invalidas
      }
    }

    const resposta = await stepUpAdmin(
      {
        secret,
        headers: {
          contentType: cabecalho(req.headers['content-type']) ?? null,
          origin: cabecalho(req.headers.origin) ?? null,
          secFetchSite: cabecalho(req.headers['sec-fetch-site']) ?? null,
        },
        password: corpo.password,
        code: corpo.code,
        ip: req.socket.remoteAddress ?? 'desconhecido',
      },
      {
        repo: opts.repo,
        auth: opts.auth,
        limits: opts.limits,
        log: opts.log,
        baseUrl: opts.baseUrl,
      },
      nowMs,
    );
    return enviar(res, resposta);
  } catch {
    // Falha fora do dominio (banco ou provedor): sem dado e sem detalhe.
    return enviar(res, adminReply(503, { code: 'confirmacao_indisponivel' }));
  }
}
