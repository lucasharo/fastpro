// Issue 124 (H-115), fatia F3: executor de API da matriz de acesso (docs/factory/164-DESENHO-H115.md, §4.1).
// Cada caso ativo com rota da matriz vira um teste com o titulo [CP-xx]. O esperado vem sempre de ACCESS_MATRIX
// (fonte unica); aqui so ha o cenario (sessao, loja em memoria, sentinelas) e a comparacao. Handlers reais,
// servidor HTTP real em porta efemera, sem banco, sem rede externa, sem provedor.
// Sentinelas: o fake devolve PII sintetica (SENTINELS) nas linhas do profissional; a rota deve descarta-la.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCESS_MATRIX, SENTINELS, containsSentinel, type AccessCase } from '@fastpro/access-matrix';
import { SESSION_COOKIE_NAME, createDiscoveryCursorCodec, type DiscoveryCursor, type RateWindowDecision } from '@fastpro/domain';
import { hashSessionSecret, type OwnerRequestRow, type ProfessionalRequestRow } from '@fastpro/db';
import { handleRequestDetailRoute, type RequestDetailRouteOptions } from '../src/requests/detail-route.js';
import type { VisibilityStorePort } from '../src/requests/detail-service.js';
import { createAddressVault } from '../src/requests/address-crypto.js';
import { handleDiscoveryRoute, type DiscoveryRouteOptions } from '../src/requests/discovery-route.js';
import type { DiscoveryServiceDeps } from '../src/requests/discovery-service.js';
import { handleAdminVerificationRoute } from '../src/admin-verification-route.js';
import { handleAdminDualApprovalRoute, type AdminDualApprovalRouteOptions } from '../src/admin-dual-approval-route.js';
import { handleAdminAuditQuery, type AdminAuditRouteOptions } from '../src/admin-audit-route.js';
import {
  ADMIN_AUDIT_QUERY_PATH,
  ADMIN_REFUND_APPROVALS_PATH,
  ADMIN_SESSION_COOKIE,
  type AdminGuardRecord,
} from '@fastpro/domain';

const DONO = '11111111-1111-4111-8111-111111111111';
const OUTRO = '22222222-2222-4222-8222-222222222222';
const PRO = '44444444-4444-4444-8444-444444444444';
const PRO_SEM_PERFIL_APROVADO = '55555555-5555-4555-8555-555555555555';
const PRO_EXPIRADO = '66666666-6666-4666-8666-666666666666';
const PEDIDO = '33333333-3333-4333-8333-333333333333';
const SERVICO = '88888888-8888-4888-8888-888888888888';
const AGORA = Date.UTC(2026, 10, 20, 12, 0, 0);
const PRAZO = AGORA + 168 * 3600 * 1000;

// Segredos de sessao e chave do cofre por concatenacao (check:secrets): nunca literais completos.
const SEG_DONO = ['sessao', 'dono', 'h115', '0000000000000000000000000000'].join('-');
const SEG_OUTRO = ['sessao', 'outro', 'h115', '0000000000000000000000000000'].join('-');
const SEG_PRO = ['sessao', 'pro', 'h115', '0000000000000000000000000000'].join('-');
const SEG_SEM = ['sessao', 'sem', 'h115', '0000000000000000000000000000'].join('-');
const SEG_EXPIRADO = ['sessao', 'expirado', 'h115', '0000000000000000000000000000'].join('-');
const CHAVE_COFRE = ['chave', 'h115', 'api', '0123456789abcdef0123'].join('-');

const vault = createAddressVault(CHAVE_COFRE);

const SESSOES: Record<string, string> = {
  [hashSessionSecret(SEG_DONO)]: DONO,
  [hashSessionSecret(SEG_OUTRO)]: OUTRO,
  [hashSessionSecret(SEG_PRO)]: PRO,
  [hashSessionSecret(SEG_SEM)]: PRO_SEM_PERFIL_APROVADO,
  [hashSessionSecret(SEG_EXPIRADO)]: PRO_EXPIRADO,
};

function linhaDono(): OwnerRequestRow {
  return {
    id: PEDIDO,
    status: 'publicado',
    serviceId: SERVICO,
    serviceName: 'Encanamento',
    urgency: 'alta',
    description: 'Vazamento embaixo da pia',
    firstName: 'Ana',
    addressEnc: vault.seal(SENTINELS.address, PEDIDO),
    addressTextLegado: null,
    publicLabel: 'Campinas - SP',
    publishedAt: new Date(AGORA).toISOString(),
    acceptanceDeadlineAt: new Date(PRAZO).toISOString(),
  };
}

/** Linha do profissional com PII sintetica acrescentada: a projecao da rota precisa descarta-la. */
function linhaProfissionalComPii(): ProfessionalRequestRow {
  const base: ProfessionalRequestRow = {
    id: PEDIDO,
    serviceId: SERVICO,
    serviceName: 'Encanamento',
    urgency: 'alta',
    description: 'Vazamento embaixo da pia',
    publicLabel: 'Campinas - SP',
    distanceKm: 1.5,
    modality: 'presencial',
    publishedAt: new Date(AGORA).toISOString(),
    acceptanceDeadlineAt: new Date(PRAZO).toISOString(),
  };
  return { ...base, ...{ email: SENTINELS.email, customerPhone: SENTINELS.phone, addressText: SENTINELS.address, customerId: DONO } } as ProfessionalRequestRow;
}

const storeOwner: VisibilityStorePort = {
  readOwner: async (userId, requestId) => (userId === DONO && requestId === PEDIDO ? linhaDono() : null),
  // Elegibilidade e raio decididos pela loja (SQL real em packages/db). Aqui: so o profissional aprovado ve o pedido.
  readProfessional: async (professionalId, requestId) =>
    professionalId === PRO && requestId === PEDIDO ? linhaProfissionalComPii() : null,
};

const detailOpts: RequestDetailRouteOptions = {
  sessions: {
    authenticate: async (hash) => (SESSOES[hash] === undefined ? null : { userId: SESSOES[hash] }),
  },
  service: {
    store: storeOwner,
    addressVault: vault,
    clock: { nowMs: () => AGORA },
  },
};

const discoveryService: DiscoveryServiceDeps = {
  cursor: createDiscoveryCursorCodec(CHAVE_COFRE),
  clock: { nowMs: () => AGORA },
  store: {
    // Expirado: a funcao de descoberta nao devolve nenhum pedido (silencio financeiro, CP-14).
    discover: async ({ professionalId }) =>
      professionalId === PRO_EXPIRADO ? [] : [{ group: 0, key: 1, requestId: PEDIDO } satisfies DiscoveryCursor],
  },
  projection: {
    project: async (_professionalId, ids) => (ids.includes(PEDIDO) ? [linhaProfissionalComPii()] : []),
  },
  photos: { withPhotos: async () => new Set<string>() },
};

const discoveryOpts: DiscoveryRouteOptions = {
  sessions: detailOpts.sessions,
  profissional: { existe: async (userId) => userId !== PRO_SEM_PERFIL_APROVADO },
  limite: {
    check: async (): Promise<RateWindowDecision> => ({ decision: 'permitido' }),
    record: async () => undefined,
  },
  service: discoveryService,
};

// Administracao (F6): guarda por segredo do cookie __Host-fp_admin. Portas de banco que lancam se forem tocadas:
// a guarda ou a permissao devem recusar antes de qualquer leitura da fila, da aprovacao ou da trilha.
const ADMIN_BASE = 'https://admin.fastpro.test';
const ADMIN_ID = '77777777-7777-4777-8777-777777777777';
const APROVACAO = '99999999-9999-4999-8999-999999999999';
const SEG_ADM_SEM_MFA = ['admin', 'sem-mfa', 'h115', '0000000000000000000000000000'].join('-');
const SEG_ADM_SUPER = ['admin', 'superadmin', 'h115', '0000000000000000000000000000'].join('-');
const SEG_ADM_AUDITOR = ['admin', 'auditor', 'h115', '0000000000000000000000000000'].join('-');
const sessaoAdmin = (permissions: string[], roles: string[], aal2: boolean): AdminGuardRecord => ({
  userId: ADMIN_ID, roles, permissions, aal2, active: true, expiresAtMs: AGORA + 8 * 3600 * 1000, totpAtMs: AGORA,
});
const registrosAdmin = new Map<string, AdminGuardRecord>([
  [SEG_ADM_SEM_MFA, sessaoAdmin(['verification.review'], ['verificacao'], false)],
  [SEG_ADM_SUPER, sessaoAdmin(['admin.role.manage', 'catalog.manage'], ['superadmin'], true)],
  [SEG_ADM_AUDITOR, sessaoAdmin(['audit.read'], ['auditor'], true)],
]);
const guardaAdmin = async (segredo: string): Promise<AdminGuardRecord | null> => registrosAdmin.get(segredo) ?? null;
const naoDeveTocar = new Proxy({}, {
  get: () => {
    throw new Error('porta de banco tocada: a guarda deveria recusar antes');
  },
}) as never;
const adminVerificacaoOpts = { guard: guardaAdmin, baseUrl: ADMIN_BASE, clock: { nowMs: () => AGORA }, casos: naoDeveTocar, leitor: naoDeveTocar };
const adminDualOpts: AdminDualApprovalRouteOptions = { guard: guardaAdmin, deps: naoDeveTocar, baseUrl: ADMIN_BASE, clock: { nowMs: () => AGORA } };
const adminAuditOpts: AdminAuditRouteOptions = {
  guard: guardaAdmin,
  deps: { query: { query: async () => ({ consulta_id: '66666666-6666-4666-8666-666666666666', eventos: [], tem_mais: false, proximo_cursor: null }) }, limits: { take: async () => true } },
  baseUrl: ADMIN_BASE,
  clock: { nowMs: () => AGORA },
};

let servidor: Server;
let base: string;

beforeAll(async () => {
  servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
    const caminho = (req.url ?? '/').split('?')[0] ?? '/';
    if (caminho === '/v1/professional/discovery/requests') {
      void handleDiscoveryRoute(req, res, discoveryOpts);
    } else if (caminho === '/v1/admin/verificacao/casos') {
      void handleAdminVerificationRoute(req, res, adminVerificacaoOpts, caminho);
    } else if (caminho.startsWith(`${ADMIN_REFUND_APPROVALS_PATH}/`)) {
      void handleAdminDualApprovalRoute(req, res, adminDualOpts, caminho);
    } else if (caminho === ADMIN_AUDIT_QUERY_PATH) {
      void handleAdminAuditQuery(req, res, adminAuditOpts);
    } else {
      void handleRequestDetailRoute(req, res, caminho, detailOpts);
    }
  });
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
});

interface Resposta {
  status: number;
  json: unknown;
  raw: string;
}

async function chamar(caminho: string, segredo?: string): Promise<Resposta> {
  const cabecalhos: Record<string, string> = {};
  if (segredo !== undefined) cabecalhos.cookie = `${SESSION_COOKIE_NAME}=${segredo}`;
  const r = await fetch(`${base}${caminho}`, { headers: cabecalhos });
  const raw = await r.text();
  return { status: r.status, raw, json: raw.length > 0 ? JSON.parse(raw) : null };
}

/** Chamada admin: cookie __Host-fp_admin; mutacoes com Origin e Sec-Fetch-Site da propria console (54 §3). */
async function chamarAdmin(metodo: 'GET' | 'POST', caminho: string, segredo: string, corpo?: unknown): Promise<Resposta> {
  const cabecalhos: Record<string, string> = { cookie: `${ADMIN_SESSION_COOKIE}=${segredo}` };
  if (metodo === 'POST') {
    cabecalhos['content-type'] = 'application/json';
    cabecalhos.origin = ADMIN_BASE;
    cabecalhos['sec-fetch-site'] = 'same-origin';
  }
  const r = await fetch(`${base}${caminho}`, { method: metodo, headers: cabecalhos, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const raw = await r.text();
  return { status: r.status, raw, json: raw.length > 0 ? JSON.parse(raw) : null };
}

/** Todas as chaves de um objeto em qualquer nivel (lista de itens inclusive). */
function chavesProfundas(valor: unknown, saida = new Set<string>()): Set<string> {
  if (valor !== null && typeof valor === 'object') {
    for (const [chave, filho] of Object.entries(valor as Record<string, unknown>)) {
      saida.add(chave);
      chavesProfundas(filho, saida);
    }
  }
  return saida;
}

function caso(id: string): AccessCase {
  const encontrado = ACCESS_MATRIX.find((c) => c.id === id);
  if (encontrado === undefined) throw new Error(`caso ${id} ausente da matriz`);
  if (encontrado.status !== 'active') throw new Error(`caso ${id} nao esta ativo`);
  return encontrado;
}

/** Compara a resposta real com o esperado do caso (status, codigo, chaves, lista vazia, sentinelas). */
function verificar(c: AccessCase, r: Resposta): void {
  const esperado = c.http;
  if (esperado === undefined) throw new Error(`${c.id} sem expectativa HTTP`);
  expect(r.status, `${c.id}: status`).toBe(esperado.status);
  if ('code' in esperado) {
    expect((r.json as { code?: string }).code, `${c.id}: code`).toBe(esperado.code);
  }
  if ('mustNotHaveKeys' in esperado) {
    const chaves = chavesProfundas(r.json);
    for (const proibida of esperado.mustNotHaveKeys) {
      expect(chaves.has(proibida), `${c.id}: chave proibida ${proibida}`).toBe(false);
    }
    for (const obrigatoria of esperado.mustHaveKeys ?? []) {
      expect(chaves.has(obrigatoria), `${c.id}: chave obrigatoria ausente ${obrigatoria}`).toBe(true);
    }
    if (esperado.emptyItems === true) {
      expect((r.json as { items?: unknown[] }).items, `${c.id}: items`).toEqual([]);
    }
  }
  if (c.principal.startsWith('pro_')) {
    expect(containsSentinel(r.json), `${c.id}: sentinela de PII em resposta a profissional`).toBe(false);
  }
}

describe('H-115 F3: executor de API da matriz de acesso (rotas reais, portas em memoria)', () => {
  it('[CP-01] dono le o proprio pedido publicado: 200 com chaves do dono, sem campos internos', async () => {
    const c = caso('CP-01');
    verificar(c, await chamar(`/v1/requests/${PEDIDO}`, SEG_DONO));
  });

  it('[CP-02] outro cliente pede o pedido alheio (IDOR): 404 uniforme, sem vazamento', async () => {
    const c = caso('CP-02');
    verificar(c, await chamar(`/v1/requests/${PEDIDO}`, SEG_OUTRO));
  });

  it('[CP-03] visitante sem sessao le o pedido: 401 sessao_necessaria', async () => {
    const c = caso('CP-03');
    verificar(c, await chamar(`/v1/requests/${PEDIDO}`));
  });

  it('[CP-04] profissional elegivel le o pedido no raio: 200 com chaves de elegivel, sem PII', async () => {
    const c = caso('CP-04');
    verificar(c, await chamar(`/v1/professional/requests/${PEDIDO}`, SEG_PRO));
  });

  it('[CP-05] profissional sem verificacao aprovada tenta o pedido: 404 uniforme', async () => {
    const c = caso('CP-05');
    verificar(c, await chamar(`/v1/professional/requests/${PEDIDO}`, SEG_SEM));
  });

  it('[CP-10] nenhuma resposta ao profissional elegivel contem e-mail, telefone nem endereco sintetico', async () => {
    const c = caso('CP-10');
    const r = await chamar(`/v1/professional/requests/${PEDIDO}`, SEG_PRO);
    verificar(c, r);
    for (const sentinela of [SENTINELS.email, SENTINELS.phone, SENTINELS.address]) {
      expect(r.raw.includes(sentinela), `CP-10: sentinela ${sentinela} no corpo`).toBe(false);
    }
  });

  it('[CP-13] descoberta: profissional elegivel recebe itens sem PII', async () => {
    const c = caso('CP-13');
    const r = await chamar('/v1/professional/discovery/requests', SEG_PRO);
    verificar(c, r);
    expect((r.json as { items: unknown[] }).items.length).toBeGreaterThan(0);
  });

  it('[CP-14] descoberta: assinatura expirada recebe lista vazia (silencio financeiro)', async () => {
    const c = caso('CP-14');
    verificar(c, await chamar('/v1/professional/discovery/requests', SEG_EXPIRADO));
  });

  it('[CP-21] admin sem segundo fator (aal1) abre a fila de verificacao: 404 uniforme, sem tocar no banco', async () => {
    const c = caso('CP-21');
    verificar(c, await chamarAdmin('GET', '/v1/admin/verificacao/casos', SEG_ADM_SEM_MFA));
  });

  it('[CP-22] superadmin tenta votar o estorno: 403 permission_denied antes de qualquer porta de aprovacao', async () => {
    const c = caso('CP-22');
    verificar(c, await chamarAdmin('POST', `${ADMIN_REFUND_APPROVALS_PATH}/${APROVACAO}/vote`, SEG_ADM_SUPER, {}));
  });

  it('[CP-23] auditor consulta a trilha no periodo: 200 com lista de eventos', async () => {
    const c = caso('CP-23');
    const r = await chamarAdmin('POST', ADMIN_AUDIT_QUERY_PATH, SEG_ADM_AUDITOR, {
      from: '2099-08-01T00:00:00.000Z',
      to: '2099-08-02T00:00:00.000Z',
    });
    verificar(c, r);
    expect(Array.isArray((r.json as { eventos?: unknown }).eventos), 'CP-23: lista de eventos').toBe(true);
  });
});
