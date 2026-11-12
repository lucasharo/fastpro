// H-035 | Cenarios de banco da protecao do documento (decisao 54; desenho 75 §2, §5; CA-05, CA-06, CA-11).
// Migracao 20261111420000 aplicada no banco de desenvolvimento. Cada teste roda dentro de uma transacao e termina
// com rollback: nada persiste no banco compartilhado. Perfis e valores sinteticos (@example.test, documento falso).
// O papel de conexao nao pode trocar para app_system nesta base (SET ROLE indisponivel): o gatilho de protecao
// vale para qualquer papel, entao os casos de status e imutabilidade rodam no papel de conexao; o privilegio por
// coluna e o EXECUTE de app_system sao lidos do catalogo.
// Rodar sozinho: node --test --test-concurrency=1 packages/db/tests/identity-professional-profile-document.dbtest.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

const sha = (s) => createHash('sha256').update(s).digest('hex');
const SQL_ENVIO =
  'select out_resultado from private.professional_profile_set_document($1, $2, $3, $4, $5, $6, $7)';

/** Transacao de teste: tudo desfeito no fim. A migracao ja esta aplicada; nao e reaplicada aqui. */
async function tx(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

/** Executa um comando que deve falhar e devolve o erro; o savepoint desfaz a falha para seguir na transacao. */
async function erroDe(sql, params) {
  await client.query('savepoint cenario');
  try {
    await client.query(sql, params);
    return null;
  } catch (err) {
    return err;
  } finally {
    await client.query('rollback to savepoint cenario');
  }
}

async function usuario() {
  const id = randomUUID();
  await client.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, 'ativo', now(), now())`,
    [id, `${randomUUID()}@example.test`, randomUUID()],
  );
  return id;
}

/** Perfil sem documento, com o status dado (insert direto: o gatilho so protege UPDATE). */
async function perfil(status = 'pendente') {
  const id = await usuario();
  await client.query(
    `insert into app.professional_profile (user_id, verification_status, created_at, updated_at)
     values ($1, $2, now(), now())`,
    [id, status],
  );
  return id;
}

/** Perfil ja com documento gravado diretamente, no status dado (usado para montar cenarios de protecao). */
async function perfilComDocumento(status, hmac = sha(randomUUID()), slug = `slug-${randomUUID()}`) {
  const id = await usuario();
  await client.query(
    `insert into app.professional_profile
       (user_id, verification_status, public_name, slug, document_type, document_enc, document_hmac, created_at, updated_at)
     values ($1, $2, 'Nome Sintetico', $3, 'CPF', $4, $5, now(), now())`,
    [id, status, slug, Buffer.from(`blob-${randomUUID()}`), hmac],
  );
  return id;
}

function argsEnvio(userId, { hmac = sha(randomUUID()), slug = `slug-${randomUUID()}`, nome = 'Nome Sintetico' } = {}) {
  return [userId, nome, slug, 'CPF', Buffer.from(`blob-${randomUUID()}`), hmac, new Date().toISOString()];
}

/** Chama a funcao de gravacao e devolve o resultado (pendente, retida_duplicidade, ja_cadastrado, sem_perfil). */
async function envia(userId, opcoes) {
  const { rows } = await client.query(SQL_ENVIO, argsEnvio(userId, opcoes));
  return rows[0].out_resultado;
}

async function statusDe(userId) {
  const { rows } = await client.query(
    'select verification_status, document_hmac, slug from app.professional_profile where user_id = $1', [userId]);
  return rows[0];
}

// Gravacao direta do documento (como o primeiro cadastro faz): status pendente ou retida_duplicidade na mesma linha.
async function gravaDocumento(userId, status, hmac = sha(randomUUID()), slug = `slug-${randomUUID()}`) {
  await client.query(
    `update app.professional_profile
        set public_name = 'Nome Sintetico', slug = $2, document_type = 'CPF',
            document_enc = $3, document_hmac = $4, verification_status = $5, updated_at = now()
      where user_id = $1`,
    [userId, slug, Buffer.from(`blob-${randomUUID()}`), hmac, status]);
  return hmac;
}

describe('H-035 banco: app_system nao promove status (decisao 54, item 2)', () => {
  test('update de verification_status para aprovada e recusado com 42501 (professional_status_protegido)', () =>
    tx(async () => {
      const u = await perfil('pendente');
      for (const status of ['aprovada', 'recusada']) {
        const err = await erroDe(
          'update app.professional_profile set verification_status = $2 where user_id = $1', [u, status]);
        assert.ok(err, `${status} deveria ser recusado`);
        assert.equal(err.code, '42501');
        assert.match(err.message, /professional_status_protegido/);
      }
    }));

  test('update de verification_status para em_revisao e suspensa com 42501', () =>
    tx(async () => {
      const u = await perfil('pendente');
      for (const status of ['em_revisao', 'suspensa']) {
        const err = await erroDe(
          'update app.professional_profile set verification_status = $2 where user_id = $1', [u, status]);
        assert.ok(err, `${status} deveria ser recusado`);
        assert.equal(err.code, '42501');
        assert.match(err.message, /professional_status_protegido/);
      }
    }));

  test('primeiro cadastro: pendente -> retida_duplicidade so com document_hmac na mesma atualizacao', () =>
    tx(async () => {
      const u = await perfil('pendente');
      const semHmac = await erroDe(
        "update app.professional_profile set verification_status = 'retida_duplicidade' where user_id = $1", [u]);
      assert.ok(semHmac, 'retida sem HMAC deveria ser recusada');
      assert.equal(semHmac.code, '42501');
      assert.match(semHmac.message, /professional_status_protegido/);

      await gravaDocumento(u, 'retida_duplicidade');
      assert.equal((await statusDe(u)).verification_status, 'retida_duplicidade');
    }));

  test('retida_duplicidade -> pendente ou aprovada e recusado com 42501', () =>
    tx(async () => {
      const u = await perfil('pendente');
      await gravaDocumento(u, 'retida_duplicidade');
      for (const status of ['pendente', 'aprovada']) {
        const err = await erroDe(
          'update app.professional_profile set verification_status = $2 where user_id = $1', [u, status]);
        assert.ok(err, `${status} deveria ser recusado a partir de retida_duplicidade`);
        assert.equal(err.code, '42501');
        assert.match(err.message, /professional_status_protegido/);
      }
    }));
});

describe('H-035 banco: documento gravado e write-once (decisao 54, item 2)', () => {
  test('update de document_hmac, document_enc, document_type, public_name ou slug apos gravado: 42501 (professional_documento_imutavel)', () =>
    tx(async () => {
      const u = await perfil('pendente');
      await gravaDocumento(u, 'pendente');
      const alteracoes = [
        ['document_hmac', sha(randomUUID())],
        ['document_enc', Buffer.from('outro-blob')],
        ['document_type', 'CNPJ'],
        ['public_name', 'Outro Nome'],
        ['slug', `outro-${randomUUID()}`],
      ];
      for (const [coluna, valor] of alteracoes) {
        const err = await erroDe(
          `update app.professional_profile set ${coluna} = $2 where user_id = $1`, [u, valor]);
        assert.ok(err, `alterar ${coluna} deveria ser recusado`);
        assert.equal(err.code, '42501', `${coluna}: SQLSTATE`);
        assert.match(err.message, /professional_documento_imutavel/, `${coluna}: mensagem`);
      }
    }));

  test('update de updated_at e permitido sem mudar o documento', () =>
    tx(async () => {
      const u = await perfil('pendente');
      const hmac = await gravaDocumento(u, 'pendente');
      const antes = await statusDe(u);
      const r = await client.query(
        'update app.professional_profile set updated_at = clock_timestamp() where user_id = $1', [u]);
      assert.equal(r.rowCount, 1);
      const depois = await statusDe(u);
      assert.equal(depois.document_hmac, hmac);
      assert.equal(depois.slug, antes.slug);
    }));

  test('update de user_id e created_at e negado ao papel app_system (grant por coluna)', async () => {
    // Leitura do catalogo: a execucao como app_system nao e possivel nesta base (SET ROLE indisponivel).
    const { rows } = await client.query(`
      select has_column_privilege('app_system', 'app.professional_profile', 'user_id', 'UPDATE') as user_id,
             has_column_privilege('app_system', 'app.professional_profile', 'created_at', 'UPDATE') as created_at,
             has_column_privilege('app_system', 'app.professional_profile', 'public_name', 'UPDATE') as controle`);
    assert.equal(rows[0].user_id, false, 'user_id sem UPDATE para app_system');
    assert.equal(rows[0].created_at, false, 'created_at sem UPDATE para app_system');
    assert.equal(rows[0].controle, true, 'controle: public_name com UPDATE para app_system');
  });
});

describe('H-035 banco: funcao de gravacao (desenho §2 item 4; CA-05, CA-11)', () => {
  test('primeiro envio grava pendente e devolve pendente', () =>
    tx(async () => {
      const u = await perfil('pendente');
      const hmac = sha(randomUUID());
      assert.equal(await envia(u, { hmac }), 'pendente');
      const linha = await statusDe(u);
      assert.equal(linha.verification_status, 'pendente');
      assert.equal(linha.document_hmac, hmac);
    }));

  test('outro perfil nao recusado com o mesmo HMAC: devolve retida_duplicidade', () =>
    tx(async () => {
      const hmac = sha(randomUUID());
      const a = await perfil('pendente');
      assert.equal(await envia(a, { hmac }), 'pendente');
      const b = await perfil('pendente');
      assert.equal(await envia(b, { hmac }), 'retida_duplicidade');
      assert.equal((await statusDe(b)).verification_status, 'retida_duplicidade');
    }));

  test('perfil recusado com o mesmo HMAC nao conta: devolve pendente (CA-06)', () =>
    tx(async () => {
      const hmac = sha(randomUUID());
      await perfilComDocumento('recusada', hmac);
      const b = await perfil('pendente');
      assert.equal(await envia(b, { hmac }), 'pendente');
    }));

  test('segundo envio do mesmo perfil devolve ja_cadastrado e nao reescreve o documento (CA-11)', () =>
    tx(async () => {
      const u = await perfil('pendente');
      const hmac1 = sha(randomUUID());
      const slug1 = `slug-${randomUUID()}`;
      assert.equal(await envia(u, { hmac: hmac1, slug: slug1 }), 'pendente');
      assert.equal(await envia(u, { hmac: sha(randomUUID()), slug: `slug-${randomUUID()}` }), 'ja_cadastrado');
      const linha = await statusDe(u);
      assert.equal(linha.document_hmac, hmac1);
      assert.equal(linha.slug, slug1);
    }));

  test('corrida de dois envios com o mesmo HMAC: 23505 do indice de HMAC vira retida_duplicidade', { skip: 'NAO_VERIFICAVEL: a corrida exige duas transacoes concorrentes com commit real, que persistiria no banco compartilhado; uma transacao unica nao reproduz a janela entre a checagem e o UPDATE (H-035, desenho 75 §2)' }, () => {});

  test('colisao de slug re-lanca o erro (quem chama acrescenta sufixo)', () =>
    tx(async () => {
      const slug = `slug-${randomUUID()}`;
      const a = await perfil('pendente');
      assert.equal(await envia(a, { slug }), 'pendente');
      const b = await perfil('pendente');
      const err = await erroDe(SQL_ENVIO, argsEnvio(b, { slug }));
      assert.ok(err, 'slug repetido deveria falhar');
      assert.equal(err.code, '23505');
      assert.equal(err.constraint, 'professional_profile_slug_key');
    }));

  test('sem linha de perfil devolve sem_perfil', () =>
    tx(async () => {
      assert.equal(await envia(randomUUID()), 'sem_perfil');
    }));

  test('a funcao nao e security definer (pg_proc.prosecdef = false) e so app_system executa', async () => {
    const { rows } = await client.query(`
      select p.prosecdef,
             has_function_privilege('app_system', p.oid, 'EXECUTE') as app_system,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
             has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role,
             exists (
               select 1
                 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where a.grantee = 0 and a.privilege_type = 'EXECUTE') as publico
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private'
         and p.proname = 'professional_profile_set_document'`);
    assert.equal(rows.length, 1, 'funcao existe');
    assert.equal(rows[0].prosecdef, false, 'sem security definer');
    assert.equal(rows[0].app_system, true, 'app_system executa');
    assert.equal(rows[0].anon, false, 'anon nao executa');
    assert.equal(rows[0].authenticated, false, 'authenticated nao executa');
    assert.equal(rows[0].service_role, false, 'service_role nao executa');
    assert.equal(rows[0].publico, false, 'PUBLIC nao executa');
  });
});
