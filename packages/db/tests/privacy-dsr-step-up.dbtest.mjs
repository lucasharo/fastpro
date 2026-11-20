// Issue 120 (H-111) | Step-up do titular no banco de desenvolvimento (147-DESENHO-H111 §3.2, §5.1). Cada teste roda em
// transacao e e desfeito (rollback). Valores sinteticos (@example.test). Sem rede, sem e-mail real, sem codigo real.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

// Hash sintetico que representa o HMAC do codigo (o banco so compara hashes; o codigo real nunca chega aqui).
const hmacDe = (texto) => createHash('sha256').update(texto).digest('hex');
const STATUS_NAO_ATIVO = 'bloqueado';

async function tx(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

/** Executa um comando que deve falhar; savepoint mantem a transacao viva. Devolve o erro (ou falha o teste). */
async function erroDe(sql, params = []) {
  await client.query('savepoint sp');
  try {
    await client.query(sql, params);
  } catch (err) {
    await client.query('rollback to savepoint sp');
    return err;
  }
  await client.query('release savepoint sp');
  assert.fail(`deveria ter falhado: ${sql.slice(0, 80)}`);
}

async function usuario(status = 'ativo') {
  const id = randomUUID();
  await client.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, $4, now(), now())`,
    [id, `${randomUUID()}@example.test`, randomUUID(), status],
  );
  return id;
}

async function emitir(user, codigoHmac = hmacDe(randomUUID())) {
  const codigoId = randomUUID();
  const { rows } = await client.query(
    'select out_resultado, out_outbox_id, out_retry_after from app.dsr_step_up_issue($1, $2, $3, $4)',
    [user, codigoId, codigoHmac, randomBytes(48)],
  );
  return { codigoId, ...rows[0] };
}

async function confirmar(user, codigoHmac) {
  const { rows } = await client.query(
    'select out_resultado, out_expires_at, out_retry_after from app.dsr_step_up_confirm($1, $2, $3)',
    [user, codigoHmac, hmacDe(randomUUID())],
  );
  return rows[0];
}

test('emissao cria o codigo, enfileira o e-mail e guarda o blob cifrado', () =>
  tx(async () => {
    const user = await usuario();
    const r = await emitir(user);
    assert.equal(r.out_resultado, 'criado');
    assert.ok(r.out_outbox_id, 'deve devolver a saida do e-mail');
    const { rows } = await client.query(
      'select outbox_id, code_enc is not null as tem_blob, attempts from app.dsr_step_up_code where id = $1',
      [r.codigoId],
    );
    assert.equal(rows[0].outbox_id, r.out_outbox_id);
    assert.equal(rows[0].tem_blob, true);
    assert.equal(rows[0].attempts, 0);
  }));

test('usuario sem status ativo recebe negado e nada e gravado', () =>
  tx(async () => {
    const user = await usuario(STATUS_NAO_ATIVO);
    const r = await emitir(user);
    assert.equal(r.out_resultado, 'negado');
    const { rows } = await client.query('select count(*)::int as n from app.dsr_step_up_code where user_id = $1', [user]);
    assert.equal(rows[0].n, 0);
  }));

test('limite de 3 emissoes por hora: a quarta recebe limite com tempo de espera', () =>
  tx(async () => {
    const user = await usuario();
    for (let i = 0; i < 3; i += 1) {
      assert.equal((await emitir(user)).out_resultado, 'criado');
    }
    const quarta = await emitir(user);
    assert.equal(quarta.out_resultado, 'limite');
    assert.ok(Number(quarta.out_retry_after) >= 1 && Number(quarta.out_retry_after) <= 3600);
  }));

test('um codigo novo invalida o anterior vivo do mesmo titular', () =>
  tx(async () => {
    const user = await usuario();
    const primeiro = await emitir(user);
    await emitir(user);
    const { rows } = await client.query(
      'select invalidated_at is not null as invalidado, code_enc is null as sem_blob from app.dsr_step_up_code where id = $1',
      [primeiro.codigoId],
    );
    assert.equal(rows[0].invalidado, true);
    assert.equal(rows[0].sem_blob, true);
  }));

test('confirmacao com codigo certo cria grant de uso unico (dsr_open) e consome o codigo', () =>
  tx(async () => {
    const user = await usuario();
    const codigoHmac = hmacDe(`${user}|123456`);
    const r = await emitir(user, codigoHmac);
    assert.equal(r.out_resultado, 'criado');
    const ok = await confirmar(user, codigoHmac);
    assert.equal(ok.out_resultado, 'ok');
    assert.ok(ok.out_expires_at, 'deve devolver a validade do token');
    const grant = await client.query(
      "select count(*)::int as n from app.step_up_grant where user_id = $1 and purpose = 'dsr_open'",
      [user],
    );
    assert.equal(grant.rows[0].n, 1);
    const sealed = await client.query('select out_code_enc from app.dsr_step_up_code_sealed($1)', [r.codigoId]);
    assert.equal(sealed.rows.length, 0, 'codigo consumido nao entrega mais o blob');
    const reuso = await confirmar(user, codigoHmac);
    assert.equal(reuso.out_resultado, 'invalido');
  }));

test('codigo errado conta tentativa; a quinta errada bloqueia por 15 minutos e barra nova emissao', () =>
  tx(async () => {
    const user = await usuario();
    await emitir(user, hmacDe(`${user}|999999`));
    for (let i = 0; i < 4; i += 1) {
      assert.equal((await confirmar(user, hmacDe(`errado-${i}`))).out_resultado, 'invalido');
    }
    const quinta = await confirmar(user, hmacDe('errado-5'));
    assert.equal(quinta.out_resultado, 'bloqueado');
    assert.equal(Number(quinta.out_retry_after), 900);
    const nova = await emitir(user);
    assert.equal(nova.out_resultado, 'bloqueado');
  }));

test('blob cifrado e recuperavel enquanto o codigo esta vivo', () =>
  tx(async () => {
    const user = await usuario();
    const r = await emitir(user);
    const sealed = await client.query('select out_code_enc from app.dsr_step_up_code_sealed($1)', [r.codigoId]);
    assert.equal(sealed.rows.length, 1);
    assert.ok(Buffer.isBuffer(sealed.rows[0].out_code_enc));
  }));

test('tentativas nunca regridem e o registro nao aceita DELETE', () =>
  tx(async () => {
    const user = await usuario();
    const r = await emitir(user);
    await client.query('update app.dsr_step_up_code set attempts = 2 where id = $1', [r.codigoId]);
    const regressao = await erroDe('update app.dsr_step_up_code set attempts = 0 where id = $1', [r.codigoId]);
    assert.match(String(regressao.message), /dsr_step_up_code_tentativas_regressivas/);
    const apagar = await erroDe('delete from app.dsr_step_up_code where id = $1', [r.codigoId]);
    assert.ok(apagar, 'delete deve ser recusado');
  }));

test('funcoes do step-up nao sao executaveis por public, anon nem authenticated', async () => {
  const { rows } = await client.query(`
    select p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_pode,
           has_function_privilege('anon', p.oid, 'EXECUTE') as anon_pode
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname like 'dsr_step_up%'`);
  assert.ok(rows.length >= 3, 'as tres funcoes do step-up devem existir');
  for (const linha of rows) {
    assert.equal(linha.auth_pode, false, `${linha.proname} nao pode ser chamada por authenticated`);
    assert.equal(linha.anon_pode, false, `${linha.proname} nao pode ser chamada por anon`);
  }
});
