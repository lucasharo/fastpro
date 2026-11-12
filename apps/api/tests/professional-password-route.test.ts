// H-016 | Troca de senha do profissional logado com porta em memoria (CA-H016-20). Servidor de loopback, fetch
// bloqueado, relogio injetado. E-mail, senha e segredo sinteticos. Sem banco, sem rede, sem e-mail.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-016');
};

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  handleProfessionalPasswordChange,
  PROFESSIONAL_PASSWORD_CHANGE_PATH,
  type ProfessionalPasswordPort,
  type ProfessionalSessionAccount,
} from '../src/professional-password-route.js';

const EMAIL = 'pessoa.sintetica@example.test';
const SEGREDO = 'segredo-sintetico-de-sessao-com-tamanho-suficiente';
const SENHA_FORTE = 'senha-sintetica-forte-2099';
const AGORA = Date.UTC(2099, 0, 1, 12);
const MIN = 60 * 1000;

let conta: ProfessionalSessionAccount | null = null;
let trocas: { senha: string; sessao: string }[] = [];
let falha = false;

const porta: ProfessionalPasswordPort = {
  async sessionAccount(secret) {
    if (falha) throw new Error('falha de infraestrutura');
    return secret === SEGREDO ? conta : null;
  },
  async changePassword(account, senha) {
    if (falha) throw new Error('falha de infraestrutura');
    trocas.push({ senha, sessao: account.sessionId });
  },
};

const servidores: Server[] = [];
afterAll(() => servidores.forEach((s) => s.close()));

async function subir(): Promise<number> {
  const server = createServer((req, res) =>
    handleProfessionalPasswordChange(req, res, {
      port: porta,
      clock: { nowMs: () => AGORA },
      responseFloorMs: 0,
    }),
  );
  servidores.push(server);
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
  return (server.address() as AddressInfo).port;
}

function post(
  port: number,
  corpo: unknown,
  cookie?: string,
): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const dados = JSON.stringify(corpo);
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: PROFESSIONAL_PASSWORD_CHANGE_PATH,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(dados),
          ...(cookie ? { cookie } : {}),
        },
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

const COOKIE = `__Host-fp_sess=${SEGREDO}`;

beforeEach(() => {
  trocas = [];
  falha = false;
  conta = {
    sessionId: 'sessao-atual',
    userId: 'usuario-sintetico',
    authUserId: 'auth-sintetico',
    email: EMAIL,
    emailVerified: true,
    recentAuthAtMs: AGORA - 5 * MIN,
  };
});

describe('POST /v1/professional/password/change (CA-H016-20)', () => {
  it('sem sessao: 401 nao_autenticado, sem troca', async () => {
    const port = await subir();
    const r = await post(port, { new_password: SENHA_FORTE });
    expect(r.status).toBe(401);
    expect(JSON.parse(r.body)).toEqual({ code: 'nao_autenticado' });
    expect(trocas).toEqual([]);
  });

  it('sessao que nao serve (ou de cliente): 401, sem troca', async () => {
    conta = null;
    const port = await subir();
    const r = await post(port, { new_password: SENHA_FORTE }, COOKIE);
    expect(r.status).toBe(401);
    expect(trocas).toEqual([]);
  });

  it('e-mail nao verificado: 403 email_not_verified, mesmo com prova recente (sessao restrita)', async () => {
    conta = { ...conta!, emailVerified: false };
    const port = await subir();
    const r = await post(port, { new_password: SENHA_FORTE }, COOKIE);
    expect(r.status).toBe(403);
    expect(JSON.parse(r.body)).toEqual({ code: 'email_not_verified' });
    expect(trocas).toEqual([]);
  });

  it('prova com mais de 30 min: 401 step_up_required, sem troca (CA-H016-20)', async () => {
    conta = { ...conta!, recentAuthAtMs: AGORA - 31 * MIN };
    const port = await subir();
    const r = await post(port, { new_password: SENHA_FORTE }, COOKIE);
    expect(r.status).toBe(401);
    expect(JSON.parse(r.body)).toEqual({ code: 'step_up_required' });
    expect(trocas).toEqual([]);
  });

  it('nunca houve prova (recentAuthAtMs nulo): trata como vencida', async () => {
    conta = { ...conta!, recentAuthAtMs: null };
    const port = await subir();
    const r = await post(port, { new_password: SENHA_FORTE }, COOKIE);
    expect(r.status).toBe(401);
  });

  it('prova exatamente aos 30 min ainda vale; a troca passa uma vez', async () => {
    conta = { ...conta!, recentAuthAtMs: AGORA - 30 * MIN };
    const port = await subir();
    const r = await post(port, { new_password: SENHA_FORTE }, COOKIE);
    expect(r.status).toBe(204);
    expect(trocas).toEqual([{ senha: SENHA_FORTE, sessao: 'sessao-atual' }]);
  });

  it('senha fraca: 422 com o campo, sem troca', async () => {
    const port = await subir();
    const r = await post(port, { new_password: 'curta' }, COOKIE);
    expect(r.status).toBe(422);
    expect(JSON.parse(r.body)).toMatchObject({ code: 'campo_invalido', campo: 'password' });
    expect(trocas).toEqual([]);
  });

  it('senha igual ao e-mail: 422', async () => {
    const port = await subir();
    const r = await post(port, { new_password: EMAIL }, COOKIE);
    expect(r.status).toBe(422);
  });

  it('falha de infraestrutura: 503 sem detalhe', async () => {
    falha = true;
    const port = await subir();
    const r = await post(port, { new_password: SENHA_FORTE }, COOKIE);
    expect(r.status).toBe(503);
    expect(r.body).not.toContain('falha de infraestrutura');
  });

  it('a resposta nunca ecoa senha, segredo ou e-mail', async () => {
    const port = await subir();
    const r = await post(port, { new_password: SENHA_FORTE }, COOKIE);
    expect(r.body).not.toContain(SENHA_FORTE);
    expect(r.body).not.toContain(SEGREDO);
    expect(r.body).not.toContain(EMAIL);
  });
});
