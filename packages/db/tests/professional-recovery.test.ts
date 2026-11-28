// H-016 | Adaptador da recuperacao e da redefinicao com cliente falso (sem banco). Confere a ordem
// peek -> Auth -> consume, o hash do token (nunca o token em claro) e o caso cliente que vira profissional.
import { describe, expect, it } from 'vitest';
import { PgProfessionalRecovery } from '../src/professional-recovery.js';
import { challengeSha256Hex } from '../src/challenges-crypto.js';

const EMAIL = 'pessoa.sintetica@example.test';
const TOKEN = 'S'.repeat(43);
const T0 = Date.UTC(2099, 0, 1);

type Aplicavel = 'password_reset' | 'professional_activate' | 'professional_verify' | null;

function montar(opcoes: { aplicavel?: Aplicavel; peek?: boolean; consome?: boolean }) {
  const sql: { texto: string; params: unknown[] }[] = [];
  const envios: { email: string; token: string; purpose: string }[] = [];
  const avisos: string[] = [];
  const auth: { id: string; senha: string }[] = [];
  const client = {
    async query(texto: string, params: unknown[] = []) {
      sql.push({ texto, params });
      if (texto.includes('professional_challenge_create')) {
        const ok = params[2] === opcoes.aplicavel;
        return { rows: ok ? [{ out_user_id: 'u1', out_auth_user_id: 'a1', out_email: EMAIL }] : [] };
      }
      if (texto.includes('password_reset_peek')) {
        const ok = opcoes.peek !== false;
        return { rows: ok ? [{ out_user_id: 'u1', out_auth_user_id: 'a1', out_email: EMAIL, out_purpose: 'password_reset' }] : [] };
      }
      if (texto.includes('password_reset_consume')) {
        const ok = opcoes.consome !== false;
        return { rows: ok ? [{ out_user_id: 'u1', out_email: EMAIL, out_purpose: 'password_reset' }] : [] };
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
      auth.push({ id, senha });
    },
    async signInWithPassword() {
      return null;
    },
  };
  const mail = {
    async recoveryLink(email: string, token: string, purpose: string) {
      envios.push({ email, token, purpose });
    },
    async verificationCode(email: string, token: string) {
      envios.push({ email, token, purpose: 'professional_verify' });
    },
    async passwordChangedNotice(email: string) {
      avisos.push(email);
    },
  };
  const adaptador = new PgProfessionalRecovery({
    client: client as never,
    gateway,
    mail: mail as never,
    pepperEmail: 'p'.repeat(32),
    newId: () => '00000000-0000-4000-8000-000000000001',
    newSecret: () => TOKEN,
    newCode: () => '482913',
  });
  return { adaptador, sql, envios, auth, avisos };
}

describe('PgProfessionalRecovery.requestRecovery', () => {
  it('profissional: cria password_reset e envia o link', async () => {
    const m = montar({ aplicavel: 'password_reset' });
    await m.adaptador.requestRecovery(EMAIL, T0);
    expect(m.envios).toEqual([{ email: EMAIL, token: TOKEN, purpose: 'password_reset' }]);
  });

  it('cliente verificado sem perfil: cai para professional_activate (cliente que vira profissional)', async () => {
    const m = montar({ aplicavel: 'professional_activate' });
    await m.adaptador.requestRecovery(EMAIL, T0);
    expect(m.envios.map((e) => e.purpose)).toEqual(['professional_activate']);
  });

  it('conta inexistente: nada enviado; o token em claro nunca vai ao banco', async () => {
    const m = montar({ aplicavel: null });
    await m.adaptador.requestRecovery(EMAIL, T0);
    expect(m.envios).toEqual([]);
    const passados = m.sql.flatMap((s) => s.params);
    expect(passados).not.toContain(TOKEN);
    expect(passados).toContain(challengeSha256Hex(TOKEN));
  });
});

describe('PgProfessionalRecovery.resendVerification (CA-H016-09)', () => {
  it('conta profissional nao verificada: cria professional_verify e envia o link', async () => {
    const m = montar({ aplicavel: null });
    const m2 = montar({ aplicavel: 'professional_verify' });
    await m2.adaptador.resendVerification(EMAIL, T0);
    expect(m2.envios).toEqual([{ email: EMAIL, token: '482913', purpose: 'professional_verify' }]);
    expect(m.envios).toEqual([]);
  });

  it('conta que nao se aplica: nada enviado', async () => {
    const m = montar({ aplicavel: null });
    await m.adaptador.resendVerification(EMAIL, T0);
    expect(m.envios).toEqual([]);
  });
});

describe('PgProfessionalRecovery.resetPassword (aviso de senha alterada, 33 §6.1)', () => {
  it('troca bem-sucedida envia o aviso para o e-mail da conta', async () => {
    const m = montar({});
    await m.adaptador.resetPassword(TOKEN, 'senha-sintetica-forte-2099', T0);
    expect(m.avisos).toEqual([EMAIL]);
  });
});

describe('PgProfessionalRecovery.resetPassword', () => {
  it('ordem: confere o link, troca no Auth, consome e zera o contador de login', async () => {
    const m = montar({});
    expect(await m.adaptador.resetPassword(TOKEN, 'senha-sintetica-forte-2099', T0)).toBe(true);
    expect(m.auth).toEqual([{ id: 'a1', senha: 'senha-sintetica-forte-2099' }]);
    const textos = m.sql.map((s) => s.texto);
    expect(textos.findIndex((t) => t.includes('password_reset_peek'))).toBeLessThan(
      textos.findIndex((t) => t.includes('password_reset_consume')),
    );
    expect(textos.some((t) => t.includes('professional_login_success'))).toBe(true);
  });

  it('link que nao serve: false, sem tocar no Auth', async () => {
    const m = montar({ peek: false });
    expect(await m.adaptador.resetPassword(TOKEN, 'senha-sintetica-forte-2099', T0)).toBe(false);
    expect(m.auth).toEqual([]);
  });

  it('corrida no consumo: false (a senha ja foi trocada; risco registrado no desenho)', async () => {
    const m = montar({ consome: false });
    expect(await m.adaptador.resetPassword(TOKEN, 'senha-sintetica-forte-2099', T0)).toBe(false);
    expect(m.auth).toHaveLength(1);
  });

  it('peekReset devolve so o e-mail, sem o id do Auth', async () => {
    const m = montar({});
    expect(await m.adaptador.peekReset(TOKEN, T0)).toEqual({ email: EMAIL });
  });
});
