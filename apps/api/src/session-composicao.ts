// Issue 156 (F5b, desenho 177 §1 F-9) | Monta a rota de sessao na funcao da API: conversao da etapa
// (POST /v1/auth/session) e logout. Liga so com DATABASE_URL_APP_SYSTEM e SITE_URL preenchidas; sem elas a
// rota segue inexistente (404). Fora desta fatia: prova de passo (step-up) e desafio de acesso.
// Nunca registra valor de conexao nem de segredo.
import { randomBytes } from 'node:crypto';
import { PgSessionRepository, type SqlClient } from '@fastpro/db';
import type { SessionRouteOptions } from './session-route.js';

type Ambiente = Readonly<Record<string, string | undefined>>;

export interface MontagemSessaoOpcoes {
  readonly abrirCliente: (connectionString: string) => SqlClient;
}

/** Segredo novo da sessao: 32 bytes aleatorios em base64url (43 caracteres). */
export function novoSegredoSessao(): string {
  return randomBytes(32).toString('base64url');
}

/** Opcoes da rota de sessao, ou undefined sem as variaveis (sem elas a rota responde 404). */
export function montarSessao(env: Ambiente, opcoes: MontagemSessaoOpcoes): SessionRouteOptions | undefined {
  const conexao = env.DATABASE_URL_APP_SYSTEM;
  const siteUrl = env.SITE_URL;
  if (conexao === undefined || conexao === '' || siteUrl === undefined || siteUrl === '') return undefined;
  return {
    repo: new PgSessionRepository(opcoes.abrirCliente(conexao)),
    siteUrl,
    clock: { nowMs: () => Date.now() },
    newSecret: novoSegredoSessao,
  };
}
