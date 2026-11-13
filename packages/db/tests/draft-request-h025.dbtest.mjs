// H-025 (Issue #38) | Rascunho de pedido sem conta: criterios que dependem de Postgres
// (docs/factory/74-DESENHO-H025.md §4, D-01 a D-10; 71-REFINO-H025.md CA-01, CA-03, CA-05 a CA-09).
// Migracao 20261111440000_draft_create_request_draft, aplicada DENTRO da transacao de cada teste.
// Tudo e desfeito com rollback; nada persiste no banco de desenvolvimento. Valores sinteticos (@example.test).
// Erros esperados usam savepoint, porque um erro no Postgres aborta a transacao inteira.
// Itens que dependem da API HTTP (cabecalhos, 422/413/429, log, DraftGate) ficam como NAO_VERIFICAVEL.
// Rodar sozinho: node --test --test-concurrency=1 packages/db/tests/draft-request-h025.dbtest.mjs
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

const MIGRACAO = readFileSync(
  join(REPO_ROOT, 'supabase', 'migrations', '20261111440000_draft_create_request_draft.sql'),
  'utf8',
);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const DIA = 86400000;
const T0 = Date.parse('2099-01-01T12:00:00.000Z');
const at = (ms) => new Date(ms).toISOString();
const CAP = 1000000;
// Modelo de cabeca (#140, triagem do db:test). As colunas de identificacao (first_name, email,
// email_hmac, email_verified_at) vem do H-030 (docs/factory/90-DESENHO-H030 §1.1); confirmed_at e
// content_rev, do H-030; photo_rev, do H-029. Telefone, senha e coordenada continuam proibidos.
const COLUNAS_ESPERADAS = [
  'address_text', 'browser_nonce_hash', 'confirmed_at', 'content_rev', 'created_at', 'description',
  'email', 'email_hmac', 'email_verified_at', 'expires_at', 'first_name', 'id', 'ip_hmac',
  'photo_rev', 'service_id', 'status', 'updated_at', 'urgency',
];
const COLUNAS_PROIBIDAS = ['phone', 'telefone', 'password', 'senha', 'exact_point', 'lat', 'lon', 'latitude', 'longitude'];

/** Transacao de teste: aplica a migracao e desfaz tudo no fim. Nada fica no banco compartilhado. */
async function tx(fn) {
  await client.query('begin');
  try {
    await client.query(MIGRACAO);
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

/** Executa fn dentro de savepoint. Devolve o erro (ou null). Mantem a transacao utilizavel. */
async function erroEm(fn) {
  await client.query('savepoint sp_erro');
  try {
    await fn();
  } catch (err) {
    await client.query('rollback to savepoint sp_erro');
    return err;
  }
  await client.query('release savepoint sp_erro');
  return null;
}

const ipHmac = () => sha(randomUUID());
const novoHash = () => sha(randomUUID());

async function criar(hash, campos = {}, ms = T0, { ttl = 7, expirado = null, cap = CAP } = {}) {
  const { rows } = await client.query(
    `select * from private.draft_create($1::text, $2::text, $3::timestamptz, $4::integer,
                                        $5::text, $6::jsonb, $7::integer)`,
    [hash, ipHmac(), at(ms), ttl, expirado, JSON.stringify(campos), cap],
  );
  return rows[0];
}

const ler = async (hash, ms = T0) =>
  (await client.query('select * from private.draft_get($1::text, $2::timestamptz)', [hash, at(ms)])).rows;

async function salvar(hash, campos, ms = T0, ttl = 7) {
  const { rows } = await client.query(
    'select * from private.draft_patch($1::text, $2::timestamptz, $3::integer, $4::jsonb)',
    [hash, at(ms), ttl, JSON.stringify(campos)],
  );
  return rows;
}

async function descartar(hash, ms = T0) {
  const { rows } = await client.query('select private.draft_discard($1::text, $2::timestamptz) as ok', [hash, at(ms)]);
  return rows[0].ok;
}

async function linhasDoHash(hash) {
  const { rows } = await client.query('select count(*)::int as n from app.request_draft where browser_nonce_hash = $1', [hash]);
  return rows[0].n;
}

async function statusDoHash(hash) {
  const { rows } = await client.query('select status from app.request_draft where browser_nonce_hash = $1', [hash]);
  return rows.map((r) => r.status);
}

// D-01 | criar rascunho sem conta: 201 equivalente, status aberto, sem senha, nome ou e-mail (colunas exatas)
test('D-01 cria rascunho sem conta com colunas exatas e sem dado pessoal', () =>
  tx(async () => {
    const hash = novoHash();
    const linha = await criar(hash, {
      service_id: null, address_text: 'Rua Exemplo 123', urgency: 'imediato', description: 'Torneira vazando',
    });
    assert.equal(linha.out_status, 'aberto');
    assert.equal(linha.out_address_text, 'Rua Exemplo 123');
    assert.equal(linha.out_urgency, 'imediato');
    assert.equal(linha.out_description, 'Torneira vazando');
    assert.equal(new Date(linha.out_expires_at).getTime(), T0 + 7 * DIA, 'prazo de 7 dias');

    const { rows: colunas } = await client.query(
      `select column_name from information_schema.columns
        where table_schema = 'app' and table_name = 'request_draft' order by column_name`);
    assert.deepEqual(colunas.map((c) => c.column_name), COLUNAS_ESPERADAS,
      'so as colunas do modelo de cabeca (H-025 + H-029/H-030): sem telefone, senha ou coordenada');
    for (const proibida of COLUNAS_PROIBIDAS) {
      assert.equal(colunas.some((c) => c.column_name === proibida), false, `coluna proibida: ${proibida}`);
    }

    const lida = await ler(hash);
    assert.equal(lida.length, 1, 'o rascunho e lido pelo mesmo segredo');
    assert.equal(lida[0].out_id, linha.out_id);
  }));

// D-02 | urgencia fora das quatro chaves e recusada pelo banco (23514), zero linhas; as quatro passam
test('D-02 urgencia fora das quatro opcoes nao grava nada; as quatro passam', () =>
  tx(async () => {
    const hashRuim = novoHash();
    const erro = await erroEm(() => criar(hashRuim, { urgency: 'qualquer' }));
    assert.ok(erro, 'urgencia invalida deveria ser recusada');
    assert.equal(erro.code, '23514', 'violacao de CHECK');
    assert.equal(await linhasDoHash(hashRuim), 0, 'zero linhas gravadas');

    for (const u of ['imediato', 'proximas_semanas', 'proximo_mes', 'nao_definido']) {
      const h = novoHash();
      const linha = await criar(h, { urgency: u });
      assert.equal(linha.out_urgency, u);
    }
  }));

// D-09 (parte de banco) | limites de tamanho da descricao e do endereco (CHECK): 2000 passa, 2001 recusa
test('D-09 limites de tamanho do banco: descricao 2000 passa, 2001 recusa; endereco 2 recusa', () =>
  tx(async () => {
    const ok = await criar(novoHash(), { description: 'a'.repeat(2000) });
    assert.equal(ok.out_description.length, 2000);

    const h = novoHash();
    const longa = await erroEm(() => criar(h, { description: 'a'.repeat(2001) }));
    assert.equal(longa?.code, '23514', 'descricao de 2001 caracteres recusada pelo CHECK');
    assert.equal(await linhasDoHash(h), 0);

    const h2 = novoHash();
    const curto = await erroEm(() => criar(h2, { address_text: 'ab' }));
    assert.equal(curto?.code, '23514', 'endereco de 2 caracteres recusado (minimo 3)');
    assert.equal(await linhasDoHash(h2), 0);
  }));

// D-01/D-07 | servico precisa existir e estar ativo (P0001 servico_invalido) na criacao
test('servico inexistente e recusado com servico_invalido', () =>
  tx(async () => {
    const h = novoHash();
    const erro = await erroEm(() => criar(h, { service_id: randomUUID() }));
    assert.equal(erro?.code, 'P0001');
    assert.match(erro.message, /servico_invalido/);
    assert.equal(await linhasDoHash(h), 0);
  }));

// D-04 | idempotencia: um rascunho vivo por segredo (indice parcial); PATCH repetido da o mesmo resultado
test('D-04 segundo rascunho vivo com o mesmo segredo e recusado; PATCH repetido e idempotente', () =>
  tx(async () => {
    const hash = novoHash();
    const primeiro = await criar(hash, { urgency: 'proximo_mes' });

    const erro = await erroEm(() => criar(hash, { urgency: 'imediato' }));
    assert.equal(erro?.code, '23505', 'indice unico parcial recusa o segundo rascunho vivo');
    assert.equal(await linhasDoHash(hash), 1, 'a contagem nao muda');

    assert.equal((await ler(hash))[0].out_id, primeiro.out_id, 'a leitura devolve o mesmo rascunho');

    const corpo = { description: 'Mesmo texto', address_text: 'Avenida Exemplo 45' };
    const a = await salvar(hash, corpo, T0 + 1000);
    const b = await salvar(hash, corpo, T0 + 2000);
    for (const campo of ['out_id', 'out_status', 'out_service_id', 'out_address_text', 'out_urgency', 'out_description']) {
      assert.deepEqual(b[0][campo], a[0][campo], `${campo} igual nos dois salvamentos`);
    }
    assert.equal(await linhasDoHash(hash), 1, 'nenhuma duplicidade apos dois salvamentos');
  }));

// CA-05 / D-03 | cookie de outro navegador, cookie vencido, descartado e publicado: sempre "nao existe"
test('D-03 outro navegador, sem cookie, vencido, descartado e publicado nao veem nem alteram o rascunho', () =>
  tx(async () => {
    const hashA = novoHash();
    const hashB = novoHash();
    await criar(hashA, { description: 'Texto original de A' });

    // Outro navegador (cookie B): zero linhas, zero alteracoes
    assert.deepEqual(await ler(hashB), []);
    assert.deepEqual(await salvar(hashB, { description: 'invasao' }), []);
    assert.equal(await descartar(hashB), false);
    // Sem cookie (segredo nulo): a leitura devolve zero linhas; a escrita recusa a entrada (22023) sem tocar em linhas
    assert.deepEqual(await ler(null), []);
    const semSalvar = await erroEm(() => salvar(null, { description: 'x' }));
    assert.equal(semSalvar?.code, '22023', 'salvar sem segredo e recusado como entrada invalida');
    const semDescarte = await erroEm(() => descartar(null));
    assert.equal(semDescarte?.code, '22023', 'descartar sem segredo e recusado como entrada invalida');

    const { rows } = await client.query(
      `select description from app.request_draft where browser_nonce_hash = $1`, [hashA]);
    assert.equal(rows[0].description, 'Texto original de A', 'o rascunho de A nao foi alterado');

    // Vencido: a leitura de A depois do prazo devolve zero linhas
    assert.deepEqual(await ler(hashA, T0 + 8 * DIA), []);
    assert.deepEqual(await salvar(hashA, { description: 'tarde' }, T0 + 8 * DIA), []);

    // Descartado: depois do descarte, A deixa de existir para o proprio navegador
    assert.equal(await descartar(hashA), true, 'primeiro descarte encontra o rascunho');
    assert.deepEqual(await ler(hashA), []);
    assert.deepEqual(await salvar(hashA, { description: 'depois' }), []);
    assert.equal(await descartar(hashA), false, 'segundo descarte nao encontra nada');
    assert.deepEqual(await statusDoHash(hashA), ['descartado']);

    // Publicado: estado gravado por outra historia; a leitura de H-025 nao o devolve
    const hashP = novoHash();
    await criar(hashP);
    await client.query(`update app.request_draft set status = 'publicado' where browser_nonce_hash = $1`, [hashP]);
    assert.deepEqual(await ler(hashP), []);
    assert.deepEqual(await salvar(hashP, { description: 'x' }), []);
  }));

// CA-09 / D-07 | expiracao: vivo em 7 d - 1 s, nao vivo em 7 d; salvamento renova; teto de 30 d
test('D-07 prazo de 7 dias, renovacao no salvamento e teto absoluto de 30 dias', () =>
  tx(async () => {
    const hash = novoHash();
    await criar(hash, {}, T0);
    assert.equal((await ler(hash, T0 + 7 * DIA - 1000)).length, 1, 'vivo em 7 d - 1 s');
    assert.equal((await ler(hash, T0 + 7 * DIA)).length, 0, 'nao existe em 7 d');

    // Salvamento aos 6 dias renova o prazo para 6 + 7 = 13 dias
    const renovado = await salvar(hash, { description: 'renovado' }, T0 + 6 * DIA);
    assert.equal(new Date(renovado[0].out_expires_at).getTime(), T0 + 13 * DIA, 'renovacao por 7 dias');
    assert.equal((await ler(hash, T0 + 12 * DIA)).length, 1, 'continua vivo apos a renovacao');

    // Renovacoes seguintes (12 d, 18 d): o prazo acompanha o salvamento
    await salvar(hash, { description: 'segunda' }, T0 + 12 * DIA);
    await salvar(hash, { description: 'terceira' }, T0 + 18 * DIA);

    // Salvamento aos 24 dias: o teto (criacao + 30 d) limita o novo prazo, que nao passa de 30 dias
    const noTeto = await salvar(hash, { description: 'teto' }, T0 + 24 * DIA);
    assert.equal(new Date(noTeto[0].out_expires_at).getTime(), T0 + 30 * DIA, 'teto de 30 dias desde a criacao');

    // Salvamento aos 29 dias ainda e aceito e continua no teto
    const aos29 = await salvar(hash, { description: 'aos 29' }, T0 + 29 * DIA);
    assert.equal(new Date(aos29[0].out_expires_at).getTime(), T0 + 30 * DIA, 'continua limitado pelo teto');
    assert.deepEqual(await ler(hash, T0 + 30 * DIA), [], 'nao existe ao completar 30 dias');
  }));

// CA-09 / D-07 | POST com cookie vencido: o antigo vira descartado e o novo nasce aberto
test('D-07 criar com cookie vencido descarta o antigo e cria outro rascunho', () =>
  tx(async () => {
    const antigo = novoHash();
    const novo = novoHash();
    await criar(antigo, {}, T0);
    const linha = await criar(novo, { urgency: 'nao_definido' }, T0 + 8 * DIA, { expirado: antigo });
    assert.equal(linha.out_status, 'aberto');
    assert.deepEqual(await statusDoHash(antigo), ['descartado'], 'o antigo foi marcado descartado');
    assert.equal((await ler(novo, T0 + 8 * DIA)).length, 1, 'o novo esta vivo');
  }));

// Prazo fora de 1 a 30 dias e teto de criacao invalido: erro de entrada (22023), nada gravado
test('entradas invalidas de prazo e teto sao recusadas com 22023', () =>
  tx(async () => {
    for (const ttl of [0, 31]) {
      const h = novoHash();
      const erro = await erroEm(() => criar(h, {}, T0, { ttl }));
      assert.equal(erro?.code, '22023', `ttl ${ttl} recusado`);
      assert.equal(await linhasDoHash(h), 0);
    }
    const h = novoHash();
    const erro = await erroEm(() => criar(h, {}, T0, { cap: 0 }));
    assert.equal(erro?.code, '22023', 'teto zero recusado');
  }));

// A1 / R1 | teto global de rascunhos vivos: no limite recusa com teto_global_rascunhos; acima aceita
test('teto global de rascunhos vivos recusa no limite e aceita abaixo dele', () =>
  tx(async () => {
    // Garante ao menos um rascunho vivo (o teto minimo aceito pela funcao e 1)
    await criar(novoHash(), {}, T0);
    const { rows } = await client.query(
      `select count(*)::int as n from app.request_draft
        where status in ('aberto', 'aguardando_email') and expires_at > $1::timestamptz`, [at(T0)]);
    const vivos = rows[0].n;
    assert.ok(vivos >= 1, 'ha rascunho vivo antes do teste');

    const h = novoHash();
    const erro = await erroEm(() => criar(h, {}, T0, { cap: vivos }));
    assert.equal(erro?.code, 'P0001');
    assert.match(erro.message, /teto_global_rascunhos/);
    assert.equal(await linhasDoHash(h), 0, 'recusado antes de inserir');

    await criar(h, {}, T0, { cap: vivos + 1 });
    assert.equal(await linhasDoHash(h), 1, 'aceito com o teto uma unidade acima');

    const outro = novoHash();
    const bloqueio = await erroEm(() => criar(outro, {}, T0, { cap: vivos + 1 }));
    assert.match(bloqueio?.message ?? '', /teto_global_rascunhos/, 'o novo teto ja esta cheio');
  }));

// D-10 | RLS habilitada e forcada; sem politicas; PUBLIC/anon/authenticated/service_role sem privilegio na tabela
test('D-10 RLS forcada na tabela e sem privilegio de tabela para papeis de borda', () =>
  tx(async () => {
    const { rows } = await client.query(
      `select relrowsecurity, relforcerowsecurity from pg_class where oid = 'app.request_draft'::regclass`);
    assert.equal(rows[0].relrowsecurity, true, 'RLS habilitada');
    assert.equal(rows[0].relforcerowsecurity, true, 'RLS forcada');

    const { rows: pol } = await client.query(
      `select count(*)::int as n from pg_policies where schemaname = 'app' and tablename = 'request_draft'`);
    assert.equal(pol[0].n, 0, 'nenhuma politica de linha');

    const papeis = ['anon', 'authenticated', 'service_role', 'app_api', 'app_system', 'app_backup_reader'];
    for (const r of papeis) {
      for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const { rows: priv } = await client.query(
          `select has_table_privilege($1, 'app.request_draft', $2) as ok`, [r, p]);
        assert.equal(priv[0].ok, false, `${r} sem ${p} direto na tabela`);
      }
    }

    const { rows: publico } = await client.query(
      `select count(*)::int as n from pg_class c, aclexplode(c.relacl) a
        where c.oid = 'app.request_draft'::regclass and a.grantee = 0`);
    assert.equal(publico[0].n, 0, 'PUBLIC sem privilegio na tabela');
  }));

// D-10 | funcoes: execute so para app_api; search_path vazio; security definer
test('D-10 funcoes security definer, search_path vazio e execute apenas para app_api', () =>
  tx(async () => {
    const funcoes = [
      'private.draft_get(text,timestamptz)',
      'private.draft_create(text,text,timestamptz,integer,text,jsonb,integer)',
      'private.draft_patch(text,timestamptz,integer,jsonb)',
      'private.draft_discard(text,timestamptz)',
    ];
    for (const f of funcoes) {
      const { rows } = await client.query(
        `select prosecdef, proconfig from pg_proc where oid = $1::regprocedure`, [f]);
      assert.equal(rows[0].prosecdef, true, `${f} e security definer`);
      const cfg = (rows[0].proconfig ?? []).find((c) => c.startsWith('search_path='));
      assert.ok(cfg, `${f} define search_path`);
      assert.equal(cfg.replace(/"/g, '').replace('search_path=', ''), '', `${f} com search_path vazio`);

      const { rows: exec } = await client.query(
        `select has_function_privilege('app_api', $1, 'execute') as api,
                has_function_privilege('anon', $1, 'execute') as anon,
                has_function_privilege('authenticated', $1, 'execute') as auth,
                has_function_privilege('service_role', $1, 'execute') as servico`, [f]);
      assert.equal(exec[0].api, true, `app_api executa ${f}`);
      assert.equal(exec[0].anon, false, `anon nao executa ${f}`);
      assert.equal(exec[0].auth, false, `authenticated nao executa ${f}`);
      assert.equal(exec[0].servico, false, `service_role nao executa ${f}`);
    }
  }));

// D-06 | nenhuma funcao de rascunho cria service_request nem publica
test('D-06 funcoes de rascunho nao tocam service_request nem marcam publicado', () =>
  tx(async () => {
    const { rows } = await client.query(
      `select p.proname, pg_get_functiondef(p.oid) as def from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname like 'draft\\_%'`);
    assert.ok(rows.length >= 4, 'as quatro funcoes existem');
    for (const r of rows) {
      assert.doesNotMatch(r.def, /service_request/i, `${r.proname} nao cria service_request`);
      assert.doesNotMatch(r.def, /set\s+status\s*=\s*'publicado'/i, `${r.proname} nao publica`);
    }
  }));

// D-05 (parte de banco) | o servidor so grava o texto do endereco; sem coordenada em nenhuma coluna
test('D-05 sem coordenada: nenhuma coluna de latitude, longitude, ponto ou geometria', () =>
  tx(async () => {
    const { rows } = await client.query(
      `select column_name from information_schema.columns
        where table_schema = 'app' and table_name = 'request_draft'
          and column_name ~* '(lat|lon|point|geom|geo|coord)'`);
    assert.deepEqual(rows, [], 'nenhuma coluna espacial');

    const hash = novoHash();
    const linha = await criar(hash, { address_text: 'Praca Exemplo 9' });
    assert.equal(linha.out_address_text, 'Praca Exemplo 9', 'so o texto do endereco e gravado');
  }));


// D-09 (banco) | servico inativo e recusado com servico_invalido (o 422 e o mapeamento da rota) e zero linhas gravadas.
test('D-09 servico inativo e recusado com servico_invalido e nenhuma linha e gravada', () =>
  tx(async () => {
    const grupo = randomUUID();
    await client.query('insert into app.service_group (id, name, position, active) values ($1, $2, 1, true)', [
      grupo,
      `Grupo inativo ${grupo}`,
    ]);
    const { rows: [servico] } = await client.query(
      `insert into app.service (group_id, name, modality, regulated, active)
       values ($1, $2, 'online', false, false) returning id`,
      [grupo, `Servico inativo ${grupo}`],
    );
    const antes = (await client.query('select count(*)::int as n from app.request_draft')).rows[0].n;
    const h = novoHash();
    const erro = await erroEm(() => criar(h, { service_id: servico.id, address_text: 'Rua Inativa 1' }));
    assert.equal(erro?.code, 'P0001');
    assert.match(erro.message, /servico_invalido/);
    assert.equal(await linhasDoHash(h), 0, 'nenhuma linha do rascunho recusado');
    const depois = (await client.query('select count(*)::int as n from app.request_draft')).rows[0].n;
    assert.equal(depois, antes, 'a tabela inteira nao muda');
  }));

// D-08 (banco, R1) | limite de criacao por IP-HMAC com private.rl_check e private.rl_hit: 10 por hora.
// rl_check so consulta (nao conta); rl_hit conta o pedido aceito. A 11a criacao na mesma hora e barrada com Retry-After.
test('D-08 limite de criacao: 10 pedidos aceitos na hora, a 11a e barrada com retry_after; rl_check nao conta', () =>
  tx(async () => {
    const chave = sha(`draft:criacao_hora:${sha(`ip-teste-${randomUUID()}`)}`);
    const agora = at(T0);
    const check = async () =>
      (await client.query('select out_ok, out_retry_after from private.rl_check($1, $2, $3, $4, $5::timestamptz)',
        [chave, 3600, 300, 10, agora])).rows[0];

    for (let i = 0; i < 20; i++) assert.equal((await check()).out_ok, true, 'consultar sem contar nao esgota o limite');
    for (let i = 0; i < 10; i++) {
      assert.equal((await check()).out_ok, true, `criacao ${i + 1} aceita`);
      await client.query('select private.rl_hit($1, $2, $3::timestamptz)', [chave, 300, agora]);
    }
    const barrada = await check();
    assert.equal(barrada.out_ok, false, 'a 11a criacao na mesma hora e barrada');
    assert.ok(Number(barrada.out_retry_after) >= 1, 'Retry-After positivo');
  }));

// D-10 (banco) | aplicar a migracao duas vezes: a segunda nao falha e o estado final e igual ao da primeira aplicacao.
test('D-10 aplicar a migracao duas vezes deixa o mesmo estado da primeira aplicacao', async () => {
  const estado = async () => {
    const { rows } = await client.query(`
      select jsonb_build_object(
        'tabela', to_regclass('app.request_draft')::text,
        'rls', (select jsonb_build_object('h', relrowsecurity, 'f', relforcerowsecurity, 'acl', relacl::text)
                  from pg_class where oid = to_regclass('app.request_draft')),
        'indices', (select jsonb_agg(indexdef order by indexname) from pg_indexes
                      where schemaname = 'app' and tablename = 'request_draft'),
        'colunas', (select jsonb_agg(column_name || ':' || data_type order by column_name) from information_schema.columns
                      where table_schema = 'app' and table_name = 'request_draft'),
        'funcoes', (select jsonb_agg(jsonb_build_object('a', p.oid::regprocedure::text, 'acl', p.proacl::text,
                      'corpo', md5(pg_get_functiondef(p.oid))) order by p.oid::regprocedure::text)
                      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'private' and p.proname like 'draft\_%')
      ) as e`);
    return rows[0].e;
  };
  await client.query('begin');
  try {
    await client.query(MIGRACAO);
    const primeira = await estado();
    await client.query(MIGRACAO);
    const segunda = await estado();
    // As quatro funcoes do H-025 existem; migracoes posteriores (H-013, H-029, H-030) somam outras
    // funcoes draft_*. Mesma regra de D-06: pelo menos as quatro.
    assert.ok(primeira.funcoes && primeira.funcoes.length >= 4, 'as quatro funcoes de rascunho do H-025 existem');
    assert.deepEqual(segunda, primeira, 'segunda aplicacao nao altera nada');
  } finally {
    await client.query('rollback');
  }
});
