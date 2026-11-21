// Issue 120 (H-111) | Geracao do extrato de acesso (147-DESENHO-H111 §4.3, §6.2, §7; fatia 7 no servico TS).
// Portas falsas e fetch injetado: sem rede e sem banco. Dados sinteticos (@example.test). Nunca compara conteudo
// real de extrato. Cobre: hash e HMAC conferidos, ordem gravar-depois-registrar, compensacao so antes do registro,
// nenhum apagamento depois de registro commitado, chave curta recusada, adaptador SQL e Storage sem vazar segredo.
import { describe, it, expect } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import {
  DSR_EXTRATO_CHAVE_MIN,
  DSR_EXTRATO_TAMANHO_MAX_BYTES,
  DsrExtratoChaveInvalida,
  DsrExtratoTamanhoInvalido,
  GeradorExtratoDsr,
  PgDsrExtratoSql,
  type DsrExtratoArquivosPort,
  type DsrExtratoSqlPort,
} from '../src/privacy-dsr-extrato.js';
import { DsrExtratoStorageFalha, DsrPayloadInvalido, DsrRetornoDesconhecido, SupabaseStorageExtratos } from '../src/privacy-dsr-jobs.js';

const ATOR = '11111111-2222-4333-8444-555555555555';
const CASO = '6f1f0c52-0d7a-4c8e-9a3b-2f4d5e6a7b8c';
const CHAVE = 'chave-de-teste-sintetica-com-trinta-e-dois-chars';
const CONTEUDO = JSON.stringify({ schema_version: 1, dados: 'sinteticos@example.test' });
const SEGREDO_STORAGE = 'dummy-secret-TESTE_NAO_REAL_987654';

interface Estado {
  ordem: string[];
  gravados: { caminho: string; conteudo: Uint8Array }[];
  removidos: string[];
}

function sqlFalso(opcoes: { payload?: string; registroFalha?: Error }): DsrExtratoSqlPort & { registros: unknown[][] } {
  const registros: unknown[][] = [];
  return {
    registros,
    async gerarPayload() {
      return opcoes.payload ?? CONTEUDO;
    },
    async registrar(...args) {
      registros.push(args);
      if (opcoes.registroFalha) throw opcoes.registroFalha;
      return { status: 'concluido', expiresAt: '2026-11-27T00:00:00.000Z' };
    },
  };
}

function arquivosFalsos(estado: Estado, gravarFalha?: Error, removerFalha?: Error): DsrExtratoArquivosPort {
  return {
    async gravar(caminho, conteudo) {
      estado.ordem.push('gravar');
      if (gravarFalha) throw gravarFalha;
      estado.gravados.push({ caminho, conteudo });
    },
    async remover(caminho) {
      estado.ordem.push('remover');
      if (removerFalha) throw removerFalha;
      estado.removidos.push(caminho);
    },
  };
}

function novoEstado(): Estado {
  return { ordem: [], gravados: [], removidos: [] };
}

describe('GeradorExtratoDsr: caminho feliz', () => {
  it('grava o arquivo, registra com sha256 e HMAC corretos e devolve os metadados', async () => {
    const estado = novoEstado();
    const sql = sqlFalso({});
    const gerador = new GeradorExtratoDsr({ sql, arquivos: arquivosFalsos(estado), chaveAssinatura: CHAVE });
    const r = await gerador.gerar(ATOR, CASO);

    const bytes = Buffer.from(CONTEUDO, 'utf8');
    const sha = createHash('sha256').update(bytes).digest('hex');
    const hmac = createHmac('sha256', Buffer.from(CHAVE, 'utf8')).update(bytes).digest('hex');
    expect(r.sha256).toBe(sha);
    expect(r.tamanho).toBe(bytes.length);
    expect(r.caminho).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/);
    expect(r.expiresAt).toBe('2026-11-27T00:00:00.000Z');

    expect(estado.ordem).toEqual(['gravar']);
    expect(sql.registros).toEqual([[CASO, r.caminho, sha, hmac, bytes.length]]);
    expect(estado.removidos).toEqual([]);
  });

  it('o caminho e aleatorio a cada geracao e nunca contem o protocolo nem o id do titular', async () => {
    const estado = novoEstado();
    const gerador = new GeradorExtratoDsr({ sql: sqlFalso({}), arquivos: arquivosFalsos(estado), chaveAssinatura: CHAVE });
    const a = await gerador.gerar(ATOR, CASO);
    const b = await gerador.gerar(ATOR, CASO);
    expect(a.caminho).not.toBe(b.caminho);
    expect(a.caminho).not.toContain(CASO);
    expect(a.caminho).not.toContain(ATOR);
  });

  it('novoCaminho injetado e usado (teste determinista)', async () => {
    const estado = novoEstado();
    const gerador = new GeradorExtratoDsr({
      sql: sqlFalso({}),
      arquivos: arquivosFalsos(estado),
      chaveAssinatura: CHAVE,
      novoCaminho: () => 'fixo-0001.json',
    });
    await expect(gerador.gerar(ATOR, CASO)).resolves.toMatchObject({ caminho: 'fixo-0001.json' });
  });
});

describe('GeradorExtratoDsr: validacoes e compensacao', () => {
  it('ator ou caso que nao e UUID falha antes de qualquer chamada', async () => {
    const estado = novoEstado();
    const sql = sqlFalso({});
    const gerador = new GeradorExtratoDsr({ sql, arquivos: arquivosFalsos(estado), chaveAssinatura: CHAVE });
    await expect(gerador.gerar('nao-uuid', CASO)).rejects.toBeInstanceOf(DsrPayloadInvalido);
    await expect(gerador.gerar(ATOR, `${CASO}'`)).rejects.toBeInstanceOf(DsrPayloadInvalido);
    expect(estado.ordem).toEqual([]);
    expect(sql.registros).toEqual([]);
  });

  it('payload vazio ou acima de 10 MiB nao chega ao Storage', async () => {
    for (const payload of ['', 'x'.repeat(DSR_EXTRATO_TAMANHO_MAX_BYTES + 1)]) {
      const estado = novoEstado();
      const gerador = new GeradorExtratoDsr({ sql: sqlFalso({ payload }), arquivos: arquivosFalsos(estado), chaveAssinatura: CHAVE });
      await expect(gerador.gerar(ATOR, CASO)).rejects.toBeInstanceOf(DsrExtratoTamanhoInvalido);
      expect(estado.ordem).toEqual([]);
    }
  });

  it('chave de assinatura curta e recusada na construcao', () => {
    const estado = novoEstado();
    expect(
      () =>
        new GeradorExtratoDsr({
          sql: sqlFalso({}),
          arquivos: arquivosFalsos(estado),
          chaveAssinatura: 'curta'.padEnd(DSR_EXTRATO_CHAVE_MIN - 1, 'x'),
        }),
    ).toThrow(DsrExtratoChaveInvalida);
  });

  it('falha ao gravar: nao registra e o erro sobe', async () => {
    const estado = novoEstado();
    const erro = new DsrExtratoStorageFalha();
    const sql = sqlFalso({});
    const gerador = new GeradorExtratoDsr({ sql, arquivos: arquivosFalsos(estado, erro), chaveAssinatura: CHAVE });
    await expect(gerador.gerar(ATOR, CASO)).rejects.toBe(erro);
    expect(sql.registros).toEqual([]);
  });

  it('registro recusado apaga o arquivo gravado (compensacao) e propaga o erro original', async () => {
    const estado = novoEstado();
    const erro = new DsrRetornoDesconhecido();
    const gerador = new GeradorExtratoDsr({
      sql: sqlFalso({ registroFalha: erro }),
      arquivos: arquivosFalsos(estado),
      chaveAssinatura: CHAVE,
      novoCaminho: () => 'compensado.json',
    });
    await expect(gerador.gerar(ATOR, CASO)).rejects.toBe(erro);
    expect(estado.ordem).toEqual(['gravar', 'remover']);
    expect(estado.removidos).toEqual(['compensado.json']);
  });

  it('se a compensacao tambem falhar, o erro original continua sendo o que sobe', async () => {
    const estado = novoEstado();
    const original = new DsrRetornoDesconhecido();
    const gerador = new GeradorExtratoDsr({
      sql: sqlFalso({ registroFalha: original }),
      arquivos: arquivosFalsos(estado, undefined, new DsrExtratoStorageFalha()),
      chaveAssinatura: CHAVE,
    });
    await expect(gerador.gerar(ATOR, CASO)).rejects.toBe(original);
  });
});

describe('PgDsrExtratoSql (funcoes app.dsr_admin_generate_extract e app.dsr_register_extract)', () => {
  type Chamada = { texto: string; params: unknown[] | undefined };
  function cliente(linhas: Record<string, unknown>[]): { query: (t: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; chamadas: Chamada[] } {
    const chamadas: Chamada[] = [];
    return {
      chamadas,
      async query(texto, params) {
        chamadas.push({ texto, params });
        return { rows: linhas };
      },
    };
  }

  it('gerarPayload chama a funcao do operador com ator e caso e devolve o texto', async () => {
    const c = cliente([{ out_payload: CONTEUDO }]);
    await expect(new PgDsrExtratoSql(c).gerarPayload(ATOR, CASO)).resolves.toBe(CONTEUDO);
    expect(c.chamadas[0]?.texto).toContain('app.dsr_admin_generate_extract($1::uuid, $2::uuid)');
    expect(c.chamadas[0]?.params).toEqual([ATOR, CASO]);
  });

  it('gerarPayload sem linha falha com codigo fixo', async () => {
    await expect(new PgDsrExtratoSql(cliente([])).gerarPayload(ATOR, CASO)).rejects.toBeInstanceOf(DsrRetornoDesconhecido);
  });

  it('registrar chama app.dsr_register_extract com 5 parametros e le status e validade', async () => {
    const validade = new Date('2026-11-27T00:00:00.000Z');
    const c = cliente([{ out_status: 'concluido', out_expires_at: validade }]);
    const sha = 'a'.repeat(64);
    const sig = 'b'.repeat(64);
    await expect(new PgDsrExtratoSql(c).registrar(CASO, 'x.json', sha, sig, 12)).resolves.toEqual({
      status: 'concluido',
      expiresAt: '2026-11-27T00:00:00.000Z',
    });
    expect(c.chamadas[0]?.texto).toContain('app.dsr_register_extract($1::uuid, $2, $3, $4, $5::integer)');
    expect(c.chamadas[0]?.params).toEqual([CASO, 'x.json', sha, sig, 12]);
  });
});

describe('SupabaseStorageExtratos.gravar (bucket privado dsr-exports)', () => {
  it('envia POST sem sobrescrita, com tipo JSON e chave so nos cabecalhos', async () => {
    const chamadas: { url: string; init: RequestInit }[] = [];
    const http = (async (url: string | URL | Request, init?: RequestInit) => {
      chamadas.push({ url: String(url), init: init ?? {} });
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    await new SupabaseStorageExtratos({ url: 'https://projeto.example.test/', secretKey: SEGREDO_STORAGE, fetch: http }).gravar(
      'extrato-1.json',
      Buffer.from('{}'),
    );
    expect(chamadas[0]?.url).toBe('https://projeto.example.test/storage/v1/object/dsr-exports/extrato-1.json');
    expect(chamadas[0]?.init.method).toBe('POST');
    const cab = chamadas[0]?.init.headers as Record<string, string>;
    expect(cab['x-upsert']).toBe('false');
    expect(cab['Content-Type']).toBe('application/json');
    expect(chamadas[0]?.url).not.toContain(SEGREDO_STORAGE);
  });

  it('caminho que ja existe (409) ou outra falha vira erro com codigo fixo, sem segredo', async () => {
    const http = (async () => new Response(null, { status: 409 })) as unknown as typeof fetch;
    const adaptador = new SupabaseStorageExtratos({ url: 'https://projeto.example.test', secretKey: SEGREDO_STORAGE, fetch: http });
    let erro: unknown;
    try {
      await adaptador.gravar('extrato-2.json', Buffer.from('{}'));
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(DsrExtratoStorageFalha);
    expect(String((erro as Error).message)).not.toContain(SEGREDO_STORAGE);
  });
});
