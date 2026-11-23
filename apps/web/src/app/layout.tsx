// Casca da web: tokens EDS, design system, Roboto, cabecalho flutuante e rodape escuro.
import '@fastpro/tokens/tokens.css';
import './globals.css';
import type { Metadata } from 'next';
import { Roboto } from 'next/font/google';
import type { ReactNode } from 'react';
import { Navegacao } from '@/components/Navegacao';
import { Rodape } from '@/components/Rodape';

const roboto = Roboto({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-roboto', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'FastPro | Profissionais verificados perto de você', template: '%s | FastPro' },
  description: 'Peça serviços de graça e receba propostas de profissionais verificados da sua região.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="pt-BR" className={roboto.variable}>
      <body>
        <Navegacao />
        <main>{children}</main>
        <Rodape />
      </body>
    </html>
  );
}
