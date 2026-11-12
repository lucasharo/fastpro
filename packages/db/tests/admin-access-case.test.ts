// H-073 (Issue 83) | Adaptadores Pg do caso de acesso e do step-up (src/admin-access-case.ts): cliente falso, sem banco.
// Confere SQL e parametros (hash do segredo, nunca o segredo; instantes em ISO) e o mapeamento das linhas.
import { describe, expect, it } from 'vitest';
import { PgAccessCasePort, PgAdminSessionRepository } from '../src/admin-access-case.js';
import { hashSessionSecret } from '../src/session.js';

type Call = { text: string; params: unknown[] };

function fakeClient(respostas: Record<string, unknown>[][] | Record<string, unknown>[] = []) {
  const calls: Call[] = [];
  const filas = Array.isArray(respostas[0]) ? [...(respostas as Record<string, unknown>[][])] : null;
  const fixas = filas ? null : (respostas as Record<string, unknown>[]);
  return {
    calls,
    client: {
      async query(text: string, params: unknown[] = []) {
        calls.push({ text, params });
        const rows = filas ? (filas.shift() ?? []) : (fixas ?? []);
        return { rows };
      },
    },
  };
}

const SEGREDO = 'SEGREDO-SINTETICO-H073-ADAPTER-zq-0000000000';
const ATOR = '6f1c2b7a-9d4e-4a3b-8c2d-1e0f9a8b7c6d';
const CASO = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CONV = '11111111-2222-4333-8444-555555555555';
const NOW = Date.parse('2099-06-01T12:00:00.000Z');
const JUST = 'motivo sintetico com mais de vinte caracteres';

describe('PgAccessCasePort: SQL, parametros e mapeamento', () => {
  it('open chama access_case_open com hash do segredo e instante ISO; nao devolve nada', async () => {
    const { client, calls } = fakeClient([[{ id: CASO }]]);
    await new PgAccessCasePort(client).open({
      actorUserId: ATOR,
      secret: SEGREDO,
      caseId: CASO,
      conversationId: CONV,
      justification: JUST,
      nowMs: NOW,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain('private.access_case_open(');
    expect(calls[0]?.params).toEqual([ATOR, hashSessionSecret(SEGREDO), CONV, JUST, CASO, new Date(NOW).toISOString()]);
    expect(JSON.stringify(calls)).not.toContain(SEGREDO);
  });

  it('approve aprova e le o vencimento gravado pelo banco (approved_at + 30 min)', async () => {
    const expira = new Date(NOW + 30 * 60 * 1000);
    const { client, calls } = fakeClient([[], [{ expires_at: expira }]]);
    const r = await new PgAccessCasePort(client).approve({ actorUserId: ATOR, secret: SEGREDO, caseId: CASO, nowMs: NOW });
    expect(r).toEqual({ expiresAtMs: NOW + 30 * 60 * 1000 });
    expect(calls[0]?.text).toContain('private.access_case_approve(');
    expect(calls[0]?.params).toEqual([ATOR, hashSessionSecret(SEGREDO), CASO, new Date(NOW).toISOString()]);
    expect(calls[1]?.text).toContain('from app.access_case');
    expect(calls[1]?.params).toEqual([CASO]);
  });

  it('approve sem vencimento legivel no banco: erro, nao um valor inventado', async () => {
    const { client } = fakeClient([[], []]);
    await expect(
      new PgAccessCasePort(client).approve({ actorUserId: ATOR, secret: SEGREDO, caseId: CASO, nowMs: NOW }),
    ).rejects.toThrow('expira_invalido');
  });

  it('close chama access_case_close (sem sessao, que a rota ja validou pela guarda) com o instante', async () => {
    const { client, calls } = fakeClient([[{ ok: true }]]);
    await new PgAccessCasePort(client).close({ actorUserId: ATOR, secret: SEGREDO, caseId: CASO, nowMs: NOW });
    expect(calls[0]?.text).toContain('private.access_case_close(');
    expect(calls[0]?.params).toEqual([ATOR, CASO, new Date(NOW).toISOString()]);
  });

  it('list mapeia so os cinco campos de 60 §1; expiracao nula vira null; campos extras nao saem', async () => {
    const linhas = [
      {
        out_id: CASO,
        out_estado: 'pendente',
        out_scope_id: CONV,
        out_justificativa: JUST,
        out_expires_at: null,
        out_participantes: ['pessoa-sintetica'],
      },
      {
        out_id: 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        out_estado: 'ativo',
        out_scope_id: CONV,
        out_justificativa: JUST,
        out_expires_at: new Date(NOW + 60 * 1000),
      },
    ];
    const { client, calls } = fakeClient([linhas]);
    const itens = await new PgAccessCasePort(client).list({ actorUserId: ATOR, secret: SEGREDO, canAuthorize: true, nowMs: NOW });
    expect(calls[0]?.text).toContain('private.access_case_list(');
    expect(calls[0]?.params).toEqual([ATOR, hashSessionSecret(SEGREDO), new Date(NOW).toISOString()]);
    expect(itens).toEqual([
      { id: CASO, estado: 'pendente', scope_id: CONV, justificativa: JUST, expires_at: null },
      {
        id: 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        estado: 'ativo',
        scope_id: CONV,
        justificativa: JUST,
        expires_at: new Date(NOW + 60 * 1000).toISOString(),
      },
    ]);
    expect(JSON.stringify(itens)).not.toContain('pessoa-sintetica');
  });

  it('list com linha sem campo obrigatorio: erro sem eco do valor', async () => {
    const { client } = fakeClient([[{ out_id: CASO, out_estado: '', out_scope_id: CONV, out_justificativa: JUST }]]);
    await expect(
      new PgAccessCasePort(client).list({ actorUserId: ATOR, secret: SEGREDO, canAuthorize: false, nowMs: NOW }),
    ).rejects.toThrow('estado_invalido');
  });
});

describe('PgAdminSessionRepository: guarda, assunto e avanco de totp_at', () => {
  it('guard faz uma consulta com hash, mapeia papeis, permissoes, totp_at e validade', async () => {
    const totp = new Date(NOW - 5 * 60 * 1000);
    const expira = new Date(NOW + 2 * 60 * 60 * 1000);
    const { client, calls } = fakeClient([
      [{ out_user_id: ATOR, out_roles: ['superadmin'], out_permissions: ['case.authorize_sensitive'], out_totp_at: totp, out_expires_at: expira }],
    ]);
    const linha = await new PgAdminSessionRepository(client).guard(SEGREDO, NOW);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain('private.admin_guard(');
    expect(calls[0]?.text).toContain('private.admin_session_expiry(');
    expect(calls[0]?.params).toEqual([hashSessionSecret(SEGREDO), new Date(NOW).toISOString()]);
    expect(linha).toEqual({
      userId: ATOR,
      roles: ['superadmin'],
      permissions: ['case.authorize_sensitive'],
      aal2: true,
      active: true,
      expiresAtMs: expira.getTime(),
      totpAtMs: totp.getTime(),
    });
  });

  it('guard sem linha (sessao invalida, vencida ou revogada) devolve nulo', async () => {
    const { client } = fakeClient([[]]);
    expect(await new PgAdminSessionRepository(client).guard(SEGREDO, NOW)).toBeNull();
  });

  it('sessionSubject mapeia conta da sessao; sem linha, nulo', async () => {
    const { client, calls } = fakeClient([[{ out_user_id: ATOR, out_email: 'admin.sintetico@example.test', out_auth_user_id: CASO }], []]);
    const repo = new PgAdminSessionRepository(client);
    expect(await repo.sessionSubject(SEGREDO, NOW)).toEqual({
      userId: ATOR,
      email: 'admin.sintetico@example.test',
      authUserId: CASO,
    });
    expect(calls[0]?.text).toContain('private.admin_session_subject(');
    expect(await repo.sessionSubject(SEGREDO, NOW)).toBeNull();
  });

  it('stepUp so devolve verdadeiro quando o banco confirma; sessao invalida = falso', async () => {
    const { client, calls } = fakeClient([[{ ok: true }], [{ ok: false }]]);
    const repo = new PgAdminSessionRepository(client);
    expect(await repo.stepUp(SEGREDO, NOW)).toBe(true);
    expect(await repo.stepUp(SEGREDO, NOW)).toBe(false);
    expect(calls[0]?.text).toContain('private.admin_step_up(');
    expect(calls[0]?.params).toEqual([hashSessionSecret(SEGREDO), new Date(NOW).toISOString()]);
    expect(JSON.stringify(calls)).not.toContain(SEGREDO);
  });
});
