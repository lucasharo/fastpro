// H-014 | Repositorio Pg da sessao (T-H014-03 e 06 na parte de mapeamento): cliente falso, sem banco.
// Confere SQL, parametros (hashes e instantes, nunca segredo) e o mapeamento das linhas.
import { describe, expect, it } from 'vitest';
import { PgSessionRepository, hashSessionSecret } from '../src/session.js';

type Call = { text: string; params: unknown[] };

function fakeClient(rows: Record<string, unknown>[]) {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      async query(text: string, params: unknown[] = []) {
        calls.push({ text, params });
        return { rows };
      },
    },
  };
}

const NOW = Date.parse('2099-06-01T12:00:00.000Z');
const SEC = 'A'.repeat(43);

describe('PgSessionRepository: mapeamento e parametros', () => {
  it('hash do segredo e SHA-256 hex de 64 caracteres (mesmo algoritmo da etapa)', () => {
    expect(hashSessionSecret(SEC)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionSecret(SEC)).not.toContain(SEC);
  });

  it('convertStage chama a funcao com hashes e instante ISO; mapeia a linha', async () => {
    const { client, calls } = fakeClient([
      {
        out_session_id: 'sid-1',
        out_user_id: 'uid-1',
        out_absolute_expires_at: new Date(NOW + 7 * 86400000),
      },
    ]);
    const r = await new PgSessionRepository(client).convertStage('h-old', 'h-new', NOW);
    expect(r).toEqual({ sessionId: 'sid-1', userId: 'uid-1', absoluteExpiresAtMs: NOW + 7 * 86400000 });
    expect(calls[0]?.text).toContain('private.app_session_convert($1, $2, $3::timestamptz)');
    expect(calls[0]?.params).toEqual(['h-old', 'h-new', new Date(NOW).toISOString()]);
  });

  it('convertStage sem linha (negada) devolve nulo', async () => {
    const { client } = fakeClient([]);
    expect(await new PgSessionRepository(client).convertStage('h', 'n', NOW)).toBeNull();
  });

  it('authenticate: recent_auth_at nulo e metodo password sao preservados', async () => {
    const { client } = fakeClient([
      { out_session_id: 's', out_user_id: 'u', out_recent_auth_at: null, out_auth_method: 'password' },
    ]);
    expect(await new PgSessionRepository(client).authenticate('h', NOW)).toEqual({
      sessionId: 's',
      userId: 'u',
      recentAuthAtMs: null,
      authMethod: 'password',
    });
  });

  it('authenticate sem linha devolve nulo (negada para qualquer motivo)', async () => {
    const { client } = fakeClient([]);
    expect(await new PgSessionRepository(client).authenticate('h', NOW)).toBeNull();
  });

  it('metodo fora do conjunto e erro (nao vira sessao valida)', async () => {
    const { client } = fakeClient([
      { out_session_id: 's', out_user_id: 'u', out_recent_auth_at: null, out_auth_method: 'sms' },
    ]);
    await expect(new PgSessionRepository(client).authenticate('h', NOW)).rejects.toThrow(
      'auth_method_invalido',
    );
  });

  it('revoke e markRecentAuth leem o booleano; revokeAll le a contagem', async () => {
    const a = fakeClient([{ ok: true }]);
    expect(await new PgSessionRepository(a.client).revoke('s', NOW)).toBe(true);
    const b = fakeClient([{ n: '3' }]);
    expect(await new PgSessionRepository(b.client).revokeAll('u', NOW)).toBe(3);
    const c = fakeClient([{ ok: false }]);
    expect(await new PgSessionRepository(c.client).markRecentAuth('s', NOW)).toBe(false);
    expect(c.calls[0]?.text).toContain('private.app_session_mark_recent_auth');
  });

  it('nenhum parametro enviado contem o segredo em claro', async () => {
    const { client, calls } = fakeClient([]);
    await new PgSessionRepository(client).authenticate(hashSessionSecret(SEC), NOW);
    expect(JSON.stringify(calls)).not.toContain(SEC);
  });
});
