// H-093 | Selecao por ambiente (desenho 37 §1; CA-H093-01, 02; I-27). Sem rede.
// Decisao do usuario (2026-11-11): o Mailpit saiu do projeto; todos os ambientes usam o Resend.
import { FakeClock } from '@fastpro/testkit';
import { describe, expect, it } from 'vitest';
import {
  createEmailProvider,
  createMinimalRenderer,
  EmailConfigError,
  type EmailEnv,
} from '../src/index.js';
import { FakeHttp } from './doubles.js';

const deps = () => ({
  http: new FakeHttp(),
  renderer: createMinimalRenderer(),
  clock: new FakeClock(),
});

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
  it.each(['local', 'test', 'preview', 'staging', 'production'])(
    'APP_ENV=%s com EMAIL_PROVIDER=resend escolhe resend',
    (appEnv) => {
      expect(createEmailProvider({ ...HOSTED_RESEND, APP_ENV: appEnv }, deps()).name).toBe(
        'resend',
      );
    },
  );

  it.each(['local', 'test', 'preview', 'staging', 'production'])(
    'APP_ENV=%s com EMAIL_PROVIDER=mailpit recusa a partida (provedor fora da lista)',
    (appEnv) => {
      expect(startCode({ ...HOSTED_RESEND, APP_ENV: appEnv, EMAIL_PROVIDER: 'mailpit' })).toBe(
        'email_provider_invalido',
      );
    },
  );

  it.each([undefined, '', 'development', 'homolog', 'PRODUCTION'])(
    'APP_ENV invalido (%s) recusa a partida',
    (appEnv) => {
      expect(startCode({ ...HOSTED_RESEND, APP_ENV: appEnv })).toBe('app_env_invalido');
    },
  );

  it.each([undefined, '', 'sendgrid', 'Resend', 'mailpit', 'Mailpit'])(
    'EMAIL_PROVIDER invalido (%s) recusa a partida, sem padrao',
    (provider) => {
      expect(startCode({ ...HOSTED_RESEND, EMAIL_PROVIDER: provider })).toBe(
        'email_provider_invalido',
      );
    },
  );

  it('variaveis SMTP antigas nao mudam a escolha: o provedor continua Resend', () => {
    const env = { ...HOSTED_RESEND, APP_ENV: 'local', SMTP_HOST: '127.0.0.1', SMTP_PORT: '1025' };
    expect(createEmailProvider(env, deps()).name).toBe('resend');
  });

  it('mensagem de erro nao traz o valor da variavel', () => {
    const marcado = 'ambiente-marcado-de-teste';
    try {
      createEmailProvider({ ...HOSTED_RESEND, APP_ENV: marcado }, deps());
      throw new Error('deveria recusar');
    } catch (err) {
      expect(err).toBeInstanceOf(EmailConfigError);
      expect((err as Error).message).not.toContain(marcado);
    }
  });
});
