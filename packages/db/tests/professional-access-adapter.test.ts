// Issue 55 (H-042), parte A | Testes do adaptador Pg da guarda de elegibilidade com cliente falso (docs/factory/142-DESENHO-H042.md, T-20).
// Sem banco e sem rede: prova parametros posicionais, o SQL fixo, so true vira true, e erro vira false sem mensagem.
import { describe, it, expect } from 'vitest';
import { SQL_PROFESSIONAL_ACCESS, createPgProfessionalAccess } from '../src/professional-access.js';
import type { SqlClient } from '../src/jobs-tick.js';

const PROFISSIONAL = '11111111-2222-4333-8444-555555555555';
const AT = new Date('2099-08-15T12:00:00.000Z');

function clienteFalso(resposta: () => Promise<{ rows: Record<string, unknown>[] }>) {
  const chamadas: Array<{ text: string; params: unknown[] | undefined }> = [];
  const client: SqlClient = {
    query: (text, params) => {
      chamadas.push({ text, params });
      return resposta();
    },
  };
  return { client, chamadas };
}

describe('createPgProfessionalAccess', () => {
  it('usa o SQL fixo com parametros posicionais e o instante em ISO-8601', async () => {
    const { client, chamadas } = clienteFalso(async () => ({ rows: [{ ok: true }] }));
    const porta = createPgProfessionalAccess(client);
    expect(await porta.allowed(PROFISSIONAL, 'descoberta_aceite', AT)).toBe(true);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].text).toBe(SQL_PROFESSIONAL_ACCESS);
    expect(SQL_PROFESSIONAL_ACCESS).toContain('private.professional_access_guard($1::uuid, $2::text, $3::timestamptz)');
    expect(chamadas[0].params).toEqual([PROFISSIONAL, 'descoberta_aceite', AT.toISOString()]);
  });

  it('so o booleano true do banco vira true', async () => {
    for (const [linhas, esperado] of [
      [[{ ok: true }], true],
      [[{ ok: false }], false],
      [[{ ok: 'true' }], false],
      [[{ ok: 1 }], false],
      [[{ ok: null }], false],
      [[], false],
    ] as const) {
      const { client } = clienteFalso(async () => ({ rows: linhas as unknown as Record<string, unknown>[] }));
      expect(await createPgProfessionalAccess(client).allowed(PROFISSIONAL, 'participacao', AT)).toBe(esperado);
    }
  });

  it('erro do banco vira false e a mensagem nao aparece no resultado', async () => {
    const { client } = clienteFalso(async () => {
      throw new Error('segredo: conexao recusada em host interno');
    });
    const ok = await createPgProfessionalAccess(client).allowed(PROFISSIONAL, 'descoberta_aceite', AT);
    expect(ok).toBe(false);
    expect(String(ok)).not.toContain('segredo');
  });

  it('instante invalido vira false antes de chegar ao banco', async () => {
    const { client, chamadas } = clienteFalso(async () => ({ rows: [{ ok: true }] }));
    const ok = await createPgProfessionalAccess(client).allowed(PROFISSIONAL, 'descoberta_aceite', new Date('x'));
    expect(ok).toBe(false);
    expect(chamadas).toHaveLength(0);
  });
});
