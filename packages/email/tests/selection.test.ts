// H-093 | Selecao por ambiente (desenho 37 §1; CA-H093-01, 02; I-27). Sem rede.
import { FakeClock } from '@fastpro/testkit';
import { describe, expect, it } from 'vitest';
import {
  createEmailProvider,
  createMinimalRenderer,
  EmailConfigError,
  type EmailEnv,
} from '../src/index.js';
import { FakeHttp, FakeSmtp } from './doubles.js';

const deps = () => ({
  smtp: new FakeSmtp(),
  http: new FakeHttp(),
  renderer: createMinimalRenderer(),
  clock: new FakeClock(),
});

const DEV_MAIL: EmailEnv = {
  APP_ENV: 'local',
  EMAIL_PROVIDER: 'mailpit',
  EMAIL_FROM: 'Equipe <avisos@fastpro.test>',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1025',
};

const CHAVE = 'chave-ficticia-0001';
const HOSTED_RESEND: EmailEnv = {
  APP_ENV: 'production',
  EMAIL_PROVIDER: 'resend',
  EMAIL_FROM: 'Equipe <avisos@fastpro.test>',
  RESEND_VERIFIED_DOMAIN: 'fastpro.test',
  RESEND_API_KEY: CHAVE,
};

/** Devolve o codigo do erro de configuracao, ou 'sem_erro' se a partida foi aceita. */
function startCode(env: EmailEnv): string {
  try {
    createEmailProvider(env, deps());
    return 'sem_erro';
  } catch (err) {
    return err instanceof EmailConfigError ? err.code : 'erro_inesperado';
  }
}

describe('createEmailProvider: tabela de ambiente', () => {
  it.each([
    ['local', 'mailpit', 'mailpit'],
    ['test', 'mailpit', 'mailpit'],
    ['preview', 'resend', 'resend'],
    ['staging', 'resend', 'resend'],
    ['production', 'resend', 'resend'],
  ])('APP_ENV=%s com EMAIL_PROVIDER=%s escolhe %s', (appEnv, provider, expected) => {
    const env =
      provider === 'mailpit'
        ? { ...DEV_MAIL, APP_ENV: appEnv, EMAIL_PROVIDER: provider }
        : { ...HOSTED_RESEND, APP_ENV: appEnv, EMAIL_PROVIDER: provider };
    expect(createEmailProvider(env, deps()).name).toBe(expected);
  });

  it.each([
    ['local', 'resend', 'email_provider_incompativel_com_ambiente'],
    ['test', 'resend', 'email_provider_incompativel_com_ambiente'],
    ['preview', 'mailpit', 'email_provider_incompativel_com_ambiente'],
    ['staging', 'mailpit', 'email_provider_incompativel_com_ambiente'],
    ['production', 'mailpit', 'email_provider_incompativel_com_ambiente'],
  ])('APP_ENV=%s com EMAIL_PROVIDER=%s recusa a partida (%s)', (appEnv, provider, code) => {
    const env = { ...HOSTED_RESEND, ...DEV_MAIL, APP_ENV: appEnv, EMAIL_PROVIDER: provider };
    expect(startCode(env)).toBe(code);
  });

  it.each([undefined, '', 'development', 'homolog', 'PRODUCTION'])(
    'APP_ENV invalido (%s) recusa a partida',
    (appEnv) => {
      expect(startCode({ ...DEV_MAIL, APP_ENV: appEnv })).toBe('app_env_invalido');
    },
  );

  it.each([undefined, '', 'sendgrid', 'Mailpit'])(
    'EMAIL_PROVIDER invalido (%s) recusa a partida, sem padrao',
    (provider) => {
      expect(startCode({ ...DEV_MAIL, EMAIL_PROVIDER: provider })).toBe('email_provider_invalido');
    },
  );
});

describe('createEmailProvider: Mailpit exige laco local e remetente valido', () => {
  it.each([undefined, '', 'smtp.exemplo-interno.test', '10.0.0.5'])(
    'SMTP_HOST nao local (%s) recusa a partida',
    (host) => {
      expect(startCode({ ...DEV_MAIL, SMTP_HOST: host })).toBe('smtp_host_nao_local');
    },
  );

  it.each(['', 'abc', '0', '70000', '1.5'])('SMTP_PORT invalida (%s) recusa a partida', (port) => {
    expect(startCode({ ...DEV_MAIL, SMTP_PORT: port })).toBe('smtp_porta_invalida');
  });

  it.each([undefined, '', 'sem-arroba', 'a@b.test\r\nBcc: x@y.test'])(
    'EMAIL_FROM invalido recusa a partida',
    (from) => {
      expect(startCode({ ...DEV_MAIL, EMAIL_FROM: from })).toBe('email_from_invalido');
    },
  );

  it('aceita localhost, 127.0.0.1 e ::1', () => {
    for (const host of ['localhost', '127.0.0.1', '::1']) {
      expect(startCode({ ...DEV_MAIL, SMTP_HOST: host })).toBe('sem_erro');
    }
  });

  it('mensagem de erro nao traz o valor da variavel', () => {
    const host = 'smtp.segredo-de-teste.test';
    try {
      createEmailProvider({ ...DEV_MAIL, SMTP_HOST: host }, deps());
      throw new Error('deveria recusar');
    } catch (err) {
      expect(err).toBeInstanceOf(EmailConfigError);
      expect((err as Error).message).not.toContain(host);
    }
  });
});
