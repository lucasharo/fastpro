// H-014 | T-H014-09 (parte de dominio): e-mail de codigo de step-up (docs/factory/52-DESENHO-H014.md §4.3).
// Classe auth, parametro so challenge_ref (sem e-mail no payload) e prioridade acima de lembrete
// mesmo quando o lembrete e mais antigo. Sem rede, sem banco. Dados sinteticos.
import { describe, it, expect } from 'vitest';
import { policyFor } from '../src/notifications/policy.js';
import { comparePriority } from '../src/notifications/priority.js';

describe('T-H014-09 acesso_stepup (dominio)', () => {
  it('pertence a categoria acesso, classe auth, com so challenge_ref', () => {
    const politica = policyFor('acesso_stepup');
    expect(politica.category).toBe('acesso');
    expect(politica.mailClass).toBe('auth');
    expect(politica.params).toEqual(['challenge_ref']);
    expect(politica.params).not.toContain('email');
  });

  it('usa a mesma classe do codigo de acesso (acesso_login)', () => {
    expect(policyFor('acesso_stepup').mailClass).toBe(policyFor('acesso_login').mailClass);
  });

  it('sai antes de um lembrete mais antigo (fila mista)', () => {
    const lembreteAntigo = {
      mailClass: policyFor('acesso_trial').mailClass,
      createdAt: '2026-11-10T08:00:00.000Z',
    };
    const stepUp = {
      mailClass: policyFor('acesso_stepup').mailClass,
      createdAt: '2026-11-11T12:00:00.000Z',
    };
    expect(comparePriority(stepUp, lembreteAntigo)).toBeLessThan(0);
    expect(comparePriority(lembreteAntigo, stepUp)).toBeGreaterThan(0);
  });

  it('tipo fora da lista continua recusado (falha fechada)', () => {
    expect(() => policyFor('acesso_stepup_inexistente')).toThrow();
  });
});
