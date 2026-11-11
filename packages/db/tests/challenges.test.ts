// H-011 | T-H011-10..14 (pedido), T-H011-30 (parte offline), 32, 33, 35, 36, 37, 38 e diretorio.
// Store em memoria, provedor simulado, relogio controlado. Nenhuma conexao de rede.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-011');
};

import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { FakeClock, FakeEmailProvider, FakeRecipientDirectory } from '@fastpro/testkit';
import type { EmailMessage } from '@fastpro/domain';
import {
  ChallengeEmailProvider,
  ChallengeRecipientDirectory,
  requestChallenge,
  type ChallengeRow,
  type ChallengeSecrets,
  type ChallengeStore,
  type CreateChallengeInput,
  type CreateChallengeResult,
  type OutboxDispatchPort,
  type RequestChallengeDeps,
} from '../src/challenges.js';
import {
  challengeHmacHex,
  challengeSha256Hex,
  loadChallengeKey,
} from '../src/challenges-crypto.js';

const key = randomBytes(32);
const secrets: ChallengeSecrets = {
  key,
  pepperEmail: 'pepEmailTeste',
  pepperCode: 'pepCodeTeste',
};

class MemoryStore implements ChallengeStore {
  readonly calls: string[] = [];
  readonly creates: CreateChallengeInput[] = [];
  readonly rows = new Map<string, ChallengeRow>();
  private readonly scripted: CreateChallengeResult[] = [];

  queue(...results: CreateChallengeResult[]): this {
    this.scripted.push(...results);
    return this;
  }

  async create(input: CreateChallengeInput): Promise<CreateChallengeResult> {
    this.calls.push('create');
    this.creates.push(input);
    const next = this.scripted.shift();
    if (next) return next;
    this.rows.set(input.id, {
      id: input.id,
      active: true,
      emailEnc: input.emailEnc,
      secretsEnc: input.secretsEnc,
      delivered: false,
    });
    return { resultado: 'criado', challengeId: input.id, outboxId: `out-${input.id}` };
  }

  async findRow(id: string): Promise<ChallengeRow | null> {
    this.calls.push('findRow');
    return this.rows.get(id) ?? null;
  }

  async markDelivered(id: string): Promise<void> {
    this.calls.push('markDelivered');
    const r = this.rows.get(id);
    if (r) this.rows.set(id, { ...r, delivered: true, secretsEnc: null });
  }

  deactivate(id: string): void {
    const r = this.rows.get(id);
    if (r) this.rows.set(id, { ...r, active: false, emailEnc: null, secretsEnc: null });
  }
}

class RecordingDispatch implements OutboxDispatchPort {
  readonly scheduled: string[] = [];
  failWith: Error | null = null;
  schedule(outboxId: string): void {
    if (this.failWith) throw this.failWith;
    this.scheduled.push(outboxId);
  }
}

function deps(store: MemoryStore, dispatch: OutboxDispatchPort): RequestChallengeDeps {
  return { store, secrets, clock: new FakeClock(), dispatch };
}

function mensagem(params: Record<string, unknown>, template = 'acesso_login'): EmailMessage {
  return {
    to: 'cliente@example.test',
    templateKey: template,
    params,
    idempotencyKey: 'ac:teste',
  };
}

describe('T-H011-10 e 11 pedido com resposta uniforme (sem consulta a conta)', () => {
  it('cadastrado e nao cadastrado: mesma resposta e mesma sequencia de chamadas', async () => {
    const store = new MemoryStore();
    const dispatch = new RecordingDispatch();
    const a = await requestChallenge(deps(store, dispatch), { email: 'Cadastrado@Example.test' });
    const b = await requestChallenge(deps(store, dispatch), {
      email: 'nao.cadastrado@example.test',
    });
    expect(a).toEqual(b);
    expect(a.status).toBe(202);
    expect(a.body).toEqual({ status: 'recebido' });
    expect(a.headers).toEqual({ 'Cache-Control': 'no-store' });
    expect(store.calls).toEqual(['create', 'create']);
  });

  it('o pedido nao tem porta de usuario: so o store, o relogio e o despacho', () => {
    const d = deps(new MemoryStore(), new RecordingDispatch());
    expect(Object.keys(d).sort()).toEqual(['clock', 'dispatch', 'secrets', 'store']);
  });

  it('nenhuma conta e consultada ou criada no pedido', async () => {
    const store = new MemoryStore();
    await requestChallenge(deps(store, new RecordingDispatch()), {
      email: 'sem.conta@example.test',
    });
    expect(store.calls.filter((c) => c !== 'create')).toEqual([]);
  });

  it('segredos vao cifrados ao store: nenhum endereco, token ou codigo em claro', async () => {
    const store = new MemoryStore();
    await requestChallenge(deps(store, new RecordingDispatch()), { email: 'claro@example.test' });
    const c = store.creates[0];
    expect(c).toBeDefined();
    const bruto = JSON.stringify({
      e: c?.emailEnc.toString('hex'),
      s: c?.secretsEnc.toString('hex'),
    });
    expect(bruto.includes(Buffer.from('claro@example.test').toString('hex'))).toBe(false);
    expect(c?.emailHash).toMatch(/^[0-9a-f]{64}$/);
    expect(c?.linkHash).toMatch(/^[0-9a-f]{64}$/);
    expect(c?.codeHmac).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('T-H011-12 limites: 429 igual para cadastrado ou nao', () => {
  it('intervalo e teto devolvem 429 com Retry-After e nao enviam nada', async () => {
    const store = new MemoryStore().queue(
      { resultado: 'espera', retryAfterSeconds: 59 },
      { resultado: 'teto', retryAfterSeconds: 3295 },
    );
    const dispatch = new RecordingDispatch();
    const intervalo = await requestChallenge(deps(store, dispatch), { email: 'a@example.test' });
    const teto = await requestChallenge(deps(store, dispatch), { email: 'b@example.test' });
    expect(intervalo.status).toBe(429);
    expect(intervalo.headers['Retry-After']).toBe('59');
    expect(intervalo.body).toEqual({ code: 'muitos_pedidos', retry_after_seconds: 59 });
    expect(teto.headers['Retry-After']).toBe('3295');
    expect(teto.body).toEqual({ code: 'muitos_pedidos', retry_after_seconds: 3295 });
    expect(dispatch.scheduled).toEqual([]);
    expect(store.rows.size).toBe(0);
  });
});

describe('T-H011-13 formato invalido e falha do provedor', () => {
  it('formato invalido responde 422 sem consultar nada', async () => {
    const store = new MemoryStore();
    const casos: unknown[] = [
      { email: '' },
      { email: 'sem-arroba' },
      { email: 'a@example.test', purpose: 'admin' },
      { email: 'a@example.test', draft_id: 'nao-e-uuid' },
      null,
      'texto',
    ];
    for (const caso of casos) {
      const r = await requestChallenge(deps(store, new RecordingDispatch()), caso);
      expect(r.status).toBe(422);
      expect(r.body).toEqual({ code: 'pedido_invalido' });
    }
    expect(store.calls).toEqual([]);
  });

  it('falha ao agendar o envio nao muda a resposta (continua 202)', async () => {
    const dispatch = new RecordingDispatch();
    dispatch.failWith = new Error('indisponivel');
    const r = await requestChallenge(deps(new MemoryStore(), dispatch), {
      email: 'a@example.test',
    });
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ status: 'recebido' });
  });
});

describe('T-H011-14 envio depois da resposta', () => {
  it('agenda o envio uma vez por pedido aceito e nao agenda no 429', async () => {
    const store = new MemoryStore().queue({ resultado: 'espera', retryAfterSeconds: 60 });
    const dispatch = new RecordingDispatch();
    await requestChallenge(deps(store, dispatch), { email: 'a@example.test' });
    await requestChallenge(deps(store, dispatch), { email: 'b@example.test' });
    expect(dispatch.scheduled).toEqual(['out-' + store.creates[1]?.id]);
  });
});

describe('decorador de provedor (acesso_login)', () => {
  async function pedidoCriado(store: MemoryStore) {
    await requestChallenge(deps(store, new RecordingDispatch()), { email: 'Cliente@Example.test' });
    const c = store.creates[0];
    if (!c) throw new Error('pedido nao criou desafio');
    return c;
  }

  it('T-H011-30 (parte offline): o envio leva link e codigo que validam os hashes gravados', async () => {
    const store = new MemoryStore();
    const provedor = new FakeEmailProvider();
    const decorado = new ChallengeEmailProvider(provedor, store, {
      key,
      siteUrl: 'https://app.example.test',
      clock: new FakeClock(),
    });
    const c = await pedidoCriado(store);
    const res = await decorado.send(mensagem({ challenge_ref: c.id }));
    expect(res.kind).toBe('aceito');
    expect(provedor.calls.length).toBe(1);
    const enviado = provedor.calls[0];
    expect(Object.keys(enviado?.params ?? {}).sort()).toEqual(['code', 'link', 'minutos']);
    const link = String(enviado?.params.link);
    const token = decodeURIComponent(link.split('#t=')[1] ?? '');
    const codigo = String(enviado?.params.code);
    expect(link.startsWith('https://app.example.test/acesso#t=')).toBe(true);
    expect(challengeSha256Hex(token)).toBe(c.linkHash);
    expect(challengeHmacHex(secrets.pepperCode, `${c.id}|${codigo}`)).toBe(c.codeHmac);
    expect(enviado?.params.minutos).toBe(15);
  });

  it('T-H011-32 entregue uma vez: a segunda tentativa nao chama o provedor', async () => {
    const store = new MemoryStore();
    const provedor = new FakeEmailProvider();
    const decorado = new ChallengeEmailProvider(provedor, store, {
      key,
      siteUrl: 'https://app.example.test',
      clock: new FakeClock(),
    });
    const c = await pedidoCriado(store);
    await decorado.send(mensagem({ challenge_ref: c.id }));
    const segunda = await decorado.send(mensagem({ challenge_ref: c.id }));
    expect(segunda).toEqual({ kind: 'aceito', providerMessageId: 'ja_entregue' });
    expect(provedor.calls.length).toBe(1);
  });

  it('T-H011-33 desafio inativo: recusa e o provedor nunca e chamado', async () => {
    const store = new MemoryStore();
    const provedor = new FakeEmailProvider();
    const decorado = new ChallengeEmailProvider(provedor, store, {
      key,
      siteUrl: 'https://app.example.test',
      clock: new FakeClock(),
    });
    const c = await pedidoCriado(store);
    store.deactivate(c.id);
    const res = await decorado.send(mensagem({ challenge_ref: c.id }));
    expect(res).toEqual({ kind: 'recusa_permanente', code: 'desafio_inativo' });
    expect(provedor.calls.length).toBe(0);
  });

  it('T-H011-35 resultados e erros nao carregam endereco, token nem codigo', async () => {
    const store = new MemoryStore();
    const provedor = new FakeEmailProvider().queue({ kind: 'indisponivel', code: 'timeout' });
    const decorado = new ChallengeEmailProvider(provedor, store, {
      key,
      siteUrl: 'https://app.example.test',
      clock: new FakeClock(),
    });
    const c = await pedidoCriado(store);
    const res = await decorado.send(mensagem({ challenge_ref: c.id }));
    const texto = JSON.stringify(res);
    expect(texto.includes('cliente@example.test')).toBe(false);
    expect(texto.includes('example.test')).toBe(false);
    expect(res.kind).toBe('indisponivel');
  });

  it('T-H011-37 conteudo: so link, codigo e prazo; o desafio fica marcado como nao entregue', async () => {
    const store = new MemoryStore();
    const provedor = new FakeEmailProvider().queue({ kind: 'indisponivel', code: 'timeout' });
    const decorado = new ChallengeEmailProvider(provedor, store, {
      key,
      siteUrl: 'https://app.example.test',
      clock: new FakeClock(),
    });
    const c = await pedidoCriado(store);
    await decorado.send(mensagem({ challenge_ref: c.id }));
    expect(store.rows.get(c.id)?.delivered).toBe(false);
    expect(store.rows.get(c.id)?.secretsEnc).not.toBeNull();
  });

  it('outros modelos passam direto ao provedor interno', async () => {
    const store = new MemoryStore();
    const provedor = new FakeEmailProvider();
    const decorado = new ChallengeEmailProvider(provedor, store, {
      key,
      siteUrl: 'https://app.example.test',
      clock: new FakeClock(),
    });
    const msg = mensagem({}, 'outro_modelo');
    await decorado.send(msg);
    expect(provedor.calls[0]).toEqual(msg);
    expect(store.calls).toEqual([]);
  });
});

describe('diretorio do desafio', () => {
  it('endereco do desafio ativo resolve; inativo vira inexistente; id desconhecido vai ao base', async () => {
    const store = new MemoryStore();
    const base = new FakeRecipientDirectory().set('11111111-1111-4111-8111-111111111111', {
      status: 'ok',
      email: 'usuario@example.test',
    });
    const dir = new ChallengeRecipientDirectory(base, store, key, new FakeClock());
    await requestChallenge(deps(store, new RecordingDispatch()), { email: 'Cliente@Example.test' });
    const c = store.creates[0];
    if (!c) throw new Error('sem desafio');
    expect(await dir.resolve(c.id)).toEqual({ status: 'ok', email: 'cliente@example.test' });
    store.deactivate(c.id);
    expect(await dir.resolve(c.id)).toEqual({ status: 'inexistente' });
    expect(await dir.resolve('11111111-1111-4111-8111-111111111111')).toEqual({
      status: 'ok',
      email: 'usuario@example.test',
    });
    expect(await dir.resolve('22222222-2222-4222-8222-222222222222')).toEqual({
      status: 'inexistente',
    });
  });

  it('chave de cifra vem so do ambiente e a ausencia nao vaza o valor', () => {
    expect(() => loadChallengeKey({})).toThrow('configuracao_cifra');
  });
});
