// Issue 57 (H-044) | Concorrencia da ativacao do trial entre duas conexoes (docs/factory/135-DESENHO-H044.md, §6, T-08).
// Conexao A ativa e segura a transacao aberta; conexao B chama a mesma identidade e espera (verificado em
// pg_stat_activity). Cenario 1: A confirma, B devolve trial_used (1 linha, 1 ok, 1 trial_used).
// Cenario 2: A desfaz, B grava (ok) e desfaz tambem, sem resíduo de trial.
// RESIDUO (decisao 542, aceita pelo lider): o cenario 1 confirma um perfil sintetico, um trial e eventos de auditoria
// com marcador unico (email h044-conc-<sufixo>@example.test). O livro proibe DELETE; nada e apagado aqui.
// Sem rede, sem provedor externo. Todas as conexoes sao encerradas no fim, e transacao aberta e desfeita.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { connect } from '../scripts/lib/env.mjs';

const T0 = Date.parse('2030-01-01T12:00:00.000Z');
const SUF = randomUUID().slice(0, 8);
const at = (ms) => new Date(ms).toISOString();
const SQL_ATIVAR = 'select out_code, out_grant_id, out_starts_at, out_ends_at from private.trial_activate($1, $2, $3, $4)';

async function fechar(cliente) {
  if (cliente) await cliente.end().catch(() => {});
}

/** Encerra transacao que tenha ficado aberta (rollback e inofensivo quando nao ha transacao). */
async function encerrar(cliente) {
  if (!cliente) return;
  await cliente.query('rollback').catch(() => {});
}

/** Perfil aprovado com documento sintetico, confirmado (commit) para que as duas conexoes o vejam. */
async function perfilAprovadoConfirmado(admin) {
  const id = randomUUID();
  await admin.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, 'ativo', now(), now())`,
    [id, `h044-conc-${SUF}-${id.slice(0, 8)}@example.test`, randomUUID()],
  );
  await admin.query(
    `insert into app.professional_profile
       (user_id, verification_status, public_name, slug, document_type, document_enc, document_hmac, verified_at, created_at, updated_at)
     values ($1, 'aprovada', 'Nome Sintetico', $2, 'CPF', $3, $4, now(), now(), now())`,
    [id, `h044-conc-slug-${SUF}-${id.slice(0, 8)}`, Buffer.from(`blob-${randomUUID()}`), randomBytes(32).toString('hex')],
  );
  return id;
}

async function esperarBloqueio(admin, pid, limiteMs = 15000) {
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    const { rows } = await admin.query('select wait_event_type from pg_stat_activity where pid = $1', [pid]);
    if (rows[0]?.wait_event_type === 'Lock') return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

test('T-08 cenario 1: A confirma, B espera e devolve trial_used (1 linha, 1 ok, 1 trial_used)', async () => {
  const admin = await connect();
  const a = await connect();
  const b = await connect();
  try {
    await admin.query("set application_name = 'fastpro-h044-concorrencia'");
    const prof = await perfilAprovadoConfirmado(admin);
    const pidB = await (async () => {
      await b.query("set lock_timeout = '20s'");
      const { rows } = await b.query('select pg_backend_pid() as pid');
      return rows[0].pid;
    })();

    await a.query('begin');
    const ra = await a.query(SQL_ATIVAR, [prof, `professional:${prof}`, at(T0), null]);
    assert.equal(ra.rows[0].out_code, 'ok', 'A ativa e segura a transacao');

    await b.query('begin');
    const promessaB = b.query(SQL_ATIVAR, [prof, `professional:${prof}`, at(T0), null]);
    const bloqueou = await esperarBloqueio(admin, pidB);
    assert.equal(bloqueou, true, 'B esperou o bloqueio de A (pg_stat_activity)');

    await a.query('commit');
    const rb = await promessaB;
    assert.equal(rb.rows[0].out_code, 'trial_used', 'B recebe trial_used depois da confirmacao de A');
    await b.query('rollback');

    const { rows } = await admin.query(
      `select count(*)::int as n from billing.access_grant where professional_id = $1 and type = 'trial'`, [prof]);
    assert.equal(rows[0].n, 1, 'exatamente uma linha de trial');
  } finally {
    await encerrar(b);
    await encerrar(a);
    await fechar(b);
    await fechar(a);
    await fechar(admin);
  }
});

test('T-08 cenario 2: A desfaz, B grava (ok) e desfaz; nenhum trial fica no banco', async () => {
  const admin = await connect();
  const a = await connect();
  const b = await connect();
  try {
    const prof = await perfilAprovadoConfirmado(admin);
    const { rows: pidRows } = await b.query('select pg_backend_pid() as pid');
    const pidB = pidRows[0].pid;

    await a.query('begin');
    const ra = await a.query(SQL_ATIVAR, [prof, `professional:${prof}`, at(T0), null]);
    assert.equal(ra.rows[0].out_code, 'ok');

    await b.query('begin');
    const promessaB = b.query(SQL_ATIVAR, [prof, `professional:${prof}`, at(T0), null]);
    const bloqueou = await esperarBloqueio(admin, pidB);
    assert.equal(bloqueou, true, 'B esperou o bloqueio de A');

    await a.query('rollback');
    const rb = await promessaB;
    assert.equal(rb.rows[0].out_code, 'ok', 'com A desfeita, B grava o trial');
    await b.query('rollback');

    const { rows } = await admin.query(
      `select count(*)::int as n from billing.access_grant where professional_id = $1 and type = 'trial'`, [prof]);
    assert.equal(rows[0].n, 0, 'nenhum trial persistido nesta variante');
  } finally {
    await encerrar(b);
    await encerrar(a);
    await fechar(b);
    await fechar(a);
    await fechar(admin);
  }
});
