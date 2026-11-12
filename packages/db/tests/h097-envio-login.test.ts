// H-097 (Issue 107) | Envio do login com prioridade, em memoria (sem banco, sem rede). Cobre T-H097-05
// (falha do provedor: uma unica entrega ao voltar) e T-H097-06 (conteudo: so link, codigo e prazo; nada
// com endereco, token ou codigo em claro na linha gravada). Desenho: docs/factory/86-DESENHO-H097.md §5.
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { FakeClock, FakeEmailProvider } from '@fastpro/testkit';
import { CHALLENGE_TTL_SECONDS, type EmailMessage } from '@fastpro/domain';
import {
  ACCESS_TEMPLATE_KEY,
  ChallengeEmailProvider,
  requestChallenge,
  type ChallengeRow,
  type ChallengeStore,
  type CreateChallengeInput,
  type CreateChallengeResult,
} from '../src/challenges.js';

const EMAIL = 'cliente@example.test';
const SITE = 'https://fastpro.example.test';
const PIMENTA_EMAIL = randomBytes(24).toString('base64url');
const PIMENTA_CODIGO = randomBytes(24).toString('base64url');
const CHAVE = Buffer.alloc(32, 9);

interface LinhaMemoria {
  readonly input: CreateChallengeInput;
  delivered: boolean;
  active: boolean;
}

class RepoMemoria implements ChallengeStore {
  readonly linhas = new Map<string, LinhaMemoria>();
  readonly criados: CreateChallengeInput[] = [];

  async create(input: CreateChallengeInput): Promise<CreateChallengeResult> {
    this.criados.push(input);
    this.linhas.set(input.id, { input, delivered: false, active: true });
    return { resultado: 'criado', challengeId: input.id, outboxId: `out-${input.id}` };
  }

  async findRow(id: string, nowMs: number): Promise<ChallengeRow | null> {
    const l = this.linhas.get(id);
    if (!l) return null;
    return {
      id,
      active: l.active && nowMs < l.input.nowMs + CHALLENGE_TTL_SECONDS * 1000,
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

function mensagem(ref: string): EmailMessage {
  return {
    to: EMAIL,
    templateKey: ACCESS_TEMPLATE_KEY,
    params: { challenge_ref: ref },
    idempotencyKey: `ac:${ref}`,
  } as EmailMessage;
}

async function criarDesafio(store: RepoMemoria, clock: FakeClock): Promise<string> {
  await requestChallenge(
    {
      store,
      secrets: {
        key: CHAVE,
        pepperEmail: PIMENTA_EMAIL,
        pepperCode: PIMENTA_CODIGO,
      },
      clock,
      dispatch: { schedule: () => undefined },
    },
    { email: EMAIL },
  );
  const id = store.criados[0]?.id;
  if (!id) throw new Error('desafio nao criado');
  return id;
}

describe('envio do login: falha do provedor e entrega unica (T-H097-05, H-097)', () => {
  it('provedor indisponivel: nada marcado como entregue; ao voltar sai uma vez; reentrega nao chama o provedor', async () => {
    const store = new RepoMemoria();
    const clock = new FakeClock('2099-02-01T12:00:00.000Z');
    const id = await criarDesafio(store, clock);
    const provedor = new FakeEmailProvider().queue({ kind: 'indisponivel', code: 'timeout' });
    const envio = new ChallengeEmailProvider(provedor, store, { key: CHAVE, siteUrl: SITE, clock });

    const primeira = await envio.send(mensagem(id));
    expect(primeira).toEqual({ kind: 'indisponivel', code: 'timeout' });
    expect(store.linhas.get(id)?.delivered).toBe(false);

    const segunda = await envio.send(mensagem(id));
    expect(segunda.kind).toBe('aceito');
    expect(store.linhas.get(id)?.delivered).toBe(true);

    const terceira = await envio.send(mensagem(id));
    expect(terceira).toEqual({ kind: 'aceito', providerMessageId: 'ja_entregue' });
    expect(provedor.calls).toHaveLength(2);
    expect(provedor.accepted).toBe(1);
  });

  it('desafio vencido: o provedor nao e chamado e a resposta e recusa (sem cota gasta)', async () => {
    const store = new RepoMemoria();
    const clock = new FakeClock('2099-02-01T12:00:00.000Z');
    const id = await criarDesafio(store, clock);
    clock.advance(16 * 60 * 1000);
    const provedor = new FakeEmailProvider();
    const envio = new ChallengeEmailProvider(provedor, store, { key: CHAVE, siteUrl: SITE, clock });

    const r = await envio.send(mensagem(id));
    expect(r).toEqual({ kind: 'recusa_permanente', code: 'desafio_inativo' });
    expect(provedor.calls).toHaveLength(0);
  });
});

describe('conteudo do e-mail de login e da linha gravada (T-H097-06, RN-6, H-097)', () => {
  it('o envio leva so link com fragmento, codigo de 6 digitos e prazo de 15 minutos', async () => {
    const store = new RepoMemoria();
    const clock = new FakeClock('2099-02-01T12:00:00.000Z');
    const id = await criarDesafio(store, clock);
    const provedor = new FakeEmailProvider();
    const envio = new ChallengeEmailProvider(provedor, store, { key: CHAVE, siteUrl: SITE, clock });

    await envio.send(mensagem(id));

    const enviado = provedor.calls[0];
    expect(enviado).toBeDefined();
    const params = enviado!.params as Record<string, unknown>;
    expect(Object.keys(params).sort()).toEqual(['code', 'link', 'minutos']);
    expect(String(params.link)).toMatch(new RegExp(`^${SITE}/acesso#t=[A-Za-z0-9_-]+$`));
    expect(String(params.code)).toMatch(/^\d{6}$/);
    expect(params.minutos).toBe(15);
    expect(JSON.stringify(params)).not.toContain(EMAIL);
  });

  it('a linha gravada nao guarda o endereco, o token nem o codigo em claro', async () => {
    const store = new RepoMemoria();
    const clock = new FakeClock('2099-02-01T12:00:00.000Z');
    const provedor = new FakeEmailProvider();
    const id = await criarDesafio(store, clock);
    const envio = new ChallengeEmailProvider(provedor, store, { key: CHAVE, siteUrl: SITE, clock });
    await envio.send(mensagem(id));

    const linha = store.criados[0]!;
    const gravado = JSON.stringify({
      ...linha,
      emailEnc: linha.emailEnc.toString('base64'),
      secretsEnc: linha.secretsEnc.toString('base64'),
    });
    expect(gravado).not.toContain(EMAIL);
    const link = String((provedor.calls[0]!.params as Record<string, unknown>).link);
    const token = link.split('#t=')[1]!;
    expect(gravado).not.toContain(token);
    const code = String((provedor.calls[0]!.params as Record<string, unknown>).code);
    expect(linha.emailEnc.toString('latin1')).not.toContain(EMAIL);
    expect(linha.secretsEnc.toString('latin1')).not.toContain(code);
  });
});
