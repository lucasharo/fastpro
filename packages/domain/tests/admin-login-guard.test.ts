// Testes puros do login por senha e da guarda admin (docs/factory/54-DESENHO-H102.md §3, §4, §7).
// Login (mesma recusa para cada causa; 429 apos o limite; sucesso com cookie exato, sem Domain) e T-H102-04 (guarda: 404 identico para sem cookie, cookie de cliente,
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

describe('RFC 6238: vetor de teste do gerador de TOTP usado pelos testes', () => {
  it('SHA-1 com segredo ASCII de 20 bytes, t = 59 s, 6 digitos = 287082', () => {
    expect(totp6('12345678901234567890', 59)).toBe('287082');
  });
});

describe('login admin por e-mail e senha', () => {
  const ERRADA = ['senha', 'errada', '2099'].join('-');
  const LONGA = SENHA.repeat(10);
  const ENTRADA = { email: 'ativo@example.test', password: SENHA, ip: IP };

  function mundo(opcoes: { sessao?: boolean } = {}) {
    const chamadas: string[] = [];
    const logs: unknown[] = [];
    let vagas = 5;
    const deps = {
      accounts: {
        verify: async (email: string, password: string) => {
          chamadas.push('verify');
          return email === ENTRADA.email && password === SENHA ? { userId: 'adm-1' } : null;
        },
        openSession: async () => (opcoes.sessao === false ? null : { secret: 'A'.repeat(43) }),
      },
      limits: {
        reserve: async () => {
          if (vagas === 0) return false;
          vagas -= 1;
          return true;
        },
        release: async () => {
          vagas += 1;
        },
      },
      log: (e: unknown) => {
        logs.push(e);
      },
    };
    return { deps, chamadas, logs, vagas: () => vagas };
  }

  it('sucesso: cookie HttpOnly, Secure, SameSite=Strict, Path=/, 8 h, sem Domain; a vaga volta', async () => {
    const m = mundo();
    const r = await loginAdmin({ ...ENTRADA, email: '  Ativo@Example.test ' }, m.deps, 1_000);
    expect(r.status).toBe(200);
    expect(r.setCookie).toMatch(/^__Host-fp_admin=[A-Za-z0-9_-]{43}; HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=28800$/);
    expect(m.vagas()).toBe(5);
  });

  it('causas diferentes devolvem o MESMO 401, sem cookie, e gastam uma vaga', async () => {
    const casos = [
      { ...ENTRADA, email: 'ninguem@example.test' },
      { ...ENTRADA, password: ERRADA },
      { ...ENTRADA, password: '' },
      { ...ENTRADA, password: LONGA },
      { ...ENTRADA, password: 123 },
      { ...ENTRADA, email: 'sem-arroba' },
    ];
    for (const caso of casos) {
      const m = mundo();
      expect(await loginAdmin(caso, m.deps, 1_000)).toEqual(ADMIN_CREDENTIALS_INVALID);
      expect(m.vagas()).toBe(4);
    }
    expect(await loginAdmin(ENTRADA, mundo({ sessao: false }).deps, 1_000)).toEqual(ADMIN_CREDENTIALS_INVALID);
  });

  it('acima do limite: 429 antes de conferir a senha', async () => {
    const m = mundo();
    for (let i = 0; i < 5; i++) await loginAdmin({ ...ENTRADA, password: ERRADA }, m.deps, 1_000);
    m.chamadas.length = 0;
    expect(await loginAdmin(ENTRADA, m.deps, 1_000)).toEqual(ADMIN_RATE_LIMITED);
    expect(m.chamadas).toEqual([]);
  });

  it('logs sem e-mail nem senha', async () => {
    const m = mundo();
    await loginAdmin(ENTRADA, m.deps, 1_000);
    await loginAdmin({ ...ENTRADA, password: ERRADA }, m.deps, 1_000);
    const texto = JSON.stringify(m.logs);
    expect(texto).not.toContain(ENTRADA.email);
    expect(texto).not.toContain('senha-');
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
