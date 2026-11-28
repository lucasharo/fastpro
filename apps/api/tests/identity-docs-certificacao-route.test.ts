// H-038 (Issue 51) | Rota das certificacoes chamada direto, sem app.ts (docs/factory/148-DESENHO-H038.md, §4 e §6:
// T-07, T-08, T-11 (HTTP), T-14). Reaproveita a rota da Issue 50 com kind='certificacao' e service_id.
// Servidor em porta 0 com o despacho da rota; portas falsas em memoria. Nada de rede externa.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { hashSessionSecret } from '@fastpro/db';
import { identityDocIncomingKey, IDOC_PATH, SESSION_COOKIE_NAME, type SessionRepositoryPort } from '@fastpro/domain';
import { type IdentityDocServiceDeps } from '../src/identity-docs/identity-doc-service.js';
import {
  handleIdentityDocRoute,
  isIdentityDocRoute,
  responderDocumentosFechados,
  type IdentityDocRouteOptions,
} from '../src/identity-docs/identity-doc-route.js';
import { FakeReducer, JPEG_FAKE, MemFinal, MemGate, MemRate, MemStaging, MemStore, PDF_VALIDO, Relogio, T0 } from './identity-docs-fakes.js';

const SITE = 'https://fastpro.test';
const USUARIO = 'aaaaaaaa-0000-4000-8000-000000000001';
const SEG_USUARIO = 'segredo-do-usuario-de-teste-cert';
const SERVICO_REG = '7a1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const SERVICO_REG_2 = '8b2a3d4e-5f60-4b7c-9d8e-0f1a2b3c4d5e';
const SERVICO_SEM_VINCULO = '9c3b4e5f-6071-4c8d-8e9f-1a2b3c4d5e6f';
const ID_INEXISTENTE = '00000000-0000-4000-8000-0000000000ff';
const MIB = 1024 * 1024;

const HASHES: Record<string, string> = { [hashSessionSecret(SEG_USUARIO)]: USUARIO };

/** PNG sintetico: assinatura de 8 bytes e bloco IHDR de 13 bytes (o que o detector da Issue 50 exige). */
const PNG = (tamanho: number): Uint8Array => {
  const b = new Uint8Array(tamanho);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d], 0);
  b.set(new TextEncoder().encode('IHDR'), 12);
  return b;
};
/** WebP sintetico: contêiner RIFF, marca WEBP e primeiro chunk VP8 (o que o detector exige). */
const WEBP = (tamanho: number): Uint8Array => {
  const b = new Uint8Array(tamanho);
  b.set(new TextEncoder().encode('RIFF'), 0);
  b.set(new TextEncoder().encode('WEBP'), 8);
  b.set(new TextEncoder().encode('VP8 '), 12);
  return b;
};
const GIF = (tamanho: number): Uint8Array => {
  const b = new Uint8Array(tamanho);
  b.set(new TextEncoder().encode('GIF89a'), 0);
  return b;
};

interface Ambiente {
  readonly opts: IdentityDocRouteOptions;
  readonly store: MemStore;
  readonly staging: MemStaging;
  readonly final: MemFinal;
  readonly reducer: FakeReducer;
  readonly relogio: Relogio;
}

function ambiente(): Ambiente {
  const relogio = new Relogio(T0);
  const store = new MemStore();
  store.emailVerificado.add(USUARIO);
  store.vinculosRegulados.add(`${USUARIO}|${SERVICO_REG}`);
  store.vinculosRegulados.add(`${USUARIO}|${SERVICO_REG_2}`);
  const staging = new MemStaging(relogio);
  const final = new MemFinal();
  const reducer = new FakeReducer();
  const sessions = {
    async authenticate(hash: string) {
      const userId = HASHES[hash];
      return userId === undefined ? null : { userId };
    },
  } as unknown as SessionRepositoryPort;
  const deps: IdentityDocServiceDeps = {
    store,
    staging,
    final,
    reducer,
    gate: new MemGate(),
    rate: new MemRate(),
    ipHmac: (ip) => `hmac:${ip}`,
    clock: relogio,
  };
  const opts: IdentityDocRouteOptions = { sessions, perfis: { existe: async () => true }, deps, siteUrl: SITE };
  return { opts, store, staging, final, reducer, relogio };
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
  opcoes: { readonly corpo?: string; readonly tipo?: string | null } = {},
): Promise<Resposta> {
  const cabecalhos: Record<string, string> = {
    cookie: `${SESSION_COOKIE_NAME}=${SEG_USUARIO}`,
    origin: SITE,
    'sec-fetch-site': 'same-origin',
  };
  const tipo = opcoes.tipo === undefined ? 'application/json' : opcoes.tipo;
  if (tipo !== null) cabecalhos['content-type'] = tipo;
  const r = await fetch(`${base}${caminho}`, { method: metodo, headers: cabecalhos, body: opcoes.corpo, redirect: 'manual' });
  const headers: Record<string, string> = {};
  r.headers.forEach((v, k) => {
    headers[k] = v;
  });
  return { status: r.status, headers, texto: await r.text() };
}

let seq = 0;
/** client_upload_id unico por emissao (uuid v4 sintetico). */
function cuid(): string {
  seq++;
  return `44444444-4444-4444-8444-${String(seq).padStart(12, '0')}`;
}

async function emitirCert(servico: string, tipo = 'image/jpeg', bytes = 1000): Promise<Resposta> {
  return chamar('POST', `${IDOC_PATH}/uploads`, {
    corpo: JSON.stringify({ client_upload_id: cuid(), content_type: tipo, size_bytes: bytes, kind: 'certificacao', service_id: servico }),
  });
}

/** Emite, envia o original para a entrada e finaliza. Devolve o id e a resposta da finalizacao. */
async function enviarCert(
  servico: string,
  bytes: Uint8Array,
  tipo: string,
): Promise<{ readonly id: string; readonly fim: Resposta }> {
  const emissao = await emitirCert(servico, tipo, bytes.length);
  expect(emissao.status).toBe(201);
  const id = (JSON.parse(emissao.texto) as { id: string }).id;
  amb.staging.enviarEntrada(identityDocIncomingKey(id), bytes);
  const fim = await chamar('POST', `${IDOC_PATH}/${id}/finalize`, { corpo: '' });
  return { id, fim };
}

const sha = (b: Uint8Array): Buffer => createHash('sha256').update(b).digest();

describe('H-038 | certificacao: emissao (CA-02, CA-06, CA-07)', () => {
  it('servico regulamentado vinculado: 201 com id e URL de envio, sem o valor do servico na resposta', async () => {
    const r = await emitirCert(SERVICO_REG);
    expect(r.status).toBe(201);
    const corpo = JSON.parse(r.texto) as { id: string; upload_url: string };
    expect(corpo.upload_url).toContain(identityDocIncomingKey(corpo.id));
    expect(r.texto).not.toContain(SERVICO_REG);
    // Libera a reserva pendente deste teste para nao limitar os envios seguintes do mesmo servico.
    const liberada = await chamar('DELETE', `${IDOC_PATH}/${corpo.id}`, { tipo: null });
    expect(liberada.status).toBe(204);
  });

  it('servico nao vinculado e servico inexistente respondem o mesmo 422 (sem enumeracao)', async () => {
    const nao = await emitirCert(SERVICO_SEM_VINCULO);
    const inexistente = await emitirCert(ID_INEXISTENTE);
    expect(nao.status).toBe(422);
    expect(inexistente.status).toBe(422);
    expect(nao.texto).toBe(inexistente.texto);
    expect(JSON.parse(nao.texto)).toEqual({ code: 'servico_invalido' });
  });

  it('identidade com service_id e certificacao sem service_id: 422 com codigo fixo', async () => {
    const id = await chamar('POST', `${IDOC_PATH}/uploads`, {
      corpo: JSON.stringify({ client_upload_id: cuid(), content_type: 'image/jpeg', size_bytes: 1000, service_id: SERVICO_REG }),
    });
    expect(id.status).toBe(422);
    expect(JSON.parse(id.texto)).toEqual({ code: 'service_id_incoerente' });
    const sem = await chamar('POST', `${IDOC_PATH}/uploads`, {
      corpo: JSON.stringify({ client_upload_id: cuid(), content_type: 'image/jpeg', size_bytes: 1000, kind: 'certificacao' }),
    });
    expect(sem.status).toBe(422);
    expect(JSON.parse(sem.texto)).toEqual({ code: 'service_id_ausente' });
  });

  it('uma reserva pendente por servico: o segundo envio para o mesmo servico recebe 422 limite_certificacao', async () => {
    const primeiro = await emitirCert(SERVICO_REG_2);
    expect(primeiro.status).toBe(201);
    const segundo = await emitirCert(SERVICO_REG_2);
    expect(segundo.status).toBe(422);
    expect(JSON.parse(segundo.texto)).toEqual({ code: 'limite_certificacao' });
  });

  it('GIF, SVG e executavel declarados como tipo de certificacao: 415 na emissao', async () => {
    for (const tipo of ['image/gif', 'image/svg+xml', 'application/x-msdownload']) {
      const r = await emitirCert(SERVICO_REG, tipo);
      expect(r.status, tipo).toBe(415);
    }
  });

  it('imagem acima de 5 MiB e PDF acima de 2 MiB na emissao: 413', async () => {
    expect((await emitirCert(SERVICO_REG, 'image/jpeg', 5 * MIB + 1)).status).toBe(413);
    expect((await emitirCert(SERVICO_REG, 'application/pdf', 2 * MIB + 1)).status).toBe(413);
  });
});

describe('H-038 | certificacao: finalizacao (T-07, CA-07)', () => {
  it('JPEG, PNG e WebP passam pelo mesmo reencode e viram imagem recebida', async () => {
    for (const [nome, bytes, tipo] of [
      ['jpeg', JPEG_FAKE(1000), 'image/jpeg'],
      ['png', PNG(1000), 'image/png'],
      ['webp', WEBP(1000), 'image/webp'],
    ] as const) {
      const { id, fim } = await enviarCert(SERVICO_REG, bytes, tipo);
      expect(fim.status, nome).toBe(200);
      expect(JSON.parse(fim.texto)).toEqual({ id, status: 'recebido', kind: 'imagem' });
    }
    expect(amb.reducer.recebidos.length).toBeGreaterThanOrEqual(3);
  });

  it('PDF integro passa sem reencode e o SHA-256 gravado e o do arquivo final', async () => {
    const pdf = PDF_VALIDO(4000);
    const { id, fim } = await enviarCert(SERVICO_REG, pdf, 'application/pdf');
    expect(fim.status).toBe(200);
    expect(JSON.parse(fim.texto)).toEqual({ id, status: 'recebido', kind: 'pdf' });
    expect(Buffer.from(amb.final.arquivos.get(id) ?? new Uint8Array())).toEqual(Buffer.from(pdf));
    expect(Buffer.from(amb.store.shas.get(id) ?? new Uint8Array())).toEqual(sha(pdf));
  });

  it('GIF gravado como JPEG declarado: finalizacao recusa com 415 e nada vai ao bucket final', async () => {
    const { id, fim } = await enviarCert(SERVICO_REG, GIF(1000), 'image/jpeg');
    expect(fim.status).toBe(415);
    expect(JSON.parse(fim.texto)).toEqual({ code: 'tipo_nao_aceito' });
    expect(amb.final.arquivos.has(id)).toBe(false);
  });

  it('certificacao nao consome os 5 documentos de identidade: a lista mostra 5 vagas de identidade', async () => {
    const r = await chamar('GET', IDOC_PATH);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.texto).slotsRemaining).toBe(5);
  });
});

describe('H-038 | certificacao: leitura e exclusao (T-08, T-11 HTTP)', () => {
  it('GET da lista traz so campos de metadado; nunca caminho, hash, tamanho armazenado ou URL de leitura', async () => {
    const r = await chamar('GET', IDOC_PATH);
    expect(r.status).toBe(200);
    const corpo = JSON.parse(r.texto) as { documents: Record<string, unknown>[] };
    expect(corpo.documents.length).toBeGreaterThan(0);
    for (const doc of corpo.documents) {
      expect(Object.keys(doc).sort()).toEqual(
        ['analyzed', 'deletable', 'documentKind', 'id', 'kind', 'receivedAt', 'serviceId', 'status'].sort(),
      );
    }
    expect(r.texto).not.toMatch(/stored|sha256|content_|signed|https?:/i);
  });

  it('nao existe rota de leitura do arquivo ao profissional: GET por id e subcaminhos respondem o 404 uniforme', async () => {
    const lista = JSON.parse((await chamar('GET', IDOC_PATH)).texto) as { documents: { id: string }[] };
    const id = lista.documents[0]?.id ?? ID_INEXISTENTE;
    const porId = await chamar('GET', `${IDOC_PATH}/${id}`);
    const download = await chamar('GET', `${IDOC_PATH}/${id}/download`);
    expect(porId.status).toBe(404);
    expect(download.status).toBe(404);
    expect(porId.texto).toBe(download.texto);
    expect(JSON.parse(porId.texto)).toEqual({ code: 'nao_encontrado' });
  });

  it('exclusao de certificacao nao analisada: 204; analisada: 409; id inexistente ou malformado: 404 uniforme', async () => {
    const emitido = await emitirCert(SERVICO_REG, 'image/png', 1000);
    const { id } = JSON.parse(emitido.texto) as { id: string };
    const apagar = await chamar('DELETE', `${IDOC_PATH}/${id}`, { tipo: null });
    expect(apagar.status).toBe(204);

    const { id: analisada } = await enviarCert(SERVICO_REG, WEBP(1000), 'image/webp');
    const linha = amb.store.linhas.get(analisada);
    expect(linha).toBeDefined();
    if (linha !== undefined) linha.analyzedAt = T0;
    const recusa = await chamar('DELETE', `${IDOC_PATH}/${analisada}`, { tipo: null });
    expect(recusa.status).toBe(409);
    expect(JSON.parse(recusa.texto)).toEqual({ code: 'ja_analisado' });

    const inexistente = await chamar('DELETE', `${IDOC_PATH}/${ID_INEXISTENTE}`, { tipo: null });
    const malformado = await chamar('DELETE', `${IDOC_PATH}/nao-e-uuid`, { tipo: null });
    expect(inexistente.status).toBe(404);
    expect(malformado.status).toBe(404);
    expect(inexistente.texto).toBe(malformado.texto);
  });
});

describe('H-038 | certificacao: flag desligada (T-14)', () => {
  it('com a trava fechada a resposta e o 404 uniforme e nenhum metodo de banco ou Storage e chamado', () => {
    const cabecalhos: Record<string, string> = {};
    let status = 0;
    let corpo = '';
    const res = {
      writeHead(codigo: number, extra: Record<string, string>) {
        status = codigo;
        Object.assign(cabecalhos, extra);
        return this;
      },
      end(texto?: string) {
        corpo = texto ?? '';
      },
    } as unknown as ServerResponse;
    const antes = [...amb.store.chamadas, ...amb.staging.entrada.keys()].length;
    responderDocumentosFechados(res);
    expect(status).toBe(404);
    expect(JSON.parse(corpo)).toEqual({ code: 'nao_encontrado' });
    expect(cabecalhos['Cache-Control']).toBe('no-store');
    expect([...amb.store.chamadas, ...amb.staging.entrada.keys()].length).toBe(antes);
  });
});
