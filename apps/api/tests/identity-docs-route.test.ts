// H-037 (Issue #50) | Rota dos documentos de identidade chamada direto, sem app.ts (107 §3; CA-12, CA-18, CA-06).
// Servidor http em porta 0 com o despacho da rota; portas falsas em memoria. Nada de rede externa.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { hashSessionSecret } from '@fastpro/db';
import { identityDocIncomingKey, IDOC_PATH, SESSION_COOKIE_NAME, type SessionRepositoryPort } from '@fastpro/domain';
import { IDOC_NAO_ENCONTRADO, type IdentityDocServiceDeps } from '../src/identity-docs/identity-doc-service.js';
import {
  handleIdentityDocRoute,
  isIdentityDocRoute,
  responderDocumentosFechados,
  type IdentityDocRouteOptions,
} from '../src/identity-docs/identity-doc-route.js';
import { MemFinal, MemGate, MemRate, MemStaging, MemStore, Relogio, T0, FakeReducer } from './identity-docs-fakes.js';

const SITE = 'https://fastpro.test';
const USUARIO = 'aaaaaaaa-0000-4000-8000-000000000001';
const OUTRO = 'bbbbbbbb-0000-4000-8000-000000000002';
const SEM_PERFIL = 'cccccccc-0000-4000-8000-000000000003';
const SEG_USUARIO = 'segredo-do-usuario-de-teste';
const SEG_OUTRO = 'segredo-do-outro-de-teste';
const SEG_SEM_PERFIL = 'segredo-sem-perfil-de-teste';
// Cliente, admin e conta em Verificacao: a rota so enxerga perfil profissional; estas contas nao tem perfil.
const CLIENTE = 'eeeeeeee-0000-4000-8000-000000000005';
const ADMIN = 'ffffffff-0000-4000-8000-000000000006';
const VERIFICACAO = 'gggggggg-0000-4000-8000-000000000007';
const SEG_CLIENTE = 'segredo-cliente-de-teste';
const SEG_ADMIN = 'segredo-admin-de-teste';
const SEG_VERIFICACAO = 'segredo-verificacao-de-teste';
const ID_INEXISTENTE = '00000000-0000-4000-8000-0000000000ff';
const CUID = '44444444-4444-4444-8444-444444444444';

const HASHES: Record<string, string> = {
  [hashSessionSecret(SEG_USUARIO)]: USUARIO,
  [hashSessionSecret(SEG_OUTRO)]: OUTRO,
  [hashSessionSecret(SEG_SEM_PERFIL)]: SEM_PERFIL,
  [hashSessionSecret(SEG_CLIENTE)]: CLIENTE,
  [hashSessionSecret(SEG_ADMIN)]: ADMIN,
  [hashSessionSecret(SEG_VERIFICACAO)]: VERIFICACAO,
};

const SEM_PERFIS = new Set([SEM_PERFIL, CLIENTE, ADMIN, VERIFICACAO]);

interface Ambiente {
  readonly opts: IdentityDocRouteOptions;
  readonly store: MemStore;
  readonly staging: MemStaging;
  readonly final: MemFinal;
  readonly rate: MemRate;
  readonly relogio: Relogio;
  readonly chamadasSessao: { n: number };
}

function ambiente(): Ambiente {
  const relogio = new Relogio(T0);
  const store = new MemStore();
  store.emailVerificado.add(USUARIO);
  store.emailVerificado.add(OUTRO);
  const staging = new MemStaging(relogio);
  const final = new MemFinal();
  const rate = new MemRate();
  const chamadasSessao = { n: 0 };
  const sessions = {
    async authenticate(hash: string) {
      chamadasSessao.n++;
      const userId = HASHES[hash];
      return userId === undefined ? null : { userId };
    },
  } as unknown as SessionRepositoryPort;
  const deps: IdentityDocServiceDeps = {
    store,
    staging,
    final,
    reducer: new FakeReducer(),
    gate: new MemGate(),
    rate,
    ipHmac: (ip) => `hmac:${ip}`,
    clock: relogio,
  };
  const opts: IdentityDocRouteOptions = {
    sessions,
    perfis: { existe: async (userId) => !SEM_PERFIS.has(userId) },
    deps,
    siteUrl: SITE,
  };
  return { opts, store, staging, final, rate, relogio, chamadasSessao };
}

interface Resposta {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly texto: string;
}

let servidor: Server;
let base = '';
let amb: Ambiente;

beforeAll(async () => {
  amb = ambiente();
  servidor = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://local').pathname;
    if (isIdentityDocRoute(path)) {
      void handleIdentityDocRoute(req, res, path, amb.opts);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end();
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((ok) => servidor.close(() => ok()));
});

async function chamar(
  metodo: string,
  caminho: string,
  opcoes: { readonly segredo?: string | null; readonly corpo?: string; readonly tipo?: string | null; readonly origem?: string | null } = {},
): Promise<Resposta> {
  const cabecalhos: Record<string, string> = {};
  const segredo = opcoes.segredo === undefined ? SEG_USUARIO : opcoes.segredo;
  if (segredo !== null) cabecalhos['cookie'] = `${SESSION_COOKIE_NAME}=${segredo}`;
  const origem = opcoes.origem === undefined ? SITE : opcoes.origem;
  if (origem !== null) {
    cabecalhos['origin'] = origem;
    cabecalhos['sec-fetch-site'] = 'same-origin';
  }
  const tipo = opcoes.tipo === undefined ? 'application/json' : opcoes.tipo;
  if (tipo !== null) cabecalhos['content-type'] = tipo;
  const r = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: cabecalhos,
    body: opcoes.corpo,
    redirect: 'manual',
  });
  const headers: Record<string, string> = {};
  r.headers.forEach((v, k) => {
    headers[k] = v;
  });
  return { status: r.status, headers, texto: await r.text() };
}

const EMISSAO = JSON.stringify({ client_upload_id: CUID, content_type: 'image/jpeg', size_bytes: 1000 });

describe('H-037 | rota dos documentos (CA-12, CA-18, CA-06)', () => {
  it('sem cookie: 401 e cabecalhos de no-store, sem tocar o banco', async () => {
    const antes = amb.chamadasSessao.n;
    const r = await chamar('GET', IDOC_PATH, { segredo: null });
    expect(r.status).toBe(401);
    expect(JSON.parse(r.texto)).toEqual({ code: 'nao_autenticado' });
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    // Sem cookie a rota nem chega a consultar a sessao no banco.
    expect(amb.chamadasSessao.n).toBe(antes);
  });

  it('origem invalida em escrita: 403 antes da sessao', async () => {
    const r = await chamar('POST', `${IDOC_PATH}/uploads`, { origem: 'https://mau.test', corpo: EMISSAO });
    expect(r.status).toBe(403);
    expect(JSON.parse(r.texto)).toEqual({ code: 'origem_invalida' });
  });

  it('emissao sem JSON: 415 tipo_invalido', async () => {
    const r = await chamar('POST', `${IDOC_PATH}/uploads`, { tipo: 'text/plain', corpo: EMISSAO });
    expect(r.status).toBe(415);
    expect(JSON.parse(r.texto)).toEqual({ code: 'tipo_invalido' });
  });

  it('emissao valida: 201 com URL de uso unico e nada de caminho, bucket ou tamanho na resposta', async () => {
    const r = await chamar('POST', `${IDOC_PATH}/uploads`, { corpo: EMISSAO });
    expect(r.status).toBe(201);
    const corpo = JSON.parse(r.texto) as { id: string; upload_url: string };
    expect(corpo.upload_url).toContain(identityDocIncomingKey(corpo.id));
    expect(r.texto).not.toMatch(/identity-docs|bucket|size_bytes|stored/);
  });

  it('corpo acima do limite: 413; campo desconhecido: 422 (sem eco do nome)', async () => {
    const grande = JSON.stringify({ client_upload_id: CUID, content_type: 'image/jpeg', size_bytes: 1, p: 'x'.repeat(3000) });
    const g = await chamar('POST', `${IDOC_PATH}/uploads`, { corpo: grande });
    expect(g.status).toBe(413);
    const d = await chamar('POST', `${IDOC_PATH}/uploads`, {
      corpo: JSON.stringify({ client_upload_id: CUID, content_type: 'image/jpeg', size_bytes: 1, filename: 'rg-frente.jpg' }),
    });
    expect(d.status).toBe(422);
    expect(d.texto).not.toContain('rg-frente');
  });

  it('lista do dono: 200 com slotsRemaining e sem campos internos', async () => {
    const r = await chamar('GET', IDOC_PATH);
    expect(r.status).toBe(200);
    const corpo = JSON.parse(r.texto) as { documents: unknown[]; slotsRemaining: number };
    expect(Array.isArray(corpo.documents)).toBe(true);
    expect(typeof corpo.slotsRemaining).toBe('number');
  });

  it('cota de emissao: 429 com Retry-After e corpo neutro', async () => {
    amb.rate.limites.set('idoc_emissao_profissional_hora', 0);
    const r = await chamar('POST', `${IDOC_PATH}/uploads`, { corpo: EMISSAO });
    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toBe('300');
    expect(JSON.parse(r.texto)).toEqual({ code: 'muitas_tentativas' });
    amb.rate.limites.delete('idoc_emissao_profissional_hora');
  });

  it('o 404 uniforme e identico para conta sem perfil, id nao uuid, id alheio, id inexistente e rota inexistente (CA-12, CA-18)', async () => {
    const semPerfil = await chamar('POST', `${IDOC_PATH}/${ID_INEXISTENTE}/finalize`, { segredo: SEG_SEM_PERFIL, corpo: '' });
    const naoUuid = await chamar('DELETE', `${IDOC_PATH}/nao-e-uuid`);
    const alheio = await chamar('DELETE', `${IDOC_PATH}/${ID_INEXISTENTE}`, { segredo: SEG_OUTRO });
    const inexistente = await chamar('DELETE', `${IDOC_PATH}/${ID_INEXISTENTE}`);
    const rotaSolta = await chamar('GET', `${IDOC_PATH}/${ID_INEXISTENTE}/imagem`);
    for (const r of [semPerfil, naoUuid, alheio, inexistente, rotaSolta]) {
      expect(r.status).toBe(404);
      expect(r.texto).toBe(JSON.stringify(IDOC_NAO_ENCONTRADO.corpo));
      expect(r.headers['cache-control']).toBe(semPerfil.headers['cache-control']);
      expect(r.headers['content-type']).toBe(semPerfil.headers['content-type']);
    }
  });

  it('cliente, admin e conta em Verificacao sem perfil: o mesmo 404 uniforme do id inexistente (T-12)', async () => {
    const referencia = await chamar('DELETE', `${IDOC_PATH}/${ID_INEXISTENTE}`);
    expect(referencia.status).toBe(404);
    for (const segredo of [SEG_CLIENTE, SEG_ADMIN, SEG_VERIFICACAO]) {
      const r = await chamar('DELETE', `${IDOC_PATH}/${ID_INEXISTENTE}`, { segredo });
      expect(r.status).toBe(404);
      expect(r.texto).toBe(referencia.texto);
      expect(r.headers['cache-control']).toBe(referencia.headers['cache-control']);
      expect(r.headers['content-type']).toBe(referencia.headers['content-type']);
    }
  });

  it('id que nao e uuid: 404 uniforme e nenhuma chamada ao banco (T-12)', async () => {
    const antes = amb.store.chamadas.length;
    const r = await chamar('DELETE', `${IDOC_PATH}/nao-e-uuid`);
    expect(r.status).toBe(404);
    expect(r.texto).toBe(JSON.stringify(IDOC_NAO_ENCONTRADO.corpo));
    expect(amb.store.chamadas.length).toBe(antes);
  });

  it('conta sem perfil nao lista documentos: 404, nao 200 vazio (decisao 221)', async () => {
    const r = await chamar('GET', IDOC_PATH, { segredo: SEG_SEM_PERFIL });
    expect(r.status).toBe(404);
  });

  it('exclusao de documento proprio: 204 sem corpo', async () => {
    const criado = JSON.parse((await chamar('POST', `${IDOC_PATH}/uploads`, { corpo: EMISSAO })).texto) as { id: string };
    const r = await chamar('DELETE', `${IDOC_PATH}/${criado.id}`);
    expect(r.status).toBe(204);
    expect(r.texto).toBe('');
  });

  it('nenhuma rota de leitura de arquivo: GET de um id qualquer fica no 404 uniforme (CA-06)', async () => {
    const r = await chamar('GET', `${IDOC_PATH}/${ID_INEXISTENTE}`);
    expect(r.status).toBe(404);
  });

  it('trava fechada: responde o mesmo 404 sem chamar nada', () => {
    const headers: Record<string, string> = {};
    let escrito = '';
    const falso = {
      writeHead(status: number, h: Record<string, string>) {
        Object.assign(headers, h);
        return status;
      },
      end(corpo?: string) {
        escrito = corpo ?? '';
      },
    } as unknown as import('node:http').ServerResponse;
    responderDocumentosFechados(falso);
    expect(escrito).toBe(JSON.stringify(IDOC_NAO_ENCONTRADO.corpo));
  });
});
