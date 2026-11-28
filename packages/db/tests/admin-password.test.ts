// Hash scrypt da senha do admin e adaptador do login (sem banco).
import { describe, expect, it } from 'vitest';
import { PgAdminPasswordAccounts } from '../src/admin-password-login.js';
import { hashAdminPassword, verifyAdminPassword } from '../src/admin-password.js';

const SENHA = 'senha-sintetica-2099';

// scrypt gasta CPU de proposito: com a suite inteira em paralelo, 5 s nao bastam.
describe('hash da senha do admin', { timeout: 60_000 }, () => {
  it('grava scrypt com parametros e sal proprio, sem a senha, no formato que o banco aceita', async () => {
    const a = await hashAdminPassword(SENHA);
    const b = await hashAdminPassword(SENHA);
    expect(a).toMatch(/^scrypt\$32768\$8\$3\$[A-Za-z0-9_-]{22,}\$[A-Za-z0-9_-]{43,}$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain(SENHA);
  });

  it('confere a senha certa e recusa errada, sem hash e hash ilegivel', async () => {
    const gravado = await hashAdminPassword(SENHA);
    expect(await verifyAdminPassword(SENHA, gravado)).toBe(true);
    expect(await verifyAdminPassword('senha-errada-2099', gravado)).toBe(false);
    expect(await verifyAdminPassword(SENHA, null)).toBe(false);
    expect(await verifyAdminPassword(SENHA, 'texto-qualquer')).toBe(false);
  });

  it('adaptador: so devolve a conta com a senha certa; o banco nunca recebe a senha', async () => {
    const gravado = await hashAdminPassword(SENHA);
    const params: unknown[] = [];
    const contas = new PgAdminPasswordAccounts({
      query: async (_sql: string, p?: unknown[]) => {
        params.push(...(p ?? []));
        return { rows: [{ out_user_id: 'adm-1', out_password_hash: gravado }] };
      },
    });
    expect(await contas.verify('equipe@example.test', SENHA)).toEqual({ userId: 'adm-1' });
    expect(await contas.verify('equipe@example.test', 'senha-errada-2099')).toBeNull();
    expect(JSON.stringify(params)).not.toContain('senha-');
  });
});
