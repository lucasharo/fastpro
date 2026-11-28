// H-016 | Recuperacao e redefinicao de senha com porta em memoria (CA-H016-15 a CA-H016-17). Servidor de
// loopback, fetch bloqueado, relogio injetado. E-mail, senha e token sinteticos. Sem banco, sem rede, sem e-mail.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-016');
};

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ProfessionalSendLimitPort, RateWindowDecision } from '@fastpro/domain';
import {
  handlePasswordRecovery,
  handlePasswordReset,
  handleVerificationResend,
  PASSWORD_RECOVERY_PATH,
  PASSWORD_RESET_PATH,
  type ProfessionalRecoveryPort,
} from '../src/professional-recovery-route.js';

const RESEND_PATH = '/v1/auth/professional/verification/resend';

const EMAIL = 'pessoa.sintetica@example.test';
const OUTRO = 'ninguem.sintetico@example.test';
const TOKEN = 'T'.repeat(43);
const SENHA_FORTE = 'senha-sintetica-forte-2099';
const T0 = Date.UTC(2099, 0, 1, 12);

const pedidos: string[] = [];
const trocas: { token: string; senha: string }[] = [];
let vivo: { email: string } | null = null;
let trocaOk = true;
let falhaPorta = false;
let barrado = false;

const reenvios: string[] = [];

const porta: ProfessionalRecoveryPort = {
  async requestRecovery(email) {
    if (falhaPorta) throw new Error('falha de infraestrutura');
    pedidos.push(email);
  },
  async resendVerification(email) {
    if (falhaPorta) throw new Error('falha de infraestrutura');
    reenvios.push(email);
  },
  async peekReset(token) {
    if (falhaPorta) throw new Error('falha de infraestrutura');
    return token === TOKEN ? vivo : null;
  },
  async resetPassword(token, senha) {
    trocas.push({ token, senha });
    return trocaOk;
  },
};

const limites: ProfessionalSendLimitPort = {
  async check(): Promise<RateWindowDecision> {
    return barrado ? { decision: 'barrado', retryAfterSeconds: 120 } : { decision: 'permitido' };
  },
  async record() {},
};

const servidores: Server[] = [];
afterAll(() => servidores.forEach((s) => s.close()));

async function subir(rota: 'recuperacao' | 'redefinicao' | 'reenvio'): Promise<number> {
  const server = createServer((req, res) => {
    const opts = { port: porta, limits: limites, clock: { nowMs: () => T0 }, responseFloorMs: 0 };
    if (rota === 'recuperacao') return handlePasswordRecovery(req, res, opts);
    if (rota === 'reenvio') return handleVerificationResend(req, res, opts);
    return handlePasswordReset(req, res, opts);
  });
  servidores.push(server);
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
  return (server.address() as AddressInfo).port;
}

function post(
  port: number,
  path: string,
  corpo: unknown,
): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const dados = JSON.stringify(corpo);
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados) },
      },
      (res) => {
        let body = '';
        res.on('data', (c: Buffer) => (body += c.toString('utf8')));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      },
    );
    req.on('error', reject);
    req.end(dados);
  });
}

describe('POST /v1/auth/professional/verification/resend (CA-H016-09)', () => {
  it('conta existente e inexistente: mesma resposta 202, e o reenvio so vai ao que a porta decide', async () => {
    const port = await subir('reenvio');
    const a = await post(port, RESEND_PATH, { email: EMAIL });
    const b = await post(port, RESEND_PATH, { email: OUTRO });
    expect(a.status).toBe(202);
    expect(a.body).toBe(b.body);
    expect(reenvios).toEqual([EMAIL, OUTRO]);
  });

  it('excesso de reenvios: 429 com Retry-After, sem chamar a porta', async () => {
    barrado = true;
    const port = await subir('reenvio');
    const r = await post(port, RESEND_PATH, { email: EMAIL });
    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toBe('120');
    expect(reenvios).toEqual([]);
  });

  it('o corpo com forma invalida nao envia nada e responde 202', async () => {
    const port = await subir('reenvio');
    const r = await post(port, RESEND_PATH, { email: 'nao-e-email' });
    expect(r.status).toBe(202);
    expect(reenvios).toEqual([]);
  });
});

beforeEach(() => {
  reenvios.length = 0;
  pedidos.length = 0;
  trocas.length = 0;
  vivo = { email: EMAIL };
  trocaOk = true;
  falhaPorta = false;
  barrado = false;
});

describe('POST /v1/auth/password/recovery (CA-H016-15, CA-H016-17)', () => {
  it('conta existente e inexistente recebem a mesma resposta 202 (CA-H016-15)', async () => {
    const port = await subir('recuperacao');
    const a = await post(port, PASSWORD_RECOVERY_PATH, { email: EMAIL });
    const b = await post(port, PASSWORD_RECOVERY_PATH, { email: OUTRO });
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(a.body).toBe(b.body);
    expect(pedidos).toEqual([EMAIL, OUTRO]);
  });

  it('forma invalida de e-mail responde 202 sem chamar a porta', async () => {
    const port = await subir('recuperacao');
    const r = await post(port, PASSWORD_RECOVERY_PATH, { email: 'nao-e-email' });
    expect(r.status).toBe(202);
    expect(pedidos).toEqual([]);
  });

  it('excesso de pedidos: 429 com Retry-After, sem chamar a porta (CA-H016-17)', async () => {
    barrado = true;
    const port = await subir('recuperacao');
    const r = await post(port, PASSWORD_RECOVERY_PATH, { email: EMAIL });
    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toBe('120');
    expect(pedidos).toEqual([]);
  });

  it('falha de infraestrutura: 503 sem detalhe', async () => {
    falhaPorta = true;
    const port = await subir('recuperacao');
    const r = await post(port, PASSWORD_RECOVERY_PATH, { email: EMAIL });
    expect(r.status).toBe(503);
    expect(r.body).not.toContain('falha de infraestrutura');
  });

  it('a resposta nao traz o e-mail', async () => {
    const port = await subir('recuperacao');
    const r = await post(port, PASSWORD_RECOVERY_PATH, { email: EMAIL });
    expect(r.body).not.toContain(EMAIL);
  });
});

describe('POST /v1/auth/password/reset (CA-H016-16)', () => {
  it('formato de link invalido: 410 unico, sem consultar a porta', async () => {
    const port = await subir('redefinicao');
    const r = await post(port, PASSWORD_RESET_PATH, { token: 'curto', new_password: SENHA_FORTE });
    expect(r.status).toBe(410);
    expect(JSON.parse(r.body)).toEqual({ code: 'link_invalid' });
    expect(trocas).toEqual([]);
  });

  it('link inexistente, usado ou vencido: 410 unico, sem troca', async () => {
    vivo = null;
    const port = await subir('redefinicao');
    const r = await post(port, PASSWORD_RESET_PATH, { token: TOKEN, new_password: SENHA_FORTE });
    expect(r.status).toBe(410);
    expect(trocas).toEqual([]);
  });

  it('senha fraca: 422 e o link nao e consumido (nada trocado)', async () => {
    const port = await subir('redefinicao');
    const r = await post(port, PASSWORD_RESET_PATH, { token: TOKEN, new_password: 'curta' });
    expect(r.status).toBe(422);
    expect(JSON.parse(r.body)).toMatchObject({ code: 'campo_invalido', campo: 'password' });
    expect(trocas).toEqual([]);
  });

  it('senha igual ao e-mail e recusada (politica com o e-mail do link)', async () => {
    const port = await subir('redefinicao');
    const r = await post(port, PASSWORD_RESET_PATH, { token: TOKEN, new_password: EMAIL });
    expect(r.status).toBe(422);
    expect(trocas).toEqual([]);
  });

  it('link valido e senha forte: 204 e a troca acontece uma vez', async () => {
    const port = await subir('redefinicao');
    const r = await post(port, PASSWORD_RESET_PATH, { token: TOKEN, new_password: SENHA_FORTE });
    expect(r.status).toBe(204);
    expect(trocas).toEqual([{ token: TOKEN, senha: SENHA_FORTE }]);
  });

  it('corrida: o link deixou de servir na hora de consumir: 410, sem vazar detalhe', async () => {
    trocaOk = false;
    const port = await subir('redefinicao');
    const r = await post(port, PASSWORD_RESET_PATH, { token: TOKEN, new_password: SENHA_FORTE });
    expect(r.status).toBe(410);
    expect(r.body).not.toContain(SENHA_FORTE);
  });

  it('a resposta nunca ecoa token ou senha', async () => {
    const port = await subir('redefinicao');
    const r = await post(port, PASSWORD_RESET_PATH, { token: TOKEN, new_password: SENHA_FORTE });
    expect(r.body).not.toContain(TOKEN);
    expect(r.body).not.toContain(SENHA_FORTE);
  });
});
