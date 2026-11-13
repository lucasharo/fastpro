// E3 (#141) | Chave de servico do leitor da versao reduzida (request-photos) fora de qualquer serializacao.
// Sem rede: fetch falso. A chave sentinela e sintetica (nunca a real). A chave continua indo no cabecalho.
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { SupabaseReducedPhotoReader } from '../src/media-gallery.js';

const SENTINELA = 'sentinela-service-key-h029-galeria-0123456789abcdef';
const URL_BASE = 'https://sentinela-projeto.supabase.example.test';
const ID = '00000000-0000-4000-8000-000000000042';

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

function fetchGravador(cabecalhos: Record<string, string>[], urls: string[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    urls.push(String(url));
    cabecalhos.push({ ...(init?.headers as Record<string, string>) });
    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;
}

describe('E3 galeria: chave de servico do leitor reduzido fora de qualquer serializacao (RISCO #141)', () => {
  it('SupabaseReducedPhotoReader nao expoe a chave em JSON, inspect, String, structuredClone nem chaves', () => {
    const leitor = new SupabaseReducedPhotoReader({ baseUrl: URL_BASE, serviceKey: SENTINELA, fetchImpl: fetchGravador([], []) });
    expect(visoes(leitor)).not.toContain(SENTINELA);
    expect(visoes({ porta: leitor })).not.toContain(SENTINELA);
    expect(visoes([leitor])).not.toContain(SENTINELA);
  });

  it('a URL da chave e a base tambem nao aparecem na serializacao do leitor', () => {
    const leitor = new SupabaseReducedPhotoReader({ baseUrl: URL_BASE, serviceKey: SENTINELA, fetchImpl: fetchGravador([], []) });
    expect(visoes(leitor)).not.toContain(URL_BASE);
  });

  it('a chave continua sendo enviada no cabecalho e a leitura so toca o bucket reduzido', async () => {
    const cabecalhos: Record<string, string>[] = [];
    const urls: string[] = [];
    const leitor = new SupabaseReducedPhotoReader({ baseUrl: URL_BASE, serviceKey: SENTINELA, fetchImpl: fetchGravador(cabecalhos, urls) });
    await expect(leitor.readReduced(ID)).resolves.toBeNull();
    expect(cabecalhos).toHaveLength(1);
    expect(cabecalhos[0]?.authorization).toBe(`Bearer ${SENTINELA}`);
    expect(cabecalhos[0]?.apikey).toBe(SENTINELA);
    expect(urls[0]).toContain('/storage/v1/object/request-photos/');
    expect(urls[0]).not.toContain('quarantine');
  });
});
