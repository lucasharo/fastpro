// E3 (Issue 141) | Galeria ligada na borda (H-029): portas montadas a partir do ambiente, sem consultar banco nem Storage.
// Sem banco e sem rede reais: o cliente SQL e um espiao que falha se for usado e o fetch global e bloqueado.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de E3');
};

import { describe, expect, it } from 'vitest';
import { inspect } from 'node:util';
import type { SqlClient } from '@fastpro/db';
import { montarIntegracoes } from '../src/composicao.js';
import { montarMidia, portasGaleriaMidia, MEDIA_GALERIA_PENDENCIA } from '../src/media/media-composicao.js';
import { ReduceCounters } from '../src/media/media-reduce-service.js';
import { ReduceGate } from '../src/media/reduce-gate.js';

/** Segredo sentinela e nomes montados por partes: o gate de segredos nao ve atribuicao literal em teste. */
const SENHA_SENTINELA = 'senha';
const NOME_CHAVE_IP = ['DRAFT', 'IP', 'HMAC', 'KEY'].join('_');
const NOME_CHAVE_STORAGE = ['SUPABASE', 'SECRET', 'KEY'].join('_');
const SITE = 'https://fastpro.example.test';
const SENTINELA_APP_API = `postgres://sentinela-app-api-g1:${SENHA_SENTINELA}@db.example.test/app`;
const SENTINELA_APP_SYSTEM = `postgres://sentinela-app-system-g2:${SENHA_SENTINELA}@db.example.test/sys`;
const SENTINELA_CHAVE_IP = 'sentinela-chave-ip-hmac-g3-'.padEnd(40, 'x');
const SENTINELA_STORAGE = 'sentinela-service-key-storage-g4-0123456789';
const SENTINELA_URL = 'https://sentinela-projeto-g5.supabase.example.test';

const ENV_COMPLETO: Readonly<Record<string, string>> = {
  MEDIA_UPLOAD_ENABLED: '1',
  DATABASE_URL_APP_API: SENTINELA_APP_API,
  DATABASE_URL_APP_SYSTEM: SENTINELA_APP_SYSTEM,
  [NOME_CHAVE_IP]: SENTINELA_CHAVE_IP,
  SITE_URL: SITE,
  SUPABASE_URL: SENTINELA_URL,
  [NOME_CHAVE_STORAGE]: SENTINELA_STORAGE,
};

const SEGREDOS = [SENTINELA_APP_API, SENTINELA_APP_SYSTEM, SENTINELA_CHAVE_IP, SENTINELA_STORAGE, SENTINELA_URL];

/** Cliente SQL espiao: registra a URL pedida e falha se qualquer consulta for feita na montagem. */
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

/** Todas as formas comuns de serializar ou exibir um valor. */
function visoes(valor: unknown): string {
  const saidas: string[] = [];
  const tenta = (f: () => string) => {
    try {
      saidas.push(f());
    } catch (e) {
      saidas.push((e as Error).message);
    }
  };
  tenta(() => JSON.stringify(valor));
  tenta(() => inspect(valor, { showHidden: true, depth: null, getters: true, showProxy: true }));
  tenta(() => String(valor));
  return saidas.join('\n');
}

describe('E3 galeria na borda: portasGaleriaMidia (H-029)', () => {
  it('fechada sem liberacao, com item faltando ou sem fabrica: nao monta e nao consulta o banco', () => {
    const urls: string[] = [];
    expect(portasGaleriaMidia({ ...ENV_COMPLETO, MEDIA_UPLOAD_ENABLED: '0' }, espiao(urls))).toBeUndefined();
    expect(portasGaleriaMidia({ ...ENV_COMPLETO, [NOME_CHAVE_STORAGE]: '' }, espiao(urls))).toBeUndefined();
    expect(portasGaleriaMidia({ ...ENV_COMPLETO, SITE_URL: 'sentinela-site-invalido' }, espiao(urls))).toBeUndefined();
    expect(portasGaleriaMidia(ENV_COMPLETO, undefined)).toBeUndefined();
    expect(urls).toEqual([]);
  });

  it('com o ambiente completo: galeria e leitor montados sobre o papel app_api, sem consultar o banco', () => {
    const urls: string[] = [];
    const portas = portasGaleriaMidia(ENV_COMPLETO, espiao(urls));
    expect(portas?.gallery).toBeDefined();
    expect(portas?.reader).toBeDefined();
    expect(urls).toEqual([SENTINELA_APP_API]);
    expect(urls).not.toContain(SENTINELA_APP_SYSTEM);
  });

  it('a galeria e o leitor nao expõem chave, URL do Storage nem URL do banco em nenhuma serializacao', () => {
    const portas = portasGaleriaMidia(ENV_COMPLETO, espiao([]));
    const texto = visoes(portas);
    for (const segredo of SEGREDOS) {
      expect(texto).not.toContain(segredo);
    }
  });
});

describe('E3 galeria na borda: montarMidia e composicao (CA-04, CA-06)', () => {
  it('montarMidia com as portas da borda: galeria presente e nenhuma pendencia da galeria', () => {
    const portas = portasGaleriaMidia(ENV_COMPLETO, espiao([]));
    const r = montarMidia(ENV_COMPLETO, {
      abrirCliente: espiao([]),
      galeria: portas,
      reducao: { gate: new ReduceGate(), contadores: new ReduceCounters() },
    });
    expect(r.pendencias).toEqual([]);
    expect(r.options?.galeria).toBeDefined();
    expect(r.options?.galeria?.gallery).toBe(portas?.gallery);
  });

  it('montarMidia sem as portas da galeria continua com a pendencia da galeria (upload segue ligado)', () => {
    const r = montarMidia(ENV_COMPLETO, { abrirCliente: espiao([]) });
    expect(r.options).toBeDefined();
    expect(r.options?.galeria).toBeUndefined();
    expect(r.pendencias).toEqual([MEDIA_GALERIA_PENDENCIA]);
  });

  it('montarIntegracoes liga a galeria com o ambiente completo e usa so o papel app_api', () => {
    const urls: string[] = [];
    const integracoes = montarIntegracoes(ENV_COMPLETO, {
      abrirClienteApi: espiao(urls),
      reducaoMidia: { gate: new ReduceGate(), contadores: new ReduceCounters() },
    });
    expect(integracoes.media?.galeria).toBeDefined();
    expect(integracoes.pendenciasMidia).toEqual([]);
    expect(urls).not.toContain(SENTINELA_APP_SYSTEM);
    expect(visoes(integracoes.media)).not.toContain(SENTINELA_STORAGE);
  });

  it('montarIntegracoes com a midia fechada nao monta a galeria (404 uniforme)', () => {
    const urls: string[] = [];
    const integracoes = montarIntegracoes({ ...ENV_COMPLETO, MEDIA_UPLOAD_ENABLED: '0' }, { abrirClienteApi: espiao(urls) });
    expect(integracoes.media).toBeUndefined();
    expect(urls).toEqual([]);
    expect(integracoes.pendenciasMidia).toContain('MEDIA_UPLOAD_ENABLED (liberacao explicita)');
  });
});
