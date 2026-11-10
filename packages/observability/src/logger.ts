// Logger estruturado (JSON por linha) com ALLOWLIST de campos (ADR-013; P8; RF-163).
//  - campo fora de allowlist.json e descartado (so o NOME entra em dropped_fields);
//  - valor so pode ser string curta, numero finito, booleano ou null (objetos sao descartados);
//  - strings passam por redactText; campos de identificador devem ter formato de ID;
//  - erros: apenas error_name e error_code (nunca mensagem nem stack, que podem carregar PII);
//  - request_id/correlation_id vem do contexto assincrono quando existir.
import allowlist from './allowlist.json' with { type: 'json' };
import { getContext } from './context.js';
import { redactText } from './redact.js';

export const ALLOWED_FIELDS: ReadonlySet<string> = new Set(allowlist.fields);
const ID_FIELDS: ReadonlySet<string> = new Set(allowlist.idFields);
// Identificadores: UUID ou prefixo curto + sufixo (p_1, req-abc, job_9). E-mail, CPF etc. nao casam.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIXED_ID = /^[a-z]{1,10}[_-][A-Za-z0-9_-]{1,56}$/;
const KEY_FORMAT = /^[a-z][a-z0-9_]{0,39}$/i;
const ERROR_NAME = /^[A-Za-z0-9_]{0,50}Error$/;
const MAX_STRING = 200;
const MAX_INPUT = 10_000; // limita o custo da redacao

/** Redige ANTES de cortar; se o corte cair no meio de um trecho, descarta o final parcial. */
function cleanText(raw: string): string {
  const redacted = redactText(raw.slice(0, MAX_INPUT));
  if (redacted.length <= MAX_STRING) return redacted;
  let cut = redacted.slice(0, MAX_STRING);
  if (!/\s/.test(redacted.charAt(MAX_STRING))) cut = cut.replace(/\S+$/, '');
  return `${cut.trimEnd()} [truncated]`;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogFields = Readonly<Record<string, unknown>>;
export type LogSink = (line: string) => void;

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly sink?: LogSink;
  readonly now?: () => Date;
  readonly bindings?: LogFields;
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields, err?: unknown): void;
  child(bindings: LogFields): Logger;
}

const defaultSink: LogSink = (line) => {
  process.stdout.write(`${line}\n`);
};

/** Aceita o valor de LOG_LEVEL (lido pelo chamador; este pacote nao le process.env). */
export function levelFromEnv(value: string | undefined): LogLevel {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error'
    ? value
    : 'info';
}

function sanitizeValue(key: string, value: unknown): string | number | boolean | null | undefined {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined; // objeto, array, funcao, bigint, symbol
  if (ID_FIELDS.has(key)) {
    if (UUID.test(value)) return value;
    const text = cleanText(value);
    return PREFIXED_ID.test(text) && !text.includes('[REDACTED') ? text : '[invalid-id]';
  }
  return cleanText(value);
}

function sanitize(fields: LogFields | undefined, into: Record<string, unknown>, dropped: string[]) {
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (!ALLOWED_FIELDS.has(key)) {
      // Nunca emitir a chave crua: ela pode carregar PII (ex.: quebra de linha + e-mail na chave).
      dropped.push(KEY_FORMAT.test(key) ? redactText(key) : '[invalid-key]');
      continue;
    }
    const clean = sanitizeValue(key, value);
    if (clean === undefined) dropped.push(key);
    else into[key] = clean;
  }
}

function errorFields(err: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (err && typeof err === 'object') {
    const e = err as { name?: unknown; code?: unknown };
    if (typeof e.name === 'string' && ERROR_NAME.test(e.name)) out.error_name = e.name;
    if (typeof e.code === 'string' && /^[A-Za-z0-9_.-]{1,40}$/.test(e.code))
      out.error_code = e.code;
  }
  return out;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const sink = options.sink ?? defaultSink;
  const threshold = ORDER[options.level ?? 'info'];
  const now = options.now ?? (() => new Date());
  const bindingFields: Record<string, unknown> = {};
  const bindingDropped: string[] = [];
  sanitize(options.bindings, bindingFields, bindingDropped);

  function write(level: LogLevel, msg: string, fields?: LogFields, err?: unknown): void {
    if (ORDER[level] < threshold) return;
    const ctx = getContext();
    const entry: Record<string, unknown> = {};
    const dropped = [...bindingDropped];
    sanitize({ ...(ctx ?? {}), ...bindingFields, ...fields, ...errorFields(err) }, entry, dropped);
    const line: Record<string, unknown> = {
      ts: now().toISOString(),
      level,
      msg: cleanText(String(msg)),
      ...entry,
    };
    if (dropped.length > 0) line.dropped_fields = [...new Set(dropped)];
    sink(JSON.stringify(line));
  }

  return {
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields, err) => write('error', msg, fields, err),
    child: (bindings) =>
      createLogger({
        level: options.level ?? 'info',
        sink,
        now,
        bindings: { ...bindingFields, ...bindings },
      }),
  };
}

/** Sink de memoria para testes: coleta as linhas emitidas. */
export function createMemorySink(): { sink: LogSink; lines: string[] } {
  const lines: string[] = [];
  return { sink: (line) => lines.push(line), lines };
}
