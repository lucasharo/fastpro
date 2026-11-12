// H-035 | Cadastro e leitura do documento do perfil profissional (docs/factory/75-DESENHO-H035.md §2, §3;
// CA-05, CA-07, CA-10, CA-11).
//   PUT /v1/professional/profile  201 {status:"received", verification:"pending"} para cadastro novo e para
//                                 duplicidade (mesmo corpo; a duplicidade vira retida_duplicidade sem aviso);
//                                 200 {status:"ja_cadastrado"} no reenvio; 422 por campo; 401; 403; 415; 413; 400; 503.
//   GET /v1/professional/profile  200 {publicName, slug, documentType, verification}. Nunca traz o numero,
//                                 document_enc nem document_hmac.
// Ordem: Origin/Sec-Fetch-Site, corpo (tipo e teto de 4 KB), sessao, perfil, regra. Toda resposta espera o piso
// de tempo (PROFESSIONAL_RESPONSE_FLOOR_MS), para sucesso e duplicidade levarem o mesmo tempo. Sem log do corpo.
// A persistencia fica na porta (adaptador em @fastpro/db, ainda nao escrito).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { hashSessionSecret } from '@fastpro/db';
import {
  PROFESSIONAL_RESPONSE_FLOOR_MS,
  SESSION_COOKIE_NAME,
  checkProfessionalProfileInput,
  cookieValue,
  siteOriginOf,
  slugBaseFromName,
  type ProfessionalDocumentType,
  type SessionRecord,
  type SessionRepositoryPort,
} from '@fastpro/domain';
import type { ProfessionalDocumentSecrets } from './professional-document-crypto.js';

export const PROFESSIONAL_PROFILE_PATH = '/v1/professional/profile';

/** Corpo maximo aceito pela rota (igual a H-016). */
const CORPO_LIMITE = 4096;
const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } as const;

export type ProfessionalVerificationStatus =
  | 'pendente'
  | 'em_revisao'
  | 'aprovada'
  | 'retida_duplicidade'
  | 'recusada'
  | 'suspensa';

/** Leitura do perfil da sessao, sem dado sensivel. */
export interface ProfessionalProfileRecord {
  /** Conta com e-mail verificado (D3: exigido para cadastrar documento). */
  readonly emailVerified: boolean;
  readonly publicName: string | null;
  readonly slug: string | null;
  readonly documentType: ProfessionalDocumentType | null;
  readonly verificationStatus: ProfessionalVerificationStatus;
}

/** Documento ja cifrado e com HMAC: a porta nunca recebe o numero em claro. */
export interface NovoDocumentoProfissional {
  readonly userId: string;
  readonly publicName: string;
  readonly slug: string;
  readonly documentType: ProfessionalDocumentType;
  readonly documentEnc: Buffer;
  readonly documentHmac: string;
  readonly nowMs: number;
}

/**
 * pendente: gravado e em fila de verificacao. retida_duplicidade: o HMAC ja existe em outro perfil nao
 * recusado (R2). ja_cadastrado: o perfil ja tinha documento (idempotencia, CA-11).
 */
export type ProfessionalDocumentOutcome = 'pendente' | 'retida_duplicidade' | 'ja_cadastrado';

export interface ProfessionalProfilePort {
  /** Perfil da conta da sessao; nulo quando a conta nao e profissional. */
  find(userId: string): Promise<ProfessionalProfileRecord | null>;
  /** Grava o documento uma unica vez. Nunca devolve dados do outro perfil. */
  setDocument(novo: NovoDocumentoProfissional): Promise<ProfessionalDocumentOutcome>;
}

export interface ProfessionalProfileRouteOptions {
  readonly sessions: SessionRepositoryPort;
  readonly profiles: ProfessionalProfilePort;
  readonly secrets: ProfessionalDocumentSecrets;
  /** SITE_URL: a origem dela e a unica aceita em Origin no PUT. */
  readonly siteUrl: string;
  readonly clock: { nowMs(): number };
  /** Piso de tempo em ms (padrao: PROFESSIONAL_RESPONSE_FLOOR_MS). Zero so em teste. */
  readonly responseFloorMs?: number;
}

type Piso = () => Promise<void>;

function iniciarPiso(opts: ProfessionalProfileRouteOptions): Piso {
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
  body: unknown,
): Promise<void> {
  await piso();
  const texto = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    ...NO_STORE,
    ...(texto === '' ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
  });
  res.end(texto);
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

/** Origin e Sec-Fetch-Site (mesma regra de session-route). */
function origemValida(req: IncomingMessage, siteOrigin: string): boolean {
  const origin = cabecalho(req.headers.origin);
  const fetchSite = cabecalho(req.headers['sec-fetch-site']);
  if (origin !== siteOrigin) return false;
  return fetchSite === undefined || fetchSite === 'same-origin';
}

type Corpo =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly status: 400 | 413 | 415 };

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

/** Sessao do pedido: le so o cookie __Host-fp_sess e confere no banco a cada requisicao (52 §2). */
async function sessaoDoPedido(
  req: IncomingMessage,
  opts: ProfessionalProfileRouteOptions,
): Promise<SessionRecord | null> {
  const segredo = cookieValue(cabecalho(req.headers.cookie), SESSION_COOKIE_NAME);
  if (segredo === undefined) return null;
  return opts.sessions.authenticate(hashSessionSecret(segredo), opts.clock.nowMs());
}

/** Estado publico: revisao e duplicidade aparecem como pendente (desenho §3). */
function verificacaoPublica(status: ProfessionalVerificationStatus): 'pending' | 'approved' | 'rejected' | 'suspended' {
  if (status === 'aprovada') return 'approved';
  if (status === 'recusada') return 'rejected';
  if (status === 'suspensa') return 'suspended';
  return 'pending';
}

/** PUT: cadastra o documento uma vez. Sucesso e duplicidade respondem igual (R3). */
export async function handleProfessionalProfilePut(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProfessionalProfileRouteOptions,
): Promise<void> {
  const piso = iniciarPiso(opts);
  if (!origemValida(req, siteOriginOf(opts.siteUrl))) {
    return enviar(piso, res, 403, { code: 'origem_invalida' });
  }
  const corpo = await lerJson(req);
  if (!corpo.ok) {
    const code = corpo.status === 415 ? 'tipo_invalido' : corpo.status === 413 ? 'corpo_grande' : 'json_invalido';
    return enviar(piso, res, corpo.status, { code });
  }

  let sessao: SessionRecord | null;
  try {
    sessao = await sessaoDoPedido(req, opts);
  } catch {
    return enviar(piso, res, 503, { code: 'servico_indisponivel' });
  }
  if (sessao === null) return enviar(piso, res, 401, { code: 'nao_autenticado' });

  let perfil: ProfessionalProfileRecord | null;
  try {
    perfil = await opts.profiles.find(sessao.userId);
  } catch {
    return enviar(piso, res, 503, { code: 'servico_indisponivel' });
  }
  if (perfil === null) return enviar(piso, res, 403, { code: 'perfil_indisponivel' });
  if (!perfil.emailVerified) return enviar(piso, res, 403, { code: 'email_nao_verificado' });

  const entrada = checkProfessionalProfileInput(corpo.value);
  if (!entrada.ok) {
    return enviar(piso, res, 422, {
      code: 'invalid_field',
      fields: entrada.fields.map((f) => ({ field: f.field, reason: f.reason })),
    });
  }

  if (perfil.documentType !== null) return enviar(piso, res, 200, { status: 'ja_cadastrado' });

  let documentEnc: Buffer;
  let documentHmac: string;
  try {
    documentEnc = opts.secrets.encrypt(sessao.userId, entrada.value.digits);
    documentHmac = opts.secrets.hmac(entrada.value.documentType, entrada.value.digits);
  } catch {
    return enviar(piso, res, 503, { code: 'servico_indisponivel' });
  }

  let resultado: ProfessionalDocumentOutcome;
  try {
    resultado = await opts.profiles.setDocument({
      userId: sessao.userId,
      publicName: entrada.value.publicName,
      slug: slugBaseFromName(entrada.value.publicName),
      documentType: entrada.value.documentType,
      documentEnc,
      documentHmac,
      nowMs: opts.clock.nowMs(),
    });
  } catch {
    return enviar(piso, res, 503, { code: 'servico_indisponivel' });
  }

  if (resultado === 'ja_cadastrado') return enviar(piso, res, 200, { status: 'ja_cadastrado' });
  return enviar(piso, res, 201, { status: 'received', verification: 'pending' });
}

/** GET: so dados publicos do proprio perfil. Nunca numero, document_enc ou document_hmac. */
export async function handleProfessionalProfileGet(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProfessionalProfileRouteOptions,
): Promise<void> {
  const piso = iniciarPiso(opts);
  let sessao: SessionRecord | null;
  try {
    sessao = await sessaoDoPedido(req, opts);
  } catch {
    return enviar(piso, res, 503, { code: 'servico_indisponivel' });
  }
  if (sessao === null) return enviar(piso, res, 401, { code: 'nao_autenticado' });

  let perfil: ProfessionalProfileRecord | null;
  try {
    perfil = await opts.profiles.find(sessao.userId);
  } catch {
    return enviar(piso, res, 503, { code: 'servico_indisponivel' });
  }
  if (perfil === null) return enviar(piso, res, 403, { code: 'perfil_indisponivel' });

  const cadastrado = perfil.documentType !== null;
  return enviar(piso, res, 200, {
    publicName: perfil.publicName,
    slug: perfil.slug,
    documentType: perfil.documentType,
    verification: cadastrado ? verificacaoPublica(perfil.verificationStatus) : null,
  });
}
