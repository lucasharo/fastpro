// H-025 | Rotas do rascunho sem conta com banco e cookie em memoria (docs/factory/74-DESENHO-H025.md, §4;
// D-01 a D-04, D-07, D-08, D-09, D-03 e CA-01..CA-03, CA-05, CA-06, CA-09, CA-10).
// Servidor de loopback e cliente node:http; fetch global bloqueado. Dados sinteticos (@example.test).
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-025');
};

import { afterAll, describe, expect, it } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  DRAFT_CURRENT_PATH,
  DRAFT_PATH,
  type DraftCreateInput,
  type DraftPatchInput,
  type DraftRatePolicy,
  type DraftRatePort,
  type DraftRateCheck,
  type DraftRecord,
  type DraftStoreError,
  type DraftStorePort,
  type DraftWriteResult,
} from '@fastpro/domain';
import { handleRequest } from '../src/app.js';
import { createDraftHasher } from '../src/drafts/draft-hash.js';
import type { DraftDeps } from '../src/drafts/draft-service.js';

const SITE = 'https://fastpro.example.test';
const CHAVE_IP = 'k'.repeat(40);
const SERVICO_ATIVO = '0c9e2f7a-3b1d-4e8f-9a6b-1f2e3d4c5b6a';
const SERVICO_INEXISTENTE = '11111111-2222-4333-8444-555555555555';
const T0 = Date.UTC(2026, 10, 11, 12, 0, 0);
const DIA = 86_400_000;
const HORA = 3_600_000;
const COOKIE = '__Host-fp_draft';
const IP_CLIENTE = '203.0.113.7';

/** Segredo sintetico de 43 caracteres base64url (digitos completam o tamanho). */
const segredo = (i: number): string => String(i).padStart(43, 'B');

interface Linha {
  id: string;
  status: 'aberto' | 'aguardando_email' | 'descartado' | 'publicado';
  serviceId: string | null;
  addressText: string | null;
  urgency: string | null;
  description: string | null;
  createdMs: number;
  expiresMs: number;
  updatedMs: number;
}

/** Banco em memoria: mesmas regras das funcoes SQL (prazo, teto, descarte, servico ativo). */
class MemStore implements DraftStorePort {
  readonly linhas = new Map<string, Linha>();
  readonly servicos = new Set<string>([SERVICO_ATIVO]);
  /** Chamadas que chegariam ao banco. Usado para provar "sem ir ao banco". */
  chamadas = 0;
  private seq = 0;

  private vivo(l: Linha, now: number): boolean {
    return (l.status === 'aberto' || l.status === 'aguardando_email') && l.expiresMs > now;
  }

  private rec(l: Linha): DraftRecord {
    return {
      id: l.id,
      status: l.status,
      serviceId: l.serviceId,
      addressText: l.addressText,
      urgency: l.urgency as DraftRecord['urgency'],
      description: l.description,
      expiresAt: new Date(l.expiresMs).toISOString(),
      updatedAt: new Date(l.updatedMs).toISOString(),
    };
  }

  private aplicar(l: Linha, fields: DraftCreateInput['fields']): DraftStoreError | null {
    if (fields.service_id !== undefined && fields.service_id !== null && !this.servicos.has(fields.service_id)) {
      return 'servico_invalido';
    }
    if (fields.service_id !== undefined) l.serviceId = fields.service_id;
    if (fields.address_text !== undefined) l.addressText = fields.address_text;
    if (fields.urgency !== undefined) l.urgency = fields.urgency;
    if (fields.description !== undefined) l.description = fields.description;
    return null;
  }

  async find(hash: string, now: number): Promise<DraftRecord | null> {
    this.chamadas++;
    const l = this.linhas.get(hash);
    return l && this.vivo(l, now) ? this.rec(l) : null;
  }

  async create(input: DraftCreateInput): Promise<DraftWriteResult> {
    this.chamadas++;
    if (input.expiredSecretHash !== null) {
      const velho = this.linhas.get(input.expiredSecretHash);
      if (velho && velho.status === 'aberto' && velho.expiresMs <= input.nowMs) velho.status = 'descartado';
    }
    const l: Linha = {
      id: `rascunho-${++this.seq}`,
      status: 'aberto',
      serviceId: null,
      addressText: null,
      urgency: null,
      description: null,
      createdMs: input.nowMs,
      expiresMs: input.nowMs + 7 * DIA,
      updatedMs: input.nowMs,
    };
    const erro = this.aplicar(l, input.fields);
    if (erro) return { ok: false, code: erro };
    this.linhas.set(input.secretHash, l);
    return { ok: true, draft: this.rec(l) };
  }

  async patch(input: DraftPatchInput): Promise<DraftWriteResult> {
    this.chamadas++;
    const l = this.linhas.get(input.secretHash);
    if (!l || !this.vivo(l, input.nowMs)) return { ok: false, code: 'nao_encontrado' };
    const erro = this.aplicar(l, input.fields);
    if (erro) return { ok: false, code: erro };
    l.updatedMs = input.nowMs;
    l.expiresMs = Math.min(input.nowMs + 7 * DIA, l.createdMs + 30 * DIA);
    return { ok: true, draft: this.rec(l) };
  }

  async discard(hash: string, now: number): Promise<boolean> {
    this.chamadas++;
    const l = this.linhas.get(hash);
    if (!l || !this.vivo(l, now)) return false;
    l.status = 'descartado';
    return true;
  }
}

/** Limite em memoria: janela deslizante por chave; conta so quando o pedido e aceito (hit). */
class MemRate implements DraftRatePort {
  readonly eventos = new Map<string, number[]>();
  readonly chaves: string[] = [];
  hits = 0;

  async check(policy: DraftRatePolicy, key: string, now: number): Promise<DraftRateCheck> {
    const k = `${policy.id}|${key}`;
    this.chaves.push(k);
    const ts = (this.eventos.get(k) ?? []).filter((t) => t > now - policy.spanS * 1000);
    if (ts.length < policy.limit) return { ok: true };
    const antigo = ts[0] ?? now;
    return { ok: false, retryAfterS: Math.max(1, Math.ceil((antigo + policy.spanS * 1000 - now) / 1000)) };
  }

  async hit(policy: DraftRatePolicy, key: string, now: number): Promise<void> {
    const k = `${policy.id}|${key}`;
    const ts = (this.eventos.get(k) ?? []).filter((t) => t > now - policy.spanS * 1000);
    ts.push(now);
    this.eventos.set(k, ts);
    this.hits++;
  }
}

interface Mundo {
  readonly store: MemStore;
  readonly rate: MemRate;
  readonly relogio: { agora: number };
  readonly porta: number;
  /** Proximo segredo que o servidor geraria (contador). */
  contadorSegredo: number;
}

const servidores: Server[] = [];

async function iniciar(opcoes: { semRotas?: boolean } = {}): Promise<Mundo> {
  const store = new MemStore();
  const rate = new MemRate();
  const relogio = { agora: T0 };
  const mundo: Mundo = { store, rate, relogio, porta: 0, contadorSegredo: 1 };
  const deps: DraftDeps = {
    store,
    rate,
    hasher: createDraftHasher(CHAVE_IP),
    newSecret: () => segredo(mundo.contadorSegredo++),
    clock: { nowMs: () => relogio.agora },
  };
  const server = createServer((req, res) => {
    handleRequest(req, res, {
      tickSecret: undefined,
      drafts: opcoes.semRotas ? undefined : { deps, siteUrl: SITE },
    }).catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  servidores.push(server);
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const porta = (server.address() as AddressInfo).port;
  return { ...mundo, porta };
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
  readonly origem?: string | null;
  readonly tipo?: string | null;
  readonly fetchSite?: string | null;
}

function chamar(porta: number, metodo: string, caminho: string, p: Pedido = {}): Promise<Resposta> {
  const headers: Record<string, string> = {};
  if (p.origem !== null) headers['Origin'] = p.origem ?? SITE;
  if (p.fetchSite !== null) headers['Sec-Fetch-Site'] = p.fetchSite ?? 'same-origin';
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

const cookieDe = (r: Resposta): string | undefined => {
  const sc = r.headers['set-cookie'];
  const lista = Array.isArray(sc) ? sc : sc ? [sc] : [];
  return lista.find((c) => c.startsWith(`${COOKIE}=`));
};
const segredoDe = (r: Resposta): string => /__Host-fp_draft=([^;]+)/.exec(cookieDe(r) ?? '')?.[1] ?? '';
const enviaCookie = (s: string): string => `${COOKIE}=${s}`;

/** Cabecalhos de uma resposta, sem os que variam por conexao ou data (para comparar 404 byte a byte). */
function assinatura(r: Resposta): string {
  const ignorar = new Set(['date', 'connection', 'keep-alive']);
  const linhas = Object.keys(r.headers)
    .filter((k) => !ignorar.has(k))
    .sort()
    .map((k) => `${k}:${JSON.stringify(r.headers[k])}`);
  return `${r.status}|${linhas.join('|')}|${r.body}`;
}

const CORPO_OK = { service_id: SERVICO_ATIVO, address_text: 'Rua Alfa, 10', urgency: 'imediato', description: 'Vazamento na pia' };

describe('D-01 e CA-01/CA-03: criacao sem conta', () => {
  it('POST com servico, local, urgencia e descricao: 201, cookie seguro e sem pedido de nome ou e-mail', async () => {
    const m = await iniciar();
    const r = await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: CORPO_OK });
    expect(r.status).toBe(201);
    expect(cookieDe(r)).toMatch(
      /^__Host-fp_draft=[A-Za-z0-9_-]{43}; HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=604800$/,
    );
    const corpo = JSON.parse(r.body) as Record<string, unknown>;
    expect(Object.keys(corpo).sort()).toEqual(
      ['address_text', 'description', 'expires_at', 'id', 'service_id', 'status', 'updated_at', 'urgency'].sort(),
    );
    expect(corpo['status']).toBe('aberto');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(m.store.linhas.size).toBe(1);
  });

  it('o banco guarda so o SHA-256 do segredo; o segredo em claro nao aparece no corpo nem no banco', async () => {
    const m = await iniciar();
    const r = await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: CORPO_OK });
    const s = segredoDe(r);
    expect(s).toHaveLength(43);
    expect(r.body).not.toContain(s);
    expect(m.store.linhas.has(s)).toBe(false);
    expect([...m.store.linhas.keys()][0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('CA-02: urgencia fora das quatro chaves e 422 e nada e gravado', async () => {
    const m = await iniciar();
    const r = await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: { ...CORPO_OK, urgency: 'agora' } });
    expect(r.status).toBe(422);
    expect(JSON.parse(r.body)).toEqual({ code: 'urgencia_invalida' });
    expect(m.store.linhas.size).toBe(0);
  });

  it('D-09: chave extra (email, nome, status, id, lat, lon) e 422 e nada e gravado (D-05)', async () => {
    for (const extra of ['email', 'first_name', 'status', 'id', 'lat', 'lon']) {
      const m = await iniciar();
      const r = await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: { urgency: 'imediato', [extra]: 'x' } });
      expect(r.status, extra).toBe(422);
      expect(JSON.parse(r.body)).toEqual({ code: 'campo_desconhecido' });
      expect(m.store.linhas.size).toBe(0);
    }
  });

  it('corpo vazio e 422 vazio; corpo acima de 8 KB e 413', async () => {
    const m = await iniciar();
    expect(JSON.parse((await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: {} })).body)).toEqual({ code: 'vazio' });
    const grande = await chamar(m.porta, 'POST', DRAFT_PATH, { textoBruto: `{"urgency":"imediato"${' '.repeat(8200)}}` });
    expect(grande.status).toBe(413);
    expect(m.store.linhas.size).toBe(0);
  });

  it('servico inexistente e 422 servico_invalido, sem gravar', async () => {
    const m = await iniciar();
    const r = await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: { service_id: SERVICO_INEXISTENTE } });
    expect(r.status).toBe(422);
    expect(JSON.parse(r.body)).toEqual({ code: 'servico_invalido' });
    expect(m.store.linhas.size).toBe(0);
  });

  it('R4: POST sem Origin do site e 403; Content-Type fora de JSON e 415; Sec-Fetch-Site cruzado e 403', async () => {
    const m = await iniciar();
    expect((await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: CORPO_OK, origem: null })).status).toBe(403);
    expect((await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: CORPO_OK, origem: 'https://mau.example.test' })).status).toBe(403);
    expect((await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: CORPO_OK, fetchSite: 'cross-site' })).status).toBe(403);
    const tipo = await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: CORPO_OK, tipo: 'text/plain' });
    expect(tipo.status).toBe(415);
    expect(m.store.linhas.size).toBe(0);
  });

  it('sem a opcao de rotas, POST /v1/drafts nao existe (404 do roteador)', async () => {
    const m = await iniciar({ semRotas: true });
    expect((await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: CORPO_OK })).status).toBe(404);
  });
});

describe('D-08: validacao antes do limite; so pedido aceito conta', () => {
  it('12 pedidos invalidos nao gastam o limite: o valido seguinte ainda passa', async () => {
    const m = await iniciar();
    for (let i = 0; i < 12; i++) {
      expect((await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: { urgency: 'x' } })).status).toBe(422);
    }
    expect(m.rate.hits).toBe(0);
    expect((await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: CORPO_OK })).status).toBe(201);
    expect(m.rate.hits).toBe(2);
  });
});

describe('D-08 e CA-10: limite de criacao por IP com HMAC', () => {
  it('11a criacao na mesma hora: 429 com Retry-After e corpo neutro, sem o limite', async () => {
    const m = await iniciar();
    for (let i = 0; i < 10; i++) {
      expect((await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: CORPO_OK })).status).toBe(201);
    }
    const r = await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: CORPO_OK });
    expect(r.status).toBe(429);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    const corpo = JSON.parse(r.body) as Record<string, unknown>;
    expect(Object.keys(corpo).sort()).toEqual(['code', 'retry_after_seconds']);
    expect(corpo['code']).toBe('muitos_pedidos');
    expect(r.body).not.toMatch(/10|limite|hora|dia/);
  });

  it('a chave do limite e HMAC: o IP em claro nao entra no balde', async () => {
    const m = await iniciar();
    await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: CORPO_OK });
    expect(m.rate.chaves.length).toBeGreaterThan(0);
    for (const k of m.rate.chaves) {
      expect(k).not.toContain(IP_CLIENTE);
      expect(k).not.toContain('127.0.0.1');
      expect(k).toMatch(/\|[0-9a-f]{64}$/);
    }
  });

  it('limite diario: 50 criacoes em 5 horas e a 51a e barrada (a janela de 24 h)', async () => {
    const m = await iniciar();
    for (let h = 0; h < 5; h++) {
      for (let i = 0; i < 10; i++) {
        expect((await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: CORPO_OK })).status).toBe(201);
      }
      m.relogio.agora += HORA;
    }
    expect((await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: CORPO_OK })).status).toBe(429);
  });
});

describe('CA-05 e D-03: vinculo pelo cookie e 404 uniforme', () => {
  it('PATCH com o cookie do rascunho: 200 com o campo novo, e o cookie e renovado', async () => {
    const m = await iniciar();
    const criado = await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: CORPO_OK });
    const c = enviaCookie(segredoDe(criado));
    const r = await chamar(m.porta, 'PATCH', DRAFT_CURRENT_PATH, { cookie: c, corpo: { description: 'Novo texto' } });
    expect(r.status).toBe(200);
    const corpo = JSON.parse(r.body) as Record<string, unknown>;
    expect(corpo['description']).toBe('Novo texto');
    expect(corpo['address_text']).toBe('Rua Alfa, 10');
    expect(cookieDe(r)).toContain('Max-Age=604800');
  });

  it('CA-06: o mesmo PATCH duas vezes da o mesmo resultado e nao cria linha', async () => {
    const m = await iniciar();
    const c = enviaCookie(segredoDe(await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: CORPO_OK })));
    const a = await chamar(m.porta, 'PATCH', DRAFT_CURRENT_PATH, { cookie: c, corpo: { urgency: 'proximo_mes' } });
    const b = await chamar(m.porta, 'PATCH', DRAFT_CURRENT_PATH, { cookie: c, corpo: { urgency: 'proximo_mes' } });
    expect(a.body).toBe(b.body);
    expect(m.store.linhas.size).toBe(1);
  });

  it('D-04: POST repetido com cookie vivo devolve 200 e nao muda a contagem de linhas', async () => {
    const m = await iniciar();
    const criado = await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: CORPO_OK });
    const c = enviaCookie(segredoDe(criado));
    const r = await chamar(m.porta, 'POST', DRAFT_PATH, { cookie: c, corpo: { urgency: 'imediato' } });
    expect(r.status).toBe(200);
    expect(m.store.linhas.size).toBe(1);
  });

  it('CA-05: a 404 de cookie ausente, malformado, de outro navegador, descartado e vencido e identica byte a byte', async () => {
    const m = await iniciar();
    const meu = segredoDe(await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: CORPO_OK }));
    // Cookie com formato valido que nunca foi emitido: o de outro navegador, sem rascunho nenhum.
    const outroBrowser = segredo(9999);
    // Rascunho descartado: a 404 dele tem de ser igual a das demais.
    const descartado = segredoDe(await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: CORPO_OK }));
    await chamar(m.porta, 'DELETE', DRAFT_CURRENT_PATH, { cookie: enviaCookie(descartado) });
    const meuVencido = segredoDe(await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: CORPO_OK }));
    m.relogio.agora += 8 * DIA;

    const casos: Pedido[] = [
      {},
      { cookie: enviaCookie('A'.repeat(42)) },
      { cookie: enviaCookie('B'.repeat(44)) },
      { cookie: enviaCookie(descartado) },
      { cookie: enviaCookie(meuVencido) },
      { cookie: `${COOKIE}=${meu}; ${COOKIE}=${meu}` },
    ];
    const assinaturas = new Set<string>();
    for (const p of casos) {
      assinaturas.add(assinatura(await chamar(m.porta, 'GET', DRAFT_CURRENT_PATH, p)));
    }
    expect(assinaturas.size).toBe(1);
    const unica = [...assinaturas][0] ?? '';
    expect(unica.startsWith('404|')).toBe(true);
    expect(unica).toContain('{"code":"nao_encontrado"}');
    expect(unica).not.toMatch(/set-cookie/);
    // O mesmo 404 vale para PATCH (outro navegador e descartado) e DELETE (descartado).
    const patch = await chamar(m.porta, 'PATCH', DRAFT_CURRENT_PATH, { cookie: enviaCookie(outroBrowser), corpo: { urgency: 'imediato' } });
    const patchDescartado = await chamar(m.porta, 'PATCH', DRAFT_CURRENT_PATH, { cookie: enviaCookie(descartado), corpo: { urgency: 'imediato' } });
    const del = await chamar(m.porta, 'DELETE', DRAFT_CURRENT_PATH, { cookie: enviaCookie(descartado) });
    expect(assinatura(patch)).toBe(unica);
    expect(assinatura(patchDescartado)).toBe(unica);
    expect(assinatura(del)).toBe(unica);
  });

  it('D-03: cookie malformado ou ausente nao chega ao banco (zero chamadas)', async () => {
    const m = await iniciar();
    const antes = m.store.chamadas;
    await chamar(m.porta, 'GET', DRAFT_CURRENT_PATH, { cookie: enviaCookie('X'.repeat(10)) });
    await chamar(m.porta, 'PATCH', DRAFT_CURRENT_PATH, { cookie: enviaCookie('X'.repeat(10)), corpo: { urgency: 'imediato' } });
    await chamar(m.porta, 'DELETE', DRAFT_CURRENT_PATH, {});
    await chamar(m.porta, 'GET', DRAFT_CURRENT_PATH, {});
    expect(m.store.chamadas).toBe(antes);
  });

  it('GET sem Origin passa (navegacao do mesmo site); DELETE sem Origin e 403', async () => {
    const m = await iniciar();
    const c = enviaCookie(segredoDe(await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: CORPO_OK })));
    expect((await chamar(m.porta, 'GET', DRAFT_CURRENT_PATH, { cookie: c, origem: null })).status).toBe(200);
    expect((await chamar(m.porta, 'DELETE', DRAFT_CURRENT_PATH, { cookie: c, origem: null })).status).toBe(403);
  });

  it('GET devolve o rascunho sem campos internos e sem vazar o segredo', async () => {
    const m = await iniciar();
    const s = segredoDe(await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: CORPO_OK }));
    const r = await chamar(m.porta, 'GET', DRAFT_CURRENT_PATH, { cookie: enviaCookie(s) });
    expect(r.status).toBe(200);
    expect(r.body).not.toMatch(/hash|ip_hmac|email|first_name|browser/);
    expect(r.body).not.toContain(s);
  });
});

describe('D-07 e CA-09: prazo, renovacao e teto', () => {
  it('vivo em 7 dias menos 1 s; 404 em 7 dias', async () => {
    const m = await iniciar();
    const c = enviaCookie(segredoDe(await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: CORPO_OK })));
    m.relogio.agora += 7 * DIA - 1000;
    expect((await chamar(m.porta, 'GET', DRAFT_CURRENT_PATH, { cookie: c })).status).toBe(200);
    m.relogio.agora += 1000;
    expect((await chamar(m.porta, 'GET', DRAFT_CURRENT_PATH, { cookie: c })).status).toBe(404);
  });

  it('salvar renova a janela: salvo no 6o dia, ainda vivo no 12o', async () => {
    const m = await iniciar();
    const c = enviaCookie(segredoDe(await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: CORPO_OK })));
    m.relogio.agora += 6 * DIA;
    expect((await chamar(m.porta, 'PATCH', DRAFT_CURRENT_PATH, { cookie: c, corpo: { description: 'x' } })).status).toBe(200);
    m.relogio.agora += 6 * DIA;
    expect((await chamar(m.porta, 'GET', DRAFT_CURRENT_PATH, { cookie: c })).status).toBe(200);
  });

  it('teto de 30 dias desde a criacao: salvamentos nao estendem alem disso', async () => {
    const m = await iniciar();
    const c = enviaCookie(segredoDe(await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: CORPO_OK })));
    for (let i = 0; i < 4; i++) {
      m.relogio.agora += 6 * DIA;
      expect((await chamar(m.porta, 'PATCH', DRAFT_CURRENT_PATH, { cookie: c, corpo: { description: `v${i}` } })).status).toBe(200);
    }
    // Agora: 24 dias desde a criacao. Teto em 30 dias.
    m.relogio.agora += 5 * DIA + 23 * HORA;
    expect((await chamar(m.porta, 'GET', DRAFT_CURRENT_PATH, { cookie: c })).status).toBe(200);
    m.relogio.agora += 1 * HORA + 1000;
    expect((await chamar(m.porta, 'GET', DRAFT_CURRENT_PATH, { cookie: c })).status).toBe(404);
  });

  it('POST com cookie vencido cria outro (segredo novo) e marca o antigo como descartado', async () => {
    const m = await iniciar();
    const velho = segredoDe(await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: CORPO_OK }));
    m.relogio.agora += 8 * DIA;
    const r = await chamar(m.porta, 'POST', DRAFT_PATH, { cookie: enviaCookie(velho), corpo: CORPO_OK });
    expect(r.status).toBe(201);
    const novo = segredoDe(r);
    expect(novo).not.toBe(velho);
    expect(m.store.linhas.get(hashDe(velho))?.status).toBe('descartado');
    expect((await chamar(m.porta, 'GET', DRAFT_CURRENT_PATH, { cookie: enviaCookie(novo) })).status).toBe(200);
    expect((await chamar(m.porta, 'GET', DRAFT_CURRENT_PATH, { cookie: enviaCookie(velho) })).status).toBe(404);
  });
});

describe('DELETE, descarte e limite de salvamento', () => {
  it('DELETE: 204, limpa o cookie; depois disso GET e DELETE dao 404', async () => {
    const m = await iniciar();
    const c = enviaCookie(segredoDe(await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: CORPO_OK })));
    const del = await chamar(m.porta, 'DELETE', DRAFT_CURRENT_PATH, { cookie: c });
    expect(del.status).toBe(204);
    expect(cookieDe(del)).toBe('__Host-fp_draft=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
    expect((await chamar(m.porta, 'GET', DRAFT_CURRENT_PATH, { cookie: c })).status).toBe(404);
    expect((await chamar(m.porta, 'DELETE', DRAFT_CURRENT_PATH, { cookie: c })).status).toBe(404);
  });

  it('60 salvamentos por rascunho em 60 s; o 61o e 429', async () => {
    const m = await iniciar();
    const c = enviaCookie(segredoDe(await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: CORPO_OK })));
    for (let i = 0; i < 60; i++) {
      expect((await chamar(m.porta, 'PATCH', DRAFT_CURRENT_PATH, { cookie: c, corpo: { description: `t${i}` } })).status).toBe(200);
    }
    expect((await chamar(m.porta, 'PATCH', DRAFT_CURRENT_PATH, { cookie: c, corpo: { description: 'x' } })).status).toBe(429);
  });

  it('corpo do PATCH com chave extra e 422 e nada muda (CA-02 e R2)', async () => {
    const m = await iniciar();
    const c = enviaCookie(segredoDe(await chamar(m.porta, 'POST', DRAFT_PATH, { corpo: CORPO_OK })));
    const antes = assinatura(await chamar(m.porta, 'GET', DRAFT_CURRENT_PATH, { cookie: c }));
    const r = await chamar(m.porta, 'PATCH', DRAFT_CURRENT_PATH, { cookie: c, corpo: { lat: -23.5, urgency: 'imediato' } });
    expect(r.status).toBe(422);
    expect(JSON.parse(r.body)).toEqual({ code: 'campo_desconhecido' });
    const depois = assinatura(await chamar(m.porta, 'GET', DRAFT_CURRENT_PATH, { cookie: c }));
    expect(depois.replace(/"updated_at":"[^"]*"/, '')).toBe(antes.replace(/"updated_at":"[^"]*"/, ''));
  });
});

/** SHA-256 do segredo, como o servidor o guarda (a chave do IP nao entra nesse hash). */
function hashDe(segredoEmClaro: string): string {
  return createDraftHasher(CHAVE_IP).secretHash(segredoEmClaro);
}
