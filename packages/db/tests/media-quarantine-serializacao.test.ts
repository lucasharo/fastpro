// E3 (#141) | Chave de servico dos adaptadores de Storage da midia nao aparece em nenhuma serializacao.
// Sem rede: fetch falso. A chave sentinela e sintetica (nunca a real). A chave continua sendo enviada no cabecalho.
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { SupabaseMediaReduceStorage, SupabaseQuarantineStorage } from '../src/media-quarantine.js';

const SENTINELA = 'sentinela-service-key-db-s9-0123456789abcdef';
const URL_BASE = 'https://sentinela-projeto.supabase.example.test';

/** Todas as formas comuns de serializar ou exibir um valor. Erros de serializacao tambem entram (mensagem). */
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

function fetchGravador(cabecalhos: Record<string, string>[]): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    cabecalhos.push({ ...(init?.headers as Record<string, string>) });
    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;
}

describe('E3 Storage da midia: chave de servico fora de qualquer serializacao (RISCO #141)', () => {
  it('SupabaseQuarantineStorage nao expoe a chave em JSON, inspect, String, structuredClone nem chaves', () => {
    const adaptador = new SupabaseQuarantineStorage({ baseUrl: URL_BASE, serviceKey: SENTINELA, fetchImpl: fetchGravador([]) });
    expect(visoes(adaptador)).not.toContain(SENTINELA);
    expect(visoes({ porta: adaptador })).not.toContain(SENTINELA);
  });

  it('SupabaseMediaReduceStorage nao expoe a chave em nenhuma serializacao', () => {
    const adaptador = new SupabaseMediaReduceStorage({ baseUrl: URL_BASE, serviceKey: SENTINELA, fetchImpl: fetchGravador([]) });
    expect(visoes(adaptador)).not.toContain(SENTINELA);
    expect(visoes({ porta: adaptador })).not.toContain(SENTINELA);
  });

  it('a chave continua sendo enviada no cabecalho de autorizacao (o uso nao mudou)', async () => {
    const cabecalhos: Record<string, string>[] = [];
    const quarentena = new SupabaseQuarantineStorage({ baseUrl: URL_BASE, serviceKey: SENTINELA, fetchImpl: fetchGravador(cabecalhos) });
    const reducao = new SupabaseMediaReduceStorage({ baseUrl: URL_BASE, serviceKey: SENTINELA, fetchImpl: fetchGravador(cabecalhos) });
    const id = '00000000-0000-4000-8000-000000000001';
    await expect(quarentena.stat(`d/${id}`)).resolves.toBeNull();
    await expect(reducao.statReduced(id)).resolves.toBeNull();
    expect(cabecalhos).toHaveLength(2);
    for (const c of cabecalhos) {
      expect(c.authorization).toBe(`Bearer ${SENTINELA}`);
      expect(c.apikey).toBe(SENTINELA);
    }
  });
});
