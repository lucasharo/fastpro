// H-073 / H-102 | Confirmacao recente do segundo fator na sessao admin (docs/factory/60-DESENHO-H073.md §4,
// §5 "T-H073-25" no dominio). Janela de 30 min estrita: 29:59 vale, 30:00 exige nova prova.
// Sem rede, sem banco, relogio injetado. Valores sinteticos (@example.test). Sem senha real.
import { describe, it, expect } from 'vitest';
import {
  ADMIN_CREDENTIALS_INVALID,
  ADMIN_NOT_FOUND,
  ADMIN_ORIGIN_INVALID,
  ADMIN_RATE_LIMITED,
  ADMIN_TOTP_RECENT_MS,
  isTotpRecent,
  stepUpAdmin,
  type AdminAuthPort,
  type AdminStepUpRequest,
} from '../src/admin/index.js';
import { createFakeWorld, joinedLogs, totp6, type FakeWorld } from './admin-fakes.js';

const SENHA = 'senha-sintetica-2099';
const IP = '203.0.113.20';
const BASE = 'https://admin.example.test';
const CABECALHOS_OK = { contentType: 'application/json', origin: BASE, secFetchSite: 'same-origin' };
const MIN = 60 * 1000;

/** Conta ativa com papel, sessao aberta no relogio atual (login exige TOTP, entao totp_at = agora). */
async function sessaoAtiva(world: FakeWorld, email: string, papeis: string[] = ['suporte']) {
  const acc = await world.auth.enrollUser(email, SENHA);
  if (acc === null) throw new Error('setup: conta ja existe');
  await world.auth.confirmEnrollment(email, SENHA, totp6(acc.secret, Math.floor(world.clock / 1000)));
  const userId = `user-${acc.authUserId}`;
  world.staff.set(userId, { status: 'ativo', authUserId: acc.authUserId, origin: 'bootstrap' });
  world.roles.set(userId, new Set(papeis));
  world.emailByUser.set(userId, email);
  const { secret } = await world.repo.openSession(userId, world.clock);
  return { userId, secret, secretAuth: acc.secret, authUserId: acc.authUserId };
}

function pedido(secret: string | null, over: Partial<AdminStepUpRequest> = {}): AdminStepUpRequest {
  return { secret, headers: CABECALHOS_OK, password: SENHA, code: '000000', ip: IP, ...over };
}

function deps(world: FakeWorld, auth: AdminAuthPort = world.auth) {
  return {
    repo: world.repo,
    auth,
    limits: world.limits,
    log: (e: { evento: string; resultado: string; motivo?: string }) => world.logs.push(e),
    baseUrl: BASE,
  };
}

describe('isTotpRecent (janela de 30 min, estrita)', () => {
  const t0 = Date.parse('2099-01-01T12:00:00.000Z');

  it('a 29:59 a prova ainda e recente', () => {
    expect(isTotpRecent(t0, t0 + 29 * MIN + 59_000)).toBe(true);
  });

  it('aos 30:00 exatos exige nova prova (limite estrito)', () => {
    expect(ADMIN_TOTP_RECENT_MS).toBe(30 * MIN);
    expect(isTotpRecent(t0, t0 + 30 * MIN)).toBe(false);
  });

  it('no instante da prova e depois de 30:00 nega; 1 ms antes do limite passa', () => {
    expect(isTotpRecent(t0, t0)).toBe(true);
    expect(isTotpRecent(t0, t0 + 30 * MIN - 1)).toBe(true);
    expect(isTotpRecent(t0, t0 + 30 * MIN + 1)).toBe(false);
  });
});

describe('stepUpAdmin: confirmacao recente com senha e codigo', () => {
  it('sucesso: avanca totp_at ao agora, responde 200 sem cookie novo e a guarda passa a ver o novo valor', async () => {
    const world = createFakeWorld();
    const s = await sessaoAtiva(world, 'suporte@example.test');
    world.clock += 20 * MIN;
    const code = totp6(s.secretAuth, Math.floor(world.clock / 1000));

    const out = await stepUpAdmin(pedido(s.secret, { code }), deps(world), world.clock);

    expect(out.status).toBe(200);
    expect(out.body).toEqual({ confirmado: true, confirmado_ate: world.clock + ADMIN_TOTP_RECENT_MS });
    expect(out.headers['Cache-Control']).toBe('no-store');
    expect(out.setCookie).toBeUndefined();
    const row = await world.repo.guard(s.secret, world.clock);
    expect(row?.totpAtMs).toBe(world.clock);
  });

  it('a prova so avanca: uma confirmacao com relogio antigo nao recua totp_at', async () => {
    const world = createFakeWorld();
    const s = await sessaoAtiva(world, 'recuo@example.test');
    const tBase = world.clock;
    world.clock += 10 * MIN;
    const code = totp6(s.secretAuth, Math.floor(world.clock / 1000));
    await stepUpAdmin(pedido(s.secret, { code }), deps(world), world.clock);
    const apos = (await world.repo.guard(s.secret, world.clock))?.totpAtMs;
    expect(apos).toBe(world.clock);
    expect(apos).toBeGreaterThan(tBase);
    // Relogio que volta: a fake nao aceita nem recua o valor gravado.
    expect(await world.repo.stepUp(s.secret, tBase)).toBe(true);
    expect((await world.repo.guard(s.secret, world.clock))?.totpAtMs).toBe(apos);
  });

  it('sem cookie, sessao vencida, revogada ou sem papel: 404 identico ao de rota (sem prova no provedor)', async () => {
    const world = createFakeWorld();
    const s = await sessaoAtiva(world, 'sem-sessao@example.test');
    const outra = await sessaoAtiva(world, 'sem-papel@example.test', []);
    const provedorAntes = world.provider.tokensDiscarded;
    const code = totp6(s.secretAuth, Math.floor(world.clock / 1000));
    const tentativa = (secret: string | null) => stepUpAdmin(pedido(secret, { code }), deps(world), world.clock);

    expect(await tentativa(null)).toEqual(ADMIN_NOT_FOUND);
    expect(await tentativa('segredo-inexistente-0000000000000000000000000000')).toEqual(ADMIN_NOT_FOUND);

    world.sessions.get(s.secret)!.revoked = true;
    expect(await tentativa(s.secret)).toEqual(ADMIN_NOT_FOUND);
    world.sessions.get(s.secret)!.revoked = false;

    // Conta sem papel ativo (sessao ainda valida no relogio atual): a guarda recusa com 404.
    expect(await tentativa(outra.secret)).toEqual(ADMIN_NOT_FOUND);
    expect(world.provider.tokensDiscarded).toBe(provedorAntes);

    world.clock += 9 * 60 * 60 * 1000;
    const codigoTarde = totp6(s.secretAuth, Math.floor(world.clock / 1000));
    expect(
      await stepUpAdmin(pedido(s.secret, { code: codigoTarde }), deps(world), world.clock),
    ).toEqual(ADMIN_NOT_FOUND);
    expect(world.provider.tokensDiscarded).toBe(provedorAntes);
  });

  it('origem invalida: 403 origem_invalida antes de qualquer prova, sem efeito', async () => {
    const world = createFakeWorld();
    const s = await sessaoAtiva(world, 'origem@example.test');
    const tLogin = world.clock;
    const provedorAntes = world.provider.tokensDiscarded;
    world.clock += 20 * MIN;
    const code = totp6(s.secretAuth, Math.floor(world.clock / 1000));
    const out = await stepUpAdmin(
      pedido(s.secret, { code, headers: { ...CABECALHOS_OK, origin: 'https://outro.example.test' } }),
      deps(world),
      world.clock,
    );
    expect(out).toEqual(ADMIN_ORIGIN_INVALID);
    expect(world.provider.tokensDiscarded).toBe(provedorAntes);
    expect((await world.repo.guard(s.secret, world.clock))?.totpAtMs).toBe(tLogin);
  });

  it('senha errada, codigo errado, corpo sem texto ou prova de outra conta: 401 uniforme e nada avanca', async () => {
    const world = createFakeWorld();
    const s = await sessaoAtiva(world, 'falhas@example.test');
    const antes = (await world.repo.guard(s.secret, world.clock))?.totpAtMs;
    world.clock += 5 * MIN;
    const code = totp6(s.secretAuth, Math.floor(world.clock / 1000));
    const d = deps(world);

    const senhaErrada = await stepUpAdmin(pedido(s.secret, { code, password: 'senha-trocada-x' }), d, world.clock);
    const codigoErrado = await stepUpAdmin(pedido(s.secret, { code: '111111' }), d, world.clock);
    const semTexto = await stepUpAdmin(pedido(s.secret, { code: 123456 }), d, world.clock);
    const outraConta: AdminAuthPort = {
      ...world.auth,
      signInWithPasswordAndTotp: async () => ({ authUserId: 'auth-de-outra-pessoa' }),
    };
    const contaDiferente = await stepUpAdmin(pedido(s.secret, { code }), deps(world, outraConta), world.clock);

    for (const out of [senhaErrada, codigoErrado, semTexto, contaDiferente]) {
      expect(out).toEqual(ADMIN_CREDENTIALS_INVALID);
    }
    expect((await world.repo.guard(s.secret, world.clock))?.totpAtMs).toBe(antes);
  });

  it('limite de tentativas: apos 5 falhas no e-mail a prova correta responde 429 sem consultar o provedor', async () => {
    const world = createFakeWorld();
    const s = await sessaoAtiva(world, 'limite@example.test');
    const d = deps(world);
    for (let i = 0; i < 5; i += 1) {
      await stepUpAdmin(pedido(s.secret, { code: '000000' }), d, world.clock);
    }
    const code = totp6(s.secretAuth, Math.floor(world.clock / 1000));
    const out = await stepUpAdmin(pedido(s.secret, { code }), d, world.clock);
    expect(out).toEqual(ADMIN_RATE_LIMITED);
  });

  it('logs e respostas nao contem senha, codigo nem e-mail', async () => {
    const world = createFakeWorld();
    const s = await sessaoAtiva(world, 'logs@example.test');
    const d = deps(world);
    const out = await stepUpAdmin(pedido(s.secret, { code: '999999', password: 'sentinela-senha-x' }), d, world.clock);
    const texto = joinedLogs(world.logs) + JSON.stringify(out);
    expect(texto).not.toContain('sentinela-senha-x');
    expect(texto).not.toContain('999999');
    expect(texto).not.toContain('logs@example.test');
    expect(world.logs.at(-1)).toEqual({ evento: 'confirmacao_admin', resultado: 'recusado', motivo: 'provedor' });
  });
});
