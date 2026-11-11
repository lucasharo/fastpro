// H-102 | Testes puros de convite e ativacao da conta admin (docs/factory/54-DESENHO-H102.md §2, §7).
// T-H102-01 (convite: validade, uso, invalidacao, inexistente e malformado; papel superadmin sem
// aprovacao; e-mail com conta) e T-H102-02 (ativacao: passo 1 nao consome; cinco codigos errados
// invalidam; codigo certo ativa com os papeis do convite e nao abre sessao; reenvio invalida o anterior).
// Sem rede, sem banco. Relogio injetado. E-mails e senhas sinteticos.
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  ADMIN_INVITE_INVALID,
  ADMIN_INVITE_TTL_MS,
  confirmAdminInvite,
  issueAdminInvite,
  startAdminInvite,
  type AdminInviteDeps,
} from '../src/admin/index.js';
import { createFakeWorld, SYNTH_NOW, totp6, type FakeWorld } from './admin-fakes.js';

const SENHA = 'senha-sintetica-2099';
const tokenNovo = () => randomBytes(32).toString('base64url');

function depsDe(world: FakeWorld, token = tokenNovo()): AdminInviteDeps {
  return {
    repo: world.repo,
    auth: world.auth,
    newToken: () => token,
    log: (e) => world.logs.push(e),
  };
}

function aprovacao(world: FakeWorld, id: string, requestedBy: string) {
  world.approvals.set(id, {
    id,
    requestedBy,
    subjectId: null,
    action: 'papel_superadmin',
    detail: 'superadmin',
    status: 'aprovada',
    consumed: false,
    expiresAtMs: SYNTH_NOW + 24 * 3600 * 1000,
  });
}

describe('T-H102-01 convite recusado: um unico 400, sem Set-Cookie e uma consulta ao repositorio', () => {
  const casos: Array<{ nome: string; token: string; prepara: (w: FakeWorld, t: string) => void }> = [
    {
      nome: 'expirado (72 h + 1 s)',
      token: tokenNovo(),
      prepara: (w, t) =>
        w.seedInvite({
          token: t,
          email: 'a1@example.test',
          createdMs: SYNTH_NOW - ADMIN_INVITE_TTL_MS - 1000,
          expiresAtMs: SYNTH_NOW - 1000,
        }),
    },
    {
      nome: 'usado',
      token: tokenNovo(),
      prepara: (w, t) => w.seedInvite({ token: t, email: 'a2@example.test', state: 'usado' }),
    },
    {
      nome: 'invalidado',
      token: tokenNovo(),
      prepara: (w, t) => w.seedInvite({ token: t, email: 'a3@example.test', state: 'invalidado' }),
    },
    { nome: 'inexistente', token: tokenNovo(), prepara: () => undefined },
    { nome: 'malformado', token: 'abc', prepara: () => undefined },
  ];

  for (const caso of casos) {
    it(`convite ${caso.nome}: resposta identica ao de convite invalido`, async () => {
      const world = createFakeWorld();
      caso.prepara(world, caso.token);
      const antes = world.calls.lookup;
      const inicio = await startAdminInvite({ token: caso.token, password: SENHA }, depsDe(world), SYNTH_NOW);
      expect(inicio).toEqual(ADMIN_INVITE_INVALID);
      expect(inicio.setCookie).toBeUndefined();
      expect(world.calls.lookup - antes).toBe(1);

      const fim = await confirmAdminInvite(
        { token: caso.token, password: SENHA, code: '000000' },
        depsDe(world),
        SYNTH_NOW,
      );
      expect(fim).toEqual(ADMIN_INVITE_INVALID);
      expect(fim.setCookie).toBeUndefined();
      expect(world.sessions.size).toBe(0);
    });
  }

  it('papel superadmin sem aprovacao aprovada do solicitante e recusado (422), sem gravar convite', async () => {
    const world = createFakeWorld();
    const r = await issueAdminInvite(
      { inviterId: 'admin-1', email: 'novo@example.test', roles: ['superadmin'], approvalRequestId: null },
      depsDe(world),
      SYNTH_NOW,
    );
    expect(r.status).toBe(422);
    expect(r.body).toEqual({ code: 'aprovacao_invalida' });
    expect(world.calls.issue).toBe(0);
  });

  it('papel superadmin com aprovacao aprovada: convite emitido uma vez; a mesma aprovacao nao serve de novo', async () => {
    const world = createFakeWorld();
    aprovacao(world, 'apr-1', 'admin-1');
    const ok = await issueAdminInvite(
      { inviterId: 'admin-1', email: 'sup1@example.test', roles: ['superadmin'], approvalRequestId: 'apr-1' },
      depsDe(world),
      SYNTH_NOW,
    );
    expect(ok.status).toBe(201);
    expect(ok.body).toEqual({ ok: true });
    const reuso = await issueAdminInvite(
      { inviterId: 'admin-1', email: 'sup2@example.test', roles: ['superadmin'], approvalRequestId: 'apr-1' },
      depsDe(world),
      SYNTH_NOW,
    );
    expect(reuso.status).toBe(422);
    expect(reuso.body).toEqual({ code: 'aprovacao_invalida' });
  });

  it('e-mail com conta de app_user e recusado (409 email_indisponivel) antes de qualquer gravacao', async () => {
    const world = createFakeWorld();
    world.seedAccount('cliente@example.test');
    const r = await issueAdminInvite(
      { inviterId: 'admin-1', email: 'Cliente@Example.test', roles: ['auditor'], approvalRequestId: null },
      depsDe(world),
      SYNTH_NOW,
    );
    expect(r).toEqual({ status: 409, body: { code: 'email_indisponivel' }, headers: r.headers });
    expect(world.calls.issue).toBe(0);
  });

  it('emissao nunca devolve o token no corpo da resposta', async () => {
    const world = createFakeWorld();
    const token = tokenNovo();
    const r = await issueAdminInvite(
      { inviterId: 'admin-1', email: 'sem-token@example.test', roles: ['auditor'], approvalRequestId: null },
      depsDe(world, token),
      SYNTH_NOW,
    );
    expect(r.status).toBe(201);
    expect(JSON.stringify(r.body)).not.toContain(token);
  });
});

describe('T-H102-02 ativacao com TOTP', () => {
  it('passo 1 nao consome o convite; cinco codigos errados invalidam; o convite nao reativa', async () => {
    const world = createFakeWorld();
    const token = tokenNovo();
    world.seedInvite({ token, email: 'erro@example.test', roleCodes: ['auditor'] });

    const passo1 = await startAdminInvite({ token, password: SENHA }, depsDe(world, token), SYNTH_NOW);
    expect(passo1.status).toBe(200);
    expect(passo1.body.etapa).toBe('totp');
    expect(world.invites[0]?.state).toBe('aguardando_totp');

    const restantes: unknown[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await confirmAdminInvite({ token, password: SENHA, code: '000000' }, depsDe(world, token), SYNTH_NOW);
      restantes.push(r.body.tentativas_restantes);
      expect(r.body.code).toBe('codigo_invalido');
    }
    expect(restantes).toEqual([4, 3, 2, 1]);

    const quinto = await confirmAdminInvite({ token, password: SENHA, code: '000000' }, depsDe(world, token), SYNTH_NOW);
    expect(quinto).toEqual(ADMIN_INVITE_INVALID);
    expect(world.invites[0]?.state).toBe('invalidado');
    expect(world.invites[0]?.attempts).toBe(5);
  });

  it('codigo certo ativa a conta com os papeis exatos do convite e nao abre sessao', async () => {
    const world = createFakeWorld();
    const token = tokenNovo();
    world.seedInvite({ token, email: 'ok@example.test', roleCodes: ['financeiro', 'auditor'] });

    const passo1 = await startAdminInvite({ token, password: SENHA }, depsDe(world, token), SYNTH_NOW);
    const segredo = String(passo1.body.segredo);
    const codigo = totp6(segredo, Math.floor(SYNTH_NOW / 1000));

    const passo2 = await confirmAdminInvite({ token, password: SENHA, code: codigo }, depsDe(world, token), SYNTH_NOW);
    expect(passo2.status).toBe(200);
    expect(passo2.body).toEqual({ ativo: true });
    expect(passo2.setCookie).toBeUndefined();
    expect(world.sessions.size).toBe(0);

    const [userId] = [...world.staff.keys()];
    expect(world.staff.get(userId ?? '')?.status).toBe('ativo');
    expect([...(world.roles.get(userId ?? '') ?? [])].sort()).toEqual(['auditor', 'financeiro']);
    expect(world.invites[0]?.state).toBe('usado');
    expect(await world.repo.lookupInvite(token, SYNTH_NOW)).toBeNull();
  });

  it('reenvio do convite invalida o anterior, mesmo depois do passo 1', async () => {
    const world = createFakeWorld();
    aprovacao(world, 'apr-x', 'admin-1');
    const antigo = tokenNovo();
    await issueAdminInvite(
      { inviterId: 'admin-1', email: 'reenvio@example.test', roles: ['auditor'], approvalRequestId: null },
      depsDe(world, antigo),
      SYNTH_NOW,
    );
    const passo1 = await startAdminInvite({ token: antigo, password: SENHA }, depsDe(world, antigo), SYNTH_NOW);
    expect(passo1.status).toBe(200);

    const novo = tokenNovo();
    const reemitido = await issueAdminInvite(
      { inviterId: 'admin-1', email: 'reenvio@example.test', roles: ['auditor'], approvalRequestId: null },
      depsDe(world, novo),
      SYNTH_NOW,
    );
    expect(reemitido.status).toBe(201);
    expect(await world.repo.lookupInvite(antigo, SYNTH_NOW)).toBeNull();
    expect(await world.repo.lookupInvite(novo, SYNTH_NOW)).not.toBeNull();
  });

  it('senha curta demais e recusada (422) sem consumir o convite', async () => {
    const world = createFakeWorld();
    const token = tokenNovo();
    world.seedInvite({ token, email: 'curta@example.test' });
    const r = await startAdminInvite({ token, password: 'curta' }, depsDe(world, token), SYNTH_NOW);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('senha_invalida');
    expect(world.invites[0]?.state).toBe('emitido');
  });
});
