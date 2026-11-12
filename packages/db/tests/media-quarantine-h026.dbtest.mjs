// H-026 (Issue #39) | Quarentena de fotos: criterios que dependem de Postgres (docs/factory/88-DESENHO-H026.md, §7;
// M-02, M-03 (trigger), M-04, M-05 (SQL), M-07, M-11, M-14, reversao). Migracao 20261112120000 aplicada DENTRO da
// transacao de cada teste e desfeita com rollback: nada persiste no banco de desenvolvimento.
// Erros esperados usam savepoint (um erro no Postgres aborta a transacao inteira).
// NAO cobertos aqui (NAO_EXECUTADO): M-03 concorrencia entre duas conexoes (exige commit, so em banco descartavel);
// M-08 e M-15 (Storage local com papeis anon/authenticated e PUT real; exige Docker/npx supabase).
// Rodar sozinho: node --test --test-concurrency=1 packages/db/tests/media-quarantine-h026.dbtest.mjs
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

const NOME = '20261112120000_media_create_asset_quarantine';
const MIGRACAO = readFileSync(join(REPO_ROOT, 'supabase', 'migrations', `${NOME}.sql`), 'utf8');
const DESFAZER = readFileSync(join(REPO_ROOT, 'supabase', 'rollbacks', `${NOME}.down.sql`), 'utf8')
  .split(/\r?\n/)
  .filter((linha) => !/^\s*(begin|commit)\s*;\s*$/i.test(linha))
  .join('\n');

// Papeis que a propria migracao revoga (fonte unica: o revoke). 'public' e pseudo-papel e fica de fora.
// Usar a lista da migracao evita escrever nomes de papel de servico no teste; quem concede e a migracao.
const papeisRevogados = (regex) => {
  const nomes = new Set();
  for (const m of MIGRACAO.matchAll(regex)) {
    for (const r of m[1].split(',')) {
      const t = r.trim();
      if (t && t !== 'public') nomes.add(t);
    }
  }
  return [...nomes];
};
const PAPEIS_TABELA = papeisRevogados(/revoke all on app\.media_asset\s+from\s+([^;]+);/gi);
const PAPEIS_FUNCAO = papeisRevogados(/revoke all on function[\s\S]*?from\s+([^;]+);/gi);

const sha = (s) => createHash('sha256').update(s).digest('hex');
const IP = sha('ip-sintetico');
const MIN = 60_000;
const HORA = 3_600_000;
const DIA = 86_400_000;
const T0 = Date.parse('2099-01-01T12:00:00.000Z');
const at = (ms) => new Date(ms).toISOString();
const TTL_MS = 30 * MIN;
const MAX = 10_485_760;
const cu = () => randomUUID();

/** Transacao de teste: aplica a migracao e desfaz tudo no fim. */
async function tx(fn) {
  await client.query('begin');
  try {
    await client.query(MIGRACAO);
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

async function rascunho(segredo, ms = T0, ttlDias = 7) {
  const { rows } = await client.query(
    `select out_id from private.draft_create($1::text, $2::text, $3::timestamptz, $4::integer,
       null::text, '{}'::jsonb, 1000000)`,
    [sha(segredo), IP, at(ms), ttlDias],
  );
  return rows[0].out_id;
}

async function emitir(segredo, clientId, ms = T0, bytes = 1000, tipo = 'image/jpeg') {
  const { rows } = await client.query(
    `select out_code, out_id, out_status, out_confirmed from private.media_issue($1::text, $2::uuid, $3::text,
       $4::integer, $5::timestamptz, 150)`,
    [sha(segredo), clientId, tipo, bytes, at(ms)],
  );
  return rows[0];
}

async function finalizar(segredo, id, bytes, ms) {
  const { rows } = await client.query(
    `select out_code, out_id, out_status, out_confirmed from private.media_finalize($1::text, $2::uuid,
       $3::integer, $4::timestamptz)`,
    [sha(segredo), id, bytes, at(ms)],
  );
  return rows[0];
}

async function linha(id) {
  const { rows } = await client.query(
    'select status, confirmed_at, confirmed_bytes, pending_expires_at, purge_requested_at from app.media_asset where id = $1',
    [id],
  );
  return rows[0];
}

test('estrutura: RLS forcada, sem privilegio de API na tabela, bucket privado, sem politica em storage.objects', () =>
  tx(async () => {
    const { rows: [t] } = await client.query(
      "select relrowsecurity, relforcerowsecurity from pg_class where oid = 'app.media_asset'::regclass",
    );
    assert.equal(t.relrowsecurity, true);
    assert.equal(t.relforcerowsecurity, true);
    assert.ok(PAPEIS_TABELA.includes('app_api') && PAPEIS_TABELA.length >= 4, 'a migracao revoga de papeis de API e de sistema');
    for (const papel of PAPEIS_TABELA) {
      const { rows: [p] } = await client.query(
        "select has_table_privilege($1, 'app.media_asset', 'select,insert,update,delete') as ok",
        [papel],
      );
      assert.equal(p.ok, false, `${papel} nao pode fazer DML em app.media_asset`);
    }
    const { rows: [b] } = await client.query(
      "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'quarantine'",
    );
    assert.equal(b.public, false);
    assert.equal(Number(b.file_size_limit), MAX);
    assert.deepEqual([...b.allowed_mime_types].sort(), ['image/jpeg', 'image/png', 'image/webp']);
    const { rows: [p] } = await client.query(
      `select count(*)::int as n from pg_policies where schemaname = 'storage' and tablename = 'objects'
         and (coalesce(qual, '') || coalesce(with_check, '')) like '%quarantine%'`,
    );
    assert.equal(p.n, 0, 'nenhuma politica de storage.objects para quarantine');
  }));

test('funcoes: execute so para app_api, search_path vazio e security definer', () =>
  tx(async () => {
    const assinaturas = [
      'private.media_issue(text,uuid,text,integer,timestamptz,integer)',
      'private.media_get(text,uuid,timestamptz)',
      'private.media_finalize(text,uuid,integer,timestamptz)',
      'private.media_sweep(timestamptz,integer)',
      'private.media_purge_done(uuid[])',
      'private.media_known(uuid[])',
    ];
    for (const sig of assinaturas) {
      const { rows: [f] } = await client.query(
        `select has_function_privilege('app_api', $1::regprocedure, 'EXECUTE') as api,
                p.prosecdef as definer, p.proconfig as cfg
           from pg_proc p where p.oid = $1::regprocedure`,
        [sig],
      );
      assert.equal(f.api, true, `app_api executa ${sig}`);
      for (const papel of PAPEIS_FUNCAO) {
        if (papel === 'app_api') continue;
        const { rows: [g] } = await client.query(
          'select has_function_privilege($1, $2::regprocedure, $3) as ok',
          [papel, sig, 'EXECUTE'],
        );
        assert.equal(g.ok, false, `${papel} nao executa ${sig}`);
      }
      assert.equal(f.definer, true, `${sig} e security definer`);
      assert.ok(f.cfg?.some((c) => c === 'search_path=""'), `${sig} tem search_path vazio`);
    }
  }));

test('M-01: emissao nova cria pendente ligado ao rascunho, com prazo de 30 min', () =>
  tx(async () => {
    const draft = await rascunho('segredo-m01');
    const r = await emitir('segredo-m01', cu());
    assert.equal(r.out_code, 'new');
    assert.equal(r.out_status, 'pending');
    assert.equal(r.out_confirmed, false);
    const { rows: [l] } = await client.query(
      'select draft_id, pending_expires_at, confirmed_at from app.media_asset where id = $1',
      [r.out_id],
    );
    assert.equal(l.draft_id, draft);
    assert.equal(new Date(l.pending_expires_at).getTime(), T0 + TTL_MS);
    assert.equal(l.confirmed_at, null);
  }));

test('M-02: a 6a foto e recusada (photo_limit) sem gravar; as 5 anteriores ficam intactas', () =>
  tx(async () => {
    await rascunho('segredo-m02');
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push((await emitir('segredo-m02', cu())).out_id);
    const sexta = await emitir('segredo-m02', cu());
    assert.equal(sexta.out_code, 'photo_limit');
    assert.equal(sexta.out_id, null);
    const { rows: [n] } = await client.query('select count(*)::int as n from app.media_asset');
    assert.equal(n.n, 5);
  }));

test('M-03 (trigger): insert direto na 6a vaga e barrado pelo trigger com photo_limit', () =>
  tx(async () => {
    const draft = await rascunho('segredo-m03');
    for (let i = 0; i < 5; i++) await emitir('segredo-m03', cu());
    await client.query('savepoint s1');
    await assert.rejects(
      client.query(
        `insert into app.media_asset (draft_id, client_upload_id, declared_type, declared_bytes, pending_expires_at)
         values ($1, $2, 'image/png', 10, now() + interval '30 minutes')`,
        [draft, cu()],
      ),
      (erro) => erro.message === 'photo_limit' && erro.code === '23514',
    );
    await client.query('rollback to savepoint s1');
    const { rows: [n] } = await client.query(
      "select count(*)::int as n from app.media_asset where purge_requested_at is null and status <> 'rejected'",
    );
    assert.equal(n.n, 5);
  }));

test('M-04: mesmo client_upload_id devolve o mesmo id; finalize repetido mantem a primeira confirmacao', () =>
  tx(async () => {
    const segredo = 'segredo-m04';
    await rascunho(segredo);
    const c = cu();
    const a = await emitir(segredo, c, T0);
    const b = await emitir(segredo, c, T0 + MIN);
    assert.equal(b.out_code, 'replay');
    assert.equal(b.out_id, a.out_id);
    const f1 = await finalizar(segredo, a.out_id, 500_000, T0 + 2 * MIN);
    assert.equal(f1.out_code, 'confirmed');
    assert.equal(f1.out_confirmed, true);
    const f2 = await finalizar(segredo, a.out_id, 999, T0 + 5 * MIN);
    assert.equal(f2.out_code, 'replay');
    const l = await linha(a.out_id);
    assert.equal(new Date(l.confirmed_at).getTime(), T0 + 2 * MIN);
    assert.equal(Number(l.confirmed_bytes), 500_000);
    const re = await emitir(segredo, c, T0 + 6 * MIN);
    assert.equal(re.out_code, 'replay');
    assert.equal(re.out_confirmed, true);
    const { rows: [n] } = await client.query('select count(*)::int as n from app.media_asset');
    assert.equal(n.n, 1);
  }));

test('M-07: confirmacao em 30 min - 1 s vale; em 30 min expira, a vaga volta e o expurgo leva a linha', () =>
  tx(async () => {
    const vivo = 'segredo-m07-vivo';
    await rascunho(vivo);
    const a = await emitir(vivo, cu(), T0);
    assert.equal((await finalizar(vivo, a.out_id, 1000, T0 + TTL_MS - 1000)).out_code, 'confirmed');

    const vencido = 'segredo-m07-vencido';
    await rascunho(vencido);
    const c = cu();
    const b = await emitir(vencido, c, T0);
    const exp = await finalizar(vencido, b.out_id, 1000, T0 + TTL_MS);
    assert.equal(exp.out_code, 'expired');
    const marcada = await linha(b.out_id);
    assert.notEqual(marcada.purge_requested_at, null);

    const nova = await emitir(vencido, c, T0 + TTL_MS);
    assert.equal(nova.out_code, 'new', 'a vaga do pendente vencido volta e o mesmo client_upload_id cria linha nova');
    assert.notEqual(nova.out_id, b.out_id);

    const { rows: marcados } = await client.query(
      'select out_id from private.media_sweep($1::timestamptz, 100)',
      [at(T0 + TTL_MS)],
    );
    assert.ok(marcados.some((r) => r.out_id === b.out_id), 'o expurgo devolve o pendente vencido');
    const { rows: [ap] } = await client.query('select private.media_purge_done($1::uuid[]) as n', [[b.out_id]]);
    assert.equal(ap.n, 1);
    assert.equal(await linha(b.out_id), undefined, 'linha apagada depois da remocao do objeto');
  }));

test('M-05 (SQL): tamanho acima de 10 MB marca expurgo; objeto ausente nao muda o estado; 10 MB + 1 na emissao e recusado', () =>
  tx(async () => {
    const segredo = 'segredo-m05';
    await rascunho(segredo);
    const a = await emitir(segredo, cu(), T0);
    assert.equal((await finalizar(segredo, a.out_id, null, T0 + MIN)).out_code, 'missing');
    assert.equal((await linha(a.out_id)).purge_requested_at, null);
    assert.equal((await finalizar(segredo, a.out_id, MAX + 1, T0 + MIN)).out_code, 'too_large');
    assert.notEqual((await linha(a.out_id)).purge_requested_at, null);

    await client.query('savepoint s2');
    await assert.rejects(emitir(segredo, cu(), T0, MAX + 1), (erro) => erro.message.includes('media_entrada_invalida'));
    await client.query('rollback to savepoint s2');
  }));

test('M-11: descartado e vencido saem na varredura; publicado nao; on delete restrict barra apagar rascunho com foto', () =>
  tx(async () => {
    const descartado = 'segredo-m11-desc';
    await rascunho(descartado);
    const d1 = (await emitir(descartado, cu(), T0)).out_id;
    await client.query('select private.draft_discard($1::text, $2::timestamptz)', [sha(descartado), at(T0 + HORA)]);

    const vencido = 'segredo-m11-venc';
    await rascunho(vencido, T0, 1);
    const v1 = (await emitir(vencido, cu(), T0)).out_id;

    const publicado = 'segredo-m11-pub';
    const draftPub = await rascunho(publicado);
    const p1 = (await emitir(publicado, cu(), T0)).out_id;
    // Confirmada antes de publicar: assim so a regra (b) do rascunho poderia varre-la (pendente vencido sairia pela regra (a)).
    assert.equal((await finalizar(publicado, p1, 1000, T0 + MIN)).out_code, 'confirmed');
    await client.query(`update app.request_draft set status = 'publicado' where id = $1`, [draftPub]);

    const { rows } = await client.query('select out_id from private.media_sweep($1::timestamptz, 1000)', [at(T0 + 2 * DIA)]);
    const ids = rows.map((r) => r.out_id);
    assert.ok(ids.includes(d1), 'rascunho descartado sai');
    assert.ok(ids.includes(v1), 'rascunho vencido sai');
    assert.ok(!ids.includes(p1), 'rascunho publicado nao sai');

    await client.query('savepoint s3');
    await assert.rejects(client.query('delete from app.request_draft where id = $1', [draftPub]), (erro) => erro.code === '23503');
    await client.query('rollback to savepoint s3');
  }));

test('M-14: aplicar a migracao de novo na mesma transacao nao da erro; desfazer recusa com fotos', () =>
  tx(async () => {
    await client.query(MIGRACAO);
    await rascunho('segredo-m14');
    await emitir('segredo-m14', cu());
    await assert.rejects(client.query(DESFAZER), (erro) => erro.message.includes('media_desfazer_recusado'));
  }));

test('desfazer limpo: sem fotos, a migracao sai do banco (tabela, funcoes e trigger)', () =>
  tx(async () => {
    await client.query(DESFAZER);
    const { rows: [r] } = await client.query(
      "select to_regclass('app.media_asset') as tabela, to_regprocedure('private.media_issue(text,uuid,text,integer,timestamptz,integer)') as funcao",
    );
    assert.equal(r.tabela, null);
    assert.equal(r.funcao, null);
  }));
