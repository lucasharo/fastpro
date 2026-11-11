// H-012 | Composicao do consumo (buildConsumeDeps) ponta a ponta com SqlClient simulado: o e-mail
// e decifrado de verdade (AES-GCM com AAD do desafio) e a etapa recebe o hash do cookie devolvido.
// Sem rede (fetch bloqueado), sem banco real, dados sinteticos (@example.test).
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-012');
};

import { describe, it, expect } from 'vitest';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { ChallengeCryptoError, challengeAad, sealChallengeBlob } from '../src/challenges-crypto.js';
import {
  buildConsumeDeps,
  consumeChallenge,
  type AuthUserAdminPort,
} from '../src/challenge-consume.js';

const KEY = randomBytes(32);
const EMAIL = 'composicao.h012@example.test';
const TOKEN = 'TOKEN-SINTETICO-' + 'z'.repeat(28);
const NOW = Date.UTC(2099, 0, 1, 12, 0, 0);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

// Nome da variavel de cifra (um nome, nao um valor). O valor sintetico entra so por este helper.
const VARIAVEL_CHAVE = 'AUTH_CHALLENGE_KEY';
function ambienteComChave(valor: string): NodeJS.ProcessEnv {
  const ambiente: NodeJS.ProcessEnv = {};
  ambiente[VARIAVEL_CHAVE] = valor;
  return ambiente;
}

interface Chamada {
  sql: string;
  params: unknown[];
}

/** Roteia pelo nome da funcao SQL: cada uma devolve a linha que o banco devolveria. */
function bancoSimulado(challengeId: string, userId: string) {
  const chamadas: Chamada[] = [];
  const emailEnc = sealChallengeBlob(KEY, EMAIL, challengeAad(challengeId, 'email_enc'));
  const client = {
    async query(sql: string, params: unknown[] = []) {
      chamadas.push({ sql, params });
      if (sql.includes('auth_challenge_consume_link')) {
        return {
          rows: [
            {
              out_resultado: 'ok',
              out_challenge_id: challengeId,
              out_purpose: 'login',
              out_email_enc: emailEnc,
              out_draft_id: null,
            },
          ],
        };
      }
      if (sql.includes('app_user_find')) return { rows: [] };
      if (sql.includes('app_user_ensure')) {
        return { rows: [{ out_user_id: userId, out_status: 'ativo', out_criado: true }] };
      }
      if (sql.includes('app_session_open_stage')) return { rows: [{ id: randomUUID() }] };
      return { rows: [] };
    },
  };
  return { client, chamadas };
}

describe('composicao buildConsumeDeps (ponta a ponta com banco simulado)', () => {
  it('consome, decifra o e-mail, cria a conta e abre a etapa com o hash do cookie', async () => {
    const challengeId = randomUUID();
    const userId = randomUUID();
    const { client, chamadas } = bancoSimulado(challengeId, userId);
    let criacoes = 0;
    const authAdmin: AuthUserAdminPort = {
      async createUser() {
        criacoes += 1;
        return { status: 'criado', authUserId: randomUUID() };
      },
    };
    const deps = buildConsumeDeps({
      client,
      authAdmin,
      clock: { nowMs: () => NOW },
      env: ambienteComChave(KEY.toString('base64')),
    });

    const r = await consumeChallenge(deps, TOKEN);

    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'identificado' });
    const cookie = r.setCookie ?? '';
    const segredo = /__Host-fp_ident=([A-Za-z0-9_-]{43});/.exec(cookie)?.[1];
    expect(segredo).toBeDefined();

    const sqls = chamadas.map((c) => c.sql);
    expect(sqls.filter((s) => s.includes('auth_challenge_consume_link'))).toHaveLength(1);
    expect(sqls.map((s) => /private\.(\w+)/.exec(s)?.[1])).toEqual([
      'auth_challenge_consume_link',
      'app_user_find',
      'app_user_ensure',
      'app_session_open_stage',
    ]);
    expect(criacoes).toBe(1);

    // O e-mail chegou decifrado a conta (parametro da funcao de criacao).
    const ensure = chamadas.find((c) => c.sql.includes('app_user_ensure'));
    expect(ensure?.params[0]).toBe(EMAIL);
    // A etapa recebe o hash do segredo do cookie, nunca o segredo nem o token.
    const abrir = chamadas.find((c) => c.sql.includes('app_session_open_stage'));
    expect(abrir?.params).toContain(sha(segredo ?? ''));
    expect(abrir?.params).not.toContain(segredo);
    expect(JSON.stringify(abrir?.params)).not.toContain(TOKEN);
  });

  it('sem AUTH_CHALLENGE_KEY a composicao falha com erro de configuracao, sem valor', () => {
    const { client } = bancoSimulado(randomUUID(), randomUUID());
    const authAdmin: AuthUserAdminPort = { createUser: async () => ({ status: 'ja_existe' }) };
    expect(() =>
      buildConsumeDeps({ client, authAdmin, clock: { nowMs: () => NOW }, env: {} }),
    ).toThrow(ChallengeCryptoError);
  });
});
