// H-016 | Rotas do cadastro, da verificacao e do login por senha do profissional
// (docs/factory/33-DESENHO-H016.md §2, §3, §4, §5; CA-H016-01 a 13).
//   POST /v1/auth/professional/register              202 uniforme (cadastro ou e-mail ja existente).
//   POST /v1/auth/professional/verification/confirm  204 (consumiu o link) ou 410 unico.
//   POST /v1/auth/professional/login                 200 + cookie de sessao de 7 dias; 401/403/429.
// Ordem: Content-Type JSON, corpo com teto de 4 KB, depois a regra. Nenhuma resposta ou log traz
// senha, token ou e-mail. A persistencia fica na porta; o teste usa repositorio em memoria.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ACCOUNT_UNAVAILABLE_BODY,
  INVALID_CREDENTIALS_BODY,
  LINK_INVALID_BODY,
  LOGIN_BLOCKED_BODY,
  PROFESSIONAL_ACCEPTED_BODY,
  PROFESSIONAL_LOGIN_PATH,
  PROFESSIONAL_REGISTER_PATH,
  PROFESSIONAL_VERIFY_CONFIRM_PATH,
  SERVICE_UNAVAILABLE_BODY,
  SESSION_MAX_AGE_SECONDS,
  checkProfessionalRegister,
  isProfessionalLinkToken,
  loginEmailOrNull,
  loginPasswordOrNull,
  sessionCookieHeader,
} from '@fastpro/domain';

/** Corpo maximo aceito por estas rotas (senha de 72 bytes cabe folgado). */
const CORPO_LIMITE = 4096;
const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } as const;

/** Resultado do login para a rota: so o necessario para decidir a resposta. */
export interface ProfessionalCredential {
  readonly userId: string;
  readonly emailVerified: boolean;
  readonly active: boolean;
}

/**
 * Porta de persistencia. Implementada em memoria nos testes e no Postgres (adaptador da #29).
 * Os metodos de contador sao atomicos no adaptador: gateLogin decide e grava a tentativa de uma vez.
 */
export interface ProfessionalAuthPort {
  /** Cadastro sem revelar existencia: cria, ou trata o e-mail ja existente do mesmo jeito. Lanca em falha. */
  register(email: string, password: string, nowMs: number): Promise<void>;
  /** Consome o link de verificacao. true so na primeira vez e dentro do prazo. */
  confirmVerification(token: string, nowMs: number): Promise<boolean>;
  /** Decide o bloqueio progressivo e grava a tentativa (ja contada). */
  loginGate(
    email: string,
    nowMs: number,
  ): Promise<
    | { readonly kind: 'bloqueada'; readonly retryAfterSeconds: number }
    | { readonly kind: 'tentativa' }
  >;
  /** Confere a senha. Nulo para senha errada ou e-mail inexistente (mesma resposta). */
  verifyPassword(email: string, password: string): Promise<ProfessionalCredential | null>;
  /** Zera o contador apos login correto. */
  loginSucceeded(email: string): Promise<void>;
  /** Abre a sessao de 7 dias e devolve o segredo em claro (so vai ao cookie). */
  openSession(credential: ProfessionalCredential, nowMs: number): Promise<{ readonly secret: string }>;
}

export interface ProfessionalRouteOptions {
  readonly port: ProfessionalAuthPort;
  readonly clock: { nowMs(): number };
}

function send(
  res: ServerResponse,
  status: number,
  headers: Record<string, string>,
  body: unknown,
): void {
  const texto = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    ...NO_STORE,
    ...(texto === '' ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
    ...headers,
  });
  res.end(texto);
}

type Corpo = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly status: 400 | 413 | 415 };

/** Le o corpo JSON com teto. O excedente e so contado (sem reset de conexao). */
function lerJson(req: IncomingMessage): Promise<Corpo> {
  return new Promise((resolve, reject) => {
    const tipo = req.headers['content-type'] ?? '';
    if (!/^application\/json\b/i.test(tipo)) {
      req.resume();
      resolve({ ok: false, status: 415 });
      return;
    }
    const partes: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total <= CORPO_LIMITE) partes.push(chunk);
    });
    req.on('end', () => {
      if (total > CORPO_LIMITE) return resolve({ ok: false, status: 413 });
      try {
        resolve({ ok: true, value: JSON.parse(Buffer.concat(partes).toString('utf8')) as unknown });
      } catch {
        resolve({ ok: false, status: 400 });
      }
    });
    req.on('error', reject);
  });
}

/** Cadastro: 202 identico para e-mail novo e existente; 422 so por forma ou senha fraca. */
export async function handleProfessionalRegister(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProfessionalRouteOptions,
): Promise<void> {
  const corpo = await lerJson(req);
  if (!corpo.ok) return send(res, corpo.status, {}, undefined);
  const entrada = checkProfessionalRegister(corpo.value);
  if (!entrada.ok) {
    return send(res, 422, {}, { code: 'campo_invalido', campo: entrada.campo, motivo: entrada.motivo });
  }
  try {
    await opts.port.register(entrada.email, entrada.password, opts.clock.nowMs());
  } catch {
    // Nunca 202 falso: a falha de infraestrutura nao pode parecer cadastro feito.
    return send(res, 503, {}, SERVICE_UNAVAILABLE_BODY);
  }
  return send(res, 202, {}, PROFESSIONAL_ACCEPTED_BODY);
}

/** Consumo do link (POST; o GET da pagina nao consome). 410 unico para qualquer link que nao sirva. */
export async function handleProfessionalVerifyConfirm(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProfessionalRouteOptions,
): Promise<void> {
  const corpo = await lerJson(req);
  if (!corpo.ok) return send(res, corpo.status, {}, undefined);
  const token = (corpo.value as { token?: unknown } | null)?.token;
  if (!isProfessionalLinkToken(token)) return send(res, 410, {}, LINK_INVALID_BODY);
  let ok: boolean;
  try {
    ok = await opts.port.confirmVerification(token, opts.clock.nowMs());
  } catch {
    return send(res, 503, {}, SERVICE_UNAVAILABLE_BODY);
  }
  return ok ? send(res, 204, {}, undefined) : send(res, 410, {}, LINK_INVALID_BODY);
}

/**
 * Login: o contador conta antes de conferir a senha, para conta existente ou nao (DD-4). A sessao so
 * e aberta com senha certa e conta ativa; sem e-mail verificado, a sessao e so de verificacao (D-H016-3).
 */
export async function handleProfessionalLogin(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProfessionalRouteOptions,
): Promise<void> {
  const corpo = await lerJson(req);
  if (!corpo.ok) return send(res, corpo.status, {}, undefined);
  const dados = (corpo.value ?? {}) as { email?: unknown; password?: unknown };
  const email = loginEmailOrNull(dados.email);
  const password = loginPasswordOrNull(dados.password);
  if (email === null || password === null) return send(res, 401, {}, INVALID_CREDENTIALS_BODY);

  const agora = opts.clock.nowMs();
  const portao = await opts.port.loginGate(email, agora);
  if (portao.kind === 'bloqueada') {
    return send(
      res,
      429,
      { 'Retry-After': String(portao.retryAfterSeconds) },
      LOGIN_BLOCKED_BODY,
    );
  }

  const credencial = await opts.port.verifyPassword(email, password);
  if (credencial === null) return send(res, 401, {}, INVALID_CREDENTIALS_BODY);
  if (!credencial.active) return send(res, 403, {}, ACCOUNT_UNAVAILABLE_BODY);

  await opts.port.loginSucceeded(email);
  const sessao = await opts.port.openSession(credencial, agora);
  return send(
    res,
    200,
    { 'Set-Cookie': sessionCookieHeader(sessao.secret, SESSION_MAX_AGE_SECONDS) },
    {
      access_level: credencial.emailVerified ? 'full' : 'verification_only',
      email_verified: credencial.emailVerified,
    },
  );
}

/** Guarda de forma para o roteador (so o nome do caminho; a logica e de cada handler). */
export function isProfessionalPath(path: string): boolean {
  return (
    path === PROFESSIONAL_REGISTER_PATH ||
    path === PROFESSIONAL_VERIFY_CONFIRM_PATH ||
    path === PROFESSIONAL_LOGIN_PATH
  );
}
