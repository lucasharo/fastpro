import { randomUUID } from 'node:crypto';

// Estado por instancia da funcao. Nenhum valor de ambiente aparece aqui.
export const state = {
  instanceId: randomUUID(),
  loadedAt: Date.now(),
  bootMs: null as number | null,
};
