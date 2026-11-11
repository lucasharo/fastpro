// H-102 | Dublês em memoria da area admin para os testes do dominio (T-H102-01..07). Reproduzem a
// semantica das funcoes do banco (convite vivo, tentativas, sessao de 8 h, aprovacao de uso unico)
// e um provedor de autenticacao com TOTP do RFC 6238 e relogio injetado. Sem rede, sem banco.
// Valores sinteticos (@example.test). Nenhum e-mail real, nenhuma chave de ambiente.

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  ADMIN_INVITE_TTL_MS,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  adminPermissionsOf,
  type AdminAuthPort,
  type AdminGuardRecord,
  type AdminInviteRecord,
  type AdminIssueInput,
  type AdminIssueResult,
  type AdminLogEntry,
  type AdminLoginLimits,
  type AdminRepository,
} from '../src/admin/index.js';

export const SYNTH_NOW = Date.parse('2099-01-01T12:00:00.000Z');
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

/** TOTP de 6 digitos (RFC 6238, HMAC-SHA1, passo de 30 s). Usado com o relogio injetado. */
export function totp6(secretAscii: string, unixSeconds: number): string {
  const counter = Math.floor(unixSeconds / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', Buffer.from(secretAscii, 'ascii')).update(buf).digest();
  const off = (h[h.length - 1] ?? 0) & 0x0f;
  const bin =
    (((h[off] ?? 0) & 0x7f) << 24) |
    ((h[off + 1] ?? 0) << 16) |
    ((h[off + 2] ?? 0) << 8) |
    (h[off + 3] ?? 0);
  return String(bin % 1_000_000).padStart(6, '0');
}

export interface FakeInvite {
  readonly id: string;
  readonly token: string;
  readonly kind: 'ativacao' | 'reenrolamento';
  state: 'emitido' | 'aguardando_totp' | 'usado' | 'invalidado';
  readonly roleCodes: readonly string[];
  readonly email: string;
  userId: string | null;
  attempts: number;
  readonly createdMs: number;
  readonly expiresAtMs: number;
  readonly invitedBy: string | null;
  readonly approvalRequestId: string | null;
}

export interface FakeApproval {
  readonly id: string;
  readonly requestedBy: string;
  readonly subjectId: string | null;
  readonly action: 'papel_superadmin' | 'mfa_reenroll';
  readonly detail: string | null;
  status: 'pendente' | 'aprovada' | 'rejeitada' | 'expirada' | 'consumida';
  consumed: boolean;
  readonly expiresAtMs: number;
}

export interface FakeSession {
  readonly userId: string;
  readonly createdMs: number;
  readonly expiresAtMs: number;
  revoked: boolean;
  readonly aal2: boolean;
}

export interface FakeWorld {
  readonly repo: AdminRepository;
  readonly auth: AdminAuthPort;
  readonly limits: AdminLoginLimits;
  readonly logs: AdminLogEntry[];
  readonly invites: FakeInvite[];
  readonly approvals: Map<string, FakeApproval>;
  readonly sessions: Map<string, FakeSession>;
  readonly staff: Map<string, { status: string; authUserId: string; origin: string }>;
  readonly roles: Map<string, Set<string>>;
  readonly accounts: Set<string>;
  readonly calls: { lookup: number; guard: number; issue: number };
  readonly provider: {
    readonly credentials: Map<string, { password: string; secret: string; authUserId: string; enrolled: boolean }>;
    tokensDiscarded: number;
  };
  readonly limitState: { email: Map<string, number>; ip: Map<string, number> };
  clock: number;
  /** Cria um convite como se fosse emitido pelo banco, com tokens sinteticos. */
  seedInvite(p: Partial<FakeInvite> & { token: string; email: string }): FakeInvite;
  /** Cria um usuario do app (conta de cliente ou admin) com e-mail. */
  seedAccount(email: string): void;
}

export function createFakeWorld(startMs: number = SYNTH_NOW): FakeWorld {
  const invites: FakeInvite[] = [];
  const approvals = new Map<string, FakeApproval>();
  const sessions = new Map<string, FakeSession>();
  const staff = new Map<string, { status: string; authUserId: string; origin: string }>();
  const roles = new Map<string, Set<string>>();
  const accounts = new Set<string>();
  const calls = { lookup: 0, guard: 0, issue: 0 };
  const logs: AdminLogEntry[] = [];
  const provider: FakeWorld['provider'] = { credentials: new Map(), tokensDiscarded: 0 };
  const limitState = { email: new Map<string, number>(), ip: new Map<string, number>() };
  const world = { clock: startMs } as FakeWorld;

  const liveInvite = (inv: FakeInvite, now: number): boolean =>
    (inv.state === 'emitido' || inv.state === 'aguardando_totp') && inv.expiresAtMs > now;

  const byToken = (token: string): FakeInvite | undefined =>
    invites.find((i) => i.token === token);

  const activeRoles = (userId: string): string[] => [...(roles.get(userId) ?? new Set<string>())].sort();

  const repo: AdminRepository = {
    async lookupInvite(token: string, nowMs: number): Promise<AdminInviteRecord | null> {
      calls.lookup += 1;
      const inv = byToken(token);
      if (inv === undefined || !liveInvite(inv, nowMs)) return null;
      return {
        id: inv.id,
        kind: inv.kind,
        state: inv.state,
        roleCodes: inv.roleCodes,
        email: inv.email,
        userId: inv.userId,
        attempts: inv.attempts,
        expiresAtMs: inv.expiresAtMs,
      };
    },
    async emailHasAccount(email: string): Promise<boolean> {
      // Mesma excecao do banco: conta pendente de convite vivo do mesmo e-mail nao conta como conta.
      if (!accounts.has(email)) return false;
      const pendente = invites.some(
        (i) => i.email === email && i.state === 'aguardando_totp' && i.expiresAtMs > world.clock,
      );
      return !pendente;
    },
    async issueInvite(input: AdminIssueInput): Promise<AdminIssueResult> {
      calls.issue += 1;
      let approvalRequestId: string | null = null;
      if (input.roles.includes('superadmin')) {
        const a = input.approvalRequestId === null ? undefined : approvals.get(input.approvalRequestId);
        const valida =
          a !== undefined &&
          a.action === 'papel_superadmin' &&
          a.status === 'aprovada' &&
          !a.consumed &&
          a.requestedBy === input.inviterId &&
          a.expiresAtMs > input.nowMs;
        if (!valida || a === undefined) return { ok: false, reason: 'aprovacao_invalida' };
        a.status = 'consumida';
        a.consumed = true;
        approvalRequestId = a.id;
      }
      for (const old of invites) {
        if (old.email === input.email && (old.state === 'emitido' || old.state === 'aguardando_totp')) {
          old.state = 'invalidado';
        }
      }
      invites.push({
        id: `inv-${invites.length + 1}`,
        token: input.token,
        kind: 'ativacao',
        state: 'emitido',
        roleCodes: [...input.roles],
        email: input.email,
        userId: null,
        attempts: 0,
        createdMs: input.nowMs,
        expiresAtMs: input.nowMs + ADMIN_INVITE_TTL_MS,
        invitedBy: input.inviterId,
        approvalRequestId,
      });
      return { ok: true };
    },
    async markWaiting(token, account, nowMs): Promise<boolean> {
      const inv = byToken(token);
      if (inv === undefined || !liveInvite(inv, nowMs)) return false;
      const userId = `user-${account.authUserId}`;
      if (inv.state === 'aguardando_totp') return inv.userId === userId;
      if (!staff.has(userId)) {
        staff.set(userId, { status: 'pendente_mfa', authUserId: account.authUserId, origin: 'convite' });
      }
      accounts.add(account.email);
      inv.state = 'aguardando_totp';
      inv.userId = userId;
      return true;
    },
    async recordCodeFailure(token, nowMs): Promise<number | null> {
      const inv = byToken(token);
      if (inv === undefined || inv.state !== 'aguardando_totp' || !liveInvite(inv, nowMs)) return null;
      inv.attempts += 1;
      if (inv.attempts >= 5) inv.state = 'invalidado';
      return inv.attempts;
    },
    async activateInvite(token, nowMs): Promise<boolean> {
      const inv = byToken(token);
      if (inv === undefined || inv.state !== 'aguardando_totp' || !liveInvite(inv, nowMs)) return false;
      if (inv.userId === null) return false;
      const s = staff.get(inv.userId);
      if (s === undefined || s.status !== 'pendente_mfa') return false;
      staff.set(inv.userId, { ...s, status: 'ativo' });
      const set = roles.get(inv.userId) ?? new Set<string>();
      for (const r of inv.roleCodes) set.add(r);
      roles.set(inv.userId, set);
      inv.state = 'usado';
      return true;
    },
    async findActiveStaff(authUserId) {
      for (const [userId, s] of staff) {
        if (s.authUserId === authUserId && s.status === 'ativo' && activeRoles(userId).length > 0) {
          return { userId, roles: activeRoles(userId) };
        }
      }
      return null;
    },
    async openSession(userId, nowMs) {
      const valorCookie = randomBytes(32).toString('base64url');
      sessions.set(valorCookie, {
        userId,
        createdMs: nowMs,
        expiresAtMs: nowMs + ADMIN_SESSION_MAX_AGE_SECONDS * 1000,
        revoked: false,
        aal2: true,
      });
      return { secret: valorCookie };
    },
    async guard(secret, nowMs): Promise<AdminGuardRecord | null> {
      calls.guard += 1;
      const s = sessions.get(secret);
      if (s === undefined || s.revoked || !s.aal2 || s.expiresAtMs <= nowMs) return null;
      const st = staff.get(s.userId);
      const rs = activeRoles(s.userId);
      if (st === undefined || rs.length === 0) return null;
      return {
        userId: s.userId,
        roles: rs,
        permissions: [...adminPermissionsOf(rs)].sort(),
        aal2: s.aal2,
        active: st.status === 'ativo',
        expiresAtMs: s.expiresAtMs,
      };
    },
  };

  const auth: AdminAuthPort = {
    async enrollUser(email, password) {
      if (provider.credentials.has(email)) return null;
      const segredoTotp = randomBytes(20).toString('hex');
      const authUserId = `auth-${randomBytes(6).toString('hex')}`;
      provider.credentials.set(email, { password, secret: segredoTotp, authUserId, enrolled: false });
      return {
        authUserId,
        secret: segredoTotp,
        otpauthUri: `otpauth://totp/FastPro:${sha(email).slice(0, 8)}?secret=SINTETICO`,
      };
    },
    async confirmEnrollment(email, password, code) {
      const c = provider.credentials.get(email);
      provider.tokensDiscarded += 1;
      if (c === undefined || c.password !== password) return false;
      if (code !== totp6(c.secret, Math.floor(world.clock / 1000))) return false;
      c.enrolled = true;
      return true;
    },
    async signInWithPasswordAndTotp(email, password, code) {
      const c = provider.credentials.get(email);
      provider.tokensDiscarded += 1;
      if (c === undefined || !c.enrolled || c.password !== password) return null;
      if (code !== totp6(c.secret, Math.floor(world.clock / 1000))) return null;
      return { authUserId: c.authUserId };
    },
  };

  const limits: AdminLoginLimits = {
    async counts(input) {
      return {
        email: limitState.email.get(input.email) ?? 0,
        ip: limitState.ip.get(input.ip) ?? 0,
      };
    },
    async recordFailure(input) {
      limitState.email.set(input.email, (limitState.email.get(input.email) ?? 0) + 1);
      limitState.ip.set(input.ip, (limitState.ip.get(input.ip) ?? 0) + 1);
    },
  };

  const filled = Object.assign(world, {
    repo,
    auth,
    limits,
    logs,
    invites,
    approvals,
    sessions,
    staff,
    roles,
    accounts,
    calls,
    provider,
    limitState,
    seedInvite(p: Partial<FakeInvite> & { token: string; email: string }): FakeInvite {
      const inv: FakeInvite = {
        id: p.id ?? `inv-seed-${invites.length + 1}`,
        token: p.token,
        kind: p.kind ?? 'ativacao',
        state: p.state ?? 'emitido',
        roleCodes: p.roleCodes ?? ['auditor'],
        email: p.email,
        userId: p.userId ?? null,
        attempts: p.attempts ?? 0,
        createdMs: p.createdMs ?? world.clock,
        expiresAtMs: p.expiresAtMs ?? world.clock + ADMIN_INVITE_TTL_MS,
        invitedBy: p.invitedBy ?? 'admin-seed',
        approvalRequestId: p.approvalRequestId ?? null,
      };
      invites.push(inv);
      return inv;
    },
    seedAccount(email: string): void {
      accounts.add(email);
    },
  });
  return filled;
}

/** Log sintetico de chave unica: a asserção verifica que nenhum valor sensivel entrou em logs. */
export function joinedLogs(logs: readonly AdminLogEntry[]): string {
  return JSON.stringify(logs);
}
