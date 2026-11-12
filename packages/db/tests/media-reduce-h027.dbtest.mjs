// H-027 (Issue #40) | Reducao das fotos: criterios que dependem de Postgres (docs/factory/93-DESENHO-H027.md, §7;
// R-13, R-14). Migracoes 20261112120000 (#39) e 20261112140000 (#40) aplicadas DENTRO da transacao de cada teste e
// desfeitas com rollback: nada persiste no banco. Erros esperados usam savepoint.
// NAO cobertos aqui (NAO_EXECUTADO): concorrencia entre duas conexoes com commit (R-14, begin com duas conexoes;
// exige banco descartavel); Storage local (R-02, R-15; exige Docker ou npx supabase local).
// Rodar sozinho: node --test --test-concurrency=1 packages/db/tests/media-reduce-h027.dbtest.mjs
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
const DESFAZER_LER = (nome) =>
  readFileSync(join(REPO_ROOT, 'supabase', 'rollbacks', `${nome}.down.sql`), 'utf8')
    .split(/\r?\n/)
    .filter((linha) => !/^\s*(begin|commit)\s*;\s*$/i.test(linha))
    .join('\n');

const MIG_39 = LER('20261112120000_media_create_asset_quarantine');
const MIG_40 = LER('20261112140000_media_expand_reduce_ready');
const DOWN_40 = DESFAZER_LER('20261112140000_media_expand_reduce_ready');

const sha = (s) => createHash('sha256').update(s).digest('hex');
const IP = sha('ip-sintetico');
const MIN = 60_000;
const T0 = Date.parse('2099-01-01T12:00:00.000Z');
const at = (ms) => new Date(ms).toISOString();
const cu = () => randomUUID();
const LEASE = 30;

/** Transacao de teste: aplica as duas migracoes e desfaz tudo no fim. */
async function tx(fn) {
  await client.query('begin');
  try {
    await client.query(MIG_39);
    await client.query(MIG_40);
    return await fn();
  } finally {
    await client.query('rollback');
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
  return rows[0];
}

async function confirmar(segredo, id, ms) {
  const { rows } = await client.query(
    `select out_code from private.media_finalize($1::text, $2::uuid, 1000, $3::timestamptz)`,
    [sha(segredo), id, at(ms)],
  );
  return rows[0].out_code;
}

async function comecar(segredo, id, ms, lease = LEASE) {
  const { rows } = await client.query(
    `select out_code, out_attempt, out_reject_code, out_original_pending from private.media_reduce_begin($1::text, $2::uuid, $3::timestamptz, $4::integer)`,
    [sha(segredo), id, at(ms), lease],
  );
  return rows[0];
}

async function pronta(segredo) {
  const s = segredo;
  const draft = await rascunho(s);
  const a = await emitir(s);
  await confirmar(s, a.out_id, T0 + MIN);
  return { draft, id: a.out_id, segredo: s };
}

async function colunas() {
  const { rows } = await client.query(
    `select column_name from information_schema.columns where table_schema = 'app' and table_name = 'media_asset'`,
  );
  return new Set(rows.map((r) => r.column_name));
}

async function comSavepoint(fn) {
  await client.query('savepoint sp');
  try {
    await fn();
    await client.query('release savepoint sp');
    return null;
  } catch (erro) {
    await client.query('rollback to savepoint sp');
    return erro;
  }
}

test('R-13: colunas novas existem e nenhuma coluna de nome, caminho, EXIF, IP ou tipo detectado', () =>
  tx(async () => {
    const c = await colunas();
    for (const n of ['ready_at', 'ready_bytes', 'ready_width', 'ready_height', 'reject_code',
      'reduce_lease_until', 'reduce_attempts', 'original_removed_at']) {
      assert.ok(c.has(n), `coluna ${n}`);
    }
    for (const proibida of ['path', 'caminho', 'file_name', 'nome', 'exif', 'ip', 'detected_type', 'storage_path']) {
      assert.equal(c.has(proibida), false, `coluna proibida ${proibida}`);
    }
  }));

test('R-13: restricoes barram ready_bytes acima de 750000, dimensao acima de 1280 e reject_code fora da lista', () =>
  tx(async () => {
    const p = await pronta('B'.repeat(43));
    const bytesAlto = await comSavepoint(() =>
      client.query(`update app.media_asset set status = 'ready', ready_at = now(), ready_bytes = 750001,
        ready_width = 10, ready_height = 10 where id = $1`, [p.id]));
    assert.ok(bytesAlto, 'ready_bytes > 750000 deve falhar');
    const dimAlta = await comSavepoint(() =>
      client.query(`update app.media_asset set status = 'ready', ready_at = now(), ready_bytes = 1000,
        ready_width = 1281, ready_height = 10 where id = $1`, [p.id]));
    assert.ok(dimAlta, 'largura > 1280 deve falhar');
    const codigo = await comSavepoint(() =>
      client.query(`update app.media_asset set status = 'rejected', reject_code = 'texto_livre' where id = $1`, [p.id]));
    assert.ok(codigo, 'reject_code fora da lista deve falhar');
  }));

test('R-13: ready sem colunas e colunas sem ready sao barrados (SQL direto)', () =>
  tx(async () => {
    const p = await pronta('C'.repeat(43));
    const semColunas = await comSavepoint(() =>
      client.query(`update app.media_asset set status = 'ready' where id = $1`, [p.id]));
    assert.ok(semColunas, 'ready sem colunas deve falhar');
    const colunaSolta = await comSavepoint(() =>
      client.query(`update app.media_asset set ready_bytes = 1000 where id = $1`, [p.id]));
    assert.ok(colunaSolta, 'ready_bytes sem ready deve falhar');
  }));

test('R-14: begin toma lease; segunda chamada com lease ativa recebe busy; done grava ready para a tentativa dona', () =>
  tx(async () => {
    const s = 'D'.repeat(43);
    const p = await pronta(s);
    const b1 = await comecar(s, p.id, T0 + 2 * MIN);
    assert.equal(b1.out_code, 'begin');
    assert.equal(b1.out_attempt, 1);
    const b2 = await comecar(s, p.id, T0 + 2 * MIN + 1000);
    assert.equal(b2.out_code, 'busy');
    const { rows } = await client.query(
      `select out_code from private.media_reduce_done($1::uuid, $2::smallint, 500000, 960, 1280, $3::timestamptz)`,
      [p.id, b1.out_attempt, at(T0 + 2 * MIN + 2000)],
    );
    assert.equal(rows[0].out_code, 'done');
    const { rows: r2 } = await client.query(`select out_id, out_status, out_confirmed from private.media_get($1::text, $2::uuid, $3::timestamptz)`, [sha(s), p.id, at(T0 + 3 * MIN)]);
    assert.equal(r2[0].out_status, 'ready');
    const d = await comecar(s, p.id, T0 + 3 * MIN);
    assert.equal(d.out_code, 'ready');
    assert.equal(d.out_original_pending, true);
  }));

test('R-14: lease vencida: outra tentativa assume e a antiga recebe lost em done', () =>
  tx(async () => {
    const s = 'E'.repeat(43);
    const p = await pronta(s);
    const b1 = await comecar(s, p.id, T0 + 2 * MIN, 5);
    const b2 = await comecar(s, p.id, T0 + 2 * MIN + 6000, 5);
    assert.equal(b2.out_code, 'begin');
    assert.equal(b2.out_attempt, 2);
    const velho = await client.query(
      `select out_code from private.media_reduce_done($1::uuid, $2::smallint, 1000, 100, 100, $3::timestamptz)`,
      [p.id, b1.out_attempt, at(T0 + 2 * MIN + 7000)],
    );
    assert.equal(velho.rows[0].out_code, 'lost');
  }));

test('R-14: done com a linha marcada para expurgo devolve gone', () =>
  tx(async () => {
    const s = 'F'.repeat(43);
    const p = await pronta(s);
    const b = await comecar(s, p.id, T0 + 2 * MIN);
    await client.query(`update app.media_asset set purge_requested_at = $2 where id = $1`, [p.id, at(T0 + 2 * MIN)]);
    const { rows } = await client.query(
      `select out_code from private.media_reduce_done($1::uuid, $2::smallint, 1000, 100, 100, $3::timestamptz)`,
      [p.id, b.out_attempt, at(T0 + 2 * MIN + 1000)],
    );
    assert.equal(rows[0].out_code, 'gone');
  }));

test('R-14: release com count false devolve a tentativa; a quarta chamada com 3 contadas vira rejected nao_processavel', () =>
  tx(async () => {
    const s = 'G'.repeat(43);
    const p = await pronta(s);
    const b1 = await comecar(s, p.id, T0 + 2 * MIN);
    await client.query(`select private.media_reduce_release($1::uuid, $2::smallint, false)`, [p.id, b1.out_attempt]);
    const again = await comecar(s, p.id, T0 + 2 * MIN + 1000);
    assert.equal(again.out_attempt, 1, 'tentativa devolvida volta a 1');
    for (let i = 0; i < 3; i++) {
      const b = i === 0 ? again : await comecar(s, p.id, T0 + 3 * MIN + i * 60_000);
      assert.equal(b.out_code, 'begin');
      await client.query(`select private.media_reduce_release($1::uuid, $2::smallint, true)`, [p.id, b.out_attempt]);
    }
    const quarta = await comecar(s, p.id, T0 + 10 * MIN);
    assert.equal(quarta.out_code, 'rejected');
    assert.equal(quarta.out_reject_code, 'nao_processavel');
    assert.equal(quarta.out_original_pending, true);
  }));

test('R-14: reject grava o codigo fixo; codigo fora da lista e barrado; cleanup lista so ready ou rejected sem original removido', () =>
  tx(async () => {
    const s = 'H'.repeat(43);
    const p = await pronta(s);
    const b = await comecar(s, p.id, T0 + 2 * MIN);
    const fora = await comSavepoint(() =>
      client.query(`select out_code from private.media_reduce_reject($1::uuid, $2::smallint, 'texto', $3::timestamptz)`, [p.id, b.out_attempt, at(T0)]));
    assert.ok(fora, 'codigo fora da lista deve falhar');
    const { rows } = await client.query(
      `select out_code from private.media_reduce_reject($1::uuid, $2::smallint, 'imagem_invalida', $3::timestamptz)`,
      [p.id, b.out_attempt, at(T0 + 2 * MIN)],
    );
    assert.equal(rows[0].out_code, 'rejected');
    const lista = await client.query(`select private.media_original_cleanup_list(100) as ids`);
    assert.ok(lista.rows[0].ids.map(String).includes(p.id));
    const removido = await client.query(`select private.media_original_removed($1::uuid, $2::timestamptz) as ok`, [p.id, at(T0 + 3 * MIN)]);
    assert.equal(removido.rows[0].ok, true);
    const depois = await client.query(`select private.media_original_cleanup_list(100) as ids`);
    assert.equal(depois.rows[0].ids.map(String).includes(p.id), false);
  }));

test('R-14: grants: anon, authenticated, service_role e PUBLIC sem execute; app_api com execute; search_path vazio', () =>
  tx(async () => {
    const funcoes = [
      'private.media_reduce_begin(text,uuid,timestamptz,integer)',
      'private.media_reduce_done(uuid,smallint,integer,integer,integer,timestamptz)',
      'private.media_reduce_reject(uuid,smallint,text,timestamptz)',
      'private.media_reduce_release(uuid,smallint,boolean)',
      'private.media_original_removed(uuid,timestamptz)',
      'private.media_original_cleanup_list(integer)',
    ];
    for (const f of funcoes) {
      for (const papel of ['anon', 'authenticated', 'service_role', 'public']) {
        const { rows } = await client.query(`select has_function_privilege($1, $2, 'execute') as ok`, [papel, f]);
        assert.equal(rows[0].ok, false, `${papel} nao executa ${f}`);
      }
      const { rows } = await client.query(`select has_function_privilege('app_api', $1, 'execute') as ok`, [f]);
      assert.equal(rows[0].ok, true, `app_api executa ${f}`);
    }
  }));

test('R-14: migracao aplicada duas vezes nao gera erro', () =>
  tx(async () => {
    await client.query(MIG_40);
    await client.query(MIG_40);
  }));

test('R-14 (reversao): desfazer recusa quando ha foto ready', () =>
  tx(async () => {
    const p = await pronta('J'.repeat(43));
    await client.query(`select private.media_reduce_begin($1::text, $2::uuid, $3::timestamptz, 30)`, [sha('J'.repeat(43)), p.id, at(T0 + 2 * MIN)]);
    await client.query(`update app.media_asset set status = 'rejected', reject_code = 'imagem_invalida' where id = $1`, [p.id]);
    const erro = await comSavepoint(() => client.query(DOWN_40));
    assert.ok(erro, 'desfazer deve recusar com foto rejected');
    assert.match(String(erro.message), /media_desfazer_recusado/);
  }));
