// H-100 | Marco de vigencia das notificacoes (Issue 110; docs/factory/49-DESENHO-H100.md, D-1).
// Prova que o marco e o instante literal 2026-11-11T00:00:00Z (limite inclusivo). Sem banco, sem rede.
import { describe, it, expect } from 'vitest';
import { NOTIFICATION_EFFECTIVE_FROM_MS } from '../src/index.js';

describe('H-100 marco de vigencia', () => {
  it('e 2026-11-11T00:00:00.000Z em UTC, em milissegundos', () => {
    expect(NOTIFICATION_EFFECTIVE_FROM_MS).toBe(Date.parse('2026-11-11T00:00:00.000Z'));
    expect(new Date(NOTIFICATION_EFFECTIVE_FROM_MS).toISOString()).toBe('2026-11-11T00:00:00.000Z');
  });

  it('um segundo antes do marco e anterior; o proprio marco nao e', () => {
    expect(Date.parse('2026-11-10T23:59:59.000Z') < NOTIFICATION_EFFECTIVE_FROM_MS).toBe(true);
    expect(Date.parse('2026-11-11T00:00:00.000Z') < NOTIFICATION_EFFECTIVE_FROM_MS).toBe(false);
  });
});
