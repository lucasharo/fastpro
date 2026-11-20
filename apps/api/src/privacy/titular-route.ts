// Issue 120 (H-111) | Rotas do titular para direitos (147-DESENHO-H111 §5.1):
//   POST /v1/privacy/dsr-requests                 abre acesso, correcao ou eliminacao (Idempotency-Key obrigatorio)
//   GET  /v1/privacy/dsr-requests                 lista os proprios casos (cursor e limit)
//   GET  /v1/privacy/dsr-requests/:id             detalhe do proprio caso; outro titular ou inexistente = 404 identico
//   POST /v1/privacy/dsr-requests/:id/cancel      cancela so enquanto aberto
// Ordem fixa: caminho/metodo (404 uniforme) -> cookie de sessao (ausente = 401) -> sessao no banco (nula = 401)
// -> cabecalho Idempotency-Key -> corpo (limite de 4 KB, chaves exatas) -> servico. Sem CORS. Sem log de corpo.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SESSION_COOKIE_NAME, cookieValue } from '@fastpro/domain';
import {
  DsrDownloadRecusado,
  DsrExtratoIntegridadeFalha,
  hashSessionSecret,
  type DsrStepUpConfirmacao,
  type DsrStepUpEmissao,
  type ServicoDownloadExtrato,
  type ServicoDsrStepUp,
} from '@fastpro/db';
import { lerCorpoLimitado } from '../corpo-limitado.js';
import { DSR_KINDS_TITULAR, DsrTitularErro, type EntradaAbertura, type ServicoDsrTitular } from './titular-service.js';

export const PRIVACY_TITULAR_PATH = '/v1/privacy/dsr-requests' as const;
/** Step-up do titular (147 §5.1): POST /v1/privacy/step-up e /step-up/confirm (P-A). */
export const PRIVACY_STEPUP_PATH = '/v1/privacy/step-up' as const;
/** Download do extrato por token de uso unico (147 D-A6): GET /v1/privacy/dsr-downloads/:token. */
export const PRIVACY_DOWNLOAD_PATH = '/v1/privacy/dsr-downloads' as const;
const TOKEN_DOWNLOAD_RE = /^[A-Za-z0-9_-]{43}$/;

const CORPO_LIMITE_BYTES = 4096;
const CHAVE_IDEMPOTENCIA_RE = /^[\x21-\x7e]{8,128}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHAVES_CORPO = ['kind', 'details', 'step_up_token'] as const;

const CABECALHOS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Type': 'application/json; charset=utf-8',
} as const;

const NAO_ENCONTRADO_BODY = { code: 'nao_encontrado' } as const;
const SESSAO_NECESSARIA_BODY = { code: 'sessao_necessaria' } as const;
const LEITURA_INDISPONIVEL_BODY = { code: 'leitura_indisponivel' } as const;

export interface PrivacyTitularRouteOptions {
  /** Sessao do titular (mesmo cookie das demais rotas). O sujeito sai daqui, nunca do corpo. */
  readonly sessions: { authenticate(hash: string, nowMs: number): Promise<{ readonly userId: string } | null> };
  readonly service: ServicoDsrTitular;
  readonly relogio: { nowMs(): number };
  /** Step-up do titular (P-A). Sem esta opcao, as rotas de step-up respondem 404 uniforme. */
  readonly stepUp?: Pick<ServicoDsrStepUp, 'emitir' | 'confirmar'>;
  /** Download do extrato (P-A). Sem esta opcao, a rota de download responde 404 uniforme. */
  readonly download?: Pick<ServicoDownloadExtrato, 'baixar'>;
}

export type RotaTitular =
  | { readonly acao: 'colecao' }
  | { readonly acao: 'stepup' }
  | { readonly acao: 'stepup_confirmar' }
  | { readonly acao: 'download'; readonly token: string }
  | { readonly acao: 'detalhe' | 'cancelar'; readonly id: string };

/** Interpreta o caminho. Forma desconhecida devolve null (404 uniforme). Id mal formado ainda casa e vira 404. */
export function privacyTitularRoute(path: string): RotaTitular | null {
  if (path === PRIVACY_TITULAR_PATH) return { acao: 'colecao' };
  if (path === PRIVACY_STEPUP_PATH) return { acao: 'stepup' };
  if (path === `${PRIVACY_STEPUP_PATH}/confirm`) return { acao: 'stepup_confirmar' };
  if (path.startsWith(`${PRIVACY_DOWNLOAD_PATH}/`)) {
    const token = path.slice(PRIVACY_DOWNLOAD_PATH.length + 1);
    return token === '' || token.includes('/') ? null : { acao: 'download', token };
  }
  if (!path.startsWith(`${PRIVACY_TITULAR_PATH}/`)) return null;
  const resto = path.slice(PRIVACY_TITULAR_PATH.length + 1);
  const [primeira = '', segunda, terceira] = resto.split('/');
  if (terceira !== undefined || primeira === '') return null;
  if (segunda === undefined) return { acao: 'detalhe', id: primeira };
  if (segunda === 'cancel') return { acao: 'cancelar', id: primeira };
  return null;
}

export function isPrivacyTitularRoute(path: string): boolean {
  return (
    path === PRIVACY_TITULAR_PATH ||
    path.startsWith(`${PRIVACY_TITULAR_PATH}/`) ||
    path === PRIVACY_STEPUP_PATH ||
    path.startsWith(`${PRIVACY_STEPUP_PATH}/`) ||
    path.startsWith(`${PRIVACY_DOWNLOAD_PATH}/`)
  );
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

function enviar(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, CABECALHOS);
  res.end(JSON.stringify(body));
}

/** Valida o corpo de abertura. Chaves fora da lista ou tipos errados recusam (422). */
export function validarCorpoAbertura(json: unknown): EntradaAbertura | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
  const objeto = json as Record<string, unknown>;
  if (!Object.keys(objeto).every((c) => (CHAVES_CORPO as readonly string[]).includes(c))) return null;
  const kind = objeto.kind;
  if (typeof kind !== 'string' || !(DSR_KINDS_TITULAR as readonly string[]).includes(kind)) return null;
  const detalhes = objeto.details ?? {};
  if (typeof detalhes !== 'object' || detalhes === null || Array.isArray(detalhes)) return null;
  const token = objeto.step_up_token;
  if (token !== undefined && (typeof token !== 'string' || token.length < 16 || token.length > 256)) return null;
  // Acesso e eliminacao exigem step-up: a rota recusa sem token (403) e a funcao SQL confere o hash.
  return { kind, detalhes: detalhes as Record<string, unknown>, stepUpToken: (token as string | undefined) ?? null };
}

function listagemDoQuery(url: string | undefined): { limite: number; cursor: { abertura: string; id: string } | null } | null {
  const params = new URL(url ?? '/', 'http://localhost').searchParams;
  const bruto = params.get('limit');
  const limite = bruto === null ? 20 : Number(bruto);
  if (!Number.isInteger(limite) || limite < 1 || limite > 50) return null;
  const abertura = params.get('cursor_abertura');
  const id = params.get('cursor_id');
  if ((abertura === null) !== (id === null)) return null;
  if (abertura === null || id === null) return { limite, cursor: null };
  if (Number.isNaN(Date.parse(abertura)) || !UUID_RE.test(id)) return null;
  return { limite, cursor: { abertura, id } };
}

export async function handlePrivacyTitularRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  opts: PrivacyTitularRouteOptions,
): Promise<void> {
  try {
    const rota = privacyTitularRoute(path);
    if (rota === null) return enviar(res, 404, NAO_ENCONTRADO_BODY);
    const segredo = cookieValue(cabecalho(req.headers.cookie), SESSION_COOKIE_NAME);
    if (segredo === undefined) return enviar(res, 401, SESSAO_NECESSARIA_BODY);
    const sessao = await opts.sessions.authenticate(hashSessionSecret(segredo), opts.relogio.nowMs());
    if (sessao === null) return enviar(res, 401, SESSAO_NECESSARIA_BODY);
    const sujeito = sessao.userId;

    if (rota.acao === 'stepup' || rota.acao === 'stepup_confirmar') {
      return await stepUpRota(req, res, sujeito, rota.acao, opts);
    }
    if (rota.acao === 'download') return await baixarExtrato(req, res, sujeito, rota.token, opts);

    if (rota.acao === 'colecao') {
      if (req.method === 'POST') return await criar(req, res, sujeito, opts);
      if (req.method === 'GET') {
        const lista = listagemDoQuery(req.url);
        if (lista === null) return enviar(res, 422, { code: 'paginacao_invalida' });
        const r = await opts.service.listar(sujeito, lista.limite, lista.cursor);
        return enviar(res, r.status, r.corpo);
      }
      return enviar(res, 404, NAO_ENCONTRADO_BODY);
    }

    if (!UUID_RE.test(rota.id)) return enviar(res, 404, NAO_ENCONTRADO_BODY);
    if (rota.acao === 'detalhe' && req.method === 'GET') {
      const r = await opts.service.obter(sujeito, rota.id);
      return enviar(res, r.status, r.corpo);
    }
    if (rota.acao === 'cancelar' && req.method === 'POST') {
      const chave = cabecalho(req.headers['idempotency-key']);
      if (chave === undefined || !CHAVE_IDEMPOTENCIA_RE.test(chave)) return enviar(res, 422, { code: 'chave_invalida' });
      const r = await opts.service.cancelar(sujeito, rota.id);
      return enviar(res, r.status, r.corpo);
    }
    return enviar(res, 404, NAO_ENCONTRADO_BODY);
  } catch (erro) {
    if (erro instanceof DsrTitularErro) return enviar(res, erro.status, erro.corpo);
    // Falha nossa vira 503 fixo: sem detalhe de banco, de sessao ou de corpo na resposta nem no registro.
    if (!res.headersSent) enviar(res, 503, LEITURA_INDISPONIVEL_BODY);
  }
}

async function criar(
  req: IncomingMessage,
  res: ServerResponse,
  sujeito: string,
  opts: PrivacyTitularRouteOptions,
): Promise<void> {
  const chave = cabecalho(req.headers['idempotency-key']);
  if (chave === undefined || !CHAVE_IDEMPOTENCIA_RE.test(chave)) return enviar(res, 422, { code: 'chave_invalida' });
  const corpo = await lerCorpoLimitado(req, CORPO_LIMITE_BYTES);
  if (corpo.excedeu) return enviar(res, 422, { code: 'corpo_invalido' });
  let json: unknown;
  try {
    json = JSON.parse(corpo.text);
  } catch {
    return enviar(res, 422, { code: 'corpo_invalido' });
  }
  const entrada = validarCorpoAbertura(json);
  if (entrada === null) return enviar(res, 422, { code: 'corpo_invalido' });
  if (entrada.stepUpToken === null && (entrada.kind === 'acesso' || entrada.kind === 'eliminacao')) {
    return enviar(res, 403, { code: 'step_up_obrigatorio' });
  }
  const r = await opts.service.abrir(sujeito, entrada, chave);
  return enviar(res, r.status, r.corpo);
}

/** Corpo do step-up: vazio ou {purpose:"dsr_open"}. Qualquer outra chave ou valor recusa (422). */
function validarCorpoStepUp(json: unknown): boolean {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return false;
  const objeto = json as Record<string, unknown>;
  if (!Object.keys(objeto).every((c) => c === 'purpose')) return false;
  return objeto.purpose === undefined || objeto.purpose === 'dsr_open';
}

/** POST /v1/privacy/step-up (emite o codigo; 202 igual exista ou nao envio) e /step-up/confirm (troca por token). */
async function stepUpRota(
  req: IncomingMessage,
  res: ServerResponse,
  sujeito: string,
  acao: 'stepup' | 'stepup_confirmar',
  opts: PrivacyTitularRouteOptions,
): Promise<void> {
  if (opts.stepUp === undefined || req.method !== 'POST') return enviar(res, 404, NAO_ENCONTRADO_BODY);
  const chave = cabecalho(req.headers['idempotency-key']);
  if (chave === undefined || !CHAVE_IDEMPOTENCIA_RE.test(chave)) return enviar(res, 422, { code: 'chave_invalida' });
  const corpo = await lerCorpoLimitado(req, CORPO_LIMITE_BYTES);
  if (corpo.excedeu) return enviar(res, 422, { code: 'corpo_invalido' });
  let json: unknown = {};
  if (corpo.text.trim() !== '') {
    try {
      json = JSON.parse(corpo.text);
    } catch {
      return enviar(res, 422, { code: 'corpo_invalido' });
    }
  }

  if (acao === 'stepup') {
    if (!validarCorpoStepUp(json)) return enviar(res, 422, { code: 'corpo_invalido' });
    const r: DsrStepUpEmissao = await opts.stepUp.emitir(sujeito);
    if (r.resultado === 'criado' || r.resultado === 'negado') return enviar(res, 202, {});
    return enviar(res, 429, {
      code: r.resultado === 'limite' ? 'step_up_limite' : 'step_up_bloqueado',
      retry_after: r.retryAfter,
    });
  }

  const objeto = (typeof json === 'object' && json !== null ? json : {}) as Record<string, unknown>;
  if (!Object.keys(objeto).every((c) => c === 'code') || typeof objeto.code !== 'string') {
    return enviar(res, 400, { code: 'codigo_invalido' });
  }
  const r: DsrStepUpConfirmacao = await opts.stepUp.confirmar(sujeito, objeto.code);
  if (r.resultado === 'ok') return enviar(res, 200, { step_up_token: r.token, expires_at: r.expiresAt });
  if (r.resultado === 'bloqueado') return enviar(res, 429, { code: 'step_up_bloqueado', retry_after: r.retryAfter });
  return enviar(res, 400, { code: 'codigo_invalido' });
}

/** GET /v1/privacy/dsr-downloads/:token: consome o token de uso unico e devolve o extrato ao proprio titular. */
async function baixarExtrato(
  req: IncomingMessage,
  res: ServerResponse,
  sujeito: string,
  token: string,
  opts: PrivacyTitularRouteOptions,
): Promise<void> {
  if (opts.download === undefined || req.method !== 'GET' || !TOKEN_DOWNLOAD_RE.test(token)) {
    return enviar(res, 404, NAO_ENCONTRADO_BODY);
  }
  let r: Awaited<ReturnType<Pick<ServicoDownloadExtrato, 'baixar'>['baixar']>>;
  try {
    r = await opts.download.baixar(token);
  } catch (erro) {
    if (erro instanceof DsrDownloadRecusado) return enviar(res, 404, NAO_ENCONTRADO_BODY);
    if (erro instanceof DsrExtratoIntegridadeFalha) return enviar(res, 503, LEITURA_INDISPONIVEL_BODY);
    throw erro;
  }
  // Token de outro titular: a resposta e a mesma de token inexistente (o token ja foi consumido).
  if (r.subjectUserId !== sujeito) return enviar(res, 404, NAO_ENCONTRADO_BODY);
  res.writeHead(200, {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': 'attachment; filename="fastpro-dsr-extrato.json"',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(Buffer.from(r.conteudo));
}
