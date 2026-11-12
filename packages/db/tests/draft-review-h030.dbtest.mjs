// H-030 (Issue #43) | Revisao e confirmacao expressa do pedido (docs/factory/90-DESENHO-H030.md, §7.1).
// Provas de banco: T-PRE, T-DB01 a T-DB12. As provas com transacao aplicam as migracoes DENTRO da transacao e
// desfazem tudo com rollback. A prova de concorrencia (T-DB02) precisa de COMMIT real em 20 conexoes: cria dados
// sinteticos com sufixo aleatorio e LIMPA no finally. Nada de dado real. Sem rede, sem provedor externo.
// Pre-requisito da prova de concorrencia: a migracao 20261112150000 ja aplicada no banco de desenvolvimento.
// Rodar sozinho: node --test --test-concurrency=1 packages/db/tests/draft-review-h030.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, REPO_ROOT } from '../scripts/lib/env.mjs';
import { draftMissingForReview } from '@fastpro/domain';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

const ler = (nome) => readFileSync(join(REPO_ROOT, 'supabase', 'migrations', nome), 'utf8');
const lerDesfazer = (nome) =>
  readFileSync(join(REPO_ROOT, 'supabase', 'rollbacks', nome), 'utf8')
    .replace(/^begin;\s*$/gm, '')
    .replace(/^commit;\s*$/gm, '');

const BASE = [
  '20261111140000_identity_create_auth_challenge.sql',
  '20261111170000_identity_create_rate_limits.sql',
  '20261111440000_draft_create_request_draft.sql',
];
const MIG_26 = '20261112130000_draft_expand_identity_attach.sql';
const MIG_30 = '20261112150000_draft_expand_review_confirmation.sql';
const DOWN_30 = '20261112150000_draft_expand_review_confirmation.down.sql';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const DIA = 86_400_000;
const T0 = Math.floor(Date.now() / 1000) * 1000;
const iso = (ms) => new Date(ms).toISOString();
const SUF = randomUUID().slice(0, 8);

/** Transacao de teste: aplica as migracoes necessarias e desfaz tudo no fim. */
async function tx(fn, { comMigracao30 = true } = {}) {
  await client.query('begin');
  try {
    for (const nome of BASE) await client.query(ler(nome));
    await client.query(ler(MIG_26));
    if (comMigracao30) await client.query(ler(MIG_30));
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

/** Erro esperado dentro de savepoint: devolve o erro e mantem a transacao utilizavel. */
async function erroEm(sql, params = []) {
  await client.query('savepoint sp_erro');
  try {
    await client.query(sql, params);
  } catch (err) {
    await client.query('rollback to savepoint sp_erro');
    return err;
  }
  await client.query('release savepoint sp_erro');
  return null;
}

/** Servico sintetico (grupo + servico) na conexao dada. */
async function servico(c, ativo = true) {
  const grupo = randomUUID();
  const id = randomUUID();
  await c.query('insert into app.service_group (id, name, position, active) values ($1, $2, 1, true)', [
    grupo,
    `Grupo sintetico ${SUF} ${grupo.slice(0, 6)}`,
  ]);
  await c.query(
    `insert into app.service (id, group_id, name, modality, regulated, active)
     values ($1, $2, $3, 'presencial', false, $4)`,
    [id, grupo, `Servico sintetico ${SUF} ${id.slice(0, 6)}`, ativo],
  );
  return id;
}

/** Remove um servico sintetico e o grupo dele (so usado na prova com COMMIT). */
async function apagarServico(c, id) {
  const g = (await c.query('select group_id from app.service where id = $1', [id])).rows[0];
  await c.query('delete from app.service where id = $1', [id]);
  if (g) await c.query('delete from app.service_group where id = $1', [g.group_id]);
}

/** Rascunho sintetico na conexao dada. Campos nulos sao nulos de verdade (para as recusas). */
async function rascunho(c, servicoId, o = {}) {
  const d = {
    hash: sha(`cookie-${randomUUID()}`),
    address: 'Rua Sintetica 100',
    urgency: 'imediato',
    description: 'Descricao sintetica',
    status: 'aberto',
    expiresMs: T0 + 7 * DIA,
    criadoMs: T0,
    nome: 'Ana',
    email: `cliente-${randomUUID().slice(0, 8)}@example.test`,
    verificado: true,
    confirmadoMs: null,
    ...o,
  };
  // confirmed_at so entra no INSERT quando a prova o pede (antes da migracao 20261112150000 a coluna nao existe).
  const colunas = [
    'browser_nonce_hash', 'service_id', 'address_text', 'urgency', 'description', 'status',
    'expires_at', 'ip_hmac', 'created_at', 'updated_at', 'first_name', 'email', 'email_hmac', 'email_verified_at',
  ];
  const valores = [
    d.hash,
    servicoId,
    d.address,
    d.urgency,
    d.description,
    d.status,
    iso(d.expiresMs),
    sha('ip-sintetico'),
    iso(d.criadoMs),
    iso(d.criadoMs),
    d.nome,
    d.email,
    d.email === null ? null : sha(d.email),
    d.verificado ? iso(T0) : null,
  ];
  if (d.confirmadoMs !== null) {
    colunas.push('confirmed_at');
    valores.push(iso(d.confirmadoMs));
  }
  const marcas = valores.map((_, i) => `$${i + 1}`).join(', ');
  const r = await c.query(
    `insert into app.request_draft (${colunas.join(', ')}) values (${marcas}) returning id`,
    valores,
  );
  return { id: r.rows[0].id, hash: d.hash };
}

const confirmar = async (c, hash, rev = 0, agoraMs = T0, ttl = 7) =>
  (
    await c.query('select * from private.draft_confirm($1, $2::timestamptz, $3::integer, $4::integer)', [
      hash,
      iso(agoraMs),
      rev,
      ttl,
    ])
  ).rows[0];

const revisao = async (c, hash, agoraMs = T0) =>
  (await c.query('select * from private.draft_review_get($1, $2::timestamptz)', [hash, iso(agoraMs)])).rows;

const linha = async (c, id) =>
  (
    await c.query(
      'select status, confirmed_at, content_rev, expires_at, description, address_text from app.request_draft where id = $1',
      [id],
    )
  ).rows[0];

// ---------------------------------------------------------------------------------------------
// T-PRE | Pre-condicao da #26: colunas de identificacao existem (fora de transacao, banco real).
// ---------------------------------------------------------------------------------------------
test('T-PRE colunas da #26 (first_name, email, email_verified_at) existem em app.request_draft', async () => {
  const r = await client.query(
    `select column_name from information_schema.columns
      where table_schema = 'app' and table_name = 'request_draft'
        and column_name in ('first_name', 'email', 'email_verified_at')`,
  );
  const nomes = r.rows.map((x) => x.column_name).sort();
  assert.deepEqual(nomes, ['email', 'email_verified_at', 'first_name'],
    'migracao 20261112130000 (#26) nao aplicada: colunas de identificacao ausentes');
});

// ---------------------------------------------------------------------------------------------
// T-DB01 | Confirmacao em rascunho completo: confirmed_at gravado, status aberto, sem publicacao (CA-06, CA-07).
// ---------------------------------------------------------------------------------------------
test('T-DB01 confirmacao grava so confirmed_at; status segue aberto; nenhum pedido publicado', () =>
  tx(async () => {
    const s = await servico(client);
    const d = await rascunho(client, s);
    const existePedido = (await client.query("select to_regclass('app.service_request') is not null as e")).rows[0].e;
    const contar = async () =>
      existePedido ? (await client.query('select count(*)::int as n from app.service_request')).rows[0].n : -1;
    const contaAntes = await contar();
    const r = await confirmar(client, d.hash);
    assert.equal(r.out_result, 'ok');
    assert.equal(new Date(r.out_confirmed_at).getTime(), T0);
    assert.equal(Number(r.out_content_rev), 0);
    const depois = await linha(client, d.id);
    assert.equal(depois.status, 'aberto');
    assert.equal(new Date(depois.confirmed_at).getTime(), T0);
    assert.equal(await contar(), contaAntes, 'service_request inalterada');
    const colunasPub = await client.query(
      `select count(*)::int as n from information_schema.columns
        where table_schema = 'app' and table_name = 'request_draft' and column_name like 'published%'`,
    );
    assert.equal(colunasPub.rows[0].n, 0, 'nenhuma coluna published_* em request_draft');
    const def = (await client.query(
      `select pg_get_functiondef('private.draft_confirm(text,timestamptz,integer,integer)'::regprocedure) as def`,
    )).rows[0].def;
    assert.doesNotMatch(def, /service_request|publicad|published/i, 'draft_confirm nao publica');
  }));

// ---------------------------------------------------------------------------------------------
// T-DB02 | Idempotencia (CA-08): 2 chamadas em serie e 20 concorrentes com COMMIT real. Limpeza no finally.
// ---------------------------------------------------------------------------------------------
test('T-DB02 confirmacao idempotente: serie e 20 concorrentes devolvem o mesmo confirmed_at', async () => {
  const conexoes = [];
  const rascunhos = [];
  let servicoId = null;
  try {
    assert.ok(
      (await client.query("select to_regprocedure('private.draft_confirm(text,timestamptz,integer,integer)') as f")).rows[0].f,
      'migracao 20261112150000 nao aplicada no banco de desenvolvimento',
    );
    servicoId = await servico(client);
    const d = await rascunho(client, servicoId, { criadoMs: Date.now(), expiresMs: Date.now() + 7 * DIA });
    rascunhos.push(d.id);
    const agora = Date.now();
    const primeira = await confirmar(client, d.hash, 0, agora);
    assert.equal(primeira.out_result, 'ok');
    const xmin1 = (await client.query('select xmin::text as x from app.request_draft where id = $1', [d.id])).rows[0].x;
    const serie = await confirmar(client, d.hash, 0, agora + 1000);
    assert.equal(serie.out_result, 'ok');
    assert.equal(new Date(serie.out_confirmed_at).getTime(), new Date(primeira.out_confirmed_at).getTime());
    const xmin2 = (await client.query('select xmin::text as x from app.request_draft where id = $1', [d.id])).rows[0].x;
    assert.equal(xmin2, xmin1, 'segunda chamada nao gravou (xmin igual)');

    // Concorrencia: 20 conexoes reais, cada uma com o seu COMMIT. Rascunho novo, sem confirmacao.
    const d2 = await rascunho(client, servicoId, { criadoMs: Date.now(), expiresMs: Date.now() + 7 * DIA });
    rascunhos.push(d2.id);
    for (let i = 0; i < 20; i++) conexoes.push(await connect());
    const agora2 = Date.now();
    const respostas = await Promise.all(conexoes.map((c) => confirmar(c, d2.hash, 0, agora2)));
    const resultados = new Set(respostas.map((r) => r.out_result));
    assert.deepEqual([...resultados], ['ok'], 'todas as 20 chamadas aceitas');
    const instantes = new Set(respostas.map((r) => new Date(r.out_confirmed_at).getTime()));
    assert.equal(instantes.size, 1, 'um so confirmed_at nas 20 respostas');
    const gravado = await linha(client, d2.id);
    assert.equal(new Date(gravado.confirmed_at).getTime(), agora2);
  } finally {
    await Promise.allSettled(conexoes.map((c) => c.end()));
    for (const id of rascunhos) await client.query('delete from app.request_draft where id = $1', [id]);
    if (servicoId) await apagarServico(client, servicoId);
  }
});

// ---------------------------------------------------------------------------------------------
// T-DB03 | Gatilho de conteudo (CA-09): cada campo do pedido zera a confirmacao e soma content_rev.
// ---------------------------------------------------------------------------------------------
test('T-DB03 gatilho: alterar cada campo do pedido zera a confirmacao e soma content_rev', () =>
  tx(async () => {
    const s1 = await servico(client);
    const s2 = await servico(client);
    const casos = [
      ['service_id', s2],
      ['address_text', 'Rua Nova 200'],
      ['urgency', 'proximo_mes'],
      ['description', 'Outra descricao'],
      ['first_name', 'Beatriz'],
      ['email', 'outro@example.test'],
      ['email_verified_at', null],
    ];
    for (const [coluna, novo] of casos) {
      const d = await rascunho(client, s1);
      await confirmar(client, d.hash);
      if (coluna === 'email' && novo !== null) {
        await client.query('update app.request_draft set email = $2, email_hmac = $3 where id = $1', [d.id, novo, sha(novo)]);
      } else {
        await client.query(`update app.request_draft set ${coluna} = $2 where id = $1`, [d.id, novo]);
      }
      const l = await linha(client, d.id);
      assert.equal(l.confirmed_at, null, `${coluna}: confirmacao zerada`);
      assert.equal(Number(l.content_rev), 1, `${coluna}: content_rev +1`);
    }
  }));

test('T-DB03b PATCH com valores identicos mantem a confirmacao e o content_rev', () =>
  tx(async () => {
    const s = await servico(client);
    const d = await rascunho(client, s);
    await confirmar(client, d.hash);
    await client.query(
      `update app.request_draft set description = description, address_text = address_text,
         urgency = urgency, updated_at = $2 where id = $1`,
      [d.id, iso(T0 + 1000)],
    );
    const l = await linha(client, d.id);
    assert.notEqual(l.confirmed_at, null, 'confirmacao intacta');
    assert.equal(Number(l.content_rev), 0);
  }));

// ---------------------------------------------------------------------------------------------
// T-DB04 | Estados e restricoes: status fora de aberto zera a confirmacao; CHECK; mudanca junto de confirmacao.
// ---------------------------------------------------------------------------------------------
test('T-DB04 status aguardando_email ou descartado zera confirmed_at; CHECK e gatilho de 23514', () =>
  tx(async () => {
    const s = await servico(client);
    const a = await rascunho(client, s);
    await confirmar(client, a.hash);
    await client.query("update app.request_draft set status = 'aguardando_email' where id = $1", [a.id]);
    assert.equal((await linha(client, a.id)).confirmed_at, null, 'aguardando_email zera');

    const b = await rascunho(client, s);
    await confirmar(client, b.hash);
    await client.query("update app.request_draft set status = 'descartado' where id = $1", [b.id]);
    assert.equal((await linha(client, b.id)).confirmed_at, null, 'descartado zera');

    const erroCheck = await erroEm(
      `insert into app.request_draft (browser_nonce_hash, status, expires_at, ip_hmac, first_name, email, email_hmac, confirmed_at)
       values ($1, 'aguardando_email', $2, $3, 'Ana', 'x@example.test', $4, $2)`,
      [sha('nonce-check'), iso(T0 + DIA), sha('ip'), sha('x@example.test')],
    );
    assert.equal(erroCheck?.code, '23514', 'CHECK rejeita confirmed_at com aguardando_email');

    const c = await rascunho(client, s);
    const erroGatilho = await erroEm(
      'update app.request_draft set description = $2, confirmed_at = $3 where id = $1',
      [c.id, 'Mudanca junto da confirmacao', iso(T0)],
    );
    assert.equal(erroGatilho?.code, '23514');
    assert.match(erroGatilho?.message ?? '', /confirmacao_com_conteudo_alterado/);
  }));

// ---------------------------------------------------------------------------------------------
// T-DB05 | Versao do conteudo (CA-06, CA-09): content_rev velho nao confirma; conteudo novo exige nova versao.
// ---------------------------------------------------------------------------------------------
test('T-DB05 content_rev velho ou de conteudo editado: conteudo_alterado; sem gravar', () =>
  tx(async () => {
    const s = await servico(client);
    const d = await rascunho(client, s);
    assert.equal((await confirmar(client, d.hash, 7)).out_result, 'conteudo_alterado');
    assert.equal((await linha(client, d.id)).confirmed_at, null, 'nada gravado');

    await client.query("update app.request_draft set description = 'Editada' where id = $1", [d.id]);
    assert.equal((await confirmar(client, d.hash, 0)).out_result, 'conteudo_alterado');
    const ok = await confirmar(client, d.hash, 1);
    assert.equal(ok.out_result, 'ok');
    const again = await confirmar(client, d.hash, 1, T0 + 5000);
    assert.equal(again.out_result, 'ok');
    assert.equal(new Date(again.out_confirmed_at).getTime(), T0, 'mesma marca na repeticao');
  }));

// ---------------------------------------------------------------------------------------------
// T-DB06 | Ordem das recusas (CA-03, CA-04): campos faltando na ordem fixa; e-mail; servico inativo.
// ---------------------------------------------------------------------------------------------
test('T-DB06 recusas na ordem fixa e sem gravar nada', () =>
  tx(async () => {
    const s = await servico(client);
    const inativo = await servico(client, false);
    const faltando = await rascunho(client, s, { address: null, nome: null });
    const r1 = await confirmar(client, faltando.hash);
    assert.equal(r1.out_result, 'campos_faltando');
    assert.deepEqual(r1.out_missing, ['address_text', 'first_name']);

    const naoVerificado = await rascunho(client, s, { verificado: false });
    assert.equal((await confirmar(client, naoVerificado.hash)).out_result, 'email_nao_confirmado');

    const aguardando = await rascunho(client, s, { status: 'aguardando_email', verificado: false });
    assert.equal((await confirmar(client, aguardando.hash)).out_result, 'email_nao_confirmado');

    const servInativo = await rascunho(client, inativo);
    const r2 = await confirmar(client, servInativo.hash);
    assert.equal(r2.out_result, 'campos_faltando');
    assert.deepEqual(r2.out_missing, ['service_id']);

    const blank = await rascunho(client, s, { description: '  ' });
    const r3 = await confirmar(client, blank.hash);
    assert.deepEqual(r3.out_missing, ['description']);

    for (const d of [faltando, naoVerificado, aguardando, servInativo, blank]) {
      assert.equal((await linha(client, d.id)).confirmed_at, null, 'nada gravado na recusa');
    }
  }));

// ---------------------------------------------------------------------------------------------
// T-DB07 | Posse (CA-12): so o hash do cookie abre; outro rascunho e casos "nao existe" sao indistinguiveis.
// ---------------------------------------------------------------------------------------------
test('T-DB07 posse: rascunho de outro cookie nunca aparece nem muda; nao-existe e indistinguivel', () =>
  tx(async () => {
    const s = await servico(client);
    const a = await rascunho(client, s, { description: 'Pedido de A' });
    const b = await rascunho(client, s, { description: 'Pedido de B' });

    const revB = await revisao(client, b.hash);
    assert.equal(revB.length, 1);
    assert.notEqual(revB[0].out_id, a.id, 'revisao de B nunca devolve A');
    const rc = await confirmar(client, b.hash);
    assert.equal(rc.out_result, 'ok');
    assert.equal((await linha(client, a.id)).confirmed_at, null, 'confirmar B nao toca A');

    const naoExiste = sha('cookie-inexistente');
    const vencido = await rascunho(client, s, { expiresMs: T0 - DIA });
    const descartado = await rascunho(client, s, { status: 'descartado' });
    const publicado = await rascunho(client, s, { status: 'publicado' });
    const alvos = [naoExiste, vencido.hash, descartado.hash, publicado.hash];
    const formas = [];
    for (const h of alvos) {
      const rev = await revisao(client, h, T0);
      const conf = await confirmar(client, h, 0, T0);
      formas.push({ rev: rev.length, conf: conf.out_result, confirmada: conf.out_confirmed_at });
    }
    for (const f of formas) assert.deepEqual(f, { rev: 0, conf: 'nao_encontrado', confirmada: null });
  }));

// ---------------------------------------------------------------------------------------------
// T-DB08 | Sem fotos (CA-10): pedido sem midia confirma; a funcao nao referencia midia.
// ---------------------------------------------------------------------------------------------
test('T-DB08 pedido sem fotos confirma normalmente; a funcao nao referencia midia', () =>
  tx(async () => {
    const s = await servico(client);
    const d = await rascunho(client, s);
    assert.equal((await confirmar(client, d.hash)).out_result, 'ok');
    const def = (await client.query(
      `select pg_get_functiondef('private.draft_confirm(text,timestamptz,integer,integer)'::regprocedure) as def`,
    )).rows[0].def;
    assert.doesNotMatch(def, /media|midia|foto/i);
  }));

// ---------------------------------------------------------------------------------------------
// T-DB09 | Paridade (CA-02, CA-03): a lista de campos faltando do SQL e a do dominio coincidem.
// ---------------------------------------------------------------------------------------------
test('T-DB09 paridade SQL x draftMissingForReview em todas as 108 combinacoes', () =>
  tx(async () => {
    const s = await servico(client);
    const inativo = await servico(client, false);
    const servicos = [s, null, inativo];
    const enderecos = ['Rua Sintetica 100', null, '   '];
    const urgencias = ['imediato', null];
    const descricoes = ['Descricao', null];
    const nomes = ['Ana', null, '  '];
    let n = 0;
    for (const sv of servicos) {
      for (const en of enderecos) {
        for (const urg of urgencias) {
          for (const desc of descricoes) {
            for (const nome of nomes) {
              n++;
              const d = await rascunho(client, sv, { address: en, urgency: urg, description: desc, nome });
              const dominio = draftMissingForReview({
                serviceId: sv === inativo ? null : sv,
                addressText: en,
                urgency: urg,
                description: desc,
                firstName: nome,
                email: 'cliente@example.test',
              });
              const r = await confirmar(client, d.hash);
              if (dominio.length > 0) {
                assert.equal(r.out_result, 'campos_faltando', `caso ${n}`);
                assert.deepEqual([...r.out_missing], [...dominio], `caso ${n}: mesma lista`);
              } else {
                assert.notEqual(r.out_result, 'campos_faltando', `caso ${n}: completo nao recusa por campo`);
              }
            }
          }
        }
      }
    }
    assert.equal(n, 108);
  }));

// ---------------------------------------------------------------------------------------------
// T-DB10 | Prazo (CA-12): fora do prazo nao existe; confirmacao renova com teto de 30 dias desde a criacao.
// ---------------------------------------------------------------------------------------------
test('T-DB10 prazo: vencido nao existe; confirmacao renova expires_at com teto de 30 dias', () =>
  tx(async () => {
    const s = await servico(client);
    const d = await rascunho(client, s, { expiresMs: T0 + DIA });
    assert.equal((await revisao(client, d.hash, T0 + DIA)).length, 0, 'expires_at = agora: nao existe');

    const e = await rascunho(client, s, { expiresMs: T0 + 25 * DIA, criadoMs: T0 });
    const r = await confirmar(client, e.hash, 0, T0 + 20 * DIA);
    assert.equal(r.out_result, 'ok');
    assert.equal(new Date((await linha(client, e.id)).expires_at).getTime(), T0 + 27 * DIA, 'renova +7 dias');

    // Vence depois de agora (meio dia de folga), para o teto de 30 dias ser o que limita.
    const f = await rascunho(client, s, { expiresMs: T0 + 29 * DIA + DIA / 2, criadoMs: T0 });
    assert.equal((await confirmar(client, f.hash, 0, T0 + 29 * DIA)).out_result, 'ok');
    assert.equal(new Date((await linha(client, f.id)).expires_at).getTime(), T0 + 30 * DIA, 'teto de 30 dias');
  }));

// ---------------------------------------------------------------------------------------------
// T-DB11 | Migracao por expansao e reversivel (§3): linhas antigas intactas, reaplicar sem erro, desfazer e refazer.
// ---------------------------------------------------------------------------------------------
test('T-DB11 expansao preserva linhas, reaplica sem erro e o desfazer volta a refazer', () =>
  tx(
    async () => {
      const s = await servico(client);
      const d = await rascunho(client, s, { description: 'Antiga' });
      await client.query(ler(MIG_30));
      const l = await linha(client, d.id);
      assert.equal(l.confirmed_at, null);
      assert.equal(Number(l.content_rev), 0);
      assert.equal(l.description, 'Antiga');
      await client.query(ler(MIG_30));

      await client.query(lerDesfazer(DOWN_30));
      const colunas = await client.query(
        `select count(*)::int as n from information_schema.columns
          where table_schema = 'app' and table_name = 'request_draft' and column_name in ('confirmed_at', 'content_rev')`,
      );
      assert.equal(colunas.rows[0].n, 0, 'desfazer remove as colunas');
      const h25 = await client.query('select * from private.draft_get($1, $2::timestamptz)', [d.hash, iso(T0)]);
      assert.equal(h25.rows.length, 1, 'draft_get de H-025 continua funcionando');

      await client.query(ler(MIG_30));
      assert.equal((await confirmar(client, d.hash)).out_result, 'ok', 'refazer restaura a confirmacao');
    },
    { comMigracao30: false },
  ));

// ---------------------------------------------------------------------------------------------
// T-DB12 | Seguranca (CA-11): search_path vazio, execute so para app_api, gatilho sem execute, sem coordenada.
// ---------------------------------------------------------------------------------------------
test('T-DB12 privilegios, search_path e ausencia de coordenada', () =>
  tx(async () => {
    // PUBLIC aparece na ACL como grantee 0 (aclexplode); os demais papeis por has_function_privilege.
    const publicoExecuta = `exists (select 1 from aclexplode(p.proacl) a
                                     where a.grantee = 0 and a.privilege_type = 'EXECUTE')`;
    for (const assinatura of [
      'private.draft_review_get(text,timestamptz)',
      'private.draft_confirm(text,timestamptz,integer,integer)',
    ]) {
      const r = (await client.query(
        `select p.prosecdef, p.proconfig::text as cfg, ${publicoExecuta} as pub,
                has_function_privilege('app_api', $1::regprocedure, 'execute') as api,
                has_function_privilege('anon', $1::regprocedure, 'execute') as anon,
                has_function_privilege('authenticated', $1::regprocedure, 'execute') as auth,
                has_function_privilege('service_role', $1::regprocedure, 'execute') as srv,
                has_function_privilege('app_system', $1::regprocedure, 'execute') as sys
           from pg_proc p where p.oid = $1::regprocedure`,
        [assinatura],
      )).rows[0];
      assert.equal(r.prosecdef, true, `${assinatura} security definer`);
      assert.match(r.cfg ?? '', /search_path=/, `${assinatura} search_path fixo`);
      assert.doesNotMatch(r.cfg ?? '', /search_path=public/);
      assert.equal(r.api, true, `${assinatura}: app_api executa`);
      assert.equal(r.pub || r.anon || r.auth || r.srv || r.sys, false, `${assinatura}: so app_api`);
    }
    const gatilho = (await client.query(
      `select p.oid, ${publicoExecuta} as pub,
              has_function_privilege('app_api', 'private.draft_confirmation_guard()'::regprocedure, 'execute') as api
         from pg_proc p where p.oid = 'private.draft_confirmation_guard()'::regprocedure`,
    )).rows[0];
    assert.equal(gatilho.pub || gatilho.api, false, 'gatilho sem execute');
    const coordenada = await client.query(
      `select column_name from information_schema.columns
        where table_schema = 'app' and table_name = 'request_draft'
          and column_name ~ '(^lat|^lon|geom|point|latitude|longitude)'`,
    );
    assert.equal(coordenada.rows.length, 0, 'nenhuma coluna de coordenada');
  }));
