// Console: sem cookie de sessao admin, vai para a entrada por codigo. A permissao de cada tela continua na API
// (cookie vencido ou sem papel ainda responde como sem acesso dentro da tela).
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ADMIN_SESSION_COOKIE } from '@fastpro/domain';

export const dynamic = 'force-dynamic';

export default async function LayoutConsole({ children }: { readonly children: ReactNode }) {
  if ((await cookies()).get(ADMIN_SESSION_COOKIE) === undefined) redirect('/entrar');
  return <>{children}</>;
}
