// Chamadas a API do site. O cookie de sessao fica no gerenciador de cookies nativo; o Origin vai explicito porque a
// API so aceita mudancas vindas da propria origem.
export const SITE = (process.env.EXPO_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '');

export interface Resposta<T> {
  readonly status: number;
  readonly corpo: T | null;
}

export async function chamarApi<T = unknown>(caminho: string, body?: unknown): Promise<Resposta<T>> {
  try {
    const r = await fetch(`${SITE}/api${caminho}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        Origin: SITE,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, corpo: (await r.json().catch(() => null)) as T | null };
  } catch {
    return { status: 0, corpo: null };
  }
}

export const ok = (status: number): boolean => status >= 200 && status < 300;

export type Papel = 'cliente' | 'profissional';

/** Papel da sessao atual, null sem sessao e 'erro' quando nao deu para consultar. */
export async function papelDaSessao(): Promise<Papel | null | 'erro'> {
  const r = await chamarApi<{ papel?: string }>('/v1/auth/me');
  if (r.status === 200) return r.corpo?.papel === 'cliente' || r.corpo?.papel === 'profissional' ? r.corpo.papel : null;
  return r.status === 401 ? null : 'erro';
}
