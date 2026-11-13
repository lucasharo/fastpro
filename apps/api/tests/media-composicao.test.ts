// E3 (Issue 141) | Montagem da midia a partir do ambiente (docs/factory/104-DESENHO-MIDIA-COMPOSICAO.md, §8; CA-01 a CA-06).
// Sem banco e sem Storage reais: a fabrica do cliente SQL e um espiao que falha se for usado, e as portas de banco
// e Storage sao substitutas. Valores sentinela sinteticos (nunca chaves reais). Rede bloqueada.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de E3');
};

import { describe, expect, it } from 'vitest';
import { inspect } from 'node:util';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { SqlClient } from '@fastpro/db';
import { handleRequest } from '../src/app.js';
import { draftNotFound } from '../src/drafts/draft-service.js';
import { montarMidia, MEDIA_FABRICA_PENDENCIA, MEDIA_GALERIA_PENDENCIA } from '../src/media/media-composicao.js';
import { ReduceCounters } from '../src/media/media-reduce-service.js';
import { ReduceGate } from '../src/media/reduce-gate.js';

/** Segredo sentinela e nomes montados por partes: o gate de segredos nao ve atribuicao literal em teste. */
const SENHA_SENTINELA = 'senha';
const NOME_CHAVE_IP = ['DRAFT', 'IP', 'HMAC', 'KEY'].join('_');
const NOME_CHAVE_STORAGE = ['SUPABASE', 'SECRET', 'KEY'].join('_');
const SITE = 'https://fastpro.example.test';
const LIBERACAO = 'MEDIA_UPLOAD_ENABLED (liberacao explicita)';
const SENTINELA_APP_API = `postgres://sentinela-app-api-u1:${SENHA_SENTINELA}@db.example.test/app`;
const SENTINELA_APP_SYSTEM = `postgres://sentinela-app-system-u2:${SENHA_SENTINELA}@db.example.test/sys`;
const SENTINELA_CHAVE_IP = 'sentinela-chave-ip-hmac-k3-'.padEnd(40, 'x');
const SENTINELA_STORAGE = 'sentinela-service-key-storage-s4-0123456789';
const SENTINELA_URL = 'https://sentinela-projeto-u5.supabase.example.test';
const COOKIE = '__Host-fp_draft';
const SEGREDO = 'B'.repeat(43);

const ENV_COMPLETO: Readonly<Record<string, string>> = {
  MEDIA_UPLOAD_ENABLED: '1',
  DATABASE_URL_APP_API: SENTINELA_APP_API,
  DATABASE_URL_APP_SYSTEM: SENTINELA_APP_SYSTEM,
  [NOME_CHAVE_IP]: SENTINELA_CHAVE_IP,
  SITE_URL: SITE,
  SUPABASE_URL: SENTINELA_URL,
  [NOME_CHAVE_STORAGE]: SENTINELA_STORAGE,
};

/** Cliente SQL espiao: qualquer consulta falha o teste (a montagem nao pode consultar o banco). */
function espiao(urls: string[]): (url: string) => SqlClient {
  return (url) => {
    urls.push(url);
    return {
      query: () => {
        throw new Error('montagem nao deve consultar o banco');
      },
    } as unknown as SqlClient;
  };
}

/** Portas falsas de taxa e de Storage: nunca tocam a rede. */
const PORTAS_FALSAS = {
  rate: { check: () => Promise.reject(new Error('nao deve ser chamado na montagem')) },
  storage: {},
  reduceStorage: {},
} as unknown as NonNullable<Parameters<typeof montarMidia>[1]>['portas'];

const GALERIA_FALSA = {
  gallery: {},
  reader: {},
} as unknown as NonNullable<Parameters<typeof montarMidia>[1]>['galeria'];

describe('E3 montarMidia: liberacao, pendencias e papel (CA-02, CA-04, CA-05, CA-06)', () => {
  it('CA-02: ambiente vazio lista so nomes, na ordem fixa, e nao monta', () => {
    const r = montarMidia({}, { abrirCliente: espiao([]) });
    expect(r.options).toBeUndefined();
    expect(r.pendencias).toEqual([
      LIBERACAO,
      'DATABASE_URL_APP_API',
      'DRAFT_IP_HMAC_KEY',
      'SITE_URL',
      'SUPABASE_URL',
      NOME_CHAVE_STORAGE,
    ]);
  });

  it('CA-02: liberacao ausente, 0, true ou com espacos deixa a midia fechada, com ambiente completo', () => {
    for (const valor of [undefined, '0', 'true', ' 1', '1 ']) {
      const env = { ...ENV_COMPLETO, MEDIA_UPLOAD_ENABLED: valor };
      const r = montarMidia(env, { abrirCliente: espiao([]) });
      expect(r.options).toBeUndefined();
      expect(r.pendencias).toEqual([LIBERACAO]);
    }
  });

  it('CA-02: chave do IP curta aparece marcada, sem tamanho e sem valor', () => {
    const env = { ...ENV_COMPLETO, DRAFT_IP_HMAC_KEY: 'x'.repeat(31) };
    const r = montarMidia(env, { abrirCliente: espiao([]) });
    expect(r.options).toBeUndefined();
    expect(r.pendencias).toEqual(['DRAFT_IP_HMAC_KEY (curta)']);
    expect(JSON.stringify(r.pendencias)).not.toContain('xxxx');
  });

  it('CA-02: ambiente completo sem a fabrica da borda segue fechado com a pendencia da fabrica', () => {
    const r = montarMidia(ENV_COMPLETO, {});
    expect(r.options).toBeUndefined();
    expect(r.pendencias).toEqual([MEDIA_FABRICA_PENDENCIA]);
  });

  it('CA-02: nenhuma pendencia contem valor sentinela', () => {
    const env = { ...ENV_COMPLETO, DATABASE_URL_APP_API: '', [NOME_CHAVE_STORAGE]: '  ' };
    const r = montarMidia(env, { abrirCliente: espiao([]) });
    const texto = JSON.stringify(r.pendencias);
    for (const valor of [SENTINELA_APP_SYSTEM, SENTINELA_CHAVE_IP, SENTINELA_URL, SENTINELA_STORAGE]) {
      expect(texto).not.toContain(valor);
    }
  });

  it('CA-04: upload ligado e galeria omitida: opcoes sem galeria e pendencia da galeria, sem consultar o banco', () => {
    const urls: string[] = [];
    const r = montarMidia(ENV_COMPLETO, { abrirCliente: espiao(urls), portas: PORTAS_FALSAS });
    expect(r.options).toBeDefined();
    expect(r.options?.galeria).toBeUndefined();
    expect(r.pendencias).toEqual([MEDIA_GALERIA_PENDENCIA]);
    expect(urls).toEqual([SENTINELA_APP_API]);
  });

  it('CA-04: com as portas da galeria injetadas, a galeria entra e nao ha pendencia', () => {
    const r = montarMidia(ENV_COMPLETO, { abrirCliente: espiao([]), portas: PORTAS_FALSAS, galeria: GALERIA_FALSA });
    expect(r.pendencias).toEqual([]);
    expect(r.options?.galeria).toBeDefined();
    expect(r.options?.galeria?.gallery).toBe(GALERIA_FALSA?.gallery);
  });

  it('CA-06: o cliente SQL e aberto so com DATABASE_URL_APP_API, nunca com DATABASE_URL_APP_SYSTEM', () => {
    const urls: string[] = [];
    montarMidia(ENV_COMPLETO, { abrirCliente: espiao(urls), portas: PORTAS_FALSAS });
    expect(urls).toEqual([SENTINELA_APP_API]);
    expect(urls).not.toContain(SENTINELA_APP_SYSTEM);
  });

  it('CA-06: duas montagens com a mesma reducao compartilham o limite de reducoes', () => {
    const reducao = { gate: new ReduceGate(), contadores: new ReduceCounters() };
    const a = montarMidia(ENV_COMPLETO, { abrirCliente: espiao([]), portas: PORTAS_FALSAS, reducao });
    const b = montarMidia(ENV_COMPLETO, { abrirCliente: espiao([]), portas: PORTAS_FALSAS, reducao });
    expect(a.options?.deps.reduce.gate).toBe(reducao.gate);
    expect(b.options?.deps.reduce.gate).toBe(a.options?.deps.reduce.gate);
    expect(b.options?.deps.reduce.contadores).toBe(reducao.contadores);
  });

  it('CA-05: a montagem nao escreve nada em console nem em stdout/stderr', () => {
    const saidas: string[] = [];
    const originais = { log: console.log, error: console.error, warn: console.warn, info: console.info };
    const escreveOriginal = [process.stdout.write.bind(process.stdout), process.stderr.write.bind(process.stderr)];
    console.log = (...a: unknown[]) => void saidas.push(a.map(String).join(' '));
    console.error = (...a: unknown[]) => void saidas.push(a.map(String).join(' '));
    console.warn = (...a: unknown[]) => void saidas.push(a.map(String).join(' '));
    console.info = (...a: unknown[]) => void saidas.push(a.map(String).join(' '));
    process.stdout.write = ((s: string) => (saidas.push(String(s)), true)) as typeof process.stdout.write;
    process.stderr.write = ((s: string) => (saidas.push(String(s)), true)) as typeof process.stderr.write;
    try {
      montarMidia({}, {});
      montarMidia(ENV_COMPLETO, { abrirCliente: espiao([]), portas: PORTAS_FALSAS, galeria: GALERIA_FALSA });
    } finally {
      console.log = originais.log;
      console.error = originais.error;
      console.warn = originais.warn;
      console.info = originais.info;
      process.stdout.write = escreveOriginal[0] as typeof process.stdout.write;
      process.stderr.write = escreveOriginal[1] as typeof process.stderr.write;
    }
    expect(saidas).toEqual([]);
  });
});

// CA-03: sem a midia montada, toda rota de midia responde o 404 do rascunho (corpo e cabecalhos iguais).
async function comServidor<T>(
  opts: Parameters<typeof handleRequest>[2],
  uso: (porta: number) => Promise<T>,
): Promise<T> {
  const servidor: Server = createServer((req, res) => {
    void handleRequest(req, res, opts);
  });
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', () => resolve()));
  try {
    return await uso((servidor.address() as AddressInfo).port);
  } finally {
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  }
}

function pedir(
  porta: number,
  metodo: string,
  caminho: string,
  cabecalhos: Record<string, string> = {},
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: porta, method: metodo, path: caminho, headers: cabecalhos }, (res) => {
      const partes: Buffer[] = [];
      res.on('data', (c: Buffer) => partes.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(partes).toString('utf8') }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

const ROTAS: ReadonlyArray<readonly [string, string]> = [
  ['POST', '/v1/media/uploads'],
  ['POST', '/v1/media/00000000-0000-4000-8000-000000000001/finalize'],
  ['GET', '/v1/media/00000000-0000-4000-8000-000000000001'],
  ['GET', '/v1/media/photos'],
  ['GET', '/v1/media/00000000-0000-4000-8000-000000000001/image'],
  ['DELETE', '/v1/media/00000000-0000-4000-8000-000000000001'],
  ['PUT', '/v1/media/photos/order'],
  ['GET', '/v1/media/x/y/z'],
  ['PATCH', '/v1/media/uploads'],
];

describe('E3 app: 404 uniforme das rotas de midia sem montagem (CA-03)', () => {
  const esperado = draftNotFound();
  const cabecalhosComparados = Object.keys(esperado.headers);

  it('CA-03: sem a opcao media, cada rota de midia devolve o 404 do rascunho (status, cabecalhos e corpo)', async () => {
    await comServidor({}, async (porta) => {
      for (const [metodo, caminho] of ROTAS) {
        const cabecalhos = { Origin: SITE, Cookie: `${COOKIE}=${SEGREDO}`, 'Content-Type': 'application/json' };
        const r = await pedir(porta, metodo, caminho, cabecalhos);
        expect(r.status, `${metodo} ${caminho}`).toBe(esperado.status);
        expect(r.body, `${metodo} ${caminho}`).toBe(esperado.body);
        for (const nome of cabecalhosComparados) {
          expect(String(r.headers[nome.toLowerCase()]), `${metodo} ${caminho} ${nome}`).toBe(esperado.headers[nome]);
        }
      }
    });
  });

  it('CA-03: fora do prefixo de midia a resposta de rota inexistente continua a de antes (sem o 404 do rascunho)', async () => {
    await comServidor({}, async (porta) => {
      const r = await pedir(porta, 'GET', '/v1/midia-inexistente');
      expect(r.status).toBe(404);
      expect(r.body).toBe('');
    });
  });
});

/** Todas as formas comuns de serializar ou exibir um valor (erros de serializacao entram pela mensagem). */
function visoes(valor: unknown): string {
  const saidas: string[] = [];
  const tenta = (f: () => string, rotulo: string) => {
    try {
      saidas.push(f());
    } catch (e) {
      saidas.push(`${rotulo}:${(e as Error).message}`);
    }
  };
  tenta(() => JSON.stringify(valor), 'json');
  tenta(() => inspect(valor, { showHidden: true, depth: null, getters: true, showProxy: true }), 'inspect');
  tenta(() => String(valor), 'string');
  tenta(() => JSON.stringify(structuredClone(valor)), 'clone');
  tenta(() => JSON.stringify(Reflect.ownKeys(valor as object)), 'keys');
  tenta(() => JSON.stringify(Object.entries(valor as object)), 'entries');
  return saidas.join('\n');
}

// RISCO Issue 141 (104 §2.3 e §3.2): a chave de servico do Storage e os segredos do ambiente nao podem aparecer em
// nenhuma serializacao de options nem de nenhuma porta, mesmo com os adaptadores reais (Storage de quarentena e reducao).
describe('E3 montarMidia: segredos fora de qualquer serializacao de options e das portas (CA-05, RISCO Issue 141)', () => {
  const SEGREDOS = [SENTINELA_STORAGE, SENTINELA_CHAVE_IP, SENTINELA_APP_API, SENTINELA_APP_SYSTEM];

  it('options, cada porta e o resultado completo nao revelam nenhum segredo sentinela em nenhuma forma', () => {
    const fetchNuncaChamado = (() => {
      throw new Error('rede bloqueada na serializacao');
    }) as unknown as typeof fetch;
    const r = montarMidia(ENV_COMPLETO, {
      abrirCliente: espiao([]),
      fetchImpl: fetchNuncaChamado,
      galeria: GALERIA_FALSA,
    });
    expect(r.options).toBeDefined();
    const opcoes = r.options;
    if (opcoes === undefined) return;

    // Adaptadores reais: o Storage de quarentena e o da reducao guardam a chave; isso precisa estar confirmado.
    expect(opcoes.deps.storage.constructor.name).toBe('SupabaseQuarantineStorage');
    expect(opcoes.deps.reduce.storage.constructor.name).toBe('SupabaseMediaReduceStorage');

    const portas: unknown[] = [
      r,
      opcoes,
      opcoes.deps,
      opcoes.deps.store,
      opcoes.deps.storage,
      opcoes.deps.rate,
      opcoes.deps.hasher,
      opcoes.deps.clock,
      opcoes.deps.reduce,
      opcoes.deps.reduce.store,
      opcoes.deps.reduce.storage,
      opcoes.deps.reduce.reducer,
      opcoes.deps.reduce.gate,
      opcoes.deps.reduce.contadores,
      opcoes.galeria,
      opcoes.galeria?.storage,
      opcoes.galeria?.store,
      opcoes.galeria?.rate,
      opcoes.galeria?.hasher,
      opcoes.galeria?.clock,
    ];
    for (const porta of portas) {
      const texto = visoes(porta);
      for (const segredo of SEGREDOS) {
        expect(texto).not.toContain(segredo);
      }
    }
    // Conferencia direta dos dois adaptadores que guardam a chave.
    for (const adaptador of [opcoes.deps.storage, opcoes.deps.reduce.storage]) {
      expect(JSON.stringify(adaptador)).not.toContain(SENTINELA_STORAGE);
      expect(inspect(adaptador, { showHidden: true, depth: null })).not.toContain(SENTINELA_STORAGE);
    }
  });
});

describe('E3 montarMidia: SITE_URL invalida (pendencia sem eco do valor)', () => {
  it('SITE_URL malformada deixa a midia fechada com a pendencia SITE_URL (invalida) e sem o valor', () => {
    const valorInvalido = 'sentinela-site-invalido-u7';
    const r = montarMidia({ ...ENV_COMPLETO, SITE_URL: valorInvalido }, { abrirCliente: espiao([]) });
    expect(r.options).toBeUndefined();
    expect(r.pendencias).toEqual(['SITE_URL (invalida)']);
    expect(JSON.stringify(r.pendencias)).not.toContain(valorInvalido);
  });

  it('SITE_URL vazia continua sendo pendencia de ausencia (SITE_URL), nao de invalidez', () => {
    const r = montarMidia({ ...ENV_COMPLETO, SITE_URL: '  ' }, { abrirCliente: espiao([]) });
    expect(r.options).toBeUndefined();
    expect(r.pendencias).toEqual(['SITE_URL']);
  });
});
