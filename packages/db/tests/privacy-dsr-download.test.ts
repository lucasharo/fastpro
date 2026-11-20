// Issue 120 (H-111) | Download do extrato por token de uso unico (147-DESENHO-H111 D-A6, §6.2, §7). Portas falsas e
// fetch injetado: sem rede e sem banco. Dados sinteticos (@example.test). Nunca compara conteudo real de extrato.
import { describe, it, expect } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import {
  DsrDownloadRecusado,
  DsrExtratoIntegridadeFalha,
  PgDsrDownloadSql,
  ServicoDownloadExtrato,
  type DsrDownloadRegistro,
  type DsrDownloadSqlPort,
} from '../src/privacy-dsr-download.js';
import { DsrExtratoChaveInvalida } from '../src/privacy-dsr-extrato.js';
import { DsrExtratoStorageFalha, DsrPayloadInvalido, SupabaseStorageExtratos } from '../src/privacy-dsr-jobs.js';

const SUJEITO = '11111111-2222-4333-8444-555555555555';
const CASO = '6f1f0c52-0d7a-4c8e-9a3b-2f4d5e6a7b8c';
const CHAVE = 'chave-de-teste-sintetica-com-trinta-e-dois-chars';
const CONTEUDO = Buffer.from(JSON.stringify({ schema_version: 1, dados: 'sinteticos@example.test' }), 'utf8');
const SHA = createHash('sha256').update(CONTEUDO).digest('hex');
const ASSINATURA = createHmac('sha256', Buffer.from(CHAVE, 'utf8')).update(CONTEUDO).digest('hex');
const SEGREDO_STORAGE = 'sb_secret_TESTE_NAO_REAL_987654';

/** Banco falso em memoria: guarda so hashes, como o banco real, e recusa uso repetido. */
function sqlFalso(opcoes: { sha?: string; assinatura?: string } = {}) {
  const emitidos: string[] = [];
  const usados = new Set<string>();
  const chamadas: unknown[][] = [];
  const porta: DsrDownloadSqlPort = {
    async emitir(sujeito, caso, hash) {
      chamadas.push(['emitir', sujeito, caso, hash]);
      emitidos.push(hash);
      return { expiresAt: '2026-11-20T17:05:00.000Z' };
    },
    async consumir(hash): Promise<DsrDownloadRegistro> {
      chamadas.push(['consumir', hash]);
      if (!emitidos.includes(hash)) throw new DsrDownloadRecusado('dsr_token_invalido');
      if (usados.has(hash)) throw new DsrDownloadRecusado('dsr_token_usado');
      usados.add(hash);
      return {
        caseId: CASO,
        subjectUserId: SUJEITO,
        storagePath: 'arquivo-1.json',
        sha256: opcoes.sha ?? SHA,
        signature: opcoes.assinatura ?? ASSINATURA,
        sizeBytes: CONTEUDO.length,
        expiresAt: '2026-11-27T00:00:00.000Z',
      };
    },
  };
  return { porta, emitidos, chamadas };
}

function arquivosFalsos(lidos: string[] = [], conteudo: Uint8Array = CONTEUDO) {
  return {
    async ler(caminho: string): Promise<Uint8Array> {
      lidos.push(caminho);
      return conteudo;
    },
  };
}

async function recusa(promessa: Promise<unknown>): Promise<unknown> {
  try {
    await promessa;
  } catch (err) {
    return err;
  }
  throw new Error('deveria ter falhado');
}

describe('ServicoDownloadExtrato: emissao do token', () => {
  it('emite token de 43 caracteres e so o hash chega ao banco', async () => {
    const sql = sqlFalso();
    const servico = new ServicoDownloadExtrato({ sql: sql.porta, arquivos: arquivosFalsos(), chaveAssinatura: CHAVE });
    const r = await servico.emitir(SUJEITO, CASO);
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.expiresAt).toBe('2026-11-20T17:05:00.000Z');
    const hashEsperado = createHash('sha256').update(r.token).digest('hex');
    expect(sql.chamadas).toEqual([['emitir', SUJEITO, CASO, hashEsperado]]);
    expect(JSON.stringify(sql.chamadas)).not.toContain(r.token);
  });

  it('sujeito ou caso que nao e UUID falha antes do banco', async () => {
    const sql = sqlFalso();
    const servico = new ServicoDownloadExtrato({ sql: sql.porta, arquivos: arquivosFalsos(), chaveAssinatura: CHAVE });
    await expect(servico.emitir('nao-uuid', CASO)).rejects.toBeInstanceOf(DsrPayloadInvalido);
    await expect(servico.emitir(SUJEITO, `${CASO}'`)).rejects.toBeInstanceOf(DsrPayloadInvalido);
    expect(sql.chamadas).toEqual([]);
  });

  it('chave de assinatura curta e recusada na construcao', () => {
    expect(
      () => new ServicoDownloadExtrato({ sql: sqlFalso().porta, arquivos: arquivosFalsos(), chaveAssinatura: 'curta' }),
    ).toThrow(DsrExtratoChaveInvalida);
  });
});

describe('ServicoDownloadExtrato: consumo de uso unico', () => {
  it('a primeira chamada devolve o conteudo conferido; a segunda e recusada sem ler o arquivo', async () => {
    const sql = sqlFalso();
    const lidos: string[] = [];
    const servico = new ServicoDownloadExtrato({ sql: sql.porta, arquivos: arquivosFalsos(lidos), chaveAssinatura: CHAVE });
    const { token } = await servico.emitir(SUJEITO, CASO);
    const primeira = await servico.baixar(token);
    expect(Buffer.from(primeira.conteudo).equals(CONTEUDO)).toBe(true);
    expect(primeira.sha256).toBe(SHA);
    expect(primeira.caseId).toBe(CASO);
    expect(lidos).toEqual(['arquivo-1.json']);

    const segunda = await recusa(servico.baixar(token));
    expect(segunda).toBeInstanceOf(DsrDownloadRecusado);
    expect((segunda as DsrDownloadRecusado).motivo).toBe('dsr_token_usado');
    expect(lidos).toEqual(['arquivo-1.json']);
  });

  it('formato invalido do token nao chega ao banco e recebe a recusa de token desconhecido', async () => {
    const sql = sqlFalso();
    const servico = new ServicoDownloadExtrato({ sql: sql.porta, arquivos: arquivosFalsos(), chaveAssinatura: CHAVE });
    for (const token of ['', 'curto', 'x'.repeat(44), 'com espaco '.padEnd(43, 'a')]) {
      const err = await recusa(servico.baixar(token));
      expect((err as DsrDownloadRecusado).motivo).toBe('dsr_token_invalido');
    }
    expect(sql.chamadas).toEqual([]);
  });

  it('token bem formado mas nunca emitido e recusado como invalido', async () => {
    const servico = new ServicoDownloadExtrato({ sql: sqlFalso().porta, arquivos: arquivosFalsos(), chaveAssinatura: CHAVE });
    const err = await recusa(servico.baixar('a'.repeat(43)));
    expect((err as DsrDownloadRecusado).motivo).toBe('dsr_token_invalido');
  });

  it('conteudo com sha256 diferente do registro falha na integridade, e o token ja ficou consumido', async () => {
    const sql = sqlFalso({ sha: 'f'.repeat(64) });
    const servico = new ServicoDownloadExtrato({ sql: sql.porta, arquivos: arquivosFalsos(), chaveAssinatura: CHAVE });
    const { token } = await servico.emitir(SUJEITO, CASO);
    expect(await recusa(servico.baixar(token))).toBeInstanceOf(DsrExtratoIntegridadeFalha);
    const depois = await recusa(servico.baixar(token));
    expect((depois as DsrDownloadRecusado).motivo).toBe('dsr_token_usado');
  });

  it('assinatura HMAC que nao confere com a chave do servidor falha na integridade', async () => {
    const sql = sqlFalso({ assinatura: '0'.repeat(64) });
    const servico = new ServicoDownloadExtrato({ sql: sql.porta, arquivos: arquivosFalsos(), chaveAssinatura: CHAVE });
    const { token } = await servico.emitir(SUJEITO, CASO);
    expect(await recusa(servico.baixar(token))).toBeInstanceOf(DsrExtratoIntegridadeFalha);
  });

  it('falha do Storage na leitura propaga codigo fixo; o token ja consumido nao volta', async () => {
    const sql = sqlFalso();
    const arquivos = { ler: async () => Promise.reject(new DsrExtratoStorageFalha()) };
    const servico = new ServicoDownloadExtrato({ sql: sql.porta, arquivos, chaveAssinatura: CHAVE });
    const { token } = await servico.emitir(SUJEITO, CASO);
    expect(await recusa(servico.baixar(token))).toBeInstanceOf(DsrExtratoStorageFalha);
    expect(((await recusa(servico.baixar(token))) as DsrDownloadRecusado).motivo).toBe('dsr_token_usado');
  });
});

describe('PgDsrDownloadSql (funcoes app.dsr_issue_extract_token e app.dsr_consume_extract_token)', () => {
  type Chamada = { texto: string; params: unknown[] | undefined };
  function cliente(resposta: () => Promise<{ rows: Record<string, unknown>[] }>): {
    query: (t: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
    chamadas: Chamada[];
  } {
    const chamadas: Chamada[] = [];
    return {
      chamadas,
      async query(texto, params) {
        chamadas.push({ texto, params });
        return resposta();
      },
    };
  }

  it('emitir chama a funcao com 3 parametros e devolve a validade em texto ISO', async () => {
    const c = cliente(async () => ({ rows: [{ out_expires_at: new Date('2026-11-20T17:05:00.000Z') }] }));
    const hash = 'a'.repeat(64);
    await expect(new PgDsrDownloadSql(c).emitir(SUJEITO, CASO, hash)).resolves.toEqual({
      expiresAt: '2026-11-20T17:05:00.000Z',
    });
    expect(c.chamadas[0]?.texto).toContain('app.dsr_issue_extract_token($1::uuid, $2::uuid, $3)');
    expect(c.chamadas[0]?.params).toEqual([SUJEITO, CASO, hash]);
  });

  it('erro do banco com motivo conhecido vira recusa com codigo fixo', async () => {
    const c = cliente(async () => {
      throw new Error('dsr_extrato_indisponivel');
    });
    const err = await recusa(new PgDsrDownloadSql(c).emitir(SUJEITO, CASO, 'a'.repeat(64)));
    expect(err).toBeInstanceOf(DsrDownloadRecusado);
    expect((err as DsrDownloadRecusado).motivo).toBe('dsr_extrato_indisponivel');
  });

  it('erro de conexao (sem motivo conhecido) segue sem mudanca', async () => {
    const original = new Error('conexao recusada');
    const c = cliente(async () => {
      throw original;
    });
    expect(await recusa(new PgDsrDownloadSql(c).consumir('a'.repeat(64)))).toBe(original);
  });

  it('consumir le as colunas de saida e converte tamanho e validade', async () => {
    const c = cliente(async () => ({
      rows: [
        {
          out_case_id: CASO,
          out_subject_user_id: SUJEITO,
          out_storage_path: 'arquivo-1.json',
          out_sha256: SHA,
          out_signature: ASSINATURA,
          out_size_bytes: 42,
          out_expires_at: new Date('2026-11-27T00:00:00.000Z'),
        },
      ],
    }));
    const r = await new PgDsrDownloadSql(c).consumir('a'.repeat(64));
    expect(r).toEqual({
      caseId: CASO,
      subjectUserId: SUJEITO,
      storagePath: 'arquivo-1.json',
      sha256: SHA,
      signature: ASSINATURA,
      sizeBytes: 42,
      expiresAt: '2026-11-27T00:00:00.000Z',
    });
  });
});

describe('SupabaseStorageExtratos.ler (bucket privado dsr-exports)', () => {
  it('le com GET e devolve os bytes, com a chave so nos cabecalhos', async () => {
    const chamadas: { url: string; init: RequestInit }[] = [];
    const http = (async (url: string | URL | Request, init?: RequestInit) => {
      chamadas.push({ url: String(url), init: init ?? {} });
      return new Response(CONTEUDO, { status: 200 });
    }) as unknown as typeof fetch;
    const bytes = await new SupabaseStorageExtratos({
      url: 'https://projeto.example.test/',
      secretKey: SEGREDO_STORAGE,
      fetch: http,
    }).ler('arquivo-1.json');
    expect(Buffer.from(bytes).equals(CONTEUDO)).toBe(true);
    expect(chamadas[0]?.url).toBe('https://projeto.example.test/storage/v1/object/dsr-exports/arquivo-1.json');
    expect(chamadas[0]?.init.method).toBe('GET');
    expect(chamadas[0]?.url).not.toContain(SEGREDO_STORAGE);
  });

  it('falha do Storage vira codigo fixo, sem segredo na mensagem', async () => {
    const http = (async () => new Response(null, { status: 500 })) as unknown as typeof fetch;
    const adaptador = new SupabaseStorageExtratos({ url: 'https://projeto.example.test', secretKey: SEGREDO_STORAGE, fetch: http });
    const err = await recusa(adaptador.ler('arquivo-2.json'));
    expect(err).toBeInstanceOf(DsrExtratoStorageFalha);
    expect(String((err as Error).message)).not.toContain(SEGREDO_STORAGE);
  });
});
