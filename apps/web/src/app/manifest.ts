// Manifesto da web instalavel (necessario para o push no iPhone e iPad, aberto pela Tela de Inicio).
import type { MetadataRoute } from 'next';
import { colors } from '@fastpro/tokens';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FastPro',
    short_name: 'FastPro',
    lang: 'pt-BR',
    start_url: '/',
    display: 'standalone',
    background_color: colors.light.background,
    theme_color: colors.light.primary,
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
