// H-016 | Adaptador de GET /v1/professional/me com cliente falso (sem banco). Confere que o segredo entra
// so como hash e que sessao invalida ou sem perfil devolve nulo (CA-H016-10, CA-H016-21).
import { describe, expect, it } from 'vitest';
import { PgProfessionalAccount } from '../src/professional-account.js';
import { hashSessionSecret } from '../src/session.js';

function clienteFalso(linhas: { sessao: unknown[]; perfil: unknown[] }) {
  const chamadas: { sql: string; params: unknown[] }[] = [];
  return {
    chamadas,
    client: {
      async query(sql: string, params: unknown[] = []) {
        chamadas.push({ sql, params });
        const rows = sql.includes('app_session_get') ? linhas.sessao : linhas.perfil;
        return { rows };
      },
    },
  };
}

describe('PgProfessionalAccount.me', () => {
  it('le a sessao pelo hash do segredo e devolve o estado do perfil', async () => {
    const f = clienteFalso({
      sessao: [{ out_user_id: 'u-sintetico' }],
      perfil: [{ out_email_verified: true, out_status: 'pendente' }],
    });
    const r = await new PgProfessionalAccount(f.client as never).me('segredo-sintetico', Date.UTC(2099, 0, 1));
    expect(r).toEqual({ emailVerified: true, status: 'pendente' });
    expect(f.chamadas[0]?.params[0]).toBe(hashSessionSecret('segredo-sintetico'));
    expect(JSON.stringify(f.chamadas)).not.toContain('segredo-sintetico');
  });

  it('sessao invalida: nulo sem consultar o perfil', async () => {
    const f = clienteFalso({ sessao: [], perfil: [] });
    expect(await new PgProfessionalAccount(f.client as never).me('x', 0)).toBeNull();
    expect(f.chamadas).toHaveLength(1);
  });

  it('sessao valida sem perfil profissional: nulo', async () => {
    const f = clienteFalso({ sessao: [{ out_user_id: 'u-cliente' }], perfil: [] });
    expect(await new PgProfessionalAccount(f.client as never).me('x', 0)).toBeNull();
  });
});
