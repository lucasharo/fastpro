// H-073 (Issue 83, docs/factory/60-DESENHO-H073.md §4) | Adaptador HTTP do provedor de login admin (Supabase Auth).
// Implementa so signInWithPasswordAndTotp: senha (grant password) -> fator TOTP verificado do usuario -> desafio ->
// verificacao com o codigo (aal2). Os tokens nunca saem daqui e sao revogados no fim (logout local, melhor esforco).
// Credencial recusada = null (o dominio responde 401 credenciais_invalidas). Rede falha ou 5xx = erro (503).
// Nada de senha, codigo, token ou URL vai para log ou erro. Sem SDK: fetch injetado (testes com fetch falso).

import type { AdminAuthPort } from '@fastpro/domain';

export interface SupabaseAuthOpcoes {
  /** URL base do projeto (SUPABASE_URL), sem barra final. */
  readonly baseUrl: string;
  /** Chave publica (apikey) do projeto. Nunca a chave secreta. */
  readonly apiKey: string;
  /** fetch injetado; padrao: o global. */
  readonly fetch?: typeof fetch;
  /** Limite por chamada ao provedor. Padrao: 10 s. */
  readonly timeoutMs?: number;
}

type Porta = Pick<AdminAuthPort, 'signInWithPasswordAndTotp'>;

interface Resposta {
  readonly status: number;
  readonly json: Record<string, unknown> | null;
}

function oDicionario(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Erro de disponibilidade: sem detalhe da resposta. O chamador traduz para 503. */
export class ProvedorIndisponivel extends Error {
  constructor() {
    super('provedor_login_indisponivel');
    this.name = 'ProvedorIndisponivel';
  }
}

export function criarAuthAdminSupabase(opcoes: SupabaseAuthOpcoes): Porta {
  const base = opcoes.baseUrl.replace(/\/+$/, '');
  const chamadaHttp = opcoes.fetch ?? fetch;
  const limite = opcoes.timeoutMs ?? 10_000;

  async function chamar(
    caminho: string,
    metodo: 'GET' | 'POST',
    corpo?: unknown,
    token?: string,
  ): Promise<Resposta> {
    const cabecalhos: Record<string, string> = { apikey: opcoes.apiKey };
    if (corpo !== undefined) cabecalhos['Content-Type'] = 'application/json';
    if (token !== undefined) cabecalhos.Authorization = `Bearer ${token}`;
    let res: Response;
    try {
      res = await chamadaHttp(`${base}${caminho}`, {
        method: metodo,
        headers: cabecalhos,
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: AbortSignal.timeout(limite),
      });
    } catch {
      throw new ProvedorIndisponivel();
    }
    if (res.status >= 500) throw new ProvedorIndisponivel();
    let json: Record<string, unknown> | null = null;
    try {
      json = oDicionario(await res.json());
    } catch {
      json = null;
    }
    return { status: res.status, json };
  }

  /** Revogacao melhor esforco: falha aqui nao muda a decisao da prova. */
  async function revogar(token: string): Promise<void> {
    try {
      await chamar('/auth/v1/logout?scope=local', 'POST', {}, token);
    } catch {
      // ignorado de proposito: a decisao ja foi tomada
    }
  }

  return {
    async signInWithPasswordAndTotp(email, password, code) {
      const senha = await chamar('/auth/v1/token?grant_type=password', 'POST', { email, password });
      if (senha.status !== 200 || senha.json === null) return null;
      const tokenSenha = senha.json.access_token;
      const usuario = oDicionario(senha.json.user);
      const authUserId = usuario?.id;
      if (typeof tokenSenha !== 'string' || typeof authUserId !== 'string') return null;

      let tokenAtual = tokenSenha;
      try {
        const perfil = await chamar('/auth/v1/user', 'GET', undefined, tokenAtual);
        const fatores = Array.isArray(perfil.json?.factors) ? (perfil.json?.factors as unknown[]) : [];
        const totp = fatores
          .map(oDicionario)
          .find((f) => f !== null && f.factor_type === 'totp' && f.status === 'verified');
        if (perfil.status !== 200 || totp === null || totp === undefined || typeof totp.id !== 'string') {
          return null;
        }

        const desafio = await chamar(`/auth/v1/factors/${totp.id}/challenge`, 'POST', {}, tokenAtual);
        if (desafio.status !== 200 || typeof desafio.json?.id !== 'string') return null;

        const verificacao = await chamar(`/auth/v1/factors/${totp.id}/verify`, 'POST', {
          challenge_id: desafio.json.id,
          code,
        }, tokenAtual);
        if (verificacao.status !== 200) return null;
        if (typeof verificacao.json?.access_token === 'string') tokenAtual = verificacao.json.access_token;
        return { authUserId };
      } finally {
        await revogar(tokenAtual);
      }
    },
  };
}
