// H-103 (Issue 112) | Rota GET /v1/admin/console/menu via HTTP (docs/factory/70-DESENHO-H103.md §1, §4).
// T-H103-07 (200 com so id, rotulo e caminho; no-store; 404 identico sem cookie, sem aal2 ou revogado;
// 503 sem detalhe) e T-H103-06 (revogacao vale na requisicao seguinte). Servidor de loopback; guarda em memoria.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-103');
};

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ADMIN_CONSOLE_MENU_PATH,
  ADMIN_ROUTES,
  ADMIN_SESSION_COOKIE,
  adminPermissionsOf,
  type AdminGuardRecord,
} from '@fastpro/domain';
import { handleRequest } from '../src/app.js';
import type { AdminConsoleRouteOptions } from '../src/admin-console-route.js';

const BASE = 'https://admin.fastpro.example.test';
const T0 = Date.UTC(2099, 0, 1, 12);
const HORA = 60 * 60 * 1000;
const SEG_SUPERADMIN = 'example-admin-secret-superadmin-0000000000';
const SEG_AUDITOR = 'example-admin-secret-auditor-000000000000';
const SEG_SEM_AAL2 = 'example-admin-secret-sem-aal2-00000000000';

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
]);

interface Resposta {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

function pedir(porta: number, cookie: string | null): Promise<Resposta> {
  const cabecalhos: Record<string, string> = {};
  if (cookie !== null) cabecalhos.cookie = cookie;
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: porta, path: ADMIN_CONSOLE_MENU_PATH, method: 'GET', headers: cabecalhos },
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

async function servidor(opts: AdminConsoleRouteOptions): Promise<{ srv: Server; porta: number }> {
  const srv = createServer((req, res) => {
    void handleRequest(req, res, { tickSecret: undefined, adminConsole: opts });
  });
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
  return { srv, porta: (srv.address() as AddressInfo).port };
}

const cookieDe = (segredo: string): string => `${ADMIN_SESSION_COOKIE}=${segredo}`;
const idsDe = (r: Resposta): string[] =>
  (JSON.parse(r.body) as { telas: { id: string }[] }).telas.map((t) => t.id);

describe('T-H103-07 rota GET /v1/admin/console/menu via HTTP', () => {
  let srv: Server;
  let porta: number;
  let guard: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    guard = vi.fn(async (secret: string) => LINHAS.get(secret) ?? null);
    ({ srv, porta } = await servidor({
      guard,
      registro: ADMIN_ROUTES,
      clock: { nowMs: () => T0 },
    }));
  });
  afterAll(() => {
    srv.close();
  });

  it('superadmin com sessao recebe 200 com so as telas do papel, sem permissoes nem e-mail', async () => {
    const r = await pedir(porta, cookieDe(SEG_SUPERADMIN));
    expect(r.status).toBe(200);
    expect(idsDe(r)).toEqual(['acesso-aprovacao', 'equipe']);
    expect(r.body).not.toMatch(/permiss|roles|e-?mail|u-superadmin/i);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });

  it('auditor recebe so a trilha; a guarda recebe o segredo do cookie e o instante da requisicao', async () => {
    guard.mockClear();
    const r = await pedir(porta, cookieDe(SEG_AUDITOR));
    expect(idsDe(r)).toEqual(['auditoria']);
    expect(guard).toHaveBeenCalledWith(SEG_AUDITOR, T0);
  });

  it('sem cookie: 404 com corpo vazio, sem consulta ao banco', async () => {
    guard.mockClear();
    const r = await pedir(porta, null);
    expect(r.status).toBe(404);
    expect(r.body).toBe('');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(guard).not.toHaveBeenCalled();
  });

  it('cookie desconhecido, vencido ou revogado: 404 identico ao de cookie ausente', async () => {
    const ausente = await pedir(porta, null);
    const desconhecido = await pedir(porta, cookieDe('segredo-que-nao-existe-0000000000000000'));
    expect(desconhecido.status).toBe(ausente.status);
    expect(desconhecido.body).toBe(ausente.body);
    expect(desconhecido.headers['cache-control']).toBe(ausente.headers['cache-control']);
  });

  it('sessao sem aal2: 404 e nenhuma tela', async () => {
    const r = await pedir(porta, cookieDe(SEG_SEM_AAL2));
    expect(r.status).toBe(404);
    expect(r.body).toBe('');
  });

  it('metodo diferente de GET nao tem rota (404)', async () => {
    const r = await new Promise<Resposta>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: porta,
          path: ADMIN_CONSOLE_MENU_PATH,
          method: 'POST',
          headers: { cookie: cookieDe(SEG_SUPERADMIN) },
        },
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
    expect(r.status).toBe(404);
  });
});

describe('T-H103-06 revogacao pela rota (CA-H103-09)', () => {
  it('papel revogado entre duas requisicoes: a primeira mostra a tela e a seguinte nega', async () => {
    let revogado = false;
    const guard = vi.fn(async () => (revogado ? null : linha('u-auditor', ['auditor'])));
    const { srv, porta } = await servidor({ guard, registro: ADMIN_ROUTES, clock: { nowMs: () => T0 } });
    try {
      const antes = await pedir(porta, cookieDe(SEG_AUDITOR));
      expect(idsDe(antes)).toEqual(['auditoria']);
      revogado = true;
      const depois = await pedir(porta, cookieDe(SEG_AUDITOR));
      expect(depois.status).toBe(404);
      expect(depois.body).toBe('');
    } finally {
      srv.close();
    }
  });

  it('falha na guarda do banco: 503 sem detalhe e sem telas', async () => {
    const guard = vi.fn(async () => {
      throw new Error('banco fora do ar: detalhe interno');
    });
    const { srv, porta } = await servidor({ guard, registro: ADMIN_ROUTES, clock: { nowMs: () => T0 } });
    try {
      const r = await pedir(porta, cookieDe(SEG_AUDITOR));
      expect(r.status).toBe(503);
      expect(JSON.parse(r.body)).toEqual({ code: 'console_indisponivel' });
      expect(r.body).not.toMatch(/banco|interno/);
    } finally {
      srv.close();
    }
  });
});
