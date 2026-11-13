// H-031 (Issue #44) | Rota POST /v1/requests isolada (sem app.ts), com servidor HTTP real e portas simuladas
// (docs/factory/110-DESENHO-H031.md, §12.2: T-API01, T-API02, T-API03, T-API04, T-API05, T-API06, T-API09).
// Sem banco e sem rede externa: a loja, a geocodificacao e a sessao sao fakes. O provedor so e chamado no caso feliz.
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DRAFT_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  parseBreakerCaps,
  type PermanentPoint,
} from '@fastpro/domain';
import { hashSessionSecret } from '@fastpro/db';
import { handleRequestPublishRoute, REQUEST_PUBLISH_PATH, type PublishRouteOptions } from '../src/requests/publish-route.js';
import type { PublishStorePort } from '../src/requests/publish-service.js';
import { createDraftHasher, newDraftSecret } from '../src/drafts/draft-hash.js';
import { createAddressVault } from '../src/requests/address-crypto.js';
import type {
  GeocodingPermanentPort,
  GeoPointStorePort,
  GeoReserveOutcome,
  PermanentLookup,
} from '../src/geo/permanent-ports.js';
import type {
  PublishAbortInput,
  PublishBeginInput,
  PublishBeginOutcome,
  PublishCommitInput,
  PublishCommitOutcome,
  PublishRecusa,
} from '../../../packages/db/src/request-publish.js';
import { issueDuplicateAck } from '../../../packages/domain/src/request/index.js';

const SITE = 'https://fastpro.example';
const USER = '11111111-1111-4111-8111-111111111111';
const DRAFT = '22222222-2222-4222-8222-222222222222';
const PEDIDO = '33333333-3333-4333-8333-333333333333';
const SIMILAR = '55555555-5555-4555-8555-555555555555';
const AGORA = Date.UTC(2026, 10, 13, 12, 0, 0);
const CHAVE = 'k'.repeat(32);
const CHAVE_ENDERECO_TESTE = 'chave-de-teste-issue45-em-memoria-0123456789';
const SESSAO_OK = 'sessao-valida-de-teste-000000000000000000';
const CHAVE_IDEM = 'idem-chave-de-teste-01';
const PEDIDO_CRIADO = {
  id: PEDIDO,
  publishedAt: new Date(AGORA).toISOString(),
  acceptanceDeadlineAt: new Date(AGORA + 168 * 3600 * 1000).toISOString(),
};

class LojaFalsa implements PublishStorePort {
  readonly begins: PublishBeginInput[] = [];
  readonly commits: PublishCommitInput[] = [];
  readonly aborts: PublishAbortInput[] = [];
  beginResultado: PublishBeginOutcome = { status: 'ok', addressText: 'Rua Exemplo, 10' };
  commitResultado: (input: PublishCommitInput) => PublishCommitOutcome = () => ({ status: 'criado', pedido: PEDIDO_CRIADO });

  async begin(input: PublishBeginInput): Promise<PublishBeginOutcome> {
    this.begins.push(input);
    return this.beginResultado;
  }

  async commit(input: PublishCommitInput): Promise<PublishCommitOutcome> {
    this.commits.push(input);
    return this.commitResultado(input);
  }

  async abort(input: PublishAbortInput): Promise<boolean> {
    this.aborts.push(input);
    return true;
  }
}

class GeoFalsa implements GeoPointStorePort {
  acao: GeoReserveOutcome = { acao: 'chamar', ref: 'ref-1' };

  async reserve(): Promise<GeoReserveOutcome> {
    return this.acao;
  }

  async storePermanent(): Promise<string> {
    return 'ponto-1';
  }

  async markNoResult(): Promise<void> {}

  async release(): Promise<void> {}

  async panel(): Promise<{ readonly used: number; readonly aguardando: number }> {
    return { used: 0, aguardando: 0 };
  }
}

class ProvedorFalso implements GeocodingPermanentPort {
  chamadas = 0;
  /** Resultado forcado (sem_resultado, falha); null = ponto de exemplo. */
  resultado: PermanentLookup | null = null;

  async geocode(): Promise<PermanentLookup> {
    this.chamadas += 1;
    if (this.resultado !== null) return this.resultado;
    return { status: 'ponto', point: { lon: -46.6, lat: -23.5, precision: 'rooftop' } as PermanentPoint };
  }
}

interface Resposta {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

let servidor: Server;
let porta = 0;
let loja: LojaFalsa;
let geo: GeoFalsa;
let provedor: ProvedorFalso;
let semProvedor = false;
let segredoRascunho: string;

function opcoes(): PublishRouteOptions {
  const hasher = createDraftHasher(CHAVE);
  return {
    siteUrl: SITE,
    sessions: {
      async authenticate(hash: string) {
        return hash === hashSessionSecret(SESSAO_OK) ? { userId: USER } : null;
      },
    },
    service: semProvedor
      ? undefined
      : {
          store: loja,
          geo: {
            store: geo,
            provider: provedor,
            hashAddress: () => 'a'.repeat(64),
            caps: parseBreakerCaps('100', '200'),
            clock: () => AGORA,
          },
          hasher,
          // Issue 45: cofre com chave de teste montada em memoria (nunca de .env.local).
          addressVault: createAddressVault(CHAVE_ENDERECO_TESTE),
          chave: CHAVE,
          rateKey: (finalidade: string, identificador: string) => `${finalidade}:${identificador}`,
          clock: { nowMs: () => AGORA },
        },
  };
}

function chamar(
  headers: Record<string, string>,
  corpo: string,
): Promise<Resposta> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port: porta, path: REQUEST_PUBLISH_PATH, method: 'POST', headers },
      (res) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(partes).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    req.end(corpo);
  });
}

function cabecalhosValidos(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Origin: SITE,
    'Sec-Fetch-Site': 'same-origin',
    'Content-Type': 'application/json',
    'Idempotency-Key': CHAVE_IDEM,
    Cookie: `${SESSION_COOKIE_NAME}=${SESSAO_OK}; ${DRAFT_COOKIE_NAME}=${segredoRascunho}`,
    ...extra,
  };
}

const CORPO_OK = JSON.stringify({ draft_id: DRAFT, content_rev: 3 });

beforeAll(async () => {
  segredoRascunho = newDraftSecret();
  servidor = createServer((req, res) => {
    void handleRequestPublishRoute(req, res, req.url ?? '', opcoes());
  });
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', () => resolve()));
  porta = (servidor.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
});

beforeEach(() => {
  loja = new LojaFalsa();
  geo = new GeoFalsa();
  provedor = new ProvedorFalso();
  semProvedor = false;
});

describe('POST /v1/requests: ordem das recusas (110 §3.1)', () => {
  it('sem provedor responde 503 publicacao_indisponivel sem tocar a loja', async () => {
    semProvedor = true;
    const r = await chamar(cabecalhosValidos(), CORPO_OK);
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body)).toEqual({ code: 'publicacao_indisponivel' });
    expect(loja.begins).toHaveLength(0);
  });

  it('Origin de outro site responde 403 origem_invalida', async () => {
    const r = await chamar(cabecalhosValidos({ Origin: 'https://outro.example' }), CORPO_OK);
    expect(r.status).toBe(403);
    expect(JSON.parse(r.body)).toEqual({ code: 'origem_invalida' });
  });

  it('chave de idempotencia ausente ou curta responde 422 chave_invalida', async () => {
    const r = await chamar(cabecalhosValidos({ 'Idempotency-Key': 'curta' }), CORPO_OK);
    expect(r.status).toBe(422);
    expect(JSON.parse(r.body)).toEqual({ code: 'chave_invalida' });
    expect(loja.begins).toHaveLength(0);
  });

  it('sem cookie de sessao responde 401 sessao_necessaria', async () => {
    const r = await chamar(cabecalhosValidos({ Cookie: `${DRAFT_COOKIE_NAME}=${segredoRascunho}` }), CORPO_OK);
    expect(r.status).toBe(401);
    expect(JSON.parse(r.body)).toEqual({ code: 'sessao_necessaria' });
  });

  it('sem cookie do rascunho responde 404 byte a byte igual ao rascunho nao encontrado da #43', async () => {
    const r = await chamar(cabecalhosValidos({ Cookie: `${SESSION_COOKIE_NAME}=${SESSAO_OK}` }), CORPO_OK);
    expect(r.status).toBe(404);
    expect(r.body).toBe(JSON.stringify({ code: 'nao_encontrado' }));
  });

  it('corpo com campo extra responde 422 corpo_invalido (atribuicao em massa recusada)', async () => {
    const corpo = JSON.stringify({ draft_id: DRAFT, content_rev: 3, owner: 'outro' });
    const r = await chamar(cabecalhosValidos(), corpo);
    expect(r.status).toBe(422);
    expect(JSON.parse(r.body)).toEqual({ code: 'corpo_invalido' });
  });

  it('corpo acima de 1 KB responde 413 corpo_grande', async () => {
    const corpo = JSON.stringify({ draft_id: DRAFT, content_rev: 3, duplicate_ack: 'x'.repeat(2000) });
    const r = await chamar(cabecalhosValidos(), corpo);
    expect(r.status).toBe(413);
    expect(JSON.parse(r.body)).toEqual({ code: 'corpo_grande' });
  });
});

describe('POST /v1/requests: publicacao e idempotencia (110 §5, T-API01, T-API02)', () => {
  it('falha do abort nao muda a resposta ao cliente (melhor esforco, H-031 #44)', async () => {
    loja.commit = async () => {
      throw new Error('falha de banco');
    };
    loja.abort = async () => {
      throw new Error('abort tambem falhou');
    };
    const r = await chamar(cabecalhosValidos(), CORPO_OK);
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body)).toMatchObject({ code: 'indisponivel' });
  });

  it('criacao responde 201 com lista fechada de chaves e nao chama o provedor mais de uma vez', async () => {
    const r = await chamar(cabecalhosValidos(), CORPO_OK);
    expect(r.status).toBe(201);
    const corpo = JSON.parse(r.body) as Record<string, unknown>;
    expect(Object.keys(corpo).sort()).toEqual(['acceptanceDeadlineAt', 'id', 'publishedAt', 'status']);
    expect(corpo.status).toBe('publicado');
    expect(corpo.id).toBe(PEDIDO);
    expect(provedor.chamadas).toBe(1);
    expect(loja.aborts).toHaveLength(0);
    expect(loja.commits[0]?.ack).toBe(false);
  });

  it('segunda chave no mesmo rascunho ja publicado responde 200 com o mesmo pedido', async () => {
    loja.commitResultado = () => ({ status: 'ja_publicado', pedido: PEDIDO_CRIADO });
    const r = await chamar(cabecalhosValidos({ 'Idempotency-Key': 'outra-chave-de-teste-02' }), CORPO_OK);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).id).toBe(PEDIDO);
  });

  it('repeticao da mesma chave responde 201 sem chamar o provedor', async () => {
    loja.beginResultado = { status: 'repetida', pedido: PEDIDO_CRIADO };
    const r = await chamar(cabecalhosValidos(), CORPO_OK);
    expect(r.status).toBe(201);
    expect(provedor.chamadas).toBe(0);
  });

  it('endereco novo chama o provedor uma vez; em andamento responde 409 com Retry-After e libera a chave', async () => {
    geo.acao = { acao: 'em_andamento' };
    const r = await chamar(cabecalhosValidos(), CORPO_OK);
    expect(r.status).toBe(409);
    expect(JSON.parse(r.body)).toEqual({ code: 'geocodificacao_em_andamento' });
    expect(r.headers['retry-after']).toBe('2');
    expect(loja.aborts).toHaveLength(1);
    expect(loja.commits).toHaveLength(0);
  });

  it('teto de enderecos responde 422 geocode_limit sem chamar o provedor', async () => {
    geo.acao = { acao: 'teto' };
    const r = await chamar(cabecalhosValidos(), CORPO_OK);
    expect(r.status).toBe(422);
    expect(JSON.parse(r.body)).toEqual({ code: 'geocode_limit' });
    expect(provedor.chamadas).toBe(0);
  });
});

describe('POST /v1/requests: duplicidade e token (T-API05)', () => {
  it('duplicidade responde 409 com token; reenvio com o token valido cria o pedido com ack', async () => {
    loja.commitResultado = (input) =>
      input.ack
        ? { status: 'criado', pedido: PEDIDO_CRIADO }
        : { status: 'duplicidade', similar: { id: SIMILAR, publishedAt: PEDIDO_CRIADO.publishedAt, serviceName: 'Eletricista' } };
    const primeira = await chamar(cabecalhosValidos(), CORPO_OK);
    expect(primeira.status).toBe(409);
    const aviso = JSON.parse(primeira.body) as { code: string; ackToken: string; similar: { id: string } };
    expect(aviso.code).toBe('duplicidade');
    expect(aviso.similar.id).toBe(SIMILAR);
    expect(loja.aborts).toHaveLength(1);

    const corpoComToken = JSON.stringify({ draft_id: DRAFT, content_rev: 3, duplicate_ack: aviso.ackToken });
    const segunda = await chamar(cabecalhosValidos({ 'Idempotency-Key': 'chave-com-aviso-0003' }), corpoComToken);
    expect(segunda.status).toBe(201);
    expect(loja.commits.at(-1)?.ack).toBe(true);
  });

  it('token adulterado nao vale: responde 409 de novo', async () => {
    loja.commitResultado = () => ({
      status: 'duplicidade',
      similar: { id: SIMILAR, publishedAt: PEDIDO_CRIADO.publishedAt, serviceName: 'Eletricista' },
    });
    const corpo = JSON.stringify({ draft_id: DRAFT, content_rev: 3, duplicate_ack: 'aaaa.bbbb' });
    const r = await chamar(cabecalhosValidos({ 'Idempotency-Key': 'chave-com-aviso-0004' }), corpo);
    expect(r.status).toBe(409);
    expect(loja.commits.at(-1)?.ack).toBe(false);
  });
});

describe('POST /v1/requests: limite e conflito (T-API06, §3.1)', () => {
  it('limite responde 429 com Retry-After e sem numero de limite no corpo', async () => {
    loja.beginResultado = { status: 'limite', retryAfter: 1800 };
    const r = await chamar(cabecalhosValidos(), CORPO_OK);
    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toBe('1800');
    expect(JSON.parse(r.body)).toEqual({ code: 'limite' });
  });

  it('mesma chave com corpo diferente responde 422 chave_reutilizada', async () => {
    loja.beginResultado = { status: 'conflito' };
    const r = await chamar(cabecalhosValidos(), CORPO_OK);
    expect(r.status).toBe(422);
    expect(JSON.parse(r.body)).toEqual({ code: 'chave_reutilizada' });
  });

  it('breaker de gasto responde 202 aguardando_geocodificacao com Retry-After 30 e libera a chave', async () => {
    geo.acao = { acao: 'breaker' };
    const r = await chamar(cabecalhosValidos(), CORPO_OK);
    expect(r.status).toBe(202);
    expect(JSON.parse(r.body)).toEqual({ code: 'aguardando_geocodificacao' });
    expect(r.headers['retry-after']).toBe('30');
    expect(loja.aborts).toHaveLength(1);
    expect(provedor.chamadas).toBe(0);
  });
});

describe('POST /v1/requests: privacidade da resposta (T-API01, T-API07)', () => {
  it('nenhuma resposta de erro leva a chave, o cookie ou o endereco', async () => {
    loja.beginResultado = { status: 'campos_faltando', missing: ['address_text'] };
    const r = await chamar(cabecalhosValidos(), CORPO_OK);
    expect(r.status).toBe(422);
    expect(r.body).not.toContain(CHAVE_IDEM);
    expect(r.body).not.toContain(SESSAO_OK);
    expect(r.body).not.toContain(segredoRascunho);
    expect(r.body).not.toMatch(/\d+\.\d{4,}/);
  });
});

describe('POST /v1/requests: recusas do banco e falhas (110 §3.1, §3.3; CA-01, CA-02, CA-08, CA-11, CA-15, CA-17)', () => {
  it.each([
    ['fotos_em_processamento', 409, '5'],
    ['email_nao_confirmado', 409, undefined],
    ['email_divergente', 409, undefined],
    ['conteudo_alterado', 409, undefined],
    ['nao_confirmado', 409, undefined],
    ['sessao_necessaria', 401, undefined],
    ['nao_encontrado', 404, undefined],
  ] as const)('recusa do banco %s responde %i sem geocodificar nem criar pedido', async (status, http, retry) => {
    loja.beginResultado = { status: status as PublishRecusa };
    const r = await chamar(cabecalhosValidos(), CORPO_OK);
    expect(r.status).toBe(http);
    expect(JSON.parse(r.body)).toEqual({ code: status });
    expect(r.headers['retry-after']).toBe(retry);
    expect(provedor.chamadas).toBe(0);
    expect(loja.commits).toHaveLength(0);
  });

  it('404 de rascunho do banco e byte a byte igual ao 404 uniforme da #43 (RN-13, CA-15)', async () => {
    loja.beginResultado = { status: 'nao_encontrado' };
    const doBanco = await chamar(cabecalhosValidos(), CORPO_OK);
    const semCookie = await chamar(cabecalhosValidos({ Cookie: `${SESSION_COOKIE_NAME}=${SESSAO_OK}` }), CORPO_OK);
    expect(doBanco.status).toBe(404);
    expect(doBanco.body).toBe('{"code":"nao_encontrado"}');
    expect(doBanco.body).toBe(semCookie.body);
  });

  it('conteudo alterado entre begin e commit responde 409 e libera a chave (A4, CA-08)', async () => {
    loja.commitResultado = () => ({ status: 'conteudo_alterado' });
    const r = await chamar(cabecalhosValidos(), CORPO_OK);
    expect(r.status).toBe(409);
    expect(JSON.parse(r.body)).toEqual({ code: 'conteudo_alterado' });
    expect(loja.aborts).toHaveLength(1);
  });

  it('campos faltando detectados no commit devolvem a lista do banco com 422 e liberam a chave', async () => {
    loja.commitResultado = () => ({ status: 'campos_faltando', missing: ['service_id'] });
    const r = await chamar(cabecalhosValidos(), CORPO_OK);
    expect(r.status).toBe(422);
    expect(JSON.parse(r.body)).toEqual({ code: 'campos_faltando', missing: ['service_id'] });
    expect(loja.aborts).toHaveLength(1);
  });

  it('falha de commit comum responde 503 indisponivel com Retry-After 10, sem pedido e com chave liberada (CA-08)', async () => {
    loja.commitResultado = () => {
      throw new Error('publicacao_banco_falhou');
    };
    const r = await chamar(cabecalhosValidos(), CORPO_OK);
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body)).toEqual({ code: 'indisponivel' });
    expect(r.headers['retry-after']).toBe('10');
    expect(r.body).not.toContain(PEDIDO);
    expect(loja.aborts).toHaveLength(1);
  });

  it('chave perdida no commit responde 503 com Retry-After 2 e nunca devolve pedido', async () => {
    loja.commitResultado = () => {
      throw new Error('publicacao_chave_perdida');
    };
    const r = await chamar(cabecalhosValidos(), CORPO_OK);
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body)).toEqual({ code: 'indisponivel' });
    expect(r.headers['retry-after']).toBe('2');
    expect(r.body).not.toContain(PEDIDO);
    expect(loja.aborts).toHaveLength(1);
  });

  it('ponto invalido no commit responde 503 indisponivel e libera a chave', async () => {
    loja.commitResultado = () => ({ status: 'ponto_invalido' });
    const r = await chamar(cabecalhosValidos(), CORPO_OK);
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body)).toEqual({ code: 'indisponivel' });
    expect(r.headers['retry-after']).toBe('10');
    expect(loja.aborts).toHaveLength(1);
  });

  it('excecao no begin responde 503 e nao chama abort (a chave nao foi aberta)', async () => {
    loja.begin = async () => {
      throw new Error('falha de conexao');
    };
    const r = await chamar(cabecalhosValidos(), CORPO_OK);
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body)).toEqual({ code: 'indisponivel' });
    expect(loja.aborts).toHaveLength(0);
    expect(provedor.chamadas).toBe(0);
  });

  it('falha do provedor responde 503 com Retry-After 10, nao cria pedido e libera a chave (CA-11)', async () => {
    provedor.resultado = { status: 'falha', code: 'provider_5xx' };
    const r = await chamar(cabecalhosValidos(), CORPO_OK);
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body)).toEqual({ code: 'indisponivel' });
    expect(r.headers['retry-after']).toBe('10');
    expect(loja.commits).toHaveLength(0);
    expect(loja.aborts).toHaveLength(1);
  });

  it('excecao do provedor tambem responde 503 e libera a chave', async () => {
    provedor.geocode = async () => {
      throw new Error('timeout');
    };
    const r = await chamar(cabecalhosValidos(), CORPO_OK);
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body)).toEqual({ code: 'indisponivel' });
    expect(loja.commits).toHaveLength(0);
    expect(loja.aborts).toHaveLength(1);
  });

  it('endereco sem resultado responde 422 endereco_nao_encontrado, libera a chave e preserva o texto (A6)', async () => {
    provedor.resultado = { status: 'sem_resultado' };
    const r = await chamar(cabecalhosValidos(), CORPO_OK);
    expect(r.status).toBe(422);
    expect(JSON.parse(r.body)).toEqual({ code: 'endereco_nao_encontrado' });
    expect(provedor.chamadas).toBe(1);
    expect(loja.aborts).toHaveLength(1);
  });

  it('endereco ja geocodificado (reutilizar) segue para o commit sem nova chamada paga (CA-10, T-API02)', async () => {
    geo.acao = { acao: 'reutilizar', pointId: 'ponto-existente' };
    const r = await chamar(cabecalhosValidos(), CORPO_OK);
    expect(r.status).toBe(201);
    expect(provedor.chamadas).toBe(0);
    expect(loja.commits[0]?.pointId).toBe('ponto-existente');
  });

  it('duplicidade devolve token com validade de 300 s e o pedido semelhante (decisao 229, CA-09)', async () => {
    loja.commitResultado = () => ({
      status: 'duplicidade',
      similar: { id: SIMILAR, publishedAt: PEDIDO_CRIADO.publishedAt, serviceName: 'Eletricista' },
    });
    const r = await chamar(cabecalhosValidos(), CORPO_OK);
    expect(r.status).toBe(409);
    const corpo = JSON.parse(r.body) as { ackExpiresAt: string; ackToken: string; similar: Record<string, string> };
    expect(corpo.ackExpiresAt).toBe(new Date(AGORA + 300_000).toISOString());
    expect(Object.keys(corpo.similar).sort()).toEqual(['id', 'publishedAt', 'serviceName']);
  });

  it('token de duplicidade vencido ha mais de 300 s nao vale e responde 409 de novo (CA-09)', async () => {
    loja.commitResultado = (input) =>
      input.ack
        ? { status: 'criado', pedido: PEDIDO_CRIADO }
        : { status: 'duplicidade', similar: { id: SIMILAR, publishedAt: PEDIDO_CRIADO.publishedAt, serviceName: 'Eletricista' } };
    const vencido = issueDuplicateAck(
      CHAVE,
      { userId: USER, draftId: DRAFT, contentRev: 3, similarRequestId: SIMILAR },
      AGORA - 301_000,
    );
    const corpo = JSON.stringify({ draft_id: DRAFT, content_rev: 3, duplicate_ack: vencido.token });
    const r = await chamar(cabecalhosValidos({ 'Idempotency-Key': 'chave-com-aviso-0005' }), corpo);
    expect(r.status).toBe(409);
    expect(loja.commits.at(-1)?.ack).toBe(false);
  });
});
