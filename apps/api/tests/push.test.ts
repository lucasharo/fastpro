// Push: cifra pelo vetor da RFC 8291, VAPID, lista de destinos, rotas e envio. Portas falsas; sem rede nem banco.
import { createECDH, createPublicKey, verify } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE_NAME } from '@fastpro/domain';
import type { AlvoPush } from '@fastpro/db';
import { handlePushRoute, lerAparelho, type PushRouteOptions } from '../src/push/push-route.js';
import { EXPO_PUSH_URL, PushPedidoNovoHandler, PushSendHandler } from '../src/push/push-envio.js';
import { autorizacaoVapid, cifrar, endpointAceito } from '../src/push/web-push.js';

// RFC 8291, apendice A.
const RFC = {
  texto: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  efemera: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  sal: 'DGv6ra1nlYgDCS1FRnbzlw',
  corpo:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

const ITEM = '11111111-1111-4111-8111-111111111111';
const PEDIDO = '22222222-2222-4222-8222-222222222222';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc';
const EXPO = 'ExponentPushToken[abc123]';

function parVapid() {
  const e = createECDH('prime256v1');
  e.generateKeys();
  return { publica: e.getPublicKey().toString('base64url'), privada: e.getPrivateKey().toString('base64url'), assunto: 'mailto:a@b.test' };
}

describe('web push', () => {
  it('cifra igual ao vetor da RFC 8291', () => {
    const corpo = cifrar(Buffer.from(RFC.texto, 'base64url'), RFC, { efemera: RFC.efemera, sal: RFC.sal });
    expect(corpo.toString('base64url')).toBe(RFC.corpo);
  });

  it('assina o VAPID com a chave do servidor', () => {
    const chaves = parVapid();
    const cabecalho = autorizacaoVapid(ENDPOINT, chaves, 0);
    const jwt = /t=([^,]+),/.exec(cabecalho)?.[1] ?? '';
    const [h = '', c = '', s = ''] = jwt.split('.');
    const p = Buffer.from(chaves.publica, 'base64url');
    const publica = createPublicKey({
      format: 'jwk',
      key: { kty: 'EC', crv: 'P-256', x: p.subarray(1, 33).toString('base64url'), y: p.subarray(33).toString('base64url') },
    });
    expect(verify('sha256', Buffer.from(`${h}.${c}`), { key: publica, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))).toBe(true);
    expect(JSON.parse(Buffer.from(c, 'base64url').toString())).toMatchObject({ aud: 'https://fcm.googleapis.com', exp: 43200 });
  });

  it('so aceita servicos de push conhecidos', () => {
    expect(endpointAceito(ENDPOINT)).toBe(true);
    expect(endpointAceito('https://web.push.apple.com/x')).toBe(true);
    for (const e of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://fcm.googleapis.com.evil.test/x', 'https://a@fcm.googleapis.com/x', 'x']) {
      expect(endpointAceito(e)).toBe(false);
    }
  });

  it('valida o aparelho de cada plataforma', () => {
    expect(lerAparelho({ platform: 'ios', token: EXPO })?.platform).toBe('ios');
    expect(lerAparelho({ platform: 'web', token: ENDPOINT, keys: { p256dh: RFC.p256dh, auth: RFC.auth } })?.platform).toBe('web');
    expect(lerAparelho({ platform: 'android', token: 'qualquer' })).toBeNull();
    expect(lerAparelho({ platform: 'web', token: ENDPOINT })).toBeNull();
  });
});

describe('rotas de aparelho', () => {
  const ORIGEM = 'http://site.test';
  const chamadas: string[] = [];
  const opts: PushRouteOptions = {
    siteUrl: ORIGEM,
    webPublicKey: 'chave-publica',
    sessions: { authenticate: async () => ({ userId: 'u1' }) },
    store: {
      registrar: async (u, a) => {
        chamadas.push(`registrar ${u} ${a.platform}`);
        return true;
      },
      remover: async (u) => {
        chamadas.push(`remover ${u}`);
        return false;
      },
    },
    clock: { nowMs: () => 0 },
  };
  let servidor: Server;
  let base = '';
  beforeAll(async () => {
    servidor = createServer((req, res) => void handlePushRoute(req, res, req.url ?? '', opts));
    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => void servidor.close(() => r())));
  beforeEach(() => void (chamadas.length = 0));

  const logado = { cookie: `${SESSION_COOKIE_NAME}=segredo`, origin: ORIGEM, 'content-type': 'application/json' };
  const post = (caminho: string, corpo: unknown, headers: Record<string, string> = logado) =>
    fetch(`${base}${caminho}`, { method: 'POST', headers, body: JSON.stringify(corpo) });

  it('config e publica; registro exige origem e sessao', async () => {
    expect(await (await fetch(`${base}/v1/push/config`)).json()).toEqual({ webPublicKey: 'chave-publica' });
    const corpo = { platform: 'android', token: EXPO };
    expect((await post('/v1/push/devices', corpo)).status).toBe(204);
    expect((await post('/v1/push/devices', corpo, { ...logado, origin: 'http://outro.test' })).status).toBe(403);
    expect((await post('/v1/push/devices', corpo, { origin: ORIGEM, 'content-type': 'application/json' })).status).toBe(401);
    expect((await post('/v1/push/devices', { platform: 'android', token: 'x' })).status).toBe(422);
    expect((await post('/v1/push/devices/remove', { token: EXPO })).status).toBe(204);
    expect(chamadas).toEqual(['registrar u1 android', 'remover u1']);
  });
});

describe('envio do push', () => {
  const alvo = (extra: Partial<AlvoPush>): AlvoPush => ({
    emailType: 'aceite_aviso',
    scopeKey: PEDIDO,
    platform: 'android',
    token: EXPO,
    p256dh: null,
    auth: null,
    ...extra,
  });
  const job = { id: 'j', kind: 'push.send', payload_ref: ITEM, attempts: 1 };

  function montar(alvos: AlvoPush[], responder: (url: string) => Response) {
    const chamadas: string[] = [];
    const descartados: string[] = [];
    const handler = new PushSendHandler({
      store: { alvosDoItem: async () => alvos, alvosDoPedidoNovo: async () => alvos.map((a) => ({ ...a, servico: 'Pintura' })), descartar: async (t) => void descartados.push(t) },
      vapid: parVapid(),
      fetchImpl: async (url) => {
        chamadas.push(String(url));
        return responder(String(url));
      },
    });
    return { handler, chamadas, descartados };
  }

  it('entrega web e nativo; inscricao vencida e descartada', async () => {
    const web = alvo({ platform: 'web', token: ENDPOINT, p256dh: RFC.p256dh, auth: RFC.auth });
    const { handler, chamadas, descartados } = montar([alvo({}), web], (url) =>
      url === EXPO_PUSH_URL ? Response.json({ data: { status: 'ok' } }) : new Response(null, { status: 410 }),
    );
    await handler.run(job);
    expect(chamadas.sort()).toEqual([EXPO_PUSH_URL, ENDPOINT].sort());
    expect(descartados).toEqual([ENDPOINT]);
  });

  it('aparelho desinstalado e descartado sem falhar o job', async () => {
    const { handler, descartados } = montar([alvo({})], () =>
      Response.json({ data: { status: 'error', details: { error: 'DeviceNotRegistered' } } }),
    );
    await handler.run(job);
    expect(descartados).toEqual([EXPO]);
  });

  it('pedido novo avisa com o servico e o link do pedido', async () => {
    const corpos: string[] = [];
    await new PushPedidoNovoHandler({
      store: {
        alvosDoItem: async () => [],
        alvosDoPedidoNovo: async () => [{ ...alvo({}), servico: 'Pintura' }],
        descartar: async () => undefined,
      },
      fetchImpl: async (_url, init) => {
        corpos.push(String(init?.body));
        return Response.json({ data: { status: 'ok' } });
      },
    }).run({ ...job, kind: 'push.request', payload_ref: PEDIDO });
    expect(JSON.parse(corpos[0] ?? '')).toMatchObject({
      title: 'Novo pedido na sua região',
      body: 'Há um pedido de Pintura. Veja e aceite.',
      data: { caminho: `/profissional/pedidos/${PEDIDO}` },
    });
  });

  it('falha total pede nova tentativa; tipo sem push nao chama nada', async () => {
    await expect(montar([alvo({})], () => new Response(null, { status: 500 })).handler.run(job)).rejects.toThrow();
    const mudo = montar([alvo({ emailType: 'mensagem_aviso' })], () => new Response(null));
    await mudo.handler.run(job);
    expect(mudo.chamadas).toEqual([]);
  });
});
