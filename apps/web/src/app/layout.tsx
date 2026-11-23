// Casca da web: tokens EDS, design system, Roboto (familia do token --font-family), cabecalho flutuante e rodape.
import '@fastpro/tokens/tokens.css';
import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Navegacao } from '@/components/Navegacao';
import { Rodape } from '@/components/Rodape';

export const metadata: Metadata = {
  title: { default: 'FastPro | Profissionais verificados perto de você', template: '%s | FastPro' },
  description: 'Peça serviços de graça e receba propostas de profissionais verificados da sua região.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <Navegacao />
        <main>{children}</main>
        <Rodape />
      </body>
    </html>
  );
}
