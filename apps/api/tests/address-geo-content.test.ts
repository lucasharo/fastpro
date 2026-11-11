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

describe('T-H020-11a CSP publicada: connect-src somente self, sem Mapbox (CA-14, §2.4)', () => {
  it('todas as CSP de apps/web/vercel.json tem connect-src self e nenhum dominio Mapbox', () => {
    const cfg = JSON.parse(readFileSync(join(RAIZ, 'apps/web/vercel.json'), 'utf8')) as {
      headers: Array<{ headers: Array<{ key: string; value: string }> }>;
    };
    const csps = cfg.headers
      .flatMap((h) => h.headers)
      .filter((h) => h.key === 'Content-Security-Policy')
      .map((h) => h.value);
    expect(csps.length).toBeGreaterThan(0);
    for (const csp of csps) {
      expect(csp).toMatch(/connect-src 'self'(;|$)/);
      expect(csp.toLowerCase()).not.toContain('mapbox');
    }
  });
});

describe('T-H020-11b token e dominio do Mapbox so no servidor (CA-14, §2.4)', () => {
  it('nenhum fonte de web, admin, mobile ou ui le o token de servidor nem o token publico', () => {
    const cliente = ['apps/web', 'apps/admin', 'apps/mobile', 'packages/ui'];
    const proibidos = ['MAPBOX_ACCESS_TOKEN_SERVER', 'NEXT_PUBLIC_MAPBOX_PUBLIC_TOKEN'];
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
