// Issue 160 | T-188-09 (desenho 188 §5, CA-160-07): todos os tipos de e-mail, pelo renderizador composto
// de producao (lembretes + profissional + auth + base), com o remetente de teste em local, passam pelo
// provedor com destino fora da conta: aceito, 1 chamada, to = conta e marcador presente. Offline (sem rede).
// Se um tipo novo nao tiver parametros de teste, paramsPara falha (de proposito).
import { describe, expect, it } from 'vitest';
import { EMAIL_TYPE_POLICY } from '@fastpro/domain';
import type { ClockPort, EmailMessage } from '@fastpro/domain';
import {
  createAuthAwareRenderer,
  createEmailProvider,
  createMinimalRenderer,
  createProfessionalAwareRenderer,
  createReminderAwareRenderer,
  PASSWORD_CHANGED_TEMPLATE,
  PROFESSIONAL_TEMPLATE_KEYS,
} from '@fastpro/email';
import type { EmailEnv, HttpRequest, HttpResponse, HttpTransport } from '@fastpro/email';

const CONTA = 'conta.titular@fastpro.test';
const CLIENTE = 'cliente.exemplo@fastpro.test';
const LINK = 'https://fastpro.example.test/profissional/verificar#t=ficticio-160';
const T0 = Date.UTC(2099, 0, 1, 12);

const ENV_LOCAL: EmailEnv = {
  APP_ENV: 'local',
  EMAIL_PROVIDER: 'resend',
  EMAIL_FROM: 'onboarding@resend.dev',
  RESEND_ACCOUNT_RECIPIENT: CONTA,
  RESEND_API_KEY: 'dummy-chave-api-160',
};

const relogio: ClockPort = { nowMs: () => T0, sleep: async () => undefined };

class TransporteContado implements HttpTransport {
  readonly chamadas: HttpRequest[] = [];
  async post(request: HttpRequest): Promise<HttpResponse> {
    this.chamadas.push(request);
    return { status: 200, headers: {}, body: JSON.stringify({ id: 're_ca08' }) };
  }
}

/** Valores ficticios para cada nome de parametro de EMAIL_TYPE_POLICY (formato exigido pelo renderizador). */
const VALORES: Readonly<Record<string, unknown>> = {
  request_ref: '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f',
  conversation_ref: 'conversa-160',
  count: 2,
};

/** Parametros do modelo de acesso ja resolvidos: o provedor do desafio troca challenge_ref por estes (ChallengeEmailProvider). */
const ACESSO_RESOLVIDO = {
  link: 'https://fastpro.example.test/acesso#t=ficticio-160',
  code: '123456',
  minutos: 15,
};

function paramsDe(nomes: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const nome of nomes) {
    if (!(nome in VALORES)) throw new Error(`tipo sem valor de teste para o parametro: ${nome}`);
    out[nome] = VALORES[nome];
  }
  return out;
}

/** Tipos a testar: a politica de e-mail e os modelos do profissional (que nao estao na politica). */
const TIPOS: readonly string[] = [...Object.keys(EMAIL_TYPE_POLICY), ...PROFESSIONAL_TEMPLATE_KEYS];

function paramsPara(tipo: string): Record<string, unknown> {
  const politica = EMAIL_TYPE_POLICY[tipo];
  if (politica !== undefined) {
    if (politica.params.includes('challenge_ref')) return { ...ACESSO_RESOLVIDO };
    return paramsDe(politica.params);
  }
  if (PROFESSIONAL_TEMPLATE_KEYS.includes(tipo)) {
    return tipo === PASSWORD_CHANGED_TEMPLATE ? {} : { link: LINK, minutos: 15 };
  }
  throw new Error(`tipo sem parametros de teste: ${tipo}`);
}

/** Mesma composicao de producao usada pelo envio (lembretes, profissional, auth e base). */
const renderer = createReminderAwareRenderer(
  createProfessionalAwareRenderer(createAuthAwareRenderer(createMinimalRenderer())),
);

describe('T-188-09 | todos os tipos de e-mail redirecionam com marcador em local (CA-160-07)', () => {
  it('a lista de tipos nao esta vazia', () => {
    expect(TIPOS.length).toBeGreaterThan(10);
  });

  it.each(TIPOS)('%s: aceito, 1 chamada, to = conta e marcador presente', async (tipo) => {
    const http = new TransporteContado();
    const provider = createEmailProvider(ENV_LOCAL, { http, renderer, clock: relogio });
    const mensagem: EmailMessage = {
      to: CLIENTE,
      templateKey: tipo,
      params: paramsPara(tipo),
      idempotencyKey: `nc:${tipo}:usuario-160`,
    };

    const res = await provider.send(mensagem);

    expect(res).toEqual({ kind: 'aceito', providerMessageId: 're_ca08' });
    expect(http.chamadas).toHaveLength(1);
    const corpo = JSON.parse(http.chamadas[0]?.body ?? '{}') as { to: string; subject: string; text: string };
    expect(corpo.to).toBe(CONTA);
    expect(corpo.subject.startsWith('[Teste] ')).toBe(true);
    expect(corpo.subject).not.toContain(CLIENTE);
    expect(corpo.text.startsWith(`[Teste] Este e-mail era destinado a: ${CLIENTE}. `)).toBe(true);
    expect(JSON.stringify(res)).not.toContain(CLIENTE);
  });
});
