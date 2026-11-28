// H-109 (Issue 118) | Expurgo em lotes com tres fases (docs/factory/82-DESENHO-H109.md §2 e §7; 79 CA-H109-01, 06, 07, 09).
// Portas em memoria: o banco de verdade e testado no teste de banco (sem banco nesta etapa).
import { describe, expect, it } from 'vitest';
import {
  runRetentionPurge,
  type ObjetoFila,
  type PoliticaExpurgo,
  type ResultadoLote,
  type RetentionObjectsPort,
  type RetentionStoragePort,
  type RetentionStorePort,
} from '../src/retention/index.js';
import type { RetentionClass, RetentionObjectRef } from '../src/retention/index.js';

const AGORA = Date.UTC(2099, 0, 1);

interface Sujeito {
  readonly id: string;
  readonly estado: 'ativo' | 'expurgando' | 'expurgado' | 'suspenso' | null;
  readonly hold: boolean;
}

/** Banco em memoria com as mesmas regras de fase do desenho: marca, fila, reconferencia de hold. */
class BancoFalso implements RetentionStorePort {
  readonly eventos: Array<{ tipo: string; detalhe: Record<string, number | string | boolean> }> = [];
  readonly fila: Array<ObjetoFila & { politica: string; sujeito: string; estado: 'pendente' | 'removido'; tentativas: number }> = [];
  readonly sujeitos = new Map<string, Sujeito>();
  readonly politicas: PoliticaExpurgo[];
  falhaFinalizacao = false;
  seq = 0;

  constructor(politicas: PoliticaExpurgo[], sujeitos: Sujeito[]) {
    this.politicas = politicas;
    for (const s of sujeitos) this.sujeitos.set(s.id, s);
  }

  async listarPoliticas(): Promise<readonly PoliticaExpurgo[]> {
    return this.politicas;
  }

  async simular(politicaId: string): Promise<{ elegiveis: number; retidos: number }> {
    const elegiveis = [...this.sujeitos.values()].filter((s) => s.estado === null && !s.hold).length;
    const retidos = [...this.sujeitos.values()].filter((s) => s.estado === null && s.hold).length;
    this.eventos.push({ tipo: 'simulacao', detalhe: { politicaId, elegiveis, retidos, dry_run: true } });
    return { elegiveis, retidos };
  }

  async marcarLote(_politica: string, limite: number): Promise<readonly string[]> {
    const ids: string[] = [];
    for (const s of this.sujeitos.values()) {
      if (ids.length >= limite) break;
      if ((s.estado === null || s.estado === 'expurgando') && !s.hold) {
        this.sujeitos.set(s.id, { ...s, estado: 'expurgando' });
        ids.push(s.id);
      }
    }
    return ids;
  }

  async enfileirarObjeto(politica: string, sujeito: string, objeto: RetentionObjectRef): Promise<void> {
    const existe = this.fila.some((f) => f.objeto.bucket === objeto.bucket && f.objeto.path === objeto.path);
    if (!existe) {
      this.fila.push({
        id: `f${++this.seq}`,
        objeto,
        politica,
        sujeito,
        estado: 'pendente',
        tentativas: 0,
      });
    }
  }

  async objetosPendentes(_politica: string, sujeitos: readonly string[], limite: number): Promise<readonly ObjetoFila[]> {
    return this.fila
      .filter((f) => f.estado === 'pendente' && sujeitos.includes(f.sujeito))
      .slice(0, limite)
      .map((f) => ({ id: f.id, objeto: f.objeto }));
  }

  async registrarRemocao(filaId: string, ok: boolean): Promise<void> {
    const f = this.fila.find((x) => x.id === filaId);
    if (!f) return;
    if (ok) f.estado = 'removido';
    else f.tentativas++;
  }

  async finalizarLote(
    politica: string,
    sujeitos: readonly string[],
    _nowMs: number,
    numeroLote: number,
  ): Promise<ResultadoLote> {
    if (this.falhaFinalizacao) throw new Error('falha injetada');
    let processados = 0;
    let suspensos = 0;
    let falhos = 0;
    for (const id of sujeitos) {
      const s = this.sujeitos.get(id);
      if (!s || s.estado !== 'expurgando') continue;
      if (this.fila.some((f) => f.sujeito === id && f.estado !== 'removido')) {
        falhos++;
        continue;
      }
      if (s.hold) {
        this.sujeitos.set(id, { ...s, estado: null });
        suspensos++;
        continue;
      }
      this.sujeitos.set(id, { ...s, estado: 'expurgado' });
      processados++;
    }
    // Evento do lote: gravado junto da fase C (mesma transacao no banco real).
    this.eventos.push({
      tipo: 'lote',
      detalhe: { politica, processados, suspensos, falhos, batch_no: numeroLote, dry_run: false },
    });
    return { processados, suspensos, falhos };
  }
}

class ObjetosFalsos implements RetentionObjectsPort {
  constructor(private readonly mapa: Record<string, RetentionObjectRef[]> = {}) {}
  async objetosDe(_classe: RetentionClass, sujeitos: readonly string[]) {
    return sujeitos.flatMap((sujeitoId) => (this.mapa[sujeitoId] ?? []).map((objeto) => ({ sujeitoId, objeto })));
  }
}

class StorageFalso implements RetentionStoragePort {
  readonly removidos: string[] = [];
  readonly ausentes = new Set<string>();
  falhar = new Set<string>();
  async remover(objeto: RetentionObjectRef): Promise<void> {
    const chave = `${objeto.bucket}/${objeto.path}`;
    if (this.falhar.has(chave)) throw new Error('rede');
    if (this.ausentes.has(chave)) return; // ja ausente: sucesso
    this.removidos.push(chave);
  }
}

const POL_RC01: PoliticaExpurgo = {
  id: 'p1',
  dataClass: 'RC-01',
  enabled: true,
  dryRun: false,
  action: 'anonimizar',
  periodoPresente: true,
};

const ADAPTADORES = new Set<RetentionClass>(['RC-01', 'RC-02']);

function opcoes(store: BancoFalso, extra: Partial<Parameters<typeof runRetentionPurge>[0]> = {}) {
  return {
    store,
    objetos: new ObjetosFalsos(),
    storage: new StorageFalso(),
    adaptadores: ADAPTADORES,
    now: () => AGORA,
    ...extra,
  };
}

describe('runRetentionPurge (CA-H109-01)', () => {
  it('sem politica habilitada nao altera linha nem remove objeto', async () => {
    const sujeitos: Sujeito[] = [{ id: 'a', estado: null, hold: false }];
    const politicas: PoliticaExpurgo[] = [
      { ...POL_RC01, enabled: false, periodoPresente: false, action: null },
      { ...POL_RC01, id: 'p2', dataClass: 'RC-02', enabled: true, periodoPresente: false },
    ];
    const store = new BancoFalso(politicas, sujeitos);
    const storage = new StorageFalso();
    const rel = await runRetentionPurge(opcoes(store, { storage }));
    expect(rel.ignoradas).toBe(2);
    expect(rel.lotes).toBe(0);
    expect(store.sujeitos.get('a')?.estado).toBeNull();
    expect(storage.removidos).toEqual([]);
    expect(store.eventos).toEqual([]);
  });

  it('classe sem adaptador recebe sem_alvo e nada e feito', async () => {
    const store = new BancoFalso([{ ...POL_RC01, id: 'p3', dataClass: 'RC-03' }], [{ id: 'a', estado: null, hold: false }]);
    const rel = await runRetentionPurge(opcoes(store));
    expect(rel.semAlvo).toBe(1);
    expect(store.eventos).toEqual([]);
  });

  it('dry run apenas simula e grava o evento com dry_run', async () => {
    const store = new BancoFalso(
      [{ ...POL_RC01, dryRun: true }],
      [
        { id: 'a', estado: null, hold: false },
        { id: 'b', estado: null, hold: true },
      ],
    );
    const rel = await runRetentionPurge(opcoes(store));
    expect(rel.simulacoes).toBe(1);
    expect(store.eventos).toEqual([
      { tipo: 'simulacao', detalhe: { politicaId: 'p1', elegiveis: 1, retidos: 1, dry_run: true } },
    ]);
    expect(store.sujeitos.get('a')?.estado).toBeNull();
  });
});

describe('runRetentionPurge: hold, fila e idempotencia (CA-H109-06, 07, 09)', () => {
  it('expurga o elegivel, suspende o que tem hold e conta em suspensos', async () => {
    const store = new BancoFalso(
      [POL_RC01],
      [
        { id: 'a', estado: null, hold: false },
        { id: 'b', estado: null, hold: true },
      ],
    );
    const rel = await runRetentionPurge(opcoes(store));
    expect(rel.processados).toBe(1);
    expect(rel.suspensos).toBe(0); // hold ja e visto na fase A: nao entra no lote
    expect(store.sujeitos.get('a')?.estado).toBe('expurgado');
    expect(store.sujeitos.get('b')?.estado).toBeNull();
    expect(store.eventos.filter((e) => e.tipo === 'lote')).toHaveLength(1);
  });

  it('hold posto entre as fases A e C reverte a marca e conta como suspenso', async () => {
    const sujeitos = [{ id: 'a', estado: null, hold: false } as Sujeito];
    const store = new BancoFalso([POL_RC01], sujeitos);
    const marcar = store.marcarLote.bind(store);
    store.marcarLote = async (p, l, n) => {
      const ids = await marcar(p, l, n);
      store.sujeitos.set('a', { ...store.sujeitos.get('a')!, hold: true });
      return ids;
    };
    const rel = await runRetentionPurge(opcoes(store));
    expect(rel.suspensos).toBe(1);
    expect(rel.processados).toBe(0);
    expect(store.sujeitos.get('a')?.estado).toBeNull();
    expect(store.eventos.find((e) => e.tipo === 'lote')?.detalhe).toMatchObject({ suspensos: 1, processados: 0 });
  });

  it('falha de Storage deixa o objeto pendente e a linha expurgando; a reexecucao conclui sem duplicar', async () => {
    const store = new BancoFalso([POL_RC01], [{ id: 'a', estado: null, hold: false }]);
    const storage = new StorageFalso();
    storage.falhar.add('identity-docs/x/doc.bin');
    const objetos = new ObjetosFalsos({ a: [{ bucket: 'identity-docs', path: 'x/doc.bin' }] });

    const primeira = await runRetentionPurge(opcoes(store, { storage, objetos }));
    expect(primeira.falhasStorage).toBe(1);
    expect(primeira.falhos).toBe(1);
    expect(store.sujeitos.get('a')?.estado).toBe('expurgando');
    expect(store.fila[0]?.estado).toBe('pendente');

    storage.falhar.clear();
    const segunda = await runRetentionPurge(opcoes(store, { storage, objetos }));
    expect(segunda.falhasStorage).toBe(0);
    expect(store.sujeitos.get('a')?.estado).toBe('expurgado');
    expect(storage.removidos).toEqual(['identity-docs/x/doc.bin']);
    expect(store.fila.filter((f) => f.estado === 'removido')).toHaveLength(1);
    // Um evento por lote com ids: a primeira execucao (falha de Storage) e a segunda (conclusao).
    expect(store.eventos.filter((e) => e.tipo === 'lote')).toHaveLength(2);

    const terceira = await runRetentionPurge(opcoes(store, { storage, objetos }));
    expect(terceira.processados).toBe(0);
    expect(storage.removidos).toHaveLength(1);
  });

  it('objeto ja ausente no Storage conta como sucesso', async () => {
    const store = new BancoFalso([POL_RC01], [{ id: 'a', estado: null, hold: false }]);
    const storage = new StorageFalso();
    storage.ausentes.add('identity-docs/y.bin');
    const objetos = new ObjetosFalsos({ a: [{ bucket: 'identity-docs', path: 'y.bin' }] });
    const rel = await runRetentionPurge(opcoes(store, { storage, objetos }));
    expect(rel.falhasStorage).toBe(0);
    expect(rel.processados).toBe(1);
  });

  it('falha na fase C nao deixa evento parcial: o estado segue expurgando para a proxima execucao', async () => {
    const store = new BancoFalso([POL_RC01], [{ id: 'a', estado: null, hold: false }]);
    store.falhaFinalizacao = true;
    await expect(runRetentionPurge(opcoes(store))).rejects.toThrow('falha injetada');
    expect(store.eventos).toEqual([]);
    store.falhaFinalizacao = false;
    const rel = await runRetentionPurge(opcoes(store));
    expect(rel.processados).toBe(1);
    expect(store.eventos.filter((e) => e.tipo === 'lote')).toHaveLength(1);
  });

  it('respeita o teto de lotes por execucao e o orcamento de tempo', async () => {
    const sujeitos = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, estado: null, hold: false }) as Sujeito);
    const store = new BancoFalso([POL_RC01], sujeitos);
    const rel = await runRetentionPurge(opcoes(store, { limiteLote: 2, maxLotes: 2 }));
    expect(rel.lotes).toBe(2);
    expect(rel.processados).toBe(4);

    const store2 = new BancoFalso([POL_RC01], sujeitos);
    let t = AGORA;
    const rel2 = await runRetentionPurge({
      ...opcoes(store2, { limiteLote: 2 }),
      now: () => {
        t += 10;
        return t;
      },
      orcamentoMs: 1,
    });
    expect(rel2.interrompido).toBe(true);
    expect(rel2.lotes).toBe(0);
  });
});
