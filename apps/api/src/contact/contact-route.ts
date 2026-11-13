// Issue 46 (H-033) | Rotas do telefone e do consentimento de contato (docs/factory/129-DESENHO-H033.md, §6, §9).
//   GET  /v1/requests/:id/contact              dono: estado do telefone e das liberacoes
//   GET  /v1/requests/:id/phone                dono: le o proprio telefone (republicacao)
//   PUT  /v1/requests/:id/phone                dono, autenticacao recente: troca ou apaga o telefone
//   POST /v1/requests/:id/contact/consents     dono, autenticacao recente: libera um profissional
//   POST /v1/requests/:id/contact/revoke       dono, autenticacao recente: revoga (geral ou individual)
//   GET  /v1/pro/requests/:id/contact          profissional: disponibilidade do botao
//   POST /v1/pro/requests/:id/phone/reveal     profissional: revela o telefone (limite de leituras no banco)
// Ordem fixa: rota reconhecida (metodo e caminho) -> origem (so mutacao) -> formato do id (mal formado = 404 uniforme)
// -> cookie de sessao (ausente = 401) -> sessao no banco (nula = 401) -> prova recente (quando exigida) -> corpo -> servico.
// Toda recusa de pedido sai com o MESMO 404 da leitura do pedido (Issue 45), nos mesmos cabecalhos. Sem CORS.
// Nenhum log de corpo, cookie, telefone ou id.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  STEP_UP_WINDOW_SECONDS,
  SESSION_COOKIE_NAME,
  checkDraftOrigin,
  cookieValue,
  siteOriginOf,
} from '@fastpro/domain';
import { hashSessionSecret } from '@fastpro/db';
import { PEDIDO_NAO_ENCONTRADO_BODY, UUID_RE } from '../requests/detail-service.js';
import {
  definirTelefone,
  estadoDoDono,
  liberarProfissional,
  revelarTelefone,
  revogarLiberacao,
  telefoneDisponivel,
  telefoneDoDono,
  type ContactOutcome,
  type ContactServiceDeps,
} from './contact-service.js';

/** Limite do corpo destas rotas (bem abaixo de 1 KB: os corpos sao minusculos). */
const CORPO_MAX_BYTES = 1024;

/** Cabecalhos iguais em toda resposta destas rotas (mesmos da leitura do pedido, Issue 45). */
const CABECALHOS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Type': 'application/json; charset=utf-8',
} as const;

const SESSAO_NECESSARIA_BODY = { code: 'sessao_necessaria' } as const;
const STEP_UP_BODY = { code: 'step_up_required' } as const;
const CORPO_INVALIDO_BODY = { code: 'corpo_invalido' } as const;
const CORPO_GRANDE_BODY = { code: 'corpo_grande' } as const;
const ORIGEM_INVALIDA_BODY = { code: 'origem_invalida' } as const;

export interface ContactRouteOptions {
  /** SITE_URL: a origem dela e a unica aceita nas mutacoes (mesma regra da publicacao). */
  readonly siteUrl: string;
  /** Sessao do cliente e do profissional (o papel vem da rota, nunca do corpo). */
  readonly sessions: {
    authenticate(hash: string, nowMs: number): Promise<{ readonly userId: string; readonly recentAuthAtMs: number | null } | null>;
  };
  /** Servico do contato (banco, cofre e relogio). */
  readonly service: ContactServiceDeps;
}

type Papel = 'dono' | 'profissional';
type Acao =
  | 'estado'
  | 'telefone_ler'
  | 'telefone_definir'
  | 'liberar'
  | 'revogar'
  | 'disponivel'
  | 'revelar';

interface RotaContato {
  readonly metodo: 'GET' | 'PUT' | 'POST';
  readonly padrao: RegExp;
  readonly papel: Papel;
  readonly acao: Acao;
  /** Exige prova de identidade recente (30 min) antes de qualquer efeito. */
  readonly autenticacaoRecente: boolean;
}

const ROTAS: readonly RotaContato[] = [
  { metodo: 'GET', padrao: /^\/v1\/requests\/([^/]+)\/contact$/, papel: 'dono', acao: 'estado', autenticacaoRecente: false },
  { metodo: 'GET', padrao: /^\/v1\/requests\/([^/]+)\/phone$/, papel: 'dono', acao: 'telefone_ler', autenticacaoRecente: false },
  { metodo: 'PUT', padrao: /^\/v1\/requests\/([^/]+)\/phone$/, papel: 'dono', acao: 'telefone_definir', autenticacaoRecente: true },
  { metodo: 'POST', padrao: /^\/v1\/requests\/([^/]+)\/contact\/consents$/, papel: 'dono', acao: 'liberar', autenticacaoRecente: true },
  { metodo: 'POST', padrao: /^\/v1\/requests\/([^/]+)\/contact\/revoke$/, papel: 'dono', acao: 'revogar', autenticacaoRecente: true },
  { metodo: 'GET', padrao: /^\/v1\/pro\/requests\/([^/]+)\/contact$/, papel: 'profissional', acao: 'disponivel', autenticacaoRecente: false },
  { metodo: 'POST', padrao: /^\/v1\/pro\/requests\/([^/]+)\/phone\/reveal$/, papel: 'profissional', acao: 'revelar', autenticacaoRecente: false },
];

/** Casa metodo e caminho com uma rota desta historia. Id mal formado ainda casa (vira 404 uniforme). */
export function contatoRota(metodo: string, path: string): { readonly rota: RotaContato; readonly id: string } | null {
  for (const rota of ROTAS) {
    const casou = rota.padrao.exec(path);
    if (casou === null) continue;
    if (rota.metodo !== metodo) return null;
    return { rota, id: casou[1] ?? '' };
  }
  return null;
}

export function isContactRoute(metodo: string, path: string): boolean {
  return contatoRota(metodo, path) !== null;
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

function enviar(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, CABECALHOS);
  res.end(JSON.stringify(body));
}

function enviarDesfecho(res: ServerResponse, desfecho: ContactOutcome): void {
  if (desfecho.status === 204) {
    res.writeHead(204, CABECALHOS);
    res.end();
    return;
  }
  enviar(res, desfecho.status, desfecho.body);
}

/** Le o corpo guardando no maximo o limite + 1 byte; o restante so e contado (413 sem reset). */
function lerCorpo(req: IncomingMessage, limite: number): Promise<{ readonly text: string; readonly bytes: number }> {
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

/** Objeto JSON com chaves de uma lista fechada. Vazio so quando a rota aceita corpo vazio. */
function objetoFechado(texto: string, chaves: readonly string[], vazioAceito: boolean): Record<string, unknown> | null {
  if (texto.trim() === '') return vazioAceito ? {} : null;
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto) as unknown;
  } catch {
    return null;
  }
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) return null;
  const campos = bruto as Record<string, unknown>;
  for (const chave of Object.keys(campos)) {
    if (!chaves.includes(chave)) return null;
  }
  return campos;
}

const UUID_CORPO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Corpo validado de cada acao com corpo. Corpo fora da lista fechada de chaves ou com tipo errado = invalido (422). */
function corpoDaAcao(acao: Acao, texto: string): { readonly ok: true; readonly valor: Record<string, unknown> } | { readonly ok: false } {
  if (acao === 'telefone_definir') {
    const c = objetoFechado(texto, ['phone'], false);
    if (c === null || !('phone' in c)) return { ok: false };
    if (c.phone !== null && typeof c.phone !== 'string') return { ok: false };
    return { ok: true, valor: c };
  }
  if (acao === 'liberar') {
    const c = objetoFechado(texto, ['professionalId'], false);
    if (c === null || typeof c.professionalId !== 'string' || !UUID_CORPO.test(c.professionalId)) return { ok: false };
    return { ok: true, valor: c };
  }
  // revogar: professionalId opcional (ausente = geral); corpo vazio aceito.
  const c = objetoFechado(texto, ['professionalId'], true);
  if (c === null) return { ok: false };
  if (c.professionalId !== undefined && (typeof c.professionalId !== 'string' || !UUID_CORPO.test(c.professionalId))) {
    return { ok: false };
  }
  return { ok: true, valor: c };
}

/** Prova de identidade recente: ultima prova dentro da janela de 30 min (mesma regra do step-up). */
function provaRecente(recentAuthAtMs: number | null, agora: number): boolean {
  return recentAuthAtMs !== null && agora - recentAuthAtMs <= STEP_UP_WINDOW_SECONDS * 1000;
}

export async function handleContactRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  opts: ContactRouteOptions,
): Promise<void> {
  try {
    const metodo = req.method ?? '';
    const casado = contatoRota(metodo, path);
    if (casado === null) return enviar(res, 404, PEDIDO_NAO_ENCONTRADO_BODY);
    const { rota, id } = casado;

    if (metodo !== 'GET') {
      const origem = checkDraftOrigin(
        { origin: cabecalho(req.headers.origin), secFetchSite: cabecalho(req.headers['sec-fetch-site']) },
        siteOriginOf(opts.siteUrl),
        true,
      );
      if (!origem.ok) return enviar(res, 403, ORIGEM_INVALIDA_BODY);
    }
    if (!UUID_CORPO.test(id)) return enviar(res, 404, PEDIDO_NAO_ENCONTRADO_BODY);

    const segredo = cookieValue(cabecalho(req.headers.cookie), SESSION_COOKIE_NAME);
    if (segredo === undefined) return enviar(res, 401, SESSAO_NECESSARIA_BODY);
    const agora = opts.service.clock.nowMs();
    const sessao = await opts.sessions.authenticate(hashSessionSecret(segredo), agora);
    if (sessao === null) return enviar(res, 401, SESSAO_NECESSARIA_BODY);

    if (rota.autenticacaoRecente && !provaRecente(sessao.recentAuthAtMs, agora)) {
      return enviar(res, 401, STEP_UP_BODY);
    }

    let corpo: Record<string, unknown> = {};
    if (metodo !== 'GET' && rota.acao !== 'revelar') {
      const lido = await lerCorpo(req, CORPO_MAX_BYTES);
      if (lido.bytes > CORPO_MAX_BYTES) return enviar(res, 413, CORPO_GRANDE_BODY);
      const valido = corpoDaAcao(rota.acao, lido.text);
      if (!valido.ok) return enviar(res, 422, CORPO_INVALIDO_BODY);
      corpo = valido.valor;
    }

    const usuario = sessao.userId;
    switch (rota.acao) {
      case 'estado':
        return enviarDesfecho(res, await estadoDoDono(usuario, id, opts.service));
      case 'telefone_ler':
        return enviarDesfecho(res, await telefoneDoDono(usuario, id, opts.service));
      case 'telefone_definir':
        return enviarDesfecho(res, await definirTelefone(usuario, id, corpo.phone as string | null, opts.service));
      case 'liberar':
        return enviarDesfecho(res, await liberarProfissional(usuario, id, corpo.professionalId as string, opts.service));
      case 'revogar':
        return enviarDesfecho(
          res,
          await revogarLiberacao(usuario, id, (corpo.professionalId as string | undefined) ?? null, opts.service),
        );
      case 'disponivel':
        return enviarDesfecho(res, await telefoneDisponivel(usuario, id, opts.service));
      case 'revelar':
        return enviarDesfecho(res, await revelarTelefone(usuario, id, opts.service));
    }
  } catch {
    // Falha nossa vira 503 fixo: sem detalhe de banco, de cifra ou de sessao na resposta nem no registro.
    if (!res.headersSent) enviar(res, 503, { code: 'indisponivel' });
  }
}
