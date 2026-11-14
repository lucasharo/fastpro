// Issue 46 (H-033) | T-03, T-07, T-15 (parcial), T-18, T-19 e T-20 (mapeamento) em nivel de rota e de publicacao
// (docs/factory/129-DESENHO-H033.md, §6, §7, §8). Sem banco, sem rede: porta fake do contato e do pedido.
// O numero sentinela e montado por concatenacao: nao aparece inteiro no codigo.
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createPhoneVault } from '../src/contact/phone-crypto.js';
import { handleContactRoute, type ContactRouteOptions } from '../src/contact/contact-route.js';
import { publishRequest, type PublishServiceDeps } from '../src/requests/publish-service.js';
import { PEDIDO_NAO_ENCONTRADO_BODY } from '../src/requests/detail-service.js';
import { STEP_UP_WINDOW_SECONDS } from '@fastpro/domain';

// A geocodificacao permanente nao e chamada aqui: ponto fixo, sem provedor externo.
vi.mock('../src/geo/permanent-geocode-service.js', () => ({
  ensurePermanentPoint: vi.fn(async () => ({ status: 'ok', pointId: '99999999-8888-4777-8666-555555555555' })),
}));

const CHAVE_CIFRA = 'h033-chave-de-teste-com-mais-de-32-caracteres-x';
const PEDIDO = '11111111-2222-4333-8444-555555555555';
const PROFISSIONAL = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const DONO = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const SENTINELA = '+55' + '11' + '9' + '8765' + '4321';
const ORIGEM = 'https://fastpro.example.test';
const AGORA = Date.UTC(2026, 10, 13, 12, 0, 0);
const COOKIE = '__Host-fp_sess=segredo-de-teste';

interface RespostaFake {
  status: number;
  headers: Record<string, string>;
  body: string;
  headersSent: boolean;
  writeHead(status: number, headers: Record<string, string>): void;
  end(body?: string): void;
}

function resposta(): RespostaFake {
  const r: RespostaFake = {
    status: 0,
    headers: {},
    body: '',
    headersSent: false,
    writeHead(status, headers) {
      r.status = status;
      r.headers = headers;
      r.headersSent = true;
    },
    end(body) {
      r.body = body ?? '';
    },
  };
  return r;
}

function opcoes(recentAuthAtMs: number | null, store: Record<string, unknown>): ContactRouteOptions {
  return {
    siteUrl: ORIGEM,
    sessions: { authenticate: vi.fn(async () => ({ userId: DONO, recentAuthAtMs })) },
    service: {
      store: store as never,
      phoneVault: createPhoneVault(CHAVE_CIFRA),
      clock: { nowMs: () => AGORA },
    },
  };
}

/** Dispara a rota com corpo (se houver) entregue depois que a rota comeca a ler. */
async function chamar(
  metodo: string,
  caminho: string,
  o: ContactRouteOptions,
  corpo?: string,
  cabecalhos: Record<string, string> = {},
): Promise<RespostaFake> {
  const req = Object.assign(new EventEmitter(), {
    method: metodo,
    url: caminho,
    headers: { cookie: COOKIE, origin: ORIGEM, 'sec-fetch-site': 'same-origin', ...cabecalhos },
    socket: { remoteAddress: '203.0.113.7' },
  });
  const res = resposta();
  const feito = handleContactRoute(req as never, res as never, caminho, o);
  setTimeout(() => {
    if (corpo !== undefined) req.emit('data', Buffer.from(corpo, 'utf8'));
    req.emit('end');
  }, 5);
  await feito;
  return res;
}

describe('T-19 | autenticacao recente nas rotas de efeito', () => {
  it('troca do telefone sem prova recente recebe 401 step_up_required e nada e gravado', async () => {
    const store = { replacePhone: vi.fn() };
    const r = await chamar('PUT', `/v1/requests/${PEDIDO}/phone`, opcoes(AGORA - (STEP_UP_WINDOW_SECONDS + 60) * 1000, store), '{"phone":null}');
    expect(r.status).toBe(401);
    expect(JSON.parse(r.body)).toEqual({ code: 'step_up_required' });
    expect(store.replacePhone).not.toHaveBeenCalled();
  });

  it('liberar e revogar sem prova recente recebem 401 e com prova passam', async () => {
    const store = {
      grantProfessional: vi.fn(async () => 'liberado'),
      revoke: vi.fn(async () => ({ revoked: 1, state: 'revogado' })),
    };
    const semProva = opcoes(null, store);
    const liberar = await chamar('POST', `/v1/requests/${PEDIDO}/contact/consents`, semProva, `{"professionalId":"${PROFISSIONAL}"}`);
    const revogar = await chamar('POST', `/v1/requests/${PEDIDO}/contact/revoke`, semProva, '{}');
    expect(liberar.status).toBe(401);
    expect(revogar.status).toBe(401);
    const comProva = opcoes(AGORA - 60_000, store);
    const liberou = await chamar('POST', `/v1/requests/${PEDIDO}/contact/consents`, comProva, `{"professionalId":"${PROFISSIONAL}"}`);
    expect(liberou.status).toBe(201);
    expect(store.grantProfessional).toHaveBeenCalledTimes(1);
  });
});

describe('T-20 e T-05 | limite de leituras e recusa uniforme', () => {
  it('estouro de leituras devolve 429 limite_de_leituras sem revelar', async () => {
    const store = { revealPhone: vi.fn(async () => ({ phoneEnc: null, limited: true })) };
    const r = await chamar('POST', `/v1/pro/requests/${PEDIDO}/phone/reveal`, opcoes(null, store));
    expect(r.status).toBe(429);
    expect(JSON.parse(r.body)).toEqual({ code: 'limite_de_leituras' });
  });

  it('negada ou sem direito: 404 com o mesmo corpo do pedido inexistente', async () => {
    const store = { revealPhone: vi.fn(async () => null) };
    const negada = await chamar('POST', `/v1/pro/requests/${PEDIDO}/phone/reveal`, opcoes(null, store));
    const invalido = await chamar('POST', '/v1/pro/requests/nao-e-uuid/phone/reveal', opcoes(null, store));
    expect(negada.status).toBe(404);
    expect(negada.body).toBe(JSON.stringify(PEDIDO_NAO_ENCONTRADO_BODY));
    expect(invalido.body).toBe(negada.body);
    expect(invalido.headers).toEqual(negada.headers);
  });

  it('revelacao autorizada devolve o numero so nesta resposta', async () => {
    const store = {
      revealPhone: vi.fn(async () => ({ phoneEnc: createPhoneVault(CHAVE_CIFRA).seal(SENTINELA, PEDIDO), limited: false })),
    };
    const r = await chamar('POST', `/v1/pro/requests/${PEDIDO}/phone/reveal`, opcoes(null, store));
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ phone: SENTINELA });
    expect(r.headers['Cache-Control']).toBe('no-store');
  });
});

describe('T-07 e T-15 | disponibilidade e varredura do numero', () => {
  it('disponibilidade falsa devolve phoneAvailable false, sem numero', async () => {
    const store = { availableForProfessional: vi.fn(async () => false) };
    const r = await chamar('GET', `/v1/pro/requests/${PEDIDO}/contact`, opcoes(null, store));
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ phoneAvailable: false });
  });

  it('estado do dono nunca traz o numero, mesmo com telefone presente', async () => {
    const store = {
      ownerStatus: vi.fn(async () => ({
        phonePresent: true,
        consents: [{ id: 'x', scope: 'todos_participantes', professionalId: null, grantedAt: '2026-11-13T12:00:00.000Z', grantedVia: 'formulario_pedido', revokedAt: null, revokedReason: null }],
      })),
    };
    const r = await chamar('GET', `/v1/requests/${PEDIDO}/contact`, opcoes(null, store));
    expect(r.status).toBe(200);
    expect(r.body.includes(SENTINELA)).toBe(false);
    expect(JSON.parse(r.body)).toEqual({
      phonePresent: true,
      consents: [{ scope: 'todos_participantes', grantedAt: '2026-11-13T12:00:00.000Z', grantedVia: 'formulario_pedido' }],
    });
  });

  it('revogar quem so esta coberto pelo geral devolve 409 exige_revogar_geral', async () => {
    const store = { revoke: vi.fn(async () => ({ revoked: 0, state: 'exige_revogar_geral' })) };
    const r = await chamar('POST', `/v1/requests/${PEDIDO}/contact/revoke`, opcoes(AGORA, store), `{"professionalId":"${PROFISSIONAL}"}`);
    expect(r.status).toBe(409);
    expect(JSON.parse(r.body)).toEqual({ code: 'exige_revogar_geral' });
  });
});

describe('seguranca de entrada das rotas de contato', () => {
  it('mutacao de outra origem recebe 403 antes de qualquer leitura', async () => {
    const store = { replacePhone: vi.fn() };
    const r = await chamar('PUT', `/v1/requests/${PEDIDO}/phone`, opcoes(AGORA, store), '{"phone":null}', { origin: 'https://atacante.example.test' });
    expect(r.status).toBe(403);
    expect(store.replacePhone).not.toHaveBeenCalled();
  });

  it('corpo com chave fora da lista fechada recebe 422', async () => {
    const store = { grantProfessional: vi.fn() };
    const r = await chamar('POST', `/v1/requests/${PEDIDO}/contact/consents`, opcoes(AGORA, store), `{"professionalId":"${PROFISSIONAL}","extra":1}`);
    expect(r.status).toBe(422);
    expect(store.grantProfessional).not.toHaveBeenCalled();
  });

  it('sem cookie de sessao: 401 sessao_necessaria', async () => {
    const r = await chamar('GET', `/v1/requests/${PEDIDO}/contact`, opcoes(null, {}), undefined, { cookie: '' });
    expect(r.status).toBe(401);
    expect(JSON.parse(r.body)).toEqual({ code: 'sessao_necessaria' });
  });
});

describe('T-03 e T-18 | telefone na publicacao (validacao antes do banco)', () => {
  function depsPublicacao(telefone: PublishServiceDeps['telefone']) {
    const store = {
      begin: vi.fn(async () => ({ status: 'ok', addressText: 'Rua de teste, 1', pedido: null })),
      commit: vi.fn(async () => ({ status: 'criado', pedido: { id: PEDIDO, publishedAt: 'x', acceptanceDeadlineAt: 'y' } })),
      abort: vi.fn(async () => true),
    };
    const deps = {
      store,
      geo: {} as never,
      hasher: { secretHash: () => 'h' } as never,
      chave: 'c'.repeat(40),
      rateKey: (f: string, i: string) => `${f}:${i}`,
      clock: { nowMs: () => AGORA },
      addressVault: { seal: () => Buffer.from('a'), open: () => 'x' } as never,
      phoneVault: { seal: () => Buffer.from('a'), open: () => 'x' } as never,
      novoId: () => PEDIDO,
      telefone,
    } as unknown as PublishServiceDeps;
    return { store, deps };
  }
  const entrada = (body: Record<string, unknown>) => ({
    body: { draftId: '22222222-3333-4444-8555-666666666666', contentRev: 0, ...body } as never,
    idemKey: ['idem', 'teste', '0001'].join('-'),
    secret: 'segredo-rascunho',
    userId: DONO,
    ip: '203.0.113.7',
  });

  it('sharePhone sem phone: 400 telefone_necessario e o banco nao e chamado', async () => {
    const { store, deps } = depsPublicacao(undefined);
    const r = await publishRequest(entrada({ sharePhone: true }), deps);
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body)).toEqual({ code: 'telefone_necessario' });
    expect(store.begin).not.toHaveBeenCalled();
  });

  it('telefone com cifra ausente: 503 antes do banco', async () => {
    const { store, deps } = depsPublicacao(undefined);
    const r = await publishRequest(entrada({ phone: SENTINELA }), deps);
    expect(r.status).toBe(503);
    expect(store.begin).not.toHaveBeenCalled();
  });

  it('telefone invalido: 422 antes do banco; sem telefone a publicacao segue', async () => {
    const { store, deps } = depsPublicacao(undefined);
    const invalido = await publishRequest(entrada({ phone: 'abc' }), deps);
    expect(invalido.status).toBe(422);
    expect(store.begin).not.toHaveBeenCalled();
    const semTelefone = await publishRequest(entrada({}), deps);
    expect(semTelefone.status).toBe(201);
  });

  it('com telefone e sharePhone: o anexo grava uma liberacao geral v1 depois do commit', async () => {
    const attach = vi.fn(async () => 'consentimento_ativo');
    const { store, deps } = depsPublicacao({ store: { attachPhone: attach } as never, cofre: createPhoneVault(CHAVE_CIFRA) });
    const r = await publishRequest(entrada({ phone: SENTINELA, sharePhone: true }), deps);
    expect(r.status).toBe(201);
    expect(store.commit).toHaveBeenCalledTimes(1);
    expect(attach).toHaveBeenCalledWith(DONO, PEDIDO, expect.any(Buffer), true, 'v1', AGORA);
    expect(r.body.includes(SENTINELA)).toBe(false);
  });
});
