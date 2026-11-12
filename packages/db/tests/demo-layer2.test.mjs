// H-120 (Issue 129) | Testes sem banco da camada 2 da carga de demonstracao (85-DESENHO-H120 §0 a §5).
// Cliente e Storage falsos; nenhuma conexao e aberta. Executar: pnpm test (vitest).
import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';
import { createDecipheriv, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAMADA2_BLOCOS, REMOCAO, REMOCAO_CAMADA2, removerDemo, runCamada2 } from '../scripts/demo-load.mjs';
import { loadDemoKeys } from '../scripts/lib/demo-guard.mjs';
import { CLIENTES, DEMO_ID_LIKE, PROFISSIONAIS, RASCUNHOS, isDemoId, KIND, demoId } from '../scripts/lib/demo-ids.mjs';
import {
  ACEITES,
  CONTAGENS_CAMADA2,
  FOTOS,
  KIND2,
  MENSAGENS,
  PEDIDOS,
  SQL2,
  baseStorageLocal,
  criarStorageDemo,
  fotoObjectKey,
  pngSolido,
  sealCampo,
  tiposDeChunks,
} from '../scripts/lib/demo-layer2.mjs';

const ESCRITA = /^\s*(insert|update|delete)\b/i;
const MIGRACOES = fileURLToPath(new URL('../../../supabase/migrations', import.meta.url));

/** Cliente falso: tabelas presentes por nome, contagem de midia de demo e linhas ja existentes. */
function fakeDb({ tabelas = [], midiaDemo = 0, jaExistem = [] } = {}) {
  const log = [];
  const presentes = new Set(tabelas);
  return {
    log,
    async query(sql, params = []) {
      log.push({ sql, params });
      if (sql.includes('to_regclass')) return { rows: [{ presente: presentes.has(params[0]) }], rowCount: 1 };
      if (sql.includes('from app.service where active order by')) return { rows: [{ id: 'svc-1' }], rowCount: 1 };
      if (/^select count\(\*\)::int as n from app\.\w+ where id = \$1$/.test(sql)) {
        const existe = jaExistem.includes(params[0]);
        return { rows: [{ n: existe ? 1 : 0 }], rowCount: 1 };
      }
      if (sql.includes('from app.media_asset where id::text like')) return { rows: [{ n: midiaDemo }], rowCount: 1 };
      if (sql.includes('select id::text as id from app.app_user')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    },
  };
}

/** Storage falso: listagem devolve primeiro `objetos` e depois `restam`. */
function fakeStorage({ objetos = [], restam = [] } = {}) {
  const chamadas = [];
  let listas = 0;
  return {
    chamadas,
    async subir(caminho, bytes) {
      chamadas.push({ op: 'subir', caminho, bytes });
    },
    async listar() {
      listas += 1;
      chamadas.push({ op: 'listar' });
      return listas === 1 ? [...objetos] : [...restam];
    },
    async remover(caminhos) {
      chamadas.push({ op: 'remover', caminhos: [...caminhos] });
    },
  };
}

const NOMES_CHAVES = ['DOCUMENT_HMAC_KEY', 'DATA_ENC_KEY_V1', 'ADDRESS_HASH_KEY'];
function gerarValor(nome) {
  return nome === 'ADDRESS_HASH_KEY' ? randomBytes(24).toString('hex') : randomBytes(32).toString('base64');
}

function chaves() {
  const env = Object.fromEntries(NOMES_CHAVES.map((n) => [n, gerarValor(n)]));
  env.DATA_ENC_KEY_ACTIVE_VERSION = '1';
  const r = loadDemoKeys(env);
  if (!r.ok) throw new Error('chaves de teste invalidas no proprio teste');
  return r.keys;
}

const TODAS_TABELAS = CAMADA2_BLOCOS.flatMap((b) => b.tabelas);

describe('T-H120-09 identificadores e conteudo da camada 2 (CA-H120-02, CA-H120-10)', () => {
  it('todo id da camada 2 tem o prefixo reservado e nao colide com a camada 1', () => {
    const ids = [
      ...PEDIDOS.map((p) => p.id),
      ...ACEITES.map((a) => a.id),
      ...ACEITES.map((a) => a.conversaId),
      ...MENSAGENS.map((m) => m.id),
      ...FOTOS.map((f) => f.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(isDemoId(id)).toBe(true);
    const camada1 = [
      ...CLIENTES.map((c) => c.id),
      ...PROFISSIONAIS.map((p) => p.id),
      ...RASCUNHOS.map((r) => r.id),
    ];
    for (const id of ids) expect(camada1).not.toContain(id);
  });

  it('quantidades batem com o refino (6 pedidos, 2 aceites, 2 conversas, 6 fotos)', () => {
    expect(PEDIDOS).toHaveLength(6);
    expect(ACEITES).toHaveLength(2);
    expect(FOTOS).toHaveLength(6);
    expect(CONTAGENS_CAMADA2).toEqual({ pedidos: 6, aceites: 2, conversas: 2, mensagens: MENSAGENS.length, fotos: 6 });
    expect(MENSAGENS.filter((m) => m.tipo === 'sistema')).toHaveLength(2);
  });

  it('mensagem de sistema so leva ids em params e nunca texto livre', () => {
    for (const m of MENSAGENS.filter((x) => x.tipo === 'sistema')) {
      expect(m.texto).toBeNull();
      expect(m.remetenteId).toBeNull();
      for (const v of Object.values(m.params)) expect(isDemoId(v)).toBe(true);
    }
  });

  it('caminho de foto segue demo-h120/<pedido>/<n>.png (desenho §2)', () => {
    for (const f of FOTOS) {
      expect(f.objectKey).toBe(fotoObjectKey(f.pedido.id, FOTOS.filter((x) => x.pedido === f.pedido).indexOf(f) + 1));
      expect(f.objectKey).toMatch(/^demo-h120\/fa57d120-0000-4000-8000-000000000[0-9a-f]{3}\/[1-3]\.png$/);
    }
  });

  it('nenhum SQL da camada 2 toca auditoria, fila de e-mail ou o schema ops', () => {
    const sqls = [...Object.values(SQL2).filter((v) => typeof v === 'string'), SQL2.existe('app.x'), ...REMOCAO_CAMADA2.map((r) => r[2])];
    for (const sql of sqls) {
      const minusculo = sql.toLowerCase();
      expect(minusculo).not.toContain('audit');
      expect(minusculo).not.toContain('email_outbox');
      expect(minusculo).not.toContain('ops.');
    }
  });

  it('o prefixo de demo nunca aparece em migracao (desenho §5, extra)', () => {
    const arquivos = readdirSync(MIGRACOES).filter((f) => f.endsWith('.sql'));
    expect(arquivos.length).toBeGreaterThan(0);
    for (const f of arquivos) {
      expect(readFileSync(join(MIGRACOES, f), 'utf8')).not.toContain('fa57d120');
    }
  });
});

describe('T-H120-10 foto PNG sem metadados (CA-H120-01, desenho §1)', () => {
  it('so tem chunks IHDR, IDAT e IEND, sem EXIF, texto ou GPS', () => {
    for (const f of FOTOS) {
      const png = pngSolido(640, 480, f.cor);
      expect(tiposDeChunks(png)).toEqual(['IHDR', 'IDAT', 'IEND']);
    }
  });

  it('dimensoes e cor sao as pedidas e o conteudo decodifica para cor solida', () => {
    const cor = [0x2e, 0x7d, 0x32];
    const png = pngSolido(10, 4, cor);
    expect(png.readUInt32BE(16)).toBe(10);
    expect(png.readUInt32BE(20)).toBe(4);
    const idatPos = png.indexOf(Buffer.from('IDAT', 'ascii')) + 4;
    const tamanho = png.readUInt32BE(idatPos - 8);
    const bruto = inflateSync(png.subarray(idatPos, idatPos + tamanho));
    expect(bruto).toHaveLength(4 * (1 + 10 * 3));
    for (let y = 0; y < 4; y += 1) {
      const linha = y * (1 + 30);
      expect(bruto[linha]).toBe(0);
      for (let x = 0; x < 10; x += 1) {
        expect([bruto[linha + 1 + x * 3], bruto[linha + 2 + x * 3], bruto[linha + 3 + x * 3]]).toEqual(cor);
      }
    }
  });

  it('CRC de cada chunk confere (padrao PNG)', () => {
    const tabela = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
    const crc = (buf) => {
      let c = 0xffffffff;
      for (const b of buf) c = tabela[(c ^ b) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    const png = pngSolido(64, 48, [1, 2, 3]);
    let pos = 8;
    while (pos < png.length) {
      const n = png.readUInt32BE(pos);
      const tipoEDados = png.subarray(pos + 4, pos + 8 + n);
      expect(png.readUInt32BE(pos + 8 + n)).toBe(crc(tipoEDados));
      pos += 12 + n;
    }
  });

  it('recusa dimensao acima do limite do modelo (1280)', () => {
    expect(() => pngSolido(1281, 10, [0, 0, 0])).toThrow();
    expect(() => pngSolido(0, 10, [0, 0, 0])).toThrow();
  });
});

describe('T-H120-11 cifra de campo e host do Storage (CA-H120-08, desenho §1)', () => {
  it('cifra de endereco: versao, nonce, tag e corpo; AAD por dono e campo', () => {
    const key = randomBytes(32);
    const buf = sealCampo(key, 1, 'dono-1', 'address_text_enc', 'Rua Sintética 000');
    expect(buf[0]).toBe(1);
    const d = createDecipheriv('aes-256-gcm', key, buf.subarray(1, 13));
    d.setAAD(Buffer.from('doc1|dono-1|address_text_enc', 'utf8'));
    d.setAuthTag(buf.subarray(13, 29));
    expect(Buffer.concat([d.update(buf.subarray(29)), d.final()]).toString('utf8')).toBe('Rua Sintética 000');
    const outroCampo = createDecipheriv('aes-256-gcm', key, buf.subarray(1, 13));
    outroCampo.setAAD(Buffer.from('doc1|dono-1|outro', 'utf8'));
    outroCampo.setAuthTag(buf.subarray(13, 29));
    expect(() => Buffer.concat([outroCampo.update(buf.subarray(29)), outroCampo.final()])).toThrow();
  });

  it('so aceita host local (127.0.0.1, localhost, ::1)', () => {
    expect(baseStorageLocal('http://127.0.0.1:54321')).toBe('http://127.0.0.1:54321');
    expect(baseStorageLocal('http://localhost:54321/')).toBe('http://localhost:54321');
    expect(baseStorageLocal('http://[::1]:54321')).toBe('http://[::1]:54321');
    expect(baseStorageLocal('https://projeto.supabase.co')).toBeNull();
    expect(baseStorageLocal('https://127.0.0.1.example.com')).toBeNull();
    expect(baseStorageLocal('ftp://127.0.0.1')).toBeNull();
    expect(baseStorageLocal('')).toBeNull();
    expect(baseStorageLocal(undefined)).toBeNull();
  });

  it('cliente de Storage nao existe para URL remota e nao chama a rede', async () => {
    let chamou = false;
    const fetchImpl = async () => {
      chamou = true;
      return { ok: true, status: 200 };
    };
    expect(criarStorageDemo({ url: 'https://projeto.supabase.co', chave: 'x', fetchImpl })).toBeNull();
    expect(criarStorageDemo({ url: 'http://127.0.0.1:54321', chave: '', fetchImpl })).toBeNull();
    expect(chamou).toBe(false);
  });
});

describe('T-H120-12 cliente de Storage (CA-H120-07, fetch falso)', () => {
  it('sobe foto com upsert no bucket e caminho de demo', async () => {
    const chamadas = [];
    const fetchImpl = async (url, init) => {
      chamadas.push({ url, init });
      return { ok: true, status: 200 };
    };
    const storage = criarStorageDemo({ url: 'http://127.0.0.1:54321', chave: 'chave-de-teste', fetchImpl });
    await storage.subir('demo-h120/x/1.png', Buffer.from([1, 2]));
    expect(chamadas[0].url).toBe('http://127.0.0.1:54321/storage/v1/object/request-photos/demo-h120/x/1.png');
    expect(chamadas[0].init.method).toBe('POST');
    expect(chamadas[0].init.headers['x-upsert']).toBe('true');
    expect(chamadas[0].init.headers['content-type']).toBe('image/png');
  });

  it('lista recursivamente e remove so pelos caminhos informados', async () => {
    const respostas = [
      [{ name: 'pasta-1', id: null }],
      [{ name: '1.png', id: 'a' }, { name: '2.png', id: 'b' }],
    ];
    const chamadas = [];
    const fetchImpl = async (url, init) => {
      chamadas.push({ url, init });
      const corpo = respostas.shift() ?? [];
      return { ok: true, status: 200, json: async () => corpo };
    };
    const storage = criarStorageDemo({ url: 'http://localhost:54321', chave: 'chave-de-teste', fetchImpl });
    const achados = await storage.listar();
    expect(achados).toEqual(['demo-h120/pasta-1/1.png', 'demo-h120/pasta-1/2.png']);
    await storage.remover(achados);
    const delecao = chamadas[chamadas.length - 1];
    expect(delecao.init.method).toBe('DELETE');
    expect(JSON.parse(delecao.init.body).prefixes).toEqual(achados);
  });

  it('remove lista vazia sem chamar a API', async () => {
    let chamou = false;
    const storage = criarStorageDemo({
      url: 'http://127.0.0.1:54321',
      chave: 'chave-de-teste',
      fetchImpl: async () => {
        chamou = true;
        return { ok: true, status: 200 };
      },
    });
    await storage.remover([]);
    expect(chamou).toBe(false);
  });

  it('erro de resposta nao expoe a chave', async () => {
    const storage = criarStorageDemo({
      url: 'http://127.0.0.1:54321',
      chave: 'segredo-de-teste-123',
      fetchImpl: async () => ({ ok: false, status: 401 }),
    });
    const err = await storage.subir('demo-h120/x/1.png', Buffer.from([1])).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('401');
    expect(err.message).not.toContain('segredo-de-teste-123');
  });
});

describe('T-H120-13 execucao da camada 2 por bloco (CA-H120-04, CA-H120-05, CA-H120-09)', () => {
  it('com tabelas presentes, chaves e Storage: escreve os quatro blocos e sobe as seis fotos', async () => {
    const c = fakeDb({ tabelas: TODAS_TABELAS });
    const storage = fakeStorage();
    const blocos = await runCamada2(c, { keys: chaves(), storage, dryRun: false });
    expect(blocos.map((b) => b.nome)).toEqual(['pedidos', 'aceites', 'chat', 'fotos']);
    expect(blocos.every((b) => b.status.startsWith('inseridos'))).toBe(true);
    const uploads = storage.chamadas.filter((x) => x.op === 'subir');
    expect(uploads).toHaveLength(6);
    for (const u of uploads) {
      expect(u.bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(u.caminho).toMatch(/^demo-h120\//);
    }
    expect(c.log.some(({ sql }) => ESCRITA.test(sql))).toBe(true);
  });

  it('nao envia SQL para tabela ou escrita fora da camada 2 e nao toca e-mail', async () => {
    const c = fakeDb({ tabelas: TODAS_TABELAS });
    await runCamada2(c, { keys: chaves(), storage: fakeStorage() });
    for (const { sql } of c.log) {
      const m = sql.toLowerCase();
      expect(m).not.toContain('email_outbox');
      expect(m).not.toContain('audit');
    }
  });

  it('sem tabela de pedidos, os blocos que dependem dela nao rodam', async () => {
    const c = fakeDb({ tabelas: TODAS_TABELAS.filter((t) => t !== 'app.service_request') });
    const blocos = await runCamada2(c, { keys: chaves(), storage: fakeStorage() });
    expect(blocos[0].status).toContain('tabela ausente (app.service_request)');
    expect(blocos[1].status).toBe('nao executado: bloco pedidos nao executado');
    expect(blocos[2].status).toBe('nao executado: bloco aceites nao executado');
    expect(blocos[3].status).toBe('nao executado: bloco pedidos nao executado');
    expect(c.log.some(({ sql }) => ESCRITA.test(sql))).toBe(false);
  });

  it('chat exige as duas tabelas (conversa e mensagem)', async () => {
    const c = fakeDb({ tabelas: TODAS_TABELAS.filter((t) => t !== 'app.message') });
    const blocos = await runCamada2(c, { keys: chaves(), storage: fakeStorage() });
    expect(blocos[2].status).toContain('tabela ausente (app.message)');
    expect(blocos[1].status).toMatch(/^inseridos/);
  });

  it('fotos nao sobem em dry-run e nao sem Storage local', async () => {
    const c = fakeDb({ tabelas: TODAS_TABELAS });
    const emDry = await runCamada2(c, { keys: chaves(), storage: fakeStorage(), dryRun: true });
    expect(emDry[3].status).toContain('dry-run');
    const semStorage = await runCamada2(fakeDb({ tabelas: TODAS_TABELAS }), { keys: chaves(), storage: null });
    expect(semStorage[3].status).toContain('Storage local nao configurado');
  });

  it('reexecucao nao insere linha que ja existe', async () => {
    const c = fakeDb({ tabelas: TODAS_TABELAS, jaExistem: [...PEDIDOS.map((p) => p.id), ...ACEITES.map((a) => a.id)] });
    const blocos = await runCamada2(c, { keys: chaves(), storage: fakeStorage() });
    expect(blocos[0].inseridos).toBe(0);
    expect(blocos[1].inseridos).toBe(0);
    const inserePedido = c.log.filter(({ sql }) => sql === SQL2.pedido);
    expect(inserePedido).toHaveLength(0);
  });

  it('falha de upload propaga para o chamador (que desfaz a transacao)', async () => {
    const c = fakeDb({ tabelas: TODAS_TABELAS });
    const storage = fakeStorage();
    let n = 0;
    storage.subir = async () => {
      n += 1;
      if (n === 2) throw new Error('storage: resposta 500 em POST');
    };
    await expect(runCamada2(c, { keys: chaves(), storage })).rejects.toThrow('500');
  });
});

describe('T-H120-14 remocao da camada 2 (CA-H120-06, CA-H120-07)', () => {
  it('com Storage: lista, remove, confere vazio, depois apaga linhas filhas antes das da camada 1', async () => {
    const c = fakeDb({ tabelas: TODAS_TABELAS });
    const storage = fakeStorage({ objetos: ['demo-h120/x/1.png'], restam: [] });
    const r = await removerDemo(c, { storage, dryRun: false });
    expect(r.falha).toBeUndefined();
    expect(storage.chamadas.map((x) => x.op)).toEqual(['listar', 'remover', 'listar']);
    const apagues = c.log.filter(({ sql }) => ESCRITA.test(sql)).map(({ sql }) => sql);
    expect(apagues.slice(0, REMOCAO_CAMADA2.length)).toEqual(REMOCAO_CAMADA2.map((x) => x[2]));
    expect(apagues.slice(REMOCAO_CAMADA2.length)).toEqual(REMOCAO.map((x) => x[1]));
  });

  it('Storage que nao esvazia recusa a remocao antes de qualquer DELETE', async () => {
    const c = fakeDb({ tabelas: TODAS_TABELAS });
    const storage = fakeStorage({ objetos: ['demo-h120/x/1.png'], restam: ['demo-h120/x/1.png'] });
    const r = await removerDemo(c, { storage, dryRun: false });
    expect(r.falha).toContain('Storage nao ficou vazio');
    expect(c.log.some(({ sql }) => ESCRITA.test(sql))).toBe(false);
  });

  it('dry-run lista o Storage mas nao remove objeto', async () => {
    const c = fakeDb({ tabelas: TODAS_TABELAS });
    const storage = fakeStorage({ objetos: ['demo-h120/x/1.png'] });
    const r = await removerDemo(c, { storage, dryRun: true });
    expect(r.falha).toBeUndefined();
    expect(storage.chamadas.some((x) => x.op === 'remover')).toBe(false);
  });

  it('sem Storage local e com fotos de demo no banco: recusa antes de apagar', async () => {
    const c = fakeDb({ tabelas: TODAS_TABELAS, midiaDemo: 3 });
    const r = await removerDemo(c, { storage: null });
    expect(r.falha).toContain('nada foi apagado');
    expect(c.log.some(({ sql }) => ESCRITA.test(sql))).toBe(false);
  });

  it('sem tabela da camada 2, nao emite DELETE dela (idempotente)', async () => {
    const c = fakeDb({ tabelas: [] });
    const r = await removerDemo(c, { storage: null });
    expect(r.apagadas.mensagens).toBe('tabela ausente');
    expect(c.log.filter(({ sql }) => ESCRITA.test(sql))).toHaveLength(REMOCAO.length);
  });

  it('todo DELETE da camada 2 filtra pelo prefixo reservado', () => {
    for (const [, , sql] of REMOCAO_CAMADA2) {
      expect(sql).toMatch(/like \$1/);
      expect(sql).toMatch(/where/i);
    }
    expect(DEMO_ID_LIKE).toBe('fa57d120-%');
  });
});

describe('T-H120-15 reserva de tipos de id da camada 2', () => {
  it('os tipos da camada 2 nao reusam os da camada 1', () => {
    const usados1 = new Set(Object.values(KIND));
    for (const v of Object.values(KIND2)) expect(usados1.has(v)).toBe(false);
    expect(demoId(KIND2.PEDIDO, 6)).toBe('fa57d120-0000-4000-8000-000000000106');
  });
});
