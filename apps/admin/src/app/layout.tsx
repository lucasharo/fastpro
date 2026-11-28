// H-103 (Issue 112) | Casca do console admin: tokens EDS, design system da web, Roboto, cabecalho de vidro e menu
// lateral. Cores, tipografia e medidas vem so dos tokens (globals.css); o tema claro/escuro segue a web.
import '@fastpro/tokens/tokens.css';
import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { CascaAdmin } from '../components/CascaAdmin';
import { SCRIPT_TEMA } from '../components/TrocaTema';

export const metadata: Metadata = {
  title: { default: 'Console administrativo', template: '%s | FastPro Admin' },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <CascaAdmin>{children}</CascaAdmin>
      </body>
    </html>
  );
}
