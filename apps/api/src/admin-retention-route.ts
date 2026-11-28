// H-109 (Issue 118) | Rotas /v1/admin/retention/* (docs/factory/82-DESENHO-H109.md §5; CA-H109-02 e 03).
// Ordem: rota inexistente (404) -> cookie sem sessao (404, sem banco) -> guarda no banco (sessao e papel ativos)
// -> Origin das mutacoes (403) -> permissao da rota: SEM permissao = 404 identico ao de rota inexistente
// -> corpo JSON limitado -> manipulador (decisao pura do dominio e funcao do banco). Falha inesperada = 503 sem detalhe.
// Politica e hold so mudam por funcoes do banco com aprovacao dupla; aqui nada e decidido sem o banco.
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ADMIN_NOT_FOUND,
  ADMIN_SESSION_COOKIE,
  MENSAGEM_POLITICA,
  RetentionAdminError,
  adminReply,
  checkAdminMutation,
  cookieValue,
  decideAdminGuard,
  decidirPolitica,
  interpretarHold,
  interpretarMudancaPolitica,
  statusDoErroRetencao,
  type AdminGuardRecord,
  type AdminResponse,
  type RetentionAdminPort,
} from '@fastpro/domain';

export const RETENTION_BASE_PATH = '/v1/admin/retention';
/** Corpo pequeno: maior que o limite vira corpo ausente (o manipulador recusa o que precisa). */
export const RETENTION_BODY_LIMIT_BYTES = 4096;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Nome = 'proposta' | 'aplicar' | 'votar' | 'colocar_hold' | 'pedir_liberacao' | 'liberar';

interface RotaRetencao {
  readonly nome: Nome;
  readonly re: RegExp;
  /** Qualquer uma destas permissoes libera a rota; nenhuma = 404. */
  readonly permissoes: readonly string[];
}

const POLITICA = 'retention.policy.manage';
const HOLD = 'retention.hold.manage';

/** Rotas deste desenho. Todas POST. Fora daqui = 404. */
export const ROTAS_RETENCAO: readonly RotaRetencao[] = [
  { nome: 'proposta', re: /^\/v1\/admin\/retention\/policy-changes$/, permissoes: [POLITICA] },
  { nome: 'aplicar', re: /^\/v1\/admin\/retention\/policy-changes\/([^/]+)\/apply$/, permissoes: [POLITICA] },
  { nome: 'votar', re: /^\/v1\/admin\/retention\/approvals\/([^/]+)\/votes$/, permissoes: [POLITICA, HOLD] },
  { nome: 'colocar_hold', re: /^\/v1\/admin\/retention\/holds$/, permissoes: [HOLD] },
  { nome: 'pedir_liberacao', re: /^\/v1\/admin\/retention\/holds\/([^/]+)\/release-requests$/, permissoes: [HOLD] },
  { nome: 'liberar', re: /^\/v1\/admin\/retention\/holds\/([^/]+)\/release$/, permissoes: [HOLD] },
];

export interface AdminRetentionRouteOptions {
  /** Guarda do banco para o segredo do cookie (AdminRepository.guard). Nulo = sem sessao valida. */
  readonly guard: (secret: string, nowMs: number) => Promise<AdminGuardRecord | null>;
  /** Porta do cadastro (PgRetentionAdmin em producao; memoria nos testes). */
  readonly port: RetentionAdminPort;
  /** ADMIN_BASE_URL: a unica Origin aceita em mutacoes. */
  readonly baseUrl: string;
  readonly clock: { nowMs(): number };
  /** Gerador do id da mudanca (UUID). Injetavel para teste. */
  readonly novoId?: () => string;
}

export interface RotaCasada {
  readonly rota: RotaRetencao;
  readonly params: readonly string[];
}

/** Casa metodo e caminho com as rotas. Sem casamento = null (404). */
export function casarRotaRetencao(method: string | undefined, path: string): RotaCasada | null {
  if (method !== 'POST') return null;
  for (const rota of ROTAS_RETENCAO) {
    const m = rota.re.exec(path);
    if (m) return { rota, params: m.slice(1) };
  }
  return null;
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

function enviar(res: ServerResponse, resposta: AdminResponse): void {
  if (resposta.status === 404) {
    res.writeHead(404, NO_STORE);
    res.end();
    return;
  }
  res.writeHead(resposta.status, { ...resposta.headers, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(resposta.body));
}

function lerCorpo(req: IncomingMessage, limite: number): Promise<{ text: string; bytes: number }> {
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

/** Erro do banco vira status e codigo fixos; qualquer outro vira 503 sem detalhe. */
function respostaDeErro(err: unknown): AdminResponse {
  if (err instanceof RetentionAdminError) {
    const s = statusDoErroRetencao(err.code);
    if (s.status === 404) return ADMIN_NOT_FOUND;
    return adminReply(s.status, { code: s.code });
  }
  return adminReply(503, { code: 'retencao_indisponivel' });
}

/** Manipuladores: cada um recebe o ator da sessao e o corpo ja lido. */
async function executar(
  nome: Nome,
  params: readonly string[],
  corpo: unknown,
  ator: string,
  opts: AdminRetentionRouteOptions,
  nowMs: number,
): Promise<AdminResponse> {
  const port = opts.port;
  if (nome === 'proposta') {
    const forma = interpretarMudancaPolitica(corpo);
    if (!forma.ok) return adminReply(400, { code: forma.code });
    const mudanca = forma.valor;
    const atual = await port.lerPolitica(mudanca.dataClass);
    if (atual === null) return adminReply(422, { code: 'classe_invalida' });
    const decisao = decidirPolitica({
      dataClass: mudanca.dataClass,
      periodSeconds: mudanca.periodSeconds,
      action: mudanca.action,
      legalBasisRef: mudanca.legalBasisRef,
      effectiveFrom: mudanca.effectiveFrom,
      enabled: mudanca.enabled,
      dryRun: mudanca.dryRun,
      simulacaoRegistrada: atual.simulacaoRegistrada,
    });
    if (!decisao.ok) {
      // Negacao auditada na propria operacao (CA-H109-02). Se a auditoria falhar, o erro segue para 503.
      await port.registrarNegacaoPolitica(ator, mudanca.dataClass, decisao.motivo, nowMs);
      return adminReply(422, { code: decisao.motivo, mensagem: MENSAGEM_POLITICA[decisao.motivo] });
    }
    const changeId = (opts.novoId ?? randomUUID)();
    const { approvalRequestId } = await port.proporPolitica(ator, mudanca, atual.id, changeId, nowMs);
    return adminReply(201, { changeId, approvalRequestId, estado: 'pendente' });
  }
  if (nome === 'aplicar') {
    await port.aplicarPolitica(ator, params[0] ?? '', nowMs);
    return adminReply(200, { estado: 'aplicada' });
  }
  if (nome === 'votar') {
    const estado = await port.votar(params[0] ?? '', ator, nowMs);
    return adminReply(200, { estado });
  }
  if (nome === 'colocar_hold') {
    const forma = interpretarHold(corpo);
    if (!forma.ok) return adminReply(400, { code: forma.code });
    const { holdId } = await port.colocarHold(ator, forma.valor, nowMs);
    return adminReply(201, { holdId, estado: 'ativo' });
  }
  if (nome === 'pedir_liberacao') {
    const { approvalRequestId } = await port.proporLiberacaoHold(ator, params[0] ?? '', nowMs);
    return adminReply(202, { approvalRequestId, estado: 'pendente' });
  }
  // liberar: o corpo traz o pedido aprovado (approvalRequestId)
  const pedido = typeof corpo === 'object' && corpo !== null ? (corpo as Record<string, unknown>).approvalRequestId : undefined;
  if (typeof pedido !== 'string' || !UUID_RE.test(pedido)) return adminReply(400, { code: 'corpo_invalido' });
  await port.liberarHold(ator, params[0] ?? '', pedido, nowMs);
  return adminReply(200, { estado: 'liberado' });
}

/** Rotas /v1/admin/retention/* (H-109). Sem esta opcao na composicao, as rotas nao existem (404). */
export async function handleAdminRetentionRoute(
  req: IncomingMessage,
  res: ServerResponse,
  opts: AdminRetentionRouteOptions,
  path: string,
): Promise<void> {
  try {
    const nowMs = opts.clock.nowMs();
    const casada = casarRotaRetencao(req.method, path);
    if (casada === null) return enviar(res, ADMIN_NOT_FOUND);

    const secret = cookieValue(cabecalho(req.headers.cookie), ADMIN_SESSION_COOKIE) ?? null;
    if (secret === null) return enviar(res, ADMIN_NOT_FOUND);

    const row = await opts.guard(secret, nowMs);
    const sessao = decideAdminGuard(row, 'sessao', nowMs);
    if (sessao.kind === 'recusada') return enviar(res, sessao.response);
    if (row === null) return enviar(res, ADMIN_NOT_FOUND);

    const origem = checkAdminMutation(
      'POST',
      {
        contentType: cabecalho(req.headers['content-type']) ?? null,
        origin: cabecalho(req.headers.origin) ?? null,
        secFetchSite: cabecalho(req.headers['sec-fetch-site']) ?? null,
      },
      opts.baseUrl,
    );
    if (origem !== null) return enviar(res, origem);

    // Sem papel da rota = 404 (nao 403): a existencia do cadastro nao aparece para quem nao tem o papel.
    if (!casada.rota.permissoes.some((p) => row.permissions.includes(p))) return enviar(res, ADMIN_NOT_FOUND);

    const { text, bytes } = await lerCorpo(req, RETENTION_BODY_LIMIT_BYTES);
    let corpo: unknown;
    if (bytes <= RETENTION_BODY_LIMIT_BYTES && text.length > 0) {
      try {
        corpo = JSON.parse(text);
      } catch {
        corpo = undefined;
      }
    }

    try {
      const resposta = await executar(casada.rota.nome, casada.params, corpo, row.userId, opts, nowMs);
      return enviar(res, resposta);
    } catch (err) {
      return enviar(res, respostaDeErro(err));
    }
  } catch {
    return enviar(res, adminReply(503, { code: 'retencao_indisponivel' }));
  }
}
