// Chamadas do navegador a API embutida no admin (/api, mesma origem: o cookie da sessao admin vai sozinho).
// 404 vazio = sem sessao ou sem permissao para a tela (a API nao diz qual).
export interface RespostaAdmin<T> {
  readonly status: number;
  readonly corpo: T | null;
}

export async function apiAdmin<T = unknown>(caminho: string, corpo?: unknown): Promise<RespostaAdmin<T>> {
  try {
    const r = await fetch(`/api${caminho}`, {
      method: corpo === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: corpo === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    });
    const dados = (await r.json().catch(() => null)) as T | null;
    return { status: r.status, corpo: dados };
  } catch {
    return { status: 0, corpo: null };
  }
}

export function dataHora(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
}

export const TEXTO_SEM_ACESSO = 'Sua conta não tem acesso a esta tela, ou a sessão terminou. Entre de novo se precisar.';
export const TEXTO_FALHA = 'Não foi possível carregar agora. Tente de novo em instantes.';
