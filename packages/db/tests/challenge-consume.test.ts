// H-012 | T-H012-03, 04, 05, 06, 07, 08, 10 (handler) e adaptadores Pg com SqlClient simulado.
// Repositorio em memoria com a mesma regra de uso unico, conta e etapa simuladas, relogio fixo.
// Nenhuma conexao de rede: fetch bloqueado. Dados sinteticos (@example.test). Desenho: 46 §4, §6.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-012');
};

import { describe, it, expect, vi } from 'vitest';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type {
  CustomerAccountPort,
  CustomerAccountResult,
  ConsumeFailureCode,
  OpenStageInput,
  SessionStageStore,
} from '@fastpro/domain';
import {
  consumeChallenge,
  PgConsumeRepository,
  PgCustomerAccounts,
  PgSessionStageStore,
  type AuthCreateResult,
  type AuthUserAdminPort,
  type ConsumeDeps,
  type ConsumeLinkResult,
  type ConsumeRepository,
} from '../src/challenge-consume.js';
import {
  challengeAad,
  challengeSha256Hex,
  openChallengeBlob,
  sealChallengeBlob,
} from '../src/challenges-crypto.js';

const KEY = randomBytes(32);
const NOW = Date.UTC(2099, 0, 1, 12, 0, 0);
const USER_ID = randomUUID();
const EMAIL = 'cliente.h012@example.test';
const CONSUMED_TOKEN = 'SENTINELA-TOKEN-' + 'a'.repeat(28);

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

class FakeRepo implements ConsumeRepository {
  calls = 0;
  private readonly rows = new Map<
    string,
    { challengeId: string; emailEnc: Buffer; draftId: string | null; consumed: boolean }
  >();

  /** Cadastra um desafio vivo: o token nunca fica em claro no repositorio. */
  add(token: string, challengeId = randomUUID(), email = EMAIL): string {
    this.rows.set(challengeSha256Hex(token), {
      challengeId,
      emailEnc: sealChallengeBlob(KEY, email, challengeAad(challengeId, 'email_enc')),
      draftId: null,
      consumed: false,
    });
    return challengeId;
  }

  async consumeLink(tokenHash: string): Promise<ConsumeLinkResult> {
    this.calls += 1;
    // Corpo sincrono: a regra de uso unico e atomica, como o FOR UPDATE do banco.
    const row = this.rows.get(tokenHash);
    if (!row || row.consumed) return { resultado: 'invalido' };
    row.consumed = true;
    return {
      resultado: 'ok',
      challengeId: row.challengeId,
      purpose: 'login',
      emailEnc: row.emailEnc,
      draftId: row.draftId,
    };
  }
}

class FakeAccounts implements CustomerAccountPort {
  readonly emails: string[] = [];
  readonly script: Array<CustomerAccountResult | 'throw' | 'hang'> = [];
  fallback: CustomerAccountResult = { status: 'ok', userId: USER_ID };

  async ensureCustomer(email: string): Promise<CustomerAccountResult> {
    this.emails.push(email);
    const next = this.script.shift() ?? this.fallback;
    if (next === 'throw') throw new Error('rede_simulada');
    if (next === 'hang') return new Promise<CustomerAccountResult>(() => {});
    return next;
  }
}

class FakeStages implements SessionStageStore {
  readonly inputs: OpenStageInput[] = [];
  mode: 'ok' | 'recusa' | 'erro' = 'ok';

  async openStage(input: OpenStageInput): Promise<boolean> {
    this.inputs.push(input);
    if (this.mode === 'erro') throw new Error('banco_simulado');
    return this.mode === 'ok';
  }
}

interface Env {
  repo: FakeRepo;
  accounts: FakeAccounts;
  stages: FakeStages;
  failures: ConsumeFailureCode[];
  deps: ConsumeDeps;
}

function montar(over: Partial<ConsumeDeps> = {}): Env {
  const repo = new FakeRepo();
  const accounts = new FakeAccounts();
  const stages = new FakeStages();
  const failures: ConsumeFailureCode[] = [];
  const deps: ConsumeDeps = {
    repo,
    accounts,
    stages,
    decryptEmail: (blob, id) => openChallengeBlob(KEY, blob, challengeAad(id, 'email_enc')),
    clock: { nowMs: () => NOW },
    newSecret: () => randomBytes(32).toString('base64url'),
    newSessionId: () => randomUUID(),
    accountDeadlineMs: 50,
    onFailure: (codigo) => failures.push(codigo),
    ...over,
  };
  return { repo, accounts, stages, failures, deps };
}

describe('T-H012-03 link invalido: uma so resposta', () => {
  it('inexistente, adulterado, malformado e ja usado: mesmo status, corpo e cabecalhos', async () => {
    const { repo, accounts, stages, deps } = montar();
    repo.add(CONSUMED_TOKEN);
    await consumeChallenge(deps, CONSUMED_TOKEN); // gasta o link
    accounts.emails.length = 0; // so conta o que as tentativas invalidas causam
    stages.inputs.length = 0;

    const casos = [
      'token-inexistente-' + 'b'.repeat(30),
      CONSUMED_TOKEN.slice(0, -1) + 'X',
      '123456',
      CONSUMED_TOKEN,
    ];
    const respostas = [];
    for (const token of casos) {
      respostas.push(await consumeChallenge(deps, token));
    }
    const primeira = JSON.stringify(respostas[0]);
    for (const r of respostas) {
      expect(JSON.stringify(r)).toBe(primeira);
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ code: 'link_invalido' });
      expect('setCookie' in r).toBe(false);
    }
    expect(accounts.emails).toHaveLength(0);
    expect(stages.inputs).toHaveLength(0);
    expect(repo.calls).toBe(casos.length + 1);
  });
});

describe('T-H012-04 link valido: etapa de identificacao e cookie', () => {
  it('200 identificado, cookie do segredo (nao do token) e so o hash vai ao banco', async () => {
    const { repo, stages, deps } = montar({ newSecret: () => 'S'.repeat(43) });
    const challengeId = repo.add(CONSUMED_TOKEN);

    const r = await consumeChallenge(deps, CONSUMED_TOKEN);

    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'identificado' });
    expect(r.setCookie).toBe(
      `__Host-fp_ident=${'S'.repeat(43)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900`,
    );
    expect(r.setCookie).not.toContain(CONSUMED_TOKEN);
    expect(stages.inputs).toHaveLength(1);
    const etapa = stages.inputs[0]!;
    expect(etapa.challengeId).toBe(challengeId);
    expect(etapa.purpose).toBe('login');
    expect(etapa.hashDoSegredo).toBe(sha('S'.repeat(43)));
    expect(JSON.stringify(etapa)).not.toContain('S'.repeat(43));
    expect(JSON.stringify(etapa)).not.toContain(CONSUMED_TOKEN);
  });
});

describe('T-H012-05 conta do cliente', () => {
  it('usa o e-mail decifrado e abre a etapa com o usuario devolvido', async () => {
    const { repo, accounts, stages, deps } = montar();
    repo.add(CONSUMED_TOKEN);
    const r = await consumeChallenge(deps, CONSUMED_TOKEN);
    expect(r.status).toBe(200);
    expect(accounts.emails).toEqual([EMAIL]);
    expect(stages.inputs[0]?.userId).toBe(USER_ID);
  });

  it('conta bloqueada devolve link_invalido, sem sessao e sem cookie', async () => {
    const { repo, accounts, stages, deps } = montar();
    accounts.fallback = { status: 'bloqueado' };
    repo.add(CONSUMED_TOKEN);
    const r = await consumeChallenge(deps, CONSUMED_TOKEN);
    expect(r).toMatchObject({ status: 400, body: { code: 'link_invalido' } });
    expect('setCookie' in r).toBe(false);
    expect(stages.inputs).toHaveLength(0);
  });
});

describe('T-H012-06 falha da conta: ate 2 tentativas, depois 503', () => {
  it.each([
    ['resultado de falha', ['falha', 'falha'] as const],
    ['erro de rede', ['throw', 'throw'] as const],
  ])('%s duas vezes: 503 acesso_indisponivel, sem cookie, link fica gasto', async (_, roteiro) => {
    const { repo, accounts, stages, failures, deps } = montar();
    accounts.script.push(
      ...roteiro.map((x) => (x === 'falha' ? ({ status: 'falha' } as const) : x)),
    );
    repo.add(CONSUMED_TOKEN);

    const r = await consumeChallenge(deps, CONSUMED_TOKEN);

    expect(r).toMatchObject({ status: 503, body: { code: 'acesso_indisponivel' } });
    expect('setCookie' in r).toBe(false);
    expect(accounts.emails).toHaveLength(2);
    expect(stages.inputs).toHaveLength(0);
    expect(failures).toEqual(['consumo_falha_conta']);
    expect((await consumeChallenge(deps, CONSUMED_TOKEN)).status).toBe(400);
  });

  it('prazo de 8 s esgotado (simulado com 50 ms): duas tentativas, depois 503', async () => {
    const { repo, accounts, deps } = montar();
    accounts.script.push('hang', 'hang');
    repo.add(CONSUMED_TOKEN);
    const r = await consumeChallenge(deps, CONSUMED_TOKEN);
    expect(r.status).toBe(503);
    expect(accounts.emails).toHaveLength(2);
  });

  it('uma falha seguida de sucesso ainda entrega a sessao', async () => {
    const { repo, accounts, deps } = montar();
    accounts.script.push({ status: 'falha' });
    repo.add(CONSUMED_TOKEN);
    const r = await consumeChallenge(deps, CONSUMED_TOKEN);
    expect(r.status).toBe(200);
    expect(accounts.emails).toHaveLength(2);
  });
});

describe('T-H012-07 falha ao abrir a etapa', () => {
  it('recusa ou erro: 503 consumo_falha_etapa, link nao volta, conta reaproveitada na reemissao', async () => {
    const { repo, accounts, stages, failures, deps } = montar();
    stages.mode = 'erro';
    repo.add(CONSUMED_TOKEN);
    const r = await consumeChallenge(deps, CONSUMED_TOKEN);
    expect(r).toMatchObject({ status: 503, body: { code: 'acesso_indisponivel' } });
    expect('setCookie' in r).toBe(false);
    expect(failures).toEqual(['consumo_falha_etapa']);

    // Reemissao: novo link, conta devolvida de novo (idempotente no banco), agora a etapa abre.
    stages.mode = 'ok';
    repo.add(CONSUMED_TOKEN + '-novo');
    const segunda = await consumeChallenge(deps, CONSUMED_TOKEN + '-novo');
    expect(segunda.status).toBe(200);
    expect(accounts.emails).toHaveLength(2);
  });
});

describe('T-H012-08 concorrencia no manipulador', () => {
  it('20 POSTs do mesmo token: 1 identificado, 19 link_invalido, 1 etapa, 1 conta', async () => {
    const { repo, accounts, stages, deps } = montar();
    repo.add(CONSUMED_TOKEN);
    const respostas = await Promise.all(
      Array.from({ length: 20 }, () => consumeChallenge(deps, CONSUMED_TOKEN)),
    );
    const ok = respostas.filter((r) => r.status === 200);
    const invalidas = respostas.filter((r) => r.status === 400);
    expect(ok).toHaveLength(1);
    expect(invalidas).toHaveLength(19);
    expect(new Set(invalidas.map((r) => JSON.stringify(r))).size).toBe(1);
    expect(stages.inputs).toHaveLength(1);
    expect(accounts.emails).toHaveLength(1);
  });
});

describe('T-H012-10 nada sensivel em registros e erros', () => {
  it('falhas e sucessos nao expõem token, e-mail ou segredo em nenhum canal', async () => {
    const logs = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const espias = logs.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    try {
      const { repo, accounts, stages, failures, deps } = montar({
        newSecret: () => 'Q'.repeat(43),
      });
      const saidas: string[] = [];

      repo.add(CONSUMED_TOKEN);
      // O Set-Cookie leva o segredo ao navegador de proposito; o corpo e os registros nao levam.
      const ok = await consumeChallenge(deps, CONSUMED_TOKEN);
      saidas.push(JSON.stringify({ ...ok, setCookie: undefined }));
      expect(ok.setCookie).toContain('Q'.repeat(43));
      saidas.push(JSON.stringify(await consumeChallenge(deps, CONSUMED_TOKEN)));

      accounts.fallback = { status: 'falha' };
      repo.add(CONSUMED_TOKEN + '-2');
      saidas.push(JSON.stringify(await consumeChallenge(deps, CONSUMED_TOKEN + '-2')));

      saidas.push(...failures);
      for (const texto of saidas) {
        expect(texto).not.toContain(EMAIL);
        expect(texto).not.toContain(CONSUMED_TOKEN);
        expect(texto).not.toContain('Q'.repeat(43));
      }
      expect(stages.inputs.every((e) => !JSON.stringify(e).includes('Q'.repeat(43)))).toBe(true);
      for (const espia of espias) expect(espia).not.toHaveBeenCalled();
    } finally {
      for (const espia of espias) espia.mockRestore();
    }
  });
});

describe('adaptadores Pg com SqlClient simulado', () => {
  type Chamada = { sql: string; params: unknown[] };
  function clientFake(respostas: Array<Array<Record<string, unknown>>>) {
    const chamadas: Chamada[] = [];
    return {
      chamadas,
      client: {
        async query(sql: string, params: unknown[] = []) {
          chamadas.push({ sql, params });
          return { rows: respostas.shift() ?? [] };
        },
      },
    };
  }

  it('PgConsumeRepository chama uma so funcao com o hash e o instante', async () => {
    const enc = Buffer.from([1, 2, 3]);
    const { chamadas, client } = clientFake([
      [{ out_resultado: 'ok', out_challenge_id: 'c1', out_purpose: 'login', out_email_enc: enc, out_draft_id: null }],
    ]);
    const r = await new PgConsumeRepository(client).consumeLink('h'.repeat(64), NOW);
    expect(r).toEqual({ resultado: 'ok', challengeId: 'c1', purpose: 'login', emailEnc: enc, draftId: null });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.sql).toContain('private.auth_challenge_consume_link(');
    expect(chamadas[0]?.params).toEqual(['h'.repeat(64), new Date(NOW).toISOString()]);
  });

  it('PgConsumeRepository devolve invalido sem vazar o hash', async () => {
    const { client } = clientFake([[{ out_resultado: 'invalido', out_challenge_id: null, out_purpose: null, out_email_enc: null, out_draft_id: null }]]);
    expect(await new PgConsumeRepository(client).consumeLink('a'.repeat(64), NOW)).toEqual({
      resultado: 'invalido',
    });
  });

  it('PgSessionStageStore: true quando a etapa e criada, false quando o desafio ja tinha etapa', async () => {
    const criada = clientFake([[{ id: randomUUID() }]]);
    const repetida = clientFake([[{ id: null }]]);
    const entrada: OpenStageInput = {
      sessionId: randomUUID(),
      userId: USER_ID,
      challengeId: randomUUID(),
      purpose: 'login',
      draftId: null,
      hashDoSegredo: 'e'.repeat(64),
      nowMs: NOW,
    };
    expect(await new PgSessionStageStore(criada.client).openStage(entrada)).toBe(true);
    expect(criada.chamadas[0]?.sql).toContain('private.app_session_open_stage(');
    expect(await new PgSessionStageStore(repetida.client).openStage(entrada)).toBe(false);
  });

  it('PgCustomerAccounts: usuario existente nao chama o Auth; novo chama uma vez e grava', async () => {
    const existente = clientFake([[{ out_user_id: USER_ID, out_status: 'ativo' }]]);
    let criacoes = 0;
    const auth: AuthUserAdminPort = {
      async createUser(): Promise<AuthCreateResult> {
        criacoes += 1;
        return { status: 'criado', authUserId: randomUUID() };
      },
    };
    expect(await new PgCustomerAccounts(existente.client, auth).ensureCustomer(EMAIL, NOW)).toEqual({
      status: 'ok',
      userId: USER_ID,
    });
    expect(criacoes).toBe(0);

    const novo = clientFake([[], [{ out_user_id: USER_ID, out_status: 'ativo' }]]);
    expect(await new PgCustomerAccounts(novo.client, auth).ensureCustomer(EMAIL, NOW)).toEqual({
      status: 'ok',
      userId: USER_ID,
    });
    expect(criacoes).toBe(1);
    expect(novo.chamadas[1]?.sql).toContain('private.app_user_ensure(');
  });

  it('PgCustomerAccounts: bloqueado vira bloqueado; e-mail ja existente no Auth vira falha', async () => {
    const bloqueado = clientFake([[{ out_user_id: USER_ID, out_status: 'bloqueado' }]]);
    const auth: AuthUserAdminPort = { createUser: async () => ({ status: 'ja_existe' }) };
    expect(await new PgCustomerAccounts(bloqueado.client, auth).ensureCustomer(EMAIL, NOW)).toEqual({
      status: 'bloqueado',
    });
    const sem = clientFake([[]]);
    expect(await new PgCustomerAccounts(sem.client, auth).ensureCustomer(EMAIL, NOW)).toEqual({
      status: 'falha',
    });
  });
});
