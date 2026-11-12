// H-103 (Issue 112) | Rota GET /v1/admin/auth/session via HTTP (docs/factory/70-DESENHO-H103.md §4, T-H103-08).
// Com sessao valida: papeis e expira_em. Sem sessao valida, sem cookie ou com falha: 200 {autenticado:false}
// (mesmo corpo) ou 503 sem detalhe. Servidor de loopback; guarda em memoria; fetch bloqueado.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-103');
};

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ADMIN_AUTH_SESSION_PATH,
  ADMIN_SESSION_COOKIE,
  adminPermissionsOf,
  type AdminGuardRecord,
} from '@fastpro/domain';
import { handleRequest } from '../src/app.js';
import type { AdminAuthSessionRouteOptions } from '../src/admin-auth-session-route.js';

const T0 = Date.UTC(2099, 0, 1, 12);
const HORA = 60 * 60 * 1000;
const SEG_AUDITOR = 'example-admin-secret-auditor-000000000000';

function linha(roles: string[], extra: Partial<AdminGuardRecord> = {}): AdminGuardRecord {
  return {
    userId: 'u-auditor',
    roles,
    permissions: [...adminPermissionsOf(roles)].sort(),
    aal2: true,
    active: true,
    expiresAtMs: T0 + 8 * HORA,
    totpAtMs: T0,
    ...extra,
  };
}

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
      { host: '127.0.0.1', port: porta, path: ADMIN_AUTH_SESSION_PATH, method: 'GET', headers: cabecalhos },
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

async function servidor(opts: AdminAuthSessionRouteOptions): Promise<{ srv: Server; porta: number }> {
  const srv = createServer((req, res) => {
    void handleRequest(req, res, { tickSecret: undefined, adminAuthSession: opts });
  });
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
  return { srv, porta: (srv.address() as AddressInfo).port };
}

const cookieDe = (segredo: string): string => `${ADMIN_SESSION_COOKIE}=${segredo}`;

describe('T-H103-08 rota GET /v1/admin/auth/session via HTTP', () => {
  let srv: Server;
  let porta: number;
  let guard: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    guard = vi.fn(async (secret: string) =>
      secret === SEG_AUDITOR ? linha(['auditor']) : secret === 'sem-aal2' ? linha(['auditor'], { aal2: false }) : null,
    );
    ({ srv, porta } = await servidor({ guard, clock: { nowMs: () => T0 } }));
  });
  afterAll(() => {
    srv.close();
  });

  it('sessao valida: 200 com papeis e expira_em, sem permissoes nem e-mail', async () => {
    const r = await pedir(porta, cookieDe(SEG_AUDITOR));
    expect(r.status).toBe(200);
    const json = JSON.parse(r.body) as Record<string, unknown>;
    expect(json).toEqual({ autenticado: true, papeis: ['auditor'], expira_em: new Date(T0 + 8 * HORA).toISOString() });
    expect(r.body).not.toMatch(/permiss|e-?mail|u-auditor/i);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(guard).toHaveBeenCalledWith(SEG_AUDITOR, T0);
  });

  it('sem cookie: 200 {autenticado:false} sem consulta ao banco', async () => {
    guard.mockClear();
    const r = await pedir(porta, null);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ autenticado: false });
    expect(guard).not.toHaveBeenCalled();
  });

  it('cookie desconhecido e sessao sem aal2 dao o mesmo corpo que a ausencia de cookie', async () => {
    const ausente = await pedir(porta, null);
    const desconhecido = await pedir(porta, cookieDe('segredo-que-nao-existe-0000000000000000'));
    const semAal2 = await pedir(porta, cookieDe('sem-aal2'));
    expect(desconhecido.body).toBe(ausente.body);
    expect(semAal2.body).toBe(ausente.body);
    expect(semAal2.status).toBe(ausente.status);
  });

  it('falha da guarda: 503 sem detalhe interno', async () => {
    const falha = vi.fn(async () => {
      throw new Error('banco fora do ar: detalhe interno');
    });
    const outro = await servidor({ guard: falha, clock: { nowMs: () => T0 } });
    try {
      const r = await pedir(outro.porta, cookieDe(SEG_AUDITOR));
      expect(r.status).toBe(503);
      expect(JSON.parse(r.body)).toEqual({ code: 'sessao_indisponivel' });
      expect(r.body).not.toMatch(/banco|interno/);
    } finally {
      outro.srv.close();
    }
  });
});
