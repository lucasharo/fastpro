// Web FastPro (Next.js). Em desenvolvimento local, carrega o .env.local da raiz do monorepo (a API le dele).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const envRaiz = fileURLToPath(new URL('../../.env.local', import.meta.url));
if (process.env.VERCEL !== '1') {
  if (existsSync(envRaiz)) process.loadEnvFile(envRaiz);
  if (process.env.APP_ENV === 'production') throw new Error('APP_ENV indica producao: o ambiente local recusa');
  // Local: a API so aceita mutacoes vindas da propria origem (SITE_URL). Porta padrao 3000; DEV_SITE_URL troca.
  const origem = process.env.DEV_SITE_URL ?? 'http://localhost:3000';
  process.env.SITE_URL = origem;
  process.env.APP_BASE_URL ??= origem;
  delete process.env.VERCEL_ENV;
}

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['sharp', 'pg'],
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'images.unsplash.com' }],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default config;
