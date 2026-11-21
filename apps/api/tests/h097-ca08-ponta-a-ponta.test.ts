// H-097 (Issue 107) | CA-08 ponta a ponta do login, sem banco e sem rede. Cadeia real: pedido de acesso
// (requestChallenge, com o desafio cifrado de verdade) -> envio do login (ChallengeEmailProvider) -> adaptador
// Resend (createEmailProvider) -> transporte HTTP falso que conta as chamadas. A fila (processOutbox) fica no
// banco e e provada em packages/db/tests/h097-login-prioridade.dbtest.mjs; aqui o envio e feito pela mesma
// chamada de provedor que a fila usa.
// Prova: destino fora da conta de teste em local/test = redirecionado para a conta (Issue 160, decisao 1000);
// fora desses ambientes = zero chamadas a API do provedor; o remetente de teste nunca vale para terceiros.
import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  ChallengeEmailProvider,
  requestChallenge,
  ACCESS_TEMPLATE_KEY,
  type ChallengeStore,
  type CreateChallengeInput,
  type CreateChallengeResult,
} from '@fastpro/db';
import {
  createAuthAwareRenderer,
  createEmailProvider,
  createMinimalRenderer,
  type EmailEnv,
  type HttpRequest,
  type HttpResponse,
  type HttpTransport,
} from '@fastpro/email';
import type { ClockPort, EmailMessage } from '@fastpro/domain';

/** Linha do desafio como o login le (mesma forma de ChallengeRow do pacote db). */
interface LinhaDesafio {
  readonly id: string;
  readonly active: boolean;
  readonly emailEnc: Buffer | null;
  readonly secretsEnc: Buffer | null;
  readonly delivered: boolean;
}

const CONTA = 'conta.titular@fastpro.test';
const CLIENTE = 'cliente.exemplo@fastpro.test';
const SITE = 'https://fastpro.example.test';
const T0 = Date.UTC(2099, 0, 1, 12);
const CHAVE = Buffer.alloc(32, 5);
const PIMENTA_EMAIL = randomBytes(24).toString('base64url');
const PIMENTA_CODIGO = randomBytes(24).toString('base64url');

/** Transporte HTTP falso: conta cada chamada a API do provedor e responde 200 com id. */
class TransporteContado implements HttpTransport {
  readonly chamadas: HttpRequest[] = [];
  async post(request: HttpRequest): Promise<HttpResponse> {
    this.chamadas.push(request);
    return { status: 200, headers: {}, body: JSON.stringify({ id: 're_ca08' }) };
  }
}

/** Repositorio do desafio em memoria, com as mesmas regras do que o login consulta. */
class RepoMemoria implements ChallengeStore {
  readonly linhas = new Map<string, { input: CreateChallengeInput; delivered: boolean }>();
  async create(input: CreateChallengeInput): Promise<CreateChallengeResult> {
    this.linhas.set(input.id, { input, delivered: false });
    return { resultado: 'criado', challengeId: input.id, outboxId: `out-${input.id}` };
  }
  async findRow(id: string, nowMs: number): Promise<LinhaDesafio | null> {
    const l = this.linhas.get(id);
    if (!l) return null;
    return {
      id,
      active: nowMs < l.input.nowMs + 15 * 60 * 1000,
      emailEnc: l.input.emailEnc,
      secretsEnc: l.input.secretsEnc,
      delivered: l.delivered,
    };
  }
  async markDelivered(id: string): Promise<void> {
    const l = this.linhas.get(id);
    if (l) l.delivered = true;
  }
}

const relogio: ClockPort = { nowMs: () => T0, sleep: async () => undefined };

/** Ambiente de teste do Resend: remetente de teste e a conta do titular como unico destino. */
function envTeste(comConta: boolean): EmailEnv {
  return {
    APP_ENV: 'local',
    EMAIL_PROVIDER: 'resend',
    EMAIL_FROM: 'onboarding@resend.dev',
    RESEND_API_KEY: 'dummy-chave-api',
    ...(comConta ? { RESEND_ACCOUNT_RECIPIENT: CONTA } : {}),
  };
}

/** Pedido de login real para `email` (desafio cifrado). Devolve o id do desafio e a resposta. */
async function pedirLogin(store: RepoMemoria, email: string) {
  const r = await requestChallenge(
    {
      store,
      secrets: { key: CHAVE, pepperEmail: PIMENTA_EMAIL, pepperCode: PIMENTA_CODIGO },
      clock: relogio,
      dispatch: { schedule: () => undefined },
    },
    { email, purpose: 'login' },
    null,
  );
  const id = [...store.linhas.keys()].at(-1);
  if (!id) throw new Error('desafio nao criado');
  return { r, id };
}

/** Envio do login como a fila faz: mesma chamada de provedor, com o desafio e o destinatario. */
async function enviarLogin(
  store: RepoMemoria,
  transporte: TransporteContado,
  env: EmailEnv,
  destino: string,
  id: string,
) {
  const provedorResend = createEmailProvider(env, {
    http: transporte,
    renderer: createAuthAwareRenderer(createMinimalRenderer()),
    clock: relogio,
  });
  const provedor = new ChallengeEmailProvider(provedorResend, store, {
    key: CHAVE,
    siteUrl: SITE,
    clock: relogio,
  });
  const mensagem: EmailMessage = {
    to: destino,
    templateKey: ACCESS_TEMPLATE_KEY,
    params: { challenge_ref: id },
    idempotencyKey: `ac:${id}`,
  };
  return provedor.send(mensagem);
}

describe('CA-08 ponta a ponta do login (H-097)', () => {
  // ATUALIZADO na Issue 160 (decisao 1000 do dono): em local, o destino fora da conta agora e
  // redirecionado para a conta, com marcador (desenho 188, D-188-03). Antes era recusado sem chamada.
  it('destino fora da conta de teste em local: uma chamada para a conta, com marcador; a resposta nao traz o endereco', async () => {
    const store = new RepoMemoria();
    const transporte = new TransporteContado();
    const { r, id } = await pedirLogin(store, CLIENTE);
    expect(r.status).toBe(202);

    const res = await enviarLogin(store, transporte, envTeste(true), CLIENTE, id);

    expect(res).toEqual({ kind: 'aceito', providerMessageId: 're_ca08' });
    expect(transporte.chamadas).toHaveLength(1);
    const corpo = JSON.parse(transporte.chamadas[0]?.body ?? '{}') as { to: string; subject: string; text: string };
    expect(corpo.to).toBe(CONTA);
    expect(corpo.subject.startsWith('[Teste] ')).toBe(true);
    expect(corpo.text).toContain(`destinado a: ${CLIENTE}.`);
    expect(JSON.stringify(res)).not.toContain(CLIENTE);
  });

  it('CA-160-08: cadastro com destino fora da conta e com a propria conta responde igual (mesmo status e corpo)', async () => {
    const store = new RepoMemoria();
    const fora = await pedirLogin(store, CLIENTE);
    const conta = await pedirLogin(store, CONTA);
    expect(fora.r).toEqual(conta.r);
    expect(JSON.stringify(fora.r)).not.toContain(CLIENTE);
  });

  it('destino igual a conta de teste: uma chamada, e o login e aceito', async () => {
    const store = new RepoMemoria();
    const transporte = new TransporteContado();
    const { r, id } = await pedirLogin(store, CONTA);
    expect(r.status).toBe(202);

    const res = await enviarLogin(store, transporte, envTeste(true), CONTA, id);

    expect(res).toEqual({ kind: 'aceito', providerMessageId: 're_ca08' });
    expect(transporte.chamadas).toHaveLength(1);
    expect(transporte.chamadas[0]?.url).toContain('resend');
  });

  it('sem conta de teste configurada: nenhum destino recebe chamada (o remetente de teste nao vale para ninguem)', async () => {
    const store = new RepoMemoria();
    const transporte = new TransporteContado();
    const { id } = await pedirLogin(store, CONTA);

    const res = await enviarLogin(store, transporte, envTeste(false), CONTA, id);

    expect(res).toEqual({ kind: 'recusa_permanente', code: 'destinatario_nao_permitido' });
    expect(transporte.chamadas).toHaveLength(0);
  });
});
