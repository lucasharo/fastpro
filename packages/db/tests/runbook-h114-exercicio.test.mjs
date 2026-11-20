// Exercicio integrado offline do runbook H-114 (Issue #123, fatia S8; desenho 165 §5 CA-17 e CA-19).
// Roda, de uma vez, todos os cenarios puros do runbook (R-MP, R-EMAIL, R-AUTH e a redacao) com:
//  - relogio fixo (vi.setSystemTime) e instante `agora` injetado;
//  - rede bloqueada (fetch lanca e e contado: nenhuma chamada e permitida);
//  - saida verificada contra e-mail, CPF e telefone em claro (CA-17);
//  - execucao repetida produz o mesmo resultado (determinismo).
// Sem banco e sem credenciais. A evidencia de CA-18 (eventos de auditoria) fica em runbook-h114-exercicio.dbtest.mjs.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PROVIDER_LIMITS, QUOTA_CUTS } from '@fastpro/domain';
import { reconciliarMercadoPagoComLivro } from '../scripts/lib/runbook-h114-rmp.mjs';
import {
  avaliarCotaEmail,
  aplicarDeltaProvedor,
  planejarFila,
  classificarOrfaosAuth,
} from '../scripts/lib/runbook-h114-email-auth.mjs';
import { redactForRunbook } from '../scripts/lib/runbook-h114.mjs';

const AGORA = '2026-11-20T15:00:00.000Z';
const HA = (min) => new Date(Date.parse(AGORA) - min * 60_000).toISOString();

const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const RE_CPF = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/;
const RE_TELEFONE = /\+55|\(\d{2}\)\s?\d{4,5}-\d{4}/;

/** Executa todos os cenarios do runbook e devolve as saidas, sem nenhum I/O. */
function executarCenarios() {
  const rmp = reconciliarMercadoPagoComLivro({
    agora: AGORA,
    pagamentos: [
      { externalId: 'TESTE-H114-1001', status: 'approved', amountCents: 1000, approvedAt: HA(180), planCode: 'plano_teste_h114', subscriptionExternalId: null },
      { externalId: 'TESTE-H114-1002', status: 'refunded', amountCents: 1500, approvedAt: HA(180), planCode: 'plano_teste_h114', subscriptionExternalId: null },
      { externalId: 'TESTE-H114-1003', status: 'approved', amountCents: 2000, approvedAt: HA(180), planCode: 'plano_teste_h114', subscriptionExternalId: null },
    ],
    livro: [
      { externalId: 'TESTE-H114-1002', grantId: 'g-1002', kind: 'paid', amountCents: 1500, planCode: 'plano_teste_h114', startsAt: HA(180), endsAt: HA(900), cancelAtPeriodEnd: false },
      { externalId: 'TESTE-H114-1003', grantId: 'g-1003', kind: 'paid', amountCents: 1900, planCode: 'plano_teste_h114', startsAt: HA(180), endsAt: HA(900), cancelAtPeriodEnd: false },
    ],
    precos: [],
  });

  const cotas = [70, 85, 90].map((usado) =>
    avaliarCotaEmail({ usadoDia: usado, usadoMes: usado, limites: PROVIDER_LIMITS, cortes: QUOTA_CUTS }),
  );
  const delta = aplicarDeltaProvedor({ usadoLocal: 95, usadoProvedor: 120, tetoFisico: PROVIDER_LIMITS.dia });

  const fila = planejarFila(
    [
      { state: 'pendente', factAtUtc: HA(60), aceiteAberto: true },
      { state: 'pendente', factAtUtc: HA(13 * 60) },
      { state: 'adiado_cota', factAtUtc: HA(60), adiadoEmUtc: '2026-11-19T20:00:00.000Z' },
      { state: 'enviado', factAtUtc: HA(60) },
    ],
    AGORA,
  );

  const orfaos = classificarOrfaosAuth({
    contasAuth: [
      { id: 'a0000000-0000-4000-8000-00000000e001', criadoEmUtc: HA(16), email: 'teste.h114@exemplo.invalid' },
      { id: 'a0000000-0000-4000-8000-00000000e002', criadoEmUtc: HA(5) },
    ],
    perfisApp: [],
    agoraUtc: AGORA,
  });

  return {
    rmp,
    cotas,
    delta,
    fila,
    orfaos,
    redigido: redactForRunbook({ rmp, cotas, delta, fila, orfaos }),
  };
}

describe('exercicio integrado offline (CA-19)', () => {
  let chamadasDeRede = 0;
  const fetchOriginal = globalThis.fetch;

  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(AGORA));
    globalThis.fetch = () => {
      chamadasDeRede += 1;
      throw new Error('rede proibida no exercicio do runbook H-114');
    };
  });

  afterAll(() => {
    globalThis.fetch = fetchOriginal;
    vi.useRealTimers();
  });

  it('executa todos os cenarios sem chamar a rede', () => {
    const r = executarCenarios();
    expect(chamadasDeRede).toBe(0);
    expect(r.rmp.contagens.T1_faltando_local).toBe(1);
    expect(r.rmp.contagens.T2_concessao_sem_pagamento).toBe(1);
    expect(r.rmp.contagens.T3_valor_divergente).toBe(1);
  });

  it('cota: 70 gera alerta 1, 85 e 90 geram alerta 2; o corte acompanha QUOTA_CUTS', () => {
    const { cotas } = executarCenarios();
    expect(cotas.map((c) => c.nivelDia)).toEqual([1, 2, 2]);
    expect(cotas[0].classes.lembrete).toBe('corta_dia');
    expect(cotas[1].classes.digest).toBe('corta_dia');
    expect(cotas[2].classes.critico).toBe('corta_dia');
    expect(cotas[2].classes.auth).toBe('envia');
  });

  it('delta do provedor fica no teto e a fila nao reenvia item enviado', () => {
    const r = executarCenarios();
    expect(r.delta).toEqual({ usadoNovo: 100, deltaAplicado: 5, limitado: true });
    expect(r.fila.contagens).toEqual({ manter: 1, descartar: 1, reavaliar: 1, aguardar: 0, enviar_possivel: 1 });
  });

  it('auth: so o orfao com mais de 15 min e sinalizado', () => {
    const r = executarCenarios();
    expect(r.orfaos.contagens).toEqual({ pareados: 0, naJanela: 1, sinalizados: 1 });
  });

  it('CA-17: nenhuma saida redigida contem e-mail, CPF ou telefone em claro', () => {
    const { redigido } = executarCenarios();
    const texto = JSON.stringify(redigido);
    expect(texto).not.toMatch(RE_EMAIL);
    expect(texto).not.toMatch(RE_CPF);
    expect(texto).not.toMatch(RE_TELEFONE);
  });

  it('CA-19: repetir a execucao com o mesmo instante produz exatamente o mesmo resultado', () => {
    const primeira = JSON.stringify(executarCenarios());
    const segunda = JSON.stringify(executarCenarios());
    expect(segunda).toBe(primeira);
  });
});
