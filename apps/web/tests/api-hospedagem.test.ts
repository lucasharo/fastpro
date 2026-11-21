// Issue 158 (desenho 182, S3 e CA-158-01/02) | Hospedagem da API no projeto fastpro-web (somente preview).
// Confere a configuracao versionada, o reexporte da funcao e o handler pela entrada publica (@fastpro/api/vercel),
// sem rede e sem banco. Nao le .env.local e nao usa segredo: as variaveis de banco sao removidas durante o teste.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

interface Redirecionamento {
  source: string;
  destination: string;
}
interface ConfiguracaoWeb {
  framework?: string | null;
  regions?: string[];
  buildCommand?: string;
  outputDirectory?: string;
  functions?: Record<string, { maxDuration?: number }>;
  headers: { source: string }[];
  redirects?: Redirecionamento[];
}

const raizWeb = new URL('../', import.meta.url);
const raizRepo = new URL('../../../', import.meta.url);
const lerTexto = (url: URL): string => readFileSync(url, 'utf8');

const vercel: ConfiguracaoWeb = JSON.parse(lerTexto(new URL('vercel.json', raizWeb)));
const pacoteApi = JSON.parse(lerTexto(new URL('apps/api/package.json', raizRepo)));
const pacoteWeb = JSON.parse(lerTexto(new URL('package.json', raizWeb)));

/** Casa o padrao "api/**\/*.ts" do vercel.json: prefixo api/ e sufixo .ts (qualquer caminho entre eles). */
function casaFuncaoApi(caminho: string): boolean {
  return caminho.startsWith('api/') && caminho.endsWith('.ts');
}

describe('vercel.json da web: hospedagem da API (CA-158-02; desenho 182 D-3)', () => {
  it('regions e gru1, igual a API', () => {
    expect(vercel.regions).toEqual(['gru1']);
  });

  it('framework nulo e saida estatica em public', () => {
    expect(vercel.framework).toBeNull();
    expect(vercel.outputDirectory).toBe('public');
  });

  it('buildCommand constroi a web e as dependencias pelo turbo', () => {
    expect(vercel.buildCommand).toContain('turbo run build --filter=@fastpro/web...');
  });

  it('funcoes api/**/*.ts com maxDuration 300', () => {
    expect(vercel.functions?.['api/**/*.ts']?.maxDuration).toBe(300);
  });

  it('mantem os cabecalhos e os redirecionamentos existentes', () => {
    expect(vercel.headers.some((h) => h.source === '/entrar')).toBe(true);
    expect(vercel.headers.some((h) => h.source === '/(.*)')).toBe(true);
    expect(vercel.redirects).toContainEqual({
      source: '/profissional',
      destination: '/profissional/entrar',
      permanent: false,
    });
  });
});

describe('funcao da API na web (CA-158-01; desenho 182 D-1, D-2, D-5)', () => {
  const caminhoFuncao = 'api/[...caminho].ts';

  it('o padrao api/**/*.ts casa o arquivo do catch-all, e o arquivo existe', () => {
    expect(casaFuncaoApi(caminhoFuncao)).toBe(true);
    expect(existsSync(fileURLToPath(new URL(caminhoFuncao, raizWeb)))).toBe(true);
  });

  it('o arquivo so reexporta o handler publico de @fastpro/api/vercel', () => {
    const codigo = lerTexto(new URL(caminhoFuncao, raizWeb))
      .split('\n')
      .filter((linha) => linha.trim() !== '' && !linha.trim().startsWith('//'))
      .map((linha) => linha.trim());
    expect(codigo).toEqual(["export { default } from '@fastpro/api/vercel';"]);
  });

  it('@fastpro/api expoe a entrada ./vercel apontando para o build', () => {
    expect(pacoteApi.exports['./vercel']).toEqual({
      types: './dist/vercel.d.ts',
      default: './dist/vercel.js',
    });
  });

  it('a web depende de @fastpro/api como workspace', () => {
    expect(pacoteWeb.devDependencies['@fastpro/api']).toBe('workspace:*');
  });

  it('o typecheck da web tambem checa a pasta api', () => {
    expect(pacoteWeb.scripts.typecheck).toContain('tsconfig.funcoes.json');
  });
});

describe('.vercelignore na raiz (desenho 182 D-6)', () => {
  const linhas = lerTexto(new URL('.vercelignore', raizRepo))
    .split('\n')
    .map((linha) => linha.trim());

  it('ignora os arquivos de ambiente e segredo', () => {
    expect(linhas).toContain('.env*');
  });

  it('nao ignora o codigo do monorepo', () => {
    for (const pasta of ['apps', 'packages', 'scripts']) {
      expect(linhas).not.toContain(pasta);
    }
  });
});

describe('handler pela entrada publica (sem variaveis de banco, sem rede)', () => {
  let servidor: Server;
  let base = '';
  const variaveisSalvas: Record<string, string | undefined> = {};

  beforeAll(async () => {
    // Remove qualquer variavel de banco ou segredo do ambiente do teste: a rota de busca fica fechada (404).
    for (const chave of Object.keys(process.env)) {
      if (chave.startsWith('DATABASE_URL') || chave === 'CATALOG_RATE_HMAC_KEY' || chave === 'SITE_URL' || chave === 'JOBS_TICK_SECRET') {
        variaveisSalvas[chave] = process.env[chave];
        delete process.env[chave];
      }
    }
    const { default: handler } = await import('@fastpro/api/vercel');
    servidor = createServer((req, res) => {
      void handler(req, res);
    });
    await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
    const porta = (servidor.address() as AddressInfo).port;
    base = `http://127.0.0.1:${porta}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
    for (const [chave, valor] of Object.entries(variaveisSalvas)) {
      if (valor !== undefined) process.env[chave] = valor;
    }
  });

  it('GET /api/health responde 200', async () => {
    const resposta = await fetch(`${base}/api/health`);
    expect(resposta.status).toBe(200);
  });

  it('POST /api/v1/catalog/service-search sem variaveis responde 404 (rota fechada, nenhum banco acessado)', async () => {
    const resposta = await fetch(`${base}/api/v1/catalog/service-search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: 'eletri' }),
    });
    expect(resposta.status).toBe(404);
  });
});
