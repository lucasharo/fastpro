// H-120 (Issue 129) | Testes de banco da carga e da remocao de demonstracao (85-DESENHO-H120 §5; CA-02, 04, 05, 06, 09).
// Rodam no banco de desenvolvimento do projeto, com a mesma trava do script (decisao 58). Cada caso roda
// dentro de transacao e termina com ROLLBACK (nunca COMMIT): nada e gravado. Sem trava valida, os casos sao pulados.
// Executar: pnpm db:test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect, loadEnvValue } from '../scripts/lib/env.mjs';
import { carregarCamada1, lerChavesDeTeste, removerDemo } from '../scripts/demo-load.mjs';
import { demoGuardRefusal, loadDemoKeys } from '../scripts/lib/demo-guard.mjs';
import { CONTAGENS_CAMADA1, DEMO_ID_LIKE } from '../scripts/lib/demo-ids.mjs';

const envTrava = {
  FASTPRO_DEMO_ALLOW: loadEnvValue('FASTPRO_DEMO_ALLOW'),
  APP_ENV: loadEnvValue('APP_ENV'),
  NEXT_PUBLIC_SUPABASE_URL: loadEnvValue('NEXT_PUBLIC_SUPABASE_URL'),
};
const recusa = demoGuardRefusal(envTrava, loadEnvValue('DATABASE_URL_MIGRATIONS'));
const chaves = recusa === null ? loadDemoKeys(lerChavesDeTeste()) : null;
const motivoSkip = recusa !== null
  ? `trava recusou (${recusa.codigo})`
  : chaves.ok ? false : `chaves de teste ausentes (${chaves.refusal.codigo})`;

let client;
before(async () => {
  if (motivoSkip === false) client = await connect();
});
after(async () => {
  await client?.end();
});

const teste = (nome, fn) => test(nome, { skip: motivoSkip }, fn);

async function dentroDeTransacao(fn) {
  await client.query('begin');
  try {
    await fn();
  } finally {
    await client.query('rollback');
  }
}

async function contagens() {
  const q = async (sql) => (await client.query(sql, [DEMO_ID_LIKE])).rows[0].n;
  return {
    usuarios: await q('select count(*)::int n from app.app_user where id::text like $1'),
    perfis: await q('select count(*)::int n from app.professional_profile where user_id::text like $1'),
    rascunhos: await q('select count(*)::int n from app.request_draft where id::text like $1'),
    coordenadas: await q('select count(*)::int n from app.geocode_point where id::text like $1'),
  };
}

const ESPERADO = Object.freeze({
  usuarios: CONTAGENS_CAMADA1.clientes + CONTAGENS_CAMADA1.profissionais,
  perfis: CONTAGENS_CAMADA1.profissionais,
  rascunhos: CONTAGENS_CAMADA1.rascunhos,
  coordenadas: CONTAGENS_CAMADA1.coordenadas,
});

// CA-H120-06: a remocao apaga so o marcado; um registro sem marcador permanece.
teste('remocao seletiva apaga so os marcados e preserva o registro sem marcador (CA-H120-06)', () =>
  dentroDeTransacao(async () => {
    await carregarCamada1(client, chaves.keys);
    const semMarca = randomUUID();
    await client.query(
      `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
       values ($1, $2, $3, 'ativo', now(), now())`,
      [semMarca, `h120-sem-marca-${semMarca}@exemplo.test`, randomUUID()],
    );
    const r = await removerDemo(client, {});
    assert.equal(r.falha, undefined);
    assert.deepEqual(await contagens(), { usuarios: 0, perfis: 0, rascunhos: 0, coordenadas: 0 });
    const restante = await client.query('select count(*)::int n from app.app_user where id = $1', [semMarca]);
    assert.equal(restante.rows[0].n, 1);
  }));

// CA-H120-04 e CA-H120-05: quantidades do refino; a segunda carga nao cria nem duplica nada.
teste('carga cria as quantidades do refino e a reexecucao nao cria nem duplica (CA-H120-04, CA-H120-05)', () =>
  dentroDeTransacao(async () => {
    await removerDemo(client, {});
    const primeira = await carregarCamada1(client, chaves.keys);
    assert.equal(primeira.falha, undefined);
    assert.equal(primeira.contagens.clientes, CONTAGENS_CAMADA1.clientes);
    assert.equal(primeira.contagens.profissionais, CONTAGENS_CAMADA1.profissionais);
    assert.equal(primeira.contagens.profissionaisAprovados, CONTAGENS_CAMADA1.profissionaisAprovados);
    assert.equal(primeira.contagens.rascunhos, CONTAGENS_CAMADA1.rascunhos);
    assert.equal(primeira.contagens.coordenadas, CONTAGENS_CAMADA1.coordenadas);
    assert.deepEqual(await contagens(), ESPERADO);

    const segunda = await carregarCamada1(client, chaves.keys);
    assert.deepEqual(segunda.contagens, {
      clientes: 0, profissionais: 0, profissionaisAprovados: 0, rascunhos: 0, coordenadas: 0,
    });
    assert.deepEqual(await contagens(), ESPERADO);
  }));

// CA-H120-02: nome, e-mail e endereco trazem a marca de sintetico.
teste('dados carregados trazem a marca de sintetico (CA-H120-02)', () =>
  dentroDeTransacao(async () => {
    await removerDemo(client, {});
    await carregarCamada1(client, chaves.keys);
    const emails = await client.query(
      `select count(*)::int n from app.app_user where id::text like $1 and email like '%@sintetico.test'`,
      [DEMO_ID_LIKE],
    );
    assert.equal(emails.rows[0].n, ESPERADO.usuarios);
    const nomes = await client.query(
      `select count(*)::int n from app.professional_profile where user_id::text like $1 and public_name like '%Sintético%'`,
      [DEMO_ID_LIKE],
    );
    assert.equal(nomes.rows[0].n, ESPERADO.perfis);
    const enderecos = await client.query(
      `select count(*)::int n from app.request_draft where id::text like $1 and address_text = 'Rua Sintética 000'`,
      [DEMO_ID_LIKE],
    );
    assert.equal(enderecos.rows[0].n, ESPERADO.rascunhos);
  }));

// CA-H120-09: a carga nao escreve na fila de e-mail nem na auditoria.
teste('carga nao altera a fila de e-mail nem a cadeia de auditoria (CA-H120-09)', () =>
  dentroDeTransacao(async () => {
    const medir = async () => ({
      outbox: (await client.query('select count(*)::int n from ops.email_outbox')).rows[0].n,
      auditoria: (await client.query('select count(*)::int n from audit.audit_event')).rows[0].n,
    });
    await removerDemo(client, {});
    const antes = await medir();
    await carregarCamada1(client, chaves.keys);
    assert.deepEqual(await medir(), antes);
  }));
