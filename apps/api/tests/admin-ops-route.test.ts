// H-108 (Issue 117) | Rota GET /v1/admin/ops/panel via HTTP (docs/factory/76-DESENHO-H108.md §2 e §4, T-H108-20).
// 404 identico sem cookie, sem aal2, vencido, desconhecido ou sem papel (sem tocar a leitura);
// 403 para papel sem ops.panel.read (sem tocar a leitura); 200 so com a forma fechada; POST, PUT e DELETE
// sem rota = 404; falha da guarda ou da leitura = 503 sem detalhe. Servidor de loopback; guarda em memoria.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-108');
};

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ADMIN_OPS_PANEL_PATH,
  ADMIN_PERMISSION_DENIED,
  ADMIN_SESSION_COOKIE,
  adminPermissionsOf,
  type AdminGuardRecord,
  type OpsPanelLeitura,
} from '@fastpro/domain';
import { handleRequest } from '../src/app.js';
import type { AdminOpsRouteOptions } from '../src/admin-ops-route.js';

const T0 = Date.UTC(2099, 0, 1, 12);
const HORA = 60 * 60 * 1000;
const SEG_SUPERADMIN = 'example-admin-secret-superadmin-ops-0000';
const SEG_AUDITOR = 'example-admin-secret-auditor-ops-00000000';
const SEG_SEM_AAL2 = 'example-admin-secret-sem-aal2-ops-000000';
const SEG_SEM_PAPEL = 'example-admin-secret-sem-papel-ops-0000';
const SEG_VENCIDO = 'example-admin-secret-vencido-ops-0000000';

function linha(userId: string, roles: string[], extra: Partial<AdminGuardRecord> = {}): AdminGuardRecord {
  return {
    userId,
    roles,
    permissions: [...adminPermissionsOf(roles)].sort(),
    aal2: true,
    active: true,
    expiresAtMs: T0 + 8 * HORA,
    totpAtMs: T0,
    ...extra,
  };
}

const LINHAS = new Map<string, AdminGuardRecord>([
  [SEG_SUPERADMIN, linha('u-superadmin', ['superadmin'])],
  [SEG_AUDITOR, linha('u-auditor', ['auditor'])],
  [SEG_SEM_AAL2, linha('u-sem-aal2', ['superadmin'], { aal2: false })],
  [SEG_SEM_PAPEL, linha('u-sem-papel', [])],
  [SEG_VENCIDO, linha('u-vencido', ['superadmin'], { expiresAtMs: T0 - 1 })],
]);

// Leitura com campos fora do contrato (texto de erro e destinatario): nenhum deles pode sair na resposta.
const LEITURA = {
  fila: {
    por_estado: { pendente: 2, falha: 1 },
    idade_pendente_s: 90,
    falhas_por_codigo: { smtp_timeout: 1 },
  },
  cotas: [
    { servico: 'email', periodo: 'dia_utc', usado: 70, limite: 100, alerta: 1, alertado_em: '2099-01-01T11:00:00Z' },
  ],
  metricas: [],
  ultimo_erro: 'falha ao enviar para pessoa@exemplo.test',
  destinatario: 'pessoa@exemplo.test',
} as unknown as OpsPanelLeitura;

interface Resposta {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

function pedir(porta: number, cookie: string | null, metodo = 'GET'): Promise<Resposta> {
  const cabecalhos: Record<string, string> = {};
  if (cookie !== null) cabecalhos.cookie = cookie;
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: porta, path: ADMIN_OPS_PANEL_PATH, method: metodo, headers: cabecalhos },
      (res) => {
        let body = '';
        res.on('data', (c: Buffer) => {
          body += c.toString('utf8');
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function servidor(opts: AdminOpsRouteOptions): Promise<{ srv: Server; porta: number }> {
  const srv = createServer((req, res) => {
    void handleRequest(req, res, { tickSecret: undefined, adminOps: opts });
  });
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
  return { srv, porta: (srv.address() as AddressInfo).port };
}

const cookieDe = (segredo: string): string => `${ADMIN_SESSION_COOKIE}=${segredo}`;

describe('T-H108-20 rota GET /v1/admin/ops/panel via HTTP (CA-H108-02, 03, 04, 14, 16)', () => {
  let srv: Server;
  let porta: number;
  let guard: ReturnType<typeof vi.fn>;
  let ler: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    guard = vi.fn(async (secret: string) => LINHAS.get(secret) ?? null);
    ler = vi.fn(async () => LEITURA);
    ({ srv, porta } = await servidor({ guard, ler, clock: { nowMs: () => T0 } }));
  });
  afterAll(() => {
    srv.close();
  });

  it('superadmin recebe 200 com a forma fechada, sem campo fora do contrato e sem dado pessoal', async () => {
    const r = await pedir(porta, cookieDe(SEG_SUPERADMIN));
    expect(r.status).toBe(200);
    const corpo = JSON.parse(r.body) as Record<string, unknown>;
    expect(Object.keys(corpo).sort()).toEqual(['cotas', 'fila_email', 'fotos', 'gerado_em', 'rls', 'webhooks']);
    expect(r.body).not.toMatch(/exemplo\.test|pessoa@|destinatario|ultimo_erro|u-superadmin/);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-type']).toMatch(/application\/json/);
    expect(ler).toHaveBeenCalledWith(T0);
  });

  it('papel sem ops.panel.read (auditor): 403 permission_denied e a leitura nao e feita', async () => {
    ler.mockClear();
    const r = await pedir(porta, cookieDe(SEG_AUDITOR));
    expect(r.status).toBe(403);
    expect(JSON.parse(r.body)).toEqual(ADMIN_PERMISSION_DENIED.body);
    expect(ler).not.toHaveBeenCalled();
  });

  it('sem cookie: 404 com corpo vazio, sem consulta ao banco nem a leitura', async () => {
    guard.mockClear();
    ler.mockClear();
    const r = await pedir(porta, null);
    expect(r.status).toBe(404);
    expect(r.body).toBe('');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(guard).not.toHaveBeenCalled();
    expect(ler).not.toHaveBeenCalled();
  });

  it('cookie desconhecido, sem aal2, vencido ou sem papel: 404 identico ao de cookie ausente', async () => {
    const ausente = await pedir(porta, null);
    for (const segredo of [
      'segredo-que-nao-existe-ops-0000000000000000',
      SEG_SEM_AAL2,
      SEG_VENCIDO,
      SEG_SEM_PAPEL,
    ]) {
      const r = await pedir(porta, cookieDe(segredo));
      expect(r.status, segredo).toBe(ausente.status);
      expect(r.body, segredo).toBe(ausente.body);
      expect(r.headers['cache-control'], segredo).toBe(ausente.headers['cache-control']);
    }
  });

  it('POST, PUT e DELETE no mesmo caminho nao tem rota: 404, mesmo com sessao de Superadmin', async () => {
    for (const metodo of ['POST', 'PUT', 'DELETE']) {
      const r = await pedir(porta, cookieDe(SEG_SUPERADMIN), metodo);
      expect(r.status, metodo).toBe(404);
      expect(r.body, metodo).toBe('');
    }
  });

  it('revogacao vale na requisicao seguinte: sem linha no banco, 404', async () => {
    let revogado = false;
    const g = vi.fn(async () => (revogado ? null : linha('u-superadmin', ['superadmin'])));
    const l = vi.fn(async () => LEITURA);
    const { srv: s, porta: p } = await servidor({ guard: g, ler: l, clock: { nowMs: () => T0 } });
    try {
      expect((await pedir(p, cookieDe(SEG_SUPERADMIN))).status).toBe(200);
      revogado = true;
      const depois = await pedir(p, cookieDe(SEG_SUPERADMIN));
      expect(depois.status).toBe(404);
      expect(depois.body).toBe('');
    } finally {
      s.close();
    }
  });

  it('falha da guarda no banco: 503 sem detalhe e sem leitura', async () => {
    const g = vi.fn(async () => {
      throw new Error('banco fora do ar: detalhe interno');
    });
    const l = vi.fn(async () => LEITURA);
    const { srv: s, porta: p } = await servidor({ guard: g, ler: l, clock: { nowMs: () => T0 } });
    try {
      const r = await pedir(p, cookieDe(SEG_SUPERADMIN));
      expect(r.status).toBe(503);
      expect(JSON.parse(r.body)).toEqual({ code: 'ops_indisponivel' });
      expect(r.body).not.toMatch(/banco|interno/);
      expect(l).not.toHaveBeenCalled();
    } finally {
      s.close();
    }
  });

  it('falha da leitura agregada: 503 sem detalhe', async () => {
    const l = vi.fn(async () => {
      throw new Error('relation ops.email_outbox does not exist');
    });
    const { srv: s, porta: p } = await servidor({
      guard: vi.fn(async () => linha('u-superadmin', ['superadmin'])),
      ler: l,
      clock: { nowMs: () => T0 },
    });
    try {
      const r = await pedir(p, cookieDe(SEG_SUPERADMIN));
      expect(r.status).toBe(503);
      expect(JSON.parse(r.body)).toEqual({ code: 'ops_indisponivel' });
      expect(r.body).not.toMatch(/relation|ops\.email_outbox/);
    } finally {
      s.close();
    }
  });
});
