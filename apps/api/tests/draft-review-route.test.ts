// H-030 (Issue #43) | Rotas GET /v1/drafts/current/review e POST /v1/drafts/current/confirm (docs/factory/90-DESENHO-H030.md,
// §2 e §7.2: T-API01 a T-API09, em forma reduzida). Servidor de loopback com porta de revisao em memoria
// que segue as mesmas regras da funcao SQL. Fetch global bloqueado. Dados sinteticos (@example.test).
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-030');
};

import { afterAll, describe, expect, it } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  DRAFT_CURRENT_PATH,
  DRAFT_CONFIRM_PATH,
  DRAFT_REVIEW_PATH,
  draftMissingForReview,
  type DraftConfirmInput,
  type DraftConfirmResult,
  type DraftRatePolicy,
  type DraftRatePort,
  type DraftRateCheck,
  type DraftReviewRecord,
  type DraftReviewStorePort,
  type DraftStorePort,
} from '@fastpro/domain';
import { handleRequest } from '../src/app.js';
import { createDraftHasher } from '../src/drafts/draft-hash.js';
import type { DraftDeps } from '../src/drafts/draft-service.js';

const SITE = 'https://fastpro.example.test';
const CHAVE_IP = 'k'.repeat(40);
const T0 = Date.UTC(2026, 10, 12, 12, 0, 0);
const DIA = 86_400_000;
const COOKIE = '__Host-fp_draft';
const segredo = (i: number): string => String(i).padStart(43, 'B');
const SERVICO = '0c9e2f7a-3b1d-4e8f-9a6b-1f2e3d4c5b6a';

/** Porta de revisao em memoria: rascunhos por hash do cookie; mesma ordem de recusas da funcao SQL. */
class MemReview implements DraftReviewStorePort {
  readonly linhas = new Map<string, DraftReviewRecord & { expiresMs: number; criadoMs: number }>();
  leituras = 0;
  confirmacoes = 0;

  private vivo(hash: string, now: number): (DraftReviewRecord & { expiresMs: number; criadoMs: number }) | null {
    const l = this.linhas.get(hash);
    if (!l || (l.status !== 'aberto' && l.status !== 'aguardando_email') || l.expiresMs <= now) return null;
    return l;
  }

  async reviewGet(hash: string, now: number): Promise<DraftReviewRecord | null> {
    this.leituras++;
    return this.vivo(hash, now);
  }

  async confirm(input: DraftConfirmInput): Promise<DraftConfirmResult> {
    this.confirmacoes++;
    const l = this.vivo(input.secretHash, input.nowMs);
    if (!l) return { kind: 'nao_encontrado' };
    const faltam = draftMissingForReview({
      serviceId: l.serviceActive ? l.serviceId : null,
      addressText: l.addressText,
      urgency: l.urgency,
      description: l.description,
      firstName: l.firstName,
      email: l.email,
    });
    if (faltam.length > 0) return { kind: 'campos_faltando', missing: faltam };
    if (!l.emailVerified || l.status !== 'aberto') return { kind: 'email_nao_confirmado' };
    if (input.contentRev !== l.contentRev) return { kind: 'conteudo_alterado' };
    if (l.confirmedAt === null) {
      l.confirmedAt = new Date(input.nowMs).toISOString();
      l.expiresMs = Math.min(input.nowMs + input.ttlDays * DIA, l.criadoMs + 30 * DIA);
    }
    return { kind: 'ok', confirmedAt: l.confirmedAt, contentRev: l.contentRev };
  }
}

/** Limite em memoria: conta so quando o pedido e aceito (hit). */
class MemRate implements DraftRatePort {
  readonly eventos = new Map<string, number[]>();
  async check(policy: DraftRatePolicy, key: string, now: number): Promise<DraftRateCheck> {
    const k = `${policy.id}|${key}`;
    const ts = (this.eventos.get(k) ?? []).filter((t) => t > now - policy.spanS * 1000);
    if (ts.length < policy.limit) return { ok: true };
    return { ok: false, retryAfterS: policy.spanS };
  }
  async hit(policy: DraftRatePolicy, key: string, now: number): Promise<void> {
    const k = `${policy.id}|${key}`;
    const ts = (this.eventos.get(k) ?? []).filter((t) => t > now - policy.spanS * 1000);
    ts.push(now);
    this.eventos.set(k, ts);
  }
}

const servidores: Server[] = [];
const hasher = createDraftHasher(CHAVE_IP);

async function iniciar(): Promise<{ porta: number; review: MemReview; rate: MemRate; relogio: { agora: number } }> {
  const review = new MemReview();
  const rate = new MemRate();
  const relogio = { agora: T0 };
  const deps: DraftDeps = {
    // Rotas de revisao nao usam o armazenamento de H-025: porta inerte.
    store: {} as DraftStorePort,
    rate,
    hasher,
    newSecret: () => segredo(1),
    clock: { nowMs: () => relogio.agora },
    review,
  };
  const server = createServer((req, res) => {
    handleRequest(req, res, { tickSecret: undefined, drafts: { deps, siteUrl: SITE } }).catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  servidores.push(server);
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return { porta: (server.address() as AddressInfo).port, review, rate, relogio };
}

afterAll(async () => {
  await Promise.all(servidores.map((s) => new Promise<void>((ok) => s.close(() => ok()))));
});

interface Resposta {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

interface Pedido {
  readonly cookie?: string | null;
  readonly corpo?: unknown;
  readonly textoBruto?: string;
  readonly tipo?: string | null;
  readonly origem?: string | null;
}

function chamar(porta: number, metodo: string, caminho: string, p: Pedido = {}): Promise<Resposta> {
  const headers: Record<string, string> = { 'Sec-Fetch-Site': 'same-origin' };
  if (p.origem !== null) headers['Origin'] = p.origem ?? SITE;
  const comCorpo = p.corpo !== undefined || p.textoBruto !== undefined;
  const texto = p.textoBruto ?? (p.corpo === undefined ? '' : JSON.stringify(p.corpo));
  if (comCorpo) {
    if (p.tipo !== null) headers['Content-Type'] = p.tipo ?? 'application/json';
    headers['Content-Length'] = String(Buffer.byteLength(texto));
  }
  if (p.cookie) headers['Cookie'] = p.cookie;
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: porta, method: metodo, path: caminho, headers }, (res) => {
      const partes: Buffer[] = [];
      res.on('data', (c: Buffer) => partes.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(partes).toString('utf8') }),
      );
    });
    req.on('error', reject);
    if (comCorpo) req.write(texto);
    req.end();
  });
}

const enviaCookie = (s: string): string => `${COOKIE}=${s}`;

/** Cabecalhos sem os que variam por conexao ou data (para comparar 404 byte a byte). */
function assinatura(r: Resposta): string {
  const ignorar = new Set(['date', 'connection', 'keep-alive']);
  return JSON.stringify({
    status: r.status,
    body: r.body,
    headers: Object.keys(r.headers)
      .filter((k) => !ignorar.has(k))
      .sort()
      .map((k) => [k, r.headers[k]]),
  });
}

/** Rascunho completo e verificado, na porta em memoria, com o cookie dado. */
function pronto(review: MemReview, hash: string, sobre: Partial<DraftReviewRecord> = {}, criadoMs = T0): void {
  review.linhas.set(hash, {
    id: `rascunho-${hash.slice(0, 6)}`,
    status: 'aberto',
    serviceId: SERVICO,
    serviceName: 'Eletricista sintetico',
    serviceActive: true,
    addressText: 'Rua Sintetica 100',
    urgency: 'imediato',
    description: 'Torneira vazando',
    firstName: 'Ana',
    email: 'ana@example.test',
    emailVerified: true,
    confirmedAt: null,
    contentRev: 0,
    expiresAt: new Date(criadoMs + 7 * DIA).toISOString(),
    expiresMs: criadoMs + 7 * DIA,
    criadoMs,
    ...sobre,
  });
}

const hashDe = (s: string): string => hasher.secretHash(s);

describe('T-API02 404 uniforme (sem cookie, malformado, de outro, inexistente)', () => {
  it('GET review e POST confirm devolvem bytes iguais ao 404 de GET /drafts/current', async () => {
    const m = await iniciar();
    const referencia = assinatura(await chamar(m.porta, 'GET', DRAFT_CURRENT_PATH));
    const casos: Array<Pedido> = [{}, { cookie: enviaCookie('curto') }, { cookie: enviaCookie(segredo(9)) }];
    for (const p of casos) {
      expect(assinatura(await chamar(m.porta, 'GET', DRAFT_REVIEW_PATH, p))).toBe(referencia);
    }
    const confirmacao = await chamar(m.porta, 'POST', DRAFT_CONFIRM_PATH, {
      cookie: enviaCookie(segredo(9)),
      corpo: { content_rev: 0 },
    });
    expect(assinatura(confirmacao)).toBe(referencia);
    // A funcao so responde "nao encontrado" (sem gravar nada): nenhum rascunho foi tocado.
    expect(m.review.linhas.size).toBe(0);
  });

  it('cookie malformado nao toca o banco', async () => {
    const m = await iniciar();
    await chamar(m.porta, 'GET', DRAFT_REVIEW_PATH, { cookie: enviaCookie('x') });
    expect(m.review.leituras).toBe(0);
  });
});

describe('T-API01 GET review: lista fechada, 422 na ordem, 409 sem dado do pedido', () => {
  it('200 com as chaves exatas e sem coordenada, IP, telefone ou fotos', async () => {
    const m = await iniciar();
    const s = segredo(2);
    pronto(m.review, hashDe(s));
    const r = await chamar(m.porta, 'GET', DRAFT_REVIEW_PATH, { cookie: enviaCookie(s) });
    expect(r.status).toBe(200);
    const corpo = JSON.parse(r.body) as Record<string, unknown>;
    expect(Object.keys(corpo).sort()).toEqual(
      ['address_text', 'confirmed_at', 'content_rev', 'description', 'email', 'expires_at', 'first_name', 'id', 'service', 'urgency'].sort(),
    );
    expect(r.body).not.toMatch(/"(lat|lon|point|ip_hmac|browser_nonce_hash|phone|photos)"/);
    expect(corpo['confirmed_at']).toBeNull();
  });

  it('422 com missing na ordem de DRAFT_REVIEW_FIELDS', async () => {
    const m = await iniciar();
    const s = segredo(3);
    pronto(m.review, hashDe(s), { addressText: null, firstName: null });
    const r = await chamar(m.porta, 'GET', DRAFT_REVIEW_PATH, { cookie: enviaCookie(s) });
    expect(r.status).toBe(422);
    expect(JSON.parse(r.body)).toEqual({ code: 'campos_faltando', missing: ['address_text', 'first_name'] });
  });

  it('409 email_nao_confirmado sem nenhum dado do pedido', async () => {
    const m = await iniciar();
    const s = segredo(4);
    pronto(m.review, hashDe(s), { emailVerified: false });
    const r = await chamar(m.porta, 'GET', DRAFT_REVIEW_PATH, { cookie: enviaCookie(s) });
    expect(r.status).toBe(409);
    expect(JSON.parse(r.body)).toEqual({ code: 'email_nao_confirmado' });
  });

  it('GET review nunca confirma (nenhuma chamada de confirm)', async () => {
    const m = await iniciar();
    const s = segredo(5);
    pronto(m.review, hashDe(s));
    await chamar(m.porta, 'GET', DRAFT_REVIEW_PATH, { cookie: enviaCookie(s) });
    expect(m.review.confirmacoes).toBe(0);
    expect(m.review.linhas.get(hashDe(s))?.confirmedAt).toBeNull();
  });
});

describe('T-API04/05 POST confirm: corpo, resposta fechada e idempotencia', () => {
  it('confirma: 200 com status confirmado e sem palavra de publicacao', async () => {
    const m = await iniciar();
    const s = segredo(6);
    pronto(m.review, hashDe(s));
    const r = await chamar(m.porta, 'POST', DRAFT_CONFIRM_PATH, { cookie: enviaCookie(s), corpo: { content_rev: 0 } });
    expect(r.status).toBe(200);
    const corpo = JSON.parse(r.body) as { status: string; confirmed_at: string; content_rev: number };
    expect(corpo.status).toBe('confirmado');
    expect(corpo.content_rev).toBe(0);
    expect(r.body).not.toMatch(/publicad|service_request|expires_at|prazo/i);
  });

  it('repeticao e 10 chamadas seguidas devolvem o mesmo confirmed_at', async () => {
    const m = await iniciar();
    const s = segredo(7);
    pronto(m.review, hashDe(s));
    const primeira = JSON.parse((await chamar(m.porta, 'POST', DRAFT_CONFIRM_PATH, { cookie: enviaCookie(s), corpo: { content_rev: 0 } })).body);
    m.relogio.agora = T0 + 5_000;
    for (let i = 0; i < 9; i++) {
      const r = await chamar(m.porta, 'POST', DRAFT_CONFIRM_PATH, { cookie: enviaCookie(s), corpo: { content_rev: 0 } });
      expect(r.status).toBe(200);
      expect(JSON.parse(r.body).confirmed_at).toBe(primeira.confirmed_at);
    }
  });

  it('corpo com chave extra, tipo errado ou vazio: 422 corpo_invalido', async () => {
    const m = await iniciar();
    const s = segredo(8);
    pronto(m.review, hashDe(s));
    const ruins: Pedido[] = [
      { corpo: { content_rev: 0, status: 'publicado' } },
      { corpo: { content_rev: '0' } },
      { corpo: {} },
      { corpo: { content_rev: -1 } },
    ];
    for (const p of ruins) {
      const r = await chamar(m.porta, 'POST', DRAFT_CONFIRM_PATH, { cookie: enviaCookie(s), ...p });
      expect(r.status).toBe(422);
      expect(JSON.parse(r.body)).toEqual({ code: 'corpo_invalido' });
    }
    expect(m.review.linhas.get(hashDe(s))?.confirmedAt).toBeNull();
  });

  it('corpo acima de 1 KB: 413; sem JSON: 415; origem invalida: 403', async () => {
    const m = await iniciar();
    const s = segredo(10);
    pronto(m.review, hashDe(s));
    const grande = await chamar(m.porta, 'POST', DRAFT_CONFIRM_PATH, {
      cookie: enviaCookie(s),
      textoBruto: JSON.stringify({ content_rev: 0, x: 'a'.repeat(1100) }),
    });
    expect(grande.status).toBe(413);
    const semJson = await chamar(m.porta, 'POST', DRAFT_CONFIRM_PATH, { cookie: enviaCookie(s), textoBruto: '{}', tipo: 'text/plain' });
    expect(semJson.status).toBe(415);
    const origem = await chamar(m.porta, 'POST', DRAFT_CONFIRM_PATH, {
      cookie: enviaCookie(s),
      corpo: { content_rev: 0 },
      origem: 'https://atacante.example.test',
    });
    expect(origem.status).toBe(403);
  });
});

describe('T-API06/07 conteudo alterado e limite de taxa', () => {
  it('versao velha: 409 conteudo_alterado; a versao atual confirma', async () => {
    const m = await iniciar();
    const s = segredo(11);
    pronto(m.review, hashDe(s), { contentRev: 2 });
    const velha = await chamar(m.porta, 'POST', DRAFT_CONFIRM_PATH, { cookie: enviaCookie(s), corpo: { content_rev: 1 } });
    expect(velha.status).toBe(409);
    expect(JSON.parse(velha.body)).toEqual({ code: 'conteudo_alterado' });
    const atual = await chamar(m.porta, 'POST', DRAFT_CONFIRM_PATH, { cookie: enviaCookie(s), corpo: { content_rev: 2 } });
    expect(atual.status).toBe(200);
  });

  it('11a confirmacao em 60 s por rascunho: 429 com Retry-After e sem revelar o limite', async () => {
    const m = await iniciar();
    const s = segredo(12);
    pronto(m.review, hashDe(s));
    // Acerta a janela direto no limite de entrada: 10 aceitas e a 11a barrada.
    for (let i = 0; i < 10; i++) {
      await m.rate.hit({ id: 'confirmar_rascunho', spanS: 60, bucketS: 10, limit: 10 }, hashDe(s), T0);
    }
    const r = await chamar(m.porta, 'POST', DRAFT_CONFIRM_PATH, { cookie: enviaCookie(s), corpo: { content_rev: 0 } });
    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toBeDefined();
    // O corpo so traz o codigo fixo e o tempo de espera (Retry-After), nunca o tamanho do limite.
    expect(JSON.parse(r.body)).toEqual({ code: 'muitos_pedidos', retry_after_seconds: 60 });
    expect(r.body).not.toMatch(/limit|limite/i);
  });
});

describe('T-API08 privacidade: nome, e-mail e descricao nunca vao para o log', () => {
  it('a resposta de erro nao ecoa o corpo de entrada', async () => {
    const m = await iniciar();
    const s = segredo(13);
    pronto(m.review, hashDe(s));
    const r = await chamar(m.porta, 'POST', DRAFT_CONFIRM_PATH, {
      cookie: enviaCookie(s),
      corpo: { content_rev: 0, email: 'sentinela@example.test' },
    });
    expect(r.body).not.toContain('sentinela');
  });
});
