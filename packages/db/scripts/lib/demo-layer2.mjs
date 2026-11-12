// H-120 (Issue 129) | Camada 2 da carga de demonstracao: pedidos, aceites, chat e fotos (85-DESENHO-H120 §0 a §3).
// Nada daqui roda sem a tabela: demo-load.mjs so executa cada bloco se todas as tabelas dele existirem
// (to_regclass) e se o bloco de que depende ja tiver rodado. Modelo de referencia: 09-MODELO-DADOS §3.5 a §3.7.
// [NAO VERIFICADO] nomes e tipos das colunas: as tabelas ainda nao existem em supabase/migrations.
// Sem banco e sem rede neste modulo: o cliente de Storage recebe fetch injetado e so aceita host local.
import { Buffer } from 'node:buffer';
import { createCipheriv, randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { CLIENTES, DEMO_STORAGE_PREFIX, PROFISSIONAIS, demoId } from './demo-ids.mjs';

// Tipos de id da camada 2 (hexadecimal livre no prefixo fa57d120-0000-4000-8000-000000000<tipo><nn>).
export const KIND2 = Object.freeze({ PEDIDO: '1', ACEITE: '2', CONVERSA: '3', MENSAGEM: '4', FOTO: '5' });
export const BUCKET_FOTOS = 'request-photos';
export const FOTO_LARGURA = 640;
export const FOTO_ALTURA = 480;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const NONCE_BYTES = 12;
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Seis pedidos alternando os dois clientes. Todos publicados (ver relatorio: outros estados exigem linhas de
// selecao, conclusao ou cancelamento, fora desta carga).
export const PEDIDOS = Object.freeze(
  [1, 2, 3, 4, 5, 6].map((n) =>
    Object.freeze({ n, id: demoId(KIND2.PEDIDO, n), cliente: CLIENTES[(n - 1) % CLIENTES.length] }),
  ),
);

// Dois aceites no primeiro pedido: profissionais 1 e 2 (aprovados), vagas 1 e 2 (refino §3).
export const ACEITES = Object.freeze(
  [1, 2].map((n) =>
    Object.freeze({
      n,
      id: demoId(KIND2.ACEITE, n),
      pedido: PEDIDOS[0],
      profissional: PROFISSIONAIS[n - 1],
      slot: n,
      conversaId: demoId(KIND2.CONVERSA, n),
    }),
  ),
);

// Mensagens: uma de sistema por aceite (modelo 09 §3.7 gera uma por aceite) e duas de texto por conversa.
export const MENSAGENS = Object.freeze(
  ACEITES.flatMap((a) => [
    Object.freeze({
      id: demoId(KIND2.MENSAGEM, a.n),
      conversaId: a.conversaId,
      tipo: 'sistema',
      remetenteId: null,
      clientMessageId: null,
      evento: 'aceite',
      dedupeKey: `acceptance:${a.id}:accepted`,
      params: { acceptance_id: a.id },
      texto: null,
    }),
    Object.freeze({
      id: demoId(KIND2.MENSAGEM, 2 + a.n),
      conversaId: a.conversaId,
      tipo: 'humana',
      remetenteId: a.profissional.id,
      clientMessageId: demoId(KIND2.MENSAGEM, 2 + a.n),
      evento: null,
      dedupeKey: null,
      params: {},
      texto: 'Olá, tenho disponibilidade para este pedido.',
    }),
    Object.freeze({
      id: demoId(KIND2.MENSAGEM, 4 + a.n),
      conversaId: a.conversaId,
      tipo: 'humana',
      remetenteId: a.pedido.cliente.id,
      clientMessageId: demoId(KIND2.MENSAGEM, 4 + a.n),
      evento: null,
      dedupeKey: null,
      params: {},
      texto: 'Olá, pode me contar mais sobre o serviço?',
    }),
  ]),
);

// Cores das fotos: cor solida, sem nenhum dado de origem (sem EXIF nem GPS).
const CORES = Object.freeze([
  [0x2e, 0x7d, 0x32],
  [0x15, 0x65, 0xc0],
  [0xb2, 0x6a, 0x00],
]);

// Tres fotos por pedido, nos dois primeiros pedidos (refino §3: ate 2 pedidos com 3 fotos cada).
export const FOTOS = Object.freeze(
  PEDIDOS.slice(0, 2).flatMap((pedido, ip) =>
    [1, 2, 3].map((k) => {
      const n = ip * 3 + k;
      return Object.freeze({
        n,
        id: demoId(KIND2.FOTO, n),
        pedido,
        objectKey: fotoObjectKey(pedido.id, k),
        cor: CORES[(n - 1) % CORES.length],
      });
    }),
  ),
);

/** Caminho no bucket: demo-h120/<uuid_do_pedido>/<n>.png (desenho §2). */
export function fotoObjectKey(pedidoId, k) {
  return `${DEMO_STORAGE_PREFIX}${pedidoId}/${k}.png`;
}

export const CONTAGENS_CAMADA2 = Object.freeze({
  pedidos: PEDIDOS.length,
  aceites: ACEITES.length,
  conversas: ACEITES.length,
  mensagens: MENSAGENS.length,
  fotos: FOTOS.length,
});

// SQL de escrita: insert com id fixo e verificacao previa de existencia (triggers BEFORE INSERT disparam
// antes do on conflict, por isso a reexecucao nao chama insert para linha que ja existe).
export const SQL2 = Object.freeze({
  existe: (tabela) => `select count(*)::int as n from ${tabela} where id = $1`,
  pedido: `insert into app.service_request (id, customer_user_id, is_republication, service_id, urgency, description,
             status, version, published_at, acceptance_deadline_at, acceptances_count, exact_point, match_point,
             geocode_mode, geocoded_at, public_label, address_text_enc, first_name)
           values ($1, $2, false, $3, 'nao_definido', $4, 'publicado', 1, now(), now() + interval '7 days', 0,
             extensions.st_setsrid(extensions.st_makepoint($5::float8, $6::float8), 4326)::extensions.geography,
             extensions.st_setsrid(extensions.st_makepoint($5::float8, $6::float8), 4326)::extensions.geography,
             'permanent', now(), $7, $8, $9)`,
  aceite: `insert into app.acceptance (id, request_id, professional_id, identity_id, slot_no, status, accepted_at, created_at)
           values ($1, $2, $3, null, $4, 'ativo', now(), now())`,
  // Mantem acceptances_count igual ao numero de aceites do pedido (o gatilho de slot le esse contador).
  contagemPedido: `update app.service_request set acceptances_count = (select count(*)::int from app.acceptance
                     where request_id = $1)
                   where id = $1
                     and acceptances_count <> (select count(*)::int from app.acceptance where request_id = $1)`,
  conversa: `insert into app.conversation (id, request_id, customer_user_id, professional_id, acceptance_id, state)
             values ($1, $2, $3, $4, $5, 'ativa')`,
  mensagemSistema: `insert into app.message (id, conversation_id, kind, sender_user_id, client_message_id, system_event,
                      params, template_version, dedupe_key, body_text, created_at, state)
                    values ($1, $2, 'sistema', null, null, 'aceite', $3::jsonb, 1, $4, null, now(), 'enviada')`,
  mensagemHumana: `insert into app.message (id, conversation_id, kind, sender_user_id, client_message_id, system_event,
                     params, template_version, dedupe_key, body_text, created_at, state)
                   values ($1, $2, 'humana', $3, $4, null, '{}'::jsonb, null, null, $5, now(), 'enviada')`,
  foto: `insert into app.media_asset (id, owner_kind, owner_id, uploader_user_id, bucket, object_key, declared_mime,
            detected_mime, bytes, status, exif_stripped, width, height, created_at)
          values ($1, 'request', $2, $3, $4, $5, 'image/png', 'image/png', $6, 'ready', true, $7, $8, now())`,
});

/** Cifra de um campo de texto (AES-256-GCM; versao | nonce | tag | corpo; AAD doc1|<dono>|<campo>). [NAO VERIFICADO] contra a API. */
export function sealCampo(encKey, version, donoId, campo, texto) {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', encKey, nonce);
  cipher.setAAD(Buffer.from(`doc1|${donoId}|${campo}`, 'utf8'));
  const corpo = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([version]), nonce, cipher.getAuthTag(), corpo]);
}

const CRC_TABELA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABELA[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunkPng(tipo, dados) {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length, 0);
  const tipoEDados = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tipoEDados), 0);
  return Buffer.concat([tamanho, tipoEDados, crc]);
}

/**
 * PNG de cor solida gerado em memoria. So os chunks IHDR, IDAT e IEND: nenhum EXIF, texto ou GPS.
 * Largura e altura limitadas pelo modelo (<= 1280 para fotos de pedido).
 */
export function pngSolido(largura, altura, [r, g, b]) {
  if (!Number.isInteger(largura) || !Number.isInteger(altura) || largura < 1 || altura < 1) {
    throw new Error('dimensao de foto invalida');
  }
  if (Math.max(largura, altura) > 1280) throw new Error('dimensao de foto acima do limite');
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; // profundidade de bit
  ihdr[9] = 2; // RGB
  const linha = Buffer.alloc(1 + largura * 3);
  for (let x = 0; x < largura; x += 1) {
    linha[1 + x * 3] = r;
    linha[2 + x * 3] = g;
    linha[3 + x * 3] = b;
  }
  const bruto = Buffer.concat(Array.from({ length: altura }, () => linha));
  return Buffer.concat([
    PNG_SIG,
    chunkPng('IHDR', ihdr),
    chunkPng('IDAT', deflateSync(bruto)),
    chunkPng('IEND', Buffer.alloc(0)),
  ]);
}

/** Lista de chunks de um PNG (tipos em ordem). Usado pelos testes de ausencia de metadados. */
export function tiposDeChunks(png) {
  const tipos = [];
  let pos = PNG_SIG.length;
  while (pos + 8 <= png.length) {
    const tamanho = png.readUInt32BE(pos);
    tipos.push(png.toString('ascii', pos + 4, pos + 8));
    pos += 12 + tamanho;
  }
  return tipos;
}

/**
 * Host local de uma URL do Storage. Remoto = null (sem envio). Nunca imprime a URL nem a chave.
 * Devolve a base normalizada ou null.
 */
export function baseStorageLocal(url) {
  if (typeof url !== 'string' || url === '') return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!LOCAL_HOSTS.has(host)) return null;
  return `${u.protocol}//${u.host}`;
}

/**
 * Cliente de Storage restrito ao bucket de fotos e ao prefixo de demo. Devolve null se a URL nao for local
 * ou se faltar a chave: nesse caso nenhuma foto e enviada e nenhum objeto e apagado.
 */
export function criarStorageDemo({ url, chave, fetchImpl }) {
  const base = baseStorageLocal(url);
  if (base === null || typeof chave !== 'string' || chave.trim() === '') return null;
  const chaveLimpa = chave.trim();
  const f = fetchImpl ?? globalThis.fetch;

  async function chamar(metodo, caminho, { corpo, tipo, extras = {} } = {}) {
    const headers = { authorization: `Bearer ${chaveLimpa}`, apikey: chaveLimpa, ...extras };
    if (tipo) headers['content-type'] = tipo;
    const res = await f(`${base}${caminho}`, { method: metodo, headers, body: corpo });
    if (!res.ok) throw new Error(`storage: resposta ${res.status} em ${metodo}`);
    return res;
  }

  async function listarEm(prefixo) {
    const res = await chamar('POST', `/storage/v1/object/list/${BUCKET_FOTOS}`, {
      corpo: JSON.stringify({ prefix: prefixo, limit: 1000, offset: 0 }),
      tipo: 'application/json',
    });
    const itens = await res.json();
    const achados = [];
    for (const item of itens) {
      if (item.id === null || item.id === undefined) {
        achados.push(...(await listarEm(`${prefixo}${item.name}/`)));
      } else {
        achados.push(`${prefixo}${item.name}`);
      }
    }
    return achados;
  }

  return Object.freeze({
    /** Envia um objeto (upsert). */
    async subir(caminho, bytes) {
      await chamar('POST', `/storage/v1/object/${BUCKET_FOTOS}/${caminho}`, {
        corpo: bytes,
        tipo: 'image/png',
        extras: { 'x-upsert': 'true' },
      });
    },
    /** Lista recursivamente os caminhos de objetos sob o prefixo (pastas tem id nulo). */
    listar: (prefixo = DEMO_STORAGE_PREFIX) => listarEm(prefixo),
    /** Apaga objetos pelo caminho completo. Lista vazia nao chama a API. */
    async remover(caminhos) {
      if (caminhos.length === 0) return;
      await chamar('DELETE', `/storage/v1/object/${BUCKET_FOTOS}`, {
        corpo: JSON.stringify({ prefixes: caminhos }),
        tipo: 'application/json',
      });
    },
  });
}
