// Todos os dados abaixo sao SINTETICOS e montados em tempo de execucao (B-43; RF-163).
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_FIELDS,
  createLogger,
  createMemorySink,
  findPii,
  getContext,
  levelFromEnv,
  newRequestId,
  redactText,
  runWithContext,
} from '../src/index.js';

const part = (n: number, c = 'a') => c.repeat(n);
const email = ['ana.sintetica', 'exemplo.test'].join('@');
const phone = `(11) 9${'8765'}-${'4321'}`;
const phoneIntl = `+55 11 9${'8765'}${'4321'}`;
const cpf = ['123', '456', '789'].join('.') + '-09';
const cnpj = ['12', '345', '678'].join('.') + '/0001-95';
const jwt = ['eyJ' + part(12, 'A'), 'eyJ' + part(12, 'B'), part(12, 'C')].join('.');
const bearer = 'Bearer ' + part(24, 'x1');
const skKey = ['sk', 'live', part(20, 'Z9')].join('_');
const whsec = 'whsec_' + part(20, 'q7');
const sbKey = ['sb', 'secret', part(20, 'k3')].join('_');
const street = 'Rua das Flores Sinteticas 123';

function setup(level?: 'debug' | 'info' | 'warn' | 'error') {
  const mem = createMemorySink();
  const log = createLogger({ sink: mem.sink, level, now: () => new Date('2026-01-02T03:04:05Z') });
  return { log, lines: mem.lines, last: () => JSON.parse(mem.lines.at(-1) ?? '{}') };
}

describe('redactText', () => {
  it.each([
    ['email', email],
    ['phone', phone],
    ['phone', phoneIntl],
    ['cpf', cpf],
    ['cpf', '12345678909'],
    ['cnpj', cnpj],
    ['jwt', jwt],
    ['bearer', bearer],
    ['secret', skKey],
    ['secret', whsec],
    ['secret', sbKey],
    ['address', street],
    ['header', `Authorization: ${part(10, 'z')}`],
    ['header', `cookie: sid=${part(10, 'z')}`],
    ['url-credentials', `postgres://app:${part(10, 'p1')}@db.example.test/x`],
    ['query-secret', `https://x.test/cb?token=${part(10, 't1')}`],
    ['hex-secret', part(40, 'a1')],
  ])('redige %s', (kind, sample) => {
    const out = redactText(`antes ${sample} depois`);
    expect(out).toContain('[REDACTED:');
    expect(out).not.toContain(sample);
    expect(findPii(`antes ${sample} depois`)).toContain(kind === 'cpf' ? 'cpf' : kind);
    expect(findPii(out)).toEqual([]);
  });

  it('nao altera texto sem PII (negativo)', () => {
    const clean = 'pedido publicado status=ok duracao 12 ms';
    expect(redactText(clean)).toBe(clean);
    expect(findPii(clean)).toEqual([]);
    const uuid = newRequestId();
    expect(redactText(uuid)).toBe(uuid);
  });
});

describe('logger com allowlist', () => {
  it('emite JSON com campos permitidos', () => {
    const { log, last } = setup();
    log.info('aceite registrado', { module: 'requests', status: 200, duration_ms: 12.5, ok: true });
    expect(last()).toMatchObject({
      ts: '2026-01-02T03:04:05.000Z',
      level: 'info',
      msg: 'aceite registrado',
      module: 'requests',
      status: 200,
      duration_ms: 12.5,
    });
  });

  it('descarta campos fora da allowlist e registra so os NOMES', () => {
    const { log, lines, last } = setup();
    log.info('x', {
      status: 200,
      email,
      phone,
      cpf,
      address: street,
      name: 'Ana Sintetica',
      token: jwt,
      authorization: bearer,
      cookie: 'sid=1',
      body: { texto: 'mensagem privada' },
      message: 'mensagem privada',
    });
    const out = last();
    expect(out.status).toBe(200);
    for (const k of [
      'email',
      'phone',
      'cpf',
      'address',
      'name',
      'token',
      'authorization',
      'cookie',
      'body',
      'message',
    ]) {
      expect(out).not.toHaveProperty(k);
    }
    expect(out.dropped_fields).toEqual(
      expect.arrayContaining([
        'email',
        'phone',
        'cpf',
        'address',
        'name',
        'token',
        'authorization',
        'cookie',
        'body',
        'message',
      ]),
    );
    const raw = lines.join('\n');
    for (const secret of [
      email,
      phone,
      cpf,
      street,
      'Ana Sintetica',
      jwt,
      bearer,
      'mensagem privada',
    ]) {
      expect(raw).not.toContain(secret);
    }
    expect(findPii(raw)).toEqual([]);
  });

  it('redige PII em valores de campos permitidos e na mensagem', () => {
    const { log, lines } = setup();
    log.warn(`falha para ${email} em ${cpf}`, { route: `/clientes/${email}`, event: phone });
    const raw = lines.join('\n');
    expect(raw).not.toContain(email);
    expect(raw).not.toContain(cpf);
    expect(raw).not.toContain(phone);
    expect(raw).toContain('[REDACTED:email]');
    expect(findPii(raw)).toEqual([]);
  });

  it('descarta valores objeto/array/funcao e corta strings longas', () => {
    const { log, last } = setup();
    log.info('x', {
      module: { a: email } as unknown,
      route: [email] as unknown,
      event: () => 1,
      queue: 'q'.repeat(500),
    });
    const out = last();
    expect(out).not.toHaveProperty('module');
    expect(out).not.toHaveProperty('route');
    expect(out).not.toHaveProperty('event');
    expect(String(out.queue).length).toBeLessThanOrEqual(200);
  });

  it('campos de identificador devem ter formato de ID (e-mail como principal_id e rejeitado)', () => {
    const { log, lines, last } = setup();
    log.info('x', { principal_id: email, request_id: 'req_abc-123', job_id: 'x y' });
    const out = last();
    expect(out.principal_id).toBe('[invalid-id]');
    expect(out.request_id).toBe('req_abc-123');
    expect(out.job_id).toBe('[invalid-id]');
    expect(lines.join('')).not.toContain(email);
  });

  it('erro: so error_name/error_code; mensagem e stack (com PII) nunca saem', () => {
    const { log, lines, last } = setup();
    const err = Object.assign(new TypeError(`falha com ${email}`), { code: '23505' });
    log.error('erro ao gravar', { module: 'db' }, err);
    expect(last()).toMatchObject({ level: 'error', error_name: 'TypeError', error_code: '23505' });
    expect(lines.join('')).not.toContain(email);
    expect(lines.join('')).not.toContain('stack');
  });

  it('respeita o nivel minimo e levelFromEnv', () => {
    const { log, lines } = setup('warn');
    log.debug('a');
    log.info('b');
    log.warn('c');
    log.error('d');
    expect(lines).toHaveLength(2);
    expect(levelFromEnv('debug')).toBe('debug');
    expect(levelFromEnv(undefined)).toBe('info');
    expect(levelFromEnv('trace')).toBe('info');
  });

  it('child herda bindings permitidos e descarta os proibidos', () => {
    const { log, last } = setup();
    const child = log.child({ module: 'billing', email });
    child.info('x');
    expect(last()).toMatchObject({ module: 'billing' });
    expect(last()).not.toHaveProperty('email');
    expect(last().dropped_fields).toContain('email');
  });

  it('allowlist nao contem nenhum campo de PII', () => {
    const forbidden =
      /mail|phone|telefone|fone|address|endereco|name|nome|cpf|cnpj|token|key|secret|password|senha|body|cookie|authorization|header|message|content/i;
    // error_name e o NOME DA CLASSE do erro (ex.: TypeError), validado por formato; nao e nome de pessoa.
    for (const field of ALLOWED_FIELDS) {
      if (field !== 'error_name') expect(field, field).not.toMatch(forbidden);
    }
  });
});

describe('correlacao por request id', () => {
  it('request_id e correlation_id vem do contexto e atravessam await', async () => {
    const { log, lines } = setup();
    await runWithContext({ request_id: 'req-1' }, async () => {
      log.info('inicio');
      await new Promise((r) => setTimeout(r, 5));
      log.info('fim');
      expect(getContext()).toEqual({ request_id: 'req-1', correlation_id: 'req-1' });
    });
    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed.map((p) => p.request_id)).toEqual(['req-1', 'req-1']);
    expect(parsed.map((p) => p.correlation_id)).toEqual(['req-1', 'req-1']);
    expect(getContext()).toBeUndefined();
  });

  it('contextos concorrentes nao se misturam; correlation_id propagado e preservado', async () => {
    const { log, lines } = setup();
    await Promise.all(
      ['a', 'b', 'c'].map((id) =>
        runWithContext({ request_id: `req-${id}`, correlation_id: 'corr-1' }, async () => {
          await new Promise((r) => setTimeout(r, Math.random() * 5));
          log.info(`evento ${id}`);
        }),
      ),
    );
    for (const l of lines) {
      const p = JSON.parse(l);
      expect(p.msg).toBe(`evento ${p.request_id.slice(-1)}`);
      expect(p.correlation_id).toBe('corr-1');
    }
  });

  it('gera request_id quando nao informado e sem contexto nao inventa ids', () => {
    const { log, last } = setup();
    log.info('sem contexto');
    expect(last()).not.toHaveProperty('request_id');
    runWithContext({}, () => log.info('com contexto'));
    expect(last().request_id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('varredura dos logs de um fluxo de teste (T-11)', () => {
  it('fluxo completo com dados sinteticos nao deixa PII na saida', () => {
    const { log, lines } = setup('debug');
    runWithContext({}, () => {
      log.debug('inicio', { module: 'identity', body: { email, phone } });
      log.info(`cliente ${email} pediu contato`, {
        route: '/v1/requests',
        method: 'POST',
        status: 201,
      });
      log.warn('webhook rejeitado', { event: whsec, error_code: 'sig_invalid' });
      log.error(`falha ${bearer}`, { principal_id: 'p_1' }, new Error(cpf));
    });
    expect(lines.length).toBe(4);
    expect(findPii(lines.join('\n'))).toEqual([]);
  });
});
