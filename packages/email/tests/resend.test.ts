// H-093 | Resend: falha fechada, mapeamento de erro e idempotencia (desenho 37 §3, §4.1, §4.3).
// Desvio do desenho 37 aplicado: remetente de teste so para o destinatario da conta. Sem rede.
import { FakeClock } from '@fastpro/testkit';
import type { EmailMessage } from '@fastpro/domain';
import { describe, expect, it } from 'vitest';
import {
  classifyResendResponse,
  createEmailProvider,
  createMinimalRenderer,
  HttpTransportError,
  idempotencyToken,
  RESEND_ENDPOINT,
  RESEND_TIMEOUT_MS,
  ResendProvider,
  secondsUntilNextUtcDay,
} from '../src/index.js';
import type { EmailEnv } from '../src/index.js';
import { FakeHttp, first, response } from './doubles.js';

const KEY = 'chave-ficticia-0001';
const ACCOUNT = 'conta.titular@fastpro.test';
const CLIENTE = 'cliente.exemplo@fastpro.test';
const KEY_IDEM = 'nc:evento-1:usuario-77:aviso:escopo-9';

const VERIFIED: EmailEnv = {
  APP_ENV: 'production',
  EMAIL_PROVIDER: 'resend',
  EMAIL_FROM: 'Equipe <avisos@fastpro.test>',
  RESEND_VERIFIED_DOMAIN: 'fastpro.test',
  RESEND_API_KEY: KEY,
};

const TEST_SENDER: EmailEnv = {
  APP_ENV: 'production',
  EMAIL_PROVIDER: 'resend',
  EMAIL_FROM: 'onboarding@resend.dev',
  RESEND_API_KEY: KEY,
  RESEND_ACCOUNT_RECIPIENT: ACCOUNT,
};

function message(to: string = CLIENTE): EmailMessage {
  return { to, templateKey: 'aviso_teste', params: {}, idempotencyKey: KEY_IDEM };
}

function build(env: EmailEnv, http: FakeHttp, clock = new FakeClock()) {
  const provider = createEmailProvider(env, {
    http,
    renderer: createMinimalRenderer(),
    clock,
  });
  if (!(provider instanceof ResendProvider)) throw new Error('esperado ResendProvider');
  return provider;
}

describe('Resend: falha fechada antes de qualquer chamada (CA-H093-05, 06; N-10)', () => {
  it.each([
    ['marcador ausente', { RESEND_VERIFIED_DOMAIN: undefined }],
    ['marcador vazio', { RESEND_VERIFIED_DOMAIN: '' }],
    ['remetente fora do dominio', { EMAIL_FROM: 'avisos@outro.test' }],
    [
      'remetente em resend.dev (nao e o de teste)',
      { EMAIL_FROM: 'avisos@resend.dev', RESEND_VERIFIED_DOMAIN: 'resend.dev' },
    ],
  ])('%s: dominio_nao_verificado e zero chamadas', async (_label, change) => {
    const http = new FakeHttp();
    const env = { ...VERIFIED, ...change };
    const res = await build(env, http).send(message());
    expect(res).toEqual({ kind: 'nao_configurado', code: 'dominio_nao_verificado' });
    expect(http.requests).toHaveLength(0);
  });

  it.each([undefined, '', '   '])(
    'chave ausente (%s): segredo_ausente e zero chamadas',
    async (key) => {
      const http = new FakeHttp();
      const res = await build({ ...VERIFIED, RESEND_API_KEY: key }, http).send(message());
      expect(res).toEqual({ kind: 'nao_configurado', code: 'segredo_ausente' });
      expect(http.requests).toHaveLength(0);
    },
  );

  it('ordem: sem dominio e sem chave, vale dominio_nao_verificado', async () => {
    const http = new FakeHttp();
    const env = { ...VERIFIED, RESEND_VERIFIED_DOMAIN: '', RESEND_API_KEY: '' };
    expect(await build(env, http).send(message())).toEqual({
      kind: 'nao_configurado',
      code: 'dominio_nao_verificado',
    });
    expect(http.requests).toHaveLength(0);
  });

  it('dominio verificado e chave presentes: uma chamada, com endereco e cabecalhos corretos', async () => {
    const http = new FakeHttp().queue(response(200, JSON.stringify({ id: 're_ficticio_1' })));
    const res = await build(VERIFIED, http).send(message());
    expect(res).toEqual({ kind: 'aceito', providerMessageId: 're_ficticio_1' });
    const req = first(http.requests);
    expect(req.url).toBe(RESEND_ENDPOINT);
    expect(req.timeoutMs).toBe(RESEND_TIMEOUT_MS);
    expect(req.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(req.headers['Idempotency-Key']).toBe(idempotencyToken(KEY_IDEM));
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body.from).toBe('Equipe <avisos@fastpro.test>');
    expect(body.to).toBe(CLIENTE);
  });

  it('dominio verificado nao restringe o destinatario (trava so no remetente)', async () => {
    const http = new FakeHttp().queue(response(200, JSON.stringify({ id: 're_2' })));
    expect((await build(VERIFIED, http).send(message('outra.pessoa@fastpro.test'))).kind).toBe(
      'aceito',
    );
  });

  it('destinatario com quebra de linha: destinatario_invalido e zero chamadas', async () => {
    const http = new FakeHttp();
    const res = await build(VERIFIED, http).send(message('a@fastpro.test\r\nBcc: b@x.test'));
    expect(res).toEqual({ kind: 'recusa_permanente', code: 'destinatario_invalido' });
    expect(http.requests).toHaveLength(0);
  });
});

describe('Resend: remetente de teste onboarding@resend.dev (decisao do titular)', () => {
  it('aceito somente para o e-mail da conta, mesmo sem dominio verificado', async () => {
    const http = new FakeHttp().queue(response(200, JSON.stringify({ id: 're_conta' })));
    const res = await build(TEST_SENDER, http).send(message(ACCOUNT.toUpperCase()));
    expect(res).toEqual({ kind: 'aceito', providerMessageId: 're_conta' });
    expect(http.requests).toHaveLength(1);
  });

  it.each([CLIENTE, 'outro@fastpro.test'])(
    'outro destinatario (%s) e recusado antes da API',
    async (to) => {
      const http = new FakeHttp();
      expect(await build(TEST_SENDER, http).send(message(to))).toEqual({
        kind: 'recusa_permanente',
        code: 'destinatario_nao_permitido',
      });
      expect(http.requests).toHaveLength(0);
    },
  );

  it('sem RESEND_ACCOUNT_RECIPIENT configurado, nenhum destino e aceito com o remetente de teste', async () => {
    const http = new FakeHttp();
    const env = { ...TEST_SENDER, RESEND_ACCOUNT_RECIPIENT: undefined };
    expect(await build(env, http).send(message(ACCOUNT))).toEqual({
      kind: 'recusa_permanente',
      code: 'destinatario_nao_permitido',
    });
    expect(http.requests).toHaveLength(0);
  });

  it('outro endereco em resend.dev continua sob a trava de dominio', async () => {
    const http = new FakeHttp();
    const env = { ...TEST_SENDER, EMAIL_FROM: 'outro@resend.dev' };
    expect(await build(env, http).send(message(ACCOUNT))).toEqual({
      kind: 'nao_configurado',
      code: 'dominio_nao_verificado',
    });
    expect(http.requests).toHaveLength(0);
  });
});

describe('Resend: tabela de erros por status HTTP (CA-H093-07..11; §4.1)', () => {
  const NOW = new FakeClock().nowMs();
  it.each<[string, Parameters<typeof response>, unknown]>([
    [
      '200 com id',
      [200, JSON.stringify({ id: 're_9' })],
      { kind: 'aceito', providerMessageId: 're_9' },
    ],
    ['200 sem id', [200, '{"ok":true}'], { kind: 'indisponivel', code: 'resposta_invalida' }],
    ['200 sem JSON', [200, 'texto'], { kind: 'indisponivel', code: 'resposta_invalida' }],
    ['429 sem cabecalho', [429], { kind: 'limite_taxa', retryAfterSeconds: 60 }],
    [
      '429 com retry-after',
      [429, '', { 'retry-after': '120' }],
      { kind: 'limite_taxa', retryAfterSeconds: 120 },
    ],
    [
      '429 cota diaria (marcador)',
      [429, 'daily_quota_exceeded'],
      { kind: 'limite_taxa', retryAfterSeconds: 43_200 },
    ],
    [
      '429 cota mensal (marcador)',
      [429, 'monthly quota exceeded'],
      { kind: 'limite_taxa', retryAfterSeconds: 86_400 },
    ],
    ['401', [401], { kind: 'nao_configurado', code: 'segredo_ausente' }],
    [
      '403 validation_error',
      [403, '{"name":"validation_error"}'],
      { kind: 'nao_configurado', code: 'dominio_nao_verificado' },
    ],
    [
      '403 sem validation_error',
      [403, '{"name":"forbidden"}'],
      { kind: 'recusa_permanente', code: 'resend_http_403' },
    ],
    ['400', [400], { kind: 'recusa_permanente', code: 'resend_http_400' }],
    ['404', [404], { kind: 'recusa_permanente', code: 'resend_http_404' }],
    ['405', [405], { kind: 'recusa_permanente', code: 'resend_http_405' }],
    ['422', [422], { kind: 'recusa_permanente', code: 'resend_http_422' }],
    ['408', [408], { kind: 'indisponivel', code: 'resend_http_408' }],
    ['409', [409], { kind: 'indisponivel', code: 'resend_conflito' }],
    ['500', [500], { kind: 'indisponivel', code: 'resend_http_500' }],
    ['503', [503], { kind: 'indisponivel', code: 'resend_http_503' }],
    ['302 (inesperado)', [302], { kind: 'indisponivel', code: 'resend_inesperado' }],
  ])('%s', (_label, args, expected) => {
    const [status, body = '', headers = {}] = args;
    expect(classifyResendResponse(response(status, body, headers), NOW)).toEqual(expected);
  });

  it.each([
    ['timeout', new HttpTransportError('timeout'), { kind: 'indisponivel', code: 'timeout' }],
    ['falha de rede', new HttpTransportError('rede'), { kind: 'indisponivel', code: 'rede' }],
    ['erro inesperado', new Error('x'), { kind: 'indisponivel', code: 'resend_inesperado' }],
  ])('transporte: %s', async (_label, err, expected) => {
    const http = new FakeHttp().queue(err);
    expect(await build(VERIFIED, http).send(message())).toEqual(expected);
  });

  it('cota diaria calcula a espera ate 00:00 UTC com o relogio controlado', () => {
    expect(secondsUntilNextUtcDay(new FakeClock().nowMs())).toBe(43_200);
    expect(secondsUntilNextUtcDay(Date.parse('2026-11-12T00:00:00.000Z'))).toBe(86_400);
  });
});

describe('Idempotencia (CA-H093-12)', () => {
  it('o token e SHA-256 hex determinstico e nao contem trecho da chave', () => {
    const token = idempotencyToken(KEY_IDEM);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token).toBe(idempotencyToken(KEY_IDEM));
    expect(token).not.toBe(idempotencyToken('nc:evento-2:usuario-77:aviso:escopo-9'));
    expect(token).not.toContain('usuario-77');
  });

  it('retentativas com a mesma chave enviam o mesmo cabecalho', async () => {
    const http = new FakeHttp()
      .queue(new HttpTransportError('timeout'))
      .queue(response(200, JSON.stringify({ id: 're_3' })));
    const provider = build(VERIFIED, http);
    await provider.send(message());
    await provider.send(message());
    const [a, b] = http.requests;
    expect(a?.headers['Idempotency-Key']).toBe(b?.headers['Idempotency-Key']);
  });
});
