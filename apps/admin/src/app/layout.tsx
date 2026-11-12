// H-103 (Issue 112) | Casca do console admin. Cores, tipografia e medidas vem so dos tokens EDS
// (@fastpro/tokens); nada de cor literal aqui.
import '@fastpro/tokens/tokens.css';
import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Console administrativo',
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
