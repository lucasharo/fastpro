// H-093 | Mailpit por contrato SMTP (desenho 37 §2.2, §4.2; CA-H093-03, 04, 07). Dublê SMTP, sem rede.
import { FakeClock } from '@fastpro/testkit';
import type { EmailMessage } from '@fastpro/domain';
import { describe, expect, it } from 'vitest';
import {
  createEmailProvider,
  createMinimalRenderer,
  idempotencyToken,
  SmtpFailure,
} from '../src/index.js';
import type { EmailEnv } from '../src/index.js';
import { FakeHttp, FakeSmtp, first } from './doubles.js';

const DEV: EmailEnv = {
  APP_ENV: 'local',
  EMAIL_PROVIDER: 'mailpit',
  EMAIL_FROM: 'Equipe <avisos@fastpro.test>',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
};
const CLIENTE = 'cliente.exemplo@fastpro.test';

function setup(smtp = new FakeSmtp(), http = new FakeHttp()) {
  const provider = createEmailProvider(DEV, {
    smtp,
    http,
    renderer: createMinimalRenderer(),
    clock: new FakeClock(),
  });
  return { provider, smtp, http };
}

function msg(key = 'nc:evento-1:usuario-77:aviso:escopo-9', to = CLIENTE): EmailMessage {
  return { to, templateKey: 'aviso_teste', params: {}, idempotencyKey: key };
}

describe('Mailpit: envio pelo contrato SMTP', () => {
  it('se identifica como mailpit e nao usa HTTP', async () => {
    const { provider, http, smtp } = setup();
    expect(provider.name).toBe('mailpit');
    const res = await provider.send(msg());
    expect(res.kind).toBe('aceito');
    expect(http.requests).toHaveLength(0);
    expect(smtp.mails).toHaveLength(1);
  });

  it('envelope e cabecalhos seguem a lista do desenho (sem dado fora dela)', async () => {
    const { provider, smtp } = setup();
    await provider.send(msg());
    const mail = first(smtp.mails);
    expect(mail.host).toBe('localhost');
    expect(mail.port).toBe(1025);
    expect(mail.envelope).toEqual({ from: 'avisos@fastpro.test', to: CLIENTE });
    expect(mail.raw).toContain('From: Equipe <avisos@fastpro.test>\r\n');
    expect(mail.raw).toContain(`To: ${CLIENTE}\r\n`);
    expect(mail.raw).toContain('X-FastPro-Template: aviso_teste\r\n');
    const messageId = `<${idempotencyToken('nc:evento-1:usuario-77:aviso:escopo-9')}@fastpro.invalid>`;
    expect(mail.raw).toContain(`Message-ID: ${messageId}\r\n`);
    expect(mail.raw).not.toContain('usuario-77');
  });

  it('aceito devolve o Message-ID usado como identificador do provedor', async () => {
    const { provider } = setup();
    const res = await provider.send(msg());
    expect(res).toEqual({
      kind: 'aceito',
      providerMessageId: `<${idempotencyToken('nc:evento-1:usuario-77:aviso:escopo-9')}@fastpro.invalid>`,
    });
  });

  it('a mesma chave gera o mesmo Message-ID e chaves diferentes geram IDs diferentes', async () => {
    const { provider, smtp } = setup();
    await provider.send(msg('chave-a'));
    await provider.send(msg('chave-a'));
    await provider.send(msg('chave-b'));
    const ids = smtp.mails.map((m) => /Message-ID: (\S+)/.exec(m.raw)?.[1]);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).not.toBe(ids[2]);
  });

  it('destinatario com quebra de linha e recusado antes do SMTP', async () => {
    const { provider, smtp } = setup();
    expect(await provider.send(msg('k', 'a@fastpro.test\r\nBcc: b@x.test'))).toEqual({
      kind: 'recusa_permanente',
      code: 'destinatario_invalido',
    });
    expect(smtp.mails).toHaveLength(0);
  });

  it('chave de modelo fora do formato e recusada antes do SMTP', async () => {
    const { provider, smtp } = setup();
    const res = await provider.send({ ...msg(), templateKey: 'Modelo Com Espaco' });
    expect(res).toEqual({ kind: 'recusa_permanente', code: 'template_invalido' });
    expect(smtp.mails).toHaveLength(0);
  });
});

describe('Mailpit: tabela de falhas SMTP (§4.2)', () => {
  it.each<[string, number | Error, unknown]>([
    [
      'resposta 250',
      250,
      { kind: 'aceito', providerMessageId: expect.stringMatching(/@fastpro\.invalid>$/) },
    ],
    ['451 (4xx)', new SmtpFailure('resposta', 451), { kind: 'indisponivel', code: 'smtp_4xx' }],
    [
      '550 (5xx)',
      new SmtpFailure('resposta', 550),
      { kind: 'recusa_permanente', code: 'smtp_5xx' },
    ],
    [
      'conexao recusada',
      new SmtpFailure('conexao_recusada'),
      { kind: 'indisponivel', code: 'mailpit_indisponivel' },
    ],
    ['tempo esgotado', new SmtpFailure('timeout'), { kind: 'indisponivel', code: 'timeout' }],
    [
      'resposta sem codigo',
      new SmtpFailure('resposta'),
      { kind: 'indisponivel', code: 'smtp_inesperado' },
    ],
    ['erro inesperado', new Error('x'), { kind: 'indisponivel', code: 'smtp_inesperado' }],
  ])('%s', async (_label, outcome, expected) => {
    const smtp = new FakeSmtp().queue(outcome);
    const { provider } = setup(smtp);
    expect(await provider.send(msg())).toEqual(expected);
  });
});
