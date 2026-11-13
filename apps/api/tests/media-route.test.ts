// H-026 (Issue #39) | Rotas da quarentena de fotos com banco e Storage em memoria (docs/factory/88-DESENHO-H026.md, §7;
// M-01, M-02, M-04, M-05, M-06, M-07 (parte da API), M-10, M-12, M-13). Regras espelham as funcoes SQL da
// migracao 20261112120000; a prova no Postgres real fica em packages/db/tests/media-quarantine-h026.dbtest.mjs.
// Servidor de loopback e cliente node:http; fetch global bloqueado. Dados sinteticos (@example.test).
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-026');
};

import { afterAll, describe, expect, it, vi } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  MEDIA_PATH,
  mediaObjectKey,
  type QuarantineStoragePort,
} from '@fastpro/domain';
import { handleRequest } from '../src/app.js';
import { createDraftHasher } from '../src/drafts/draft-hash.js';
import type { MediaDeps } from '../src/media/media-service.js';
import { ReduceCounters } from '../src/media/media-reduce-service.js';
import { ReduceGate } from '../src/media/reduce-gate.js';
import { FakeReducer, MemMedia, MemRate, MemReduceStorage, TAMANHO_MAX, TTL_MS, uuid } from './media-fakes-h027.js';

const SITE = 'https://fastpro.example.test';
const CHAVE_IP = 'k'.repeat(40);
const T0 = Date.UTC(2026, 10, 12, 12, 0, 0);
const HORA = 3_600_000;
const COOKIE = '__Host-fp_draft';

const segredo = (i: number): string => String(i).padStart(43, 'B');
const cuid = (n: number): string => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const hasher = createDraftHasher(CHAVE_IP);

/** Storage em memoria: so chaves, tamanhos e URLs. Nenhum metodo de leitura de conteudo. */
class FakeStorage implements QuarantineStoragePort {
  readonly objetos = new Map<string, number>();
  readonly assinadas: string[] = [];
  falharAssinatura = false;

  async createUploadUrl(key: string): Promise<{ url: string }> {
    if (this.falharAssinatura) throw new Error('falha simulada');
    this.assinadas.push(key);
    return { url: `https://storage.example.test/storage/v1/object/upload/sign/quarantine/${key}?token=TOKEN-${key}` };
  }
  async stat(key: string): Promise<{ bytes: number } | null> {
    const b = this.objetos.get(key);
    return b === undefined ? null : { bytes: b };
  }
  async remove(key: string): Promise<void> {
    this.objetos.delete(key);
  }
  async listOlderThan(): Promise<readonly string[]> {
    return [];
  }
}

interface Mundo {
  store: MemMedia;
  storage: FakeStorage;
  rate: MemRate;
  relogio: { agora: number };
  deps: MediaDeps;
  porta: number;
  reducer: FakeReducer;
  reduzidos: MemReduceStorage;
}
const servidores: Server[] = [];

async function iniciar(opcoes: { globalCap?: number } = {}): Promise<Mundo> {
  const store = new MemMedia();
  const storage = new FakeStorage();
  const rate = new MemRate();
  const relogio = { agora: T0 };
  const reducer = new FakeReducer();
  const reduzidos = new MemReduceStorage(store.diario);
  // Original de teste: a reducao falsa devolve sempre a mesma saida; so os bytes de entrada importam pouco aqui.
  // H-028 (#41, 96-DESENHO §7): o original falso comeca com a assinatura JPEG (a checagem recusa o resto).
  reduzidos.padraoOriginal = new Uint8Array(1000).fill(1);
  reduzidos.padraoOriginal.set([0xff, 0xd8, 0xff, 0xe0]);
  const deps: MediaDeps = {
    store,
    storage,
    rate,
    hasher,
    clock: { nowMs: () => relogio.agora },
    globalCap: opcoes.globalCap,
    reduce: { store, storage: reduzidos, reducer, gate: new ReduceGate(), contadores: new ReduceCounters() },
  };
  const server = createServer((req, res) => {
    handleRequest(req, res, { tickSecret: undefined, media: { deps, siteUrl: SITE } }).catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  servidores.push(server);
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const porta = (server.address() as AddressInfo).port;
  return { store, storage, rate, relogio, deps, porta, reducer, reduzidos };
}

/** Cria um rascunho vivo para o segredo informado. */
function rascunho(mundo: Mundo, s: string, expiresMs = T0 + 7 * 24 * HORA): void {
  mundo.store.rascunhos.set(hasher.secretHash(s), { status: 'aberto', expiresMs });
}

interface Resposta {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

interface Pedido {
  metodo: string;
  caminho: string;
  cookie?: string;
  corpo?: unknown;
  textoBruto?: string;
  tipo?: string | null;
}

function pedir(porta: number, p: Pedido): Promise<Resposta> {
  const headers: Record<string, string> = { Origin: SITE, 'Sec-Fetch-Site': 'same-origin' };
  const texto = p.textoBruto ?? (p.corpo === undefined ? '' : JSON.stringify(p.corpo));
  const comCorpo = p.corpo !== undefined || p.textoBruto !== undefined;
  if (comCorpo) {
    if (p.tipo !== null) headers['Content-Type'] = p.tipo ?? 'application/json';
    headers['Content-Length'] = String(Buffer.byteLength(texto));
  }
  if (p.cookie) headers['Cookie'] = p.cookie;
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: porta, method: p.metodo, path: p.caminho, headers }, (res) => {
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
const corpoEmissao = (n: number, extra: Record<string, unknown> = {}) => ({
  client_upload_id: cuid(n),
  content_type: 'image/jpeg',
  size_bytes: 1_000_000,
  ...extra,
});

/** Assinatura de uma resposta sem os cabecalhos que variam por conexao, para comparar 404 byte a byte. */
function assinatura(r: Resposta): string {
  const ignorar = new Set(['date', 'connection', 'keep-alive']);
  const linhas = Object.keys(r.headers)
    .filter((k) => !ignorar.has(k))
    .sort()
    .map((k) => `${k}:${JSON.stringify(r.headers[k])}`);
  return `${r.status}|${linhas.join('|')}|${r.body}`;
}

const mundos: Mundo[] = [];
async function novo(opcoes: { globalCap?: number } = {}): Promise<Mundo> {
  const m = await iniciar(opcoes);
  mundos.push(m);
  return m;
}

afterAll(() => {
  for (const s of servidores) s.close();
});

describe('H-026 | POST /v1/media/uploads (emissao)', () => {
  it('M-01: nova foto de 1 byte e de 10 MB, nos tres tipos, cria pendente e devolve URL de envio (201)', async () => {
    const m = await novo();
    rascunho(m, segredo(1));
    const r1 = await pedir(m.porta, {
      metodo: 'POST',
      caminho: MEDIA_PATH,
      cookie: enviaCookie(segredo(1)),
      corpo: corpoEmissao(1, { size_bytes: 1, content_type: 'image/png' }),
    });
    expect(r1.status).toBe(201);
    const j1 = JSON.parse(r1.body) as Record<string, unknown>;
    expect(j1['status']).toBe('pending');
    expect(String(j1['upload_url'])).toContain('https://storage.example.test/');
    expect(Object.keys(j1).sort()).toEqual(['id', 'status', 'upload_expires_at', 'upload_url']);
    const r2 = await pedir(m.porta, {
      metodo: 'POST',
      caminho: MEDIA_PATH,
      cookie: enviaCookie(segredo(1)),
      corpo: corpoEmissao(2, { size_bytes: TAMANHO_MAX, content_type: 'image/webp' }),
    });
    expect(r2.status).toBe(201);
    expect(m.storage.assinadas).toHaveLength(2);
    expect(m.storage.assinadas[0]).toBe(mediaObjectKey(String(j1['id'])));
  });

  it('M-02: a 6a foto de um rascunho recebe 422 photo_limit sem assinar URL nem gravar', async () => {
    const m = await novo();
    rascunho(m, segredo(2));
    for (let n = 1; n <= 5; n++) {
      const r = await pedir(m.porta, { metodo: 'POST', caminho: MEDIA_PATH, cookie: enviaCookie(segredo(2)), corpo: corpoEmissao(n) });
      expect(r.status).toBe(201);
    }
    const antes = { assinadas: m.storage.assinadas.length, linhas: m.store.linhas.size };
    const sexta = await pedir(m.porta, { metodo: 'POST', caminho: MEDIA_PATH, cookie: enviaCookie(segredo(2)), corpo: corpoEmissao(6) });
    expect(sexta.status).toBe(422);
    expect(JSON.parse(sexta.body)).toEqual({ code: 'photo_limit' });
    expect(m.storage.assinadas.length).toBe(antes.assinadas);
    expect(m.store.linhas.size).toBe(antes.linhas);
  });

  it('M-04: mesmo client_upload_id devolve o mesmo id (200 com URL); depois de confirmado, 200 sem URL', async () => {
    const m = await novo();
    rascunho(m, segredo(3));
    const c = enviaCookie(segredo(3));
    const a = await pedir(m.porta, { metodo: 'POST', caminho: MEDIA_PATH, cookie: c, corpo: corpoEmissao(7) });
    const b = await pedir(m.porta, { metodo: 'POST', caminho: MEDIA_PATH, cookie: c, corpo: corpoEmissao(7) });
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    const id = String(JSON.parse(a.body)['id']);
    expect(JSON.parse(b.body)['id']).toBe(id);
    expect(m.store.linhas.size).toBe(1);

    m.storage.objetos.set(mediaObjectKey(id), 1_000_000);
    const f1 = await pedir(m.porta, { metodo: 'POST', caminho: `${MEDIA_PATH.replace('/uploads', '')}/${id}/finalize`, cookie: c });
    const f2 = await pedir(m.porta, { metodo: 'POST', caminho: `${MEDIA_PATH.replace('/uploads', '')}/${id}/finalize`, cookie: c });
    // H-027 (93 §2.3): finalize confirma e reduz; a repeticao devolve ready sem reencode (CA-06).
    expect(f1.status).toBe(200);
    expect(f2.status).toBe(200);
    expect(JSON.parse(f1.body)).toEqual({ id, status: 'ready', confirmed: true });
    expect(JSON.parse(f2.body)).toEqual({ id, status: 'ready', confirmed: true });
    expect(m.reducer.chamadas).toBe(1);
    const confirmadoAt = m.store.linhas.get(id)?.confirmedMs;

    const c3 = await pedir(m.porta, { metodo: 'POST', caminho: MEDIA_PATH, cookie: c, corpo: corpoEmissao(7) });
    expect(c3.status).toBe(200);
    expect(JSON.parse(c3.body)).toEqual({ id, status: 'ready', confirmed: true });
    expect(JSON.parse(c3.body)['upload_url']).toBeUndefined();
    expect(m.store.linhas.get(id)?.confirmedMs).toBe(confirmadoAt);
    expect(m.store.linhas.size).toBe(1);
  });

  it('M-05: tamanho acima de 10 MB (413), tipo fora da lista e HEIC (415), campo desconhecido e corpo vazio (422)', async () => {
    const m = await novo();
    rascunho(m, segredo(4));
    const c = enviaCookie(segredo(4));
    const acima = await pedir(m.porta, { metodo: 'POST', caminho: MEDIA_PATH, cookie: c, corpo: corpoEmissao(10, { size_bytes: TAMANHO_MAX + 1 }) });
    expect(acima.status).toBe(413);
    expect(JSON.parse(acima.body)).toEqual({ code: 'arquivo_grande' });
    for (const tipo of ['image/gif', 'application/pdf', 'image/heic', 'image/heif']) {
      const r = await pedir(m.porta, { metodo: 'POST', caminho: MEDIA_PATH, cookie: c, corpo: corpoEmissao(11, { content_type: tipo }) });
      expect(r.status).toBe(415);
      expect(JSON.parse(r.body)).toEqual({ code: 'tipo_nao_aceito' });
    }
    const semTipo = await pedir(m.porta, { metodo: 'POST', caminho: MEDIA_PATH, cookie: c, corpo: { client_upload_id: cuid(12), size_bytes: 5 } });
    expect(semTipo.status).toBe(415);
    const vazio = await pedir(m.porta, { metodo: 'POST', caminho: MEDIA_PATH, cookie: c, textoBruto: '' });
    expect(vazio.status).toBe(422);
    expect(JSON.parse(vazio.body)).toEqual({ code: 'vazio' });
    const extra = await pedir(m.porta, { metodo: 'POST', caminho: MEDIA_PATH, cookie: c, corpo: corpoEmissao(13, { draft_id: 'x' }) });
    expect(extra.status).toBe(422);
    expect(JSON.parse(extra.body)).toEqual({ code: 'campo_desconhecido' });
    expect(m.store.linhas.size).toBe(0);
  });

  it('M-05 (finalize): objeto de mais de 10 MB vira 413 e a linha vai para expurgo; objeto ausente vira 409', async () => {
    const m = await novo();
    rascunho(m, segredo(5));
    const c = enviaCookie(segredo(5));
    const a = await pedir(m.porta, { metodo: 'POST', caminho: MEDIA_PATH, cookie: c, corpo: corpoEmissao(20) });
    const id = String(JSON.parse(a.body)['id']);
    const semObjeto = await pedir(m.porta, { metodo: 'POST', caminho: `/v1/media/${id}/finalize`, cookie: c });
    expect(semObjeto.status).toBe(409);
    expect(JSON.parse(semObjeto.body)).toEqual({ code: 'upload_nao_encontrado' });
    m.storage.objetos.set(mediaObjectKey(id), TAMANHO_MAX + 1);
    const grande = await pedir(m.porta, { metodo: 'POST', caminho: `/v1/media/${id}/finalize`, cookie: c });
    expect(grande.status).toBe(413);
    expect(JSON.parse(grande.body)).toEqual({ code: 'arquivo_grande' });
    expect(m.store.linhas.get(id)?.purgeMs).not.toBeNull();
  });
});

describe('H-026 | finalize e GET (posse, prazo, sem conteudo)', () => {
  it('M-07 (API): pendente vivo em 30 min - 1 s; expirado em 30 min devolve 409 upload_expirado; a vaga volta', async () => {
    const m = await novo();
    rascunho(m, segredo(6));
    const c = enviaCookie(segredo(6));
    const a = await pedir(m.porta, { metodo: 'POST', caminho: MEDIA_PATH, cookie: c, corpo: corpoEmissao(30) });
    const id = String(JSON.parse(a.body)['id']);
    m.storage.objetos.set(mediaObjectKey(id), 500_000);
    m.relogio.agora = T0 + TTL_MS - 1000;
    const vivo = await pedir(m.porta, { metodo: 'POST', caminho: `/v1/media/${id}/finalize`, cookie: c });
    expect(vivo.status).toBe(200);
    const m2 = await novo();
    rascunho(m2, segredo(7));
    const c2 = enviaCookie(segredo(7));
    const b = await pedir(m2.porta, { metodo: 'POST', caminho: MEDIA_PATH, cookie: c2, corpo: corpoEmissao(31) });
    const idB = String(JSON.parse(b.body)['id']);
    m2.storage.objetos.set(mediaObjectKey(idB), 500_000);
    m2.relogio.agora = T0 + TTL_MS;
    const exp = await pedir(m2.porta, { metodo: 'POST', caminho: `/v1/media/${idB}/finalize`, cookie: c2 });
    expect(exp.status).toBe(409);
    expect(JSON.parse(exp.body)).toEqual({ code: 'upload_expirado' });
    // A vaga volta: a emissao seguinte ja nao conta o pendente vencido no limite de 5.
    const depois = await pedir(m2.porta, { metodo: 'POST', caminho: MEDIA_PATH, cookie: c2, corpo: corpoEmissao(32) });
    expect(depois.status).toBe(201);
  });

  it('M-06: sem cookie, malformado, de outro navegador, id de outro rascunho e id nao uuid dao o mesmo 404, sem tocar o banco quando o cookie falha', async () => {
    const m = await novo();
    rascunho(m, segredo(8));
    rascunho(m, segredo(9));
    const dono = enviaCookie(segredo(8));
    const a = await pedir(m.porta, { metodo: 'POST', caminho: MEDIA_PATH, cookie: dono, corpo: corpoEmissao(40) });
    const idDono = String(JSON.parse(a.body)['id']);
    const outro = enviaCookie(segredo(9));

    const semCookieEmissao = await pedir(m.porta, { metodo: 'POST', caminho: MEDIA_PATH, corpo: corpoEmissao(41) });
    const malformado = await pedir(m.porta, { metodo: 'POST', caminho: MEDIA_PATH, cookie: `${COOKIE}=curto`, corpo: corpoEmissao(41) });
    expect(semCookieEmissao.status).toBe(404);
    expect(malformado.status).toBe(404);
    expect(assinatura(semCookieEmissao)).toBe(assinatura(malformado));

    const antes = m.store.chamadas;
    const semCookieGet = await pedir(m.porta, { metodo: 'GET', caminho: `/v1/media/${idDono}` });
    const semCookieFin = await pedir(m.porta, { metodo: 'POST', caminho: `/v1/media/${idDono}/finalize` });
    const idInvalido = await pedir(m.porta, { metodo: 'GET', caminho: '/v1/media/nao-e-uuid', cookie: dono });
    expect(m.store.chamadas).toBe(antes);
    expect(semCookieGet.status).toBe(404);
    expect(semCookieFin.status).toBe(404);
    expect(idInvalido.status).toBe(404);

    const deOutro = await pedir(m.porta, { metodo: 'GET', caminho: `/v1/media/${idDono}`, cookie: outro });
    const naoExiste = await pedir(m.porta, { metodo: 'GET', caminho: `/v1/media/${uuid(999)}`, cookie: dono });
    expect(deOutro.status).toBe(404);
    expect(naoExiste.status).toBe(404);
    expect(assinatura(deOutro)).toBe(assinatura(naoExiste));
    expect(assinatura(deOutro)).toBe(assinatura(semCookieGet));

    const finDeOutro = await pedir(m.porta, { metodo: 'POST', caminho: `/v1/media/${idDono}/finalize`, cookie: outro });
    expect(assinatura(finDeOutro)).toBe(assinatura(semCookieFin));
  });

  it('GET devolve estado sem URL, sem caminho e sem bucket (M-09 e M-13 na resposta)', async () => {
    const m = await novo();
    rascunho(m, segredo(10));
    const c = enviaCookie(segredo(10));
    const a = await pedir(m.porta, { metodo: 'POST', caminho: MEDIA_PATH, cookie: c, corpo: corpoEmissao(50) });
    const id = String(JSON.parse(a.body)['id']);
    const g = await pedir(m.porta, { metodo: 'GET', caminho: `/v1/media/${id}`, cookie: c });
    expect(g.status).toBe(200);
    expect(JSON.parse(g.body)).toEqual({ id, status: 'pending', confirmed: false });
    expect(g.body).not.toMatch(/quarantine|upload_url|token|d\//);
  });
});

describe('H-026 | rotas, cotas e sigilo', () => {
  it('M-10: fora das tres rotas, qualquer caminho ou metodo recebe o mesmo 404 (sem GET de arquivo)', async () => {
    const m = await novo();
    rascunho(m, segredo(11));
    const c = enviaCookie(segredo(11));
    const id = uuid(77);
    const alvos: Pedido[] = [
      { metodo: 'GET', caminho: MEDIA_PATH, cookie: c },
      { metodo: 'PUT', caminho: MEDIA_PATH, cookie: c, corpo: corpoEmissao(60) },
      { metodo: 'GET', caminho: `/v1/media/${id}/finalize`, cookie: c },
      { metodo: 'POST', caminho: `/v1/media/${id}`, cookie: c },
      { metodo: 'DELETE', caminho: `/v1/media/${id}`, cookie: c },
      { metodo: 'GET', caminho: `/v1/media/${id}/arquivo`, cookie: c },
      { metodo: 'GET', caminho: `/v1/media/${id}/download`, cookie: c },
    ];
    for (const alvo of alvos) {
      const r = await pedir(m.porta, alvo);
      expect(r.status).toBe(404);
      expect(r.body).not.toMatch(/quarantine|upload_url|token/);
    }
    // Dentro do prefixo de rotas de midia, o 404 e o mesmo corpo uniforme.
    const dentro = await pedir(m.porta, { metodo: 'GET', caminho: `/v1/media/${id}/arquivo`, cookie: c });
    expect(JSON.parse(dentro.body)).toEqual({ code: 'nao_encontrado' });
  });

  it('M-10: corpo com draft_id, owner ou request_id e recusado (422 campo_desconhecido)', async () => {
    const m = await novo();
    rascunho(m, segredo(12));
    for (const chave of ['draft_id', 'owner', 'request_id', 'filename', 'name', 'bucket', 'path']) {
      const r = await pedir(m.porta, {
        metodo: 'POST',
        caminho: MEDIA_PATH,
        cookie: enviaCookie(segredo(12)),
        corpo: corpoEmissao(70, { [chave]: 'valor-sintetico' }),
      });
      expect(r.status).toBe(422);
      expect(JSON.parse(r.body)).toEqual({ code: 'campo_desconhecido' });
    }
  });

  it('M-12: 13a emissao na hora no mesmo rascunho recebe 429 com Retry-After e sem campo de limite; recusa de 422 nao conta', async () => {
    const m = await novo();
    // Isola o limite de taxa: o teto de 5 vagas (SQL, M-02) e elevado aqui para chegar a 12 emissoes aceitas.
    m.store.vagasPorRascunho = 100;
    rascunho(m, segredo(13));
    const c = enviaCookie(segredo(13));
    for (let n = 1; n <= 12; n++) {
      const ok = await pedir(m.porta, { metodo: 'POST', caminho: MEDIA_PATH, cookie: c, corpo: corpoEmissao(80 + n) });
      expect(ok.status).toBe(201);
    }
    const hitsDepois12 = m.rate.hits;
    // Recusa de corpo invalido nao conta na cota.
    for (let n = 1; n <= 3; n++) {
      await pedir(m.porta, { metodo: 'POST', caminho: MEDIA_PATH, cookie: c, corpo: corpoEmissao(100 + n, { size_bytes: 0 }) });
    }
    expect(m.rate.hits).toBe(hitsDepois12);
    const r = await pedir(m.porta, { metodo: 'POST', caminho: MEDIA_PATH, cookie: c, corpo: corpoEmissao(120) });
    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toBeDefined();
    // Sem campo que revele o limite: so codigo fixo e a espera.
    expect(Object.keys(JSON.parse(r.body)).sort()).toEqual(['code', 'retry_after_seconds']);
    expect(r.body).not.toMatch(/limite|limit/);
    expect(m.rate.hits).toBe(hitsDepois12);
  });

  it('M-12 (teto global): com o teto atingido, a emissao recebe 429 neutro', async () => {
    const m = await novo({ globalCap: 2 });
    rascunho(m, segredo(14));
    rascunho(m, segredo(15));
    await pedir(m.porta, { metodo: 'POST', caminho: MEDIA_PATH, cookie: enviaCookie(segredo(14)), corpo: corpoEmissao(130) });
    await pedir(m.porta, { metodo: 'POST', caminho: MEDIA_PATH, cookie: enviaCookie(segredo(15)), corpo: corpoEmissao(131) });
    const r = await pedir(m.porta, { metodo: 'POST', caminho: MEDIA_PATH, cookie: enviaCookie(segredo(14)), corpo: corpoEmissao(132) });
    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toBeDefined();
  });

  it('M-13: nome, EXIF e IP sentinela nao aparecem em nenhuma resposta nem em log; nenhum log e escrito', async () => {
    const m = await novo();
    rascunho(m, segredo(16));
    const logs: unknown[] = [];
    const espias = [
      vi.spyOn(console, 'log').mockImplementation((...a) => void logs.push(a)),
      vi.spyOn(console, 'warn').mockImplementation((...a) => void logs.push(a)),
      vi.spyOn(console, 'error').mockImplementation((...a) => void logs.push(a)),
    ];
    const sentinela = 'rua-das-flores-12';
    try {
      const c = enviaCookie(segredo(16));
      const ruim = await pedir(m.porta, {
        metodo: 'POST',
        caminho: MEDIA_PATH,
        cookie: c,
        corpo: corpoEmissao(140, { filename: `${sentinela}.jpg`, exif_gps: '-23.5,-46.6' }),
      });
      expect(ruim.status).toBe(422);
      expect(ruim.body).not.toContain(sentinela);
      const bom = await pedir(m.porta, { metodo: 'POST', caminho: MEDIA_PATH, cookie: c, corpo: corpoEmissao(141) });
      const id = String(JSON.parse(bom.body)['id']);
      expect(bom.body).not.toContain(sentinela);
      expect(JSON.stringify(bom.headers)).not.toContain(sentinela);
      expect(String(m.storage.assinadas[0])).toBe(mediaObjectKey(id));
      expect(String(m.storage.assinadas[0])).not.toContain(sentinela);
      expect(logs).toEqual([]);
    } finally {
      for (const e of espias) e.mockRestore();
    }
  });

  it('503 fixo quando a assinatura da URL falha; a cota nao e contada', async () => {
    const m = await novo();
    rascunho(m, segredo(17));
    m.storage.falharAssinatura = true;
    const hitsAntes = m.rate.hits;
    const r = await pedir(m.porta, { metodo: 'POST', caminho: MEDIA_PATH, cookie: enviaCookie(segredo(17)), corpo: corpoEmissao(150) });
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body)).toEqual({ code: 'indisponivel' });
    expect(m.rate.hits).toBe(hitsAntes);
  });
});
