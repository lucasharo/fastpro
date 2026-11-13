// Issue 52 (H-039) | T-26 (docs/factory/124-DESENHO-H039.md §6, CA-H039-19): aplicar a migracao, desfazer com o
// down e reaplicar (idempotencia). Tudo dentro de transacoes que terminam em rollback: nada e gravado no banco de
// desenvolvimento. O begin/commit de nivel superior dos arquivos sai da copia em memoria, para nao encerrar a
// transacao de teste. O down e recusado por guarda enquanto houver caso decidido ou leitura de documento
// registrada (os dbtests de concorrencia deixam esses dados sinteticos no DEV, pergunta 261); nesse caso o ciclo
// completo fica pendente de banco descartavel e o teste registra o motivo, sem apagar nada.
// Sem rede, sem envio de e-mail, sem Mapbox.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, REPO_ROOT } from '../scripts/lib/env.mjs';

const NOME = '20261113200000_verification_create_case_queue';
const UP = readFileSync(join(REPO_ROOT, 'supabase', 'migrations', `${NOME}.sql`), 'utf8');
const DOWN = readFileSync(join(REPO_ROOT, 'supabase', 'rollbacks', `${NOME}.down.sql`), 'utf8');
const semControle = (sql) => sql.replace(/^\s*(begin|commit|rollback)\s*;\s*$/gim, '');

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

async function existeTabela() {
  const { rows } = await client.query("select to_regclass('app.verification_case') is not null as ok");
  return rows[0].ok;
}

/** Verdadeiro quando o down recusaria por guarda: ha caso com decisao/recurso ou leitura de documento. */
async function bloqueadoPorDados() {
  const { rows } = await client.query(`
    select exists (select 1 from app.verification_case where status <> 'pendente' or appeal_status <> 'nenhum')
        or exists (select 1 from app.sensitive_access_log where scope_kind = 'identity_document') as bloqueado`);
  return rows[0].bloqueado;
}

test('T-26 | reaplicar a migracao sobre o banco ja migrado e idempotente (transacao desfeita)', async () => {
  const antes = await existeTabela();
  await client.query('begin');
  try {
    await client.query(semControle(UP));
    assert.equal(await existeTabela(), true, 'tabela continua existindo apos a reaplicacao');
  } finally {
    await client.query('rollback');
  }
  assert.equal(await existeTabela(), antes, 'rollback devolve o banco ao estado inicial');
});

test('T-26 | o down recusa por guarda enquanto houver dados que exigem exportacao (nada e removido)', async (t) => {
  if (!(await bloqueadoPorDados())) {
    t.skip('sem caso decidido nem leitura de documento: a guarda nao se aplica neste banco');
    return;
  }
  await client.query('begin');
  try {
    await client.query('savepoint recusa');
    await assert.rejects(client.query(semControle(DOWN)), (err) => /rollback_recusado/.test(String(err.message)));
    await client.query('rollback to savepoint recusa');
    assert.equal(await existeTabela(), true, 'a tabela permanece apos a recusa');
  } finally {
    await client.query('rollback');
  }
});

test('T-26 | ciclo completo: aplicar, desfazer com o down e reaplicar (so sem dados que a guarda bloqueia)', async (t) => {
  if (await bloqueadoPorDados()) {
    t.skip('ciclo completo pendente de banco descartavel: ha dados que o down recusa por guarda (pergunta 261)');
    return;
  }
  const antes = await existeTabela();
  await client.query('begin');
  try {
    await client.query(semControle(UP));
    await client.query(semControle(DOWN));
    assert.equal(await existeTabela(), false, 'tabela removida pelo down');
    await client.query(semControle(UP));
    assert.equal(await existeTabela(), true, 'tabela recriada na reaplicacao');
  } finally {
    await client.query('rollback');
  }
  assert.equal(await existeTabela(), antes, 'rollback devolve o banco ao estado inicial');
});
