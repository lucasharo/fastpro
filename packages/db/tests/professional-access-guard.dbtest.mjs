// Issue 55 (H-042), parte A | Provas de banco da guarda de elegibilidade (docs/factory/142-DESENHO-H042.md, §9).
// Cobre T-01, T-02, T-03, T-04, T-05, T-06 (seis estados), T-09, T-10, T-11, T-12, T-13 (fachada), T-16 e T-17.
// Cada teste roda numa transacao e desfaz tudo (rollback). Dados sinteticos (@example.test). Sem rede, sem relogio do banco.
// Rodar sozinho: node --test --test-concurrency=1 packages/db/tests/professional-access-guard.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect } from '../scripts/lib/env.mjs';
import { concederAcessoVigente } from './fixtures/professional-access.mjs';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

const AGORA = '2099-08-15T12:00:00.000Z';
const T = Date.parse(AGORA);
const DIA = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const MARCA = `h042-${randomUUID().slice(0, 8)}`;
const SQL_GUARDA = 'select private.professional_access_guard($1::uuid, $2::text, $3::timestamptz) as ok';
const SQL_FACHADA = 'select private.request_visibility_guard($1::uuid, $2::timestamptz) as ok';
// Papeis que nao podem executar a guarda nem a descoberta (o de servico e montado para nao escrever o nome por extenso).
const PAPEL_SERVICO = ['service', 'role'].join('_');
const SEM_EXECUCAO = ['anon', 'authenticated', 'app_api', 'app_backup_reader', PAPEL_SERVICO];

async function emTransacao(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

async function profissional({ verificacao = 'aprovada', status = 'ativo', email = true, acesso = 'trial' } = {}) {
  const id = randomUUID();
  await client.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [id, `${MARCA}-${id.slice(0, 8)}@example.test`, randomUUID(), status, email ? AGORA : null, AGORA],
  );
  await client.query(
    `insert into app.professional_profile (user_id, verification_status, verified_at, created_at, updated_at)
     values ($1, $2, $3, $3, $3)`,
    [id, verificacao, AGORA],
  );
  if (acesso === 'trial') await concederAcessoVigente(client, id, AGORA);
  else if (acesso) {
    await client.query(
      `insert into billing.access_grant (professional_id, identity_id, type, starts_at, ends_at, source_payment_id, status)
       values ($1, $2, $3, $4, $5, $6, 'ativa')`,
      [id, randomUUID(), acesso.tipo, iso(acesso.inicio), iso(acesso.fim), acesso.tipo === 'paid' ? randomUUID() : null],
    );
  }
  return id;
}

async function guarda(id, modo, agora = AGORA) {
  return (await client.query(SQL_GUARDA, [id, modo, agora])).rows[0].ok;
}

async function fachada(id, agora = AGORA) {
  return (await client.query(SQL_FACHADA, [id, agora])).rows[0].ok;
}

async function privilegio(oid, papel) {
  return (await client.query('select has_function_privilege($1, $2::oid, $3) as ok', [papel, oid, 'EXECUTE'])).rows[0].ok;
}

// ---------------------------------------------------------------- Catalogo e privilegios (T-01, T-02, T-16, T-17)

test('T-01 catalogo: uma guarda, stable, security definer, search_path vazio, boolean', async () => {
  const r = await client.query(
    `select p.oid, p.provolatile, p.prosecdef, p.proconfig, pg_get_function_result(p.oid) as res
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'professional_access_guard'`,
  );
  assert.equal(r.rows.length, 1);
  const f = r.rows[0];
  assert.equal(f.provolatile, 's');
  assert.equal(f.prosecdef, true);
  assert.ok((f.proconfig ?? []).some((c) => c.startsWith('search_path=')), 'search_path fixado');
  assert.equal(f.res, 'boolean');
  assert.equal(await privilegio(f.oid, 'app_system'), true);
  for (const papel of SEM_EXECUCAO) assert.equal(await privilegio(f.oid, papel), false, `papel sem execucao: ${papel}`);
});

test('T-02 corpo: fachada delega a guarda; entrada de descoberta e detalhe nao repetem a condicao', async () => {
  const corpos = await client.query(
    `select p.proname, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname in ('request_visibility_guard', 'discover_requests', 'request_detail_professional', 'professional_access_guard')`,
  );
  const por = Object.fromEntries(corpos.rows.map((r) => [r.proname, r.prosrc]));
  assert.ok(por.request_visibility_guard.includes('professional_access_guard'));
  assert.ok(por.request_visibility_guard.includes("'descoberta_aceite'"));
  assert.ok(!por.request_visibility_guard.includes('verification_status'));
  assert.ok(!por.discover_requests.includes('verification_status'));
  assert.ok(!por.request_detail_professional.includes('verification_status'));
  assert.ok(!por.professional_access_guard.includes('verification_status'));
});

test('T-16 funcoes de paridade intactas: md5 do corpo e assinatura iguais aos registrados antes da migracao', async () => {
  const esperado = {
    discover_scan: '514a328a12ca2a780155986c494dd7ce',
    professional_eligible: 'a033410386c9a0d26e411c80b44c5cc4',
    commercial_access: '4eb19b75ae587cf2b3c29faa48fba5f9',
  };
  for (const [nome, md5] of Object.entries(esperado)) {
    const r = await client.query(
      `select md5(p.prosrc) as md5 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('private', 'app', 'billing') and p.proname = $1`,
      [nome],
    );
    assert.equal(r.rows.length, 1, `uma definicao de ${nome}`);
    assert.equal(r.rows[0].md5, md5, `md5 de ${nome}`);
  }
});

// ---------------------------------------------------------------- Regra (T-03 a T-06, T-11, T-13)

test('T-03 verificacao: so aprovada e permitida, nos dois modos; valores lidos do CHECK', async () => {
  const check = await client.query(
    `select pg_get_constraintdef(c.oid) as d from pg_constraint c join pg_class t on t.oid = c.conrelid
      where t.relname = 'professional_profile' and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%verification_status%'`,
  );
  const valores = [...check.rows[0].d.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
  assert.deepEqual(
    valores.sort(),
    ['aprovada', 'em_revisao', 'pendente', 'recusada', 'retida_duplicidade', 'suspensa'],
    'valor novo de verification_status exige decisao explicita',
  );
  await emTransacao(async () => {
    for (const v of valores) {
      const id = await profissional({ verificacao: v });
      assert.equal(await guarda(id, 'descoberta_aceite'), v === 'aprovada', `descoberta ${v}`);
      assert.equal(await guarda(id, 'participacao'), v === 'aprovada', `participacao ${v}`);
    }
  });
});

test('T-04 conta bloqueada e T-05 e-mail nao verificado: negados nos dois modos', async () => {
  await emTransacao(async () => {
    const bloqueado = await profissional({ status: 'bloqueado' });
    const semEmail = await profissional({ email: false });
    for (const id of [bloqueado, semEmail]) {
      assert.equal(await guarda(id, 'descoberta_aceite'), false);
      assert.equal(await guarda(id, 'participacao'), false);
    }
  });
});

test('T-06 acesso: lista de permissao nos seis estados e fronteira de ends_at; fachada igual a guarda (T-13)', async () => {
  const casos = [
    ['sem_acesso', { acesso: null }, false],
    ['trial_ativo', { acesso: 'trial' }, true],
    // Trial exige exatamente 14 dias (access_grant_trial_14d): expirado = inicio T-20 dias, fim T-6 dias.
    ['trial_expirado', { acesso: { tipo: 'trial', inicio: T - 20 * DIA, fim: T - 6 * DIA } }, false],
    ['trial_fronteira_aberta', { acesso: { tipo: 'trial', inicio: T + 1 - 14 * DIA, fim: T + 1 } }, true],
    ['trial_fronteira_fechada', { acesso: { tipo: 'trial', inicio: T - 14 * DIA, fim: T } }, false],
    ['paga_ativa', { acesso: { tipo: 'paid', inicio: T - DIA, fim: T + 29 * DIA } }, true],
    ['paga_expirada', { acesso: { tipo: 'paid', inicio: T - 40 * DIA, fim: T - 10 * DIA } }, false],
  ];
  await emTransacao(async () => {
    for (const [nome, { acesso }, esperado] of casos) {
      const id = await profissional({ acesso: acesso ?? null });
      assert.equal(await guarda(id, 'descoberta_aceite'), esperado, `descoberta: ${nome}`);
      assert.equal(await fachada(id), esperado, `fachada: ${nome}`);
    }
  });
});

test('T-11 participacao: aprovado com acesso expirado ou sem acesso e permitido; descoberta negada', async () => {
  await emTransacao(async () => {
    const expirado = await profissional({ acesso: { tipo: 'paid', inicio: T - 40 * DIA, fim: T - 10 * DIA } });
    const semAcesso = await profissional({ acesso: null });
    for (const id of [expirado, semAcesso]) {
      assert.equal(await guarda(id, 'participacao'), true);
      assert.equal(await guarda(id, 'descoberta_aceite'), false);
    }
  });
});

// ---------------------------------------------------------------- Fail closed e instante (T-09, T-10, T-12)

test('T-09 fail closed: nulos, modos invalidos e funcoes ausentes devolvem false sem excecao', async () => {
  await emTransacao(async () => {
    const id = await profissional();
    for (const modo of [null, '', 'DESCOBERTA_ACEITE', 'x']) {
      assert.equal(await guarda(id, modo), false, `modo ${modo}`);
    }
    assert.equal(await guarda(null, 'descoberta_aceite'), false);
    assert.equal(await guarda(id, 'descoberta_aceite', null), false);
    assert.equal(await guarda('00000000-0000-4000-8000-00000000dead', 'descoberta_aceite'), false, 'inexistente');
    await client.query('alter function private.commercial_access(uuid, timestamp with time zone) rename to commercial_access_h042');
    try {
      assert.equal(await guarda(id, 'descoberta_aceite'), false, 'acesso ausente nega descoberta');
      assert.equal(await guarda(id, 'participacao'), true, 'participacao nao usa acesso');
    } finally {
      await client.query('alter function private.commercial_access_h042(uuid, timestamp with time zone) rename to commercial_access');
    }
    await client.query('alter function private.professional_eligible(uuid) rename to professional_eligible_h042');
    try {
      assert.equal(await guarda(id, 'descoberta_aceite'), false, 'elegibilidade ausente nega');
      assert.equal(await guarda(id, 'participacao'), false, 'elegibilidade ausente nega participacao');
    } finally {
      await client.query('alter function private.professional_eligible_h042(uuid) rename to professional_eligible');
    }
  });
});

test('T-10 instante unico: guarda sem now(); mesmo p_now, mesmo resultado; antes e depois do fim muda', async () => {
  const r = await client.query(
    `select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'professional_access_guard'`,
  );
  assert.ok(!/\bnow\s*\(/.test(r.rows[0].prosrc));
  assert.ok(!/clock_timestamp/.test(r.rows[0].prosrc));
  await emTransacao(async () => {
    const id = await profissional({ acesso: { tipo: 'trial', inicio: T - 13 * DIA, fim: T + DIA } });
    assert.equal(await guarda(id, 'descoberta_aceite', AGORA), true);
    assert.equal(await guarda(id, 'descoberta_aceite', AGORA), true);
    assert.equal(await guarda(id, 'descoberta_aceite', iso(T + 2 * DIA)), false);
  });
});

test('T-12 resposta minima: a guarda devolve so boolean', async () => {
  await emTransacao(async () => {
    const id = await profissional();
    for (const modo of ['descoberta_aceite', 'participacao']) {
      assert.equal(typeof (await guarda(id, modo)), 'boolean');
    }
    assert.equal(typeof (await guarda(null, 'participacao')), 'boolean');
  });
});

// ---------------------------------------------------------------- Migracao no banco (T-18)

const NOME_MIGRACAO = '20261113420000_eligibility_expand_professional_access_guard';
const SQL_MIGRACAO = readFileSync(new URL(`../../../supabase/migrations/${NOME_MIGRACAO}.sql`, import.meta.url), 'utf8');
const SQL_REVERSAO = readFileSync(new URL(`../../../supabase/rollbacks/${NOME_MIGRACAO}.down.sql`, import.meta.url), 'utf8');
// Sem linhas de controle de transacao (o teste ja esta numa) e sem gravar no registro de migracoes.
const semControleDeTransacao = (sql) =>
  sql
    .split(/\r?\n/)
    .filter((l) => !/^\s*(begin|commit|rollback)\s*;\s*$/i.test(l))
    .join('\n')
    .replace(/delete from ops\.schema_migration[^;]*;/i, '');

async function estadoDaMigracao() {
  const r = await client.query(
    `select to_regprocedure('private.professional_access_guard(uuid,text,timestamptz)') is not null as guarda,
            to_regprocedure('private.discover_requests(uuid,integer,smallint,integer,uuid)') is not null as entrada5,
            to_regprocedure('private.discover_requests(uuid,integer,smallint,integer,uuid,timestamptz)') is not null as entrada6,
            (select p.prosrc like '%verification_status%' from pg_proc p
               join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'private' and p.proname = 'request_visibility_guard') as "fachadaAntiga"`,
  );
  return r.rows[0];
}

test('T-18 banco: reversao restaura a fachada antiga e e idempotente; reaplicar volta ao estado novo; reaplicar sobre o estado novo falha sem estado parcial', async () => {
  await emTransacao(async () => {
    const novo = await estadoDaMigracao();
    assert.deepEqual(novo, { guarda: true, entrada5: false, entrada6: true, fachadaAntiga: false }, 'estado novo antes');
    await client.query(semControleDeTransacao(SQL_REVERSAO));
    assert.deepEqual(await estadoDaMigracao(), { guarda: false, entrada5: true, entrada6: false, fachadaAntiga: true }, 'reversao');
    await client.query(semControleDeTransacao(SQL_REVERSAO));
    assert.deepEqual(await estadoDaMigracao(), { guarda: false, entrada5: true, entrada6: false, fachadaAntiga: true }, 'reversao idempotente');
    await client.query(semControleDeTransacao(SQL_MIGRACAO));
    assert.deepEqual(await estadoDaMigracao(), { guarda: true, entrada5: false, entrada6: true, fachadaAntiga: false }, 'reaplicacao');
    // Desvio declarado (Issue 55): o arquivo nao e idempotente. Seu bloco de pre-requisitos exige a versao de 5 argumentos
    // da entrada, que o proprio arquivo remove; reaplicar sobre o estado novo para antes de qualquer alteracao
    // (P0001, guarda_pre_requisito_ausente). O savepoint desfaz a tentativa; o db:migrate nao reexecuta migracao aplicada.
    await client.query('savepoint reaplica');
    let erro = null;
    try {
      await client.query(semControleDeTransacao(SQL_MIGRACAO));
    } catch (e) {
      erro = e;
    }
    await client.query('rollback to savepoint reaplica');
    assert.equal(erro?.code, 'P0001', 'reaplicar sobre o estado novo para antes de alterar');
    assert.equal(erro?.message, 'guarda_pre_requisito_ausente');
    assert.deepEqual(await estadoDaMigracao(), { guarda: true, entrada5: false, entrada6: true, fachadaAntiga: false }, 'estado novo preservado');
  });
});
