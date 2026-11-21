// Testes do servidor local DEV (Issue #156, F5). Pasta temporaria; porta 0; nenhum .env.local real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { criarServidor, faltantes, OBRIGATORIOS, resolverArquivo } from '../dev-local.mjs';

function preparar() {
  const raiz = mkdtempSync(join(tmpdir(), 'fp-devlocal-'));
  const web = join(raiz, 'public');
  mkdirSync(join(web, 'pedido'), { recursive: true });
  writeFileSync(join(web, 'index.html'), 'INICIO');
  writeFileSync(join(web, 'pedido.html'), 'PEDIDO-ARQUIVO');
  writeFileSync(join(web, 'pedido', 'index.html'), 'PEDIDO-PASTA');
  writeFileSync(join(raiz, '.env.local'), 'SEGREDO-FORA-DO-PUBLICO');
  return { raiz, web };
}

function get(porta, caminho) {
  return new Promise((resolver, rejeitar) => {
    const req = http.get({ host: '127.0.0.1', port: porta, path: caminho }, (res) => {
      let corpo = '';
      res.on('data', (parte) => {
        corpo += parte;
      });
      res.on('end', () => resolver({ status: res.statusCode, corpo }));
    });
    req.on('error', rejeitar);
  });
}

test('resolverArquivo segue cleanUrls (arquivo, depois .html, depois pasta/index.html) e bloqueia ".."', () => {
  const { raiz, web } = preparar();
  try {
    assert.equal(resolverArquivo(web, '/'), join(web, 'index.html'));
    assert.equal(resolverArquivo(web, '/pedido'), join(web, 'pedido.html'));
    assert.equal(resolverArquivo(web, '/nao-existe'), null);
    assert.equal(resolverArquivo(web, '/../.env.local'), null);
    assert.equal(resolverArquivo(web, '/%2e%2e/.env.local'), null);
    assert.equal(resolverArquivo(web, '/pedido\\..\\..\\.env.local'), null);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('faltantes lista so os nomes que nao estao preenchidos', () => {
  assert.deepEqual(faltantes({}), OBRIGATORIOS);
  assert.deepEqual(faltantes(Object.fromEntries(OBRIGATORIOS.map((n) => [n, 'x']))), []);
});

test('servidor: /api vai ao handler; arquivos estaticos seguem cleanUrls; ".." nao sai da pasta publica', async () => {
  const { raiz, web } = preparar();
  let chamadasApi = 0;
  const servidor = criarServidor({
    raizWeb: web,
    handlerApi: async (req, res) => {
      chamadasApi += 1;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`api:${req.url}`);
    },
  });
  await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver));
  const porta = servidor.address().port;
  try {
    const api = await get(porta, '/api/v1/catalog/service-search');
    assert.equal(api.status, 200);
    assert.equal(api.corpo, 'api:/api/v1/catalog/service-search');
    assert.equal((await get(porta, '/pedido')).corpo, 'PEDIDO-ARQUIVO');
    assert.equal((await get(porta, '/')).corpo, 'INICIO');
    const fora = await get(porta, '/../.env.local');
    assert.equal(fora.status, 404);
    assert.equal(fora.corpo.includes('SEGREDO-FORA-DO-PUBLICO'), false);
    assert.equal(chamadasApi, 1);
  } finally {
    await new Promise((resolver) => servidor.close(resolver));
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('sem uma variavel obrigatoria, o dev sai com codigo 2, mostra so o nome e nao abre porta', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'fp-devlocal-env-'));
  try {
    const arquivo = join(raiz, 'ambiente-de-teste.env');
    const linhas = OBRIGATORIOS.filter((n) => n !== 'DATABASE_URL_APP_API').map((n) => `${n}=valor-sintetico-${n.length}`);
    writeFileSync(arquivo, linhas.join('\n') + '\n');
    const env = { ...process.env, DEV_ENV_FILE: arquivo };
    for (const n of OBRIGATORIOS) delete env[n];
    const script = fileURLToPath(new URL('../dev-local.mjs', import.meta.url));
    const r = spawnSync(process.execPath, [script], { env, encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 2);
    assert.match(r.stdout, /DATABASE_URL_APP_API/);
    assert.equal(r.stdout.includes('API e web'), false);
    assert.equal(r.stdout.includes('valor-sintetico'), false);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
