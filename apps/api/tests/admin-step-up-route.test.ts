// H-073 (Issue 83, docs/factory/60-DESENHO-H073.md §4 e §5) | POST /v1/admin/session/step-up via HTTP.
// Sem sessao valida, Origin errada, codigo ou senha invalidos, prova de outra conta, limite de tentativas,
// sucesso (avanco de totp_at com validade de 30 min) e rota sem a opcao montada. Fetch bloqueado;
// repositorio, provedor, limites e log em memoria; relogio injetado. Sem banco, sem rede, sem e-mail.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-073 (step-up)');
};

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ADMIN_SESSION_COOKIE,
  type AdminAuthPort,
  type AdminGuardRecord,
  type AdminLogEntry,
  type AdminLoginLimits,
  type AdminRepository,
} from '@fastpro/domain';
import { handleRequest } from '../src/app.js';
import type { AdminStepUpRouteOptions } from '../src/admin-step-up-route.js';

const BASE = 'https://admin.fastpro.example.test';
const T0 = Date.UTC(2099, 0, 1, 12);
const MIN = 60 * 1000;
const SEG = 'example-admin-secret-stepup-h073-0000000000';
const SENHA = 'SENTINELA-SENHA-H073-STEPUP-zq';
const CODIGO_OK = '123456';
const CODIGO_OUTRA_CONTA = '654321';
const EMAIL = 'admin.sintetico@example.test';

/** Estado mutavel do teste: sessao viva, se o avanco de totp_at aconteceu e a contagem de tentativas. */
const estado = {
  sessaoAtiva: true,
  avancoOk: true,
  contagem: { email: 0, ip: 0 },
};

const chamadas: string[] = [];
const logs: AdminLogEntry[] = [];
let falhas = 0;

const linha: AdminGuardRecord = {
  userId: 'u-superadmin',
  roles: ['superadmin'],
  permissions: ['admin.role.manage', 'catalog.manage', 'case.authorize_sensitive'],
  aal2: true,
  active: true,
  expiresAtMs: T0 + 8 * 60 * MIN,
  totpAtMs: T0 - 40 * MIN,
};

const repo = {
  guard: async (secret: string) => (secret === SEG && estado.sessaoAtiva ? linha : null),
  sessionSubject: async (secret: string) =>
    secret === SEG && estado.sessaoAtiva ? { userId: 'u-superadmin', email: EMAIL, authUserId: 'auth-1' } : null,
  stepUp: async () => {
    chamadas.push('stepUp');
    return estado.avancoOk;
  },
} as unknown as AdminRepository;

const auth: AdminAuthPort = {
  enrollUser: async () => {
    throw new Error('nao usado');
  },
  confirmEnrollment: async () => {
    throw new Error('nao usado');
  },
  signInWithPasswordAndTotp: async (email, password, code) => {
    chamadas.push('prova');
    if (email !== EMAIL || password !== SENHA) return null;
    if (code === CODIGO_OK) return { authUserId: 'auth-1' };
    if (code === CODIGO_OUTRA_CONTA) return { authUserId: 'auth-outra' };
    return null;
  },
};

const limits: AdminLoginLimits = {
  counts: async () => ({ ...estado.contagem }),
  recordFailure: async () => {
    falhas += 1;
  },
};

const OPTS: AdminStepUpRouteOptions = {
  repo,
  auth,
  limits,
  log: (entry) => logs.push(entry),
  baseUrl: BASE,
  clock: { nowMs: () => T0 },
};

interface Resposta {
  readonly status: number;
  readonly text: string;
  readonly json: Record<string, unknown> | null;
}

function pedir(
  base: string,
  corpo: unknown,
  opts: { readonly segredo?: string; readonly origin?: string } = {},
): Promise<Resposta> {
  return new Promise((resolve, reject) => {
    const data = corpo === undefined ? '' : typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      origin: opts.origin ?? BASE,
      'sec-fetch-site': 'same-origin',
      'content-length': String(Buffer.byteLength(data)),
    };
    if (opts.segredo !== undefined) headers.cookie = `${ADMIN_SESSION_COOKIE}=${opts.segredo}`;
    const req = request(`${base}/v1/admin/session/step-up`, { method: 'POST', headers }, (res) => {
      const partes: Buffer[] = [];
      res.on('data', (c: Buffer) => partes.push(c));
      res.on('end', () => {
        const text = Buffer.concat(partes).toString('utf8');
        let json: Record<string, unknown> | null = null;
        try {
          json = text === '' ? null : (JSON.parse(text) as Record<string, unknown>);
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode ?? 0, text, json });
      });
    });
    req.on('error', reject);
    if (data !== '') req.write(data);
    req.end();
  });
}

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    void handleRequest(req, res, { tickSecret: undefined, adminStepUp: OPTS });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  chamadas.length = 0;
  logs.length = 0;
  falhas = 0;
  estado.sessaoAtiva = true;
  estado.avancoOk = true;
  estado.contagem = { email: 0, ip: 0 };
});

describe('POST /v1/admin/session/step-up (H-073, 60 §4)', () => {
  it('sem sessao valida (cookie ausente ou sessao encerrada): 404 vazio, sem prova no provedor', async () => {
    const semCookie = await pedir(base, { password: SENHA, code: CODIGO_OK });
    estado.sessaoAtiva = false;
    const encerrada = await pedir(base, { password: SENHA, code: CODIGO_OK }, { segredo: SEG });
    for (const r of [semCookie, encerrada]) {
      expect(r.status).toBe(404);
      expect(r.text).toBe('');
    }
    expect(chamadas).toEqual([]);
  });

  it('Origin de outro site: 403 origem_invalida antes de qualquer prova', async () => {
    const r = await pedir(base, { password: SENHA, code: CODIGO_OK }, { segredo: SEG, origin: 'https://evil.example.test' });
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ code: 'origem_invalida' });
    expect(chamadas).toEqual([]);
  });

  it('codigo TOTP errado: 401 credenciais_invalidas, falha registrada, sem avanco e sem senha na resposta', async () => {
    const r = await pedir(base, { password: SENHA, code: '000000' }, { segredo: SEG });
    expect(r.status).toBe(401);
    expect(r.json).toEqual({ code: 'credenciais_invalidas' });
    expect(chamadas).toEqual(['prova']);
    expect(falhas).toBe(1);
    expect(logs).toContainEqual({ evento: 'confirmacao_admin', resultado: 'recusado', motivo: 'provedor' });
    expect(r.text).not.toContain(SENHA);
    expect(JSON.stringify(logs)).not.toContain(SENHA);
  });

  it('senha ou codigo ausentes ou nao textuais: 401 sem chamar o provedor', async () => {
    const semCodigo = await pedir(base, { password: SENHA }, { segredo: SEG });
    const naoTexto = await pedir(base, { password: SENHA, code: 123456 }, { segredo: SEG });
    const corpoInvalido = await pedir(base, '{nao-e-json', { segredo: SEG });
    for (const r of [semCodigo, naoTexto, corpoInvalido]) {
      expect(r.status).toBe(401);
      expect(r.json).toEqual({ code: 'credenciais_invalidas' });
    }
    expect(chamadas).toEqual([]);
    expect(falhas).toBe(3);
  });

  it('prova de outra conta (mesmo e-mail, usuario diferente da sessao): 401 e totp_at nao avanca', async () => {
    const r = await pedir(base, { password: SENHA, code: CODIGO_OUTRA_CONTA }, { segredo: SEG });
    expect(r.status).toBe(401);
    expect(r.json).toEqual({ code: 'credenciais_invalidas' });
    expect(chamadas).toEqual(['prova']);
    expect(logs).toContainEqual({ evento: 'confirmacao_admin', resultado: 'recusado', motivo: 'outra_conta' });
  });

  it('limite de tentativas por e-mail (5 falhas): 429 muitas_tentativas sem chamar o provedor', async () => {
    estado.contagem = { email: 5, ip: 0 };
    const r = await pedir(base, { password: SENHA, code: CODIGO_OK }, { segredo: SEG });
    expect(r.status).toBe(429);
    expect(r.json).toEqual({ code: 'muitas_tentativas' });
    expect(chamadas).toEqual([]);
  });

  it('corpo acima de 1 KiB e tratado como ausente: 401 sem prova', async () => {
    const grande = { password: SENHA, code: CODIGO_OK, preenchimento: 'x'.repeat(2048) };
    const r = await pedir(base, grande, { segredo: SEG });
    expect(r.status).toBe(401);
    expect(chamadas).toEqual([]);
  });

  it('prova valida: 200 confirmado, validade de 30 min a partir de agora, totp_at avancado; sem senha na resposta', async () => {
    const r = await pedir(base, { password: SENHA, code: CODIGO_OK }, { segredo: SEG });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ confirmado: true, confirmado_ate: T0 + 30 * MIN });
    expect(chamadas).toEqual(['prova', 'stepUp']);
    expect(logs).toContainEqual({ evento: 'confirmacao_admin', resultado: 'ok' });
    expect(r.text).not.toContain(SENHA);
    expect(r.text).not.toContain(CODIGO_OK);
  });

  it('sessao encerrada entre a guarda e o avanco de totp_at: 404, sem efeito', async () => {
    estado.avancoOk = false;
    const r = await pedir(base, { password: SENHA, code: CODIGO_OK }, { segredo: SEG });
    expect(r.status).toBe(404);
    expect(r.text).toBe('');
    expect(chamadas).toEqual(['prova', 'stepUp']);
  });

  it('sem a opcao adminStepUp montada no app: a rota nao existe (404)', async () => {
    const semRota = createServer((req, res) => {
      void handleRequest(req, res, { tickSecret: undefined });
    });
    await new Promise<void>((resolve) => semRota.listen(0, '127.0.0.1', () => resolve()));
    const endereco = `http://127.0.0.1:${(semRota.address() as AddressInfo).port}`;
    try {
      const r = await pedir(endereco, { password: SENHA, code: CODIGO_OK }, { segredo: SEG });
      expect(r.status).toBe(404);
      expect(r.text).toBe('');
      expect(chamadas).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => semRota.close(() => resolve()));
    }
  });
});
