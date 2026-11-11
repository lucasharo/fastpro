// H-093 | Varredura de dados sensiveis (CA-H093-13, 14; desenho 37 §2.4, §5). Sem rede.
// Escopo da varredura: resultados, erros, cabecalhos e URL dos pedidos. O campo "to" do corpo do
// Resend e obrigatorio pela API e e o unico lugar onde o endereco de destino pode aparecer no pedido.
import { FakeClock } from '@fastpro/testkit';
import { describe, expect, it } from 'vitest';
import {
  CODE_PATTERN,
  createEmailProvider,
  createMinimalRenderer,
  EmailConfigError,
  HttpTransportError,
  SmtpFailure,
} from '../src/index.js';
import type { EmailEnv } from '../src/index.js';
import { FakeHttp, FakeSmtp, response } from './doubles.js';

const KEY = 'chave-ficticia-0009';
const CHAVE_EVENTO = 'nc:evento-1:usuario-77:aviso:escopo-9';
const CLIENTE = 'cliente.exemplo@fastpro.test';
const ACCOUNT = 'conta.titular@fastpro.test';
const HOST_MARCADO = 'smtp.segredo-de-teste.test';

const RESEND_ENV: EmailEnv = {
  APP_ENV: 'production',
  EMAIL_PROVIDER: 'resend',
  EMAIL_FROM: 'Equipe <avisos@fastpro.test>',
  RESEND_VERIFIED_DOMAIN: 'fastpro.test',
  RESEND_API_KEY: KEY,
};

const message = (to = CLIENTE) => ({
  to,
  templateKey: 'aviso_teste',
  params: {},
  idempotencyKey: CHAVE_EVENTO,
});

describe('varredura: Resend nao vaza destino, chave ou corpo fora da lista', () => {
  it('nenhum resultado, erro ou cabecalho contem endereco ou chave', async () => {
    const replies = [
      response(403, `{"name":"validation_error","message":"enviar para ${CLIENTE}"}`),
      response(429, 'rate limit'),
      response(400, `recusado para ${CLIENTE}`),
      response(500, `falha ${KEY} ${CLIENTE}`),
      response(200, JSON.stringify({ id: 're_ok' })),
    ];
    const http = new FakeHttp().queue(
      ...replies,
      new HttpTransportError('timeout'),
      new Error(`excecao com ${CLIENTE} e ${KEY}`),
    );
    const provider = createEmailProvider(RESEND_ENV, {
      smtp: new FakeSmtp(),
      http,
      renderer: createMinimalRenderer(),
      clock: new FakeClock(),
    });

    const results = [];
    for (let i = 0; i < 7; i++) results.push(await provider.send(message()));
    const serialized = JSON.stringify(results);
    expect(serialized).not.toContain(CLIENTE);
    expect(serialized).not.toContain(KEY);
    for (const r of results) {
      const code = 'code' in r ? r.code : undefined;
      if (code !== undefined) expect(code).toMatch(CODE_PATTERN);
    }

    for (const req of http.requests) {
      const headersWithoutAuth = { ...req.headers };
      delete headersWithoutAuth.Authorization;
      expect(JSON.stringify(headersWithoutAuth)).not.toContain(CLIENTE);
      expect(req.url).not.toContain(CLIENTE);
      expect(JSON.parse(req.body).to).toBe(CLIENTE);
      expect(req.body).not.toContain(KEY);
    }
  });

  it('o provedor serializado mostra so o nome', () => {
    const provider = createEmailProvider(RESEND_ENV, {
      smtp: new FakeSmtp(),
      http: new FakeHttp(),
      renderer: createMinimalRenderer(),
      clock: new FakeClock(),
    });
    expect(JSON.stringify(provider)).toBe('{"name":"resend"}');
    expect(JSON.stringify(provider)).not.toContain(KEY);
  });

  it('o destinatario da conta de teste nao aparece nos resultados de recusa', async () => {
    const provider = createEmailProvider(
      { ...RESEND_ENV, EMAIL_FROM: 'onboarding@resend.dev', RESEND_ACCOUNT_RECIPIENT: ACCOUNT },
      {
        smtp: new FakeSmtp(),
        http: new FakeHttp(),
        renderer: createMinimalRenderer(),
        clock: new FakeClock(),
      },
    );
    const res = await provider.send(message('outra.pessoa@fastpro.test'));
    expect(res).toEqual({ kind: 'recusa_permanente', code: 'destinatario_nao_permitido' });
    expect(JSON.stringify(res)).not.toContain('outra.pessoa');
  });
});

describe('varredura: Mailpit e erros de partida', () => {
  it('resultados e falhas do SMTP nao carregam o destino', async () => {
    const smtp = new FakeSmtp().queue(
      new SmtpFailure('resposta', 550),
      new SmtpFailure('conexao_recusada'),
      new Error(`falha para ${CLIENTE}`),
    );
    const provider = createEmailProvider(
      {
        APP_ENV: 'test',
        EMAIL_PROVIDER: 'mailpit',
        EMAIL_FROM: 'avisos@fastpro.test',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '1025',
      },
      { smtp, http: new FakeHttp(), renderer: createMinimalRenderer(), clock: new FakeClock() },
    );
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await provider.send(message()));
    expect(JSON.stringify(results)).not.toContain(CLIENTE);
  });

  it('erros de configuracao nao mostram o valor da variavel', () => {
    try {
      createEmailProvider(
        {
          APP_ENV: 'test',
          EMAIL_PROVIDER: 'mailpit',
          EMAIL_FROM: 'a@fastpro.test',
          SMTP_HOST: HOST_MARCADO,
          SMTP_PORT: '1025',
        },
        {
          smtp: new FakeSmtp(),
          http: new FakeHttp(),
          renderer: createMinimalRenderer(),
          clock: new FakeClock(),
        },
      );
      throw new Error('deveria recusar');
    } catch (err) {
      expect(err).toBeInstanceOf(EmailConfigError);
      expect((err as Error).message).not.toContain(HOST_MARCADO);
      expect((err as Error).message).not.toContain(CLIENTE);
    }
  });
});
