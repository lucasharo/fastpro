// H-031 (Issue #44) | Adaptador Pg da publicacao com cliente falso, sem conexao real (110 §2, §4.4, §5, §9).
// Prova: mapeamento de cada desfecho do banco, parametros na ordem da funcao, erro fixo que nao vaza texto do
// driver, e que o adaptador chama so private.request_publish_* (sem escrita direta). Tambem prova que o
// PgGeoPointStore usado pela publicacao envia subjectKind 'request'.
import { describe, expect, it } from 'vitest';

import {
  PUBLISH_BANCO_FALHOU,
  PUBLISH_CHAVE_PERDIDA,
  PgRequestPublishStore,
  SQL_PUBLISH_ABORT,
  SQL_PUBLISH_BEGIN,
  SQL_PUBLISH_COMMIT,
  type PublishBeginInput,
  type PublishCommitInput,
} from '../src/request-publish.js';
import { PgGeoPointStore } from '../src/geo-point-store.js';
import type { SqlClient, SqlResult } from '../src/jobs-tick.js';

const USER = '11111111-1111-4111-8111-111111111111';
const DRAFT = '22222222-2222-4222-8222-222222222222';
const PEDIDO = '33333333-3333-4333-8333-333333333333';
const PONTO = '44444444-4444-4444-8444-444444444444';
const AGORA = Date.UTC(2026, 10, 13, 12, 0, 0);

interface Chamada {
  readonly sql: string;
  readonly params: unknown[];
}

function clienteFalso(resposta: SqlResult | Error): { client: SqlClient; chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  const client: SqlClient = {
    async query(sql: string, params?: unknown[]): Promise<SqlResult> {
      chamadas.push({ sql, params: params ?? [] });
      if (resposta instanceof Error) throw resposta;
      return resposta;
    },
  };
  return { client, chamadas };
}

const beginInput: PublishBeginInput = {
  userId: USER,
  draftId: DRAFT,
  secretHash: 'a'.repeat(64),
  idemKey: 'chave-idempotencia-01',
  bodyHash: 'b'.repeat(64),
  contentRev: 3,
  userRateKey: 'c'.repeat(64),
  ipRateKey: 'd'.repeat(64),
  nowMs: AGORA,
};

const commitInput: PublishCommitInput = {
  userId: USER,
  draftId: DRAFT,
  secretHash: 'a'.repeat(64),
  idemKey: 'chave-idempotencia-01',
  bodyHash: 'b'.repeat(64),
  contentRev: 3,
  pointId: PONTO,
  ack: false,
  nowMs: AGORA,
};

const linhaVazia = {
  out_status: null,
  out_request_id: null,
  out_published_at: null,
  out_deadline_at: null,
  out_address_text: null,
  out_missing: null,
  out_retry_after: null,
  out_similar_id: null,
  out_similar_published_at: null,
  out_similar_service_name: null,
};

function resposta(campos: Partial<typeof linhaVazia>): SqlResult {
  return { rows: [{ ...linhaVazia, ...campos }] };
}

describe('PgRequestPublishStore.begin', () => {
  it('ok devolve o texto do endereco e envia os parametros na ordem de request_publish_begin', async () => {
    const { client, chamadas } = clienteFalso(resposta({ out_status: 'ok', out_address_text: 'Rua Exemplo, 10' }));
    const out = await new PgRequestPublishStore(client).begin(beginInput);
    expect(out).toEqual({ status: 'ok', addressText: 'Rua Exemplo, 10' });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.sql).toBe(SQL_PUBLISH_BEGIN);
    expect(chamadas[0]?.params).toEqual([
      USER,
      DRAFT,
      'a'.repeat(64),
      'chave-idempotencia-01',
      'b'.repeat(64),
      3,
      'c'.repeat(64),
      'd'.repeat(64),
      new Date(AGORA).toISOString(),
    ]);
  });

  it('repetida e ja_publicado devolvem o pedido com datas em ISO', async () => {
    const data = new Date('2026-11-13T12:00:00.000Z');
    const prazo = new Date('2026-11-20T12:00:00.000Z');
    for (const status of ['repetida', 'ja_publicado'] as const) {
      const { client } = clienteFalso(
        resposta({ out_status: status, out_request_id: PEDIDO, out_published_at: data, out_deadline_at: prazo }),
      );
      const out = await new PgRequestPublishStore(client).begin(beginInput);
      expect(out).toEqual({
        status,
        pedido: { id: PEDIDO, publishedAt: data.toISOString(), acceptanceDeadlineAt: prazo.toISOString() },
      });
    }
  });

  it('campos_faltando devolve a lista do banco; limite devolve retry_after', async () => {
    const faltam = clienteFalso(resposta({ out_status: 'campos_faltando', out_missing: ['address_text', 'urgency'] }));
    expect(await new PgRequestPublishStore(faltam.client).begin(beginInput)).toEqual({
      status: 'campos_faltando',
      missing: ['address_text', 'urgency'],
    });
    const limite = clienteFalso(resposta({ out_status: 'limite', out_retry_after: 1800 }));
    expect(await new PgRequestPublishStore(limite.client).begin(beginInput)).toEqual({
      status: 'limite',
      retryAfter: 1800,
    });
  });

  it('recusas sem dados extras passam como codigo fechado', async () => {
    for (const status of ['conflito', 'em_andamento', 'nao_encontrado', 'email_divergente', 'fotos_em_processamento']) {
      const { client } = clienteFalso(resposta({ out_status: status }));
      expect(await new PgRequestPublishStore(client).begin(beginInput)).toEqual({ status });
    }
  });

  it('status desconhecido ou erro do driver viram erro fixo, sem texto do banco', async () => {
    const desconhecido = clienteFalso(resposta({ out_status: 'algo_novo' }));
    await expect(new PgRequestPublishStore(desconhecido.client).begin(beginInput)).rejects.toThrow(
      PUBLISH_BANCO_FALHOU,
    );
    const driver = clienteFalso(new Error('duplicate key value violates unique constraint "x" DETAIL: (9.9.9.9)'));
    const erro = await new PgRequestPublishStore(driver.client).begin(beginInput).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).toBe(PUBLISH_BANCO_FALHOU);
    expect((erro as Error).message).not.toMatch(/9\.9\.9\.9|unique/);
  });
});

describe('PgRequestPublishStore.commit', () => {
  it('criado devolve o pedido e envia o ponto e o ack na ordem de request_publish_commit', async () => {
    const { client, chamadas } = clienteFalso(
      resposta({
        out_status: 'criado',
        out_request_id: PEDIDO,
        out_published_at: new Date(AGORA),
        out_deadline_at: new Date(AGORA + 168 * 3600 * 1000),
      }),
    );
    const out = await new PgRequestPublishStore(client).commit({ ...commitInput, ack: true });
    expect(out.status).toBe('criado');
    expect(chamadas[0]?.sql).toBe(SQL_PUBLISH_COMMIT);
    expect(chamadas[0]?.params.slice(6)).toEqual([PONTO, true, new Date(AGORA).toISOString()]);
  });

  it('duplicidade devolve so o pedido semelhante do proprio cliente (id, data, nome do servico)', async () => {
    const antes = new Date('2026-11-12T09:00:00.000Z');
    const { client } = clienteFalso(
      resposta({
        out_status: 'duplicidade',
        out_similar_id: PEDIDO,
        out_similar_published_at: antes,
        out_similar_service_name: 'Eletricista',
      }),
    );
    expect(await new PgRequestPublishStore(client).commit(commitInput)).toEqual({
      status: 'duplicidade',
      similar: { id: PEDIDO, publishedAt: antes.toISOString(), serviceName: 'Eletricista' },
    });
  });

  it('chave perdida e falha de banco viram os codigos fixos', async () => {
    const perdida = clienteFalso(new Error(PUBLISH_CHAVE_PERDIDA));
    await expect(new PgRequestPublishStore(perdida.client).commit(commitInput)).rejects.toThrow(
      PUBLISH_CHAVE_PERDIDA,
    );
    const lock = clienteFalso(new Error('canceling statement due to lock timeout'));
    await expect(new PgRequestPublishStore(lock.client).commit(commitInput)).rejects.toThrow(PUBLISH_BANCO_FALHOU);
  });
});

describe('PgRequestPublishStore.abort', () => {
  it('chama request_publish_abort e devolve o booleano', async () => {
    const { client, chamadas } = clienteFalso(resposta({ ok: true } as Partial<typeof linhaVazia>));
    const out = await new PgRequestPublishStore(client).abort({
      userId: USER,
      idemKey: 'chave-idempotencia-01',
      bodyHash: 'b'.repeat(64),
    });
    expect(out).toBe(true);
    expect(chamadas[0]?.sql).toBe(SQL_PUBLISH_ABORT);
    expect(chamadas[0]?.params).toEqual([USER, 'chave-idempotencia-01', 'b'.repeat(64)]);
  });
});

describe('isolamento do adaptador', () => {
  it('so chama private.request_publish_* (sem escrita direta nem tabela app.*)', async () => {
    const todas: string[] = [];
    const client: SqlClient = {
      async query(sql: string): Promise<SqlResult> {
        todas.push(sql);
        return resposta({ out_status: 'conflito', ok: true } as Partial<typeof linhaVazia>);
      },
    };
    const store = new PgRequestPublishStore(client);
    await store.begin(beginInput);
    await store.commit(commitInput);
    await store.abort({ userId: USER, idemKey: 'chave-idempotencia-01', bodyHash: 'b'.repeat(64) });
    for (const sql of todas) {
      expect(sql).toMatch(/^select (\* from )?private\.request_publish_/);
      expect(sql).not.toMatch(/\b(insert|update|delete)\b|\bapp\./i);
    }
  });

  it('o PgGeoPointStore da publicacao envia subjectKind request na reserva', async () => {
    const { client, chamadas } = clienteFalso({
      rows: [{ out_acao: 'chamar', out_ref: 'ref-1', out_point_id: null }],
    });
    const geo = new PgGeoPointStore({ client, subjectKind: 'request', clock: () => AGORA });
    const out = await geo.reserve({
      subject: DRAFT,
      hash: 'e'.repeat(64),
      nowMs: AGORA,
      leaseMs: 60_000,
      callsCap: 3,
      caps: null,
    });
    expect(out).toEqual({ acao: 'chamar', ref: 'ref-1' });
    expect(chamadas[0]?.params[0]).toBe('request');
  });
});
