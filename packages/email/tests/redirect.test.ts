// Issue 160 | Provedor Resend com destino redirecionado em DEV/teste (desenho 188 §5, T-188-02 a
// T-188-12 do nivel de provedor). Offline: FakeHttp, sem rede. Somente caminho feliz e recusas de API.
import { FakeClock } from '@fastpro/testkit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CODE_PATTERN,
  HttpTransportError,
  ResendProvider,
  createMinimalRenderer,
} from '../src/index.js';
import type { EmailEnv, EmailRenderer } from '../src/index.js';
import { FakeHttp, response } from './doubles.js';

const KEY = 'chave-ficticia-0160';
const CONTA = 'conta.titular@fastpro.test';
const CLIENTE = 'cliente.exemplo@fastpro.test';
const ALVO = 'alvo.original@exemplo.test';
const CHAVE = 'nc:evento-160:usuario-1:aviso:escopo-1';

/** Ambiente de DEV/teste: remetente de teste, conta do titular e chave configurados. */
function devEnv(appEnv: string | undefined, extra: Partial<EmailEnv> = {}): EmailEnv {
  return {
    APP_ENV: appEnv,
    EMAIL_PROVIDER: 'resend',
    EMAIL_FROM: 'onboarding@resend.dev',
    RESEND_ACCOUNT_RECIPIENT: CONTA,
    RESEND_API_KEY: KEY,
    ...extra,
  };
}

function providerWith(env: EmailEnv, http: FakeHttp, renderer: EmailRenderer = createMinimalRenderer()) {
  return new ResendProvider(env, { http, renderer, clock: new FakeClock() });
}

const message = (to = CLIENTE, idempotencyKey = CHAVE) => ({
  to,
  templateKey: 'aviso_teste',
  params: {},
  idempotencyKey,
});

const OK = (id = 're_ok') => response(200, JSON.stringify({ id }));

/** Renderizador com texto fixo, para conferir o marcador e o texto preservado. */
const rendererFixo: EmailRenderer = {
  render: () => ({ subject: 'Assunto do modelo', text: 'Corpo do modelo' }),
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('T-188-02 | local e test redirecionam com o remetente de teste (CA-160-01)', () => {
  it.each(['local', 'test'])('%s: aceito, 1 chamada, to = conta, mesma chave de idempotencia', async (appEnv) => {
    const http = new FakeHttp().queue(OK('re_1'), OK('re_2'));
    const provider = providerWith(devEnv(appEnv), http);

    const primeiro = await provider.send(message());
    const segundo = await provider.send(message());

    expect(primeiro).toEqual({ kind: 'aceito', providerMessageId: 're_1' });
    expect(segundo).toEqual({ kind: 'aceito', providerMessageId: 're_2' });
    expect(http.requests).toHaveLength(2);
    for (const req of http.requests) {
      expect(JSON.parse(req.body).to).toBe(CONTA);
    }
    expect(http.requests[0]?.headers['Idempotency-Key']).toBe(http.requests[1]?.headers['Idempotency-Key']);
  });
});

describe('T-188-03 | ambientes fora de local e test recusam antes da API (CA-160-02)', () => {
  it.each(['production', 'staging'])('%s: recusa, 0 chamadas, sem o endereco original', async (appEnv) => {
    const http = new FakeHttp();
    const res = await providerWith(devEnv(appEnv), http).send(message(ALVO));

    expect(res).toEqual({ kind: 'recusa_permanente', code: 'destinatario_nao_permitido' });
    expect(http.requests).toHaveLength(0);
    expect(JSON.stringify(res)).not.toContain('alvo.original');
  });

  it('production com destino igual a conta: envio direto, sem marcador (comportamento de hoje)', async () => {
    const http = new FakeHttp().queue(OK('re_prod'));
    const res = await providerWith(devEnv('production'), http, rendererFixo).send(message(CONTA));

    expect(res).toEqual({ kind: 'aceito', providerMessageId: 're_prod' });
    const body = JSON.parse(http.requests[0]?.body ?? '{}');
    expect(body.to).toBe(CONTA);
    expect(body.subject).toBe('Assunto do modelo');
    expect(body.text).toBe('Corpo do modelo');
  });
});

describe('T-188-04 | conta ausente, vazia ou insegura e APP_ENV invalido recusam (CA-160-03)', () => {
  it.each([
    ['conta ausente', { RESEND_ACCOUNT_RECIPIENT: undefined }],
    ['conta vazia', { RESEND_ACCOUNT_RECIPIENT: '   ' }],
    ['conta insegura', { RESEND_ACCOUNT_RECIPIENT: 'a b@x' }],
  ])('%s: recusa com 0 chamadas', async (_nome, extra) => {
    const http = new FakeHttp();
    const res = await providerWith(devEnv('local', extra), http).send(message(ALVO));

    expect(res).toEqual({ kind: 'recusa_permanente', code: 'destinatario_nao_permitido' });
    expect(http.requests).toHaveLength(0);
  });

  it.each([undefined, '', 'dev', 'LOCAL'])('APP_ENV "%s" recusa com 0 chamadas', async (appEnv) => {
    const http = new FakeHttp();
    const res = await providerWith(devEnv(appEnv), http).send(message(ALVO));

    expect(res).toEqual({ kind: 'recusa_permanente', code: 'destinatario_nao_permitido' });
    expect(http.requests).toHaveLength(0);
  });
});

describe('T-188-05 | remetente de dominio verificado nunca redireciona (CA-160-10)', () => {
  const dominioEnv = (appEnv: string): EmailEnv => ({
    APP_ENV: appEnv,
    EMAIL_PROVIDER: 'resend',
    EMAIL_FROM: 'Equipe <avisos@fastpro.test>',
    RESEND_VERIFIED_DOMAIN: 'fastpro.test',
    RESEND_ACCOUNT_RECIPIENT: CONTA,
    RESEND_API_KEY: KEY,
  });

  it.each(['local', 'production'])('%s: to original, sem marcador no assunto nem no corpo', async (appEnv) => {
    const http = new FakeHttp().queue(OK('re_dom'));
    const res = await providerWith(dominioEnv(appEnv), http, rendererFixo).send(message(CLIENTE));

    expect(res).toEqual({ kind: 'aceito', providerMessageId: 're_dom' });
    const body = JSON.parse(http.requests[0]?.body ?? '{}');
    expect(body.to).toBe(CLIENTE);
    expect(body.subject).toBe('Assunto do modelo');
    expect(body.text).toBe('Corpo do modelo');
    expect(body.text).not.toContain('[Teste]');
  });
});

describe('T-188-06 | o endereco original nao sai em resultado, erro ou saida (CA-160-04)', () => {
  it('403 com corpo que repete o endereco, 429, 400, 500, tempo esgotado e excecao: nada vaza', async () => {
    const http = new FakeHttp().queue(
      response(403, `{"name":"validation_error","message":"enviar para ${ALVO}"}`),
      response(429, `limite para ${ALVO}`),
      response(400, `recusado para ${ALVO}`),
      response(500, `falha ${ALVO}`),
      new HttpTransportError('timeout'),
      new Error(`excecao com ${ALVO}`),
    );
    const espioes = {
      log: vi.spyOn(console, 'log').mockImplementation(() => undefined),
      error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      info: vi.spyOn(console, 'info').mockImplementation(() => undefined),
    };
    const provider = providerWith(devEnv('local'), http);

    const results = [];
    for (let i = 0; i < 6; i++) results.push(await provider.send(message(ALVO)));

    const serialized = JSON.stringify(results);
    expect(serialized).not.toContain('alvo.original');
    expect(serialized).not.toContain(ALVO);
    for (const r of results) {
      const code = 'code' in r ? r.code : undefined;
      if (code !== undefined) expect(code).toMatch(CODE_PATTERN);
    }
    for (const spy of Object.values(espioes)) {
      expect(spy).not.toHaveBeenCalled();
    }
    // O original existe somente no corpo HTTP capturado pelo dublê (campo de marcador).
    expect(http.requests).toHaveLength(6);
    for (const req of http.requests) {
      expect(JSON.parse(req.body).to).toBe(CONTA);
      expect(req.body).toContain(ALVO);
    }
  });
});

describe('T-188-07 | marcador no assunto e no corpo do envio redirecionado (CA-160-05)', () => {
  it('assunto com prefixo sem o endereco; primeira linha com o original; texto do modelo preservado', async () => {
    const http = new FakeHttp().queue(OK());
    await providerWith(devEnv('local'), http, rendererFixo).send(message(ALVO));

    const body = JSON.parse(http.requests[0]?.body ?? '{}');
    expect(body.subject).toBe('[Teste] Assunto do modelo');
    expect(body.subject).not.toContain(ALVO);
    const [primeira, vazia, ...resto] = String(body.text).split('\n');
    expect(primeira).toBe(
      `[Teste] Este e-mail era destinado a: ${ALVO}. Foi redirecionado para a conta de teste.`,
    );
    expect(vazia).toBe('');
    expect(resto.join('\n')).toBe('Corpo do modelo');
  });
});

describe('T-188-08 | o EmailMessage entregue ao provedor mantem o destino original (CA-160-09)', () => {
  it('message.to nao muda; so o corpo HTTP leva a conta', async () => {
    const http = new FakeHttp().queue(OK());
    const msg = message(ALVO);
    await providerWith(devEnv('local'), http).send(msg);

    expect(msg.to).toBe(ALVO);
    expect(JSON.parse(http.requests[0]?.body ?? '{}').to).toBe(CONTA);
  });
});

describe('T-188-10 | cota e idempotencia: uma chamada por tentativa, mesmo token (CA-160-06)', () => {
  it('erro 500 seguido de nova tentativa: 2 chamadas com o mesmo Idempotency-Key', async () => {
    const http = new FakeHttp().queue(response(500, 'falha'), OK('re_retry'));
    const provider = providerWith(devEnv('local'), http);

    const primeira = await provider.send(message(ALVO));
    const segunda = await provider.send(message(ALVO));

    expect(primeira).toEqual({ kind: 'indisponivel', code: 'resend_http_500' });
    expect(segunda).toEqual({ kind: 'aceito', providerMessageId: 're_retry' });
    expect(http.requests).toHaveLength(2);
    expect(http.requests[0]?.headers['Idempotency-Key']).toBe(http.requests[1]?.headers['Idempotency-Key']);
  });
});

describe('T-188-11 | endereco inseguro nao chega ao marcador (CA-160-03 e R-188-02)', () => {
  it.each(['alvo com espaco@exemplo.test', 'alvo\n@exemplo.test'])(
    'em local, destino "%j" recusa com destinatario_invalido e 0 chamadas',
    async (inseguro) => {
      const http = new FakeHttp();
      const res = await providerWith(devEnv('local'), http).send(message(inseguro));

      expect(res).toEqual({ kind: 'recusa_permanente', code: 'destinatario_invalido' });
      expect(http.requests).toHaveLength(0);
    },
  );
});

describe('T-188-12 | chaves distintas na conta compartilhada geram tokens distintos (R-188-05)', () => {
  it('dois desafios para destinatarios distintos: Idempotency-Key diferentes', async () => {
    const http = new FakeHttp().queue(OK('re_a'), OK('re_b'));
    const provider = providerWith(devEnv('local'), http);

    await provider.send(message(ALVO, 'ac:desafio-160-a'));
    await provider.send(message('outro.alvo@exemplo.test', 'ac:desafio-160-b'));

    expect(http.requests[0]?.headers['Idempotency-Key']).not.toBe(
      http.requests[1]?.headers['Idempotency-Key'],
    );
    expect(http.requests).toHaveLength(2);
  });
});
