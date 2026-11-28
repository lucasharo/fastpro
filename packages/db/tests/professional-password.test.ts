// H-016 | Adaptador da troca de senha com cliente falso (sem banco). Confere a leitura da sessao, a troca no
// Auth antes de revogar, a revogacao que mantem a sessao atual e o aviso que nao desfaz a troca.
import { describe, expect, it } from 'vitest';
import { PgProfessionalPassword } from '../src/professional-password.js';
import { hashSessionSecret } from '../src/session.js';

const SEGREDO = 'segredo-sintetico-de-sessao-com-tamanho-suficiente';
const EMAIL = 'pessoa.sintetica@example.test';
const AGORA = Date.UTC(2099, 0, 1, 12);

interface Opcoes {
  sessao?: boolean;
  perfil?: boolean;
  ativo?: boolean;
  avisoFalha?: boolean;
  authFalha?: boolean;
}

function montar(opcoes: Opcoes = {}) {
  const sql: { texto: string; params: unknown[] }[] = [];
  const trocas: { id: string; senha: string }[] = [];
  const avisos: string[] = [];
  const client = {
    async query(texto: string, params: unknown[] = []) {
      sql.push({ texto, params });
      if (texto.includes('app_session_get')) {
        return {
          rows:
            opcoes.sessao === false
              ? []
              : [{ out_session_id: 'sessao-atual', out_user_id: 'usuario-1', out_recent_auth_at: new Date(AGORA - 60_000) }],
        };
      }
      if (texto.includes('professional_me')) {
        return {
          rows:
            opcoes.perfil === false
              ? []
              : [{ out_auth_user_id: 'auth-1', out_email: EMAIL, out_email_verified: true, out_status: 'pendente', out_active: opcoes.ativo !== false }],
        };
      }
      return { rows: [] };
    },
  };
  const gateway = {
    async createUser() {
      return 'existente' as const;
    },
    async deleteUser() {},
    async updatePassword(id: string, senha: string) {
      if (opcoes.authFalha) throw new Error('auth_indisponivel');
      trocas.push({ id, senha });
    },
    async signInWithPassword() {
      return null;
    },
  };
  const mail = {
    async passwordChangedNotice(email: string) {
      if (opcoes.avisoFalha) throw new Error('envio_falhou');
      avisos.push(email);
    },
  };
  const adaptador = new PgProfessionalPassword({ client: client as never, gateway, mail });
  return { adaptador, sql, trocas, avisos };
}

describe('PgProfessionalPassword.sessionAccount', () => {
  it('le a sessao pelo hash do segredo e junta a conta do Auth', async () => {
    const m = montar();
    const conta = await m.adaptador.sessionAccount(SEGREDO, AGORA);
    expect(conta).toEqual({
      sessionId: 'sessao-atual',
      userId: 'usuario-1',
      authUserId: 'auth-1',
      email: EMAIL,
      emailVerified: true,
      recentAuthAtMs: AGORA - 60_000,
    });
    expect(m.sql[0]?.params[0]).toBe(hashSessionSecret(SEGREDO));
    expect(JSON.stringify(m.sql)).not.toContain(SEGREDO);
  });

  it('sessao invalida: nulo sem consultar o perfil', async () => {
    const m = montar({ sessao: false });
    expect(await m.adaptador.sessionAccount(SEGREDO, AGORA)).toBeNull();
    expect(m.sql).toHaveLength(1);
  });

  it('sessao sem perfil profissional ou conta inativa: nulo', async () => {
    expect(await montar({ perfil: false }).adaptador.sessionAccount(SEGREDO, AGORA)).toBeNull();
    expect(await montar({ ativo: false }).adaptador.sessionAccount(SEGREDO, AGORA)).toBeNull();
  });
});

describe('PgProfessionalPassword.changePassword', () => {
  const conta = {
    sessionId: 'sessao-atual',
    userId: 'usuario-1',
    authUserId: 'auth-1',
    email: EMAIL,
    emailVerified: true,
    recentAuthAtMs: AGORA,
  };

  it('troca no Auth, revoga as outras sessoes (mantem a atual) e envia o aviso', async () => {
    const m = montar();
    await m.adaptador.changePassword(conta, 'senha-sintetica-forte-2099', AGORA);
    expect(m.trocas).toEqual([{ id: 'auth-1', senha: 'senha-sintetica-forte-2099' }]);
    const revoga = m.sql.find((s) => s.texto.includes('professional_sessions_revoke_others'));
    expect(revoga?.params).toEqual(['usuario-1', 'sessao-atual', new Date(AGORA).toISOString()]);
    expect(m.avisos).toEqual([EMAIL]);
  });

  it('falha do Auth lanca e nao revoga nem avisa', async () => {
    const m = montar({ authFalha: true });
    await expect(m.adaptador.changePassword(conta, 'senha-sintetica-forte-2099', AGORA)).rejects.toThrow();
    expect(m.sql.some((s) => s.texto.includes('professional_sessions_revoke_others'))).toBe(false);
    expect(m.avisos).toEqual([]);
  });

  it('falha do aviso nao desfaz a troca', async () => {
    const m = montar({ avisoFalha: true });
    await expect(m.adaptador.changePassword(conta, 'senha-sintetica-forte-2099', AGORA)).resolves.toBeUndefined();
    expect(m.trocas).toHaveLength(1);
  });
});
