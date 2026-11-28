// Issue 52 (H-039, docs/factory/124-DESENHO-H039.md §5.3) | Rotas /v1/admin/verificacao/casos.
// Ordem fixa: cookie (sem cookie = 404 sem banco) -> guarda no banco (sessao ativa, 404) -> Origin e
// Content-Type das mutacoes (403) -> corpo JSON limitado -> servico do dominio -> funcoes private no banco.
// A permissao (verification.review e verification.reassign) e a atribuicao sao decididas no banco; qualquer
// negacao sai como 404 com corpo vazio, identico a rota inexistente (CA-H039-02). A leitura do documento e
// POST de proposito (tem efeito) e entrega o arquivo como anexo, sem URL (CA-H039-10, dec. 381).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { hashSessionSecret } from '@fastpro/db';
import {
  ADMIN_NOT_FOUND,
  ADMIN_SESSION_COOKIE,
  MOTIVOS_LEITURA,
  VerificacaoErro,
  VerificationService,
  adminReply,
  checkAdminMutation,
  cookieValue,
  decideAdminGuard,
  type AdminGuardRecord,
  type AdminResponse,
  type RelogioVerificacao,
  type ContextoAtor,
  type IdentityDocReaderPort,
  type VerificationCasePort,
} from '@fastpro/domain';

/** Corpo das mutacoes da fila e pequeno (complemento de ate 500 caracteres): acima disso vira corpo vazio. */
export const VERIFICACAO_BODY_LIMIT_BYTES = 4096;
export const VERIFICACAO_CASOS_PATH = '/v1/admin/verificacao/casos';
const BASE = VERIFICACAO_CASOS_PATH;
const NO_STORE = { 'Cache-Control': 'no-store' } as const;
/** Texto fixo da recusa de aprovacao com original vivo (Issue 53, dec. 534). Sem identificador do outro perfil. */
const MENSAGEM_ORIGINAL_VIVO =
  'Este cadastro não pode ser aprovado enquanto o documento estiver em uso por outro perfil ativo. Recuse ou aguarde.';

export interface AdminVerificationRouteOptions {
  /** Guarda do banco para o segredo do cookie (mesma das rotas de caso). Nulo = sem sessao valida. */
  readonly guard: (secret: string, nowMs: number) => Promise<AdminGuardRecord | null>;
  /** ADMIN_BASE_URL: a unica Origin aceita em mutacoes. */
  readonly baseUrl: string;
  readonly clock: { nowMs(): number };
  /** Porta da fila (funcoes private.verification_*, papel app_system). */
  readonly casos: VerificationCasePort;
  /** Leitor do documento para a sessao, o caso, o motivo e o instante indicados (IdentityDocReaderPort). */
  readonly leitor: (ctx: ContextoAtor, caseId: string, motivo: string, now: Date) => IdentityDocReaderPort;
}

type Acao = 'listar' | 'detalhe' | 'duplicidade' | 'atribuir' | 'reatribuir' | 'leitura' | 'decisao';

/** Rota -> acao. O id do caso e o quarto segmento de /v1/admin/verificacao/casos/{id}/... */
function resolverRota(method: string, path: string): { acao: Acao; caseId: string | null } | null {
  if (!path.startsWith(BASE)) return null;
  const partes = path.slice(BASE.length).split('/').filter((p) => p.length > 0);
  if (partes.length === 0) return method === 'GET' ? { acao: 'listar', caseId: null } : null;
  const [caseId = null, acao, sub] = partes;
  if (partes.length === 1) return method === 'GET' ? { acao: 'detalhe', caseId } : null;
  if (partes.length === 2 && acao === 'duplicidade') return method === 'GET' ? { acao: 'duplicidade', caseId } : null;
  if (method !== 'POST') return null;
  if (partes.length === 2 && acao === 'atribuir') return { acao: 'atribuir', caseId };
  if (partes.length === 2 && acao === 'reatribuir') return { acao: 'reatribuir', caseId };
  if (partes.length === 2 && acao === 'decisao') return { acao: 'decisao', caseId };
  if (partes.length === 3 && acao === 'documento' && sub === 'leitura') return { acao: 'leitura', caseId };
  return null;
}

/** Negacao uniforme (42501 e caso inexistente): mesmo 404 vazio da rota inexistente. */
const NEGADO: AdminResponse = { status: 404, headers: NO_STORE, body: {} };

function paraResposta(err: unknown): AdminResponse {
  if (err instanceof VerificacaoErro) {
    switch (err.codigo) {
      case 'permissao_negada':
        return NEGADO;
      case 'caso_conflito':
        return adminReply(409, { code: 'caso_conflito' });
      case 'documento_indisponivel':
        return adminReply(502, {
          code: 'documento_indisponivel',
          message: 'Não foi possível abrir o documento. Tente de novo.',
        });
      case 'entrada_invalida':
        return adminReply(400, { code: 'entrada_invalida' });
      case 'original_vivo':
        return adminReply(422, { code: 'original_vivo', message: MENSAGEM_ORIGINAL_VIVO });
      default:
        return adminReply(422, { code: err.codigo });
    }
  }
  return adminReply(503, { code: 'verificacao_indisponivel' });
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

/** Le o corpo guardando no maximo o limite; o restante so e contado. */
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

function enviar(res: ServerResponse, resposta: AdminResponse): void {
  if (resposta.status === 404) {
    res.writeHead(404, NO_STORE);
    res.end();
    return;
  }
  res.writeHead(resposta.status, { ...resposta.headers, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(resposta.body));
}

/** Linha da fila em JSON: so os campos da lista branca (dec. 385 a 387). Sem CPF, nome, arquivo ou hash. */
function linhaJson(l: {
  readonly id: string;
  readonly shortId: string;
  readonly status: string;
  readonly appealStatus: string;
  readonly slaTargetAt: Date;
  readonly receivedAt: Date | null;
  readonly services: readonly string[];
  readonly professionalEmail?: string | null;
  readonly overdue: boolean;
  readonly assignedToMe: boolean;
  readonly version: number;
}) {
  return {
    id: l.id,
    identificador: l.shortId,
    status: l.status,
    recurso: l.appealStatus,
    prazoMeta: l.slaTargetAt.toISOString(),
    recebidoEm: l.receivedAt ? l.receivedAt.toISOString() : null,
    servicos: [...l.services],
    email: l.professionalEmail ?? null,
    alemDaMeta: l.overdue,
    minha: l.assignedToMe,
    versao: l.version,
  };
}

/** Cursor da pagina: "<prazo ISO>|<id>". Qualquer outra forma e entrada invalida. */
function lerCursor(valor: string | null): { sla: Date; id: string } | null | 'invalido' {
  if (valor === null || valor === '') return null;
  const [sla, id] = valor.split('|');
  const ms = Date.parse(sla ?? '');
  if (!Number.isFinite(ms) || !id || !/^[0-9a-f-]{36}$/i.test(id)) return 'invalido';
  return { sla: new Date(ms), id };
}

function lerJson(text: string, bytes: number): unknown {
  if (bytes > VERIFICACAO_BODY_LIMIT_BYTES || text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function inteiro(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isInteger(valor) ? valor : null;
}

async function despachar(
  acao: Acao,
  caseId: string | null,
  corpo: unknown,
  query: URLSearchParams,
  ctx: ContextoAtor,
  opts: AdminVerificationRouteOptions,
  clock: RelogioVerificacao,
): Promise<AdminResponse | { readonly binario: { bytes: Uint8Array; type: string } }> {
  const service = new VerificationService(opts.casos, clock);
  const obj = (corpo ?? {}) as Record<string, unknown>;
  switch (acao) {
    case 'listar': {
      const limite = Number(query.get('limite') ?? '20');
      const cursor = lerCursor(query.get('apos'));
      if (cursor === 'invalido') return adminReply(400, { code: 'entrada_invalida' });
      const itens = await service.listar(ctx, { escopo: query.get('escopo') ?? '', limite, apos: cursor });
      const ultimo = itens[itens.length - 1];
      const proximo = itens.length === limite && ultimo ? `${ultimo.slaTargetAt.toISOString()}|${ultimo.id}` : null;
      return { status: 200, headers: NO_STORE, body: { itens: itens.map(linhaJson), proximo } };
    }
    case 'detalhe': {
      const d = await service.detalhe(ctx, caseId ?? '');
      return {
        status: 200,
        headers: NO_STORE,
        body: {
          ...linhaJson(d),
          motivo: d.reasonCode,
          explicacao: d.explanation,
          decididoEm: d.decidedAt ? d.decidedAt.toISOString() : null,
          documentoDisponivel: d.documentAvailable,
          documento: d.documentId,
          documentoRecebidoEm: d.documentReceivedAt ? d.documentReceivedAt.toISOString() : null,
          certificacoes: (d.certifications ?? []).map((c) => ({
            servicoId: c.serviceId,
            servico: c.serviceName,
            documento: c.documentId,
            recebidoEm: c.receivedAt ? c.receivedAt.toISOString() : null,
          })),
        },
      };
    }
    case 'atribuir': {
      const versao = inteiro(obj.versao);
      if (versao === null) return adminReply(400, { code: 'entrada_invalida' });
      const r = await service.atribuir(ctx, caseId ?? '', versao);
      return { status: 200, headers: NO_STORE, body: { status: r.status, versao: r.versao } };
    }
    case 'reatribuir': {
      const versao = inteiro(obj.versao);
      if (versao === null || typeof obj.responsavel !== 'string') return adminReply(400, { code: 'entrada_invalida' });
      const r = await service.reatribuir(ctx, caseId ?? '', obj.responsavel, versao);
      return { status: 200, headers: NO_STORE, body: { status: r.status, versao: r.versao } };
    }
    case 'decisao': {
      const versao = inteiro(obj.versao);
      if (versao === null || typeof obj.decisao !== 'string' || typeof obj.motivo !== 'string') {
        return adminReply(400, { code: 'entrada_invalida' });
      }
      const complemento = typeof obj.complemento === 'string' ? obj.complemento : null;
      const r = await service.decidir(ctx, caseId ?? '', {
        decisao: obj.decisao,
        motivo: obj.motivo,
        complemento,
        versao,
      });
      return { status: 200, headers: NO_STORE, body: { status: r.status, versao: r.versao } };
    }
    case 'duplicidade': {
      const v = await service.duplicateView(ctx, caseId ?? '');
      return {
        status: 200,
        headers: NO_STORE,
        body: { duplicada: v.duplicada, originalId: v.originalId, originalStatus: v.originalStatus, podeAprovar: v.podeAprovar },
      };
    }
    case 'leitura': {
      const documento = typeof obj.documento === 'string' ? obj.documento : '';
      const motivo = typeof obj.motivo === 'string' ? obj.motivo : '';
      if (!(MOTIVOS_LEITURA as readonly string[]).includes(motivo) || !documento) {
        return adminReply(422, { code: 'motivo_invalido' });
      }
      const arquivo = await opts.leitor(ctx, caseId ?? '', motivo, clock.now()).readForReview(documento);
      if (arquivo === null) return NEGADO;
      return { binario: { bytes: arquivo.bytes, type: arquivo.type } };
    }
  }
}

/** Rotas /v1/admin/verificacao/casos (H-039). Erros nao ecoam valores; falha fora do dominio vira 503 generico. */
export async function handleAdminVerificationRoute(
  req: IncomingMessage,
  res: ServerResponse,
  opts: AdminVerificationRouteOptions,
  path: string,
): Promise<void> {
  try {
    const nowMs = opts.clock.nowMs();
    const rota = resolverRota(req.method ?? '', path);
    if (rota === null) return enviar(res, ADMIN_NOT_FOUND);

    const secret = cookieValue(cabecalho(req.headers.cookie), ADMIN_SESSION_COOKIE) ?? null;
    if (secret === null) return enviar(res, ADMIN_NOT_FOUND);

    const row = await opts.guard(secret, nowMs);
    const sessao = decideAdminGuard(row, 'sessao', nowMs);
    if (sessao.kind === 'recusada') return enviar(res, sessao.response);
    if (sessao.kind !== 'autorizada') return enviar(res, ADMIN_NOT_FOUND);

    if (req.method !== 'GET') {
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
    }

    let corpo: unknown;
    if (req.method !== 'GET') {
      const { text, bytes } = await lerCorpo(req, VERIFICACAO_BODY_LIMIT_BYTES);
      corpo = lerJson(text, bytes);
    }

    const ctx: ContextoAtor = { actorId: sessao.userId, sessionHash: hashSessionSecret(secret) };
    const url = new URL(req.url ?? '', 'http://interno.invalid');
    const clock: RelogioVerificacao = { now: () => new Date(opts.clock.nowMs()) };
    const resultado = await despachar(rota.acao, rota.caseId, corpo, url.searchParams, ctx, opts, clock);

    if ('binario' in resultado) {
      const ext = resultado.binario.type === 'application/pdf' ? 'pdf' : 'jpg';
      res.writeHead(200, {
        'Content-Type': resultado.binario.type,
        'Content-Disposition': `attachment; filename="documento-identidade.${ext}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      });
      res.end(Buffer.from(resultado.binario.bytes));
      return;
    }
    return enviar(res, resultado);
  } catch (err) {
    return enviar(res, paraResposta(err));
  }
}
