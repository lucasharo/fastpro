// H-020 | Testes estaticos de seguranca de conteudo (docs/factory/56-DESENHO-H020.md, §3, §6 teste 11).
// Sem banco, sem rede. Leem arquivos do repositorio. Cobrem o que existe hoje: a CSP publicada tem
// connect-src 'self' sem nenhum dominio do Mapbox; o token e o dominio do Mapbox ficam so no servidor;
// a migracao de H-020 nao cria coluna de coordenada nem identificador do provedor.
// NAO VERIFICADO aqui: CSP das paginas de pedido (ainda nao existem; ligam em H-025 e H-036).
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));
const IGNORADOS = new Set(['node_modules', 'dist', '.next', '.turbo', '.git', 'coverage']);

function arquivos(dir: string, saida: string[] = []): string[] {
  if (!existsSync(dir)) return saida;
  for (const nome of readdirSync(dir)) {
    if (IGNORADOS.has(nome)) continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivos(caminho, saida);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs|json|html)$/.test(nome)) saida.push(caminho);
  }
  return saida;
}

const rel = (p: string) => relative(RAIZ, p).replace(/\\/g, '/');

/** Entrada de /fotos: unica pagina que liga o envio direto ao Storage (decisao 149, 98-DESENHO-H029 §4, R-04). */
const ENTRADA_FOTOS = '/fotos';

/** Valor de NEXT_PUBLIC_SUPABASE_URL do ambiente ou do .env.local do repositorio (so essa variavel e lida). */
function urlPublicaSupabase(): string | null {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) return process.env.NEXT_PUBLIC_SUPABASE_URL;
  const env = join(RAIZ, '.env.local');
  if (!existsSync(env)) return null;
  const linha = readFileSync(env, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('NEXT_PUBLIC_SUPABASE_URL='));
  return linha ? linha.slice('NEXT_PUBLIC_SUPABASE_URL='.length).trim().replace(/^["']|["']$/g, '') : null;
}

/** Origem exata do Storage do projeto: https://<ref>.supabase.co, sem caminho. Sem origem, o teste falha. */
function origemStorage(): string {
  const valor = urlPublicaSupabase();
  if (!valor) throw new Error('NEXT_PUBLIC_SUPABASE_URL ausente (ambiente ou .env.local): sem a origem do Storage o teste nao roda');
  const url = new URL(valor);
  if (url.protocol !== 'https:' || !/^[a-z0-9]+\.supabase\.co$/.test(url.hostname) || url.pathname !== '/') {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL fora do formato https://<ref>.supabase.co');
  }
  return url.origin;
}

/** Tokens de uma diretiva da CSP (ex.: connect-src), ou null quando a diretiva nao existe. */
function tokensDiretiva(csp: string, nome: string): string[] | null {
  const diretiva = csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.split(/\s+/)[0] === nome);
  return diretiva === undefined ? null : diretiva.split(/\s+/).slice(1);
}

describe('T-H020-11a CSP publicada: connect-src somente self, sem Mapbox (CA-14, §2.4)', () => {
  it('connect-src e self em todas as entradas; so /fotos acrescenta a origem exata do Storage (decisao 149)', () => {
    const cfg = JSON.parse(readFileSync(join(RAIZ, 'apps/web/vercel.json'), 'utf8')) as {
      headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    };
    const origem = origemStorage();
    const csps = cfg.headers.flatMap((bloco) =>
      bloco.headers
        .filter((h) => h.key === 'Content-Security-Policy')
        .map((h) => ({ source: bloco.source, csp: h.value })),
    );
    expect(csps.length).toBeGreaterThan(0);
    expect(csps.filter((c) => c.source === ENTRADA_FOTOS)).toHaveLength(1);
    for (const { source, csp } of csps) {
      const esperado = source === ENTRADA_FOTOS ? ["'self'", origem] : ["'self'"];
      expect(tokensDiretiva(csp, 'connect-src'), source).toEqual(esperado);
      expect(csp.toLowerCase(), source).not.toContain('mapbox');
    }
  });
});

describe('T-H020-11b token e dominio do Mapbox so no servidor (CA-14, §2.4)', () => {
  it('nenhum fonte de web, admin, mobile ou ui le o token de servidor nem o token publico', () => {
    const cliente = ['apps/web', 'apps/admin', 'apps/mobile', 'packages/ui'];
    const proibidos = ['MAPBOX_ACCESS_TOKEN', 'NEXT_PUBLIC_MAPBOX_PUBLIC_TOKEN'];
    const achados: string[] = [];
    for (const pasta of cliente) {
      for (const f of arquivos(join(RAIZ, pasta))) {
        const txt = readFileSync(f, 'utf8');
        for (const p of proibidos) if (txt.includes(p)) achados.push(`${rel(f)}: ${p}`);
      }
    }
    expect(achados).toEqual([]);
  });

  // H-021 (docs/factory/68-DESENHO-H021.md §4) acrescentou o adaptador permanente, tambem so de servidor.
  it('api.mapbox.com aparece somente nos adaptadores do servidor', () => {
    const achados: string[] = [];
    for (const pasta of ['apps', 'packages']) {
      for (const f of arquivos(join(RAIZ, pasta))) {
        if (rel(f).includes('/tests/')) continue;
        if (readFileSync(f, 'utf8').includes('api.mapbox.com')) achados.push(rel(f));
      }
    }
    expect(achados).toEqual([
      'apps/api/src/geo/mapbox-permanent-adapter.ts',
      'apps/api/src/geo/mapbox-temp-adapter.ts',
    ]);
  });
});

describe('T-H020-11c migracao de H-020 sem coordenada nem identificador (CA-03, §3)', () => {
  it('a migracao e o rollback nao mencionam colunas de coordenada, ponto ou identificador do provedor', () => {
    const proibidos = /\b(lat|lon|latitude|longitude|point|geom|mapbox_id|feature_id)\b/i;
    for (const f of [
      'supabase/migrations/20261111260000_geo_create_mapbox_temp_quota.sql',
      'supabase/rollbacks/20261111260000_geo_create_mapbox_temp_quota.down.sql',
    ]) {
      const txt = readFileSync(join(RAIZ, f), 'utf8');
      expect(txt.match(proibidos), f).toBeNull();
    }
  });
});
