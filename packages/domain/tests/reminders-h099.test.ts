// H-099 | T-H099-01 a T-H099-11 e T-H099-16 (decisores puros e politica). Sem banco, sem rede, sem relogio:
// o agora entra por parametro. Desenho: docs/factory/163-DESENHO-H099.md §9.
import { describe, it, expect } from 'vitest';
import {
  REMINDER_LATE_TOLERANCE_MS,
  REMINDER_OFFSETS_MS,
  decideRequestReminder,
  decideTrialReminder,
  markInstant,
  policyFor,
  type RequestReminderView,
  type TrialReminderView,
} from '../src/index.js';

const H = 3_600_000;
const PUB = '2026-11-01T10:00:00.000Z';
const DEADLINE = '2026-11-08T10:00:00.000Z'; // PUB + 168 h
const T24 = '2026-11-07T10:00:00.000Z'; // deadline - 24 h
const STARTS = '2026-11-01T10:00:00.000Z';
const ENDS = '2026-11-15T10:00:00.000Z'; // starts + 336 h
const T3D = '2026-11-12T10:00:00.000Z'; // ends - 72 h

const pedido = (over: Partial<RequestReminderView> = {}): RequestReminderView => ({
  requestId: '00000000-0000-4000-8000-000000000001',
  customerUserId: '00000000-0000-4000-8000-0000000000aa',
  status: 'publicado',
  acceptanceDeadlineAt: DEADLINE,
  customerStatus: 'ativo',
  ...over,
});

const trial = (over: Partial<TrialReminderView> = {}): TrialReminderView => ({
  grantId: '00000000-0000-4000-8000-000000000002',
  professionalUserId: '00000000-0000-4000-8000-0000000000bb',
  grantStatus: 'ativa',
  endsAt: ENDS,
  estado: 'trial_ativo',
  userStatus: 'ativo',
  ...over,
});

const at = (iso: string, deltaMs: number): string => new Date(Date.parse(iso) + deltaMs).toISOString();

describe('T-H099-01 marcos exatos', () => {
  it('calcula os quatro marcos a partir da ancora', () => {
    expect(markInstant(PUB, 'prazo_t24')).toBe(T24);
    expect(markInstant(PUB, 'prazo_t0')).toBe(DEADLINE);
    expect(markInstant(STARTS, 'trial_t3d')).toBe(T3D);
    expect(markInstant(STARTS, 'trial_t0')).toBe(ENDS);
    expect(REMINDER_OFFSETS_MS.prazo_t24).toBe(144 * H);
  });

  it('recusa ancora ilegivel', () => {
    expect(() => markInstant('nao-e-data', 'prazo_t0')).toThrow(RangeError);
  });
});

describe('T-H099-02 pedido publicado dentro da janela', () => {
  it('T-24h + 1 min, antes do prazo: valido', () => {
    expect(decideRequestReminder('t24', pedido(), T24, at(T24, 60_000))).toBe('valido');
  });
});

describe('T-H099-03 pedido fora de publicado em T-24h e T0', () => {
  it.each(['selecionado', 'cancelado', 'concluido'] as const)(
    'status %s e obsoleto nos dois marcos',
    (status) => {
      expect(decideRequestReminder('t24', pedido({ status }), T24, at(T24, 60_000))).toBe('obsoleto');
      expect(decideRequestReminder('t0', pedido({ status }), DEADLINE, at(DEADLINE, 60_000))).toBe(
        'obsoleto',
      );
    },
  );
});

describe('T-H099-04 tolerancia do T-24h (6 h) e limite do prazo', () => {
  it('agora >= prazo: obsoleto', () => {
    expect(decideRequestReminder('t24', pedido(), T24, DEADLINE)).toBe('obsoleto');
  });
  it('atraso de 6 h + 1 ms: obsoleto', () => {
    expect(decideRequestReminder('t24', pedido(), T24, at(T24, 6 * H + 1))).toBe('obsoleto');
  });
  it('atraso de 6 h exatas: valido (limite inclusivo)', () => {
    expect(decideRequestReminder('t24', pedido(), T24, at(T24, 6 * H))).toBe('valido');
  });
});

describe('T-H099-05 T0 do pedido', () => {
  it('agora < prazo: obsoleto (o marco so vale a partir do vencimento)', () => {
    expect(decideRequestReminder('t0', pedido(), DEADLINE, at(DEADLINE, -1000))).toBe('obsoleto');
  });
  it('atraso de 24 h + 1 ms: obsoleto', () => {
    expect(decideRequestReminder('t0', pedido(), DEADLINE, at(DEADLINE, 24 * H + 1))).toBe('obsoleto');
  });
  it('no prazo exato: valido', () => {
    expect(decideRequestReminder('t0', pedido(), DEADLINE, DEADLINE)).toBe('valido');
  });
});

describe('T-H099-06 cliente fora de ativo precede os demais', () => {
  it.each(['em_eliminacao', 'anonimizado', 'bloqueado'] as const)(
    'cliente %s: destinatario_invalido em qualquer marco',
    (customerStatus) => {
      const v = pedido({ customerStatus, status: 'cancelado' });
      expect(decideRequestReminder('t24', v, T24, at(T24, 1000))).toBe('destinatario_invalido');
      expect(decideRequestReminder('t0', v, DEADLINE, at(DEADLINE, 1000))).toBe('destinatario_invalido');
    },
  );
});

describe('T-H099-07 a T-H099-09 trial', () => {
  it('T-3d com trial_ativo: valido', () => {
    expect(decideTrialReminder('t3d', trial(), T3D, at(T3D, 1000))).toBe('valido');
  });
  it.each(['ativa', 'em_carencia', 'trial_expirado', 'sem_acesso'] as const)(
    'T-3d com estado %s: obsoleto',
    (estado) => {
      expect(decideTrialReminder('t3d', trial({ estado }), T3D, at(T3D, 1000))).toBe('obsoleto');
    },
  );
  it('T0 com trial_expirado: valido; com ativa (pagou): obsoleto', () => {
    expect(decideTrialReminder('t0', trial({ estado: 'trial_expirado' }), ENDS, ENDS)).toBe('valido');
    expect(decideTrialReminder('t0', trial({ estado: 'ativa' }), ENDS, ENDS)).toBe('obsoleto');
  });
  it('T0 com atraso de 24 h + 1 ms: obsoleto', () => {
    expect(
      decideTrialReminder('t0', trial({ estado: 'trial_expirado' }), ENDS, at(ENDS, 24 * H + 1)),
    ).toBe('obsoleto');
  });
  it('tolerancia do T-3d e de 6 h', () => {
    expect(REMINDER_LATE_TOLERANCE_MS.trial_t3d).toBe(6 * H);
    expect(decideTrialReminder('t3d', trial(), T3D, at(T3D, 6 * H + 1))).toBe('obsoleto');
  });
});

describe('T-H099-10 e T-H099-11 trial revogado e usuario fora de ativo', () => {
  it('trial revogado e obsoleto em qualquer marco', () => {
    const v = trial({ grantStatus: 'revogada' });
    expect(decideTrialReminder('t3d', v, T3D, at(T3D, 1000))).toBe('obsoleto');
    expect(decideTrialReminder('t0', trial({ grantStatus: 'revogada', estado: 'trial_expirado' }), ENDS, ENDS)).toBe(
      'obsoleto',
    );
  });
  it.each(['bloqueado', 'em_eliminacao'] as const)(
    'profissional %s: destinatario_invalido',
    (userStatus) => {
      expect(decideTrialReminder('t3d', trial({ userStatus }), T3D, at(T3D, 1000))).toBe(
        'destinatario_invalido',
      );
    },
  );
});

describe('T-H099-16 politica dos quatro tipos de lembrete', () => {
  it('prazo e acesso_trial nas categorias e classe lembrete', () => {
    expect(policyFor('prazo_t24')).toMatchObject({ category: 'prazo', mailClass: 'lembrete' });
    expect(policyFor('prazo_t0')).toMatchObject({ category: 'prazo', mailClass: 'lembrete' });
    expect(policyFor('acesso_trial_t3d')).toMatchObject({ category: 'acesso', mailClass: 'lembrete', params: [] });
    expect(policyFor('acesso_trial_t0')).toMatchObject({ category: 'acesso', mailClass: 'lembrete', params: [] });
  });
});
