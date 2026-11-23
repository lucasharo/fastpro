// Chamada a propria API (mesma origem, sem cache). Devolve status e corpo JSON (ou null). Nunca lanca:
// falha de rede vira status 0, para a tela mostrar o aviso certo.
export interface RespostaApi<T = unknown> {
  readonly status: number;
  readonly corpo: T | null;
}

export interface OpcoesApi {
  readonly method?: string;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

export async function chamarApi<T = unknown>(caminho: string, opcoes: OpcoesApi = {}): Promise<RespostaApi<T>> {
  try {
    const resposta = await fetch(`/api${caminho}`, {
      method: opcoes.method ?? (opcoes.body === undefined ? 'GET' : 'POST'),
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(opcoes.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(opcoes.headers ?? {}),
      },
      ...(opcoes.body === undefined ? {} : { body: JSON.stringify(opcoes.body) }),
    });
    const corpo = (await resposta.json().catch(() => null)) as T | null;
    return { status: resposta.status, corpo };
  } catch {
    return { status: 0, corpo: null };
  }
}

export const ok = (status: number): boolean => status >= 200 && status < 300;

/** Codigo de erro do corpo ({ code } ou { error }), ou ''. */
export function codigoDe(corpo: unknown): string {
  if (corpo && typeof corpo === 'object') {
    const c = corpo as { code?: unknown; error?: unknown };
    if (typeof c.code === 'string') return c.code;
    if (typeof c.error === 'string') return c.error;
  }
  return '';
}

export const MENSAGEM_LIMITE = 'Muitas tentativas. Aguarde um instante e tente de novo.';
export const MENSAGEM_INDISPONIVEL = 'Não foi possível concluir agora. Tente de novo em instantes.';

export interface ServicoCatalogo {
  readonly service_id: string;
  readonly service_name: string;
}

/** Busca de servico do catalogo (POST /v1/catalog/service-search). */
export async function buscarServicos(q: string): Promise<ServicoCatalogo[] | 'limite' | 'erro'> {
  const r = await chamarApi<{ status?: string; items?: ServicoCatalogo[] }>('/v1/catalog/service-search', { body: { q } });
  if (r.status === 429) return 'limite';
  if (r.status !== 200) return 'erro';
  if (r.corpo?.status === 'vazio') return [];
  return (r.corpo?.items ?? []).filter((i) => typeof i.service_id === 'string' && typeof i.service_name === 'string');
}

/** Token do fragmento (#t=...) dos links de e-mail. Qualquer outra forma devolve null. */
export function tokenDoFragmento(hash: string): string | null {
  const m = /(?:^#|&)t=([A-Za-z0-9_-]{1,512})(?=&|$)/.exec(hash);
  return m ? (m[1] ?? null) : null;
}
