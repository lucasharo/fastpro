// H-110 (Issue 119) | Adaptadores dos expurgos operacionais (docs/factory/105-DESENHO-H110.md §3, §7, CA-H110-11).
// Sem banco e sem rede: SqlClient falso responde por texto da consulta; fetch falso simula o Storage.
// A prova com o banco real esta em ops-purge-h110.dbtest.mjs; a prova com Storage real fica pendente (A-4 de H-109).
import { describe, expect, it } from 'vitest';
import { PgOpsPurgeStore } from '../src/ops-purge-store.js';
import {
  nomeDeQuarentenaValido,
  QuarentenaStorageError,
  SupabaseStorageQuarentena,
} from '../src/ops-purge-storage.js';
import {
  montaExecutoresOpsPurge,
  OPS_PURGE_KIND,
  OpsPurgeHandler,
  type OpsPurgeDeps,
  type QuarentenaArquivosPort,
} from '../src/ops-purge-jobs.js';
import type { SqlClient } from '../src/jobs-tick.js';

type Linhas = { rows: Record<string, unknown>[] };
type Responde = (sql: string, params: unknown[]) => Linhas | Error;

/** Cliente falso: registra cada consulta e responde pelo texto (ordem de prioridade do array). */
function clienteFalso(responde: Responde) {
  const chamadas: { sql: string; params: unknown[] }[] = [];
  const client: SqlClient = {
    async query(sql: string, params: unknown[] = []) {
      chamadas.push({ sql, params });
      const r = responde(sql, params);
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return { client, chamadas };
}

const DESLIGADO: Linhas = {
  rows: [{ out_estado: 'desligado', out_removidos: 0, out_retidos: 0, out_falhos: 0 }],
};
const OK_VAZIO: Linhas = {
  rows: [{ out_estado: 'ok', out_removidos: 0, out_retidos: 0, out_falhos: 0 }],
};

/** Resposta padrao: todo bloco desligado, auditoria devolve id. Sobrescreva por texto. */
function padrao(sobrescritas: [string, Linhas | Error][] = []): Responde {
  return (sql) => {
    for (const [trecho, resposta] of sobrescritas) {
      if (sql.includes(trecho)) return resposta;
    }
    if (sql.includes('ops_purge_audit')) return { rows: [{ id: 'audit-1' }] };
    return DESLIGADO;
  };
}

function arquivosFalsos(log: string[], falhaEm: string[] = []): QuarentenaArquivosPort {
  return {
    async remover(nome: string) {
      log.push(`remover:${nome}`);
      if (falhaEm.includes(nome)) throw new QuarentenaStorageError('storage_falha');
    },
  };
}

function depsDe(client: SqlClient, arquivos: QuarentenaArquivosPort): OpsPurgeDeps {
  return {
    store: new PgOpsPurgeStore(client),
    arquivos,
    caminhoDoObjeto: (assetId: string) => `${assetId}.jpg`,
    now: () => Date.UTC(2026, 10, 13, 12, 0, 0),
    maxLotes: 1,
  };
}

describe('nomeDeQuarentenaValido (CA-H110-11, nome antes da rede)', () => {
  it.each([
    '0f8a1c2e-1111-4222-8333-944444444444.jpg',
    'pasta/arquivo_1.jpg',
  ])('aceita %s', (nome) => {
    expect(nomeDeQuarentenaValido(nome)).toBe(true);
  });

  it.each(['', '/x.jpg', '../x.jpg', 'a/../b.jpg', 'a//b.jpg', 'a b.jpg', 'a?b=1', 'x/'])('recusa %j', (nome) => {
    expect(nomeDeQuarentenaValido(nome)).toBe(false);
  });
});

describe('SupabaseStorageQuarentena', () => {
  const base = 'https://projeto.example.test';
  const chave = 'chave-de-teste-nao-registrada';

  it('remove pelo bucket quarantine com DELETE e codifica cada segmento', async () => {
    const urls: string[] = [];
    const metodos: string[] = [];
    const adaptador = new SupabaseStorageQuarentena({
      baseUrl: base,
      serviceKey: chave,
      fetchImpl: (async (url: string, init?: RequestInit) => {
        urls.push(String(url));
        metodos.push(String(init?.method));
        return new Response(null, { status: 200 });
      }) as typeof fetch,
    });
    await adaptador.remover('pasta/foto_1.jpg');
    expect(metodos).toEqual(['DELETE']);
    expect(urls[0]).toBe(`${base}/storage/v1/object/quarantine/pasta/foto_1.jpg`);
  });

  it('404 e tratado como objeto ja ausente (sucesso)', async () => {
    const adaptador = new SupabaseStorageQuarentena({
      baseUrl: base,
      serviceKey: chave,
      fetchImpl: (async () => new Response(null, { status: 404 })) as typeof fetch,
    });
    await expect(adaptador.remover('x.jpg')).resolves.toBeUndefined();
  });

  it('erro de servidor vira codigo fixo, sem URL nem chave na mensagem', async () => {
    const adaptador = new SupabaseStorageQuarentena({
      baseUrl: base,
      serviceKey: chave,
      fetchImpl: (async () => new Response('detalhe', { status: 500 })) as typeof fetch,
    });
    const erro = await adaptador.remover('x.jpg').catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(QuarentenaStorageError);
    expect((erro as QuarentenaStorageError).code).toBe('storage_falha');
    expect((erro as Error).message).toBe('storage_falha');
    expect((erro as Error).message).not.toContain(chave);
    expect((erro as Error).message).not.toContain('http');
  });

  it('falha de rede vira storage_falha', async () => {
    const adaptador = new SupabaseStorageQuarentena({
      baseUrl: base,
      serviceKey: chave,
      fetchImpl: (async () => {
        throw new TypeError('rede caiu');
      }) as typeof fetch,
    });
    const erro = await adaptador.remover('x.jpg').catch((e: unknown) => e);
    expect((erro as QuarentenaStorageError).code).toBe('storage_falha');
  });

  it('nome invalido e recusado antes de qualquer chamada de rede', async () => {
    let chamadas = 0;
    const adaptador = new SupabaseStorageQuarentena({
      baseUrl: base,
      serviceKey: chave,
      fetchImpl: (async () => {
        chamadas += 1;
        return new Response(null, { status: 200 });
      }) as typeof fetch,
    });
    const erro = await adaptador.remover('../outro-bucket/x.jpg').catch((e: unknown) => e);
    expect((erro as QuarentenaStorageError).code).toBe('objeto_recusado');
    expect(chamadas).toBe(0);
  });
});

describe('PgOpsPurgeStore', () => {
  it('converte contagens em texto para numero e passa o instante em ISO e o limite posicional', async () => {
    const { client, chamadas } = clienteFalso(
      padrao([
        [
          'ops_purge_session',
          { rows: [{ out_estado: 'ok', out_removidos: '5', out_retidos: '2', out_falhos: '0' }] },
        ],
      ]),
    );
    const store = new PgOpsPurgeStore(client);
    const agora = Date.UTC(2026, 10, 13, 3, 23, 0);
    const r = await store.bloco('ops_purge_session', agora, 500);
    expect(r).toEqual({ estado: 'ok', removidos: 5, retidos: 2, falhos: 0 });
    expect(chamadas[0].params).toEqual([new Date(agora).toISOString(), 500]);
  });

  it('estado fora da lista fechada vira falha do bloco', async () => {
    const { client } = clienteFalso(
      padrao([['ops_purge_draft', { rows: [{ out_estado: 'qualquer', out_removidos: 0, out_retidos: 0, out_falhos: 0 }] }]]),
    );
    const r = await new PgOpsPurgeStore(client).bloco('ops_purge_draft', Date.now(), 10);
    expect(r.estado).toBe('falha');
    expect(r.falhos).toBe(1);
  });

  it('erro de banco vira falha com codigo fixo, sem repassar a mensagem', async () => {
    const { client } = clienteFalso(padrao([['ops_purge_auth_challenge', new Error('segredo do banco')]]));
    const r = await new PgOpsPurgeStore(client).bloco('ops_purge_auth_challenge', Date.now(), 10);
    expect(r).toEqual({ estado: 'falha', removidos: 0, retidos: 0, falhos: 1 });
  });

  it('concluirMarcados sem ids nao chama o banco', async () => {
    const { client, chamadas } = clienteFalso(padrao());
    expect(await new PgOpsPurgeStore(client).concluirMarcados([])).toBe(0);
    expect(chamadas).toHaveLength(0);
  });

  it('auditar envia so o id do job e as contagens em jsonb', async () => {
    const { client, chamadas } = clienteFalso(padrao());
    await new PgOpsPurgeStore(client).auditar('job-1', { run_no: 1, e1_removidos: 0 });
    expect(chamadas[0].params).toEqual(['job-1', JSON.stringify({ run_no: 1, e1_removidos: 0 })]);
  });
});

describe('bloco E1 (ordem objeto antes da linha, RN-H110-12; CA-H110-11)', () => {
  it('so apaga a linha depois do objeto, e so das linhas cujo objeto saiu', async () => {
    const log: string[] = [];
    const { client } = clienteFalso((sql, params) => {
      if (sql.includes('ops_purge_media_mark(')) return OK_VAZIO;
      if (sql.includes('ops_purge_media_marcados')) return { rows: [{ ids: ['id-1', 'id-2'] }] };
      if (sql.includes('media_purge_done')) {
        log.push(`sql:media_purge_done:${JSON.stringify(params[0])}`);
        return { rows: [{ n: 1 }] };
      }
      return padrao()(sql, params);
    });
    const [e1] = montaExecutoresOpsPurge(depsDe(client, arquivosFalsos(log, ['id-2.jpg'])));
    expect(e1.bloco).toBe('e1');
    const r = await e1.lote(10);
    expect(log).toEqual([
      'remover:id-1.jpg',
      'remover:id-2.jpg',
      'sql:media_purge_done:["id-1"]',
    ]);
    expect(r.removidos).toBe(1);
    expect(r.falhos).toBe(1);
    expect(r.estado).toBe('ok');
  });

  it('falha de Storage deixa a linha marcada: nada e apagado no banco sem objeto removido', async () => {
    const log: string[] = [];
    const { client, chamadas } = clienteFalso((sql, params) => {
      if (sql.includes('ops_purge_media_mark(')) return OK_VAZIO;
      if (sql.includes('ops_purge_media_marcados')) return { rows: [{ ids: ['id-9'] }] };
      if (sql.includes('media_purge_done')) {
        log.push('sql:media_purge_done');
        return { rows: [{ n: 0 }] };
      }
      return padrao()(sql, params);
    });
    const [e1] = montaExecutoresOpsPurge(depsDe(client, arquivosFalsos(log, ['id-9.jpg'])));
    const r = await e1.lote(10);
    // Sem objeto removido, nenhuma linha de midia e apagada: media_purge_done nem e chamado.
    expect(log).toEqual(['remover:id-9.jpg']);
    expect(chamadas.some((c) => c.sql.includes('media_purge_done'))).toBe(false);
    expect(r.falhos).toBe(1);
    expect(r.removidos).toBe(0);
  });
});

describe('bloco E1, falha persistente de objeto (achado 2 do Code Review)', () => {
  it('foto cuja remocao falha vai para o fim da fila com ops_purge_media_adia e nao volta no mesmo lote', async () => {
    const log: string[] = [];
    const { client, chamadas } = clienteFalso((sql, params) => {
      if (sql.includes('ops_purge_media_mark(')) return OK_VAZIO;
      if (sql.includes('ops_purge_media_marcados')) return { rows: [{ ids: ['id-ruim', 'id-bom'] }] };
      if (sql.includes('media_purge_done')) return { rows: [{ n: 1 }] };
      if (sql.includes('ops_purge_media_adia')) return { rows: [{ n: 1 }] };
      return padrao()(sql, params);
    });
    const [e1] = montaExecutoresOpsPurge(depsDe(client, arquivosFalsos(log, ['id-ruim.jpg'])));
    const r = await e1.lote(10);
    const adia = chamadas.find((c) => c.sql.includes('ops_purge_media_adia'));
    expect(adia?.params[0]).toEqual(['id-ruim']);
    expect(chamadas.find((c) => c.sql.includes('media_purge_done'))?.params[0]).toEqual(['id-bom']);
    expect(r).toEqual({ estado: 'ok', removidos: 1, retidos: 0, falhos: 1 });
  });

  it('sem falha, nao chama ops_purge_media_adia', async () => {
    const { client, chamadas } = clienteFalso((sql, params) => {
      if (sql.includes('ops_purge_media_mark(')) return OK_VAZIO;
      if (sql.includes('ops_purge_media_marcados')) return { rows: [{ ids: ['id-1'] }] };
      if (sql.includes('media_purge_done')) return { rows: [{ n: 1 }] };
      return padrao()(sql, params);
    });
    const [e1] = montaExecutoresOpsPurge(depsDe(client, arquivosFalsos([])));
    await e1.lote(10);
    expect(chamadas.some((c) => c.sql.includes('ops_purge_media_adia'))).toBe(false);
  });
});

describe('bloco E9 (orfaos no bucket quarantine)', () => {
  it('o SQL devolve so orfaos e conta os fora do padrao; cada orfao e removido pelo Storage', async () => {
    const log: string[] = [];
    const { client } = clienteFalso((sql, params) => {
      if (sql.includes('ops_purge_media_orfaos')) {
        return { rows: [{ out_estado: 'ok', out_nomes: ['orfa-1.jpg', 'orfa-2.jpg'], out_retidos: 3 }] };
      }
      return padrao()(sql, params);
    });
    const e9 = montaExecutoresOpsPurge(depsDe(client, arquivosFalsos(log))).find((e) => e.bloco === 'e9');
    const r = await e9!.lote(10);
    expect(log).toEqual(['remover:orfa-1.jpg', 'remover:orfa-2.jpg']);
    expect(r).toEqual({ estado: 'ok', removidos: 2, retidos: 3, falhos: 0 });
  });

  it('falha ao remover um orfao conta falhos e segue para o proximo', async () => {
    const log: string[] = [];
    const { client } = clienteFalso((sql, params) => {
      if (sql.includes('ops_purge_media_orfaos')) {
        return { rows: [{ out_estado: 'ok', out_nomes: ['ruim.jpg', 'orfa.jpg'], out_retidos: 0 }] };
      }
      return padrao()(sql, params);
    });
    const e9 = montaExecutoresOpsPurge(depsDe(client, arquivosFalsos(log, ['ruim.jpg']))).find((e) => e.bloco === 'e9');
    const r = await e9!.lote(10);
    expect(log).toEqual(['remover:ruim.jpg', 'remover:orfa.jpg']);
    expect(r).toEqual({ estado: 'ok', removidos: 1, retidos: 0, falhos: 1 });
  });

  it('estado fora da lista fechada vira falha do bloco e nao toca o Storage', async () => {
    const log: string[] = [];
    const { client } = clienteFalso((sql, params) => {
      if (sql.includes('ops_purge_media_orfaos')) return { rows: [{ out_estado: 'inventado', out_nomes: ['x.jpg'], out_retidos: 0 }] };
      return padrao()(sql, params);
    });
    const e9 = montaExecutoresOpsPurge(depsDe(client, arquivosFalsos(log))).find((e) => e.bloco === 'e9');
    const r = await e9!.lote(10);
    expect(r.estado).toBe('falha');
    expect(log).toHaveLength(0);
  });

  it('bloco desligado no SQL e repassado sem tocar o Storage', async () => {
    const log: string[] = [];
    const { client } = clienteFalso(padrao());
    const e9 = montaExecutoresOpsPurge(depsDe(client, arquivosFalsos(log))).find((e) => e.bloco === 'e9');
    const r = await e9!.lote(10);
    expect(r.estado).toBe('desligado');
    expect(log).toHaveLength(0);
  });
});

describe('OpsPurgeHandler', () => {
  it('registra o kind ops.purge e audita uma vez com as 37 contagens inteiras, sem texto livre', async () => {
    expect(OPS_PURGE_KIND).toBe('ops.purge');
    const { client, chamadas } = clienteFalso(padrao());
    const handler = new OpsPurgeHandler(depsDe(client, arquivosFalsos([])));
    await handler.run({ id: 'job-77', kind: OPS_PURGE_KIND, payload_ref: null, attempts: 1 });
    const auditorias = chamadas.filter((c) => c.sql.includes('ops_purge_audit'));
    expect(auditorias).toHaveLength(1);
    expect(auditorias[0].params[0]).toBe('job-77');
    const contagens = JSON.parse(String(auditorias[0].params[1])) as Record<string, unknown>;
    const chaves = Object.keys(contagens);
    expect(chaves).toHaveLength(37);
    for (const chave of chaves) {
      expect(chave).toMatch(/^(run_no|e[1-9]_(removidos|retidos|falhos|pulado))$/);
      expect(Number.isInteger(contagens[chave])).toBe(true);
    }
  });

  it('erro de banco em um bloco nao derruba o job: a auditoria ainda e gravada', async () => {
    const { client, chamadas } = clienteFalso(padrao([['ops_purge_session', new Error('timeout')]]));
    const handler = new OpsPurgeHandler(depsDe(client, arquivosFalsos([])));
    await expect(
      handler.run({ id: 'job-78', kind: OPS_PURGE_KIND, payload_ref: null, attempts: 1 }),
    ).resolves.toBeUndefined();
    expect(chamadas.some((c) => c.sql.includes('ops_purge_audit'))).toBe(true);
  });
});
