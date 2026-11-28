// H-016 | Testes puros da elegibilidade e do corpo de /me (docs/factory/33-DESENHO-H016.md §8; 67 §8).
// CA-H016-05 (sem e-mail verificado nada e publicado), CA-H016-21 (estado pendente e explicacao),
// CA-H016-22 (cinco estados nao aprovados sao negados). Valores sinteticos, sem rede e sem banco.
import { describe, it, expect } from 'vitest';
import {
  PROFESSIONAL_VERIFICATION_STATUSES,
  professionalEligibility,
  professionalMeBody,
  type ProfessionalVerificationStatus,
} from '../src/identity/professional-account.js';

describe('elegibilidade do profissional (CA-H016-05, CA-H016-22)', () => {
  it('libera so com conta ativa, e-mail verificado e verificacao aprovada', () => {
    expect(professionalEligibility({ active: true, emailVerified: true, status: 'aprovada' })).toEqual({
      allowed: true,
    });
  });

  it.each(['pendente', 'em_revisao', 'retida_duplicidade', 'recusada', 'suspensa'] as const)(
    'nega o estado %s mesmo com e-mail verificado (CA-H016-22)',
    (status) => {
      expect(professionalEligibility({ active: true, emailVerified: true, status })).toEqual({
        allowed: false,
        reason: 'verificacao_nao_aprovada',
      });
    },
  );

  it('nega sem perfil profissional (status nulo)', () => {
    expect(professionalEligibility({ active: true, emailVerified: true, status: null })).toEqual({
      allowed: false,
      reason: 'verificacao_nao_aprovada',
    });
  });

  it('nega conta com e-mail nao verificado, mesmo aprovada (CA-H016-05)', () => {
    expect(professionalEligibility({ active: true, emailVerified: false, status: 'aprovada' })).toEqual({
      allowed: false,
      reason: 'email_nao_verificado',
    });
  });

  it('nega conta inativa antes de olhar o resto', () => {
    expect(professionalEligibility({ active: false, emailVerified: true, status: 'aprovada' })).toEqual({
      allowed: false,
      reason: 'conta_indisponivel',
    });
  });

  it('todo estado da verificacao, exceto aprovada, e negado (cobertura da lista oficial)', () => {
    for (const status of PROFESSIONAL_VERIFICATION_STATUSES) {
      const r = professionalEligibility({ active: true, emailVerified: true, status });
      expect(r.allowed).toBe(status === 'aprovada');
    }
  });
});

describe('corpo de GET /v1/professional/me (CA-H016-10, CA-H016-21)', () => {
  it('conta nova verificada e pendente: explica sem prazo e nivel completo', () => {
    expect(professionalMeBody({ emailVerified: true, status: 'pendente' })).toEqual({
      access_level: 'full',
      email_verified: true,
      verification: { status: 'pendente', explanation_code: 'human_review_no_deadline' },
    });
  });

  it('e-mail nao verificado: sessao so de verificacao (D-H016-3)', () => {
    const corpo = professionalMeBody({ emailVerified: false, status: 'pendente' });
    expect(corpo.access_level).toBe('verification_only');
    expect(corpo.email_verified).toBe(false);
  });

  it('todo estado tem codigo de explicacao e o corpo nao traz texto livre nem e-mail', () => {
    for (const status of PROFESSIONAL_VERIFICATION_STATUSES as readonly ProfessionalVerificationStatus[]) {
      const texto = JSON.stringify(professionalMeBody({ emailVerified: true, status }));
      expect(texto).toContain('explanation_code');
      expect(texto).not.toMatch(/@/);
    }
  });
});
