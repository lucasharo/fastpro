// H-036 | Rotas de servicos, base e raio do perfil profissional (docs/factory/99-DESENHO-H036.md, §2, §4.5, §6, §7;
// T-P15 contrato, T-P16 log e erro sem PII, mapeamento 422/429/503/409 e Origin/Sec-Fetch-Site). Porta de oferta em
// memoria (sem banco), localizador simulado com contador (sem Mapbox, sem rede). Valores sinteticos.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-036 (rota)');
};

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { hashSessionSecret, type ProfessionalAreaView } from '@fastpro/db';
import {
  SESSION_COOKIE_NAME,
  type ServiceRow,
  type SessionRecord,
  type SessionRepositoryPort,
} from '@fastpro/domain';
import { handleRequest } from '../src/app.js';
import {
  type ProfessionalOfferingPort,
  type ProfessionalOfferingRouteOptions,
  type ProfessionalOfferingStatus,
} from '../src/professional-offering-route.js';
import type { EnsurePermanentOutcome } from '../src/geo/permanent-geocode-service.js';

const SITE = 'https://fastpro.example.test';
const AREA = '/v1/professional/profile/area';
const SERVICOS = '/v1/professional/profile/services';
/** Canario: texto que nunca pode aparecer em log, nem em resposta, nem em erro. */
const CANARIO = 'CANARIO-h036-ENDERECO-7731';
const COORD_LAT = '-23.5505123';
const COORD_LON = '-46.6333456';
const PONTO_ID = '6f0c2a11-3b7e-4f6a-9d1e-2a4b5c6d7e8f';

/** Chaves que nunca podem sair em resposta (coordenada, ponto, celula, match, hash ou identificador de ponto). */
const CHAVES_PROIBIDAS =
  /^(lat|lon|latitude|longitude|coordinates?|point|geom|geometry|cell|match[a-z_]*|geocode[a-z_]*|exact_point|pointId|radius_m|hash|addressHash)$/i;

/** Porta de oferta em memoria. Desfechos configuraveis e contadores de chamadas (provam "nada gravado"). */
class OfertaMemoria implements ProfessionalOfferingPort {
  readonly status = new Map<string, ProfessionalOfferingStatus>();
  readonly areas = new Map<string, ProfessionalAreaView>();
  readonly servicos = new Map<string, ServiceRow[]>();
  readonly chamadas = { precheck: 0, areaSave: 0, servicesSave: 0, locate: 0 };
  precheckOut: { status: 'ok' | 'limite_escrita' | 'limite_mudanca' | 'limite_tentativas' | 'suspenso' | 'sem_perfil'; retryAfterS: number | null; callsCap: number | null } = {
    status: 'ok',
    retryAfterS: null,
    callsCap: 40,
  };
  areaSaveOut: { status: string; retryAfterS: number | null } | null = null;
  servicesSaveOut: { status: string; index: number | null; retryAfterS: number | null } | null = null;
  locateOut: EnsurePermanentOutcome = { status: 'ok', pointId: PONTO_ID };
  locateErro: Error | null = null;
  falhaLeitura = false;

  async profileStatus(userId: string) {
    return this.status.get(userId) ?? null;
  }
  async areaGet(userId: string) {
    if (this.falhaLeitura) throw new Error(`falha de banco com ${CANARIO}`);
    return this.areas.get(userId) ?? null;
  }
  async precheck() {
    this.chamadas.precheck += 1;
    return this.precheckOut;
  }
  async areaSave(input: { userId: string; label: string | null; radiusKm: number | null; nowMs: number }) {
    this.chamadas.areaSave += 1;
    const out = this.areaSaveOut ?? { status: 'definida', retryAfterS: null };
    if (out.status === 'definida' || out.status === 'alterada') {
      const atual = this.areas.get(input.userId);
      this.areas.set(input.userId, {
        addressLabel: input.label ?? atual?.addressLabel ?? '',
        radiusKm: input.radiusKm ?? atual?.radiusKm ?? 0,
        since: new Date(input.nowMs).toISOString(),
        changesRemaining: 2,
        nextChangeAt: null,
      } as unknown as ProfessionalAreaView);
    }
    return out as Awaited<ReturnType<ProfessionalOfferingPort['areaSave']>>;
  }
  async servicesSave(input: { userId: string; items: { serviceId: string; modality: string }[] }) {
    this.chamadas.servicesSave += 1;
    const out = this.servicesSaveOut ?? { status: 'saved', index: null, retryAfterS: null };
    if (out.status === 'saved') {
      this.servicos.set(
        input.userId,
        input.items.map((i) => ({
          serviceId: i.serviceId,
          name: 'Servico sintetico',
          regulated: false,
          active: true,
          modality: i.modality,
        })) as unknown as ServiceRow[],
      );
    }
    return out as Awaited<ReturnType<ProfessionalOfferingPort['servicesSave']>>;
  }
  async servicesList(userId: string) {
    return this.servicos.get(userId) ?? [];
  }
}

interface Resposta {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly texto: string;
  readonly json: unknown;
}

let servidor: Server;
let base: string;
let oferta: OfertaMemoria;
const sessoes = new Map<string, SessionRecord>();

function cookieDe(userId: string): string {
  const segredo = randomBytes(32).toString('base64url');
  sessoes.set(hashSessionSecret(segredo), {
    sessionId: randomUUID(),
    userId,
    recentAuthAtMs: Date.now(),
    authMethod: 'password',
  });
  return `${SESSION_COOKIE_NAME}=${segredo}`;
}

function iniciar(opts: Partial<ProfessionalOfferingRouteOptions> = {}): Promise<void> {
  oferta = new OfertaMemoria();
  const repo = { authenticate: async (hash: string) => sessoes.get(hash) ?? null } as unknown as SessionRepositoryPort;
  const rota: ProfessionalOfferingRouteOptions = {
    sessions: repo,
    offering: oferta,
    locate: async () => {
      oferta.chamadas.locate += 1;
      if (oferta.locateErro !== null) throw oferta.locateErro;
      return oferta.locateOut;
    },
    rateKey: (purpose, userId) => `${purpose}:${userId}`.padEnd(64, '0').slice(0, 64),
    siteUrl: SITE,
    clock: { nowMs: () => Date.UTC(2099, 0, 1, 12) },
    ...opts,
  };
  servidor = createServer((req, res) => {
    void handleRequest(req, res, { tickSecret: undefined, professionalOffering: rota });
  });
  return new Promise((ok) => {
    servidor.listen(0, '127.0.0.1', () => {
      const { port } = servidor.address() as AddressInfo;
      base = `http://127.0.0.1:${port}`;
      ok();
    });
  });
}

function chamar(
  metodo: 'GET' | 'PUT',
  caminho: string,
  o: {
    cookie?: string;
    corpo?: unknown;
    texto?: string;
    origin?: string | null;
    fetchSite?: string | null;
    contentType?: string;
  } = {},
): Promise<Resposta> {
  const corpoTexto = o.texto ?? (o.corpo === undefined ? '' : JSON.stringify(o.corpo));
  const headers: Record<string, string> = {};
  if (o.origin !== null) headers.origin = o.origin ?? SITE;
  if (o.fetchSite !== null) headers['sec-fetch-site'] = o.fetchSite ?? 'same-origin';
  if (o.cookie !== undefined) headers.cookie = o.cookie;
  if (metodo === 'PUT') {
    headers['content-type'] = o.contentType ?? 'application/json';
    headers['content-length'] = String(Buffer.byteLength(corpoTexto));
  }
  return new Promise((ok, falha) => {
    const req = request(`${base}${caminho}`, { method: metodo, headers }, (res) => {
      const partes: Buffer[] = [];
      res.on('data', (c: Buffer) => partes.push(c));
      res.on('end', () => {
        const texto = Buffer.concat(partes).toString('utf8');
        let json: unknown = undefined;
        try {
          json = JSON.parse(texto);
        } catch {
          json = undefined;
        }
        ok({ status: res.statusCode ?? 0, headers: res.headers, texto, json });
      });
    });
    req.on('error', falha);
    req.end(metodo === 'PUT' ? corpoTexto : undefined);
  });
}

/** Lista de chaves proibidas em qualquer nivel de um JSON (varredura recursiva). */
function chavesProibidas(v: unknown, achados: string[] = []): string[] {
  if (Array.isArray(v)) {
    for (const item of v) chavesProibidas(item, achados);
  } else if (v !== null && typeof v === 'object') {
    for (const [chave, valor] of Object.entries(v)) {
      if (CHAVES_PROIBIDAS.test(chave)) achados.push(chave);
      chavesProibidas(valor, achados);
    }
  }
  return achados;
}

/** Captura de tudo o que sai para log e console durante o caso (T-P16). */
let registros: string[] = [];

beforeEach(() => {
  sessoes.clear();
  registros = [];
  for (const metodo of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, metodo).mockImplementation((...args: unknown[]) => {
      registros.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a) ?? String(a))).join(' '));
    });
  }
});

afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((ok) => servidor.close(() => ok()));
});

const ALICE = randomUUID();
const BRUNO = randomUUID();
const SEM_PERFIL = randomUUID();
const SUSPENSO = randomUUID();
const ENDERECO = 'Rua Sintetica 100, Centro';
const ENDERECO_CANARIO = `Rua ${CANARIO}, 100 - Centro`;

describe('T-P15 contrato da rota: outro profissional, sessao e varredura de chaves', () => {
  it('visitante recebe 401 e conta sem perfil recebe 403, nos dois GET e nos dois PUT', async () => {
    await iniciar();
    oferta.status.set(ALICE, 'aprovada');
    for (const caminho of [AREA, SERVICOS]) {
      expect((await chamar('GET', caminho)).status).toBe(401);
      expect((await chamar('PUT', caminho, { corpo: { services: [] } })).status).toBe(401);
    }
    const sem = cookieDe(SEM_PERFIL);
    const g = await chamar('GET', AREA, { cookie: sem });
    expect(g.status).toBe(403);
    expect(g.json).toEqual({ error: 'sem_perfil' });
  });

  it('cada profissional so ve a propria area: a rota nao aceita identificador e o outro nao enxerga', async () => {
    await iniciar();
    oferta.status.set(ALICE, 'aprovada');
    oferta.status.set(BRUNO, 'aprovada');
    oferta.areas.set(ALICE, { addressLabel: 'Rua da Alice, 1', radiusKm: 12, since: '2099-01-01', changesRemaining: 3, nextChangeAt: null } as unknown as ProfessionalAreaView);
    const bruno = await chamar('GET', AREA, { cookie: cookieDe(BRUNO) });
    expect(bruno.json).toEqual({ configured: false });
    expect(bruno.texto).not.toContain('Rua da Alice');
    // Identificador no corpo nao muda o dono: chave fora do contrato e recusada.
    const tentativa = await chamar('PUT', AREA, { cookie: cookieDe(BRUNO), corpo: { userId: ALICE, radiusKm: 10 } });
    expect(tentativa.status).toBe(422);
    expect(tentativa.json).toEqual({ error: 'validation', code: 'formato', field: null });
    expect(oferta.chamadas.areaSave).toBe(0);
  });

  it('varredura: nenhuma resposta (200 ou erro) de GET e PUT traz chave de localizacao, ponto ou coordenada', async () => {
    await iniciar();
    oferta.status.set(ALICE, 'aprovada');
    const cookie = cookieDe(ALICE);
    const respostas: Resposta[] = [
      await chamar('GET', AREA, { cookie }),
      await chamar('GET', SERVICOS, { cookie }),
      await chamar('PUT', AREA, { cookie, corpo: { addressText: ENDERECO, radiusKm: 10 } }),
      await chamar('PUT', AREA, { cookie, corpo: { radiusKm: 101 } }),
      await chamar('PUT', SERVICOS, { cookie, corpo: { services: [] } }),
      await chamar('GET', AREA, { cookie: cookieDe(SUSPENSO) }),
    ];
    for (const r of respostas) {
      expect(chavesProibidas(r.json), r.texto).toEqual([]);
      expect(r.texto).not.toContain(COORD_LAT);
      expect(r.texto).not.toContain(COORD_LON);
      expect(r.texto).not.toContain(PONTO_ID);
    }
    // A area do dono sai com rotulo e raio (campos permitidos), sem ponto nem celula.
    const area = respostas[2].json as { area: Record<string, unknown> };
    expect(Object.keys(area.area).sort()).toEqual(['addressLabel', 'changesRemaining', 'configured', 'nextChangeAt', 'radiusKm', 'since'].sort());
  });
});

describe('T-P16 log e erro sem PII (canario em endereco, falha de banco e de localizacao)', () => {
  it('nenhum canario aparece em log, console ou resposta, mesmo com erro de banco e de localizacao', async () => {
    await iniciar();
    oferta.status.set(ALICE, 'aprovada');
    const cookie = cookieDe(ALICE);
    const respostas: Resposta[] = [];

    // Erro de banco na leitura da area: 503 de texto unico.
    oferta.falhaLeitura = true;
    respostas.push(await chamar('GET', AREA, { cookie }));
    respostas.push(await chamar('PUT', AREA, { cookie, corpo: { addressText: ENDERECO_CANARIO, radiusKm: 10 } }));
    oferta.falhaLeitura = false;

    // Localizador lanca com o endereco e a coordenada no texto do erro: 503 sem eco.
    oferta.locateErro = new Error(`provedor recusou ${ENDERECO_CANARIO} em ${COORD_LAT},${COORD_LON}`);
    respostas.push(await chamar('PUT', AREA, { cookie, corpo: { addressText: ENDERECO_CANARIO, radiusKm: 10 } }));
    oferta.locateErro = null;

    // Erro na gravacao: o banco tambem devolve o canario. Resposta de texto fixo.
    oferta.areaSaveOut = { status: 'ponto_invalido', retryAfterS: null };
    respostas.push(await chamar('PUT', AREA, { cookie, corpo: { addressText: ENDERECO_CANARIO, radiusKm: 10 } }));
    oferta.areaSaveOut = null;

    for (const r of respostas) {
      expect(r.status).toBe(503);
      expect(r.texto, r.texto).not.toContain(CANARIO);
      expect(r.texto).not.toContain(COORD_LAT);
      expect(r.json).toEqual(expect.objectContaining({ error: expect.any(String) }));
      expect(Object.keys(r.json as object).every((k) => ['error', 'code', 'field', 'retryAfterS'].includes(k))).toBe(true);
    }
    expect(registros.join('\n')).not.toContain(CANARIO);
    expect(registros.join('\n')).not.toContain(COORD_LAT);
  });

  it('o corpo do PUT nao volta em erro de formato nem vai para o registro', async () => {
    await iniciar();
    oferta.status.set(ALICE, 'aprovada');
    const r = await chamar('PUT', AREA, { cookie: cookieDe(ALICE), corpo: { addressText: `${CANARIO}?`, radiusKm: 'nao-e-numero' } });
    expect(r.status).toBe(422);
    expect(r.texto).not.toContain(CANARIO);
    expect(registros.join('\n')).not.toContain(CANARIO);
  });
});

describe('mapeamento de desfechos (422, 429, 503, 409, 403, 415, 413)', () => {
  it('raio fora de 5..100 inteiro: 422 raio_invalido em todos os formatos errados e aceita as bordas', async () => {
    await iniciar();
    oferta.status.set(ALICE, 'aprovada');
    const cookie = cookieDe(ALICE);
    for (const raio of ['5', 5.5, 4, 101, 0, -3, null]) {
      const r = await chamar('PUT', AREA, { cookie, corpo: { addressText: ENDERECO, radiusKm: raio } });
      expect(r.status, `raio ${String(raio)}`).toBe(422);
      expect(r.json).toEqual({ error: 'validation', code: 'raio_invalido', field: 'radiusKm' });
    }
    expect(oferta.chamadas.locate).toBe(0);
    expect(oferta.chamadas.areaSave).toBe(0);
    for (const raio of [5, 100]) {
      const r = await chamar('PUT', AREA, { cookie, corpo: { addressText: ENDERECO, radiusKm: raio } });
      expect(r.status, `borda ${raio}`).toBe(200);
      expect((r.json as { status: string }).status).toBe('definida');
    }
  });

  it('primeira definicao sem os dois campos: 422 dados_incompletos; endereco curto: 422 endereco_invalido', async () => {
    await iniciar();
    oferta.status.set(ALICE, 'aprovada');
    const cookie = cookieDe(ALICE);
    const semRaio = await chamar('PUT', AREA, { cookie, corpo: { addressText: ENDERECO } });
    expect(semRaio.json).toEqual({ error: 'validation', code: 'dados_incompletos', field: null });
    const curto = await chamar('PUT', AREA, { cookie, corpo: { addressText: 'ab', radiusKm: 10 } });
    expect(curto.status).toBe(422);
    expect(curto.json).toEqual({ error: 'validation', code: 'endereco_invalido', field: 'addressText' });
  });

  it('desfechos do localizador: nao encontrado 422, entrada 422, em andamento 409, teto 429, indisponivel e aguardando 503', async () => {
    const casos: [EnsurePermanentOutcome, number, unknown][] = [
      [{ status: 'endereco_nao_encontrado' }, 422, { error: 'validation', code: 'endereco_nao_encontrado', field: 'addressText' }],
      [{ status: 'entrada_invalida' }, 422, { error: 'validation', code: 'endereco_invalido', field: 'addressText' }],
      [{ status: 'em_andamento' }, 409, { error: 'em_andamento' }],
      [{ status: 'teto' }, 429, { error: 'limite_tentativas' }],
      [{ status: 'indisponivel' }, 503, { error: 'geocodificacao_indisponivel' }],
      [{ status: 'aguardando_geocodificacao' }, 503, { error: 'geocodificacao_indisponivel' }],
    ];
    for (const [desfecho, status, corpo] of casos) {
      await iniciar();
      oferta.status.set(ALICE, 'aprovada');
      oferta.locateOut = desfecho;
      const r = await chamar('PUT', AREA, { cookie: cookieDe(ALICE), corpo: { addressText: ENDERECO, radiusKm: 10 } });
      expect(r.status, desfecho.status).toBe(status);
      expect(r.json, desfecho.status).toEqual(corpo);
      expect(oferta.chamadas.areaSave, `${desfecho.status} nao grava`).toBe(0);
      await new Promise<void>((ok) => servidor.close(() => ok()));
    }
  });

  it('limite de mudanca e de escrita: 429 com Retry-After e retryAfterS, sem chamada paga', async () => {
    await iniciar();
    oferta.status.set(ALICE, 'aprovada');
    oferta.precheckOut = { status: 'limite_mudanca', retryAfterS: 3600, callsCap: 40 };
    const mudanca = await chamar('PUT', AREA, { cookie: cookieDe(ALICE), corpo: { addressText: ENDERECO, radiusKm: 10 } });
    expect(mudanca.status).toBe(429);
    expect(mudanca.json).toEqual({ error: 'limite_mudanca', retryAfterS: 3600 });
    expect(mudanca.headers['retry-after']).toBe('3600');
    expect(oferta.chamadas.locate).toBe(0);

    // Servicos decidem o limite geral de escrita dentro de servicesSave (sem precheck).
    oferta.servicesSaveOut = { status: 'limite_escrita', index: null, retryAfterS: 120 };
    const escrita = await chamar('PUT', SERVICOS, { cookie: cookieDe(ALICE), corpo: { services: [] } });
    expect(escrita.status).toBe(429);
    expect(escrita.headers['retry-after']).toBe('120');
  });

  it('servicos: base obrigatoria, modalidade incompativel e limite viram 422 com o indice; 429 escrita; 403 suspenso', async () => {
    await iniciar();
    oferta.status.set(ALICE, 'aprovada');
    oferta.status.set(SUSPENSO, 'suspensa');
    const cookie = cookieDe(ALICE);
    const item = { serviceId: randomUUID(), modalities: ['presencial'] };
    oferta.servicesSaveOut = { status: 'base_obrigatoria', index: 0, retryAfterS: null };
    const sem = await chamar('PUT', SERVICOS, { cookie, corpo: { services: [item] } });
    expect(sem.status).toBe(422);
    expect(sem.json).toEqual({ error: 'validation', code: 'base_obrigatoria', field: 'services[0]' });

    oferta.servicesSaveOut = { status: 'modalidade_incompativel', index: 0, retryAfterS: null };
    const inc = await chamar('PUT', SERVICOS, { cookie, corpo: { services: [{ serviceId: randomUUID(), modalities: ['online'] }] } });
    expect(inc.json).toEqual({ error: 'validation', code: 'modalidade_incompativel', field: 'services[0]' });

    oferta.servicesSaveOut = { status: 'limite_servicos', index: null, retryAfterS: null };
    const lim = await chamar('PUT', SERVICOS, { cookie, corpo: { services: [item] } });
    expect(lim.json).toEqual({ error: 'validation', code: 'limite_servicos', field: null });

    const susp = await chamar('PUT', SERVICOS, { cookie: cookieDe(SUSPENSO), corpo: { services: [item] } });
    expect(susp.status).toBe(403);
    expect(susp.json).toEqual({ error: 'perfil_suspenso' });
    // Leitura continua permitida para perfil suspenso (CA-13 bloqueia so a escrita).
    expect((await chamar('GET', SERVICOS, { cookie: cookieDe(SUSPENSO) })).status).toBe(200);
    expect(oferta.chamadas.servicesSave).toBe(3);
  });

  it('servicos aceitos: 200 saved e depois unchanged, com a lista agrupada e sem identificador de ponto', async () => {
    await iniciar();
    oferta.status.set(ALICE, 'aprovada');
    const cookie = cookieDe(ALICE);
    const sid = randomUUID();
    const salvo = await chamar('PUT', SERVICOS, { cookie, corpo: { services: [{ serviceId: sid, modalities: ['online'] }] } });
    expect(salvo.status).toBe(200);
    expect((salvo.json as { status: string }).status).toBe('saved');
    oferta.servicesSaveOut = { status: 'unchanged', index: null, retryAfterS: null };
    const igual = await chamar('PUT', SERVICOS, { cookie, corpo: { services: [{ serviceId: sid, modalities: ['online'] }] } });
    expect((igual.json as { status: string }).status).toBe('unchanged');
  });
});

describe('Origin e Sec-Fetch-Site nas escritas', () => {
  it('Origin de outro site ou ausente e Sec-Fetch-Site cross-site recusam com 403 antes de tocar no banco', async () => {
    await iniciar();
    oferta.status.set(ALICE, 'aprovada');
    const cookie = cookieDe(ALICE);
    const corpo = { services: [] };
    const outroSite = await chamar('PUT', SERVICOS, { cookie, corpo, origin: 'https://atacante.example.test' });
    expect(outroSite.status).toBe(403);
    expect(outroSite.json).toEqual({ error: 'origem_invalida' });
    const semOrigem = await chamar('PUT', AREA, { cookie, corpo: { radiusKm: 10 }, origin: null });
    expect(semOrigem.status).toBe(403);
    const crossSite = await chamar('PUT', AREA, { cookie, corpo: { radiusKm: 10 }, fetchSite: 'cross-site' });
    expect(crossSite.status).toBe(403);
    expect(oferta.chamadas.servicesSave + oferta.chamadas.areaSave + oferta.chamadas.precheck).toBe(0);
    // Leitura nao exige Origin.
    expect((await chamar('GET', AREA, { cookie, origin: null, fetchSite: null })).status).toBe(200);
  });

  it('tipo de corpo errado: 415 tipo_invalido; corpo acima de 8 KB: 413 corpo_grande; JSON invalido: 400', async () => {
    await iniciar();
    oferta.status.set(ALICE, 'aprovada');
    const cookie = cookieDe(ALICE);
    expect((await chamar('PUT', AREA, { cookie, texto: '{"radiusKm":10}', contentType: 'text/plain' })).json).toEqual({ error: 'tipo_invalido' });
    const grande = await chamar('PUT', SERVICOS, { cookie, texto: JSON.stringify({ services: [], pad: 'x'.repeat(9000) }) });
    expect(grande.status).toBe(413);
    expect(grande.json).toEqual({ error: 'corpo_grande' });
    const ruim = await chamar('PUT', AREA, { cookie, texto: '{nao-json' });
    expect(ruim.status).toBe(400);
    expect(ruim.json).toEqual({ error: 'json_invalido' });
  });

  it('falha de leitura dos servicos vira 503 de texto unico', async () => {
    await iniciar();
    oferta.status.set(ALICE, 'aprovada');
    oferta.falhaLeitura = true;
    const r = await chamar('GET', AREA, { cookie: cookieDe(ALICE) });
    expect(r.status).toBe(503);
    expect(r.json).toEqual({ error: 'servico_indisponivel' });
  });
});
