// Correlacao por request id (ADR-013). Contexto assincrono: tudo que roda dentro de
// runWithContext herda request_id/correlation_id, inclusive jobs e eventos disparados dali.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface LogContext {
  readonly request_id: string;
  readonly correlation_id: string;
}

const storage = new AsyncLocalStorage<LogContext>();

export function newRequestId(): string {
  return randomUUID();
}

/** correlation_id padrao = request_id (ou o recebido de uma origem confiavel, ex.: job pai). */
export function runWithContext<T>(
  ctx: { request_id?: string; correlation_id?: string },
  fn: () => T,
): T {
  const request_id = ctx.request_id ?? newRequestId();
  return storage.run({ request_id, correlation_id: ctx.correlation_id ?? request_id }, fn);
}

export function getContext(): LogContext | undefined {
  return storage.getStore();
}
