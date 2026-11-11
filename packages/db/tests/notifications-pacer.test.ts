// H-092 | T-H92-36: ritmo de envio (200 ms entre envios, no maximo 5 por segundo), com relogio simulado.
import { describe, it, expect } from 'vitest';
import { FakeClock } from '@fastpro/testkit';
import { SendPacer } from '../src/notifications.js';

describe('SendPacer (T-H92-36)', () => {
  it('15 envios levam pelo menos 2,8 s simulados e nenhum intervalo e menor que 200 ms', async () => {
    const clock = new FakeClock();
    const pacer = new SendPacer(clock);
    const marcas: number[] = [];
    for (let i = 0; i < 15; i += 1) {
      await pacer.wait();
      marcas.push(clock.nowMs());
    }
    expect(marcas[14]! - marcas[0]!).toBeGreaterThanOrEqual(2800);
    for (let i = 1; i < marcas.length; i += 1) {
      expect(marcas[i]! - marcas[i - 1]!).toBeGreaterThanOrEqual(200);
    }
    expect(clock.sleeps.every((ms) => ms === 200)).toBe(true);
  });
});
