// H-016 | Rotas do cadastro, da verificacao e do login por senha do profissional
// (docs/factory/33-DESENHO-H016.md §2, §3, §4, §5; CA-H016-01 a 13).
//   POST /v1/auth/professional/register              202 uniforme (cadastro ou e-mail ja existente).
//   POST /v1/auth/professional/verification/confirm  204 (consumiu o link) ou 410 unico.
//   POST /v1/auth/professional/login                 200 + cookie de sessao de 7 dias; 401/403/429.
// Ordem: Content-Type JSON, corpo com teto de 4 KB, depois a regra. Cadastro e login respondem so
// depois de um piso de tempo (33 §5.1 passo 4), para o tempo nao revelar se o e-mail existe.
// Nenhuma resposta ou log traz senha, token ou e-mail. A persistencia fica na porta.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ACCOUNT_UNAVAILABLE_BODY,
  INVALID_CREDENTIALS_BODY,
  LINK_INVALID_BODY,
  LOGIN_BLOCKED_BODY,
  PROFESSIONAL_ACCEPTED_BODY,
  PROFESSIONAL_LOGIN_PATH,
  PROFESSIONAL_REGISTER_PATH,
  PROFESSIONAL_RESPONSE_FLOOR_MS,
  PROFESSIONAL_VERIFY_CONFIRM_PATH,
  SERVICE_UNAVAILABLE_BODY,
  SESSION_MAX_AGE_SECONDS,
  checkProfessionalRegister,
  isProfessionalLinkToken,
  loginEmailOrNull,
  loginPasswordOrNull,
  normalizeClientIp,
  professionalSendRules,
  sessionCookieHeader,
  worstRetryAfter,
  type ProfessionalAuthPort,
  type ProfessionalSendLimitPort,
  type RateWindowDecision,
} from '@fastpro/domain';

/** Corpo maximo aceito por estas rotas (senha de 72 bytes cabe folgado). */
const CORPO_LIMITE = 4096;
const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } as const;

export interface ProfessionalRouteOptions {
  readonly port: ProfessionalAuthPort;
  /** Limites de envio por e-mail (intervalo e hora) e por IP do cadastro/reenvio (33 §2; CA-H016-09). */
  readonly limits: ProfessionalSendLimitPort;
  readonly clock: { nowMs(): number };
  /** Piso de tempo de resposta em ms (padrao: PROFESSIONAL_RESPONSE_FLOOR_MS). Zero so em teste. */
  readonly responseFloorMs?: number;
}

type Piso = () => Promise<void>;

/** Marca o inicio da requisicao; o piso espera o que faltar para o tempo minimo antes de responder. */
function iniciarPiso(opts: ProfessionalRouteOptions): Piso {
  const inicio = Date.now();
  const minimo = opts.responseFloorMs ?? PROFESSIONAL_RESPONSE_FLOOR_MS;
  return async () => {
    const falta = minimo - (Date.now() - inicio);
    if (falta > 0) await new Promise<void>((ok) => setTimeout(ok, falta));
  };
}

async function enviar(
  piso: Piso,
  res: ServerResponse,
  status: number,
  headers: Record<string, string>,
  body: unknown,
): Promise<void> {
  await piso();
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

/**
 * Cadastro e reenvio: 202 identico para e-mail novo e existente; 422 so por forma ou senha fraca.
 * Os limites de envio (e-mail e IP) valem antes de consultar a conta e dao 429 com Retry-After
 * igual para e-mail novo ou existente. Um pedido barrado nao registra envio.
 */
export async function handleProfessionalRegister(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProfessionalRouteOptions,
): Promise<void> {
  const piso = iniciarPiso(opts);
  const corpo = await lerJson(req);
  if (!corpo.ok) return enviar(piso, res, corpo.status, {}, undefined);
  const entrada = checkProfessionalRegister(corpo.value);
  if (!entrada.ok) {
    return enviar(piso, res, 422, {}, { code: 'campo_invalido', campo: entrada.campo, motivo: entrada.motivo });
  }
  const agora = opts.clock.nowMs();
  const regras = professionalSendRules(entrada.email, normalizeClientIp(req.socket.remoteAddress).value);
  let decisoes: RateWindowDecision[];
  try {
    decisoes = await Promise.all(regras.map((regra) => opts.limits.check(regra, agora)));
  } catch {
    return enviar(piso, res, 503, {}, SERVICE_UNAVAILABLE_BODY);
  }
  const espera = worstRetryAfter(decisoes);
  if (espera !== null) {
    return enviar(
      piso,
      res,
      429,
      { 'Retry-After': String(espera) },
      { code: 'muitos_pedidos', retry_after_seconds: espera },
    );
  }
  try {
    await Promise.all(regras.map((regra) => opts.limits.record(regra, agora)));
    await opts.port.register(entrada.email, entrada.password, agora);
  } catch {
    // Nunca 202 falso: a falha de infraestrutura nao pode parecer cadastro feito. A rota nao diz
    // se o e-mail existe; o adaptador ja trata o caso "existente" sem erro.
    return enviar(piso, res, 503, {}, SERVICE_UNAVAILABLE_BODY);
  }
  return enviar(piso, res, 202, {}, PROFESSIONAL_ACCEPTED_BODY);
}

/** Consumo do link (POST; o GET da pagina nao consome). 410 unico para qualquer link que nao sirva. */
export async function handleProfessionalVerifyConfirm(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProfessionalRouteOptions,
): Promise<void> {
  const corpo = await lerJson(req);
  if (!corpo.ok) return enviar(iniciarPiso({ ...opts, responseFloorMs: 0 }), res, corpo.status, {}, undefined);
  const token = (corpo.value as { token?: unknown } | null)?.token;
  if (!isProfessionalLinkToken(token)) {
    return enviar(iniciarPiso({ ...opts, responseFloorMs: 0 }), res, 410, {}, LINK_INVALID_BODY);
  }
  let ok: boolean;
  try {
    ok = await opts.port.confirmVerification(token, opts.clock.nowMs());
  } catch {
    return enviar(iniciarPiso({ ...opts, responseFloorMs: 0 }), res, 503, {}, SERVICE_UNAVAILABLE_BODY);
  }
  const piso = iniciarPiso({ ...opts, responseFloorMs: 0 });
  return ok ? enviar(piso, res, 204, {}, undefined) : enviar(piso, res, 410, {}, LINK_INVALID_BODY);
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
  const piso = iniciarPiso(opts);
  const corpo = await lerJson(req);
  if (!corpo.ok) return enviar(piso, res, corpo.status, {}, undefined);
  const dados = (corpo.value ?? {}) as { email?: unknown; password?: unknown };
  const email = loginEmailOrNull(dados.email);
  const password = loginPasswordOrNull(dados.password);
  if (email === null || password === null) return enviar(piso, res, 401, {}, INVALID_CREDENTIALS_BODY);

  const agora = opts.clock.nowMs();
  let portao: Awaited<ReturnType<ProfessionalAuthPort['loginGate']>>;
  try {
    portao = await opts.port.loginGate(email, agora);
  } catch {
    return enviar(piso, res, 503, {}, SERVICE_UNAVAILABLE_BODY);
  }
  if (portao.kind === 'bloqueada') {
    return enviar(piso, res, 429, { 'Retry-After': String(portao.retryAfterSeconds) }, LOGIN_BLOCKED_BODY);
  }

  let credencial: Awaited<ReturnType<ProfessionalAuthPort['verifyPassword']>>;
  try {
    credencial = await opts.port.verifyPassword(email, password);
  } catch {
    return enviar(piso, res, 503, {}, SERVICE_UNAVAILABLE_BODY);
  }
  if (credencial === null) return enviar(piso, res, 401, {}, INVALID_CREDENTIALS_BODY);
  if (!credencial.active) return enviar(piso, res, 403, {}, ACCOUNT_UNAVAILABLE_BODY);

  let sessao: Awaited<ReturnType<ProfessionalAuthPort['openSession']>>;
  try {
    await opts.port.loginSucceeded(email);
    sessao = await opts.port.openSession(credencial, agora);
  } catch {
    return enviar(piso, res, 503, {}, SERVICE_UNAVAILABLE_BODY);
  }
  return enviar(
    piso,
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
