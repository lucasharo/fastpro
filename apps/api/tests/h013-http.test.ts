// H-013 (Issue #26) | Provas HTTP em memoria (sem banco, sem rede): T-H013-01 (nonce no pedido), 04 e 05 (422
// uniforme), 06 e 07 (429 com Retry-After), 14 e 15 (identidade do rascunho), 16 (mesma conclusao do link),
// 18 (no-store). Servidor de loopback e dublês de armazenamento. Desenho: docs/factory/91-DESENHO-H013.md, §6.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-013');
};

import { afterAll, describe, expect, it } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import type { AccessDeps, ChallengeStore, RequestChallengeDeps, VerifyChallengeDeps } from '@fastpro/db';
import { RATE_LIMIT_DEFAULTS } from '@fastpro/domain';
import { handleRequest } from '../src/app.js';
import { createDraftHasher } from '../src/drafts/draft-hash.js';
import type { DraftDeps } from '../src/drafts/draft-service.js';
import type { DraftRouteOptions } from '../src/drafts/draft-route.js';
import { DRAFT_IDENTITY_PATH } from '../src/drafts/draft-route.js';
import { CHALLENGE_VERIFY_PATH } from '../src/challenge-verify-route.js';
import { CHALLENGE_REQUEST_PATH } from '../src/challenge-request-route.js';

const SITE = 'https://fastpro.example.test';
const ORIGEM = { Origin: SITE, 'Sec-Fetch-Site': 'same-origin' } as const;
const SEG = randomBytes(32).toString('base64url');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const PIMENTA = () => randomBytes(24).toString('base64url');
const servidores: Server[] = [];
afterAll(() => {
  for (const s of servidores) s.close();
});

async function servidor(opcoes: Record<string, unknown>): Promise<string> {
  const server = createServer((req, res) => {
    handleRequest(req, res, { tickSecret: undefined, ...opcoes } as never).catch(() => {
      res.statusCode = 500;
      res.end();
    });
  });
  servidores.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

interface Resp {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function chamar(base: string, metodo: string, caminho: string, corpo: string | undefined, cabecalhos: Record<string, string> = {}): Promise<Resp> {
  return new Promise((resolve, reject) => {
    const req = request(
      new URL(caminho, base),
      { method: metodo, headers: { ...(corpo !== undefined ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo) } : {}), ...cabecalhos } },
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

const LIMITES = { pedidoIpHora: 20, pedidoGlobalHora: 30, pedidoGlobalDia: 80, codigoIpHora: 50, erroCodigoDia: 15 };
const RELOGIO = { nowMs: () => Date.UTC(2099, 0, 1), sleep: async () => undefined };

// ---------------------------------------------------------------------------------------------------
// Pedido de acesso: nonce do navegador (T-H013-01).
// ---------------------------------------------------------------------------------------------------

function armazenamentoPedido(falhaBind = false) {
  const vinculos: Array<[string, string]> = [];
  const store = {
    create: async (input: { id: string }) => ({ resultado: 'criado', challengeId: input.id, outboxId: 'o1' }),
    request: async (input: { id: string }) => ({ resultado: 'criado', challengeId: input.id, outboxId: 'o1' }),
    findRow: async () => null,
    markDelivered: async () => undefined,
    bindNonce: async (id: string, hash: string) => {
      if (falhaBind) throw new Error('falha forcada');
      vinculos.push([id, hash]);
      return true;
    },
  } as unknown as ChallengeStore;
  return { store, vinculos };
}

function depsPedido(store: ChallengeStore, metricas: Array<[string, unknown]>): RequestChallengeDeps {
  return {
    store,
    secrets: { key: Buffer.alloc(32, 3), pepperEmail: PIMENTA(), pepperCode: PIMENTA() },
    clock: RELOGIO,
    dispatch: { schedule: () => undefined },
    rate: { pepperIp: PIMENTA(), limits: RATE_LIMIT_DEFAULTS, metric: (n: string, l: unknown) => metricas.push([n, l]) },
  };
}

const CORPO_PEDIDO = JSON.stringify({ email: 'cliente@example.test', purpose: 'publish' });

describe('T-H013-01: pedido grava o SHA-256 do cookie do rascunho como nonce', () => {
  it('com cookie valido: bindNonce recebe o SHA-256 do segredo (64 hex), nunca o segredo', async () => {
    const { store, vinculos } = armazenamentoPedido();
    const base = await servidor({ challengeRequest: { deps: depsPedido(store, []) } });
    const segredo = SEG;
    const r = await chamar(base, 'POST', CHALLENGE_REQUEST_PATH, CORPO_PEDIDO, { Cookie: `__Host-fp_draft=${segredo}` });
    expect(r.status).toBe(202);
    expect(vinculos).toHaveLength(1);
    expect(vinculos[0]?.[1]).toBe(sha(segredo));
    expect(vinculos[0]?.[1]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(vinculos)).not.toContain(segredo);
  });

  it('sem cookie ou com cookie malformado: nada e vinculado (nonce nulo), resposta igual 202', async () => {
    const { store, vinculos } = armazenamentoPedido();
    const base = await servidor({ challengeRequest: { deps: depsPedido(store, []) } });
    const semCookie = await chamar(base, 'POST', CHALLENGE_REQUEST_PATH, CORPO_PEDIDO);
    const malformado = await chamar(base, 'POST', CHALLENGE_REQUEST_PATH, CORPO_PEDIDO, { Cookie: '__Host-fp_draft=curto' });
    expect(semCookie.status).toBe(202);
    expect(malformado.status).toBe(202);
    expect(semCookie.body).toBe(malformado.body);
    expect(vinculos).toHaveLength(0);
  });

  it('falha forcada de bindNonce mantem 202 e registra so a metrica de codigo fixo', async () => {
    const { store } = armazenamentoPedido(true);
    const metricas: Array<[string, unknown]> = [];
    const base = await servidor({ challengeRequest: { deps: depsPedido(store, metricas) } });
    const r = await chamar(base, 'POST', CHALLENGE_REQUEST_PATH, CORPO_PEDIDO, { Cookie: `__Host-fp_draft=${SEG}` });
    expect(r.status).toBe(202);
    expect(JSON.parse(r.body)).toEqual({ status: 'recebido' });
    expect(metricas.map((m) => m[0])).toContain('nonce_vinculo_falha');
    expect(JSON.stringify(metricas)).not.toContain(SEG);
  });
});

// ---------------------------------------------------------------------------------------------------
// Verificacao do codigo: 422 uniforme, 429, identidade do acesso (T-H013-04, 05, 06, 07, 16, 18).
// ---------------------------------------------------------------------------------------------------

function armazenamentoCodigo(resultados: Array<'ok' | 'errado' | 'invalido' | 'bloqueado_codigo' | 'bloqueado_ip'>) {
  const fila = [...resultados];
  const chamadas: unknown[] = [];
  const store = {
    create: async () => {
      throw new Error('nao usado');
    },
    findRow: async () => null,
    markDelivered: async () => undefined,
    activeId: async () => '44444444-4444-4444-8444-444444444444',
    attemptCode: async (input: unknown) => {
      chamadas.push(input);
      const r = fila.shift() ?? 'invalido';
      if (r === 'ok') {
        return { resultado: 'ok', retryAfterSeconds: null, challengeId: '44444444-4444-4444-8444-444444444444', emailEnc: Buffer.from('blob'), draftId: null, attached: false };
      }
      return { resultado: r, retryAfterSeconds: r.startsWith('bloqueado') ? 60 : null };
    },
  } as unknown as ChallengeStore;
  return { store, chamadas };
}

function acessoDublê(opcoes: { conta?: 'ok' | 'falha'; etapa?: boolean } = {}) {
  const chamadas: string[] = [];
  const access: AccessDeps = {
    accounts: {
      ensureCustomer: async (email: string) => {
        chamadas.push(`conta:${email}`);
        return opcoes.conta === 'falha' ? { status: 'falha' } : { status: 'ok', userId: '22222222-2222-4222-8222-222222222222' };
      },
    },
    stages: {
      openStage: async (input) => {
        chamadas.push(`etapa:${input.challengeId}:${input.purpose}`);
        return opcoes.etapa ?? true;
      },
    },
    decryptEmail: () => 'cliente@example.test',
    clock: RELOGIO,
    newSecret: () => SEG,
    newSessionId: () => '33333333-3333-4333-8333-333333333333',
    accountDeadlineMs: 50,
  };
  return { access, chamadas };
}

function depsCodigo(store: ChallengeStore, access: AccessDeps, metricas: Array<[string, unknown]> = []): VerifyChallengeDeps {
  return {
    store,
    secrets: { key: Buffer.alloc(32, 3), pepperEmail: PIMENTA(), pepperCode: PIMENTA() },
    clock: RELOGIO,
    rate: { pepperIp: PIMENTA(), limits: LIMITES, metric: (n: string, l: unknown) => metricas.push([n, l]) },
    access,
  };
}

const CORPO_CODIGO = JSON.stringify({ email: 'cliente@example.test', code: '123456', purpose: 'login' });

describe('T-H013-04/05: 422 uniforme para os casos de codigo errado', () => {
  it('errado, invalido e formato ruim: mesmo status, cabecalhos (sem Date) e corpo byte a byte', async () => {
    const { store } = armazenamentoCodigo(['errado', 'invalido']);
    const base = await servidor({ challengeVerify: { deps: depsCodigo(store, acessoDublê().access), siteUrl: SITE } });
    const errado = await chamar(base, 'POST', CHALLENGE_VERIFY_PATH, CORPO_CODIGO, ORIGEM);
    const invalido = await chamar(base, 'POST', CHALLENGE_VERIFY_PATH, CORPO_CODIGO, ORIGEM);
    const formato = await chamar(base, 'POST', CHALLENGE_VERIFY_PATH, JSON.stringify({ email: 'cliente@example.test', code: '12345' }), ORIGEM);
    for (const r of [errado, invalido, formato]) {
      expect(r.status).toBe(422);
      expect(r.body).toBe(JSON.stringify({ code: 'codigo_invalido' }));
      expect(r.headers['cache-control']).toBe('no-store');
    }
    expect(errado.headers['content-type']).toBe(invalido.headers['content-type']);
  });

  it('cinco erros seguidos: cinco 422 identicos', async () => {
    const { store } = armazenamentoCodigo(['errado', 'errado', 'errado', 'errado', 'invalido']);
    const base = await servidor({ challengeVerify: { deps: depsCodigo(store, acessoDublê().access), siteUrl: SITE } });
    const corpos = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const r = await chamar(base, 'POST', CHALLENGE_VERIFY_PATH, CORPO_CODIGO, ORIGEM);
      expect(r.status).toBe(422);
      corpos.add(r.body);
    }
    expect(corpos.size).toBe(1);
  });
});

describe('T-H013-06/07: 429 com Retry-After, sem revelar a regra', () => {
  it('bloqueio por e-mail e por IP: 429, Retry-After presente e corpo do mesmo formato', async () => {
    const porEmail = armazenamentoCodigo(['bloqueado_codigo']);
    const porIp = armazenamentoCodigo(['bloqueado_ip']);
    const baseEmail = await servidor({ challengeVerify: { deps: depsCodigo(porEmail.store, acessoDublê().access), siteUrl: SITE } });
    const baseIp = await servidor({ challengeVerify: { deps: depsCodigo(porIp.store, acessoDublê().access), siteUrl: SITE } });
    const a = await chamar(baseEmail, 'POST', CHALLENGE_VERIFY_PATH, CORPO_CODIGO, ORIGEM);
    const b = await chamar(baseIp, 'POST', CHALLENGE_VERIFY_PATH, CORPO_CODIGO, ORIGEM);
    expect(a.status).toBe(429);
    expect(b.status).toBe(429);
    expect(a.headers['retry-after']).toBeDefined();
    expect(b.headers['retry-after']).toBeDefined();
    expect(Object.keys(JSON.parse(a.body))).toEqual(Object.keys(JSON.parse(b.body)));
    // O codigo generico (muitas_tentativas) vale para os dois casos; o corpo nao nomeia a regra barrada.
    expect(a.body).not.toMatch(/\bip\b|email|e-mail|por_ip|por_email/i);
  });
});

describe('T-H013-16: /verify conclui o acesso pela mesma funcao do link', () => {
  it('codigo certo chama conta e etapa com a mesma sequencia do link; falha de conta: 503 sem cookie', async () => {
    const { store } = armazenamentoCodigo(['ok']);
    const { access, chamadas } = acessoDublê();
    const base = await servidor({ challengeVerify: { deps: depsCodigo(store, access), siteUrl: SITE } });
    const r = await chamar(base, 'POST', CHALLENGE_VERIFY_PATH, CORPO_CODIGO, ORIGEM);
    expect(r.status).toBe(200);
    expect(chamadas).toEqual(['conta:cliente@example.test', 'etapa:44444444-4444-4444-8444-444444444444:login']);
    expect(String(r.headers['set-cookie'])).toMatch(/^__Host-fp_ident=/);

    const falhaConta = acessoDublê({ conta: 'falha' });
    const { store: s2 } = armazenamentoCodigo(['ok']);
    const base2 = await servidor({ challengeVerify: { deps: depsCodigo(s2, falhaConta.access), siteUrl: SITE } });
    const r2 = await chamar(base2, 'POST', CHALLENGE_VERIFY_PATH, CORPO_CODIGO, ORIGEM);
    expect(r2.status).toBe(503);
    expect(JSON.parse(r2.body)).toEqual({ code: 'acesso_indisponivel' });
    expect(r2.headers['set-cookie']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------
// Identidade do rascunho: PUT e GET (T-H013-14, 15) e no-store (T-H013-18).
// ---------------------------------------------------------------------------------------------------

function rascunhoFalso(): DraftDeps {
  const porHash = new Map<string, { first: string | null; email: string | null; hmac: string | null; verificado: boolean }>();
  porHash.set(sha(SEG), { first: null, email: null, hmac: null, verificado: false });
  const identidade = {
    identityGet: async (hash: string) => {
      const r = porHash.get(hash);
      return r ? { firstName: r.first, email: r.email, emailVerified: r.verificado } : null;
    },
    identitySet: async (input: { secretHash: string; firstName: string; email: string; emailHmac: string }) => {
      const r = porHash.get(input.secretHash);
      if (!r) return null;
      const mudou = r.hmac !== input.emailHmac;
      Object.assign(r, { first: input.firstName, email: input.email, hmac: input.emailHmac, verificado: mudou ? false : r.verificado });
      return { firstName: r.first, email: r.email, emailVerified: r.verificado };
    },
  };
  const store = {
    find: async () => null,
    create: async () => ({ ok: false, code: 'nao_encontrado' }),
    patch: async () => ({ ok: false, code: 'nao_encontrado' }),
    discard: async () => false,
  };
  const rate = { check: async () => ({ ok: true }), hit: async () => undefined };
  return {
    store,
    rate,
    hasher: createDraftHasher('k'.repeat(40)),
    newSecret: () => SEG,
    clock: RELOGIO,
    identity: { store: identidade, emailHmac: (e: string) => sha('pepper' + e) },
  } as unknown as DraftDeps;
}

const COOKIE = { Cookie: `__Host-fp_draft=${SEG}` };

describe('T-H013-14/15: identidade do rascunho por HTTP', () => {
  it('PUT grava nome e e-mail; GET devolve so nome, e-mail e confirmacao (sem HMAC, nonce ou id)', async () => {
    const opcoes: DraftRouteOptions = { deps: rascunhoFalso(), siteUrl: SITE };
    const base = await servidor({ drafts: opcoes });
    const put = await chamar(base, 'PUT', DRAFT_IDENTITY_PATH, JSON.stringify({ first_name: 'Ana', email: 'Cliente@Example.test' }), { ...ORIGEM, ...COOKIE });
    expect(put.status).toBe(200);
    expect(JSON.parse(put.body)).toEqual({ first_name: 'Ana', email: 'cliente@example.test', email_verified: false });
    const get = await chamar(base, 'GET', DRAFT_IDENTITY_PATH, undefined, COOKIE);
    expect(get.status).toBe(200);
    expect(JSON.parse(get.body)).toEqual({ first_name: 'Ana', email: 'cliente@example.test', email_verified: false });
    expect(get.body).not.toMatch(/email_hmac|browser_nonce|ip_hmac|hash/);
    expect(get.headers['cache-control']).toBe('no-store');
  });

  it('chave extra, corpo vazio, nome e e-mail invalidos: 422 sem gravar; sem cookie: 404 sem banco', async () => {
    const opcoes: DraftRouteOptions = { deps: rascunhoFalso(), siteUrl: SITE };
    const base = await servidor({ drafts: opcoes });
    const extra = await chamar(base, 'PUT', DRAFT_IDENTITY_PATH, JSON.stringify({ first_name: 'Ana', email: 'a@example.test', status: 'x' }), { ...ORIGEM, ...COOKIE });
    const vazio = await chamar(base, 'PUT', DRAFT_IDENTITY_PATH, '{}', { ...ORIGEM, ...COOKIE });
    const nome = await chamar(base, 'PUT', DRAFT_IDENTITY_PATH, JSON.stringify({ first_name: 'A1', email: 'a@example.test' }), { ...ORIGEM, ...COOKIE });
    const email = await chamar(base, 'PUT', DRAFT_IDENTITY_PATH, JSON.stringify({ first_name: 'Ana', email: 'sem-arroba' }), { ...ORIGEM, ...COOKIE });
    expect(JSON.parse(extra.body)).toEqual({ code: 'campo_desconhecido' });
    expect(vazio.status).toBe(422);
    expect(JSON.parse(nome.body)).toEqual({ code: 'nome_invalido' });
    expect(JSON.parse(email.body)).toEqual({ code: 'email_invalido' });
    const semCookie = await chamar(base, 'GET', DRAFT_IDENTITY_PATH, undefined, {});
    expect(semCookie.status).toBe(404);
    expect(JSON.parse(semCookie.body)).toEqual({ code: 'nao_encontrado' });
  });

  it('PATCH de rascunho com email ou first_name segue 422 campo_desconhecido (H-025 nao ganha campos)', async () => {
    const opcoes: DraftRouteOptions = { deps: rascunhoFalso(), siteUrl: SITE };
    const base = await servidor({ drafts: opcoes });
    const r = await chamar(base, 'PATCH', '/v1/drafts/current', JSON.stringify({ email: 'a@example.test' }), { ...ORIGEM, ...COOKIE });
    expect(r.status).toBe(422);
    expect(JSON.parse(r.body)).toEqual({ code: 'campo_desconhecido' });
  });
});
