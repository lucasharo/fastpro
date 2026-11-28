// E3 (Issue 141, CA-09) | dbtest do adaptador PgMediaGallery (packages/db/src/media-gallery.ts) contra o banco de
// desenvolvimento: SQL_MEDIA_LIST / SQL_MEDIA_DELETE / SQL_MEDIA_REORDER / SQL_MEDIA_READ_TARGET, pela porta do
// adaptador (nao pelo SQL direto, como faz media-gallery-h029.dbtest.mjs). Cada teste roda em transacao com
// rollback: nada persiste no banco de desenvolvimento. Migracoes reaplicadas dentro da transacao (idempotencia).
// Rodar sozinho (o db:test completo NAO deve ser usado enquanto outros agentes usam o DEV):
//   node --test --test-concurrency=1 packages/db/tests/media-gallery.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, REPO_ROOT } from '../scripts/lib/env.mjs';
import {
  PgMediaGallery,
  SQL_MEDIA_LIST,
  SQL_MEDIA_DELETE,
  SQL_MEDIA_REORDER,
  SQL_MEDIA_READ_TARGET,
} from '../dist/media-gallery.js';

let client;
let galeria;
before(async () => {
  client = await connect();
  galeria = new PgMediaGallery(client);
});
after(async () => {
  await client?.end();
});

const LER = (nome) => readFileSync(join(REPO_ROOT, 'supabase', 'migrations', `${nome}.sql`), 'utf8');
const MIG_39 = LER('20261112120000_media_create_asset_quarantine');
const MIG_40 = LER('20261112140000_media_expand_reduce_ready');
const MIG_43 = LER('20261112150000_draft_expand_review_confirmation');
const MIG_29 = LER('20261112190000_media_expand_photo_order');

const sha = (s) => createHash('sha256').update(s).digest('hex');
const IP = sha('ip-sintetico-adaptador');
const MIN = 60_000;
const T0 = Date.parse('2099-01-01T12:00:00.000Z');
const at = (ms) => new Date(ms).toISOString();
const cu = () => randomUUID();

async function tx(fn) {
  await client.query('begin');
  try {
    await client.query(MIG_39);
    await client.query(MIG_40);
    await client.query(MIG_43);
    await client.query(MIG_29);
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

async function rascunho(segredo) {
  const { rows } = await client.query(
    `select out_id from private.draft_create($1::text, $2::text, $3::timestamptz, $4::integer,
       null::text, '{}'::jsonb, 1000000)`,
    [sha(segredo), IP, at(T0), 7],
  );
  return rows[0].out_id;
}

async function emitir(segredo, ms = T0) {
  const { rows } = await client.query(
    `select out_code, out_id from private.media_issue($1::text, $2::uuid, 'image/jpeg', $3::integer, $4::timestamptz, 150)`,
    [sha(segredo), cu(), 1000, at(ms)],
  );
  return rows[0].out_id;
}

async function pronta(id) {
  await client.query(
    `update app.media_asset set status = 'ready', confirmed_at = $2, confirmed_bytes = 1000, ready_at = $2,
       ready_bytes = 900, ready_width = 800, ready_height = 600, reduce_lease_until = null where id = $1`,
    [id, at(T0)],
  );
}

async function recusada(id) {
  await client.query(
    `update app.media_asset set status = 'rejected', confirmed_at = $2, confirmed_bytes = 1000, reject_code = $3,
       reduce_lease_until = null where id = $1`,
    [id, at(T0), 'nao_processavel'],
  );
}

test('CA-09 SQL_* do adaptador chama as funcoes private.media_* da migracao 20261112190000', () => {
  assert.match(SQL_MEDIA_LIST, /private\.media_list\(/);
  assert.match(SQL_MEDIA_DELETE, /private\.media_delete\(/);
  assert.match(SQL_MEDIA_REORDER, /private\.media_reorder\(/);
  assert.match(SQL_MEDIA_READ_TARGET, /private\.media_read_target\(/);
});

test('CA-09 list: fotos com estado, posicao e motivo; rascunho sem foto devolve linha sem id; desconhecido devolve null', async () => {
  await tx(async () => {
    const seg = 'P'.repeat(43);
    await rascunho(seg);
    const vazio = await galeria.list(sha(seg), T0);
    assert.equal(vazio.length, 1);
    assert.equal(vazio[0].id, null);
    assert.equal(vazio[0].posicao, null);

    const enviada = await emitir(seg);
    const pronto = await emitir(seg);
    const rejeitada = await emitir(seg);
    await pronta(pronto);
    await recusada(rejeitada);

    const linhas = await galeria.list(sha(seg), T0);
    assert.deepEqual(linhas, [
      { id: enviada, estado: 'enviando', motivo: null, posicao: 1 },
      { id: pronto, estado: 'pronta', motivo: null, posicao: 2 },
      { id: rejeitada, estado: 'recusada', motivo: 'nao_processavel', posicao: null },
    ]);
    assert.equal(await galeria.list(sha('Q'.repeat(43)), T0), null, 'segredo sem rascunho: null, nao lista vazia');
  });
});

test('CA-09 remove: deleted na primeira vez, already na repeticao, not_found para outro dono ou id inexistente', async () => {
  await tx(async () => {
    const seg = 'R'.repeat(43);
    await rascunho(seg);
    const foto = await emitir(seg);
    assert.equal(await galeria.remove(sha(seg), foto, T0 + MIN), 'deleted');
    assert.equal(await galeria.remove(sha(seg), foto, T0 + 2 * MIN), 'already');
    const outro = await emitir(seg);
    assert.equal(await galeria.remove(sha('S'.repeat(43)), outro, T0), 'not_found', 'outro dono');
    assert.equal(await galeria.remove(sha(seg), cu(), T0), 'not_found', 'id inexistente');
    const restante = await galeria.list(sha(seg), T0);
    assert.deepEqual(restante.map((l) => [l.id, l.posicao]), [[outro, 1]]);
  });
});

test('CA-09 reorder: ok com a ordem atual certa, changed quando a ordem atual mudou, invalid com lista incompleta', async () => {
  await tx(async () => {
    const seg = 'T'.repeat(43);
    await rascunho(seg);
    const a = await emitir(seg);
    const b = await emitir(seg);
    const c = await emitir(seg);
    const h = sha(seg);

    assert.equal(await galeria.reorder(h, [a, b, c], [b, a, c], T0), 'ok');
    const depois = await galeria.list(h, T0);
    assert.deepEqual(depois.map((l) => l.id), [b, a, c]);

    assert.equal(await galeria.reorder(h, [a, b, c], [c, a, b], T0), 'changed', 'ordem atual nao confere');
    assert.equal(await galeria.reorder(h, [b, a, c], [a, b], T0), 'invalid', 'nova ordem incompleta');
    assert.deepEqual((await galeria.list(h, T0)).map((l) => l.id), [b, a, c], 'recusa nao altera a ordem');
  });
});

test('CA-09 readTarget: bytes da versao reduzida so para dono e foto pronta e viva', async () => {
  await tx(async () => {
    const seg = 'U'.repeat(43);
    await rascunho(seg);
    const pronto = await emitir(seg);
    const pendente = await emitir(seg);
    await pronta(pronto);
    const h = sha(seg);

    assert.equal(await galeria.readTarget(h, pronto, T0), 900);
    assert.equal(await galeria.readTarget(h, pendente, T0), null, 'pendente nao serve');
    assert.equal(await galeria.readTarget(sha('V'.repeat(43)), pronto, T0), null, 'outro dono nao serve');
    assert.equal(await galeria.remove(h, pronto, T0), 'deleted');
    assert.equal(await galeria.readTarget(h, pronto, T0), null, 'excluida nao serve');
  });
});

test('CA-09 adaptador rejeita resposta de banco fora do contrato (sem eco do valor)', async () => {
  const falso = (rows) => ({ query: async () => ({ rows }) });
  const comFalha = new PgMediaGallery(falso([{ out_id: 'x', out_state: 'pronta', out_reject_code: null, out_pos: 'um' }]));
  await assert.rejects(comFalha.list(sha('W'.repeat(43)), T0), /galeria_resposta_invalida/);
  const codigoEstranho = new PgMediaGallery(falso([{ out_code: 'apagado_sem_motivo' }]));
  await assert.rejects(codigoEstranho.remove(sha('W'.repeat(43)), cu(), T0), /galeria_resposta_invalida/);
  const bytesZero = new PgMediaGallery(falso([{ out_bytes: 0 }]));
  await assert.rejects(bytesZero.readTarget(sha('W'.repeat(43)), cu(), T0), /galeria_resposta_invalida/);
});
