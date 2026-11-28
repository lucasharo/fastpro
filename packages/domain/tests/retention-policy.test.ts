// H-109 (Issue 118) | Politica por classe, forma das mudancas e erros (docs/factory/82-DESENHO-H109.md §1, §5, §7).
import { describe, expect, it } from 'vitest';
import {
  ACOES_POR_CLASSE,
  decidirPolitica,
  interpretarHold,
  interpretarMudancaPolitica,
  statusDoErroRetencao,
  type PropostaPolitica,
} from '../src/retention/index.js';

const BASE: PropostaPolitica = {
  dataClass: 'RC-01',
  periodSeconds: null,
  action: null,
  legalBasisRef: null,
  effectiveFrom: null,
  enabled: false,
  dryRun: true,
  simulacaoRegistrada: false,
};

describe('decidirPolitica (CA-H109-02)', () => {
  it('aceita a politica vazia e desligada (valor nulo = job desligado)', () => {
    expect(decidirPolitica(BASE)).toEqual({ ok: true });
  });

  it('recusa habilitar sem periodo, acao, base legal ou vigencia', () => {
    const completa = {
      ...BASE,
      periodSeconds: 86400,
      action: 'anonimizar',
      legalBasisRef: 'parecer-2026-01',
      effectiveFrom: '2027-01-01T00:00:00Z',
      enabled: true,
    };
    expect(decidirPolitica(completa)).toEqual({ ok: true });
    for (const campo of ['periodSeconds', 'action', 'legalBasisRef', 'effectiveFrom'] as const) {
      expect(decidirPolitica({ ...completa, [campo]: null }), campo).toEqual({
        ok: false,
        motivo: 'habilitacao_incompleta',
      });
    }
  });

  it('habilitar com acao reter nao cumpre a regra de expurgo', () => {
    const p = {
      ...BASE,
      dataClass: 'RC-06',
      periodSeconds: 60,
      action: 'reter',
      legalBasisRef: 'parecer-2026-02',
      effectiveFrom: '2027-01-01T00:00:00Z',
      enabled: true,
    };
    expect(decidirPolitica(p)).toEqual({ ok: false, motivo: 'habilitacao_incompleta' });
  });

  it('recusa periodo que nao e inteiro positivo seguro', () => {
    for (const periodSeconds of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 2]) {
      expect(decidirPolitica({ ...BASE, periodSeconds }), String(periodSeconds)).toEqual({
        ok: false,
        motivo: 'periodo_invalido',
      });
    }
  });

  it('recusa classe fora da lista (RC-08, RC-09 e RC-11 nao entram na tabela)', () => {
    for (const dataClass of ['RC-08', 'RC-09', 'RC-11', 'RC-99', '']) {
      expect(decidirPolitica({ ...BASE, dataClass }), dataClass).toEqual({ ok: false, motivo: 'classe_invalida' });
    }
  });

  it('RC-07 so aceita reter (CA-H109-11 e guarda de RC-07)', () => {
    expect(ACOES_POR_CLASSE['RC-07']).toEqual(['reter']);
    expect(decidirPolitica({ ...BASE, dataClass: 'RC-07', action: 'excluir' })).toEqual({
      ok: false,
      motivo: 'acao_nao_permitida',
    });
    expect(decidirPolitica({ ...BASE, dataClass: 'RC-07', action: 'anonimizar' })).toEqual({
      ok: false,
      motivo: 'acao_nao_permitida',
    });
    expect(decidirPolitica({ ...BASE, dataClass: 'RC-07', action: 'reter' })).toEqual({ ok: true });
  });

  it('RC-02 nao aceita excluir (a conta fica por FK)', () => {
    expect(decidirPolitica({ ...BASE, dataClass: 'RC-02', action: 'excluir' })).toEqual({
      ok: false,
      motivo: 'acao_nao_permitida',
    });
  });

  it('desligar a simulacao exige simulacao registrada', () => {
    expect(decidirPolitica({ ...BASE, dryRun: false })).toEqual({ ok: false, motivo: 'simulacao_pendente' });
    expect(decidirPolitica({ ...BASE, dryRun: false, simulacaoRegistrada: true })).toEqual({ ok: true });
  });
});

describe('interpretarMudancaPolitica (forma do corpo)', () => {
  const corpo = {
    dataClass: 'RC-01',
    periodSeconds: null,
    action: null,
    legalBasisRef: null,
    effectiveFrom: null,
    enabled: false,
    dryRun: true,
  };

  it('aceita a forma fechada', () => {
    expect(interpretarMudancaPolitica(corpo)).toMatchObject({ ok: true });
  });

  it('recusa campo extra, tipo errado e corpo que nao e objeto', () => {
    expect(interpretarMudancaPolitica({ ...corpo, prazo: 30 })).toEqual({ ok: false, code: 'campo_desconhecido' });
    expect(interpretarMudancaPolitica({ ...corpo, enabled: 'sim' })).toEqual({ ok: false, code: 'corpo_invalido' });
    expect(interpretarMudancaPolitica({ ...corpo, dataClass: 'RC-08' })).toEqual({
      ok: false,
      code: 'classe_invalida',
    });
    expect(interpretarMudancaPolitica(['x'])).toEqual({ ok: false, code: 'corpo_invalido' });
    expect(interpretarMudancaPolitica(null)).toEqual({ ok: false, code: 'corpo_invalido' });
  });
});

describe('interpretarHold', () => {
  it('aceita sujeito, identificador e codigo de motivo; recusa texto livre', () => {
    const ok = { subjectType: 'user', subjectId: '11111111-2222-4333-8444-555555555555', reasonCode: 'litigio_1' };
    expect(interpretarHold(ok)).toMatchObject({ ok: true });
    expect(interpretarHold({ ...ok, reasonCode: 'Processo do cliente, ver e-mail' })).toEqual({
      ok: false,
      code: 'corpo_invalido',
    });
    expect(interpretarHold({ ...ok, subjectType: 'conversation' })).toEqual({ ok: false, code: 'corpo_invalido' });
  });
});

describe('statusDoErroRetencao', () => {
  it('sem permissao devolve 404 sem revelar a rota; regras devolvem 403, 409 ou 422', () => {
    expect(statusDoErroRetencao('permissao_negada')).toEqual({ status: 404, code: 'nao_encontrado' });
    expect(statusDoErroRetencao('aprovacao_propria').status).toBe(403);
    expect(statusDoErroRetencao('aprovacao_invalida').status).toBe(409);
    expect(statusDoErroRetencao('habilitacao_incompleta').status).toBe(422);
    expect(statusDoErroRetencao('erro_desconhecido')).toEqual({ status: 503, code: 'retencao_indisponivel' });
  });
});
