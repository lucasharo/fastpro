// H-109 (Issue 118) | Adaptadores de retencao com cliente falso e Storage falso (docs/factory/82-DESENHO-H109.md §2,
// §4, §7; CA-H109-01, 07, 09). Sem banco e sem rede: o SQL real so roda no teste de banco (etapa de banco).
// Contrato generico: classes sem adaptador (RC-03 a RC-07 e RC-10) nunca chamam o banco de expurgo.
import { describe, expect, it } from 'vitest';
import { JobRegistry } from '../src/jobs-tick.js';
import { PgRetentionAdmin, PgRetentionStore } from '../src/retention-store.js';
import {
  ObjetosRetencaoSql,
  RETENTION_CLASSES_COM_ADAPTADOR,
  RETENTION_PURGE_KIND,
  RetentionPurgeHandler,
  RetentionStorageError,
  SupabaseStorageRetencao,
  registerRetentionHandlers,
  retentionPurgeDedupeKey,
} from '../src/retention-jobs.js';
import { RetentionAdminError } from '@fastpro/domain';

const AGORA = Date.UTC(2099, 0, 1, 3);
/** Chave ficticia montada em partes: nunca um literal de credencial no codigo. */
const CHAVE_DE_TESTE = ['ficticia', 'teste', '01'].join('-');

/** Fetch falso: registra metodo e URL e responde com o status dado (sem rede). */
function fetchFalso(status: number, registro: string[]) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    registro.push(`${init?.method} ${String(url)}`);
    return new Response(null, { status });
  }) as typeof fetch;
}

/** Cliente falso: registra cada SQL e responde pela primeira regra cujo trecho casa. */
class ClienteFalso {
  readonly chamadas: Array<{ sql: string; params: unknown[] }> = [];
  constructor(private readonly regras: Array<[string, (params: unknown[]) => unknown[] | Error]> = []) {}
  async query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
    this.chamadas.push({ sql, params });
    for (const [trecho, resposta] of this.regras) {
      if (sql.includes(trecho)) {
        const r = resposta(params);
        if (r instanceof Error) throw r;
        return { rows: r };
      }
    }
    return { rows: [] };
  }
}

describe('PgRetentionStore (cliente falso)', () => {
  it('lista politicas com forma do dominio e so le app.retention_policy', async () => {
    const cliente = new ClienteFalso([
      [
        'from app.retention_policy',
        () => [
          { id: 'p1', data_class: 'RC-01', enabled: false, dry_run: true, action: null, periodo: false },
          { id: 'p2', data_class: 'RC-02', enabled: true, dry_run: false, action: 'anonimizar', periodo: true },
        ],
      ],
    ]);
    const politicas = await new PgRetentionStore(cliente).listarPoliticas();
    expect(politicas).toEqual([
      { id: 'p1', dataClass: 'RC-01', enabled: false, dryRun: true, action: null, periodoPresente: false },
      { id: 'p2', dataClass: 'RC-02', enabled: true, dryRun: false, action: 'anonimizar', periodoPresente: true },
    ]);
    expect(cliente.chamadas).toHaveLength(1);
    expect(cliente.chamadas[0]?.sql).not.toMatch(/delete|update|insert/i);
  });

  it('fase A chama a funcao com parametros posicionais e devolve os ids marcados', async () => {
    const cliente = new ClienteFalso([['retention_mark_batch', () => [{ ids: ['u1', 'u2'] }]]]);
    const ids = await new PgRetentionStore(cliente).marcarLote('p1', 100, AGORA);
    expect(ids).toEqual(['u1', 'u2']);
    expect(cliente.chamadas[0]?.params).toEqual(['p1', 100, new Date(AGORA).toISOString()]);
  });

  it('fase C devolve os contadores do lote e o instante vai como parametro', async () => {
    const cliente = new ClienteFalso([
      ['retention_finalize_batch', () => [{ r: { processed: 2, held: 1, failed: 0 } }]],
    ]);
    const res = await new PgRetentionStore(cliente).finalizarLote('p1', ['u1'], AGORA, 3);
    expect(res).toEqual({ processados: 2, suspensos: 1, falhos: 0 });
    expect(cliente.chamadas[0]?.params).toEqual(['p1', ['u1'], new Date(AGORA).toISOString(), 3]);
  });

  it('simulacao devolve elegiveis e retidos', async () => {
    const cliente = new ClienteFalso([['retention_dry_run', () => [{ r: { eligible: 4, held: 1 } }]]]);
    expect(await new PgRetentionStore(cliente).simular('p1', AGORA)).toEqual({ elegiveis: 4, retidos: 1 });
  });
});

describe('PgRetentionAdmin (cliente falso): erros viram codigo fixo', () => {
  it('mensagem conhecida do banco vira o codigo; mensagem desconhecida vira retencao_indisponivel', async () => {
    const cliente = new ClienteFalso([
      ['retention_policy_propose', () => new Error('habilitacao_incompleta')],
      ['legal_hold_place', () => new Error('detalhe-interno-nao-exposto')],
    ]);
    const admin = new PgRetentionAdmin(cliente);
    const motivo = await admin
      .proporPolitica('u1', { dataClass: 'RC-01', periodSeconds: null, action: null, legalBasisRef: null, effectiveFrom: null, enabled: true, dryRun: true }, 'p1', 'c1', AGORA)
      .catch((e: unknown) => e);
    expect(motivo).toBeInstanceOf(RetentionAdminError);
    expect((motivo as RetentionAdminError).code).toBe('habilitacao_incompleta');

    const generico = await admin
      .colocarHold('u1', { subjectType: 'user', subjectId: '11111111-2222-4333-8444-555555555555', reasonCode: 'litigio' }, AGORA)
      .catch((e: unknown) => e);
    expect((generico as RetentionAdminError).code).toBe('retencao_indisponivel');
    expect((generico as Error).message).not.toContain('detalhe-interno');
  });

  it('periodo vai como segundos (make_interval) e nenhum prazo literal aparece no SQL', async () => {
    const cliente = new ClienteFalso([['retention_policy_propose', () => [{ aprovacao: 'a1' }]]]);
    const res = await new PgRetentionAdmin(cliente).proporPolitica(
      'u1',
      { dataClass: 'RC-01', periodSeconds: 3600, action: 'anonimizar', legalBasisRef: 'parecer-1', effectiveFrom: '2099-01-01T00:00:00Z', enabled: true, dryRun: false },
      'p1',
      'c1',
      AGORA,
    );
    expect(res).toEqual({ approvalRequestId: 'a1' });
    const sql = cliente.chamadas[0]?.sql ?? '';
    expect(sql).toContain('make_interval(secs');
    expect(sql).not.toMatch(/interval\s*'\s*\d+/);
    expect(cliente.chamadas[0]?.params[3]).toBe(3600);
  });
});

describe('SupabaseStorageRetencao (Storage falso)', () => {
  const objeto = { bucket: 'identity-docs' as const, path: 'prof/1/doc.bin' };

  it('remove pelo DELETE e aceita 204 e 404 (ja ausente) como sucesso', async () => {
    const registro: string[] = [];
    await new SupabaseStorageRetencao({ baseUrl: 'https://x.test', serviceKey: 'k', fetchImpl: fetchFalso(204, registro) }).remover(objeto);
    await new SupabaseStorageRetencao({ baseUrl: 'https://x.test', serviceKey: 'k', fetchImpl: fetchFalso(404, registro) }).remover(objeto);
    expect(registro).toEqual([
      'DELETE https://x.test/storage/v1/object/identity-docs/prof/1/doc.bin',
      'DELETE https://x.test/storage/v1/object/identity-docs/prof/1/doc.bin',
    ]);
  });

  it('falha de Storage lanca codigo fixo, sem chave na mensagem', async () => {
    const storage = new SupabaseStorageRetencao({
      baseUrl: 'https://x.test',
      serviceKey: CHAVE_DE_TESTE,
      fetchImpl: fetchFalso(500, []),
    });
    const err = await storage.remover(objeto).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RetentionStorageError);
    expect((err as RetentionStorageError).code).toBe('storage_falha');
    expect((err as Error).message).not.toContain(CHAVE_DE_TESTE);
  });

  it('bucket fora da lista conhecida e recusado antes da rede', async () => {
    const registro: string[] = [];
    const storage = new SupabaseStorageRetencao({ baseUrl: 'https://x.test', serviceKey: 'k', fetchImpl: fetchFalso(204, registro) });
    const err = await storage.remover({ bucket: 'outro-bucket' as never, path: 'a' }).catch((e: unknown) => e);
    expect((err as RetentionStorageError).code).toBe('objeto_recusado');
    await expect(storage.remover({ bucket: 'identity-docs', path: '../fora' })).rejects.toThrow('objeto_recusado');
    expect(registro).toEqual([]);
  });
});

describe('contrato generico das classes (CA-H109-01 e 11)', () => {
  it('somente RC-01 e RC-02 tem adaptador; as demais nao tem fonte de objeto', async () => {
    expect([...RETENTION_CLASSES_COM_ADAPTADOR].sort()).toEqual(['RC-01', 'RC-02']);
    const fonte = new ObjetosRetencaoSql();
    for (const classe of ['RC-03', 'RC-04', 'RC-05', 'RC-06', 'RC-07', 'RC-10'] as const) {
      expect(await fonte.objetosDe(classe, ['u1'])).toEqual([]);
    }
    expect(await fonte.objetosDe('RC-01', ['u1'])).toEqual([]);
  });

  it('politica habilitada de classe sem adaptador (RC-03) nao chama expurgo nem marca linha', async () => {
    const cliente = new ClienteFalso([
      ['from app.retention_policy', () => [{ id: 'p3', data_class: 'RC-03', enabled: true, dry_run: false, action: 'excluir', periodo: true }]],
    ]);
    const registry = new JobRegistry();
    registerRetentionHandlers(registry, {
      store: new PgRetentionStore(cliente),
      objetos: new ObjetosRetencaoSql(),
      storage: new SupabaseStorageRetencao({ baseUrl: 'https://x.test', serviceKey: 'k', fetchImpl: fetchFalso(204, []) }),
      now: () => AGORA,
    });
    const handler = registry.get(RETENTION_PURGE_KIND);
    expect(handler).toBeDefined();
    await handler!.run({ id: 'j1', kind: RETENTION_PURGE_KIND, payload_ref: null, attempts: 1 });
    expect(cliente.chamadas.map((c) => c.sql).some((s) => s.includes('retention_mark_batch'))).toBe(false);
    expect(cliente.chamadas.map((c) => c.sql).some((s) => s.includes('retention_finalize_batch'))).toBe(false);
  });

  it('sem politica habilitada o handler so le a tabela (nada e alterado)', async () => {
    const cliente = new ClienteFalso([
      ['from app.retention_policy', () => [{ id: 'p1', data_class: 'RC-01', enabled: false, dry_run: true, action: null, periodo: false }]],
    ]);
    await new RetentionPurgeHandler({
      store: new PgRetentionStore(cliente),
      objetos: new ObjetosRetencaoSql(),
      storage: new SupabaseStorageRetencao({ baseUrl: 'https://x.test', serviceKey: 'k', fetchImpl: fetchFalso(204, []) }),
      now: () => AGORA,
    }).run();
    expect(cliente.chamadas).toHaveLength(1);
  });

  it('chave de dedupe do dia e o kind do job', () => {
    expect(RETENTION_PURGE_KIND).toBe('retention.purge');
    expect(retentionPurgeDedupeKey(AGORA)).toBe('retention.purge:2099-01-01');
  });
});
