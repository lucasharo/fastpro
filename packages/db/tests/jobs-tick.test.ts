// Testes unitarios do tick de jobs (H-008, desenho 24-DESENHO-H008.md §7). Sem banco e sem chamada
// externa: a porta JobStore e um dublê em memoria; o tempo e falso (relogio manual ou fake timers).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  JobRegistry,
  OpportunisticTick,
  PgJobStore,
  TICK_BATCH_SIZE,
  TICK_DELAY_SQL,
  TICK_LEASE_SECONDS,
  TICK_PATH,
  TickService,
  errorCodeOf,
  handleTickRequest,
  isTickAuthorized,
  registerJobHandler,
  retrySecondsFor,
  tickProbeDedupeKey,
  tickProbeHandler,
  type ClaimedJob,
  type JobStore,
  type SqlClient,
} from '../src/jobs-tick.js';

const SECRET = 'x'.repeat(40); // 40 caracteres: acima do minimo de 32
const OWNER_RE = /^tick-[abcd]:[0-9a-f-]{36}$/;

interface FakeStore {
  store: JobStore;
  claims: unknown[][];
  completes: unknown[][];
  fails: unknown[][];
}

/** Dublê da porta: devolve lotes na ordem; complete/fail registram chamadas. */
function fakeStore(
  batches: ClaimedJob[][],
  opts: { completeOk?: boolean; onClaim?: () => void } = {},
): FakeStore {
  const queue = [...batches];
  const out: FakeStore = {
    store: {
      async claim(owner, kind, lease, limit) {
        out.claims.push([owner, kind, lease, limit]);
        opts.onClaim?.();
        return queue.shift() ?? [];
      },
      async complete(id, owner) {
        out.completes.push([id, owner]);
        return opts.completeOk ?? true;
      },
      async fail(id, owner, code, retry) {
        out.fails.push([id, owner, code, retry]);
        return true;
      },
    },
    claims: [],
    completes: [],
    fails: [],
  };
  return out;
}

const job = (id: string, kind = 'test.h008.a', attempts = 1): ClaimedJob => ({
  id,
  kind,
  payload_ref: null,
  attempts,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('retrySecondsFor (recuo do job)', () => {
  it('60 s, 120 s, ... limitado a 3600 s', () => {
    expect([1, 2, 3, 4].map(retrySecondsFor)).toEqual([60, 120, 240, 480]);
    expect(retrySecondsFor(10)).toBe(3600);
    expect(retrySecondsFor(50)).toBe(3600);
  });
});

describe('errorCodeOf (sem mensagem da excecao)', () => {
  it('usa so o nome da classe; nunca a mensagem (PII)', () => {
    class FalhaExterna extends Error {}
    const err = new FalhaExterna('contato: pessoa@exemplo.invalid');
    expect(errorCodeOf(err)).toBe('FalhaExterna');
    expect(errorCodeOf(new Error('pessoa@exemplo.invalid'))).toBe('Error');
    expect(errorCodeOf('texto')).toBe('erro');
    const weird = Object.assign(new Error('x'), { name: 'nome com espaco e @' });
    expect(errorCodeOf(weird)).toBe('Error'); // usa a classe, nunca o name configurado
  });
});

describe('JobRegistry', () => {
  it('registra um handler por kind e recusa duplicado e kind invalido', () => {
    const registry = new JobRegistry();
    registerJobHandler(registry, 'test.h008.a', tickProbeHandler);
    expect(registry.get('test.h008.a')).toBe(tickProbeHandler);
    expect(() => registerJobHandler(registry, 'test.h008.a', tickProbeHandler)).toThrow(
      /duplicado/,
    );
    expect(() => registry.register('Kind Ruim', tickProbeHandler)).toThrow(TypeError);
    expect(registry.get('nao.existe')).toBeUndefined();
  });
});

describe('TickService.run (T-H8-08 a T-H8-14, sem banco)', () => {
  it('executa o handler uma vez, conclui e conta; passa lote 5 e lease 60 s', async () => {
    const registry = new JobRegistry();
    const seen: string[] = [];
    registerJobHandler(registry, 'test.h008.a', {
      async run(j) {
        seen.push(j.id);
      },
    });
    const f = fakeStore([[job('j1'), job('j2')]]);
    const report = await new TickService({ store: f.store, registry }).run('a');
    expect(seen).toEqual(['j1', 'j2']);
    expect(f.completes.map((c) => c[0])).toEqual(['j1', 'j2']);
    expect(report).toMatchObject({
      origem: 'a',
      reivindicados: 2,
      concluidos: 2,
      falhos: 0,
      lease_perdido: 0,
    });
    expect(f.claims[0]?.[1]).toBe(null); // sem filtro: o HTTP nunca passa kind
    expect(f.claims[0]?.[2]).toBe(TICK_LEASE_SECONDS);
    expect(f.claims[0]?.[3]).toBe(TICK_BATCH_SIZE);
    expect(String(f.claims[0]?.[0])).toMatch(OWNER_RE);
  });

  it('kind sem handler vira falha com codigo kind_desconhecido', async () => {
    const f = fakeStore([[job('j9', 'test.h008.sem_handler', 2)]]);
    const report = await new TickService({ store: f.store, registry: new JobRegistry() }).run('a');
    expect(f.fails[0]?.slice(2)).toEqual(['kind_desconhecido', 120]);
    expect(report.falhos).toBe(1);
  });

  it('excecao do handler registra so o codigo; a mensagem com dado pessoal nao vaza', async () => {
    const registry = new JobRegistry();
    class FalhaDeEnvio extends Error {}
    registerJobHandler(registry, 'test.h008.a', {
      async run() {
        throw new FalhaDeEnvio('enviar para pessoa@exemplo.invalid');
      },
    });
    const f = fakeStore([[job('j1')]]);
    await new TickService({ store: f.store, registry }).run('a');
    expect(f.fails[0]?.[2]).toBe('FalhaDeEnvio');
    expect(JSON.stringify(f.fails)).not.toContain('exemplo.invalid');
  });

  it('handler mais lento que 30 s (relogio falso) conta como timeout e libera o job', async () => {
    vi.useFakeTimers();
    const registry = new JobRegistry();
    registerJobHandler(registry, 'test.h008.a', { run: () => new Promise<void>(() => {}) });
    const f = fakeStore([[job('j1')]]);
    const pending = new TickService({ store: f.store, registry }).run('a');
    await vi.advanceTimersByTimeAsync(29_999);
    expect(f.fails).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    const report = await pending;
    expect(f.fails[0]?.[2]).toBe('timeout');
    expect(report.falhos).toBe(1);
    expect(report.concluidos).toBe(0);
  });

  it('complete devolvido false (lease perdido) e contado sem erro', async () => {
    const registry = new JobRegistry();
    registerJobHandler(registry, 'test.h008.a', tickProbeHandler);
    const f = fakeStore([[job('j1')]], { completeOk: false });
    const report = await new TickService({ store: f.store, registry }).run('a');
    expect(report.lease_perdido).toBe(1);
    expect(report.concluidos).toBe(0);
  });

  it('filtro de kind existe so no construtor e chega ao claim', async () => {
    const f = fakeStore([]);
    await new TickService({
      store: f.store,
      registry: new JobRegistry(),
      kindFilter: 'test.h008.x',
    }).run('c');
    expect(f.claims[0]?.[1]).toBe('test.h008.x');
    expect(String(f.claims[0]?.[0])).toMatch(/^tick-c:/);
  });

  it('orcamento de inicio de 20 s: nao reivindica novo lote depois do orcamento', async () => {
    let t = 0;
    const f = fakeStore([[job('a1')], [job('a2')], [job('a3')]], { onClaim: () => (t += 10_000) });
    const registry = new JobRegistry();
    registerJobHandler(registry, 'test.h008.a', tickProbeHandler);
    const svc = new TickService({ store: f.store, registry, now: () => t });
    const report = await svc.run('a');
    expect(f.claims.length).toBe(2);
    expect(report.reivindicados).toBe(2);
  });

  it('o construtor aceita instancia fixa e o owner embute a origem', async () => {
    const f = fakeStore([]);
    await new TickService({
      store: f.store,
      registry: new JobRegistry(),
      instanceId: '11111111-2222-3333-4444-555555555555',
    }).run('d');
    expect(f.claims[0]?.[0]).toBe('tick-d:11111111-2222-3333-4444-555555555555');
  });
});

describe('OpportunisticTick (T-H8-15)', () => {
  function setup() {
    let now = 1_000_000;
    const f = fakeStore([]);
    const registry = new JobRegistry();
    const tick = new TickService({ store: f.store, registry, now: () => now });
    const oc = new OpportunisticTick({ tick, now: () => now });
    return { f, oc, advance: (ms: number) => (now += ms) };
  }

  it('dispara na 1a requisicao; 2a e 3a dentro de 60 s nao; depois de 60 s dispara de novo', async () => {
    const { f, oc, advance } = setup();
    expect(await oc.maybeRun('/v1/algo')).toBe('executado');
    advance(30_000);
    expect(await oc.maybeRun('/v1/algo')).toBe('pulado');
    advance(20_000);
    expect(await oc.maybeRun('/v1/algo')).toBe('pulado');
    advance(10_000);
    expect(await oc.maybeRun('/v1/algo')).toBe('executado');
    expect(f.claims.length).toBe(2);
  });

  it('/health e /internal/* nao disparam', async () => {
    const { f, oc } = setup();
    expect(await oc.maybeRun('/health')).toBe('pulado');
    expect(await oc.maybeRun('/internal/jobs/tick')).toBe('pulado');
    expect(f.claims.length).toBe(0);
  });

  it('tick em andamento bloqueia outro na mesma instancia', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const registry = new JobRegistry();
    const store: JobStore = {
      async claim() {
        await gate;
        return [];
      },
      async complete() {
        return true;
      },
      async fail() {
        return true;
      },
    };
    const oc = new OpportunisticTick({ tick: new TickService({ store, registry }) });
    const first = oc.maybeRun('/v1/x');
    expect(await oc.maybeRun('/v1/x')).toBe('pulado');
    release();
    expect(await first).toBe('executado');
  });

  it('excecao do banco nao vaza; recuo: 60 s apos 1 falha e 120 s apos 2', async () => {
    let now = 0;
    const store: JobStore = {
      async claim() {
        throw new Error('conexao recusada: host 10.0.0.1');
      },
      async complete() {
        return true;
      },
      async fail() {
        return true;
      },
    };
    const oc = new OpportunisticTick({
      tick: new TickService({ store, registry: new JobRegistry(), now: () => now }),
      now: () => now,
    });
    expect(await oc.maybeRun('/v1/x')).toBe('falhou');
    now += 59_000;
    expect(await oc.maybeRun('/v1/x')).toBe('pulado');
    now += 1_000;
    expect(await oc.maybeRun('/v1/x')).toBe('falhou');
    now += 90_000;
    expect(await oc.maybeRun('/v1/x')).toBe('pulado');
    now += 30_000;
    expect(await oc.maybeRun('/v1/x')).toBe('falhou');
  });
});

describe('autenticacao e endpoint (T-H8-18, T-H8-19, T-H8-20, T-H8-21)', () => {
  function deps(store?: JobStore, secret: string | undefined = SECRET) {
    const registry = new JobRegistry();
    registerJobHandler(registry, 'tick.probe', tickProbeHandler);
    const s = store ?? fakeStore([]).store;
    return { tick: new TickService({ store: s, registry }), secret };
  }
  const ok = { method: 'POST', path: TICK_PATH, bodyBytes: 0 };

  it('autorizacao: so o cabecalho Bearer com o segredo exato', () => {
    expect(isTickAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isTickAuthorized(undefined, SECRET)).toBe(false);
    expect(isTickAuthorized(`Bearer ${'y'.repeat(40)}`, SECRET)).toBe(false);
    expect(isTickAuthorized(`Bearer ${SECRET}0`, SECRET)).toBe(false);
    expect(isTickAuthorized(SECRET, SECRET)).toBe(false); // sem o esquema Bearer
    expect(isTickAuthorized(`Bearer `, SECRET)).toBe(false);
  });

  it('segredo ausente, vazio ou com menos de 32 caracteres: nega tudo', () => {
    expect(isTickAuthorized(`Bearer ${'a'.repeat(20)}`, 'a'.repeat(20))).toBe(false);
    expect(isTickAuthorized('Bearer ', '')).toBe(false);
    expect(isTickAuthorized(`Bearer ${SECRET}`, undefined)).toBe(false);
  });

  it('negativas sao identicas (401 sem corpo); correto responde 200; so POST', async () => {
    const denied = [
      { authorization: undefined },
      { authorization: `Bearer ${'z'.repeat(40)}` },
      { authorization: `Bearer ${SECRET}Z` },
      { authorization: `Bearer ${'a'.repeat(20)}` },
    ];
    const results = await Promise.all(
      denied.map((d) =>
        handleTickRequest(
          { ...ok, ...d },
          deps(undefined, d.authorization ? 'a'.repeat(20) : SECRET),
        ),
      ),
    );
    for (const r of results) {
      expect(r.status).toBe(401);
      expect(r.body).toBe('');
    }
    const short = await handleTickRequest(
      { ...ok, authorization: `Bearer ${'a'.repeat(20)}` },
      deps(undefined, 'a'.repeat(20)),
    );
    expect(short.status).toBe(401);

    const sec = await handleTickRequest({ ...ok, authorization: `Bearer ${SECRET}` }, deps());
    expect(sec.status).toBe(200);
    expect(
      (await handleTickRequest({ ...ok, method: 'GET', authorization: `Bearer ${SECRET}` }, deps()))
        .status,
    ).toBe(404);
    expect(
      (await handleTickRequest({ ...ok, method: 'PUT', authorization: `Bearer ${SECRET}` }, deps()))
        .status,
    ).toBe(404);
    expect(
      (
        await handleTickRequest(
          { ...ok, path: '/internal/jobs/tick/x', authorization: `Bearer ${SECRET}` },
          deps(),
        )
      ).status,
    ).toBe(404);
  });

  it('corpo e ignorado ate 1 KB; acima disso 413 (depois da autenticacao)', async () => {
    const auth = `Bearer ${SECRET}`;
    expect(
      (await handleTickRequest({ ...ok, bodyBytes: 900, authorization: auth }, deps())).status,
    ).toBe(200);
    expect(
      (await handleTickRequest({ ...ok, bodyBytes: 2000, authorization: auth }, deps())).status,
    ).toBe(413);
    expect((await handleTickRequest({ ...ok, bodyBytes: 2000 }, deps())).status).toBe(401);
  });

  it('resposta so com contadores numericos e sem PII, lista de jobs ou segredo', async () => {
    const r = await handleTickRequest({ ...ok, authorization: `Bearer ${SECRET}` }, deps());
    expect(Object.keys(JSON.parse(r.body)).sort()).toEqual(
      ['concluidos', 'falhos', 'lease_perdido', 'ms', 'ok', 'reivindicados'].sort(),
    );
    expect(r.body).not.toContain(SECRET);
    expect(r.headers['Cache-Control']).toBe('no-store');
  });

  it('banco indisponivel responde 503 {ok:false} sem excecao', async () => {
    const store: JobStore = {
      async claim() {
        throw new Error('timeout de conexao');
      },
      async complete() {
        return true;
      },
      async fail() {
        return true;
      },
    };
    const r = await handleTickRequest({ ...ok, authorization: `Bearer ${SECRET}` }, deps(store));
    expect(r).toMatchObject({ status: 503, body: '{"ok":false}' });
  });

  it('T-H8-21: chamada externa com o mesmo segredo produz o mesmo efeito do pg_net (origem a)', async () => {
    const f = fakeStore([[job('j1', 'tick.probe')]]);
    const r = await handleTickRequest({ ...ok, authorization: `Bearer ${SECRET}` }, deps(f.store));
    expect(JSON.parse(r.body).concluidos).toBe(1);
    expect(String(f.claims[0]?.[0])).toMatch(/^tick-a:/);
  });
});

describe('medicao de atraso com relogio falso (T-H8-22, Q-09)', () => {
  it('atraso = claim - run_at <= intervalo da requisicao + 60 s, sem perda', async () => {
    for (const intervalS of [30, 120, 600]) {
      const intervalMs = intervalS * 1000;
      let now = 0;
      const pending = new Map<string, number>(); // id -> run_at
      const delays: number[] = [];
      const store: JobStore = {
        async claim(owner, kind, lease, limit) {
          const due = [...pending].filter(([, runAt]) => runAt <= now).slice(0, limit);
          for (const [id, runAt] of due) {
            pending.delete(id);
            delays.push(now - runAt);
          }
          return due.map(([id]) => ({
            id,
            kind: 'test.h008.medicao',
            payload_ref: null,
            attempts: 1,
          }));
        },
        async complete() {
          return true;
        },
        async fail() {
          return true;
        },
      };
      const registry = new JobRegistry();
      registerJobHandler(registry, 'test.h008.medicao', tickProbeHandler);
      const oc = new OpportunisticTick({
        tick: new TickService({ store, registry, now: () => now }),
        now: () => now,
      });
      // Jobs com run_at em varios pontos entre duas requisicoes.
      for (let k = 0; k < 10; k++)
        pending.set(`j${k}`, k * intervalMs + Math.floor(intervalMs / 3));
      const horizon = 12 * intervalMs;
      for (let t = 0; t <= horizon; t += intervalMs) {
        now = t;
        await oc.maybeRun('/v1/atividade');
      }
      expect(pending.size).toBe(0); // nada perdido
      expect(delays.length).toBe(10);
      for (const d of delays) expect(d).toBeLessThanOrEqual(intervalMs + 60_000);
    }
  });
});

describe('tick.probe e SQL de atraso (T-H8-23)', () => {
  it('handler sem efeito e chave de minuto', async () => {
    await expect(
      tickProbeHandler.run({ id: 'x', kind: 'tick.probe', payload_ref: null, attempts: 1 }),
    ).resolves.toBeUndefined();
    expect(tickProbeDedupeKey(new Date('2026-11-10T12:34:56.789Z'))).toBe(
      'tick.probe:2026-11-10T12:34',
    );
  });

  it('SQL de atraso usa so ops.job e percentil', () => {
    expect(TICK_DELAY_SQL).toMatch(/percentile_cont\(0\.95\)/);
    expect(TICK_DELAY_SQL).toMatch(/from ops\.job/);
  });
});

describe('PgJobStore (adaptador SQL)', () => {
  it('reivindicacao gerenciada: transacao curta com lock_timeout 3 s e statement_timeout 10 s', async () => {
    const calls: string[] = [];
    const client: SqlClient = {
      async query(text: string) {
        calls.push(text.split('\n')[0] ?? '');
        if (text.includes('job_claim')) {
          return { rows: [{ id: 'abc', kind: 'k', payload_ref: null, attempts: '2' }] };
        }
        return { rows: [] };
      },
    };
    const claimed = await new PgJobStore(client).claim('o', null, 60, 5);
    expect(claimed).toEqual([{ id: 'abc', kind: 'k', payload_ref: null, attempts: 2 }]);
    expect(calls).toEqual([
      'begin',
      "set local lock_timeout = '3s'",
      "set local statement_timeout = '10s'",
      'select * from private.job_claim($1, $2, $3, $4)',
      'commit',
    ]);
  });

  it('erro na reivindicacao faz rollback e propaga', async () => {
    const calls: string[] = [];
    const client: SqlClient = {
      async query(text: string) {
        calls.push(text);
        if (text.includes('job_claim')) throw new Error('falha');
        return { rows: [] };
      },
    };
    await expect(new PgJobStore(client).claim('o', null, 60, 5)).rejects.toThrow('falha');
    expect(calls.at(-1)).toBe('rollback');
  });

  it('complete e fail devolvem booleano pela funcao SQL', async () => {
    const client: SqlClient = {
      async query(text: string) {
        return { rows: [{ ok: text.includes('job_complete') }] };
      },
    };
    const store = new PgJobStore(client, false);
    expect(await store.complete('id', 'o')).toBe(true);
    expect(await store.fail('id', 'o', 'Erro', 60)).toBe(false);
  });
});

describe('estatico: apps/api nao referencia cron, net nem vault (T-H8-05)', () => {
  it('nenhum arquivo do app referencia os esquemas do tick; o exemplo de ambiente so tem o nome', () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|mjs|js)$/.test(name)) files.push(p);
      }
    };
    walk(join(root, 'apps', 'api', 'src'));
    const offenders = files.filter(
      (p) =>
        !p.includes(`${join('node_modules')}`) &&
        /\b(cron|net|vault)\.[a-z_]/.test(readFileSync(p, 'utf8')),
    );
    expect(offenders).toEqual([]);
    const example = readFileSync(join(root, '.env.example'), 'utf8');
    expect(example).toMatch(/^JOBS_TICK_SECRET=/m);
  });
});
