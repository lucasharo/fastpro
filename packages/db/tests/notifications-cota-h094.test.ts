// H-094 | TU-04: registrarAlertasDeCota com armazenamento dublê. Sem banco, sem rede.
// onQuotaAlert so dispara na subida; abaixo de 70% nao ha escrita; o evento nao tem campo livre.
// Desenho: docs/factory/59-DESENHO-H094.md §4 e §5.
import { describe, it, expect } from 'vitest';
import {
  registrarAlertasDeCota,
  type AlertsRecorded,
  type QuotaAlert,
} from '../src/notifications.js';

type Chamada = readonly [number, number];

function armazenamento(resposta: AlertsRecorded) {
  const chamadas: Chamada[] = [];
  return {
    chamadas,
    store: {
      async recordAlerts(dia: 0 | 1 | 2, mes: 0 | 1 | 2): Promise<AlertsRecorded> {
        chamadas.push([dia, mes]);
        return resposta;
      },
    },
  };
}

const SEM_SUBIDA: AlertsRecorded = { diaSubiu: false, mesSubiu: false, nivelDia: 1, nivelMes: 1 };

describe('registrarAlertasDeCota (TU-04, H-094)', () => {
  it('abaixo de 70% nos dois contadores: nenhuma chamada ao banco e nenhum evento', async () => {
    const { chamadas, store } = armazenamento(SEM_SUBIDA);
    const eventos: QuotaAlert[] = [];
    await registrarAlertasDeCota({ onQuotaAlert: (a) => eventos.push(a) }, store, 69, 2099);
    expect(chamadas).toEqual([]);
    expect(eventos).toEqual([]);
  });

  it('subida no dia (70): um evento de dia_utc nivel 1 com o uso', async () => {
    const { chamadas, store } = armazenamento({
      diaSubiu: true,
      mesSubiu: false,
      nivelDia: 1,
      nivelMes: 0,
    });
    const eventos: QuotaAlert[] = [];
    await registrarAlertasDeCota({ onQuotaAlert: (a) => eventos.push(a) }, store, 70, 10);
    expect(chamadas).toEqual([[1, 0]]);
    expect(eventos).toEqual([{ period: 'dia_utc', level: 1, used: 70 }]);
  });

  it('subida no mes (2.550): um evento de mes nivel 2', async () => {
    const { store } = armazenamento({ diaSubiu: false, mesSubiu: true, nivelDia: 0, nivelMes: 2 });
    const eventos: QuotaAlert[] = [];
    await registrarAlertasDeCota({ onQuotaAlert: (a) => eventos.push(a) }, store, 10, 2550);
    expect(eventos).toEqual([{ period: 'mes', level: 2, used: 2550 }]);
  });

  it('a gravacao devolve "nao subiu": zero eventos mesmo com nivel 2', async () => {
    const { chamadas, store } = armazenamento(SEM_SUBIDA);
    const eventos: QuotaAlert[] = [];
    await registrarAlertasDeCota({ onQuotaAlert: (a) => eventos.push(a) }, store, 90, 2700);
    expect(chamadas).toEqual([[2, 2]]);
    expect(eventos).toEqual([]);
  });

  it('o evento so carrega period, level e used (sem campo livre)', async () => {
    const { store } = armazenamento({ diaSubiu: true, mesSubiu: true, nivelDia: 2, nivelMes: 2 });
    const eventos: QuotaAlert[] = [];
    await registrarAlertasDeCota({ onQuotaAlert: (a) => eventos.push(a) }, store, 85, 2550);
    expect(eventos).toHaveLength(2);
    for (const e of eventos) expect(Object.keys(e).sort()).toEqual(['level', 'period', 'used']);
  });

  it('sem onQuotaAlert injetado, a gravacao ainda ocorre e nada quebra', async () => {
    const { chamadas, store } = armazenamento({
      diaSubiu: true,
      mesSubiu: false,
      nivelDia: 2,
      nivelMes: 0,
    });
    await registrarAlertasDeCota({}, store, 85, 0);
    expect(chamadas).toEqual([[2, 0]]);
  });
});
