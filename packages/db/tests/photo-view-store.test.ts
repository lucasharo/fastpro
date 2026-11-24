// H-056 (Issue 69) | Adaptador das fotos elegiveis com cliente falso (docs/factory/167-DESENHO-H056.md, §3 e §4.2).
// Prova: funcoes certas e parametros na ordem, negacao = null/false, lista vazia autorizada, erro fixo sem texto
// do driver, e limite de taxa com politica e prefixo proprios (a descoberta segue com o padrao).
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PgPhotoViewStore, PhotoViewStoreError } from '../src/photo-view-store.js';
import { PHOTO_VIEW_RATE_LIMIT, PgDiscoveryRateLimit } from '../src/discovery-rate-limit.js';

const PROF = '11111111-1111-4111-8111-111111111111';
const REQ = '22222222-2222-4222-8222-222222222222';
const FOTO = '33333333-3333-4333-8333-333333333333';
const AGORA = Date.UTC(2026, 10, 20, 12, 0, 0);

/** Cliente falso: devolve as respostas em ordem (ou lanca, se a resposta for um Error). */
function clienteFalso(...respostas: Array<readonly unknown[] | Error>) {
  const chamadas: Array<{ texto: string; params: unknown[] }> = [];
  const cliente = {
    query: async (texto: string, params: unknown[] = []) => {
      chamadas.push({ texto, params });
      const resposta = respostas.shift() ?? [];
      if (resposta instanceof Error) throw resposta;
      return { rows: resposta } as never;
    },
  };
  return { cliente, chamadas };
}

describe('PgPhotoViewStore: lista do profissional', () => {
  it('devolve as fotos na ordem do banco e chama a funcao com o instante recebido', async () => {
    const { cliente, chamadas } = clienteFalso([{ out_id: FOTO, out_pos: 1, out_width: 1200, out_height: 900 }]);
    const lista = await new PgPhotoViewStore(cliente).list(PROF, REQ, AGORA);
    expect(lista).toEqual([{ id: FOTO, sortOrder: 1, width: 1200, height: 900 }]);
    expect(chamadas[0]?.texto).toContain('private.request_photo_list');
    expect(chamadas[0]?.params).toEqual([PROF, REQ, new Date(AGORA).toISOString()]);
  });

  it('autorizado sem foto pronta (uma linha com id nulo) devolve lista vazia', async () => {
    const { cliente } = clienteFalso([{ out_id: null, out_pos: null, out_width: null, out_height: null }]);
    expect(await new PgPhotoViewStore(cliente).list(PROF, REQ, AGORA)).toEqual([]);
  });

  it('negado (zero linhas) devolve null', async () => {
    const { cliente } = clienteFalso([]);
    expect(await new PgPhotoViewStore(cliente).list(PROF, REQ, AGORA)).toBeNull();
  });

  it('resposta fora do formato lanca erro fixo', async () => {
    const { cliente } = clienteFalso([{ out_id: 'nao-e-uuid', out_pos: 1, out_width: 1, out_height: 1 }]);
    const erro = await new PgPhotoViewStore(cliente).list(PROF, REQ, AGORA).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(PhotoViewStoreError);
    expect((erro as Error).message).toBe('foto_acesso_falhou');
  });

  it('erro do driver vira erro fixo, sem o texto do driver', async () => {
    const { cliente } = clienteFalso(new Error('detalhe-do-driver-98765'));
    const erro = await new PgPhotoViewStore(cliente).list(PROF, REQ, AGORA).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(PhotoViewStoreError);
    expect((erro as Error).message).not.toContain('98765');
  });
});

describe('PgPhotoViewStore: alvo, acesso e lista do dono', () => {
  it('alvo: zero linhas = null; uma linha valida = bytes, largura e altura', async () => {
    const { cliente, chamadas } = clienteFalso([], [{ out_bytes: 5000, out_width: 1200, out_height: 900 }]);
    const loja = new PgPhotoViewStore(cliente);
    expect(await loja.target(PROF, REQ, FOTO, AGORA)).toBeNull();
    expect(await loja.target(PROF, REQ, FOTO, AGORA)).toEqual({ bytes: 5000, width: 1200, height: 900 });
    expect(chamadas[0]?.texto).toContain('private.request_photo_target');
    expect(chamadas[0]?.params).toEqual([PROF, REQ, FOTO, new Date(AGORA).toISOString()]);
  });

  it('acesso: devolve o booleano da funcao; formato fora do esperado lanca erro', async () => {
    const { cliente } = clienteFalso([{ out_ok: true }], [{ out_ok: false }], [{ out_ok: 'sim' }]);
    const loja = new PgPhotoViewStore(cliente);
    expect(await loja.access(REQ, PROF, null, AGORA)).toBe(true);
    expect(await loja.access(REQ, PROF, FOTO, AGORA)).toBe(false);
    await expect(loja.access(REQ, PROF, FOTO, AGORA)).rejects.toBeInstanceOf(PhotoViewStoreError);
  });

  it('lista e alvo do dono usam as funcoes do dono, sem instante', async () => {
    const { cliente, chamadas } = clienteFalso(
      [{ out_id: FOTO, out_pos: 1, out_width: 800, out_height: 600 }],
      [{ out_bytes: 4000, out_width: 800, out_height: 600 }],
    );
    const loja = new PgPhotoViewStore(cliente);
    expect(await loja.ownerList(PROF, REQ)).toEqual([{ id: FOTO, sortOrder: 1, width: 800, height: 600 }]);
    expect(await loja.ownerTarget(PROF, REQ, FOTO)).toEqual({ bytes: 4000, width: 800, height: 600 });
    expect(chamadas[0]?.texto).toContain('private.request_photo_owner_list');
    expect(chamadas[0]?.params).toEqual([PROF, REQ]);
    expect(chamadas[1]?.texto).toContain('private.request_photo_owner_target');
  });
});

describe('limite de taxa parametrizado (lista e link compartilham o balde da foto)', () => {
  it('usa a politica e o prefixo da foto, e a descoberta segue com o padrao', async () => {
    const { cliente, chamadas } = clienteFalso([{ out_ok: true, out_retry_after: 0 }]);
    await new PgDiscoveryRateLimit({
      client: cliente,
      chaveDoProfissional: () => 'abc',
      politica: PHOTO_VIEW_RATE_LIMIT,
      prefixo: 'photo_view:',
    }).check(PROF, AGORA);
    // A chave enviada ao banco e o SHA-256 do prefixo + HMAC (ops.rate_counter exige 64 hexadecimais).
    const sha = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex');
    expect(chamadas[0]?.params[0]).toBe(sha('photo_view:abc'));
    expect(chamadas[0]?.params[3]).toBe(60);

    const padrao = clienteFalso([{ out_ok: true, out_retry_after: 0 }]);
    await new PgDiscoveryRateLimit({ client: padrao.cliente, chaveDoProfissional: () => 'abc' }).check(PROF, AGORA);
    expect(padrao.chamadas[0]?.params[0]).toBe(sha('discovery:abc'));
    expect(padrao.chamadas[0]?.params[3]).toBe(60);
  });
});
