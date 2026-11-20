// Testes unitarios do R-EMAIL e do R-AUTH do runbook H-114 (Issue #123, fatia S7; desenho 165 §5
// CA-13 a CA-16). Offline: sem banco, sem rede, sem chamada ao provedor. Agora e injetado.
// Os limites e cortes usados aqui vem de @fastpro/domain (fonte unica); o teste de deriva garante
// que os valores documentados no runbook continuam iguais.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { PROVIDER_LIMITS, QUOTA_CUTS, ALERT_THRESHOLDS_PCT, alertLevelFor } from '@fastpro/domain';
import {
  nivelAlertaCota,
  avaliarCotaEmail,
  aplicarDeltaProvedor,
  decidirItemFila,
  planejarFila,
  classificarOrfaosAuth,
  HORAS_OBSOLESCENCIA_EMAIL,
  MINUTOS_ORFAO_AUTH,
} from '../scripts/lib/runbook-h114-email-auth.mjs';

const AGORA = '2026-11-20T15:00:00.000Z';
const ANTES = (min) => new Date(Date.parse(AGORA) - min * 60_000).toISOString();

const LIMITES = { dia: PROVIDER_LIMITS.dia, mes: PROVIDER_LIMITS.mes };
const CORTES = QUOTA_CUTS;

describe('deriva: valores do runbook iguais aos do dominio', () => {
  it('limites do provedor sao 100 por dia e 3.000 por mes', () => {
    expect(PROVIDER_LIMITS).toEqual({ dia: 100, mes: 3000 });
  });

  it('alertas em 70% e 85%', () => {
    expect(ALERT_THRESHOLDS_PCT).toEqual({ nivel1: 70, nivel2: 85 });
  });

  it('nivel de alerta da funcao espelha alertLevelFor do dominio em toda a faixa 0 a 100', () => {
    for (let usado = 0; usado <= 100; usado += 1) {
      expect(nivelAlertaCota(usado, 100), `usado=${usado}`).toBe(alertLevelFor(usado, 100));
    }
  });

  it('o runbook cita 70%, 85%, 100 por dia e 3.000 por mes', () => {
    const runbook = readFileSync(
      new URL('../../../docs/factory/149-RUNBOOK-INCIDENTE-RECONCILIACAO.md', import.meta.url),
      'utf8',
    );
    expect(runbook).toContain('70%');
    expect(runbook).toContain('85%');
    expect(runbook).toContain('100 por dia');
    expect(runbook).toContain('3.000 por mês');
  });
});

describe('CA-13: cota de e-mail em 70, 85 e 90 mensagens', () => {
  it('70 mensagens no dia geram alerta 1 e cortam so o lembrete', () => {
    const r = avaliarCotaEmail({ usadoDia: 70, usadoMes: 70, limites: LIMITES, cortes: CORTES });
    expect(r.nivelDia).toBe(1);
    expect(r.classes.lembrete).toBe('corta_dia');
    expect(r.classes.digest).toBe('envia');
    expect(r.classes.critico).toBe('envia');
  });

  it('85 mensagens geram alerta 2 e cortam o digest', () => {
    const r = avaliarCotaEmail({ usadoDia: 85, usadoMes: 85, limites: LIMITES, cortes: CORTES });
    expect(r.nivelDia).toBe(2);
    expect(r.classes.digest).toBe('corta_dia');
    expect(r.classes.critico).toBe('envia');
  });

  it('90 mensagens produzem corte da classe critica', () => {
    const r = avaliarCotaEmail({ usadoDia: 90, usadoMes: 90, limites: LIMITES, cortes: CORTES });
    expect(r.nivelDia).toBe(2);
    expect(r.classes.critico).toBe('corta_dia');
    expect(r.classes.auth).toBe('envia');
  });

  it('auth passa ate 100 por dia e so corta no limite', () => {
    const quase = avaliarCotaEmail({ usadoDia: 99, usadoMes: 99, limites: LIMITES, cortes: CORTES });
    const cheio = avaliarCotaEmail({ usadoDia: 100, usadoMes: 100, limites: LIMITES, cortes: CORTES });
    expect(quase.classes.auth).toBe('envia');
    expect(cheio.classes.auth).toBe('corta_dia');
  });

  it('o mes tem precedencia sobre o dia (mesma regra de decideQuota)', () => {
    const r = avaliarCotaEmail({ usadoDia: 90, usadoMes: 2700, limites: LIMITES, cortes: CORTES });
    expect(r.classes.critico).toBe('corta_mes');
  });

  it('nivel de alerta sobe na fronteira de 70% e de 85%', () => {
    expect(nivelAlertaCota(69, 100)).toBe(0);
    expect(nivelAlertaCota(70, 100)).toBe(1);
    expect(nivelAlertaCota(84, 100)).toBe(1);
    expect(nivelAlertaCota(85, 100)).toBe(2);
  });
});

describe('CA-15: delta do provedor ajusta o contador sem passar do teto', () => {
  it('soma so o delta positivo (uso informado acima do local)', () => {
    expect(aplicarDeltaProvedor({ usadoLocal: 70, usadoProvedor: 78, tetoFisico: 100 })).toEqual({
      usadoNovo: 78,
      deltaAplicado: 8,
      limitado: false,
    });
  });

  it('nunca passa do teto fisico e sinaliza o corte', () => {
    expect(aplicarDeltaProvedor({ usadoLocal: 95, usadoProvedor: 120, tetoFisico: 100 })).toEqual({
      usadoNovo: 100,
      deltaAplicado: 5,
      limitado: true,
    });
  });

  it('uso informado menor que o local nao reduz o contador', () => {
    expect(aplicarDeltaProvedor({ usadoLocal: 40, usadoProvedor: 30, tetoFisico: 100 })).toEqual({
      usadoNovo: 40,
      deltaAplicado: 0,
      limitado: false,
    });
  });
});

describe('CA-14: fila de e-mail, obsoletos e zero reenvio', () => {
  it('item pendente com fato de mais de 12 h vira descartado por obsolescencia', () => {
    const d = decidirItemFila(
      { state: 'pendente', factAtUtc: ANTES(HORAS_OBSOLESCENCIA_EMAIL * 60 + 1) },
      AGORA,
    );
    expect(d).toEqual({ acao: 'descartar', motivo: 'obsoleto' });
  });

  it('pedido de aceite que nao esta mais aberto vira descartado', () => {
    const d = decidirItemFila(
      { state: 'adiado_cota', factAtUtc: ANTES(60), adiadoEmUtc: ANTES(30), aceiteAberto: false },
      AGORA,
    );
    expect(d.acao).toBe('descartar');
  });

  it('adiado ontem e reavaliado na virada do dia UTC', () => {
    const d = decidirItemFila(
      {
        state: 'adiado_cota',
        factAtUtc: '2026-11-20T01:00:00.000Z',
        adiadoEmUtc: '2026-11-19T23:30:00.000Z',
      },
      '2026-11-20T02:00:00.000Z',
    );
    expect(d).toEqual({ acao: 'reavaliar', motivo: 'virada_do_dia_utc' });
  });

  it('adiado no mesmo dia UTC continua aguardando', () => {
    const d = decidirItemFila(
      { state: 'adiado_cota', factAtUtc: ANTES(60), adiadoEmUtc: ANTES(30) },
      AGORA,
    );
    expect(d.acao).toBe('aguardar');
  });

  it('item enviado, falho ou descartado nunca volta a sair (zero reenvio retroativo)', () => {
    const itens = ['enviado', 'falha', 'descartado', 'enviando', 'suprimido'].map((state) => ({
      state,
      factAtUtc: ANTES(5),
    }));
    const { contagens, decisoes } = planejarFila(itens, AGORA);
    expect(contagens.enviar_possivel).toBe(0);
    expect(contagens.reavaliar).toBe(0);
    expect(decisoes.every((d) => d.acao === 'manter')).toBe(true);
  });

  it('pendente recente e valido fica disponivel para envio, sem reenvio de aceite antigo', () => {
    const r = planejarFila(
      [
        { state: 'pendente', factAtUtc: ANTES(60), aceiteAberto: true },
        { state: 'pendente', factAtUtc: ANTES(HORAS_OBSOLESCENCIA_EMAIL * 60 + 30) },
        { state: 'adiado_cota', factAtUtc: ANTES(60), adiadoEmUtc: '2026-11-19T20:00:00.000Z' },
      ],
      AGORA,
    );
    expect(r.contagens).toEqual({
      manter: 0,
      descartar: 1,
      reavaliar: 1,
      aguardar: 0,
      enviar_possivel: 1,
    });
  });
});

describe('CA-16: orfaos Auth x app.app_user com janela de 15 min', () => {
  it('janela padrao e 15 minutos', () => {
    expect(MINUTOS_ORFAO_AUTH).toBe(15);
  });

  it('conta sem perfil com mais de 15 min e sinalizada como orfao_expirado', () => {
    const r = classificarOrfaosAuth({
      contasAuth: [{ id: 'a0000000-0000-4000-8000-00000000f001', criadoEmUtc: ANTES(16) }],
      perfisApp: [],
      agoraUtc: AGORA,
    });
    expect(r.contagens).toEqual({ pareados: 0, naJanela: 0, sinalizados: 1 });
    expect(r.sinalizados[0]).toMatchObject({ classe: 'orfao_expirado', idadeMinutos: 16 });
  });

  it('conta sem perfil com menos de 15 min nao e sinalizada', () => {
    const r = classificarOrfaosAuth({
      contasAuth: [{ id: 'a0000000-0000-4000-8000-00000000f002', criadoEmUtc: ANTES(14) }],
      perfisApp: [],
      agoraUtc: AGORA,
    });
    expect(r.contagens).toEqual({ pareados: 0, naJanela: 1, sinalizados: 0 });
  });

  it('exatamente 15 min nao e sinalizado (regra estrita: acima da janela)', () => {
    const r = classificarOrfaosAuth({
      contasAuth: [{ id: 'a0000000-0000-4000-8000-00000000f003', criadoEmUtc: ANTES(15) }],
      perfisApp: [],
      agoraUtc: AGORA,
    });
    expect(r.contagens.sinalizados).toBe(0);
  });

  it('conta com perfil correspondente e pareada, mesmo antiga', () => {
    const id = 'a0000000-0000-4000-8000-00000000f004';
    const r = classificarOrfaosAuth({
      contasAuth: [{ id, criadoEmUtc: ANTES(600) }],
      perfisApp: [{ authUserId: id }],
      agoraUtc: AGORA,
    });
    expect(r.contagens).toEqual({ pareados: 1, naJanela: 0, sinalizados: 0 });
  });

  it('a saida nao contem e-mail nem id inteiro (CA-17)', () => {
    const r = classificarOrfaosAuth({
      contasAuth: [
        {
          id: 'a0000000-0000-4000-8000-00000000f005',
          criadoEmUtc: ANTES(40),
          email: 'teste.h114@exemplo.invalid',
        },
      ],
      perfisApp: [],
      agoraUtc: AGORA,
    });
    const saida = JSON.stringify(r);
    expect(saida).not.toContain('exemplo.invalid');
    expect(saida).not.toContain('a0000000-0000-4000-8000-00000000f005');
    expect(r.sinalizados[0].idMascarado).toBe('***f005');
  });
});
