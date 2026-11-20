// Issue 71 (H-058) | Rota POST /v1/requests/:id/acceptances em HTTP (docs/factory/162-DESENHO-H058.md, §7: T-H058-01 a 06, 07 (rota), 28, 33, 34, A-8, A-10).
// Servidor HTTP real com a rota isolada e portas em memoria que seguem o contrato. Sem banco, sem rede externa.
// Segredos de teste montados por concatenacao (check:secrets). Relogio injetado; a rota nao registra corpo nem cookie.
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE_NAME, type RateWindowDecision } from '@fastpro/domain';
import { hashSessionSecret, type AcceptanceRequest, type AcceptanceResult } from '@fastpro/db';
import {
  handleAcceptanceRoute,
  isAcceptanceRoute,
  type AcceptanceRouteOptions,
} from '../src/requests/acceptance-route.js';
import { aceitarTrabalho } from '../src/requests/acceptance-service.js';

const PRO = '44444444-4444-4444-8444-444444444444';
const SEM_PERFIL = '66666666-6666-4666-8666-666666666666';
const PEDIDO = '11111111-1111-4111-8111-111111111111';
const PEDIDO_OUTRO = '22222222-2222-4222-8222-222222222222';
const CHAVE = '3f1c2b7e-8a4d-4c9e-9b1a-5d6e7f8a9b0c';
const AGORA = Date.UTC(2026, 10, 20, 12, 0, 0);
const SEG_PRO = ['sessao', 'pro', 'h058', '0000000000000000000000000000'].join('-');
const SEG_SEM = ['sessao', 'sem', 'h058', '0000000000000000000000000000'].join('-');
const SEG_INVALIDO = ['sessao', 'inexistente', 'h058', '0000000000000000000000000000'].join('-');
const SITE = 'https://fastpro.example.test';
const CABECALHOS_ESPERADOS = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'content-type': 'application/json; charset=utf-8',
};
const ENVELOPE_CRIADO = {
  acceptance: {
    id: '99999999-9999-4999-8999-999999999999',
    requestId: PEDIDO,
    slotNo: 1,
    wave: 1,
    status: 'ativo',
    acceptedAt: '2026-11-20T12:00:00.000Z',
  },
  conversation: { id: '77777777-7777-4777-8777-777777777777', state: 'ativa' },
  customer: { firstName: 'Carlos' },
} as const;

interface Mundo {
  agora: number;
  cotaBarrada: boolean;
  cotaRetry: number;
  cotasGravadas: number;
  chamadasStore: AcceptanceRequest[];
  resultado: AcceptanceResult;
  falhaBanco: boolean;
}

const mundo: Mundo = {
  agora: AGORA,
  cotaBarrada: false,
  cotaRetry: 17,
  cotasGravadas: 0,
  chamadasStore: [],
  resultado: { ok: true, status: 201, envelope: ENVELOPE_CRIADO },
  falhaBanco: false,
};

function opcoes(): AcceptanceRouteOptions {
  return {
    siteUrl: SITE,
    sessions: {
      authenticate: async (hash: string) => {
        if (hash === hashSessionSecret(SEG_PRO)) return { userId: PRO };
        if (hash === hashSessionSecret(SEG_SEM)) return { userId: SEM_PERFIL };
        return null;
      },
    },
    profissional: { existe: async (userId: string) => userId === PRO },
    limite: {
      check: async (): Promise<RateWindowDecision> =>
        mundo.cotaBarrada ? { decision: 'barrado', retryAfterSeconds: mundo.cotaRetry } : { decision: 'permitido' },
      record: async () => {
        mundo.cotasGravadas += 1;
      },
    },
    service: {
      store: {
        aceitar: async (input: AcceptanceRequest): Promise<AcceptanceResult> => {
          mundo.chamadasStore.push(input);
          if (mundo.falhaBanco) throw new Error('falha simulada com texto de driver');
          return mundo.resultado;
        },
      },
      clock: { nowMs: () => mundo.agora },
    },
  };
}

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const caminho = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (!isAcceptanceRoute(req.method ?? '', caminho)) {
      res.writeHead(404);
      res.end();
      return;
    }
    void handleAcceptanceRoute(req, res, caminho, opcoes());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  mundo.agora = AGORA;
  mundo.cotaBarrada = false;
  mundo.cotaRetry = 17;
  mundo.cotasGravadas = 0;
  mundo.chamadasStore = [];
  mundo.resultado = { ok: true, status: 201, envelope: ENVELOPE_CRIADO };
  mundo.falhaBanco = false;
});

interface Resposta {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly corpo: string;
}

interface Pedido {
  readonly caminho?: string;
  readonly metodo?: string;
  readonly cookie?: string | null;
  readonly chave?: string | null;
  readonly origem?: string | null;
  readonly contentType?: string | null;
  readonly corpo?: string;
}

function enviar(p: Pedido): Promise<Resposta> {
  const cabecalhos: Record<string, string> = {};
  if (p.cookie !== null) cabecalhos.cookie = p.cookie ?? `${SESSION_COOKIE_NAME}=${SEG_PRO}`;
  if (p.chave !== null) cabecalhos['idempotency-key'] = p.chave ?? CHAVE;
  if (p.origem !== null) cabecalhos.origin = p.origem ?? SITE;
  if (p.contentType !== null && p.contentType !== undefined) cabecalhos['content-type'] = p.contentType;
  if (p.corpo !== undefined) cabecalhos['content-length'] = String(Buffer.byteLength(p.corpo));
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      `${base}${p.caminho ?? `/v1/requests/${PEDIDO}/acceptances`}`,
      { method: p.metodo ?? 'POST', headers: cabecalhos },
      (res) => {
        let corpo = '';
        res.setEncoding('utf8');
        res.on('data', (parte: string) => (corpo += parte));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, corpo }));
      },
    );
    req.on('error', reject);
    if (p.corpo !== undefined) req.write(p.corpo);
    req.end();
  });
}

const json = (r: Resposta): Record<string, unknown> => JSON.parse(r.corpo) as Record<string, unknown>;

describe('H-058 rota POST /v1/requests/:id/acceptances', () => {
  it('reconhece so POST no caminho do pedido', () => {
    expect(isAcceptanceRoute('POST', `/v1/requests/${PEDIDO}/acceptances`)).toBe(true);
    expect(isAcceptanceRoute('GET', `/v1/requests/${PEDIDO}/acceptances`)).toBe(false);
    expect(isAcceptanceRoute('POST', `/v1/requests/${PEDIDO}/acceptances/extra`)).toBe(false);
    expect(isAcceptanceRoute('POST', `/v1/requests/${PEDIDO}`)).toBe(false);
  });

  it('T-H058-06: id malformado vira 404 sem tocar o banco', async () => {
    const r = await enviar({ caminho: '/v1/requests/nao-e-uuid/acceptances' });
    expect(r.status).toBe(404);
    expect(json(r)).toEqual({ code: 'pedido_nao_encontrado' });
    expect(mundo.chamadasStore).toHaveLength(0);
  });

  it('T-H058-01: sem cookie ou com sessao inexistente vira 401 sem escrita', async () => {
    const semCookie = await enviar({ cookie: null });
    expect(semCookie.status).toBe(401);
    expect(json(semCookie)).toEqual({ code: 'sessao_necessaria' });
    const invalida = await enviar({ cookie: `${SESSION_COOKIE_NAME}=${SEG_INVALIDO}` });
    expect(invalida.status).toBe(401);
    expect(mundo.chamadasStore).toHaveLength(0);
  });

  it('T-H058-02: usuario sem perfil profissional vira 403', async () => {
    const r = await enviar({ cookie: `${SESSION_COOKIE_NAME}=${SEG_SEM}` });
    expect(r.status).toBe(403);
    expect(json(r)).toEqual({ code: 'perfil_profissional_obrigatorio' });
    expect(mundo.chamadasStore).toHaveLength(0);
  });

  it('origem ausente ou de outro site vira 403 antes de qualquer outra checagem', async () => {
    expect((await enviar({ origem: null })).status).toBe(403);
    const outra = await enviar({ origem: 'https://outro.example.test' });
    expect(outra.status).toBe(403);
    expect(json(outra)).toEqual({ code: 'origem_invalida' });
    expect(mundo.chamadasStore).toHaveLength(0);
  });

  it('T-H058-04: chave ausente vira 400 obrigatoria; chave fora do formato UUID v4 vira 400 invalida', async () => {
    const ausente = await enviar({ chave: null });
    expect(ausente.status).toBe(400);
    expect(json(ausente)).toEqual({ code: 'chave_idempotencia_obrigatoria' });
    const invalida = await enviar({ chave: 'chave-invalida-123' });
    expect(invalida.status).toBe(400);
    expect(json(invalida)).toEqual({ code: 'chave_idempotencia_invalida' });
    // UUID de outra versao (v1) tambem e recusado: o contrato exige versao 4.
    const v1 = await enviar({ chave: '3f1c2b7e-8a4d-1c9e-9b1a-5d6e7f8a9b0c' });
    expect(json(v1)).toEqual({ code: 'chave_idempotencia_invalida' });
    expect(mundo.chamadasStore).toHaveLength(0);
  });

  it('T-H058-05: query presente vira 400 parametro_invalido', async () => {
    const r = await enviar({ caminho: `/v1/requests/${PEDIDO}/acceptances?x=1` });
    expect(r.status).toBe(400);
    expect(json(r)).toEqual({ code: 'parametro_invalido' });
  });

  it('T-H058-03: corpo com campos extras vira 422 e nada e gravado', async () => {
    for (const corpo of ['{"price":1}', '{"deadline_days":3}', '{"message":"oi"}', '{"attachment":"x"}', '[]', 'null']) {
      const r = await enviar({ corpo, contentType: 'application/json' });
      expect(r.status, corpo).toBe(422);
      expect(json(r), corpo).toEqual({ code: 'campos_extras_recusados' });
    }
    expect(mundo.chamadasStore).toHaveLength(0);
  });

  it('T-H058-05: JSON malformado vira 400 corpo_invalido; corpo acima de 1 KiB tambem', async () => {
    const malformado = await enviar({ corpo: '{nao-json', contentType: 'application/json' });
    expect(malformado.status).toBe(400);
    expect(json(malformado)).toEqual({ code: 'corpo_invalido' });
    const grande = await enviar({ corpo: `{"x":"${'a'.repeat(1100)}"}`, contentType: 'application/json' });
    expect(grande.status).toBe(400);
    expect(json(grande)).toEqual({ code: 'corpo_invalido' });
  });

  it('A-10: corpo com Content-Type que nao e JSON vira 400; corpo vazio sem Content-Type e aceito', async () => {
    const texto = await enviar({ corpo: '{}', contentType: 'text/plain' });
    expect(texto.status).toBe(400);
    expect(json(texto)).toEqual({ code: 'corpo_invalido' });
    const vazio = await enviar({});
    expect(vazio.status).toBe(201);
    const vazioComJson = await enviar({ corpo: '', contentType: 'application/json' });
    expect(vazioComJson.status).toBe(201);
  });

  it('T-H058-07 (rota): primeiro aceite vira 201 com o envelope fixo e cabecalhos de privacidade', async () => {
    const r = await enviar({});
    expect(r.status).toBe(201);
    expect(json(r)).toEqual(ENVELOPE_CRIADO);
    for (const [nome, valor] of Object.entries(CABECALHOS_ESPERADOS)) expect(r.headers[nome]).toBe(valor);
    expect(mundo.cotasGravadas).toBe(1);
  });

  it('T-H058-28: o envelope nao traz email, telefone, sobrenome, endereco, contador nem onda do pedido', async () => {
    const r = await enviar({});
    const texto = r.corpo.toLowerCase();
    for (const proibido of ['email', 'telefone', 'phone', 'sobrenome', 'address', 'endereco', 'acceptances_count', 'wave2', 'deadline']) {
      expect(texto.includes(proibido), proibido).toBe(false);
    }
    expect(json(r)).toEqual(ENVELOPE_CRIADO);
  });

  it('replay devolve 200 com a mesma resposta; aceite existente tambem vira 200', async () => {
    mundo.resultado = { ok: true, status: 200, envelope: ENVELOPE_CRIADO };
    const r = await enviar({});
    expect(r.status).toBe(200);
    expect(json(r)).toEqual(ENVELOPE_CRIADO);
  });

  it('repassa ao servico o id do pedido, o id do profissional, a chave em minusculas e um unico instante', async () => {
    await enviar({ chave: CHAVE.toUpperCase() });
    expect(mundo.chamadasStore).toHaveLength(1);
    const [entrada] = mundo.chamadasStore;
    expect(entrada?.requestId).toBe(PEDIDO);
    expect(entrada?.professionalId).toBe(PRO);
    expect(entrada?.key).toBe(CHAVE);
    expect(entrada?.now.toISOString()).toBe(new Date(AGORA).toISOString());
  });

  it('sem_vagas e admissao_encerrada saem com 409 e mensagem neutra, sem contadores', async () => {
    const msg = 'O pedido não está mais disponível para novos atendimentos.';
    mundo.resultado = { ok: false, status: 409, code: 'sem_vagas', message: msg };
    const cheio = await enviar({});
    expect(cheio.status).toBe(409);
    expect(json(cheio)).toEqual({ code: 'sem_vagas', message: msg });
    mundo.resultado = { ok: false, status: 409, code: 'admissao_encerrada', message: msg };
    const encerrado = await enviar({});
    expect(json(encerrado)).toEqual({ code: 'admissao_encerrada', message: msg });
  });

  it('inelegivel, autoaceite e casamento recusados saem sem motivo, e so com o codigo', async () => {
    mundo.resultado = { ok: false, status: 403, code: 'profissional_inelegivel' };
    const r = await enviar({});
    expect(r.status).toBe(403);
    expect(json(r)).toEqual({ code: 'profissional_inelegivel' });
  });

  it('operacao_em_andamento e contencao_temporaria saem com 409 e Retry-After: 1', async () => {
    mundo.resultado = { ok: false, status: 409, code: 'operacao_em_andamento', retryAfterSeconds: 1 };
    const em = await enviar({});
    expect(em.status).toBe(409);
    expect(em.headers['retry-after']).toBe('1');
    mundo.resultado = { ok: false, status: 409, code: 'contencao_temporaria', retryAfterSeconds: 1 };
    const cont = await enviar({});
    expect(json(cont)).toEqual({ code: 'contencao_temporaria' });
    expect(cont.headers['retry-after']).toBe('1');
  });

  it('chave reutilizada em outro pedido vira 422 sem escrita', async () => {
    mundo.resultado = { ok: false, status: 422, code: 'chave_reutilizada_com_corpo_diferente' };
    const r = await enviar({ caminho: `/v1/requests/${PEDIDO_OUTRO}/acceptances` });
    expect(r.status).toBe(422);
    expect(json(r)).toEqual({ code: 'chave_reutilizada_com_corpo_diferente' });
  });

  it('T-H058-34: a 21a requisicao no minuto vira 429 com Retry-After, sem chamar o servico', async () => {
    mundo.cotaBarrada = true;
    mundo.cotaRetry = 23;
    const r = await enviar({});
    expect(r.status).toBe(429);
    expect(json(r)).toEqual({ code: 'muitas_requisicoes' });
    expect(r.headers['retry-after']).toBe('23');
    expect(mundo.chamadasStore).toHaveLength(0);
    expect(mundo.cotasGravadas).toBe(0);
  });

  it('T-H058-33: nenhum texto de resposta diz que o aceite nao e contrato', async () => {
    const respostas = [
      await enviar({}),
      await enviar({ corpo: '{"x":1}', contentType: 'application/json' }),
      await enviar({ chave: null }),
    ];
    for (const r of respostas) {
      const texto = r.corpo.toLowerCase();
      expect(texto.includes('não é contrato') || texto.includes('nao e contrato')).toBe(false);
      expect(texto.includes('apenas conecta')).toBe(false);
    }
  });

  it('falha que escapa do adaptador vira 503 fixo, sem texto de erro', async () => {
    mundo.falhaBanco = true;
    const r = await enviar({});
    expect(r.status).toBe(503);
    expect(json(r)).toEqual({ code: 'servico_indisponivel' });
    expect(r.corpo.includes('falha simulada')).toBe(false);
  });
});

describe('aceitarTrabalho (servico)', () => {
  it('le o relogio uma vez e passa o mesmo instante ao adaptador', async () => {
    let leituras = 0;
    const recebidos: AcceptanceRequest[] = [];
    const resultado = await aceitarTrabalho(
      { requestId: PEDIDO, professionalId: PRO, key: CHAVE },
      {
        store: {
          aceitar: async (input) => {
            recebidos.push(input);
            return { ok: true, status: 201, envelope: ENVELOPE_CRIADO };
          },
        },
        clock: {
          nowMs: () => {
            leituras += 1;
            return AGORA;
          },
        },
      },
    );
    expect(resultado.ok).toBe(true);
    expect(leituras).toBe(1);
    expect(recebidos[0]?.now.getTime()).toBe(AGORA);
  });
});
