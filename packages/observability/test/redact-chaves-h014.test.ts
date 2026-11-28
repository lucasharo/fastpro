// H-014 | Chaves code, secret e sid precisam ser mascaradas como chave (docs/factory/52-DESENHO-H014.md §5,
// item 5). Valores SINTETICOS montados em tempo de execucao. Sem rede, sem banco.
import { describe, expect, it } from 'vitest';
import { createLogger, createMemorySink, findPii, redactText } from '../src/index.js';

const CODE = ['48', '39', '20'].join('');
const SECRET = ['segredo', 'sintetico', '9f3a7c1e0b'].join('-');
const SID = ['sid', 'sintetico', 'abc123xyz'].join('-');

describe('code, secret e sid como chave JSON', () => {
  it('"code":"..." e mascarado', () => {
    const out = redactText(`{"code":"${CODE}"}`);
    expect(out).not.toContain(CODE);
    expect(findPii(`{"code":"${CODE}"}`)).toContain('json-field');
  });

  it('"secret":"..." e mascarado', () => {
    expect(redactText(`{"secret": "${SECRET}"}`)).not.toContain(SECRET);
  });

  it('"sid":"..." e mascarado', () => {
    expect(redactText(`{"sid":"${SID}"}`)).not.toContain(SID);
  });
});

describe('code, secret e sid como chave chave: valor', () => {
  it('code: valor e mascarado', () => {
    expect(redactText(`code: ${CODE}`)).not.toContain(CODE);
    expect(findPii(`code: ${CODE}`)).toContain('credential');
  });

  it('sid: valor e mascarado', () => {
    expect(redactText(`sid: ${SID}`)).not.toContain(SID);
  });

  it('secret: valor e mascarado (ja coberto, mantido como referencia)', () => {
    expect(redactText(`secret: ${SECRET}`)).not.toContain(SECRET);
  });
});

describe('logger: nenhum desses valores sai na linha de log', () => {
  // A mensagem passa por redactText. Campo fora de allowlist.json e descartado antes (por isso
  // o teste nao usa um campo livre: seria vacuo).
  it('mensagem com JSON contendo code, secret e sid nao vaza', () => {
    const mem = createMemorySink();
    const log = createLogger({ sink: mem.sink, now: () => new Date('2026-01-02T03:04:05Z') });
    log.info(JSON.stringify({ code: CODE, secret: SECRET, sid: SID }));
    const raw = mem.lines.join('');
    expect(raw).toContain('[REDACTED:json-field]');
    expect(raw).not.toContain(CODE);
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain(SID);
  });
});
