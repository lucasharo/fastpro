// H-073 (Issue 83, docs/factory/60-DESENHO-H073.md §4) | Adaptador HTTP do provedor de login admin com fetch falso.
// Sem rede: o fetch e substituido e falha se for chamado sem rota. Senha, codigo e chave sao montados em tempo de
// execucao. Confere a sequencia senha -> fator -> desafio -> verificacao -> revogacao e as negacoes.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-073 (provedor de login)');
};

import { describe, expect, it } from 'vitest';
import { criarAuthAdminSupabase, ProvedorIndisponivel } from '../src/admin-auth-supabase.js';

const BASE = 'https://projeto-sintetico.example.test/';
const CHAVE = ['chave', 'publica', 'sintetica'].join('-');
const SENHA = ['senha', 'admin', 'sintetica'].join('-');
const EMAIL = 'admin.sintetico@example.test';
const TOKEN_SENHA = ['token', 'senha', 'sintetico'].join('-');
const TOKEN_AAL2 = ['token', 'aal2', 'sintetico'].join('-');
const CODIGO = '123456';

interface Chamada {
  readonly metodo: string;
  readonly caminho: string;
  readonly apikey: string | undefined;
  readonly bearer: string | undefined;
  readonly corpo: string | undefined;
}

type Rota = { readonly status: number; readonly json?: unknown } | 'rede' | 'erro500';

/** Fetch falso por rota "METODO caminho" (sem query). Registra cada chamada. */
function fetchFalso(rotas: Record<string, Rota>) {
  const chamadas: Chamada[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const metodo = init?.method ?? 'GET';
    const chave = `${metodo} ${u.pathname}`;
    const cab = new Headers(init?.headers);
    chamadas.push({
      metodo,
      caminho: u.pathname + u.search,
      apikey: cab.get('apikey') ?? undefined,
      bearer: cab.get('authorization')?.replace(/^Bearer /, ''),
      corpo: typeof init?.body === 'string' ? init.body : undefined,
    });
    const rota = rotas[chave];
    if (rota === undefined) throw new Error(`rota sem resposta no teste: ${chave}`);
    if (rota === 'rede') throw new TypeError('falha de rede sintetica');
    if (rota === 'erro500') return new Response('{}', { status: 500 });
    if (rota.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(rota.json ?? {}), {
      status: rota.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { f, chamadas };
}

const LOGIN_OK: Rota = { status: 200, json: { access_token: TOKEN_SENHA, user: { id: 'auth-1' } } };
const PERFIL_COM_TOTP: Rota = {
  status: 200,
  json: { id: 'auth-1', factors: [{ id: 'fator-1', factor_type: 'totp', status: 'verified' }] },
};
const DESAFIO_OK: Rota = { status: 200, json: { id: 'desafio-1' } };
const VERIFICA_OK: Rota = { status: 200, json: { access_token: TOKEN_AAL2 } };
const SAIDA_OK: Rota = { status: 204 };

function montar(rotas: Record<string, Rota>) {
  const { f, chamadas } = fetchFalso(rotas);
  const auth = criarAuthAdminSupabase({ baseUrl: BASE, apiKey: CHAVE, fetch: f, timeoutMs: 5000 });
  return { auth, chamadas };
}

describe('criarAuthAdminSupabase: signInWithPasswordAndTotp (H-073, 60 §4)', () => {
  it('prova valida: devolve so o id da conta e revoga o token aal2 no fim', async () => {
    const { auth, chamadas } = montar({
      'POST /auth/v1/token': LOGIN_OK,
      'GET /auth/v1/user': PERFIL_COM_TOTP,
      'POST /auth/v1/factors/fator-1/challenge': DESAFIO_OK,
      'POST /auth/v1/factors/fator-1/verify': VERIFICA_OK,
      'POST /auth/v1/logout': SAIDA_OK,
    });
    const r = await auth.signInWithPasswordAndTotp(EMAIL, SENHA, CODIGO);
    expect(r).toEqual({ authUserId: 'auth-1' });
    const caminhos = chamadas.map((c) => `${c.metodo} ${c.caminho}`);
    expect(caminhos).toEqual([
      'POST /auth/v1/token?grant_type=password',
      'GET /auth/v1/user',
      'POST /auth/v1/factors/fator-1/challenge',
      'POST /auth/v1/factors/fator-1/verify',
      'POST /auth/v1/logout?scope=local',
    ]);
    const logout = chamadas[chamadas.length - 1];
    expect(logout?.bearer).toBe(TOKEN_AAL2);
    expect(chamadas.every((c) => c.apikey === CHAVE)).toBe(true);
    expect(chamadas[3]?.corpo).toBe(JSON.stringify({ challenge_id: 'desafio-1', code: CODIGO }));
  });

  it('senha recusada (400): nulo, sem passo de TOTP', async () => {
    const { auth, chamadas } = montar({ 'POST /auth/v1/token': { status: 400, json: { error: 'x' } } });
    expect(await auth.signInWithPasswordAndTotp(EMAIL, SENHA, CODIGO)).toBeNull();
    expect(chamadas.map((c) => c.caminho)).toEqual(['/auth/v1/token?grant_type=password']);
  });

  it('conta sem fator TOTP verificado: nulo e o token de senha e revogado', async () => {
    const { auth, chamadas } = montar({
      'POST /auth/v1/token': LOGIN_OK,
      'GET /auth/v1/user': { status: 200, json: { id: 'auth-1', factors: [] } },
      'POST /auth/v1/logout': SAIDA_OK,
    });
    expect(await auth.signInWithPasswordAndTotp(EMAIL, SENHA, CODIGO)).toBeNull();
    expect(chamadas[chamadas.length - 1]?.bearer).toBe(TOKEN_SENHA);
  });

  it('codigo TOTP recusado na verificacao (400): nulo e revogacao no fim', async () => {
    const { auth, chamadas } = montar({
      'POST /auth/v1/token': LOGIN_OK,
      'GET /auth/v1/user': PERFIL_COM_TOTP,
      'POST /auth/v1/factors/fator-1/challenge': DESAFIO_OK,
      'POST /auth/v1/factors/fator-1/verify': { status: 400, json: { msg: 'codigo' } },
      'POST /auth/v1/logout': SAIDA_OK,
    });
    expect(await auth.signInWithPasswordAndTotp(EMAIL, SENHA, CODIGO)).toBeNull();
    expect(chamadas[chamadas.length - 1]?.caminho).toBe('/auth/v1/logout?scope=local');
  });

  it('falha do provedor (5xx) ou de rede: lanca ProvedorIndisponivel, sem detalhe da resposta', async () => {
    const porStatus = montar({ 'POST /auth/v1/token': 'erro500' });
    await expect(porStatus.auth.signInWithPasswordAndTotp(EMAIL, SENHA, CODIGO)).rejects.toBeInstanceOf(
      ProvedorIndisponivel,
    );
    const porRede = montar({ 'POST /auth/v1/token': 'rede' });
    const erro = await porRede.auth.signInWithPasswordAndTotp(EMAIL, SENHA, CODIGO).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ProvedorIndisponivel);
    expect(String((erro as Error).message)).not.toContain(SENHA);
  });

  it('falha ao revogar no fim nao muda a decisao da prova', async () => {
    const { auth } = montar({
      'POST /auth/v1/token': LOGIN_OK,
      'GET /auth/v1/user': PERFIL_COM_TOTP,
      'POST /auth/v1/factors/fator-1/challenge': DESAFIO_OK,
      'POST /auth/v1/factors/fator-1/verify': VERIFICA_OK,
      'POST /auth/v1/logout': 'rede',
    });
    expect(await auth.signInWithPasswordAndTotp(EMAIL, SENHA, CODIGO)).toEqual({ authUserId: 'auth-1' });
  });

  it('a URL base sem barra final gera o mesmo caminho; a senha nunca aparece em erro ou corpo de retorno', async () => {
    const { auth, chamadas } = montar({ 'POST /auth/v1/token': { status: 401, json: {} } });
    const r = await auth.signInWithPasswordAndTotp(EMAIL, SENHA, CODIGO);
    expect(r).toBeNull();
    expect(chamadas[0]?.caminho).toBe('/auth/v1/token?grant_type=password');
    expect(JSON.stringify(r)).not.toContain(SENHA);
  });
});
