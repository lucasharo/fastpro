// Console admin (2026-11-24): moderacao, auditoria recente e equipe.
//   GET  /v1/admin/moderation/reports?status=aberto|resolvido|descartado   moderation.decide
//   POST /v1/admin/moderation/reports/:id/decision {decisao}               moderation.decide
//   GET  /v1/admin/moderation/reviews                                      moderation.decide
//   POST /v1/admin/moderation/reviews/:id/visibility {oculta}              moderation.decide
//   GET  /v1/admin/audit/recent                                            audit.read
//   GET  /v1/admin/staff                                                   admin.role.manage
//   POST /v1/admin/staff {email, password, roles}                          admin.role.manage (cadastra um admin)
//   GET  /v1/admin/listas/catalogo?aba&pagina&q&situacao&grupo&servico      catalog.manage (50 por pagina, no banco)
//   GET  /v1/admin/listas/catalogo-opcoes                                  catalog.manage (grupos e servicos leves)
// Guarda: cookie __Host-fp_admin -> private.admin_guard (sessao, conta e papel ativos). Sem sessao ou sem a
// permissao: 404 vazio, igual a rota inexistente. Mutacoes exigem Origin do admin. Sem log de cookie ou corpo.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ADMIN_GRANTABLE_ROLES,
  ADMIN_SESSION_COOKIE,
  adminPasswordProblem,
  checkDraftOrigin,
  cookieValue,
  normalizeAdminEmail,
  siteOriginOf,
} from '@fastpro/domain';
import { hashAdminPassword, hashSessionSecret, type SqlClient } from '@fastpro/db';

const POR_PAGINA = 50;
const CORPO_MAX_BYTES = 2048;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CABECALHOS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Type': 'application/json; charset=utf-8',
} as const;

export interface AdminModerationRouteOptions {
  readonly adminUrl: string;
  readonly client: SqlClient;
  readonly clock: { nowMs(): number };
}

type Rota =
  | { readonly tipo: 'denuncias' }
  | { readonly tipo: 'decidir'; readonly id: string }
  | { readonly tipo: 'avaliacoes' }
  | { readonly tipo: 'visibilidade'; readonly id: string }
  | { readonly tipo: 'auditoria' }
  | { readonly tipo: 'equipe' }
  | { readonly tipo: 'cadastrar' }
  | { readonly tipo: 'catalogo' }
  | { readonly tipo: 'catalogoOpcoes' };

const PERMISSAO: Record<Rota['tipo'], string> = {
  denuncias: 'moderation.decide',
  decidir: 'moderation.decide',
  avaliacoes: 'moderation.decide',
  visibilidade: 'moderation.decide',
  auditoria: 'audit.read',
  equipe: 'admin.role.manage',
  cadastrar: 'admin.role.manage',
  catalogo: 'catalog.manage',
  catalogoOpcoes: 'catalog.manage',
};

export function adminModerationRoute(metodo: string, path: string): Rota | null {
  if (metodo === 'GET' && path === '/v1/admin/moderation/reports') return { tipo: 'denuncias' };
  if (metodo === 'GET' && path === '/v1/admin/moderation/reviews') return { tipo: 'avaliacoes' };
  if (metodo === 'GET' && path === '/v1/admin/audit/recent') return { tipo: 'auditoria' };
  if (metodo === 'GET' && path === '/v1/admin/staff') return { tipo: 'equipe' };
  if (metodo === 'POST' && path === '/v1/admin/staff') return { tipo: 'cadastrar' };
  if (metodo === 'GET' && path === '/v1/admin/listas/catalogo') return { tipo: 'catalogo' };
  if (metodo === 'GET' && path === '/v1/admin/listas/catalogo-opcoes') return { tipo: 'catalogoOpcoes' };
  let m = /^\/v1\/admin\/moderation\/reports\/([^/]+)\/decision$/.exec(path);
  if (m && metodo === 'POST') return { tipo: 'decidir', id: m[1] ?? '' };
  m = /^\/v1\/admin\/moderation\/reviews\/([^/]+)\/visibility$/.exec(path);
  if (m && metodo === 'POST') return { tipo: 'visibilidade', id: m[1] ?? '' };
  return null;
}

export function isAdminModerationRoute(metodo: string, path: string): boolean {
  return adminModerationRoute(metodo, path) !== null;
}

function enviar(res: ServerResponse, status: number, body?: unknown): void {
  res.writeHead(status, CABECALHOS);
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function naoEncontrado(res: ServerResponse): void {
  res.writeHead(404, { 'Cache-Control': 'no-store' });
  res.end();
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

function lerCorpo(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const partes: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total <= CORPO_MAX_BYTES) partes.push(c);
    });
    req.on('end', () => {
      if (total > CORPO_MAX_BYTES) return resolve(null);
      try {
        const v: unknown = JSON.parse(Buffer.concat(partes).toString('utf8') || '{}');
        resolve(v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null);

export async function handleAdminModerationRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  opts: AdminModerationRouteOptions,
): Promise<void> {
  try {
    const rota = adminModerationRoute(req.method ?? '', path);
    if (rota === null) return naoEncontrado(res);
    const segredo = cookieValue(cabecalho(req.headers.cookie), ADMIN_SESSION_COOKIE);
    if (segredo === undefined) return naoEncontrado(res);
    const agora = opts.clock.nowMs();
    const guarda = await opts.client.query('select out_user_id, out_permissions from private.admin_guard($1, $2::timestamptz)', [
      hashSessionSecret(segredo),
      new Date(agora).toISOString(),
    ]);
    const linha = guarda.rows[0];
    const permissoes = Array.isArray(linha?.out_permissions) ? (linha.out_permissions as unknown[]).map(String) : [];
    if (linha === undefined || !permissoes.includes(PERMISSAO[rota.tipo])) return naoEncontrado(res);
    const adminId = String(linha.out_user_id);

    if (rota.tipo === 'cadastrar') {
      const origem = checkDraftOrigin(
        { origin: cabecalho(req.headers.origin), secFetchSite: cabecalho(req.headers['sec-fetch-site']) },
        siteOriginOf(opts.adminUrl),
        true,
      );
      if (!origem.ok) return enviar(res, 403, { code: 'origem_invalida' });
      const corpo = await lerCorpo(req);
      if (corpo === null) return enviar(res, 400, { code: 'corpo_invalido' });
      const invalido = (campo: string, motivo: string) => enviar(res, 422, { code: 'campo_invalido', campo, motivo });
      const email = normalizeAdminEmail(corpo.email);
      if (email === null) return invalido('email', 'formato');
      const problema = adminPasswordProblem(corpo.password, email);
      if (problema !== null) return invalido('password', problema);
      const papeis = Array.isArray(corpo.roles) ? [...new Set<unknown>(corpo.roles)] : [];
      if (papeis.length === 0 || !papeis.every((p) => (ADMIN_GRANTABLE_ROLES as readonly unknown[]).includes(p))) {
        return invalido('roles', 'papel');
      }
      const q = await opts.client.query(
        'select private.admin_staff_create($1::uuid, $2, $3, $4::text[], $5::timestamptz) as r',
        [adminId, email, await hashAdminPassword(corpo.password as string), papeis, new Date(agora).toISOString()],
      );
      const r = String(q.rows[0]?.r ?? 'erro');
      if (r === 'ok') return enviar(res, 201, { status: 'criado' });
      if (r === 'permissao_negada') return naoEncontrado(res);
      if (r === 'email_indisponivel') return enviar(res, 409, { code: r });
      if (r === 'papel_invalido') return invalido('roles', 'papel');
      return enviar(res, 503, { code: 'indisponivel' });
    }

    if (rota.tipo === 'decidir' || rota.tipo === 'visibilidade') {
      const origem = checkDraftOrigin(
        { origin: cabecalho(req.headers.origin), secFetchSite: cabecalho(req.headers['sec-fetch-site']) },
        siteOriginOf(opts.adminUrl),
        true,
      );
      if (!origem.ok) return enviar(res, 403, { code: 'origem_invalida' });
      if (!UUID_RE.test(rota.id)) return naoEncontrado(res);
      const corpo = await lerCorpo(req);
      if (corpo === null) return enviar(res, 400, { code: 'corpo_invalido' });
      let r: string;
      if (rota.tipo === 'decidir') {
        const decisao = corpo.decisao;
        if (decisao !== 'resolvido' && decisao !== 'descartado') return enviar(res, 400, { code: 'corpo_invalido' });
        const q = await opts.client.query('select private.admin_report_decide($1::uuid, $2::uuid, $3, $4::timestamptz) as r', [
          rota.id,
          adminId,
          decisao,
          new Date(agora).toISOString(),
        ]);
        r = String(q.rows[0]?.r ?? 'erro');
      } else {
        if (typeof corpo.oculta !== 'boolean') return enviar(res, 400, { code: 'corpo_invalido' });
        const q = await opts.client.query('select private.admin_review_visibility($1::uuid, $2::uuid, $3, $4::timestamptz) as r', [
          rota.id,
          adminId,
          corpo.oculta,
          new Date(agora).toISOString(),
        ]);
        r = String(q.rows[0]?.r ?? 'erro');
      }
      if (r === 'ok' || r === 'sem_mudanca') return enviar(res, 200, { status: r });
      if (r === 'nao_encontrado') return naoEncontrado(res);
      return enviar(res, 409, { code: r });
    }

    if (rota.tipo === 'denuncias') {
      const status = new URL(req.url ?? '/', 'http://x').searchParams.get('status');
      const filtro = status === 'aberto' || status === 'resolvido' || status === 'descartado' ? status : null;
      const q = await opts.client.query('select * from private.admin_reports_list($1)', [filtro]);
      return enviar(res, 200, {
        items: q.rows.map((l) => ({
          id: String(l.out_id),
          reason: l.out_reason,
          text: l.out_text ?? null,
          status: l.out_status,
          createdAt: iso(l.out_created_at),
          decidedAt: iso(l.out_decided_at),
          serviceName: l.out_service_name,
          reporterRole: l.out_reporter_role,
          conversationState: l.out_conversation_state,
        })),
      });
    }
    if (rota.tipo === 'avaliacoes') {
      const q = await opts.client.query('select * from private.admin_reviews_list($1)', [100]);
      return enviar(res, 200, {
        items: q.rows.map((l) => ({
          id: String(l.out_id),
          rating: Number(l.out_rating),
          comment: l.out_comment ?? null,
          reply: l.out_reply_text ?? null,
          publishedAt: iso(l.out_published_at),
          hidden: l.out_hidden === true,
          professionalName: l.out_professional_name,
          serviceName: l.out_service_name,
        })),
      });
    }
    if (rota.tipo === 'auditoria') {
      const q = await opts.client.query('select * from private.admin_audit_recent($1)', [100]);
      return enviar(res, 200, {
        items: q.rows.map((l) => ({
          seq: Number(l.out_seq),
          at: iso(l.out_at),
          actor: l.out_actor_ref,
          role: l.out_actor_role,
          action: l.out_action,
          objectType: l.out_object_type,
          objectId: String(l.out_object_id),
        })),
      });
    }
    if (rota.tipo === 'catalogo') {
      const p = new URL(req.url ?? '/', 'http://x').searchParams;
      const entidade = ({ grupos: 'group', servicos: 'service', sinonimos: 'synonym' } as Record<string, string>)[p.get('aba') ?? 'grupos'];
      if (entidade === undefined) return enviar(res, 400, { code: 'aba_invalida' });
      const pagina = Math.max(1, Math.min(10_000, Number.parseInt(p.get('pagina') ?? '1', 10) || 1));
      const situacao = p.get('situacao');
      const uuidOuNulo = (v: string | null) => (v !== null && UUID_RE.test(v) ? v : null);
      const busca = (p.get('q') ?? '').trim().slice(0, 80);
      const q = await opts.client.query(
        'select private.catalog_admin_page($1, $2, $3, $4::uuid, $5::uuid, $6, $7) as r',
        [
          entidade,
          busca === '' ? null : busca,
          situacao === 'ativos' ? true : situacao === 'inativos' ? false : null,
          uuidOuNulo(p.get('grupo')),
          uuidOuNulo(p.get('servico')),
          (pagina - 1) * POR_PAGINA,
          POR_PAGINA,
        ],
      );
      const r = (q.rows[0]?.r ?? { total: 0, items: [] }) as { total?: number; items?: unknown[] };
      return enviar(res, 200, { total: Number(r.total ?? 0), pagina, porPagina: POR_PAGINA, items: r.items ?? [] });
    }
    if (rota.tipo === 'catalogoOpcoes') {
      const q = await opts.client.query('select private.catalog_admin_options() as r');
      return enviar(res, 200, q.rows[0]?.r ?? { groups: [], services: [] });
    }
    const q = await opts.client.query('select * from private.admin_staff_list()');
    return enviar(res, 200, {
      items: q.rows.map((l) => ({
        userId: String(l.out_user_id),
        email: l.out_email,
        status: l.out_status,
        roles: Array.isArray(l.out_roles) ? l.out_roles : [],
        since: iso(l.out_since),
      })),
    });
  } catch {
    if (!res.headersSent) enviar(res, 503, { code: 'indisponivel' });
  }
}
