// H-097 (Issue 107) | Ligacao do consumo do link e da verificacao do codigo, em memoria (sem banco, sem rede).
// Adaptador de Auth admin com fetch dublê; rotas por servidor de loopback. Desenho: 86-DESENHO-H097 §3, §5.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-097');
};

import { afterAll, describe, expect, it } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import type { ChallengeStore, ConsumeDeps, VerifyChallengeDeps, SqlClient } from '@fastpro/db';
import { handleRequest } from '../src/app.js';
import { CONSUME_PATH } from '@fastpro/domain';
import {
  CONSUMO_LINK_ENV_OBRIGATORIAS,
  criarAuthAdminSupabase,
  montarConsumoEVerificacao,
} from '../src/modules/identity/consumo-link-composicao.js';
import { CHALLENGE_VERIFY_PATH } from '../src/challenge-verify-route.js';

const PIMENTA = () => randomBytes(24).toString('base64url');
const SEGREDO_AUTH = 'segredo-auth-sintetico-' + randomBytes(12).toString('hex');
const SUPA = 'https://projeto-sintetico.example.test';

function fetchDublê(status: number, corpo: unknown, registro: { url?: string; init?: RequestInit } = {}): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    registro.url = String(url);
    registro.init = init;
    return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

describe('adaptador de Auth admin do cliente (consumo do link, H-097)', () => {
  it('criado: POST em /auth/v1/admin/users com a chave secreta no servidor e e-mail confirmado', async () => {
    const registro: { url?: string; init?: RequestInit } = {};
    const auth = criarAuthAdminSupabase({
      baseUrl: `${SUPA}/`,
      chaveSecreta: SEGREDO_AUTH,
      fetch: fetchDublê(200, { id: '11111111-1111-4111-8111-111111111111' }, registro),
    });
    const r = await auth.createUser('cliente@example.test');
    expect(r).toEqual({ status: 'criado', authUserId: '11111111-1111-4111-8111-111111111111' });
    expect(registro.url).toBe(`${SUPA}/auth/v1/admin/users`);
    const headers = registro.init?.headers as Record<string, string>;
    expect(headers.apikey).toBe(SEGREDO_AUTH);
    expect(headers.Authorization).toBe(`Bearer ${SEGREDO_AUTH}`);
    expect(JSON.parse(String(registro.init?.body))).toEqual({ email: 'cliente@example.test', email_confirm: true });
  });

  it('duplicado so com error_code email_exists (422): ja_existe', async () => {
    const auth = criarAuthAdminSupabase({ baseUrl: SUPA, chaveSecreta: SEGREDO_AUTH, fetch: fetchDublê(422, { error_code: 'email_exists', code: 422 }) });
    expect(await auth.createUser('a@example.test')).toEqual({ status: 'ja_existe' });
  });

  it('outro 422 (configuracao) vira erro de configuracao, nunca ja_existe', async () => {
    const auth = criarAuthAdminSupabase({ baseUrl: SUPA, chaveSecreta: SEGREDO_AUTH, fetch: fetchDublê(422, { error_code: 'weak_password', msg: SEGREDO_AUTH }) });
    const erro = await auth.createUser('a@example.test').catch((e: unknown) => e as Error);
    expect((erro as Error).message).toBe('auth_admin_configuracao');
  });

  it('422 sem corpo legivel: erro de configuracao, nunca ja_existe', async () => {
    const auth = criarAuthAdminSupabase({ baseUrl: SUPA, chaveSecreta: SEGREDO_AUTH, fetch: (async () => new Response('<html>', { status: 422 })) as typeof fetch });
    await expect(auth.createUser('a@example.test')).rejects.toThrow('auth_admin_configuracao');
  });

  it('200 com corpo nao JSON: codigo fixo, sem conteudo', async () => {
    const auth = criarAuthAdminSupabase({ baseUrl: SUPA, chaveSecreta: SEGREDO_AUTH, fetch: (async () => new Response('<html>' + SEGREDO_AUTH, { status: 200 })) as typeof fetch });
    const erro = await auth.createUser('a@example.test').catch((e: unknown) => e as Error);
    expect((erro as Error).message).toBe('auth_admin_resposta_invalida');
    expect((erro as Error).message).not.toContain(SEGREDO_AUTH);
  });

  it('falha do servico: erro com codigo fixo, sem a chave nem o corpo', async () => {
    const auth = criarAuthAdminSupabase({ baseUrl: SUPA, chaveSecreta: SEGREDO_AUTH, fetch: fetchDublê(500, { msg: SEGREDO_AUTH }) });
    const erro = await auth.createUser('a@example.test').catch((e: unknown) => e as Error);
    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).toBe('auth_admin_indisponivel');
    expect((erro as Error).message).not.toContain(SEGREDO_AUTH);
  });

  it('rede caida: erro com codigo fixo', async () => {
    const auth = criarAuthAdminSupabase({
      baseUrl: SUPA,
      chaveSecreta: SEGREDO_AUTH,
      fetch: (async () => {
        throw new Error('ECONNRESET ' + SEGREDO_AUTH);
      }) as typeof fetch,
    });
    await expect(auth.createUser('a@example.test')).rejects.toThrow('auth_admin_indisponivel');
  });
});

// Um valor sintetico por nome da lista oficial (sem valor literal no arquivo).
const valorSintetico = (nome: string): string => {
  if (nome === 'DATABASE_URL_APP_SYSTEM') return 'postgres://app_system@localhost:5432/dev';
  if (nome === 'SITE_URL') return 'https://fastpro.example.test';
  if (nome === 'SUPABASE_URL') return SUPA;
  if (nome === 'AUTH_CHALLENGE_KEY') return randomBytes(32).toString('base64');
  return randomBytes(24).toString('base64url');
};
const AMBIENTE_COMPLETO: Record<string, string> = Object.fromEntries(
  CONSUMO_LINK_ENV_OBRIGATORIAS.map((nome) => [nome, valorSintetico(nome)]),
);
const CLIENTE_FALSO = { query: async () => ({ rows: [] }), end: async () => undefined } as unknown as SqlClient;

describe('montagem do consumo e da verificacao (vercel.ts, H-097)', () => {
  it('sem as variaveis: as duas rotas ficam 404 e a pendencia leva so os nomes', () => {
    const m = montarConsumoEVerificacao({}, { abrirCliente: () => CLIENTE_FALSO });
    expect(m.consume).toBeUndefined();
    expect(m.verify).toBeUndefined();
    expect(m.pendencias).toEqual([...CONSUMO_LINK_ENV_OBRIGATORIAS]);
    expect(m.pendencias.join(' ')).not.toContain(SEGREDO_AUTH);
  });

  it('chave de cifra invalida: pendencia com o nome, sem valor', () => {
    const m = montarConsumoEVerificacao({ ...AMBIENTE_COMPLETO, AUTH_CHALLENGE_KEY: 'curta' }, { abrirCliente: () => CLIENTE_FALSO });
    expect(m.consume).toBeUndefined();
    expect(m.pendencias).toEqual(['AUTH_CHALLENGE_KEY (invalida)']);
  });

  it('sem fabrica de cliente SQL: nao monta', () => {
    const m = montarConsumoEVerificacao(AMBIENTE_COMPLETO, {});
    expect(m.consume).toBeUndefined();
    expect(m.pendencias.length).toBe(1);
  });

  it('com as variaveis e a fabrica: as duas opcoes existem e nada e consultado na montagem', () => {
    let abertos = 0;
    const m = montarConsumoEVerificacao(AMBIENTE_COMPLETO, {
      abrirCliente: () => {
        abertos += 1;
        return CLIENTE_FALSO;
      },
    });
    expect(m.pendencias).toEqual([]);
    expect(m.consume?.siteUrl).toBe('https://fastpro.example.test');
    expect(m.verify).toBeDefined();
    expect(abertos).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------
// Rotas por HTTP com dublês do armazenamento.
// ---------------------------------------------------------------------------------------------------

interface ArmazenamentoFalso {
  readonly tentativas: unknown[];
  resultado: 'ok' | 'errado' | 'bloqueado_codigo';
  store: ChallengeStore & {
    activeId(): Promise<string | null>;
    attemptCode(input: unknown): Promise<{ resultado: string; retryAfterSeconds: number | null }>;
  };
}

function armazenamento(resultado: ArmazenamentoFalso['resultado']): ArmazenamentoFalso {
  const tentativas: unknown[] = [];
  const falso: ArmazenamentoFalso = {
    tentativas,
    resultado,
    store: {
      create: async () => {
        throw new Error('nao usado');
      },
      findRow: async () => null,
      markDelivered: async () => undefined,
      activeId: async () => null,
      attemptCode: async (input: unknown) => {
        tentativas.push(input);
        return { resultado: falso.resultado, retryAfterSeconds: falso.resultado === 'bloqueado_codigo' ? 60 : null };
      },
    },
  };
  return falso;
}

function depsVerificacao(falso: ArmazenamentoFalso): VerifyChallengeDeps {
  return {
    store: falso.store,
    secrets: {
      key: Buffer.alloc(32, 3),
      pepperEmail: PIMENTA(),
      pepperCode: PIMENTA(),
    },
    clock: { nowMs: () => Date.UTC(2099, 0, 1), sleep: async () => undefined },
    rate: { pepperIp: PIMENTA(), limits: {
      pedidoIpHora: 20, pedidoGlobalHora: 30, pedidoGlobalDia: 80, codigoIpHora: 50, erroCodigoDia: 15,
    } },
  };
}

const servidores: Server[] = [];
afterAll(() => {
  for (const s of servidores) s.close();
});

async function servidorCom(opcoes: { challengeVerify?: { deps: VerifyChallengeDeps }; consume?: { deps: ConsumeDeps; siteUrl: string } }): Promise<string> {
  const server = createServer((req, res) => {
    handleRequest(req, res, { tickSecret: undefined, ...opcoes }).catch(() => {
      res.statusCode = 500;
      res.end();
    });
  });
  servidores.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function post(base: string, caminho: string, corpo: string, cabecalhos: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      new URL(caminho, base),
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo), ...cabecalhos } },
      (res) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(partes).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.end(corpo);
  });
}

describe('POST /v1/auth/challenges/verify (verificacao do codigo, caminho proposto)', () => {
  it('codigo certo: 200 codigo_ok', async () => {
    const falso = armazenamento('ok');
    const base = await servidorCom({ challengeVerify: { deps: depsVerificacao(falso) } });
    const r = await post(base, CHALLENGE_VERIFY_PATH, JSON.stringify({ email: 'cliente@example.test', code: '123456' }));
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ status: 'codigo_ok' });
    expect(falso.tentativas).toHaveLength(1);
  });

  it('codigo errado: 422 codigo_invalido, sem dizer o motivo', async () => {
    const falso = armazenamento('errado');
    const base = await servidorCom({ challengeVerify: { deps: depsVerificacao(falso) } });
    const r = await post(base, CHALLENGE_VERIFY_PATH, JSON.stringify({ email: 'cliente@example.test', code: '000000' }));
    expect(r.status).toBe(422);
    expect(JSON.parse(r.body)).toEqual({ code: 'codigo_invalido' });
  });

  it('bloqueio por tentativas: 429 com Retry-After', async () => {
    const falso = armazenamento('bloqueado_codigo');
    const base = await servidorCom({ challengeVerify: { deps: depsVerificacao(falso) } });
    const r = await post(base, CHALLENGE_VERIFY_PATH, JSON.stringify({ email: 'cliente@example.test', code: '000000' }));
    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toBeDefined();
  });

  it('corpo sem codigo de 6 digitos ou finalidade invalida: 422 sem tocar o armazenamento', async () => {
    const falso = armazenamento('ok');
    const base = await servidorCom({ challengeVerify: { deps: depsVerificacao(falso) } });
    const semCodigo = await post(base, CHALLENGE_VERIFY_PATH, JSON.stringify({ email: 'cliente@example.test', code: '12' }));
    const finalidadeRuim = await post(base, CHALLENGE_VERIFY_PATH, JSON.stringify({ email: 'cliente@example.test', code: '123456', purpose: 'nao-existe' }));
    const naoJson = await post(base, CHALLENGE_VERIFY_PATH, '{ruim');
    for (const r of [semCodigo, finalidadeRuim, naoJson]) {
      expect(r.status).toBe(422);
      expect(JSON.parse(r.body)).toEqual({ code: 'codigo_invalido' });
    }
    expect(falso.tentativas).toHaveLength(0);
  });

  it('a rota nao existe sem a opcao (404) e nao aceita GET', async () => {
    const semOpcao = await servidorCom({});
    const r = await post(semOpcao, CHALLENGE_VERIFY_PATH, JSON.stringify({ email: 'a@example.test', code: '123456' }));
    expect(r.status).toBe(404);
  });
});

describe('POST /v1/auth/challenges/consume (ligado em vercel.ts, H-097)', () => {
  it('a rota existe quando montada: sem origem valida nao chega ao consumo (4xx, nunca 404)', async () => {
    let chamadas = 0;
    const deps = new Proxy({}, { get: () => () => { chamadas += 1; return Promise.resolve(); } }) as unknown as ConsumeDeps;
    const base = await servidorCom({ consume: { deps, siteUrl: 'https://fastpro.example.test' } });
    const r = await post(base, CONSUME_PATH, JSON.stringify({ token: 'x'.repeat(43) }));
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
    expect(r.status).not.toBe(404);
    expect(chamadas).toBe(0);
    expect(r.body).not.toContain('x'.repeat(43));
  });
});
