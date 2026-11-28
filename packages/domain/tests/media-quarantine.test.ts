// H-026 (Issue #39) | Dominio da quarentena: corpo da emissao (M-05), chave do objeto (CA-13) e expurgo em duas
// fases com Storage falso (M-07, M-11, varredura de orfaos). Docs: docs/factory/88-DESENHO-H026.md, §1, §4, §7.
import { describe, expect, it } from 'vitest';
import {
  MEDIA_BODY_LIMIT_BYTES,
  MEDIA_MAX_BYTES,
  MEDIA_ORPHAN_AGE_MS,
  mediaIdFromKey,
  mediaObjectKey,
  parseMediaEmissaoBody,
  sweepQuarantine,
  type MediaStorePort,
  type QuarantineStoragePort,
} from '../src/index.js';

const ID_A = '0a0b0c0d-0e0f-4a1b-8c2d-3e4f5a6b7c8d';
const ID_B = '1a1b1c1d-1e1f-4a2b-8c3d-4e5f6a7b8c9d';
const CUID = '22222222-2222-4222-8222-222222222222';
const corpo = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ client_upload_id: CUID, content_type: 'image/jpeg', size_bytes: 1000, ...extra });
const ler = (texto: string) => parseMediaEmissaoBody(texto, Buffer.byteLength(texto));

describe('H-026 | corpo da emissao (M-05, CA-05, CA-13)', () => {
  it('aceita JPG, PNG e WebP entre 1 byte e 10 MB, com id em minusculas', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      const r = ler(corpo({ content_type: type, size_bytes: 1, client_upload_id: CUID.toUpperCase() }));
      expect(r).toEqual({ ok: true, corpo: { clientUploadId: CUID, type, bytes: 1 } });
    }
    expect(ler(corpo({ size_bytes: MEDIA_MAX_BYTES }))).toMatchObject({ ok: true });
  });

  it('10 MB + 1 e 413 arquivo_grande; GIF, PDF, HEIC, HEIF e tipo ausente sao 415', () => {
    expect(ler(corpo({ size_bytes: MEDIA_MAX_BYTES + 1 }))).toEqual({ ok: false, status: 413, code: 'arquivo_grande' });
    for (const type of ['image/gif', 'application/pdf', 'image/heic', 'image/heif']) {
      expect(ler(corpo({ content_type: type }))).toEqual({ ok: false, status: 415, code: 'tipo_nao_aceito' });
    }
    expect(ler(JSON.stringify({ client_upload_id: CUID, size_bytes: 5 }))).toEqual({
      ok: false,
      status: 415,
      code: 'tipo_nao_aceito',
    });
  });

  it('nome do arquivo e qualquer campo extra sao 422 campo_desconhecido; corpo vazio e 422 vazio', () => {
    for (const chave of ['filename', 'name', 'draft_id', 'owner', 'status', 'bucket', 'path']) {
      expect(ler(corpo({ [chave]: 'x' }))).toEqual({ ok: false, status: 422, code: 'campo_desconhecido' });
    }
    expect(ler('   ')).toEqual({ ok: false, status: 422, code: 'vazio' });
    expect(ler('[1]')).toEqual({ ok: false, status: 422, code: 'corpo_invalido' });
    expect(ler('{não é json')).toEqual({ ok: false, status: 422, code: 'corpo_invalido' });
  });

  it('id que nao e uuid, tamanho zero ou fracionario e 422; corpo acima de 2 KB e 413', () => {
    expect(ler(corpo({ client_upload_id: 'nao-e-uuid' }))).toEqual({
      ok: false,
      status: 422,
      code: 'client_upload_id_invalido',
    });
    expect(ler(corpo({ size_bytes: 0 }))).toEqual({ ok: false, status: 422, code: 'tamanho_invalido' });
    expect(ler(corpo({ size_bytes: 1.5 }))).toEqual({ ok: false, status: 422, code: 'tamanho_invalido' });
    expect(ler(corpo({ size_bytes: '10' }))).toEqual({ ok: false, status: 422, code: 'tamanho_invalido' });
    const grande = JSON.stringify({ client_upload_id: CUID, content_type: 'image/png', size_bytes: 1, pad: 'x'.repeat(MEDIA_BODY_LIMIT_BYTES) });
    expect(parseMediaEmissaoBody(grande, Buffer.byteLength(grande))).toEqual({ ok: false, status: 413, code: 'corpo_grande' });
  });
});

describe('H-026 | chave do objeto (CA-13, T-10)', () => {
  it('a chave e d/<uuid>, sem extensao e sem nome; so aceita uuid', () => {
    expect(mediaObjectKey(ID_A)).toBe(`d/${ID_A}`);
    expect(mediaObjectKey(ID_A.toUpperCase())).toBe(`d/${ID_A}`);
    expect(() => mediaObjectKey('../fora')).toThrow('chave_midia_invalida');
    expect(() => mediaObjectKey(`${ID_A}.jpg`)).toThrow('chave_midia_invalida');
    expect(mediaIdFromKey(`d/${ID_A}`)).toBe(ID_A);
    expect(mediaIdFromKey('d/rua-das-flores-12.jpg')).toBeNull();
    expect(mediaIdFromKey(`x/${ID_A}`)).toBeNull();
  });
});

/** Banco falso do expurgo: marca ids e apaga os que o Storage liberou. */
class StoreFalso implements Pick<MediaStorePort, 'sweep' | 'purgeDone' | 'known'> {
  marcados: string[];
  linhas: Set<string>;
  apagados: string[][] = [];
  constructor(marcados: string[], linhas: string[]) {
    this.marcados = marcados;
    this.linhas = new Set(linhas);
  }
  async sweep(): Promise<readonly string[]> {
    return [...this.marcados];
  }
  async purgeDone(ids: readonly string[]): Promise<number> {
    this.apagados.push([...ids]);
    let n = 0;
    for (const id of ids) if (this.linhas.delete(id)) n++;
    return n;
  }
  async known(ids: readonly string[]): Promise<readonly string[]> {
    return ids.filter((id) => this.linhas.has(id));
  }
}

/** Storage falso: objetos por chave; falhas simuladas por chave. */
class StorageFalso implements Pick<QuarantineStoragePort, 'remove' | 'listOlderThan'> {
  objetos: Set<string>;
  falhas = new Set<string>();
  antesDe: number | null = null;
  constructor(objetos: string[]) {
    this.objetos = new Set(objetos);
  }
  async remove(key: string): Promise<void> {
    if (this.falhas.has(key)) throw new Error('falha simulada');
    this.objetos.delete(key); // ausente tambem conta como sucesso
  }
  async listOlderThan(antesDeMs: number): Promise<readonly string[]> {
    this.antesDe = antesDeMs;
    return [...this.objetos];
  }
}

describe('H-026 | expurgo em duas fases (M-07, M-11, orfaos)', () => {
  const AGORA = Date.UTC(2026, 10, 12, 15, 0, 0);

  it('M-07: remove o objeto, depois apaga so a linha cujo objeto saiu; falha de Storage deixa a linha marcada', async () => {
    const store = new StoreFalso([ID_A, ID_B], [ID_A, ID_B]);
    const storage = new StorageFalso([`d/${ID_A}`, `d/${ID_B}`]);
    storage.falhas.add(`d/${ID_B}`);
    const rel = await sweepQuarantine({ store, storage, nowMs: () => AGORA });
    expect(store.apagados).toEqual([[ID_A]]);
    expect(store.linhas.has(ID_B)).toBe(true);
    expect(rel).toEqual({ marcados: 2, removidos: 1, falhas: 1, orfaosRemovidos: 0, falhasOrfaos: 0, originaisLimpos: 0 });
  });

  it('M-11: objetos de rascunho descartado ou vencido saem; reexecutar nao apaga nada a mais (idempotente)', async () => {
    const store = new StoreFalso([ID_A], [ID_A]);
    const storage = new StorageFalso([`d/${ID_A}`]);
    await sweepQuarantine({ store, storage, nowMs: () => AGORA });
    const segunda = await sweepQuarantine({ store: new StoreFalso([], []), storage, nowMs: () => AGORA });
    expect(storage.objetos.size).toBe(0);
    expect(segunda.marcados).toBe(0);
  });

  it('varredura de orfaos: objeto sem linha e removido; objeto com linha e preservado; idade e de 3 h', async () => {
    const orfao = ID_B;
    const store = new StoreFalso([], [ID_A]);
    const storage = new StorageFalso([`d/${ID_A}`, `d/${orfao}`]);
    const rel = await sweepQuarantine({ store, storage, nowMs: () => AGORA });
    expect(storage.antesDe).toBe(AGORA - MEDIA_ORPHAN_AGE_MS);
    expect(storage.objetos.has(`d/${ID_A}`)).toBe(true);
    expect(storage.objetos.has(`d/${orfao}`)).toBe(false);
    expect(rel.orfaosRemovidos).toBe(1);
  });

  it('o relatorio traz so contagens: nenhum id, chave ou caminho', async () => {
    const store = new StoreFalso([ID_A], [ID_A]);
    const storage = new StorageFalso([`d/${ID_A}`]);
    const rel = await sweepQuarantine({ store, storage, nowMs: () => AGORA });
    expect(JSON.stringify(rel)).not.toContain(ID_A);
    expect(Object.values(rel).every((v) => typeof v === 'number')).toBe(true);
  });
});
