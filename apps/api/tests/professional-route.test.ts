// H-016 | Rotas do profissional em memoria (T-H016-01, 02, 03, 07, 08, 11, 12, 13; CA-H016-01 a 13).
// Repositorio em memoria com as mesmas regras de contador (gateProfessionalLogin). Relogio injetado,
// servidor de loopback, fetch bloqueado. Senhas e e-mails sinteticos. Sem banco, sem rede, sem e-mail.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-016');
};

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import {
  gateProfessionalLogin,
  LOGIN_THROTTLE_EMPTY,
  type LoginThrottleState,
} from '@fastpro/domain';
import { handleRequest } from '../src/app.js';
import type {
  ProfessionalAuthPort,
  ProfessionalCredential,
} from '../src/professional-route.js';

const novoSegredo = (): string => randomBytes(32).toString('base64url');
const MIN = 60 * 1000;
const PATH_CONFIRM = '/v1/auth/professional/verification/confirm';
const PATH_LOGIN = '/v1/auth/professional/login';
const T0 = Date.UTC(2099, 0, 1, 12);
const EMAIL = 'pessoa.sintetica@example.test';
const SENHA = 'senha-sintetica-x';

interface Usuario {
  readonly id: string;
  readonly email: string;
  password: string;
  verified: boolean;
  active: boolean;
}

interface Link {
  readonly email: string;
  readonly expiresAtMs: number;
  used: boolean;
}

/** Porta em memoria: mesmas regras do adaptador (contador, link de 15 min, uso unico). */
class PortaMemoria implements ProfessionalAuthPort {
  readonly usuarios = new Map<string, Usuario>();
  readonly links = new Map<string, Link>();
  readonly contadores = new Map<string, LoginThrottleState>();
  readonly sessoes: string[] = [];
  verificacoes = 0;
  falhaCadastro = false;
  private seq = 0;

  async register(email: string, password: string, nowMs: number): Promise<void> {
    if (this.falhaCadastro) throw new Error('falha de infraestrutura simulada');
    if (this.usuarios.has(email)) return; // mesma saida do cadastro novo (anti-enumeracao)
    this.seq += 1;
    this.usuarios.set(email, {
      id: `u-${this.seq}`,
      email,
      password,
      verified: false,
      active: true,
    });
    const token = novoSegredo();
    this.links.set(token, { email, expiresAtMs: nowMs + 15 * MIN, used: false });
  }

  async confirmVerification(token: string, nowMs: number): Promise<boolean> {
    const link = this.links.get(token);
    if (!link || link.used || link.expiresAtMs <= nowMs) return false;
    link.used = true;
    const usuario = this.usuarios.get(link.email);
    if (usuario) usuario.verified = true;
    return true;
  }

  async loginGate(
    email: string,
    nowMs: number,
  ): Promise<{ kind: 'bloqueada'; retryAfterSeconds: number } | { kind: 'tentativa' }> {
    const estado = this.contadores.get(email) ?? LOGIN_THROTTLE_EMPTY;
    const portao = gateProfessionalLogin(estado, nowMs);
    this.contadores.set(email, portao.next);
    if (portao.kind === 'bloqueada') return { kind: 'bloqueada', retryAfterSeconds: portao.retryAfterSeconds };
    return { kind: 'tentativa' };
  }

  async verifyPassword(email: string, password: string): Promise<ProfessionalCredential | null> {
    this.verificacoes += 1;
    const usuario = this.usuarios.get(email);
    if (!usuario || usuario.password !== password) return null;
    return { userId: usuario.id, emailVerified: usuario.verified, active: usuario.active };
  }

  async loginSucceeded(email: string): Promise<void> {
    this.contadores.delete(email);
  }

  async openSession(_credential: ProfessionalCredential): Promise<{ secret: string }> {
    const secret = novoSegredo();
    this.sessoes.push(secret);
    return { secret };
  }
}

interface Resposta {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly text: string;
}

let server: Server | undefined;
let base = '';
const porta = new PortaMemoria();
let agora = T0;

function post(path: string, body: string, contentType = 'application/json'): Promise<Resposta> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: (server?.address() as AddressInfo).port,
        path,
        method: 'POST',
        headers: { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(partes).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

const json = (valor: unknown) => JSON.stringify(valor);

async function iniciar(): Promise<void> {
  server = createServer((req, res) => {
    void handleRequest(req, res, {
      tickSecret: undefined,
      professional: { port: porta, clock: { nowMs: () => agora } },
    });
  });
  await new Promise<void>((ok) => server?.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server?.address() as AddressInfo).port}`;
}

afterAll(async () => {
  await new Promise<void>((ok) => (server ? server.close(() => ok()) : ok()));
});

beforeEach(async () => {
  agora = T0;
  porta.usuarios.clear();
  porta.links.clear();
  porta.contadores.clear();
  porta.sessoes.length = 0;
  porta.verificacoes = 0;
  porta.falhaCadastro = false;
  if (!server) await iniciar();
});

/** Cria a conta e devolve o link de verificacao (o e-mail real nao sai dos testes). */
async function criarConta(email = EMAIL, senha = SENHA): Promise<string> {
  const r = await post('/v1/auth/professional/register', json({ email, password: senha }));
  expect(r.status).toBe(202);
  const token = [...porta.links.entries()].find(([, l]) => l.email === email.toLowerCase())?.[0];
  if (!token) throw new Error('link nao gerado');
  return token;
}

describe('T-H016-01 cadastro (CA-H016-01)', () => {
  it('cria conta nao verificada e enfileira o link (sem devolver senha)', async () => {
    const r = await post('/v1/auth/professional/register', json({ email: EMAIL, password: SENHA }));
    expect(r.status).toBe(202);
    expect(JSON.parse(r.text)).toEqual({ status: 'accepted' });
    expect(porta.usuarios.get(EMAIL)?.verified).toBe(false);
    expect(r.text).not.toContain(SENHA);
    expect(r.text).not.toContain(EMAIL);
  });
});

describe('T-H016-02 anti-enumeracao no cadastro (CA-H016-02)', () => {
  it('e-mail ja existente recebe o mesmo status, o mesmo corpo e nao troca a senha', async () => {
    await criarConta();
    const novo = await post('/v1/auth/professional/register', json({ email: 'outra@example.test', password: SENHA }));
    const existente = await post('/v1/auth/professional/register', json({ email: EMAIL, password: 'outra-senha-x' }));
    expect(existente.status).toBe(novo.status);
    expect(existente.text).toBe(novo.text);
    expect(porta.usuarios.get(EMAIL)?.password).toBe(SENHA);
  });
});

describe('T-H016-03 politica de senha no cadastro (CA-H016-03)', () => {
  it('recusa senha curta, comum e igual ao e-mail com 422 no campo, sem criar nada', async () => {
    const casos: Array<[string, string, string]> = [
      ['curta@example.test', 'Ab1-cd', 'curta'],
      ['comum@example.test', 'password123', 'comum'],
      ['igual@example.test', 'igual@example.test', 'igual_email'],
    ];
    for (const [email, senha, motivo] of casos) {
      const r = await post('/v1/auth/professional/register', json({ email, password: senha }));
      expect(r.status).toBe(422);
      expect(JSON.parse(r.text)).toEqual({ code: 'campo_invalido', campo: 'password', motivo });
      expect(r.text).not.toContain(senha);
    }
    expect(porta.usuarios.size).toBe(0);
  });

  it('recusa e-mail mal formado com 422 no campo e-mail', async () => {
    const r = await post('/v1/auth/professional/register', json({ email: 'sem-arroba', password: SENHA }));
    expect(r.status).toBe(422);
    expect(JSON.parse(r.text)).toEqual({ code: 'campo_invalido', campo: 'email', motivo: 'email' });
  });

  it('falha de infraestrutura devolve 503, nunca 202 falso', async () => {
    porta.falhaCadastro = true;
    const r = await post('/v1/auth/professional/register', json({ email: EMAIL, password: SENHA }));
    expect(r.status).toBe(503);
    expect(r.text).not.toContain(SENHA);
  });

  it('corpo fora de JSON: 415 sem JSON, 400 para texto invalido', async () => {
    expect((await post('/v1/auth/professional/register', 'x=1', 'text/plain')).status).toBe(415);
    expect((await post('/v1/auth/professional/register', '{nao-json')).status).toBe(400);
  });
});

describe('T-H016-07 e T-H016-08 verificacao do e-mail (CA-H016-07, CA-H016-08)', () => {
  it('confirma o link uma vez (204); reuso e link desconhecido devolvem o mesmo 410', async () => {
    const token = await criarConta();
    const ok = await post(PATH_CONFIRM, json({ token }));
    expect(ok.status).toBe(204);
    expect(porta.usuarios.get(EMAIL)?.verified).toBe(true);
    const reuso = await post(PATH_CONFIRM, json({ token }));
    const desconhecido = await post(PATH_CONFIRM, json({ token: 'a'.repeat(43) }));
    const malformado = await post(PATH_CONFIRM, json({ token: 'curto' }));
    expect(reuso.status).toBe(410);
    expect(desconhecido.text).toBe(reuso.text);
    expect(malformado.text).toBe(reuso.text);
    expect(JSON.parse(reuso.text)).toEqual({ code: 'link_invalid' });
  });

  it('link expirado aos 15 min devolve 410', async () => {
    const token = await criarConta();
    agora += 15 * MIN;
    const r = await post(PATH_CONFIRM, json({ token }));
    expect(r.status).toBe(410);
    expect(porta.usuarios.get(EMAIL)?.verified).toBe(false);
  });
});

describe('T-H016-11 login e anti-enumeracao (CA-H016-10, CA-H016-11, CA-H016-13)', () => {
  it('senha certa e conta verificada: 200, cookie de 7 dias e acesso completo', async () => {
    const token = await criarConta();
    await post(PATH_CONFIRM, json({ token }));
    const r = await post(PATH_LOGIN, json({ email: EMAIL, password: SENHA }));
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toEqual({ access_level: 'full', email_verified: true });
    const cookie = String(r.headers['set-cookie']);
    expect(cookie).toMatch(/^__Host-fp_sess=[A-Za-z0-9_-]{43};/);
    expect(cookie).toContain('Max-Age=604800');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('conta nao verificada entra so para verificar (verification_only)', async () => {
    await criarConta();
    const r = await post(PATH_LOGIN, json({ email: EMAIL, password: SENHA }));
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toEqual({ access_level: 'verification_only', email_verified: false });
  });

  it('senha errada e e-mail inexistente: mesma resposta', async () => {
    await criarConta();
    const errada = await post(PATH_LOGIN, json({ email: EMAIL, password: 'senha-errada-y' }));
    const inexistente = await post(PATH_LOGIN, json({ email: 'ninguem@example.test', password: 'senha-errada-y' }));
    expect(errada.status).toBe(401);
    expect(inexistente.status).toBe(401);
    expect(inexistente.text).toBe(errada.text);
    expect(JSON.parse(errada.text)).toEqual({ code: 'invalid_credentials' });
  });

  it('conta inativa com senha certa devolve 403 generico', async () => {
    await criarConta();
    const usuario = porta.usuarios.get(EMAIL);
    if (usuario) usuario.active = false;
    const r = await post(PATH_LOGIN, json({ email: EMAIL, password: SENHA }));
    expect(r.status).toBe(403);
    expect(JSON.parse(r.text)).toEqual({ code: 'account_unavailable' });
  });

  it('senha acima de 72 bytes ou corpo sem forma: 401 sem contar tentativa', async () => {
    const r = await post(PATH_LOGIN, json({ email: EMAIL, password: 'ç'.repeat(40) }));
    expect(r.status).toBe(401);
    expect(porta.contadores.size).toBe(0);
  });
});

describe('T-H016-12 bloqueio progressivo (CA-H016-12)', () => {
  it('quatro tentativas passam; a quinta espera 30 s, e a senha certa tambem recebe 429', async () => {
    await criarConta();
    for (let i = 0; i < 4; i++) {
      expect((await post(PATH_LOGIN, json({ email: EMAIL, password: 'senha-errada-x' }))).status).toBe(401);
    }
    const barrada = await post(PATH_LOGIN, json({ email: EMAIL, password: SENHA }));
    expect(barrada.status).toBe(429);
    expect(barrada.headers['retry-after']).toBe('30');
    expect(JSON.parse(barrada.text)).toEqual({ code: 'login_temporarily_blocked' });
  });

  it('apos a espera, a senha certa entra e zera o contador', async () => {
    await criarConta();
    for (let i = 0; i < 4; i++) await post(PATH_LOGIN, json({ email: EMAIL, password: 'senha-errada-x' }));
    expect((await post(PATH_LOGIN, json({ email: EMAIL, password: SENHA }))).status).toBe(429);
    agora += 31 * 1000;
    const r = await post(PATH_LOGIN, json({ email: EMAIL, password: SENHA }));
    expect(r.status).toBe(200);
    expect(porta.contadores.has(EMAIL)).toBe(false);
  });

  it('cada nova falha depois da espera dobra a espera (30 s, 60 s) e o pedido barrado nao conta', async () => {
    await criarConta();
    for (let i = 0; i < 4; i++) await post(PATH_LOGIN, json({ email: EMAIL, password: 'senha-errada-x' }));
    expect((await post(PATH_LOGIN, json({ email: EMAIL, password: 'senha-errada-x' }))).status).toBe(429);
    agora += 31 * 1000;
    expect((await post(PATH_LOGIN, json({ email: EMAIL, password: 'senha-errada-x' }))).status).toBe(401);
    agora += 31 * 1000;
    expect((await post(PATH_LOGIN, json({ email: EMAIL, password: 'senha-errada-x' }))).status).toBe(401);
    agora += 31 * 1000;
    const barrada = await post(PATH_LOGIN, json({ email: EMAIL, password: 'senha-errada-x' }));
    expect(barrada.status).toBe(429);
    expect(barrada.headers['retry-after']).toBe('29');
  });

  it('e-mail inexistente tambem conta e recebe a mesma espera', async () => {
    for (let i = 0; i < 4; i++) await post(PATH_LOGIN, json({ email: 'fantasma@example.test', password: 'senha-errada-x' }));
    const r = await post(PATH_LOGIN, json({ email: 'fantasma@example.test', password: 'senha-errada-x' }));
    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toBe('30');
  });

  it('50 tentativas simultaneas: exatamente 4 verificacoes reais e o resto recebe 429', async () => {
    await criarConta();
    const respostas = await Promise.all(
      Array.from({ length: 50 }, () => post(PATH_LOGIN, json({ email: EMAIL, password: 'senha-errada-x' }))),
    );
    const bloqueadas = respostas.filter((r) => r.status === 429).length;
    expect(porta.verificacoes).toBe(4);
    expect(bloqueadas).toBe(50 - 4);
  });
});

describe('T-H016-07 nenhuma senha ou e-mail em resposta de erro', () => {
  it('nenhuma resposta de login traz a senha enviada', async () => {
    await criarConta();
    const r = await post(PATH_LOGIN, json({ email: EMAIL, password: 'senha-errada-z' }));
    expect(r.text).not.toContain('senha-errada-z');
    expect(r.text).not.toContain(EMAIL);
  });
});

