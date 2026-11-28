// Issue 57 (H-044) | Testes unitarios do adaptador Pg da ativacao do trial (docs/factory/135-DESENHO-H044.md, §5.3, T-21).
// SqlClient falso que registra SQL e parametros. Sem banco, sem rede.
import { describe, expect, it } from 'vitest';
import { TrialActivationError } from '@fastpro/domain';
import { SQL_TRIAL_ACTIVATE, createPgTrialActivation } from './trial-activation.js';
import type { SqlClient } from './jobs-tick.js';

const PROFISSIONAL = '11111111-2222-4333-8444-555555555555';
const INSTANTE = new Date('2099-01-01T12:00:00.000Z');
const CORRELACAO = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const DETALHE_TECNICO = ['relacao', 'billing', 'access', 'grant', 'segredo'].join('_');

interface Chamada {
  readonly sql: string;
  readonly params: readonly unknown[];
}

function clienteFalso(resposta: { rows: Record<string, unknown>[] } | Error): { cliente: SqlClient; chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  const cliente = {
    query: async (sql: string, params: readonly unknown[] = []) => {
      chamadas.push({ sql, params });
      if (resposta instanceof Error) throw resposta;
      return resposta;
    },
  } as unknown as SqlClient;
  return { cliente, chamadas };
}

describe('T-21: adaptador da ativacao', () => {
  it('chama a funcao com parametros posicionais e SQL constante', async () => {
    const { cliente, chamadas } = clienteFalso({ rows: [{ out_code: 'not_verified' }] });
    await createPgTrialActivation(cliente).activate(PROFISSIONAL, INSTANTE);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.sql).toBe(SQL_TRIAL_ACTIVATE);
    expect(SQL_TRIAL_ACTIVATE).toBe(
      'select out_code, out_grant_id, out_starts_at, out_ends_at from private.trial_activate($1::uuid, $2::text, $3::timestamptz, $4::uuid)',
    );
    expect(chamadas[0]?.params).toEqual([PROFISSIONAL, `professional:${PROFISSIONAL}`, INSTANTE.toISOString(), null]);
  });

  it('usa o gerador de correlacao quando informado', async () => {
    const { cliente, chamadas } = clienteFalso({ rows: [{ out_code: 'trial_used' }] });
    await createPgTrialActivation(cliente, { novaCorrelacao: () => CORRELACAO }).activate(PROFISSIONAL, INSTANTE);
    expect(chamadas[0]?.params[3]).toBe(CORRELACAO);
  });

  it('ok: converte datas e nao expoe o id do livro', async () => {
    const inicio = '2099-01-01T12:00:00.000Z';
    const fim = '2099-01-15T12:00:00.000Z';
    const { cliente } = clienteFalso({
      rows: [{ out_code: 'ok', out_grant_id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff', out_starts_at: inicio, out_ends_at: fim }],
    });
    const r = await createPgTrialActivation(cliente).activate(PROFISSIONAL, INSTANTE);
    expect(r).toEqual({ code: 'ok', startsAt: new Date(inicio), endsAt: new Date(fim) });
    expect(Object.keys(r).sort()).toEqual(['code', 'endsAt', 'startsAt']);
  });

  it.each(['not_verified', 'trial_used', 'paid_access_active'])('negacao %s sai so com o codigo', async (codigo) => {
    const { cliente } = clienteFalso({ rows: [{ out_code: codigo, out_grant_id: null, out_starts_at: null, out_ends_at: null }] });
    const r = await createPgTrialActivation(cliente).activate(PROFISSIONAL, INSTANTE);
    expect(r).toEqual({ code: codigo });
  });

  it('codigo fora dos quatro valores vira trial_indisponivel', async () => {
    const { cliente } = clienteFalso({ rows: [{ out_code: 'erro_interno' }] });
    await expect(createPgTrialActivation(cliente).activate(PROFISSIONAL, INSTANTE)).rejects.toMatchObject({
      code: 'trial_indisponivel',
    });
  });

  it('zero linhas vira trial_indisponivel', async () => {
    const { cliente } = clienteFalso({ rows: [] });
    await expect(createPgTrialActivation(cliente).activate(PROFISSIONAL, INSTANTE)).rejects.toBeInstanceOf(
      TrialActivationError,
    );
  });

  it('data invalida vira trial_indisponivel', async () => {
    const { cliente } = clienteFalso({
      rows: [{ out_code: 'ok', out_starts_at: 'nao-e-data', out_ends_at: '2099-01-15T12:00:00.000Z' }],
    });
    await expect(createPgTrialActivation(cliente).activate(PROFISSIONAL, INSTANTE)).rejects.toMatchObject({
      code: 'trial_indisponivel',
    });
  });

  it('erro do banco nunca e repassado: vira trial_indisponivel sem a mensagem tecnica', async () => {
    const { cliente } = clienteFalso(new Error(DETALHE_TECNICO));
    const erro = await createPgTrialActivation(cliente)
      .activate(PROFISSIONAL, INSTANTE)
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(TrialActivationError);
    expect((erro as TrialActivationError).code).toBe('trial_indisponivel');
    expect((erro as Error).message).not.toContain(DETALHE_TECNICO);
  });
});
