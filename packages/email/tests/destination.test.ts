// Issue 160 | Decisao pura de destino em DEV/teste (desenho 188 §3.1, §5 T-188-01). Sem rede e sem I/O.
import { describe, expect, it } from 'vitest';
import { decidirDestino, marcarRedirecionado, REDIRECT_APP_ENVS, RESEND_TEST_SENDER } from '../src/index.js';

const CONTA = 'conta.titular@fastpro.test';
const CLIENTE = 'cliente.exemplo@fastpro.test';
const DOMINIO_VERIFICADO = 'avisos@fastpro.test';

const base = {
  from: RESEND_TEST_SENDER,
  recipient: CLIENTE,
  accountRecipient: CONTA,
};

describe('decidirDestino: conjunto de ambientes (fail-closed)', () => {
  it('REDIRECT_APP_ENVS e exatamente local e test', () => {
    expect([...REDIRECT_APP_ENVS]).toEqual(['local', 'test']);
  });

  it.each(['local', 'test'])('%s redireciona para a conta', (appEnv) => {
    expect(decidirDestino({ ...base, appEnv })).toEqual({ kind: 'redirecionado', to: CONTA });
  });

  it.each(['preview', 'staging', 'production', '', 'dev', 'development', 'LOCAL', 'Test'])(
    'APP_ENV "%s" recusa, sem redirecionar',
    (appEnv) => {
      expect(decidirDestino({ ...base, appEnv })).toEqual({
        kind: 'recusado',
        code: 'destinatario_nao_permitido',
      });
    },
  );

  it('APP_ENV ausente recusa', () => {
    expect(decidirDestino({ ...base, appEnv: undefined })).toEqual({
      kind: 'recusado',
      code: 'destinatario_nao_permitido',
    });
  });
});

describe('decidirDestino: remetente, conta e destino', () => {
  it('remetente de dominio verificado nunca redireciona, em local e em production', () => {
    for (const appEnv of ['local', 'production']) {
      expect(
        decidirDestino({ ...base, from: DOMINIO_VERIFICADO, appEnv }),
      ).toEqual({ kind: 'direto' });
    }
  });

  it('remetente ausente (null) e tratado como fora do remetente de teste', () => {
    expect(decidirDestino({ ...base, from: null, appEnv: 'local' })).toEqual({ kind: 'direto' });
  });

  it.each([
    ['ausente', undefined],
    ['vazia', ''],
    ['so espacos', '   '],
    ['insegura (espaco)', 'a b@fastpro.test'],
    ['insegura (sem arroba)', 'contafastpro.test'],
  ])('conta %s recusa, mesmo em local', (_nome, accountRecipient) => {
    expect(decidirDestino({ ...base, accountRecipient, appEnv: 'local' })).toEqual({
      kind: 'recusado',
      code: 'destinatario_nao_permitido',
    });
  });

  it.each(['local', 'test', 'production'])('destino igual a conta e direto, sem marcador, em %s', (appEnv) => {
    expect(decidirDestino({ ...base, recipient: CONTA, appEnv })).toEqual({ kind: 'direto' });
  });

  it('destino igual a conta ignora maiusculas e espacos da conta', () => {
    expect(
      decidirDestino({ ...base, recipient: CONTA.toUpperCase(), accountRecipient: ` ${CONTA} `, appEnv: 'production' }),
    ).toEqual({ kind: 'direto' });
  });

  it('o to do redirecionamento e a conta com espacos das bordas removidos', () => {
    expect(decidirDestino({ ...base, accountRecipient: ` ${CONTA} `, appEnv: 'local' })).toEqual({
      kind: 'redirecionado',
      to: CONTA,
    });
  });
});

describe('marcarRedirecionado (desenho 188 §3.1, D-188-06)', () => {
  const rendered = { subject: 'Seu codigo', text: 'Corpo do modelo.\nSegunda linha.' };
  const ORIGINAL = 'alvo.original@fastpro.test';

  it('assunto recebe o prefixo sem o endereco original', () => {
    const marcado = marcarRedirecionado(rendered, ORIGINAL);
    expect(marcado.subject).toBe('[Teste] Seu codigo');
    expect(marcado.subject).not.toContain(ORIGINAL);
  });

  it('corpo abre com a linha do original, uma linha em branco e o texto do modelo intacto', () => {
    const marcado = marcarRedirecionado(rendered, ORIGINAL);
    const linhas = marcado.text.split('\n');
    expect(linhas[0]).toBe(
      `[Teste] Este e-mail era destinado a: ${ORIGINAL}. Foi redirecionado para a conta de teste.`,
    );
    expect(linhas[1]).toBe('');
    expect(marcado.text).toBe(
      `[Teste] Este e-mail era destinado a: ${ORIGINAL}. Foi redirecionado para a conta de teste.\n\n${rendered.text}`,
    );
  });

  it('nao muda o rendered original (funcao pura)', () => {
    marcarRedirecionado(rendered, ORIGINAL);
    expect(rendered).toEqual({ subject: 'Seu codigo', text: 'Corpo do modelo.\nSegunda linha.' });
  });
});
