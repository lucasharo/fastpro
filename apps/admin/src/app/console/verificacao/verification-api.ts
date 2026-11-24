// Issue 52 (H-039) | Chamada servidor-a-servidor da fila de verificacao: a sessao do console vai no cabecalho e a
// gravacao usa a mesma Origin e sec-fetch-site do catalogo. Nada e gravado no cliente; a API e o banco decidem.
import { cookies } from 'next/headers';
import { ADMIN_SESSION_COOKIE } from '@fastpro/domain';

export type FalhaChamada = 'sem_acesso' | 'indisponivel';

export async function chamarVerificacao(
  caminho: string,
  metodo: 'GET' | 'POST',
  corpo?: unknown,
): Promise<Response | FalhaChamada> {
  const valor = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (valor === undefined) return 'sem_acesso';
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  const origem = process.env.ADMIN_BASE_URL;
  if (!base || !origem) return 'indisponivel';
  const cabecalhos: Record<string, string> = { cookie: `${ADMIN_SESSION_COOKIE}=${valor}` };
  if (metodo === 'POST') {
    cabecalhos['content-type'] = 'application/json';
    cabecalhos.origin = origem;
    cabecalhos['sec-fetch-site'] = 'same-origin';
  }
  try {
    return await fetch(`${base}/v1/admin/verificacao${caminho}`, {
      method: metodo,
      headers: cabecalhos,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      cache: 'no-store',
    });
  } catch {
    return 'indisponivel';
  }
}
