// H-102 | Testes de dado sensivel fora de respostas e logs (docs/factory/54-DESENHO-H102.md §7; T-H102-07).
// Cada fluxo recebe valores sentinela (e-mail, senha, token, codigo, cookie) e nenhum aparece em
// logs, erros ou corpos de resposta. A resposta de ativacao traz o segredo TOTP por desenho (exibido uma
// vez) e e excluida da varredura do segredo. Os campos proibidos de log (token, password, senha, cookie,
// code, secret) ja estao em packages/observability/src/redact.ts (PII_KEYS e padroes de cabecalho).
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  adminSessionCookieHeader,
  confirmAdminInvite,
  issueAdminInvite,
  loginAdmin,
  startAdminInvite,
  type AdminLogEntry,
  type AdminResponse,
} from '../src/admin/index.js';
import { createFakeWorld, SYNTH_NOW, totp6 } from './admin-fakes.js';

const EMAIL = 'sentinela-email-7f3a@example.test';
const SENHA = 'Senha-Sentinela-2099!';
const CODIGO_ERRADO = '424242';

const CHAVES_LOG = ['evento', 'resultado', 'motivo'];

function varreduraSemSentinela(textos: string[], sentinelas: string[]) {
  for (const t of textos) {
    for (const s of sentinelas) {
      expect(t.includes(s), `sentinela vazou: ${s.slice(0, 6)}...`).toBe(false);
    }
  }
}

describe('T-H102-07 logs e respostas sem dado sensivel', () => {
  it('convite e ativacao: nem e-mail, nem senha, nem token aparecem em logs ou corpos', async () => {
    const world = createFakeWorld();
    const token = randomBytes(32).toString('base64url');
    const deps = { repo: world.repo, auth: world.auth, newToken: () => token, log: (e: AdminLogEntry) => world.logs.push(e) };
    const respostas: AdminResponse[] = [];

    respostas.push(
      await issueAdminInvite(
        { inviterId: 'admin-1', email: EMAIL, roles: ['auditor'], approvalRequestId: null },
        deps,
        SYNTH_NOW,
      ),
    );
    const inicio = await startAdminInvite({ token, password: SENHA }, deps, SYNTH_NOW);
    respostas.push(inicio);
    const segredo = String(inicio.body.segredo);
    respostas.push(
      await confirmAdminInvite(
        { token, password: SENHA, code: CODIGO_ERRADO },
        deps,
        SYNTH_NOW,
      ),
    );
    respostas.push(
      await confirmAdminInvite(
        { token, password: SENHA, code: totp6(segredo, Math.floor(SYNTH_NOW / 1000)) },
        deps,
        SYNTH_NOW,
      ),
    );
    // Convite recusado (token errado): nada de sentinela na resposta.
    respostas.push(await startAdminInvite({ token: 'token-errado', password: SENHA }, deps, SYNTH_NOW));

    // Respostas que nao devem carregar a senha, o e-mail nem o token (o segredo TOTP e excluido de proposito).
    const corpos = respostas
      .filter((r) => r.body.segredo === undefined)
      .map((r) => JSON.stringify(r.body));
    varreduraSemSentinela(corpos, [EMAIL, SENHA, token, CODIGO_ERRADO]);
    varreduraSemSentinela([JSON.stringify(world.logs)], [EMAIL, SENHA, token, CODIGO_ERRADO]);

    for (const entrada of world.logs) {
      expect(Object.keys(entrada).every((k) => CHAVES_LOG.includes(k))).toBe(true);
    }
  });

  it('login: e-mail, senha e codigo nao aparecem em logs, e o cookie so carrega o segredo opaco', async () => {
    const world = createFakeWorld();
    const acc = await world.auth.enrollUser(EMAIL, SENHA);
    if (acc === null) throw new Error('setup');
    await world.auth.confirmEnrollment(EMAIL, SENHA, totp6(acc.secret, Math.floor(world.clock / 1000)));
    const userId = `user-${acc.authUserId}`;
    world.staff.set(userId, { status: 'ativo', authUserId: acc.authUserId, origin: 'bootstrap' });
    world.roles.set(userId, new Set(['auditor']));
    world.accounts.add(EMAIL);

    const erro = await loginAdmin(
      { email: EMAIL, password: 'senha-errada-2099', code: CODIGO_ERRADO, ip: '198.51.100.9' },
      { repo: world.repo, auth: world.auth, limits: world.limits, log: (e) => world.logs.push(e) },
      world.clock,
    );
    expect(erro.status).toBe(401);

    const ok = await loginAdmin(
      { email: EMAIL, password: SENHA, code: totp6(acc.secret, Math.floor(world.clock / 1000)), ip: '198.51.100.10' },
      { repo: world.repo, auth: world.auth, limits: world.limits, log: (e) => world.logs.push(e) },
      world.clock,
    );
    expect(ok.status).toBe(200);
    const cookie = ok.setCookie ?? '';
    expect(cookie).toBe(adminSessionCookieHeader(cookie.split(';')[0]?.split('=')[1] ?? ''));

    varreduraSemSentinela(
      [JSON.stringify(world.logs), JSON.stringify(erro.body), JSON.stringify(ok.body)],
      [EMAIL, SENHA, CODIGO_ERRADO, acc.secret, acc.authUserId],
    );
    expect(cookie).not.toContain(EMAIL);
    expect(cookie).not.toContain(acc.secret);
    for (const entrada of world.logs) {
      expect(Object.keys(entrada).every((k) => CHAVES_LOG.includes(k))).toBe(true);
    }
  });
});
