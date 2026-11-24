// Console admin (Next.js). Em desenvolvimento local carrega o .env.local da raiz e usa a propria origem (porta
// 3001) como ADMIN_BASE_URL; a API roda dentro do app em /api, entao o cookie da sessao admin e da mesma origem.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const envRaiz = fileURLToPath(new URL('../../.env.local', import.meta.url));
if (process.env.VERCEL !== '1') {
  if (existsSync(envRaiz)) process.loadEnvFile(envRaiz);
  if (process.env.APP_ENV === 'production') throw new Error('APP_ENV indica producao: o ambiente local recusa');
  const origem = process.env.DEV_ADMIN_URL ?? 'http://localhost:3001';
  process.env.ADMIN_BASE_URL = origem;
  process.env.NEXT_PUBLIC_API_BASE_URL = `${origem}/api`;
  delete process.env.VERCEL_ENV;
}

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['sharp', 'pg'],
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL ?? '',
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ];
  },
};

export default config;
