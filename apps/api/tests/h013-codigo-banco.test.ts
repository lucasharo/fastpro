// H-013 (Issue #26) | T-H013-03 por HTTP com banco real (docs/factory/91-DESENHO-H013.md, §6).
// O servidor de loopback usa o armazenamento Pg real (PgChallengeStore) sobre o banco de desenvolvimento. Dados
// sinteticos com hashes aleatorios; o que foi gravado e removido no afterAll (commit real + limpeza). Contas e
// sessao (Auth e etapa) ficam como dublê, porque dependem do Supabase Auth: esta prova cobre o codigo, nao a conta.
// A URL do banco vem de .env.local (ou do ambiente) e nunca e impressa.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-013');
};

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import pg from 'pg';
import { PgChallengeStore, challengeHmacHex, type AccessDeps, type VerifyChallengeDeps } from '@fastpro/db';
import { RATE_LIMIT_DEFAULTS, rateKeyMessage } from '@fastpro/domain';
import { handleRequest } from '../src/app.js';
import { CHALLENGE_VERIFY_PATH } from '../src/challenge-verify-route.js';

const SITE = 'https://fastpro.example.test';
const ORIGEM = { Origin: SITE, 'Sec-Fetch-Site': 'same-origin' } as const;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const rnd = () => randomBytes(12).toString('hex');
const SEGREDO = randomBytes(32).toString('base64url'); // cookie do rascunho (43 caracteres)
const SEGREDO_IDENT = randomBytes(32).toString('base64url');
const PEPPER_EMAIL = 'dummy-pepper-email-h13-http-' + rnd();
const PEPPER_CODE = 'dummy-pepper-code-h13-http-' + rnd();
const PEPPER_IP = 'dummy-pepper-ip-h13-http-' + rnd();
const CODIGO = '123456';
const EMAIL = `cliente-${rnd()}@example.test`;
const IP_LOOPBACK = '127.0.0.1';

/** Le a URL do banco de desenvolvimento sem imprimir: primeiro o ambiente, depois .env.local. */
function urlDoBanco(): string {
  if (process.env.DATABASE_URL_MIGRATIONS) return process.env.DATABASE_URL_MIGRATIONS;
  const arquivo = new URL('../../../.env.local', import.meta.url);
  if (!existsSync(arquivo)) throw new Error('DATABASE_URL_MIGRATIONS ausente');
  for (const linha of readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const m = /^DATABASE_URL_MIGRATIONS=(.*)$/.exec(linha.trim());
    if (m) return m[1]!.replace(/^['"]|['"]$/g, '');
  }
  throw new Error('DATABASE_URL_MIGRATIONS ausente');
}

let client: pg.Client;
const ids = { desafio: randomUUID(), rascunho: '' as string };
const emailHash = challengeHmacHex(PEPPER_EMAIL, EMAIL);
const cookieHash = sha(SEGREDO);
const ipKey = challengeHmacHex(PEPPER_IP, rateKeyMessage('codigo', 'ip', IP_LOOPBACK));
const emailKey = challengeHmacHex(PEPPER_EMAIL, rateKeyMessage('erro_codigo', 'email', EMAIL));
const servidores: Server[] = [];

beforeAll(async () => {
  client = new pg.Client({ connectionString: urlDoBanco(), application_name: 'fastpro-h013-http' });
  await client.connect();
  const agora = Date.now();
  await client.query(
    `insert into app.auth_challenge (id, email_hash, purpose, token_hash, code_hmac, email_enc, secrets_enc,
       browser_nonce_hash, expires_at, created_at)
     values ($1, $2, 'publish', $3, $4, $5, $6, $7, $8, $9)`,
    [ids.desafio, emailHash, sha('tok-' + ids.desafio), challengeHmacHex(PEPPER_CODE, `${ids.desafio}|${CODIGO}`),
      Buffer.from('e'), Buffer.from('s'), cookieHash, new Date(agora + 15 * 60000).toISOString(), new Date(agora).toISOString()],
  );
  const r = await client.query(
    `insert into app.request_draft (browser_nonce_hash, ip_hmac, status, expires_at, created_at, updated_at,
       email, email_hmac)
     values ($1, $2, 'aguardando_email', $3, $4, $4, $6, $5) returning id`,
    [cookieHash, sha('ip-h13-http'), new Date(agora + 7 * 86400000).toISOString(), new Date(agora).toISOString(), emailHash, EMAIL],
  );
  ids.rascunho = r.rows[0].id as string;
});

afterAll(async () => {
  for (const s of servidores) s.close();
  if (client) {
    await client.query('delete from app.auth_challenge where id = $1', [ids.desafio]).catch(() => undefined);
    if (ids.rascunho) await client.query('delete from app.request_draft where id = $1', [ids.rascunho]).catch(() => undefined);
    await client.query('delete from ops.rate_counter where key_hmac = any($1::text[])', [[ipKey, emailKey]]).catch(() => undefined);
    await client.query('delete from ops.code_lock where key_hmac = any($1::text[])', [[emailKey]]).catch(() => undefined);
    await client.end().catch(() => undefined);
  }
});

const acesso: AccessDeps = {
  accounts: { ensureCustomer: async () => ({ status: 'ok', userId: '22222222-2222-4222-8222-222222222222' }) },
  stages: { openStage: async () => true },
  decryptEmail: () => EMAIL,
  clock: { nowMs: () => Date.now() },
  newSecret: () => SEGREDO_IDENT,
  newSessionId: () => randomUUID(),
  accountDeadlineMs: 2000,
};

async function servidorReal(): Promise<string> {
  const deps: VerifyChallengeDeps = {
    store: new PgChallengeStore(client),
    secrets: { key: Buffer.alloc(32, 7), pepperEmail: PEPPER_EMAIL, pepperCode: PEPPER_CODE },
    clock: { nowMs: () => Date.now(), sleep: async () => undefined },
    rate: { pepperIp: PEPPER_IP, limits: RATE_LIMIT_DEFAULTS },
    access: acesso,
  };
  const server = createServer((req, res) => {
    handleRequest(req, res, { tickSecret: undefined, challengeVerify: { deps, siteUrl: SITE } } as never).catch(() => {
      res.statusCode = 500;
      res.end();
    });
  });
  servidores.push(server);
  await new Promise<void>((resolve) => server.listen(0, IP_LOOPBACK, () => resolve()));
  return `http://${IP_LOOPBACK}:${(server.address() as AddressInfo).port}`;
}

function postar(base: string, corpo: string, cabecalhos: Record<string, string>): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      new URL(CHALLENGE_VERIFY_PATH, base),
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo), ...cabecalhos } },
      (res) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(partes).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.end(corpo);
  });
}

describe('T-H013-03 por HTTP com banco real', () => {
  it('codigo certo: 200 codigo_ok e cookie de etapa; banco consumido e anexado; segundo envio: 422', async () => {
    const base = await servidorReal();
    const corpo = JSON.stringify({ email: EMAIL, code: CODIGO, purpose: 'publish' });
    const primeiro = await postar(base, corpo, { ...ORIGEM, Cookie: `__Host-fp_draft=${SEGREDO}` });
    expect(primeiro.status).toBe(200);
    expect(primeiro.body).toBe(JSON.stringify({ status: 'codigo_ok' }));
    expect(String(primeiro.headers['set-cookie'])).toMatch(/^__Host-fp_ident=[A-Za-z0-9_-]{43}; HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=900$/);

    const linha = (
      await client.query('select consumed_at, email_enc, secrets_enc from app.auth_challenge where id = $1', [ids.desafio])
    ).rows[0];
    expect(linha.consumed_at).not.toBeNull();
    expect(linha.email_enc).toBeNull();
    expect(linha.secrets_enc).toBeNull();
    const rascunho = (await client.query('select status, email_verified_at from app.request_draft where id = $1', [ids.rascunho])).rows[0];
    expect(rascunho.email_verified_at).not.toBeNull();
    expect(rascunho.status).toBe('aberto');

    const segundo = await postar(base, corpo, { ...ORIGEM, Cookie: `__Host-fp_draft=${SEGREDO}` });
    expect(segundo.status).toBe(422);
    expect(segundo.body).toBe(JSON.stringify({ code: 'codigo_invalido' }));
    expect(segundo.headers['set-cookie']).toBeUndefined();
  });
});
