// H-029 (Issue #42) | Pre-visualizacao, exclusao e reordenacao das fotos: criterios que dependem de Postgres
// (docs/factory/98-DESENHO-H029.md, §2, §3 e §7; G-06, G-08, G-10; CA-05 a CA-08, CA-10).
// Migracao 20261112190000 reaplicada DENTRO da transacao de cada teste (prova de idempotencia) e desfeita com
// rollback: nada persiste no banco de desenvolvimento. Erros esperados usam savepoint.
// NAO cobertos aqui (NAO_EXECUTADO): concorrencia entre duas conexoes com commit (G-08, exige banco descartavel).
// Rodar sozinho: node --test --test-concurrency=1 packages/db/tests/media-gallery-h029.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, REPO_ROOT } from '../scripts/lib/env.mjs';

let client;
before(async () => {
  client = await connect();
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
const IP = sha('ip-sintetico');
const MIN = 60_000;
const T0 = Date.parse('2099-01-01T12:00:00.000Z');
const at = (ms) => new Date(ms).toISOString();
const cu = () => randomUUID();

/** Transacao de teste: reaplica as migracoes necessarias e desfaz tudo no fim. */
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

async function erroEm(sql, params = []) {
  await client.query('savepoint e');
  try {
    await client.query(sql, params);
    return null;
  } catch (err) {
    await client.query('rollback to savepoint e');
    return err;
  }
}

async function rascunho(segredo, ms = T0) {
  const { rows } = await client.query(
    `select out_id from private.draft_create($1::text, $2::text, $3::timestamptz, $4::integer,
       null::text, '{}'::jsonb, 1000000)`,
    [sha(segredo), IP, at(ms), 7],
  );
  return rows[0].out_id;
}

async function emitir(segredo, ms = T0, bytes = 1000) {
  const { rows } = await client.query(
    `select out_code, out_id from private.media_issue($1::text, $2::uuid, 'image/jpeg', $3::integer, $4::timestamptz, 150)`,
    [sha(segredo), cu(), bytes, at(ms)],
  );
  return rows[0].out_id;
}

async function listar(segredo, ms = T0) {
  const { rows } = await client.query('select * from private.media_list($1::text, $2::timestamptz)', [sha(segredo), at(ms)]);
  return rows;
}

async function estadoDoRascunho(id) {
  const { rows } = await client.query('select content_rev, photo_rev, confirmed_at from app.request_draft where id = $1', [id]);
  return rows[0];
}

/** Estados diretos (teste de dados): a reducao real e de H-027; aqui so se grava o resultado. */
async function confirmada(id, lease = null) {
  await client.query(
    'update app.media_asset set confirmed_at = $2, confirmed_bytes = 1000, reduce_lease_until = $3 where id = $1',
    [id, at(T0), lease === null ? null : at(lease)],
  );
}
async function pronta(id) {
  await client.query(
    `update app.media_asset set status = 'ready', confirmed_at = $2, confirmed_bytes = 1000, ready_at = $2,
       ready_bytes = 900, ready_width = 800, ready_height = 600, reduce_lease_until = null where id = $1`,
    [id, at(T0)],
  );
}
async function recusada(id, code = 'imagem_invalida') {
  await client.query(
    `update app.media_asset set status = 'rejected', confirmed_at = $2, confirmed_bytes = 1000, reject_code = $3,
       reduce_lease_until = null where id = $1`,
    [id, at(T0), code],
  );
}

test('G-10 migracao reaplicavel e so app_api executa as funcoes novas', async () => {
  await tx(async () => {
    const { rows } = await client.query(
      `select has_function_privilege('app_api', 'private.media_list(text,timestamptz)', 'execute') as api,
              has_function_privilege('anon', 'private.media_list(text,timestamptz)', 'execute') as anon,
              has_function_privilege('authenticated', 'private.media_delete(text,uuid,timestamptz)', 'execute') as auth,
              has_function_privilege('public', 'private.media_reorder(text,uuid[],uuid[],timestamptz)', 'execute') as publico,
              has_function_privilege('app_api', 'private.media_asset_ordem()', 'execute') as gatilho`,
    );
    assert.equal(rows[0].api, true);
    assert.equal(rows[0].anon, false);
    assert.equal(rows[0].auth, false);
    assert.equal(rows[0].publico, false);
    assert.equal(rows[0].gatilho, false);
    // Reaplicar a migracao nao gera erro (idempotencia): a transacao ja a aplicou uma vez.
    await client.query(MIG_29);
  });
});

test('G-08 gatilho de ordem: nomes em ordem alfabetica, max+1 e sem repetir posicao', async () => {
  await tx(async () => {
    const { rows: gatilhos } = await client.query(
      `select tgname from pg_trigger where tgrelid = 'app.media_asset'::regclass and not tgisinternal order by tgname`,
    );
    const nomes = gatilhos.map((g) => g.tgname);
    assert.ok(nomes.indexOf('media_asset_limite') < nomes.indexOf('media_asset_ordem'), 'limite roda antes da ordem');

    const seg = 'A'.repeat(43);
    const d = await rascunho(seg);
    const a = await emitir(seg);
    const b = await emitir(seg);
    const c = await emitir(seg);
    const { rows } = await client.query('select id, sort_order from app.media_asset where draft_id = $1 order by sort_order', [d]);
    assert.deepEqual(rows.map((r) => r.id), [a, b, c]);
    assert.deepEqual(rows.map((r) => r.sort_order), [1, 2, 3]);
  });
});

test('G-08 preenchimento das linhas antigas: sort_order por rascunho, por created_at e id', async () => {
  await tx(async () => {
    const seg = 'B'.repeat(43);
    const d = await rascunho(seg);
    const a = await emitir(seg, T0);
    const b = await emitir(seg, T0 + MIN);
    // Simula linhas anteriores a migracao: solta a obrigatoriedade, zera a posicao e reaplica a migracao.
    await client.query('alter table app.media_asset alter column sort_order drop not null');
    await client.query('update app.media_asset set sort_order = null where draft_id = $1', [d]);
    await client.query(MIG_29);
    const { rows } = await client.query('select id, sort_order from app.media_asset where draft_id = $1 order by sort_order', [d]);
    assert.deepEqual(rows.map((r) => r.id), [a, b]);
    assert.deepEqual(rows.map((r) => r.sort_order), [1, 2]);
  });
});

test('G-01 listagem: estados derivados, posicoes 1..N e recusadas no fim sem posicao', async () => {
  await tx(async () => {
    const seg = 'C'.repeat(43);
    await rascunho(seg);
    const enviando = await emitir(seg);
    const processando = await emitir(seg);
    const aguardando = await emitir(seg);
    const pronta1 = await emitir(seg);
    const rejeitada = await emitir(seg);
    await confirmada(processando, T0 + 30_000);
    await confirmada(aguardando, null);
    await pronta(pronta1);
    await recusada(rejeitada, 'nao_processavel');

    const linhas = await listar(seg);
    assert.deepEqual(
      linhas.map((l) => [l.out_id, l.out_state, l.out_pos, l.out_reject_code]),
      [
        [enviando, 'enviando', 1, null],
        [processando, 'processando', 2, null],
        [aguardando, 'aguardando', 3, null],
        [pronta1, 'pronta', 4, null],
        [rejeitada, 'recusada', null, 'nao_processavel'],
      ],
    );
  });
});

test('G-01 listagem: rascunho sem foto = uma linha sem id; inexistente = zero linhas', async () => {
  await tx(async () => {
    const seg = 'D'.repeat(43);
    await rascunho(seg);
    const vazio = await listar(seg);
    assert.equal(vazio.length, 1);
    assert.equal(vazio[0].out_id, null);
    const nada = await listar('E'.repeat(43));
    assert.equal(nada.length, 0);
  });
});

test('G-01 pendente vencido some da lista e libera a vaga (mesma liberacao de media_issue)', async () => {
  await tx(async () => {
    const seg = 'F'.repeat(43);
    await rascunho(seg);
    const id = await emitir(seg, T0);
    assert.equal((await listar(seg, T0 + 1 * MIN))[0].out_id, id);
    const depois = await listar(seg, T0 + 31 * MIN);
    assert.equal(depois.length, 1);
    assert.equal(depois[0].out_id, null);
  });
});

test('G-06 exclusao: marca uma vez, soma photo_rev, zera a confirmacao e a segunda chamada e "already"', async () => {
  await tx(async () => {
    const seg = 'G'.repeat(43);
    const d = await rascunho(seg);
    const id = await emitir(seg);
    await pronta(id);
    await client.query('update app.request_draft set confirmed_at = $2 where id = $1', [d, at(T0)]);
    const antes = await estadoDoRascunho(d);
    assert.notEqual(antes.confirmed_at, null);

    const primeira = await client.query('select out_code from private.media_delete($1::text, $2::uuid, $3::timestamptz)', [sha(seg), id, at(T0 + MIN)]);
    assert.equal(primeira.rows[0].out_code, 'deleted');
    const depois = await estadoDoRascunho(d);
    assert.equal(depois.photo_rev, antes.photo_rev + 1);
    assert.equal(depois.content_rev, antes.content_rev + 1);
    assert.equal(depois.confirmed_at, null);

    const segunda = await client.query('select out_code from private.media_delete($1::text, $2::uuid, $3::timestamptz)', [sha(seg), id, at(T0 + 2 * MIN)]);
    assert.equal(segunda.rows[0].out_code, 'already');
    assert.equal((await estadoDoRascunho(d)).photo_rev, depois.photo_rev, 'segunda chamada nao soma');

    const linhas = await listar(seg, T0 + 3 * MIN);
    assert.equal(linhas[0].out_id, null, 'foto excluida sai da lista');
  });
});

test('G-06 exclusao de foto alheia ou de outro rascunho e not_found (sem efeito)', async () => {
  await tx(async () => {
    const seg = 'H'.repeat(43);
    const outro = 'I'.repeat(43);
    await rascunho(seg);
    await rascunho(outro);
    const id = await emitir(seg);
    const r = await client.query('select out_code from private.media_delete($1::text, $2::uuid, $3::timestamptz)', [sha(outro), id, at(T0)]);
    assert.equal(r.rows[0].out_code, 'not_found');
    assert.equal((await listar(seg))[0].out_id, id, 'a foto continua do dono');
  });
});

test('G-08 reordenacao: ok grava 1..N e soma photo_rev; obsoleta = changed; igual = unchanged; invalida = invalid', async () => {
  await tx(async () => {
    const seg = 'J'.repeat(43);
    const d = await rascunho(seg);
    const a = await emitir(seg);
    const b = await emitir(seg);
    const c = await emitir(seg);
    const hash = sha(seg);
    const r = (cur, nova) =>
      client.query('select out_code from private.media_reorder($1::text, $2::uuid[], $3::uuid[], $4::timestamptz)', [hash, cur, nova, at(T0)]);
    const antes = await estadoDoRascunho(d);

    assert.equal((await r([a, b, c], [a, b, c])).rows[0].out_code, 'unchanged');
    assert.equal((await estadoDoRascunho(d)).photo_rev, antes.photo_rev, 'igual nao escreve nem soma');

    assert.equal((await r([a, b, c], [a, b])).rows[0].out_code, 'invalid');
    assert.equal((await r([a, b, c], [a, b, b])).rows[0].out_code, 'invalid');
    assert.equal((await r([b, a, c], [a, b, c])).rows[0].out_code, 'changed', 'lista atual diferente');

    assert.equal((await r([a, b, c], [c, a, b])).rows[0].out_code, 'ok');
    const linhas = await listar(seg);
    assert.deepEqual(linhas.map((l) => [l.out_id, l.out_pos]), [[c, 1], [a, 2], [b, 3]]);
    const depois = await estadoDoRascunho(d);
    assert.equal(depois.photo_rev, antes.photo_rev + 1);
    assert.equal(depois.confirmed_at, null);

    assert.equal((await r([a, b, c], [c, a, b])).rows[0].out_code, 'changed', 'a repeticao da mesma troca vira changed');
  });
});

test('G-08 exclusao e recusa nao deixam buraco na sequencia exposta', async () => {
  await tx(async () => {
    const seg = 'K'.repeat(43);
    await rascunho(seg);
    const a = await emitir(seg);
    const b = await emitir(seg);
    const c = await emitir(seg);
    await pronta(a);
    await pronta(b);
    await pronta(c);
    await client.query('select out_code from private.media_delete($1::text, $2::uuid, $3::timestamptz)', [sha(seg), b, at(T0)]);
    const linhas = await listar(seg);
    assert.deepEqual(linhas.map((l) => [l.out_id, l.out_pos]), [[a, 1], [c, 2]]);
  });
});

test('G-06 leitura da versao reduzida: so dono, so pronta e so viva', async () => {
  await tx(async () => {
    const seg = 'L'.repeat(43);
    await rascunho(seg);
    const pronto = await emitir(seg);
    const pendente = await emitir(seg);
    await pronta(pronto);
    const alvo = (hash, id, ms = T0) =>
      client.query('select out_bytes from private.media_read_target($1::text, $2::uuid, $3::timestamptz)', [hash, id, at(ms)]);
    assert.equal((await alvo(sha(seg), pronto)).rows[0].out_bytes, 900);
    assert.equal((await alvo(sha(seg), pendente)).rows.length, 0, 'pendente nao serve');
    assert.equal((await alvo(sha('M'.repeat(43)), pronto)).rows.length, 0, 'outro dono nao serve');
    await client.query('select out_code from private.media_delete($1::text, $2::uuid, $3::timestamptz)', [sha(seg), pronto, at(T0)]);
    assert.equal((await alvo(sha(seg), pronto)).rows.length, 0, 'excluida nao serve');
  });
});

test('G-10 o guarda de confirmacao continua recusando mudanca de conteudo (teste da #43 em forma minima)', async () => {
  await tx(async () => {
    const seg = 'N'.repeat(43);
    const d = await rascunho(seg);
    await client.query(`update app.request_draft set description = 'texto novo' where id = $1`, [d]);
    const r = await estadoDoRascunho(d);
    assert.equal(r.content_rev, 1, 'conteudo soma content_rev');
    assert.equal(r.photo_rev, 0, 'photo_rev nao muda sem foto');
    const err = await erroEm(`update app.request_draft set confirmed_at = now(), description = 'outro' where id = $1`, [d]);
    assert.ok(err, 'confirmar junto com mudanca de conteudo continua proibido');
  });
});
