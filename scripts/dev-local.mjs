// Servidor local DEV (Issue #156, desenho 177 §6, D-1 e D-2). Uma so origem: http://127.0.0.1:<DEV_PORT|3000>.
// /api/* vai ao mesmo handler da Vercel (apps/api/dist/vercel.js); o resto serve apps/web/public (como a hospedagem).
// SITE_URL e sobreposta SO no processo (o .env.local nao muda). Nao grava arquivo, nao envia e-mail, nao imprime valor.
// Uso: corepack pnpm dev (o predev compila antes). DEV_ENV_FILE aponta outro arquivo de ambiente (so para testes).
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));
const WEB_PUBLIC = join(RAIZ, 'apps', 'web', 'public');
const API_DIST = join(RAIZ, 'apps', 'api', 'dist', 'vercel.js');
const ENV_FILE_PADRAO = join(RAIZ, '.env.local');
/** Nomes que o ambiente local exige (SITE_URL entra como sobreposicao no processo, por isso nao consta). */
export const OBRIGATORIOS = [
  'DATABASE_URL_APP_API',
  'DATABASE_URL_APP_SYSTEM',
  'CATALOG_RATE_HMAC_KEY',
  'PEPPER_EMAIL_HMAC',
  'PEPPER_CODE_HMAC',
  'PEPPER_IP_HMAC',
  'SESSION_COOKIE_SECRET',
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'APP_ENV',
];

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
};

/** Nomes ausentes ou vazios (so os nomes; nunca os valores). */
export function faltantes(env) {
  return OBRIGATORIOS.filter((nome) => !env[nome]);
}

/**
 * Resolve o caminho pedido dentro de raizWeb, com a mesma regra de cleanUrls: arquivo exato, depois <nome>.html,
 * depois <pasta>/index.html. Bloqueia ".." e barras invertidas. Devolve null quando nao existe.
 */
export function resolverArquivo(raizWeb, caminhoUrl) {
  let caminho;
  try {
    caminho = decodeURIComponent(caminhoUrl);
  } catch {
    return null;
  }
  if (caminho.includes('\0') || caminho.includes('\\') || caminho.split('/').includes('..')) return null;
  const rel = caminho.replace(/^\/+/, '').replace(/\/+$/, '');
  const candidatos = rel === '' ? ['index.html'] : [rel, `${rel}.html`, `${rel}/index.html`];
  const base = resolve(raizWeb);
  for (const c of candidatos) {
    const alvo = resolve(base, ...c.split('/'));
    if (!alvo.startsWith(base + sep)) continue;
    if (existsSync(alvo) && statSync(alvo).isFile()) return alvo;
  }
  return null;
}

/** Servidor HTTP: /api e /api/* vao ao handler da API; o resto e arquivo estatico. */
export function criarServidor({ handlerApi, raizWeb = WEB_PUBLIC }) {
  return createServer(async (req, res) => {
    const caminho = (req.url ?? '/').split('?')[0];
    if (caminho === '/api' || caminho.startsWith('/api/')) {
      try {
        await handlerApi(req, res);
      } catch {
        if (!res.headersSent) res.writeHead(500, { 'Cache-Control': 'no-store' });
        res.end();
      }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    const arquivo = resolverArquivo(raizWeb, caminho);
    if (arquivo === null) {
      res.writeHead(404, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': TIPOS[extname(arquivo).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : readFileSync(arquivo));
  });
}

/** Sobe o ambiente. Devolve { codigo, linhas, servidor } ; codigo 2 quando nada e iniciado. */
export async function iniciar({ envFile = process.env.DEV_ENV_FILE ?? ENV_FILE_PADRAO } = {}) {
  if (!existsSync(envFile)) {
    return { codigo: 2, linhas: ['arquivo de ambiente nao existe: copie .env.example (somente nomes) para .env.local'] };
  }
  process.loadEnvFile(envFile);
  const falt = faltantes(process.env);
  if (falt.length > 0) {
    return { codigo: 2, linhas: [`variaveis obrigatorias ausentes: ${falt.join(', ')}`] };
  }
  if (process.env.APP_ENV === 'production') {
    return { codigo: 2, linhas: ['APP_ENV indica producao: o ambiente local recusa'] };
  }
  const porta = Number(process.env.DEV_PORT ?? 3000);
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
    return { codigo: 2, linhas: ['DEV_PORT invalida'] };
  }
  if (!existsSync(API_DIST)) {
    return { codigo: 2, linhas: ['API compilada ausente: rode corepack pnpm dev (o predev compila)'] };
  }
  const origem = `http://127.0.0.1:${porta}`;
  process.env.SITE_URL = origem;
  if (!process.env.APP_BASE_URL) process.env.APP_BASE_URL = origem;
  delete process.env.VERCEL_ENV;
  const { default: handlerApi } = await import(pathToFileURL(API_DIST).href);
  const servidor = criarServidor({ handlerApi });
  await new Promise((resolver, rejeitar) => {
    servidor.once('error', rejeitar);
    servidor.listen(porta, '127.0.0.1', resolver);
  });
  return {
    codigo: 0,
    servidor,
    linhas: [`API e web em ${origem}`, 'API: /api/v1/... (mesma origem); telas: /, /pedido, /entrar e as demais de apps/web/public'],
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  iniciar().then((r) => {
    for (const linha of r.linhas) console.log(linha);
    if (r.codigo !== 0) {
      process.exitCode = r.codigo;
      return;
    }
    process.on('SIGINT', () => r.servidor.close(() => process.exit(0)));
  });
}
