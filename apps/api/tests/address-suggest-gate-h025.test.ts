// H-025 (Issue #38, D-11) | Ligacao real da DraftGate na sugestao de endereco (H-020), ponta a ponta.
// Docs: 74-DESENHO-H025 §4 (D-11) e 56-DESENHO-H020 §2.3 (CA-01/CA-02 herdados). Sem rede: o provedor e
// uma fixture sintetica injetada e o fetch global bloqueado. Banco e cookie em memoria (regras do SQL).
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-025');
};

import { afterAll, describe, expect, it, vi } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  DRAFT_PATH,
  DRAFT_CURRENT_PATH,
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
import type { DraftRouteOptions } from '../src/drafts/draft-route.js';
import {
  faltantesSugestao,
  limitesCotaTemp,
  memoizarCliente,
  montarSugestaoEndereco,
  PgMapboxTempQuota,
  RateSugestao,
  SQL_MAPBOX_TEMP_QUOTA_TAKE,
  SUGESTAO_RATE_IP,
  SUGESTAO_RATE_RASCUNHO,
} from '../src/geo/composicao-sugestao.js';
import type { SqlClient } from '@fastpro/db';

const SITE = 'https://fastpro.example.test';
const CHAVE_IP = 'k'.repeat(40);
const SERVICO_ATIVO = '0c9e2f7a-3b1d-4e8f-9a6b-1f2e3d4c5b6a';
const T0 = Date.UTC(2099, 0, 1, 12, 0, 0);
const DIA = 86_400_000;
const COOKIE = '__Host-fp_draft';
const CAMINHO_SUGESTAO = '/v1/geo/address-suggest';
const CANARIO = 'Rua Canario Sintetico 999';

const FEATURES = [
  { properties: { full_address: 'Rua Alfa, 10, Centro, Sao Paulo', mapbox_id: 'mbx-sintetico-1' } },
  { properties: { name: 'Rua Beta', place_formatted: 'Sao Paulo, Brasil' } },
];

const ENV_COMPLETO = {
  MAPBOX_ACCESS_TOKEN: 'tok-teste',
  DATABASE_URL_APP_SYSTEM: 'postgres://sintetico.invalid/app_system',
  MAPBOX_TEMP_SOFT_LIMIT: '1500',
  MAPBOX_TEMP_HARD_LIMIT: '2000',
};

/** Banco em memoria: mesmas regras das funcoes SQL de rascunho (prazo, descarte, falha). */
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

class MemStore implements DraftStorePort {
  readonly linhas = new Map<string, Linha>();
  /** Liga a falha do banco: a porta real deve responder indisponivel (503), sem provedor. */
  falhar = false;
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

  async find(hash: string, now: number): Promise<DraftRecord | null> {
    if (this.falhar) throw new Error('banco_fora');
    const l = this.linhas.get(hash);
    return l && this.vivo(l, now) ? this.rec(l) : null;
  }

  async create(input: DraftCreateInput): Promise<DraftWriteResult> {
    const l: Linha = {
      id: `rascunho-${++this.seq}`,
      status: 'aberto',
      serviceId: input.fields.service_id ?? null,
      addressText: input.fields.address_text ?? null,
      urgency: input.fields.urgency ?? null,
      description: input.fields.description ?? null,
      createdMs: input.nowMs,
      expiresMs: input.nowMs + 7 * DIA,
      updatedMs: input.nowMs,
    };
    this.linhas.set(input.secretHash, l);
    return { ok: true, draft: this.rec(l) };
  }

  async patch(input: DraftPatchInput): Promise<DraftWriteResult> {
    const l = this.linhas.get(input.secretHash);
    if (!l || !this.vivo(l, input.nowMs))
      return { ok: false, code: 'nao_encontrado' as DraftStoreError };
    return { ok: true, draft: this.rec(l) };
  }

  async discard(hash: string, now: number): Promise<boolean> {
    const l = this.linhas.get(hash);
    if (!l || !this.vivo(l, now)) return false;
    l.status = 'descartado';
    return true;
  }
}

/** Limite em memoria por politica e chave (conta so quando aceito). */
class MemRate implements DraftRatePort {
  readonly eventos = new Map<string, number[]>();

  async check(policy: DraftRatePolicy, key: string, now: number): Promise<DraftRateCheck> {
    const ts = (this.eventos.get(`${policy.id}|${key}`) ?? []).filter(
      (t) => t > now - policy.spanS * 1000,
    );
    if (ts.length < policy.limit) return { ok: true };
    return { ok: false, retryAfterS: 60 };
  }

  async hit(policy: DraftRatePolicy, key: string, now: number): Promise<void> {
    const k = `${policy.id}|${key}`;
    const ts = (this.eventos.get(k) ?? []).filter((t) => t > now - policy.spanS * 1000);
    ts.push(now);
    this.eventos.set(k, ts);
  }
}

/** Cliente SQL sintetico do papel app_system: so responde a funcao de cota e conta as chamadas. */
class ClienteCotaFake {
  chamadas: { sql: string; params: unknown[] }[] = [];
  used = 0;
  async query(sql: string, params: unknown[] = []) {
    this.chamadas.push({ sql, params });
    if (sql !== SQL_MAPBOX_TEMP_QUOTA_TAKE) throw new Error('sql_inesperado_no_teste');
    this.used += 1;
    return { rows: [{ out_ok: true, out_novo_alerta: false, out_used: this.used }] };
  }
}

interface Mundo {
  readonly store: MemStore;
  readonly rate: MemRate;
  readonly cota: ClienteCotaFake;
  readonly relogio: { agora: number };
  readonly provedor: { chamadas: number; urls: string[]; inits: RequestInit[]; falhar: boolean };
  readonly porta: number;
}

const servidores: Server[] = [];

afterAll(async () => {
  await Promise.all(servidores.map((s) => new Promise<void>((ok) => s.close(() => ok()))));
});

async function iniciar(
  env: Record<string, string | undefined> = ENV_COMPLETO,
  semRascunho = false,
): Promise<Mundo> {
  const store = new MemStore();
  const rate = new MemRate();
  const cota = new ClienteCotaFake();
  const relogio = { agora: T0 };
  const provedor = { chamadas: 0, urls: [] as string[], inits: [] as RequestInit[], falhar: false };
  const deps: DraftDeps = {
    store,
    rate,
    hasher: createDraftHasher(CHAVE_IP),
    newSecret: () => `segredo-${store.linhas.size + 1}`.padEnd(43, 'Z'),
    clock: { nowMs: () => relogio.agora },
  };
  const rascunho: DraftRouteOptions | undefined = semRascunho ? undefined : { deps, siteUrl: SITE };
  const geo = montarSugestaoEndereco(env, {
    abrirCliente: memoizarCliente(() => cota as unknown as SqlClient),
    rascunho,
    fetchImpl: (async (url: string | URL, init?: RequestInit) => {
      provedor.chamadas += 1;
      provedor.urls.push(String(url));
      provedor.inits.push(init ?? {});
      if (provedor.falhar) throw new Error('falha_sintetica');
      return new Response(JSON.stringify({ features: FEATURES }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch,
  });
  const server = createServer((req, res) => {
    handleRequest(req, res, { tickSecret: undefined, drafts: rascunho, geo }).catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  servidores.push(server);
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const porta = (server.address() as AddressInfo).port;
  return { store, rate, cota, relogio, provedor, porta };
}

interface Resposta {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

interface Pedido {
  readonly cookie?: string;
  readonly corpo?: unknown;
}

function chamar(porta: number, metodo: string, caminho: string, p: Pedido = {}): Promise<Resposta> {
  const headers: Record<string, string> = { Origin: SITE, 'Sec-Fetch-Site': 'same-origin' };
  const texto = p.corpo === undefined ? '' : JSON.stringify(p.corpo);
  if (p.corpo !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(Buffer.byteLength(texto));
  }
  if (p.cookie) headers['Cookie'] = p.cookie;
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: porta, method: metodo, path: caminho, headers },
      (res) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(partes).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    if (texto) req.write(texto);
    req.end();
  });
}

/** Cria o rascunho pela propria rota e devolve o cookie do navegador (201 com Set-Cookie). */
async function criarRascunho(m: Mundo): Promise<string> {
  const r = await chamar(m.porta, 'POST', DRAFT_PATH, {
    corpo: {
      service_id: SERVICO_ATIVO,
      address_text: 'Rua Rascunho 1',
      urgency: 'imediato',
      description: 'Teste',
    },
  });
  expect(r.status).toBe(201);
  const cookies = ([] as string[]).concat(r.headers['set-cookie'] ?? []);
  const linha = cookies.find((c) => c.startsWith(`${COOKIE}=`));
  if (linha === undefined) throw new Error('cookie_ausente');
  return linha.slice(COOKIE.length + 1).split(';')[0] ?? '';
}

const sugerir = (m: Mundo, cookie?: string) =>
  chamar(m.porta, 'POST', CAMINHO_SUGESTAO, {
    ...(cookie !== undefined ? { cookie: `${COOKIE}=${cookie}` } : {}),
    corpo: { q: CANARIO, context: 'request_draft' },
  });

describe('H-025 D-11: DraftGate real ligada a sugestao de endereco (H-020), ponta a ponta', () => {
  it('rascunho vivo: a rota consulta o provedor uma vez e devolve rotulos (CA-02 herdado)', async () => {
    const m = await iniciar();
    const cookie = await criarRascunho(m);
    const r = await sugerir(m, cookie);
    expect(r.status).toBe(200);
    const corpo = JSON.parse(r.body) as { mode: string; items: { label: string }[] };
    expect(corpo.mode).toBe('ok');
    expect(corpo.items.map((i) => i.label)).toEqual([
      'Rua Alfa, 10, Centro, Sao Paulo',
      'Rua Beta, Sao Paulo, Brasil',
    ]);
    expect(m.provedor.chamadas).toBe(1);
    expect(m.cota.used).toBe(1);
  });

  it('sem cookie: 403 not_draft e nenhuma chamada ao provedor nem reserva de cota (CA-01 herdado)', async () => {
    const m = await iniciar();
    const r = await sugerir(m);
    expect(r.status).toBe(403);
    expect(JSON.parse(r.body)).toEqual({ code: 'not_draft' });
    expect(m.provedor.chamadas).toBe(0);
    expect(m.cota.used).toBe(0);
  });

  it('cookie forjado, de formato valido mas sem rascunho: 403 not_draft sem provedor', async () => {
    const m = await iniciar();
    const r = await sugerir(m, 'x'.repeat(43));
    expect(r.status).toBe(403);
    expect(m.provedor.chamadas).toBe(0);
  });

  it('rascunho descartado: o mesmo cookie deixa de liberar a sugestao (403, sem provedor)', async () => {
    const m = await iniciar();
    const cookie = await criarRascunho(m);
    const descarte = await chamar(m.porta, 'DELETE', DRAFT_CURRENT_PATH, {
      cookie: `${COOKIE}=${cookie}`,
    });
    expect(descarte.status).toBe(204);
    const r = await sugerir(m, cookie);
    expect(r.status).toBe(403);
    expect(m.provedor.chamadas).toBe(0);
  });

  it('rascunho vencido (apos o prazo de 7 dias): 403 e sem provedor', async () => {
    const m = await iniciar();
    const cookie = await criarRascunho(m);
    m.relogio.agora += 8 * DIA;
    const r = await sugerir(m, cookie);
    expect(r.status).toBe(403);
    expect(m.provedor.chamadas).toBe(0);
  });

  it('falha do banco na porta: 503 indisponivel e nenhuma chamada ao provedor (fechado por padrao)', async () => {
    const m = await iniciar();
    const cookie = await criarRascunho(m);
    m.store.falhar = true;
    const r = await sugerir(m, cookie);
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body)).toEqual({ code: 'indisponivel' });
    expect(m.provedor.chamadas).toBe(0);
  });

  it('a chamada ao provedor usa token de servidor, sem cookies e sem repasse do navegador', async () => {
    const m = await iniciar();
    const cookie = await criarRascunho(m);
    await sugerir(m, cookie);
    const init = m.provedor.inits[0] as RequestInit & { cache?: string };
    expect(init.credentials).toBe('omit');
    expect(init.cache).toBe('no-store');
    expect(init.redirect).toBe('error');
    expect(m.provedor.urls[0]).toContain('access_token=tok-teste');
    expect(JSON.stringify(init.headers ?? {})).not.toContain(COOKIE);
  });

  it('sem rascunho ligado a rota nao existe (undefined na composicao) e o caminho responde 404', async () => {
    const m = await iniciar(ENV_COMPLETO, true);
    const r = await sugerir(m, 'x'.repeat(43));
    expect(r.status).toBe(404);
    expect(m.provedor.chamadas).toBe(0);
  });

  it('interruptor ADDRESS_SUGGEST_ENABLED=false responde texto livre sem provedor', async () => {
    const m = await iniciar({ ...ENV_COMPLETO, ADDRESS_SUGGEST_ENABLED: 'false' });
    const cookie = await criarRascunho(m);
    const r = await sugerir(m, cookie);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ mode: 'texto_livre', reason: 'desligado' });
    expect(m.provedor.chamadas).toBe(0);
  });
});

describe('H-025 D-11: composicao da sugestao (variaveis, limites e portas)', () => {
  const rascunhoFake = (): DraftRouteOptions => ({
    deps: {
      store: new MemStore(),
      rate: new MemRate(),
      hasher: createDraftHasher(CHAVE_IP),
      newSecret: () => 'x'.repeat(43),
      clock: { nowMs: () => T0 },
    },
    siteUrl: SITE,
  });
  const abrir = () => new ClienteCotaFake() as unknown as SqlClient;

  it('sem nenhuma variavel completa a composicao devolve undefined e lista so os nomes', () => {
    expect(
      montarSugestaoEndereco({}, { abrirCliente: abrir, rascunho: rascunhoFake() }),
    ).toBeUndefined();
    const faltam = faltantesSugestao({});
    expect(faltam).toContain('MAPBOX_ACCESS_TOKEN');
    expect(faltam).toContain('DATABASE_URL_APP_SYSTEM');
    expect(faltam.join(' ')).not.toContain('tok-teste');
  });

  it('limites da cota: soft acima do hard ou acima de 99.000 sao recusados', () => {
    expect(
      limitesCotaTemp({ MAPBOX_TEMP_SOFT_LIMIT: '2', MAPBOX_TEMP_HARD_LIMIT: '1' }),
    ).toBeNull();
    expect(
      limitesCotaTemp({ MAPBOX_TEMP_SOFT_LIMIT: '1', MAPBOX_TEMP_HARD_LIMIT: '99001' }),
    ).toBeNull();
    expect(
      limitesCotaTemp({ MAPBOX_TEMP_SOFT_LIMIT: '1500', MAPBOX_TEMP_HARD_LIMIT: '2000' }),
    ).toEqual({
      soft: 1500,
      hard: 2000,
    });
  });

  it('com variaveis completas e rascunho, a composicao liga a rota com a porta real (gate ok com cookie vivo)', async () => {
    const r = rascunhoFake();
    const opts = montarSugestaoEndereco(ENV_COMPLETO, { abrirCliente: abrir, rascunho: r });
    expect(opts).toBeDefined();
    expect(opts?.siteUrl).toBe(SITE);
    expect(opts?.enabled).toBe(true);
    // A porta nao e a indisponivel: sem cookie responde no_principal sem consultar o banco.
    const semCookie = await opts?.deps.gate.check('request_draft', undefined);
    expect(semCookie).toEqual({ status: 'no_principal' });
  });

  it('PgMapboxTempQuota passa a data e os tetos e mapeia a linha; linha invalida falha de forma fixa', async () => {
    const chamadas: { sql: string; params: unknown[] }[] = [];
    const cliente = {
      async query(sql: string, params: unknown[] = []) {
        chamadas.push({ sql, params });
        return { rows: [{ out_ok: false, out_novo_alerta: true, out_used: 2000 }] };
      },
    } as unknown as SqlClient;
    const quota = new PgMapboxTempQuota(cliente, { soft: 1500, hard: 2000 });
    const now = new Date('2099-01-01T12:00:00.000Z');
    expect(await quota.take(now)).toEqual({ ok: false, novoAlerta: true, used: 2000 });
    expect(chamadas[0]?.sql).toBe(SQL_MAPBOX_TEMP_QUOTA_TAKE);
    expect(chamadas[0]?.params).toEqual(['2099-01-01T12:00:00.000Z', 1500, 2000]);

    const ruim = { query: async () => ({ rows: [{}] }) } as unknown as SqlClient;
    await expect(new PgMapboxTempQuota(ruim, { soft: 1, hard: 2 }).take(now)).rejects.toThrow(
      'cota_resposta_invalida',
    );
  });

  it('RateSugestao: 30 consultas por rascunho em 60 s; a 31a e barrada antes do IP (sem contar)', async () => {
    const rate = new MemRate();
    const porta = new RateSugestao(rate, createDraftHasher(CHAVE_IP), { nowMs: () => T0 });
    for (let i = 0; i < SUGESTAO_RATE_RASCUNHO.limit; i++) {
      expect((await porta.check('rascunho-a', '203.0.113.9')).ok).toBe(true);
      await porta.hit('rascunho-a', '203.0.113.9');
    }
    const barrado = await porta.check('rascunho-a', '203.0.113.9');
    expect(barrado.ok).toBe(false);
    // Outro rascunho do mesmo IP continua dentro do limite do rascunho; o IP so conta ate 60.
    expect((await porta.check('rascunho-b', '203.0.113.9')).ok).toBe(true);
    expect(SUGESTAO_RATE_IP.limit).toBe(60);
  });
});

// D-12 (74 §4): sentinela de log. Textos de endereco e descricao (e a consulta digitada) nao aparecem em
// nenhuma linha de log (console e stdout/stderr) nem em corpo de erro, nos caminhos de sucesso e de falha.
describe('H-025 D-12: sentinela de log nos arquivos de rascunho e da sugestao', () => {
  const SENT_END = 'SENTINELA-END-5150 Rua Sentinela';
  const SENT_DESC = 'SENTINELA-DESC-7731 nao escrever telefone';
  const SENT_Q = 'SENTINELA-Q-9001 Avenida';

  it('nenhuma linha de log e nenhum corpo de erro carregam endereco, descricao ou consulta', async () => {
    const saidas: string[] = [];
    const espias = [
      vi
        .spyOn(console, 'log')
        .mockImplementation((...a: unknown[]) => void saidas.push(a.map(String).join(' '))),
      vi
        .spyOn(console, 'info')
        .mockImplementation((...a: unknown[]) => void saidas.push(a.map(String).join(' '))),
      vi
        .spyOn(console, 'warn')
        .mockImplementation((...a: unknown[]) => void saidas.push(a.map(String).join(' '))),
      vi
        .spyOn(console, 'error')
        .mockImplementation((...a: unknown[]) => void saidas.push(a.map(String).join(' '))),
      vi
        .spyOn(console, 'debug')
        .mockImplementation((...a: unknown[]) => void saidas.push(a.map(String).join(' '))),
      vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(((s: string) => (saidas.push(String(s)), true)) as never),
      vi
        .spyOn(process.stderr, 'write')
        .mockImplementation(((s: string) => (saidas.push(String(s)), true)) as never),
    ];
    const corposDeErro: string[] = [];
    try {
      const m = await iniciar();

      // Criacao com endereco e descricao sentinela: sucesso (201), sem log.
      const criado = await chamar(m.porta, 'POST', DRAFT_PATH, {
        corpo: {
          service_id: SERVICO_ATIVO,
          address_text: SENT_END,
          urgency: 'imediato',
          description: SENT_DESC,
        },
      });
      expect(criado.status).toBe(201);
      const cookie =
        ([] as string[])
          .concat(criado.headers['set-cookie'] ?? [])
          .find((c) => c.startsWith(`${COOKIE}=`)) ?? '';
      const valor = cookie.slice(COOKIE.length + 1).split(';')[0] ?? '';

      // Erros de validacao com o texto sentinela: 422 e 400 sem eco da entrada.
      const urgenciaErrada = await chamar(m.porta, 'POST', DRAFT_PATH, {
        corpo: { service_id: SERVICO_ATIVO, address_text: SENT_END, urgency: SENT_DESC },
      });
      expect(urgenciaErrada.status).toBe(422);
      corposDeErro.push(urgenciaErrada.body);
      const descricaoLonga = await chamar(m.porta, 'PATCH', DRAFT_CURRENT_PATH, {
        cookie: `${COOKIE}=${valor}`,
        corpo: { description: SENT_DESC + 'x'.repeat(2100) },
      });
      expect(descricaoLonga.status).toBe(422);
      corposDeErro.push(descricaoLonga.body);
      const consultaCurta = await chamar(m.porta, 'POST', CAMINHO_SUGESTAO, {
        cookie: `${COOKIE}=${valor}`,
        corpo: { q: 'ab', context: 'request_draft', nota: SENT_Q },
      });
      expect(consultaCurta.status).toBe(400);
      corposDeErro.push(consultaCurta.body);

      // Sugestao com a consulta sentinela: sucesso, e falha do provedor e do banco (texto livre e 503).
      const ok = await chamar(m.porta, 'POST', CAMINHO_SUGESTAO, {
        cookie: `${COOKIE}=${valor}`,
        corpo: { q: SENT_Q, context: 'request_draft' },
      });
      expect(ok.status).toBe(200);
      m.provedor.falhar = true;
      const provedorCaiu = await chamar(m.porta, 'POST', CAMINHO_SUGESTAO, {
        cookie: `${COOKIE}=${valor}`,
        corpo: { q: SENT_Q, context: 'request_draft' },
      });
      expect(provedorCaiu.status).toBe(200);
      corposDeErro.push(provedorCaiu.body);
      m.provedor.falhar = false;
      m.store.falhar = true;
      const bancoCaiu = await chamar(m.porta, 'POST', CAMINHO_SUGESTAO, {
        cookie: `${COOKIE}=${valor}`,
        corpo: { q: SENT_Q, context: 'request_draft' },
      });
      expect(bancoCaiu.status).toBe(503);
      corposDeErro.push(bancoCaiu.body);
    } finally {
      for (const e of espias) e.mockRestore();
    }
    const tudo = [...saidas, ...corposDeErro].join('\n');
    for (const sentinela of [SENT_END, SENT_DESC, SENT_Q]) {
      expect(tudo).not.toContain(sentinela);
    }
  });
});
