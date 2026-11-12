// H-105 (Issue 114) | Adaptador Pg da dupla aprovacao com cliente falso (sem banco, sem rede). Confere: funcao certa e
// parametros na ordem; segredo do cookie so como hash; motivo so na abertura; resultado do voto lido do banco;
// listagem sem motivo; negacao gravada por chamada propria.
import { describe, expect, it } from 'vitest';
import { PgDualApprovalPort } from '../src/admin-dual-approval.js';
import { hashSessionSecret } from '../src/session.js';
import type { SqlClient } from '../src/jobs-tick.js';

const SEGREDO = 'example-admin-secret-h105-adaptador-0000000000';
const MOTIVO = 'SENTINELA-MOTIVO-H105-ADAPTADOR motivo longo';
const T0 = Date.UTC(2099, 0, 1, 12);
const ID = '11111111-2222-4333-8444-555555555555';
const ATOR = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

interface Chamada {
  readonly sql: string;
  readonly params: readonly unknown[];
}

function clienteFalso(linhas: readonly Record<string, unknown>[] = []) {
  const chamadas: Chamada[] = [];
  const client = {
    async query(sql: string, params: readonly unknown[] = []) {
      chamadas.push({ sql, params });
      return { rows: linhas };
    },
  } as unknown as SqlClient;
  return { client, chamadas };
}

describe('PgDualApprovalPort (adaptador, cliente falso)', () => {
  it('abrir chama approval_dual_open com o hash do segredo e o motivo, nunca o segredo em claro', async () => {
    const { client, chamadas } = clienteFalso([{ id: ID }]);
    const port = new PgDualApprovalPort(client);
    await port.open({
      actorUserId: ATOR,
      secret: SEGREDO,
      action: 'estorno',
      subjectId: ATOR,
      amountCents: 20001,
      reason: MOTIVO,
      approvalId: ID,
      nowMs: T0,
    });
    const c = chamadas[0]!;
    expect(c.sql).toContain('private.approval_dual_open(');
    expect(c.params).toEqual([ATOR, hashSessionSecret(SEGREDO), 'estorno', ATOR, 20001, MOTIVO, ID, new Date(T0).toISOString()]);
    expect(JSON.stringify(chamadas)).not.toContain(SEGREDO);
  });

  it('votar chama approval_dual_vote e le status, votos e exigidas do jsonb do banco', async () => {
    const { client, chamadas } = clienteFalso([{ resultado: { status: 'pendente', votes: 1, required: 2 } }]);
    const port = new PgDualApprovalPort(client);
    const r = await port.vote({ actorUserId: ATOR, secret: SEGREDO, family: 'suspensao_permanente', approvalId: ID, nowMs: T0 });
    expect(r).toEqual({ status: 'pendente', votes: 1, required: 2 });
    expect(chamadas[0]?.sql).toContain('private.approval_dual_vote(');
    expect(chamadas[0]?.params).toEqual([ATOR, hashSessionSecret(SEGREDO), 'suspensao_permanente', ID, new Date(T0).toISOString()]);
  });

  it('cancelar nao usa o segredo; so ator, familia, id e instante', async () => {
    const { client, chamadas } = clienteFalso([{ status: 'rejeitada' }]);
    await new PgDualApprovalPort(client).cancel({ actorUserId: ATOR, family: 'estorno', approvalId: ID, nowMs: T0 });
    expect(chamadas[0]?.sql).toContain('private.approval_dual_cancel(');
    expect(chamadas[0]?.params).toEqual([ATOR, 'estorno', ID, new Date(T0).toISOString()]);
  });

  it('listar devolve so a projecao (sem motivo) e marca o tipo da familia', async () => {
    const linha = {
      out_id: ID,
      out_estado: 'pendente',
      out_valor_centavos: 20001,
      out_subject_ref: ATOR,
      out_votos: 0,
      out_required_approvals: 2,
      out_expires_at: new Date(T0 + 86400000),
      out_solicitado_por_mim: false,
      out_reason: MOTIVO,
    };
    const { client, chamadas } = clienteFalso([linha]);
    const itens = await new PgDualApprovalPort(client).list({ actorUserId: ATOR, family: 'estorno', nowMs: T0 });
    expect(chamadas[0]?.sql).toContain('private.approval_dual_list(');
    expect(itens).toEqual([
      {
        id: ID,
        tipo: 'estorno',
        estado: 'pendente',
        valor_centavos: 20001,
        subject_ref: ATOR,
        votos: 0,
        required_approvals: 2,
        expires_at: new Date(T0 + 86400000).toISOString(),
        solicitado_por_mim: false,
      },
    ]);
    expect(JSON.stringify(itens)).not.toContain(MOTIVO);
  });

  it('negacao de voto e gravada por chamada propria com o codigo de motivo', async () => {
    const { client, chamadas } = clienteFalso([{ id: ID }]);
    await new PgDualApprovalPort(client).recordDenied({
      actorUserId: ATOR,
      family: 'estorno',
      approvalId: ID,
      reasonCode: 'autoaprovacao',
      nowMs: T0,
    });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.sql).toContain('private.approval_dual_denied_record(');
    expect(chamadas[0]?.params).toEqual([ATOR, 'estorno', ID, 'autoaprovacao', new Date(T0).toISOString()]);
  });

  it('resultado do voto sem campos validos falha de forma fechada (erro, nao estado inventado)', async () => {
    const { client } = clienteFalso([{ resultado: { status: '', votes: 1, required: 2 } }]);
    await expect(
      new PgDualApprovalPort(client).vote({ actorUserId: ATOR, secret: SEGREDO, family: 'estorno', approvalId: ID, nowMs: T0 }),
    ).rejects.toThrow('estado_invalido');
  });
});
