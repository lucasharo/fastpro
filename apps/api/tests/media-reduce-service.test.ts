// H-027 (Issue #40) | Servico da reducao com banco, Storage e redutor falsos (docs/factory/93-DESENHO-H027.md, §2 a §7;
// R-02 (parte falsa), R-03, R-04, R-05, R-06, R-07, R-10, R-11, R-15 (parte falsa)). O Storage local e o banco com
// duas conexoes ficam NAO_EXECUTADO (sem Docker; concorrencia com commit). O redutor real esta em media-reduce-image.test.ts.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-027');
};

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { sweepQuarantine, type MediaRejectCode, type MediaStorePort } from '@fastpro/domain';
import { ReduceCounters, reduzirFoto, type ReduceDeps } from '../src/media/media-reduce-service.js';
import { ReduceGate } from '../src/media/reduce-gate.js';
import { FakeReducer, MemReduceRows, MemReduceStorage, type LinhaR } from './media-fakes-h027.js';

const T0 = Date.UTC(2026, 10, 12, 12, 0, 0);
const MIN = 60_000;
const HASH = 'a'.repeat(64);
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// H-028 (#41, 96-DESENHO §7): o original falso comeca com a assinatura JPEG; o FakeReducer nao decodifica nada.
const ORIG = new Uint8Array(1000).fill(7);
ORIG.set([0xff, 0xd8, 0xff, 0xe0]);

function linha(id: string, extra: Partial<LinhaR> = {}): LinhaR {
  return {
    id,
    draftHash: HASH,
    status: 'pending',
    confirmedMs: T0,
    purgeMs: null,
    createdMs: T0,
    attempts: 0,
    leaseMs: null,
    rejectCode: null,
    originalRemovedMs: null,
    readyBytes: null,
    readyWidth: null,
    readyHeight: null,
    readyMs: null,
    ...extra,
  };
}

function montar(opts: { waitMs?: number; atrasoMs?: number; comportamento?: ConstructorParameters<typeof FakeReducer>[0] } = {}) {
  const diario: string[] = [];
  const linhas = new Map<string, LinhaR>();
  const rows = new MemReduceRows(linhas, () => true, diario);
  const store = {
    reduceBegin: async (...a: Parameters<MemReduceRows['reduceBegin']>) => rows.reduceBegin(...a),
    reduceDone: async (...a: Parameters<MemReduceRows['reduceDone']>) => rows.reduceDone(...a),
    reduceReject: async (...a: Parameters<MemReduceRows['reduceReject']>) => rows.reduceReject(...a),
    reduceRelease: async (...a: Parameters<MemReduceRows['reduceRelease']>) => rows.reduceRelease(...a),
    originalRemoved: async (...a: Parameters<MemReduceRows['originalRemoved']>) => rows.originalRemoved(...a),
    originalCleanupList: async (n: number) => rows.originalCleanupList(n),
  } as unknown as MediaStorePort;
  const storage = new MemReduceStorage(diario);
  const reducer = new FakeReducer(opts.comportamento, opts.atrasoMs ?? 0);
  const gate = new ReduceGate({ waitMs: opts.waitMs ?? 2000 });
  const contadores = new ReduceCounters();
  const deps: ReduceDeps = { store, storage, reducer, gate, contadores };
  const agora = (): number => T0 + MIN;
  const reduzir = (id: string) => reduzirFoto({ id, hash: HASH }, deps, agora());
  return { deps, linhas, diario, storage, reducer, contadores, gate, rows, reduzir };
}

const corpo = (r: { body: string }): Record<string, unknown> => JSON.parse(r.body) as Record<string, unknown>;

describe('H-027 | R-02 (parte falsa): reducao grava uma versao reduzida e remove o original', () => {
  it('apos finalize: uma reduzida p/<uuid>, nenhum original, linha ready com dimensoes', async () => {
    const m = montar();
    m.linhas.set(uuid(1), linha(uuid(1)));
    m.storage.originais.set(uuid(1), ORIG);
    const r = await m.reduzir(uuid(1));
    expect(r.status).toBe(200);
    expect(corpo(r)).toEqual({ id: uuid(1), status: 'ready', confirmed: true });
    expect([...m.storage.reduzidas.keys()]).toEqual([uuid(1)]);
    expect(m.storage.originais.size).toBe(0);
    expect(m.linhas.get(uuid(1))?.status).toBe('ready');
    expect(m.linhas.get(uuid(1))?.originalRemovedMs).not.toBeNull();
  });
});

describe('H-027 | R-03: ordem objeto -> registro -> remocao, e nunca ready sem objeto', () => {
  it('a ordem registrada e putReduced < reduceDone < removeOriginal', async () => {
    const m = montar();
    m.linhas.set(uuid(2), linha(uuid(2)));
    m.storage.originais.set(uuid(2), ORIG);
    await m.reduzir(uuid(2));
    const idx = (nome: string) => m.diario.indexOf(nome);
    expect(idx('putReduced')).toBeGreaterThan(-1);
    expect(idx('putReduced')).toBeLessThan(idx('reduceDone'));
    expect(idx('reduceDone')).toBeLessThan(idx('removeOriginal'));
  });

  it('falha de gravacao da reduzida: 503, linha continua pending e a tentativa e devolvida', async () => {
    const m = montar();
    m.linhas.set(uuid(3), linha(uuid(3)));
    m.storage.originais.set(uuid(3), ORIG);
    m.storage.falhas.add('put');
    const r = await m.reduzir(uuid(3));
    expect(r.status).toBe(503);
    expect(m.linhas.get(uuid(3))?.status).toBe('pending');
    expect(m.linhas.get(uuid(3))?.attempts).toBe(0);
    expect(m.linhas.get(uuid(3))?.readyMs).toBeNull();
  });

  it('done devolvendo gone (linha marcada durante a reducao): 404 e o reduzido gravado sai', async () => {
    const m = montar();
    m.linhas.set(uuid(4), linha(uuid(4)));
    m.storage.originais.set(uuid(4), ORIG);
    const original = m.rows.reduceDone.bind(m.rows);
    (m.deps.store as unknown as { reduceDone: MemReduceRows['reduceDone'] }).reduceDone = async (id, att, b, w, h, now) => {
      m.linhas.get(id)!.purgeMs = now;
      return original(id, att, b, w, h, now);
    };
    const r = await m.reduzir(uuid(4));
    expect(r.status).toBe(404);
    expect(m.storage.reduzidas.size).toBe(0);
    expect(m.linhas.get(uuid(4))?.status).toBe('pending');
  });

  it('falha so na remocao do original mantem ready (200) e deixa a sobra para a limpeza', async () => {
    const m = montar();
    m.linhas.set(uuid(5), linha(uuid(5)));
    m.storage.originais.set(uuid(5), ORIG);
    m.storage.falhas.add('removeOriginal');
    const r = await m.reduzir(uuid(5));
    expect(r.status).toBe(200);
    expect(m.linhas.get(uuid(5))?.status).toBe('ready');
    expect(m.linhas.get(uuid(5))?.originalRemovedMs).toBeNull();
    expect(m.contadores.instantanea()['limpeza_original_pendente']).toBe(1);
  });
});

describe('H-027 | R-04: recusa definitiva com codigo fixo, original removido e nenhum objeto', () => {
  it('redutor recusa: 422 com o codigo, linha rejected, original removido, nenhum reduzido', async () => {
    const m = montar({ comportamento: async () => ({ ok: false, kind: 'definitive', code: 'imagem_invalida' }) });
    m.linhas.set(uuid(6), linha(uuid(6)));
    m.storage.originais.set(uuid(6), ORIG);
    const r = await m.reduzir(uuid(6));
    expect(r.status).toBe(422);
    expect(corpo(r)).toEqual({ code: 'imagem_invalida' });
    expect(m.linhas.get(uuid(6))).toMatchObject({ status: 'rejected', rejectCode: 'imagem_invalida' });
    expect(m.storage.originais.size).toBe(0);
    expect(m.storage.reduzidas.size).toBe(0);
  });

  it('o mesmo finalize repetido devolve o mesmo codigo sem reprocessar (CA-04)', async () => {
    const m = montar({ comportamento: async () => ({ ok: false, kind: 'definitive', code: 'nao_cabe_no_limite' }) });
    m.linhas.set(uuid(7), linha(uuid(7)));
    m.storage.originais.set(uuid(7), ORIG);
    await m.reduzir(uuid(7));
    const again = await m.reduzir(uuid(7));
    expect(again.status).toBe(422);
    expect(corpo(again)).toEqual({ code: 'nao_cabe_no_limite' });
    expect(m.reducer.chamadas).toBe(1);
  });

  it('original ausente na quarentena vira imagem_invalida (falha que nao se resolve)', async () => {
    const m = montar();
    m.linhas.set(uuid(8), linha(uuid(8)));
    const r = await m.reduzir(uuid(8));
    expect(corpo(r)).toEqual({ code: 'imagem_invalida' satisfies MediaRejectCode } as Record<string, unknown>);
    expect(m.linhas.get(uuid(8))?.status).toBe('rejected');
  });
});

describe('H-027 | R-05: falhas transitorias e teto de tentativas (decisao 86)', () => {
  const casos: Array<{ nome: string; comportamento: Parameters<typeof montar>[0]['comportamento']; conta: number }> = [
    { nome: 'tempo (timeout)', comportamento: async () => ({ ok: false, kind: 'transient', cause: 'timeout' }), conta: 1 },
    { nome: 'memoria', comportamento: async () => ({ ok: false, kind: 'transient', cause: 'memory' }), conta: 1 },
    { nome: 'sharp indisponivel', comportamento: async () => ({ ok: false, kind: 'transient', cause: 'unavailable' }), conta: 0 },
    { nome: 'redutor lanca excecao', comportamento: async () => { throw new Error('sentinela-biblioteca'); }, conta: 0 },
  ];
  for (const c of casos) {
    it(`${c.nome}: 503 com Retry-After 5, nunca rejected; tentativas = ${c.conta}`, async () => {
      const m = montar({ comportamento: c.comportamento });
      m.linhas.set(uuid(10), linha(uuid(10)));
      m.storage.originais.set(uuid(10), ORIG);
      const r = await m.reduzir(uuid(10));
      expect(r.status).toBe(503);
      expect(r.headers['retry-after']).toBe('5');
      expect(corpo(r)).toEqual({ code: 'indisponivel' });
      expect(m.linhas.get(uuid(10))).toMatchObject({ status: 'pending', attempts: c.conta });
    });
  }

  it('falha de Storage na leitura, na gravacao e no sharp nao consomem tentativa', async () => {
    const m = montar();
    m.linhas.set(uuid(11), linha(uuid(11)));
    m.storage.originais.set(uuid(11), ORIG);
    m.storage.falhas.add('read');
    expect((await m.reduzir(uuid(11))).status).toBe(503);
    expect(m.linhas.get(uuid(11))?.attempts).toBe(0);
  });

  it('falha de Storage cinco vezes seguidas nunca rejeita a foto', async () => {
    const m = montar();
    m.linhas.set(uuid(12), linha(uuid(12)));
    m.storage.originais.set(uuid(12), ORIG);
    m.storage.falhas.add('read');
    for (let i = 0; i < 5; i++) expect((await m.reduzir(uuid(12))).status).toBe(503);
    expect(m.linhas.get(uuid(12))).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('tres tempos contados seguidos: a quarta chamada vira 422 nao_processavel e o original sai', async () => {
    const m = montar({ comportamento: async () => ({ ok: false, kind: 'transient', cause: 'timeout' }) });
    m.linhas.set(uuid(13), linha(uuid(13)));
    m.storage.originais.set(uuid(13), ORIG);
    for (let i = 0; i < 3; i++) expect((await m.reduzir(uuid(13))).status).toBe(503);
    expect(m.linhas.get(uuid(13))?.attempts).toBe(3);
    const quarta = await m.reduzir(uuid(13));
    expect(quarta.status).toBe(422);
    expect(corpo(quarta)).toEqual({ code: 'nao_processavel' });
    expect(m.storage.originais.size).toBe(0);
  });
});

describe('H-027 | R-06: finalize repetido e simultaneo nao reencoda duas vezes', () => {
  it('dois finalize simultaneos: um reduz e o outro recebe processando (409), sem segundo objeto', async () => {
    const m = montar({ atrasoMs: 200 });
    m.linhas.set(uuid(20), linha(uuid(20)));
    m.storage.originais.set(uuid(20), ORIG);
    const [a, b] = await Promise.all([m.reduzir(uuid(20)), m.reduzir(uuid(20))]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(m.reducer.chamadas).toBe(1);
    expect(m.storage.reduzidas.size).toBe(1);
    const perdedor = a.status === 409 ? a : b;
    expect(perdedor.headers['retry-after']).toBe('3');
    expect(corpo(perdedor)).toEqual({ code: 'processando' });
  });

  it('finalize depois de ready devolve ready sem reencode', async () => {
    const m = montar();
    m.linhas.set(uuid(21), linha(uuid(21)));
    m.storage.originais.set(uuid(21), ORIG);
    await m.reduzir(uuid(21));
    const again = await m.reduzir(uuid(21));
    expect(again.status).toBe(200);
    expect(m.reducer.chamadas).toBe(1);
  });

  it('ready com original ainda na quarentena: o finalize so tenta a remocao', async () => {
    const m = montar();
    m.linhas.set(uuid(22), linha(uuid(22), { status: 'ready', confirmedMs: T0, readyBytes: 1000, readyWidth: 960, readyHeight: 1280, readyMs: T0 }));
    m.storage.originais.set(uuid(22), ORIG);
    const r = await m.reduzir(uuid(22));
    expect(r.status).toBe(200);
    expect(m.reducer.chamadas).toBe(0);
    expect(m.storage.originais.size).toBe(0);
    expect(m.linhas.get(uuid(22))?.originalRemovedMs).not.toBeNull();
  });
});

describe('H-027 | R-07: no maximo 4 reducoes simultaneas por instancia; espera de 2 s e 503 sem banco', () => {
  it('dez finalize com redutor lento: maximo em voo = 4 e todos concluem (espera ate 2 s)', async () => {
    const m = montar({ atrasoMs: 300 });
    const ids = Array.from({ length: 10 }, (_, i) => uuid(100 + i));
    for (const id of ids) {
      m.linhas.set(id, linha(id));
      m.storage.originais.set(id, ORIG);
    }
    const rs = await Promise.all(ids.map((id) => m.reduzir(id)));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(m.reducer.maximoEmVoo).toBe(4);
  }, 20_000);

  it('quinta chamada sem vaga por 2 s: 503 com Retry-After 2 e sem tocar o banco', async () => {
    const m = montar({ atrasoMs: 2500 });
    const ids = Array.from({ length: 8 }, (_, i) => uuid(200 + i));
    for (const id of ids) {
      m.linhas.set(id, linha(id));
      m.storage.originais.set(id, ORIG);
    }
    const rs = await Promise.all(ids.map((id) => m.reduzir(id)));
    const recusadas = rs.filter((r) => r.status === 503);
    expect(recusadas.length).toBe(4);
    for (const r of recusadas) expect(r.headers['retry-after']).toBe('2');
    expect(m.diario.filter((x) => x === 'reduceBegin').length).toBe(4);
    expect(m.reducer.maximoEmVoo).toBe(4);
  }, 20_000);

  it('orcamento de 128 MP: reserva que nao cabe espera e desiste sem reservar', async () => {
    const gate = new ReduceGate({ budgetPx: 128_000_000, waitMs: 50 });
    const primeira = await gate.reservar(100_000_000);
    expect(primeira).not.toBeNull();
    expect(await gate.reservar(50_000_000)).toBeNull();
    primeira?.liberar();
    expect(await gate.reservar(50_000_000)).not.toBeNull();
    expect(await gate.reservar(200_000_000)).toBeNull();
  });
});

describe('H-027 | R-10: sentinelas (T-11) nao saem em respostas nem em contadores', () => {
  it('nome, IP, caminho, chave e texto de biblioteca nao aparecem em sucesso, recusa ou falha', async () => {
    const SENT = ['rua-das-flores-12', '203.0.113.77', 'sentinela-biblioteca', 'p/', 'd/', 'Input buffer'];
    const cenarios = [
      { comportamento: undefined, pronta: false },
      { comportamento: async () => ({ ok: false, kind: 'definitive', code: 'imagem_invalida' }) as const, pronta: false },
      { comportamento: async () => { throw new Error('sentinela-biblioteca rua-das-flores-12.jpg'); }, pronta: false },
    ];
    const todas: string[] = [];
    for (const c of cenarios) {
      const m = montar({ comportamento: c.comportamento as never });
      const id = uuid(300);
      m.linhas.set(id, linha(id));
      m.storage.originais.set(id, ORIG);
      const r = await m.reduzir(id);
      todas.push(r.body, JSON.stringify(r.headers));
    }
    todas.push(JSON.stringify(montar().contadores.instantanea()));
    for (const texto of todas) for (const s of SENT) expect(texto).not.toContain(s);
  });
});

describe('H-027 | R-11 (estatica): so reduceMedia le o original; sem download ou assinatura; so as rotas da #39', () => {
  const raiz = join(__dirname, '..', '..', '..');
  function arquivos(dir: string): string[] {
    return readdirSync(dir).flatMap((nome) => {
      const caminho = join(dir, nome);
      return statSync(caminho).isDirectory() ? arquivos(caminho) : [caminho];
    });
  }
  it('readOriginal aparece so no servico de reducao, nas portas e no adaptador de Storage', () => {
    const fontes = [...arquivos(join(raiz, 'apps', 'api', 'src')), ...arquivos(join(raiz, 'packages', 'db', 'src')), ...arquivos(join(raiz, 'packages', 'domain', 'src'))].filter((f) => f.endsWith('.ts'));
    const com = fontes.filter((f) => readFileSync(f, 'utf8').includes('readOriginal')).map((f) => f.replace(raiz, '').replace(/\\/g, '/'));
    expect(com.sort()).toEqual([
      '/apps/api/src/media/media-reduce-service.ts',
      '/packages/db/src/media-quarantine.ts',
      '/packages/domain/src/media/ports.ts',
    ]);
  });

  it('nenhum createSignedUrl nem download de objeto na midia da API e do banco', () => {
    for (const f of [
      join(raiz, 'apps', 'api', 'src', 'media', 'media-route.ts'),
      join(raiz, 'apps', 'api', 'src', 'media', 'media-service.ts'),
      join(raiz, 'apps', 'api', 'src', 'media', 'media-reduce-service.ts'),
      join(raiz, 'packages', 'db', 'src', 'media-quarantine.ts'),
    ]) {
      const texto = readFileSync(f, 'utf8');
      expect(texto).not.toMatch(/createSignedUrl|download\(|copy_object/);
    }
  });

  it('a rota de midia so tem as tres rotas da #39 (GET apenas no item)', () => {
    const rota = readFileSync(join(raiz, 'apps', 'api', 'src', 'media', 'media-route.ts'), 'utf8');
    expect(rota).toMatch(/path === MEDIA_PATH && metodo === 'POST'/);
    expect(rota).toMatch(/finaliza && metodo === 'POST'/);
    expect(rota).toMatch(/!finaliza && metodo === 'GET'/);
    expect(rota.match(/metodo === 'GET'/g)?.length ?? 0).toBe(1);
  });
});

describe('H-027 | R-15 (parte falsa): expurgo do rascunho remove a reduzida e a linha', () => {
  it('apos reducao, marcar para expurgo e rodar a varredura apaga o reduzido, o original e a linha', async () => {
    const m = montar();
    const id = uuid(400);
    m.linhas.set(id, linha(id));
    m.storage.originais.set(id, ORIG);
    expect((await m.reduzir(id)).status).toBe(200);
    expect(m.storage.reduzidas.size).toBe(1);
    m.linhas.get(id)!.purgeMs = T0 + 2 * MIN;
    const store = {
      sweep: async () => [...m.linhas.values()].filter((l) => l.purgeMs !== null).map((l) => l.id),
      purgeDone: async (ids: readonly string[]) => {
        for (const x of ids) m.linhas.delete(x);
        return ids.length;
      },
      known: async (ids: readonly string[]) => ids.filter((x) => m.linhas.has(x)),
      originalCleanupList: async () => [],
      originalRemoved: async () => false,
    } as unknown as Pick<MediaStorePort, 'sweep' | 'purgeDone' | 'known'>;
    const rel = await sweepQuarantine({
      store,
      storage: {
        remove: async (key: string) => m.storage.removeOriginal(key.slice(2)),
        listOlderThan: async () => [],
      },
      reduzidos: m.storage,
      nowMs: () => T0 + 3 * MIN,
    });
    expect(rel.removidos).toBe(1);
    expect(m.storage.reduzidas.size).toBe(0);
    expect(m.linhas.has(id)).toBe(false);
  });
});
