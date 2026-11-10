// Ciclo de correcao 1 da H-007. Dados SINTETICOS montados em tempo de execucao.
import { describe, expect, it } from 'vitest';
import { createLogger, createMemorySink, findPii, redactText } from '../src/index.js';

const email = ['ana.sintetica', 'exemplo.test'].join('@');

function setup() {
  const mem = createMemorySink();
  const log = createLogger({ sink: mem.sink, now: () => new Date('2026-01-02T03:04:05Z') });
  return { log, lines: mem.lines, last: () => JSON.parse(mem.lines.at(-1) ?? '{}') };
}

describe('nomes de campo descartados nunca saem crus', () => {
  it('chave com quebra de linha e e-mail vira [invalid-key]', () => {
    const { log, lines, last } = setup();
    log.info('x', { [`na\nme ${email}`]: 'v', ['a b']: 1, ['ok_field']: 2, status: 200 });
    expect(last().dropped_fields).toEqual(expect.arrayContaining(['[invalid-key]', 'ok_field']));
    const raw = lines.join('');
    expect(raw).not.toContain(email);
    expect(raw).not.toContain('na\\nme');
    expect(raw).not.toContain('sintetica');
  });

  it('o mesmo vale para bindings do child', () => {
    const { log, lines, last } = setup();
    log.child({ [`${email} x`]: 'v', module: 'billing' }).info('x');
    expect(last().dropped_fields).toEqual(['[invalid-key]']);
    expect(lines.join('')).not.toContain(email);
  });

  it('chave valida com aparencia de PII e redigida', () => {
    const { log, last } = setup();
    log.info('x', { [`11987654321`]: 1 });
    // comeca com digito: nao casa com o formato de chave
    expect(last().dropped_fields).toEqual(['[invalid-key]']);
  });
});

describe('redige antes de cortar em 200 caracteres', () => {
  it('valor longo: e-mail no limite nao deixa fragmento nem marcador parcial', () => {
    const { log, lines } = setup();
    const long = `${'z'.repeat(185)} ${email}`;
    log.info(long, { route: long });
    const parsed = JSON.parse(lines[0] ?? '{}');
    for (const text of [parsed.msg, parsed.route]) {
      expect(text.length).toBeLessThanOrEqual(215);
      expect(text).not.toContain('ana.sinte');
      expect(text).not.toContain('sintetica');
      expect(text).not.toMatch(/\[REDACTED:[^\]]*$/);
      expect(text.endsWith('[truncated]')).toBe(true);
    }
  });

  it('corte no meio de uma palavra descarta o final parcial', () => {
    const { log, last } = setup();
    log.info(`${'palavra '.repeat(30)}final`);
    const msg: string = last().msg;
    expect(msg.endsWith('palavra [truncated]')).toBe(true);
  });

  it('entrada enorme e limitada antes da redacao', () => {
    const { log, last } = setup();
    log.info('x'.repeat(1_000_000));
    expect(String(last().msg).length).toBeLessThan(230);
  });
});

describe('novos padroes de redacao', () => {
  const d = (...parts: string[]) => parts.join('');
  const samples: Array<[string, string]> = [
    ['phone', d('011 9', '8765', '-', '4321')],
    ['phone', d('55 11 9 ', '8765', ' ', '4321')],
    ['phone', d('+55 (11) 9', '8765', '4321')],
    ['cpf', '123 456 789 09'],
    ['cpf', d('123', '.', '456', '.', '789', ' 09')],
    ['cep', d('CEP ', '01310', '100')],
    ['cep', d('cep: ', '01310', '-', '100')],
    ['cep', d('01310', '-', '100')],
    ['credential', 'senha: ' + d('abc', '123', 'xyz')],
    ['credential', 'password: ' + d('abc', '123', 'xyz')],
    ['json-field', d('{"email":"', 'x', '","id":1}')],
    ['json-field', d('{"nome": "', 'Maria Sintetica', '"}')],
    ['json-field', d('{"senha":', 'abc123', '}')],
    ['query-secret', 'session=' + d('s3ss', '1onId99')],
    ['address', 'R. das Flores, 12'],
    ['address', 'Av Paulista 1000'],
    ['address', 'Rua das Flores, 12'],
    ['address', 'mora no bloco B apto 12'],
    ['email-obfuscated', 'ana [at] exemplo [dot] test'],
    ['email-obfuscated', 'ana @ exemplo.test'],
    ['email-obfuscated', 'ana(at)exemplo.test'],
    ['card', d('4111', ' ', '1111', ' ', '1111', ' ', '1111')],
    ['card', d('4111', '-', '1111', '-', '1111', '-', '1111')],
  ];

  it.each(samples)('detecta e redige %s: %s', (kind, sample) => {
    const out = redactText(`inicio ${sample} fim`);
    expect(out).toContain('[REDACTED:');
    expect(findPii(`inicio ${sample} fim`).length).toBeGreaterThan(0);
    expect(findPii(out)).toEqual([]);
    // o valor sensivel original nao sobrevive
    const core = sample.replace(/^(?:senha|password|session)\W*/i, '').split(/[ ,]/)[0] ?? '';
    if (core.length >= 5 && kind !== 'json-field') expect(out).not.toContain(core);
  });

  it('cartao: nao confunde com UUID, id ou timestamp', () => {
    const uuid = '12345678-1234-1234-1234-123456789012';
    expect(redactText(uuid)).toBe(uuid);
    expect(redactText('ts=1731260000000 id=req-12345')).toBe('ts=1731260000000 id=req-12345');
  });

  it('textos comuns seguem intactos (negativo)', () => {
    for (const text of [
      'pedido publicado status ok duracao 12 ms',
      'fila de e-mail com 3 itens',
      'tentativa 2 de 5',
      'senha incorreta',
    ]) {
      expect(redactText(text)).toBe(text);
    }
  });
});

describe('identificadores e nome de erro mais estritos', () => {
  it('principal_id/session_id/resource_id: UUID ou prefixo+sufixo; o resto vira [invalid-id]', () => {
    const { log, last } = setup();
    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    log.info('x', { principal_id: uuid, session_id: 'sess_ab12', resource_id: '11987654321' });
    expect(last()).toMatchObject({
      principal_id: uuid,
      session_id: 'sess_ab12',
      resource_id: '[invalid-id]',
    });
    log.info('x', { principal_id: 'maria', job_id: email });
    expect(last()).toMatchObject({ principal_id: '[invalid-id]', job_id: '[invalid-id]' });
  });

  it('error_name so aceita nomes terminados em Error', () => {
    const { log, last } = setup();
    log.error('x', {}, Object.assign(new Error('a'), { name: 'ValidationError' }));
    expect(last().error_name).toBe('ValidationError');
    log.error('x', {}, Object.assign(new Error('a'), { name: `Maria_Silva` }));
    expect(last()).not.toHaveProperty('error_name');
    log.error('x', {}, Object.assign(new Error('a'), { name: `Ana Error` }));
    expect(last()).not.toHaveProperty('error_name');
  });
});
