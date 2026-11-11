// H-102 | Testes puros do login e da guarda admin (docs/factory/54-DESENHO-H102.md §3, §4, §7).
// T-H102-03 (login: mesma recusa para cada causa; 429 apos o limite; sucesso com cookie exato, sem
// Domain, sem tokens do provedor) e T-H102-04 (guarda: 404 identico para sem cookie, cookie de cliente,
// vencida, revogada, sem papel, desativada e rota inexistente; 403 para papel sem permissao, sem efeito;
// origem invalida antes da guarda; uma consulta ao repositorio por requisicao).
// Sem rede, sem banco, relogio injetado. Valores sinteticos.
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  ADMIN_CREDENTIALS_INVALID,
  ADMIN_NOT_FOUND,
  ADMIN_PERMISSION_DENIED,
  ADMIN_ORIGIN_INVALID,
  ADMIN_RATE_LIMITED,
  ADMIN_ROUTES_H102,
  ADMIN_SESSION_COOKIE,
  adminSessionCookieHeader,
  guardAdminRequest,
  loginAdmin,
  type AdminGuardRequest,
} from '../src/admin/index.js';
import { createFakeWorld, totp6, type FakeWorld } from './admin-fakes.js';

const SENHA = 'senha-sintetica-2099';
const IP = '203.0.113.10';
const BASE = 'https://admin.example.test';
const CABECALHOS_OK = { contentType: 'application/json', origin: BASE, secFetchSite: 'same-origin' };

/** Conta ativa de teste: credencial enrolada no provedor, staff ativo e papeis dados. */
async function contaAtiva(world: FakeWorld, email: string, papeis: string[], status = 'ativo') {
  const acc = await world.auth.enrollUser(email, SENHA);
  if (acc === null) throw new Error('setup: conta ja existe');
  const codigo = totp6(acc.secret, Math.floor(world.clock / 1000));
  await world.auth.confirmEnrollment(email, SENHA, codigo);
  const userId = `user-${acc.authUserId}`;
  world.staff.set(userId, { status, authUserId: acc.authUserId, origin: 'bootstrap' });
  world.roles.set(userId, new Set(papeis));
  world.accounts.add(email);
  return { userId, acc, secret: acc.secret };
}

function login(world: FakeWorld, email: string, password: string, code: string, ip = IP) {
  return loginAdmin({ email, password, code, ip }, { repo: world.repo, auth: world.auth, limits: world.limits, log: (e) => world.logs.push(e) }, world.clock);
}

function codigoAgora(secret: string, world: FakeWorld): string {
  return totp6(secret, Math.floor(world.clock / 1000));
}

describe('RFC 6238: vetor de teste do gerador de TOTP usado pelos testes', () => {
  it('SHA-1 com segredo ASCII de 20 bytes, t = 59 s, 6 digitos = 287082', () => {
    expect(totp6('12345678901234567890', 59)).toBe('287082');
  });
});

describe('T-H102-03 login admin', () => {
  it('causas diferentes devolvem o MESMO 401 credenciais_invalidas (uniforme)', async () => {
    const world = createFakeWorld();
    await contaAtiva(world, 'ativo@example.test', ['auditor']);
    const naoAdmin = await world.auth.enrollUser('cliente@example.test', SENHA);
    if (naoAdmin === null) throw new Error('setup');
    await world.auth.confirmEnrollment('cliente@example.test', SENHA, codigoAgora(naoAdmin.secret, world));
    world.accounts.add('cliente@example.test');
    const pendente = await contaAtiva(world, 'pendente@example.test', ['auditor'], 'pendente_mfa');
    const semPapel = await contaAtiva(world, 'semrole@example.test', []);
    expect(pendente.userId).toBeTruthy();
    expect(semPapel.userId).toBeTruthy();

    const casos: Array<[string, string, string, string]> = [
      ['inexistente', 'ninguem@example.test', SENHA, '000000'],
      ['nao-admin', 'cliente@example.test', SENHA, codigoAgora(naoAdmin.secret, world)],
      ['pendente_mfa', 'pendente@example.test', SENHA, codigoAgora(pendente.secret, world)],
      ['sem papel', 'semrole@example.test', SENHA, codigoAgora(semPapel.secret, world)],
      ['senha errada', 'ativo@example.test', 'senha-errada-2099', '000000'],
      ['codigo errado', 'ativo@example.test', SENHA, '000000'],
    ];
    for (const [i, [nome, email, senha, codigo]] of casos.entries()) {
      const r = await login(world, email, senha, codigo, `198.51.100.${i + 1}`);
      expect(r, nome).toEqual(ADMIN_CREDENTIALS_INVALID);
      expect(r.setCookie, nome).toBeUndefined();
    }
  });

  it('sexta falha dentro da janela recebe 429 antes de qualquer checagem de senha', async () => {
    const world = createFakeWorld();
    const acc = await contaAtiva(world, 'limite@example.test', ['auditor']);
    for (let i = 0; i < 5; i++) {
      const r = await login(world, 'limite@example.test', 'senha-errada-2099', '000000', `198.51.100.${50 + i}`);
      expect(r).toEqual(ADMIN_CREDENTIALS_INVALID);
    }
    const antes = world.provider.tokensDiscarded;
    const sexta = await login(world, 'limite@example.test', SENHA, codigoAgora(acc.secret, world), '198.51.100.99');
    expect(sexta).toEqual(ADMIN_RATE_LIMITED);
    expect(world.provider.tokensDiscarded).toBe(antes);
  });

  it('sucesso: cookie exato e HttpOnly, Secure, SameSite=Strict, Path=/, Max-Age=28800, sem Domain', async () => {
    const world = createFakeWorld();
    const { acc, secret } = await contaAtiva(world, 'sucesso@example.test', ['auditor']);
    const r = await login(world, 'sucesso@example.test', SENHA, codigoAgora(secret, world), '198.51.100.200');
    expect(r.status).toBe(200);
    expect(r.body.papeis).toEqual(['auditor']);
    const cookie = r.setCookie ?? '';
    expect(cookie).toMatch(/^__Host-fp_admin=[A-Za-z0-9_-]{43}; HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=28800$/);
    expect(cookie).not.toContain('Domain');
    const valor = cookie.split(';')[0]?.split('=')[1] ?? '';
    expect(valor).not.toContain(acc.authUserId);
    expect(valor).not.toContain(secret);
    expect(world.provider.tokensDiscarded).toBeGreaterThan(0);
    expect(world.sessions.size).toBe(1);
  });

  it('cabecalho de sessao recusa segredo fora do formato', () => {
    expect(() => adminSessionCookieHeader('curto')).toThrow();
    expect(adminSessionCookieHeader('A'.repeat(43))).toContain(`${ADMIN_SESSION_COOKIE}=`);
  });
});

describe('T-H102-04 guarda admin', () => {
  async function sessaoDe(papeis: string[]) {
    const world = createFakeWorld();
    const email = `g${randomBytes(3).toString('hex')}@example.test`;
    const { userId } = await contaAtiva(world, email, papeis);
    const s = await world.repo.openSession(userId, world.clock);
    return { world, secret: s.secret, userId };
  }

  const deps = (world: FakeWorld) => ({ repo: world.repo, registry: ADMIN_ROUTES_H102, baseUrl: BASE });
  const req = (secret: string | null, path = '/v1/admin/invites', method: AdminGuardRequest['method'] = 'POST', headers = CABECALHOS_OK): AdminGuardRequest => ({
    method,
    path,
    secret,
    headers,
  });

  it('404 identico para: sem cookie, cookie de cliente, vencida, revogada, desativada, sem papel e rota inexistente', async () => {
    const { world, secret } = await sessaoDe(['superadmin']);
    const d = deps(world);
    const respostas: unknown[] = [];
    const pega = async (r: AdminGuardRequest) => {
      const out = await guardAdminRequest(r, d, world.clock);
      expect(out.kind).toBe('recusada');
      if (out.kind === 'recusada') respostas.push(out.response);
      return out;
    };

    await pega(req(null));
    await pega(req(randomBytes(32).toString('base64url')));
    await pega(req(secret, '/v1/admin/nao-existe'));

    const expirada = await sessaoDe(['superadmin']);
    expirada.world.sessions.get(expirada.secret)!.expiresAtMs = expirada.world.clock - 1;
    await pega(req(expirada.secret));

    const revogada = await sessaoDe(['superadmin']);
    revogada.world.sessions.get(revogada.secret)!.revoked = true;
    await pega(req(revogada.secret));

    const semPapel = await sessaoDe(['superadmin']);
    semPapel.world.roles.set(semPapel.userId, new Set());
    await pega(req(semPapel.secret));

    const desativada = await sessaoDe(['superadmin']);
    desativada.world.staff.set(desativada.userId, { status: 'desativado', authUserId: 'x', origin: 'bootstrap' });
    await pega(req(desativada.secret));

    expect(respostas.length).toBe(7);
    for (const r of respostas) {
      expect(r).toEqual(ADMIN_NOT_FOUND);
    }
  });

  it('403 permission_denied para papel sem a permissao da rota; nenhuma escrita', async () => {
    const { world, secret } = await sessaoDe(['auditor']);
    const invitesAntes = world.invites.length;
    const out = await guardAdminRequest(req(secret), deps(world), world.clock);
    expect(out).toEqual({ kind: 'recusada', response: ADMIN_PERMISSION_DENIED });
    expect(world.invites.length).toBe(invitesAntes);
    expect(world.calls.guard).toBe(1);
  });

  it('papel com a permissao: autorizada, com papeis lidos do repositorio', async () => {
    const { world, secret } = await sessaoDe(['superadmin']);
    const out = await guardAdminRequest(req(secret), deps(world), world.clock);
    expect(out.kind).toBe('autorizada');
    if (out.kind === 'autorizada') expect(out.roles).toEqual(['superadmin']);
    expect(world.calls.guard).toBe(1);
  });

  it('mutacao com origem invalida e sessao valida: 403 origem_invalida, depois da checagem de sessao e sem escrita', async () => {
    const { world, secret } = await sessaoDe(['superadmin']);
    const invitesAntes = world.invites.length;
    const semOrigem = await guardAdminRequest(
      req(secret, '/v1/admin/invites', 'POST', { ...CABECALHOS_OK, origin: 'https://outro.example.test' }),
      deps(world),
      world.clock,
    );
    expect(semOrigem).toEqual({ kind: 'recusada', response: ADMIN_ORIGIN_INVALID });
    const semJson = await guardAdminRequest(
      req(secret, '/v1/admin/invites', 'POST', { ...CABECALHOS_OK, contentType: 'text/plain' }),
      deps(world),
      world.clock,
    );
    expect(semJson).toEqual({ kind: 'recusada', response: ADMIN_ORIGIN_INVALID });
    expect(world.calls.guard).toBe(2);
    expect(world.invites.length).toBe(invitesAntes);
  });

  it('rota nao publica sem sessao valida: 404 mesmo com origem invalida (sessao e papel antes da Origin)', async () => {
    const { world } = await sessaoDe(['superadmin']);
    const semCookie = await guardAdminRequest(
      req(null, '/v1/admin/invites', 'POST', { ...CABECALHOS_OK, origin: 'https://outro.example.test' }),
      deps(world),
      world.clock,
    );
    expect(semCookie).toEqual({ kind: 'recusada', response: ADMIN_NOT_FOUND });
    const cookieDeCliente = await guardAdminRequest(
      req(randomBytes(32).toString('base64url'), '/v1/admin/invites', 'POST', {
        ...CABECALHOS_OK,
        origin: 'https://outro.example.test',
      }),
      deps(world),
      world.clock,
    );
    expect(cookieDeCliente).toEqual({ kind: 'recusada', response: ADMIN_NOT_FOUND });
    // Sem cookie a guarda nem consulta o banco; com cookie desconhecido, consulta uma vez.
    expect(world.calls.guard).toBe(1);
  });

  it('rota publica com origem invalida: 403 origem_invalida (a checagem de Origin vale para mutacao publica)', async () => {
    const { world } = await sessaoDe(['superadmin']);
    const r = await guardAdminRequest(
      req(null, '/v1/admin/auth/login', 'POST', { ...CABECALHOS_OK, origin: 'https://outro.example.test' }),
      deps(world),
      world.clock,
    );
    expect(r).toEqual({ kind: 'recusada', response: ADMIN_ORIGIN_INVALID });
  });
});
