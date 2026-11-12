// H-105 (Issue 114, docs/factory/80-DESENHO-H105.md §6) | Testes de dominio da dupla aprovacao sem banco:
// T-H105-01 (votos por valor), 02 (solicitante e voto repetido), 03 (matriz papel x rota), 04 (suspensao em
// dois votos), 05 (vencimento visto pela resposta), 06 (aprovador inativo), 09 (estorno aprovado sem rede),
// 11 (sem motivo nas respostas e negacoes identicas). T-H105-07 (corrida real) e T-H105-08 (auditoria na
// mesma transacao) dependem do banco e nao estao aqui; ver a migracao e o teste estatico em @fastpro/db.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-105');
};

import { describe, expect, it } from 'vitest';
import {
  ADMIN_REFUND_APPROVALS_PATH,
  ADMIN_ROUTES,
  ADMIN_ROUTES_H105,
  ADMIN_SUSPENSION_APPROVALS_PATH,
  adminPermissionsOf,
  decideAdminGuard,
  decideDualOpen,
  handleDualCancel,
  handleDualList,
  handleDualOpen,
  handleDualVote,
  resolveAdminRoute,
  votosExigidos,
  type AdminGuardRecord,
  type DualApprovalListItem,
  type DualApprovalPort,
  type DualDeniedDbInput,
  type DualOpenDbInput,
  type DualVoteDbInput,
  type DualVoteResult,
} from '@fastpro/domain';

const T0 = Date.UTC(2099, 0, 1, 12);
const MIN = 60 * 1000;
const H24 = 24 * 60 * MIN;
const PEDIDO = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const PAGAMENTO = '11111111-2222-4333-8444-555555555555';
const PROFISSIONAL = '66666666-7777-4888-8999-000000000000';
const MOTIVO = 'SENTINELA-MOTIVO-H105-zq motivo juridico detalhado';
const SEG = 'example-admin-secret-h105-000000000000000000';

const ROLES = ['superadmin', 'verificacao', 'moderador', 'financeiro', 'suporte', 'auditor'] as const;

function linha(roles: string[], extra: Partial<AdminGuardRecord> = {}): AdminGuardRecord {
  return {
    userId: `u-${roles.join('-') || 'nenhum'}`,
    roles,
    permissions: [...adminPermissionsOf(roles)],
    aal2: true,
    active: true,
    expiresAtMs: T0 + 8 * 60 * MIN,
    totpAtMs: T0,
    ...extra,
  };
}

/** Porta em memoria: registra chamadas e pode responder com um resultado ou erro de banco. */
function portaFake(opcoes: {
  voto?: DualVoteResult | Error;
  lista?: readonly (DualApprovalListItem & { readonly reason?: string })[];
  abrir?: Error;
} = {}) {
  const abertos: DualOpenDbInput[] = [];
  const votos: DualVoteDbInput[] = [];
  const negacoes: DualDeniedDbInput[] = [];
  const port: DualApprovalPort = {
    async open(input) {
      if (opcoes.abrir) throw opcoes.abrir;
      abertos.push(input);
    },
    async vote(input) {
      votos.push(input);
      if (opcoes.voto instanceof Error) throw opcoes.voto;
      return opcoes.voto ?? { status: 'pendente', votes: 1, required: 2 };
    },
    async cancel() {},
    async list() {
      return (opcoes.lista ?? []) as readonly DualApprovalListItem[];
    },
    async recordDenied(input) {
      negacoes.push(input);
    },
  };
  return { port, abertos, votos, negacoes };
}

function erroBanco(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

const deps = (port: DualApprovalPort) => ({ port, newId: () => PEDIDO });

function corpoJson(resposta: { body: Readonly<Record<string, unknown>> }): string {
  return JSON.stringify(resposta.body);
}

describe('T-H105-01 votos exigidos pelo valor (CA-H105-01, 02, 03)', () => {
  it('estorno ate R$ 200,00 pede 1 aprovacao; acima pede 2; suspensao pede sempre 2', () => {
    expect(votosExigidos('estorno', 15000)).toBe(1);
    expect(votosExigidos('estorno', 20000)).toBe(1);
    expect(votosExigidos('estorno', 20001)).toBe(2);
    expect(votosExigidos('suspensao_permanente', null)).toBe(2);
  });

  it('pedido de 20001 centavos abre pendente com 2 exigidas, e a resposta traz a validade de 24 h', async () => {
    const f = portaFake();
    const resposta = await handleDualOpen(
      { row: linha(['financeiro']), secret: SEG, body: { payment_id: PAGAMENTO, amount_cents: 20001, reason: MOTIVO } },
      deps(f.port),
      T0,
      'estorno',
    );
    expect(resposta.status).toBe(201);
    expect(resposta.body).toEqual({
      id: PEDIDO,
      status: 'pendente',
      required_approvals: 2,
      expires_at: new Date(T0 + H24).toISOString(),
    });
    expect(f.abertos[0]?.amountCents).toBe(20001);
  });

  it('valor de 200,00 exatos abre com 1 aprovacao; valor zero ou quebrado e recusado (422) sem banco', async () => {
    const f = portaFake();
    const exato = await handleDualOpen(
      { row: linha(['financeiro']), secret: SEG, body: { payment_id: PAGAMENTO, amount_cents: 20000, reason: MOTIVO } },
      deps(f.port),
      T0,
      'estorno',
    );
    expect(exato.body.required_approvals).toBe(1);
    const zero = await handleDualOpen(
      { row: linha(['financeiro']), secret: SEG, body: { payment_id: PAGAMENTO, amount_cents: 0, reason: MOTIVO } },
      deps(f.port),
      T0,
      'estorno',
    );
    expect(zero.status).toBe(422);
    expect(zero.body).toEqual({ code: 'valor_invalido' });
    const quebrado = await handleDualOpen(
      { row: linha(['financeiro']), secret: SEG, body: { payment_id: PAGAMENTO, amount_cents: 10.5, reason: MOTIVO } },
      deps(f.port),
      T0,
      'estorno',
    );
    expect(quebrado.body).toEqual({ code: 'valor_invalido' });
    expect(f.abertos).toHaveLength(1);
  });
});

describe('T-H105-02 solicitante, voto repetido e suspensao com o mesmo Moderador (CA-H105-04, 05)', () => {
  it('voto do solicitante e recusado com 403 e registrado como autoaprovacao', async () => {
    const f = portaFake({ voto: erroBanco('42501', 'aprovacao_propria') });
    const resposta = await handleDualVote(
      { row: linha(['financeiro']), secret: SEG, approvalId: PEDIDO },
      deps(f.port),
      T0,
      'estorno',
    );
    expect(resposta.status).toBe(403);
    expect(resposta.body).toEqual({ code: 'permission_denied' });
    expect(f.negacoes).toEqual([
      expect.objectContaining({ reasonCode: 'autoaprovacao', approvalId: PEDIDO, family: 'estorno' }),
    ]);
  });

  it('o mesmo aprovador votando de novo e recusado (voto_repetido) e o pedido segue com um voto', async () => {
    const f = portaFake({ voto: erroBanco('23505', 'approval_vote_unico') });
    const resposta = await handleDualVote(
      { row: linha(['financeiro']), secret: SEG, approvalId: PEDIDO },
      deps(f.port),
      T0,
      'estorno',
    );
    expect(resposta.status).toBe(403);
    expect(f.negacoes[0]?.reasonCode).toBe('voto_repetido');
  });

  it('suspensao com o mesmo Moderador duas vezes: a segunda voto e recusada e o pedido continua pendente', async () => {
    const primeiro = portaFake({ voto: { status: 'pendente', votes: 1, required: 2 } });
    const r1 = await handleDualVote(
      { row: linha(['moderador']), secret: SEG, approvalId: PEDIDO },
      deps(primeiro.port),
      T0,
      'suspensao_permanente',
    );
    expect(r1.body).toEqual({ status: 'pendente', votes: 1, required_approvals: 2 });
    const segundo = portaFake({ voto: erroBanco('23505', 'approval_vote_unico') });
    const r2 = await handleDualVote(
      { row: linha(['moderador']), secret: SEG, approvalId: PEDIDO },
      deps(segundo.port),
      T0,
      'suspensao_permanente',
    );
    expect(r2.status).toBe(403);
  });
});

describe('T-H105-03 matriz papel x rota (CA-H105-06)', () => {
  const rota = (metodo: 'GET' | 'POST', caminho: string) => resolveAdminRoute(ADMIN_ROUTES_H105, metodo, caminho);
  const rowDe = (papel: string) => linha([papel]);

  it('Suporte e Auditor nao votam estorno; Financeiro nao pede nem vota suspensao; Superadmin nao faz nenhum dos dois', () => {
    const votoEstorno = rota('POST', `${ADMIN_REFUND_APPROVALS_PATH}/${PEDIDO}/vote`)!;
    const votoSuspensao = rota('POST', `${ADMIN_SUSPENSION_APPROVALS_PATH}/${PEDIDO}/vote`)!;
    const pedirEstorno = rota('POST', ADMIN_REFUND_APPROVALS_PATH)!;
    const pedirSuspensao = rota('POST', ADMIN_SUSPENSION_APPROVALS_PATH)!;
    const negada = (row: AdminGuardRecord, permissao: string) => {
      const out = decideAdminGuard(row, permissao as never, T0);
      return out.kind === 'recusada' && out.response.status === 403 && out.response.body.code === 'permission_denied';
    };
    expect(negada(rowDe('suporte'), votoEstorno.permission)).toBe(true);
    expect(negada(rowDe('auditor'), votoEstorno.permission)).toBe(true);
    expect(negada(rowDe('financeiro'), pedirSuspensao.permission)).toBe(true);
    expect(negada(rowDe('financeiro'), votoSuspensao.permission)).toBe(true);
    expect(negada(rowDe('superadmin'), pedirEstorno.permission)).toBe(true);
    expect(negada(rowDe('superadmin'), pedirSuspensao.permission)).toBe(true);
    expect(negada(rowDe('superadmin'), votoEstorno.permission)).toBe(true);
    expect(negada(rowDe('superadmin'), votoSuspensao.permission)).toBe(true);
  });

  it('cada papel com a permissao certa passa: Financeiro vota estorno, Moderador vota suspensao, Suporte pede suspensao', () => {
    const passa = (row: AdminGuardRecord, permissao: string) =>
      decideAdminGuard(row, permissao as never, T0).kind === 'autorizada';
    expect(passa(rowDe('financeiro'), 'finance.refund.approve')).toBe(true);
    expect(passa(rowDe('moderador'), 'account.suspend.approve')).toBe(true);
    expect(passa(rowDe('suporte'), 'account.suspend.request')).toBe(true);
    expect(passa(rowDe('moderador'), 'finance.refund.approve')).toBe(false);
  });

  it('o registro tem as 8 rotas da dupla aprovacao e nenhuma rota fora do registro', () => {
    expect(ADMIN_ROUTES_H105).toHaveLength(8);
    expect(ADMIN_ROUTES).toEqual(expect.arrayContaining(ADMIN_ROUTES_H105));
    expect(resolveAdminRoute(ADMIN_ROUTES, 'POST', '/v1/admin/refund-approvals/x/approve')).toBeNull();
    expect(resolveAdminRoute(ADMIN_ROUTES, 'PUT', ADMIN_REFUND_APPROVALS_PATH)).toBeNull();
  });

  it('nenhum papel de Superadmin tem as permissoes novas (80 §1)', () => {
    const permissoes = adminPermissionsOf(['superadmin']);
    expect(permissoes.has('account.suspend.request')).toBe(false);
    expect(permissoes.has('account.suspend.approve')).toBe(false);
  });
});

describe('T-H105-04 suspensao permanente em dois votos (CA-H105-07)', () => {
  it('o segundo voto de outro Moderador consome o pedido e a resposta mostra consumida', async () => {
    const f = portaFake({ voto: { status: 'consumida', votes: 2, required: 2 } });
    const resposta = await handleDualVote(
      { row: linha(['moderador']), secret: SEG, approvalId: PEDIDO },
      deps(f.port),
      T0,
      'suspensao_permanente',
    );
    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({ status: 'consumida', votes: 2, required_approvals: 2 });
  });

  it('pedido de suspensao aceita so professional_id e motivo, sem valor', async () => {
    const f = portaFake();
    const resposta = await handleDualOpen(
      { row: linha(['suporte']), secret: SEG, body: { professional_id: PROFISSIONAL, reason: MOTIVO } },
      deps(f.port),
      T0,
      'suspensao_permanente',
    );
    expect(resposta.status).toBe(201);
    expect(resposta.body.required_approvals).toBe(2);
    expect(f.abertos[0]).toEqual(expect.objectContaining({ action: 'suspensao_permanente', subjectId: PROFISSIONAL, amountCents: null }));
  });
});

describe('T-H105-05 vencimento e T-H105-06 aprovador sem papel ou inativo (CA-H105-08, 09)', () => {
  it('voto em pedido vencido: resposta 409 aprovacao_expirada e registro de negacao vencido', async () => {
    const f = portaFake({ voto: { status: 'expirada', votes: 0, required: 2 } });
    // Sessao e prova ainda validas no instante do voto; so o pedido venceu (24 h depois do pedido).
    const agora = T0 + H24;
    const resposta = await handleDualVote(
      { row: linha(['moderador'], { totpAtMs: agora - MIN, expiresAtMs: agora + H24 }), secret: SEG, approvalId: PEDIDO },
      deps(f.port),
      agora,
      'suspensao_permanente',
    );
    expect(resposta.status).toBe(409);
    expect(resposta.body).toEqual({ code: 'aprovacao_expirada' });
    expect(f.negacoes[0]?.reasonCode).toBe('vencido');
  });

  it('aprovador desativado antes do segundo voto: 403 e o pedido nao avanca', async () => {
    const f = portaFake({ voto: erroBanco('42501', 'aprovador_nao_ativo') });
    const resposta = await handleDualVote(
      { row: linha(['moderador']), secret: SEG, approvalId: PEDIDO },
      deps(f.port),
      T0,
      'suspensao_permanente',
    );
    expect(resposta.status).toBe(403);
    expect(f.negacoes[0]?.reasonCode).toBe('inativo');
  });

  it('pedido ja consumido ou nao pendente nao aceita voto: 409 aprovacao_nao_pendente', async () => {
    const f = portaFake({ voto: erroBanco('ADM27', 'aprovacao_nao_pendente') });
    const resposta = await handleDualVote(
      { row: linha(['financeiro']), secret: SEG, approvalId: PEDIDO },
      deps(f.port),
      T0,
      'estorno',
    );
    expect(resposta.status).toBe(409);
    expect(resposta.body).toEqual({ code: 'aprovacao_nao_pendente' });
  });
});

describe('T-H105-09 estorno aprovado nao chama nada alem da porta (CA-H105-12)', () => {
  it('estorno com uma aprovacao fica aprovada e a resposta nao indica execucao', async () => {
    const f = portaFake({ voto: { status: 'aprovada', votes: 1, required: 1 } });
    const resposta = await handleDualVote(
      { row: linha(['financeiro']), secret: SEG, approvalId: PEDIDO },
      deps(f.port),
      T0,
      'estorno',
    );
    expect(resposta.body).toEqual({ status: 'aprovada', votes: 1, required_approvals: 1 });
    expect(f.votos).toHaveLength(1);
    expect(JSON.stringify(resposta.body)).not.toMatch(/consumida|pago|refund/i);
  });

  it('cancelamento responde rejeitada; quem pode cancelar (so o solicitante) e conferido pelo banco', async () => {
    const f = portaFake();
    const resposta = await handleDualCancel(
      { row: linha(['financeiro']), secret: SEG, approvalId: PEDIDO },
      deps(f.port),
      T0,
      'estorno',
    );
    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({ status: 'rejeitada' });
  });
});

describe('T-H105-11 motivo fora das respostas e negacoes identicas (CA-H105-11)', () => {
  it('a listagem nunca devolve o motivo de outro solicitante', async () => {
    const itens = [
      {
        id: PEDIDO,
        tipo: 'estorno' as const,
        estado: 'pendente',
        valor_centavos: 20001,
        subject_ref: PAGAMENTO,
        votos: 0,
        required_approvals: 2,
        expires_at: new Date(T0 + H24).toISOString(),
        solicitado_por_mim: false,
        reason: MOTIVO,
      },
    ];
    const f = portaFake({ lista: itens });
    const resposta = await handleDualList({ row: linha(['financeiro']), secret: SEG }, deps(f.port), T0, 'estorno');
    expect(resposta.status).toBe(200);
    expect(corpoJson(resposta)).not.toContain('SENTINELA-MOTIVO-H105');
    expect(corpoJson(resposta)).not.toContain('reason');
  });

  it('negacao por papel, autoaprovacao e voto repetido saem com o mesmo corpo e status', async () => {
    const semPapel = await handleDualVote(
      { row: linha(['suporte']), secret: SEG, approvalId: PEDIDO },
      deps(portaFake().port),
      T0,
      'estorno',
    );
    const autoaprovacao = await handleDualVote(
      { row: linha(['financeiro']), secret: SEG, approvalId: PEDIDO },
      deps(portaFake({ voto: erroBanco('42501', 'aprovacao_propria') }).port),
      T0,
      'estorno',
    );
    const repetido = await handleDualVote(
      { row: linha(['financeiro']), secret: SEG, approvalId: PEDIDO },
      deps(portaFake({ voto: erroBanco('23505', 'x') }).port),
      T0,
      'estorno',
    );
    expect(autoaprovacao).toEqual(semPapel);
    expect(repetido).toEqual(semPapel);
  });

  it('o motivo invalido e recusado sem eco do texto', () => {
    const negada = decideDualOpen({
      action: 'estorno',
      hasPermission: true,
      totpAtMs: T0,
      nowMs: T0,
      subject: PAGAMENTO,
      amountCents: 100,
      reason: 'curto',
    });
    expect(negada?.body).toEqual({ code: 'motivo_invalido' });
    expect(JSON.stringify(negada)).not.toContain('curto');
  });

  it('prova recente vencida (30 min) pede nova confirmacao: 403 step_up_required', async () => {
    const f = portaFake();
    const resposta = await handleDualOpen(
      {
        row: linha(['financeiro'], { totpAtMs: T0 - 30 * MIN }),
        secret: SEG,
        body: { payment_id: PAGAMENTO, amount_cents: 100, reason: MOTIVO },
      },
      deps(f.port),
      T0,
      'estorno',
    );
    expect(resposta.status).toBe(403);
    expect(resposta.body).toEqual({ code: 'step_up_required' });
    expect(f.abertos).toHaveLength(0);
  });
});

describe('T-H105-02 e T-H105-03 no pedido: duplicidade e limite viram resposta, nao erro bruto', () => {
  it('pedido ja aberto para o mesmo alvo: 409 pedido_ja_aberto; limite de pendentes: 429', async () => {
    const dup = await handleDualOpen(
      { row: linha(['financeiro']), secret: SEG, body: { payment_id: PAGAMENTO, amount_cents: 500, reason: MOTIVO } },
      deps(portaFake({ abrir: erroBanco('ADM23', 'caso_ja_existe') }).port),
      T0,
      'estorno',
    );
    expect(dup.status).toBe(409);
    expect(dup.body).toEqual({ code: 'pedido_ja_aberto' });
    const limite = await handleDualOpen(
      { row: linha(['financeiro']), secret: SEG, body: { payment_id: PAGAMENTO, amount_cents: 500, reason: MOTIVO } },
      deps(portaFake({ abrir: erroBanco('ADM24', 'muitos_pedidos_pendentes') }).port),
      T0,
      'estorno',
    );
    expect(limite.status).toBe(429);
    expect(limite.body).toEqual({ code: 'muitos_pedidos_pendentes' });
  });
});
