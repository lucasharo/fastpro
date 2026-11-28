// H-013 (Issue #26) | Concorrencia de erros e de uso unico (docs/factory/91-DESENHO-H013.md, §6: T-H013-19 e 20).
// Cada conexao faz um COMMIT real (a concorrencia exige isso). Dados sinteticos com sufixo aleatorio, sem
// colisao com dados reais, e LIMPEZA no finally de cada prova (linhas de app.auth_challenge, ops.rate_counter
// e ops.code_lock criadas aqui).
// Escopo honesto: as funcoes usadas sao as ja aplicadas no banco (private.auth_code_attempt e
// private.auth_challenge_consume_link), que o embrulho _attach chama dentro da mesma transacao. A prova com o
// embrulho e a anexacao (T-H013-21 e a parte de anexacao do 20) so roda depois de aplicar a migracao
// 20261112130000; essa parte fica marcada como pendente (test.skip) e nao e dada como verde.
// Limites: erroCodigoDia = 50 para o caso de 20 erros nao acionar o bloqueio por e-mail (que mudaria a contagem).
// Rodar sozinho: node --test --test-concurrency=1 packages/db/tests/challenge-concorrencia-h013.dbtest.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const N = 20;
const EM_MS = 15 * 60 * 1000;

/** Abre N conexoes reais (cada uma com o seu commit). */
async function abrirConexoes(n) {
  const lista = [];
  for (let i = 0; i < n; i++) lista.push(await connect());
  return lista;
}

async function fecharConexoes(lista) {
  await Promise.allSettled(lista.map((c) => c.end()));
}

/** Cria, com commit, um desafio sintetico vivo. Devolve os dados necessarios e o que limpar depois. */
async function criarDesafioReal(admin, { codigo, token }) {
  const agora = Date.now();
  const id = randomUUID();
  const emailHash = sha('email-concorrencia-' + randomBytes(12).toString('hex'));
  const codeHmac = sha('codigo-' + codigo + '-' + id);
  const tokenHash = sha('token-' + token + '-' + id);
  await admin.query(
    `insert into app.auth_challenge (id, email_hash, purpose, token_hash, code_hmac, email_enc, secrets_enc,
       expires_at, created_at)
     values ($1, $2, 'publish', $3, $4, $5, $6, $7, $8)`,
    [id, emailHash, tokenHash, codeHmac, Buffer.from('e'), Buffer.from('s'),
      new Date(agora + EM_MS).toISOString(), new Date(agora).toISOString()],
  );
  return {
    id,
    emailHash,
    codeHmac,
    tokenHash,
    ipKey: sha('ip-concorrencia-' + id),
    emailKey: sha('email-chave-concorrencia-' + id),
    agoraIso: new Date(agora + 1000).toISOString(),
  };
}

/** Limpeza: remove o desafio e os contadores criados pela prova (commit). */
async function limpar(admin, d) {
  await admin.query('delete from app.auth_challenge where id = $1', [d.id]);
  await admin.query('delete from ops.rate_counter where key_hmac = any($1::text[])', [[d.ipKey, d.emailKey]]);
  await admin.query('delete from ops.code_lock where key_hmac = any($1::text[])', [[d.emailKey]]);
}

const SQL_ATTEMPT =
  'select * from private.auth_code_attempt($1,$2,$3,$4,$5,$6::timestamptz,$7,$8,$9,$10)';

test('T-H013-19 (base): 20 codigos errados simultaneos => attempts = 5, sem 6, sem ok, invalida por tentativas', async () => {
  const admin = await connect();
  const conexoes = await abrirConexoes(N);
  const d = await criarDesafioReal(admin, { codigo: '111111', token: 'erro' });
  try {
    const resultados = await Promise.all(
      conexoes.map((c) =>
        c.query(SQL_ATTEMPT, [d.id, d.emailHash, 'publish', sha('errado-' + randomUUID()), 5, d.agoraIso, d.ipKey, d.emailKey, 50, 50])
          .then((r) => r.rows[0].out_resultado),
      ),
    );
    const linha = (await admin.query('select attempts, invalid_reason, consumed_at from app.auth_challenge where id = $1', [d.id])).rows[0];
    assert.equal(linha.attempts, 5, 'attempts nunca passa de 5');
    assert.equal(linha.invalid_reason, 'tentativas');
    assert.equal(linha.consumed_at, null);
    assert.equal(resultados.filter((r) => r === 'ok').length, 0, 'nenhum ok');
    assert.equal(resultados.filter((r) => r === 'errado').length, 4, 'exatamente 4 erros antes da invalidacao');
    assert.equal(resultados.filter((r) => r === 'invalido').length, N - 4);
  } finally {
    await limpar(admin, d);
    await fecharConexoes(conexoes);
    await admin.end();
  }
});

test('T-H013-19 (base): 4 codigos errados simultaneos => attempts = 4 exato, desafio vivo', async () => {
  const admin = await connect();
  const conexoes = await abrirConexoes(4);
  const d = await criarDesafioReal(admin, { codigo: '222222', token: 'quatro' });
  try {
    const resultados = await Promise.all(
      conexoes.map((c) =>
        c.query(SQL_ATTEMPT, [d.id, d.emailHash, 'publish', sha('errado-' + randomUUID()), 5, d.agoraIso, d.ipKey, d.emailKey, 50, 50])
          .then((r) => r.rows[0].out_resultado),
      ),
    );
    const linha = (await admin.query('select attempts, invalidated_at from app.auth_challenge where id = $1', [d.id])).rows[0];
    assert.equal(linha.attempts, 4);
    assert.equal(linha.invalidated_at, null, 'ainda vivo');
    assert.deepEqual(resultados.filter((r) => r === 'errado').length, 4);
  } finally {
    await limpar(admin, d);
    await fecharConexoes(conexoes);
    await admin.end();
  }
});

test('T-H013-20 (base): 20 codigos corretos simultaneos => exatamente 1 ok, 19 invalido', async () => {
  const admin = await connect();
  const conexoes = await abrirConexoes(N);
  const d = await criarDesafioReal(admin, { codigo: '333333', token: 'unico' });
  try {
    const resultados = await Promise.all(
      conexoes.map((c) =>
        c.query(SQL_ATTEMPT, [d.id, d.emailHash, 'publish', d.codeHmac, 5, d.agoraIso, d.ipKey, d.emailKey, 50, 50])
          .then((r) => r.rows[0].out_resultado),
      ),
    );
    assert.equal(resultados.filter((r) => r === 'ok').length, 1, 'exatamente um ok');
    assert.equal(resultados.filter((r) => r === 'invalido').length, N - 1);
    const consumido = (await admin.query('select consumed_at from app.auth_challenge where id = $1', [d.id])).rows[0];
    assert.notEqual(consumido.consumed_at, null);
  } finally {
    await limpar(admin, d);
    await fecharConexoes(conexoes);
    await admin.end();
  }
});

test('T-H013-20 (base): 10 consumos pelo link e 10 pelo codigo, simultaneos => exatamente 1 ok', async () => {
  const admin = await connect();
  const conexoes = await abrirConexoes(N);
  const d = await criarDesafioReal(admin, { codigo: '444444', token: 'misto' });
  const tokenPlano = 'token-misto-' + d.id;
  // O hash do link e o que foi gravado em criarDesafioReal (sha('token-misto-' + id)); reproduzido aqui.
  const hashLink = sha('token-' + 'misto' + '-' + d.id);
  try {
    const tarefas = conexoes.map((c, i) =>
      i % 2 === 0
        ? c.query('select * from private.auth_challenge_consume_link($1, $2::timestamptz)', [hashLink, d.agoraIso])
            .then((r) => r.rows[0].out_resultado)
        : c.query(SQL_ATTEMPT, [d.id, d.emailHash, 'publish', d.codeHmac, 5, d.agoraIso, d.ipKey, d.emailKey, 50, 50])
            .then((r) => r.rows[0].out_resultado),
    );
    const resultados = await Promise.all(tarefas);
    assert.equal(resultados.filter((r) => r === 'ok').length, 1, 'link e codigo: um so vence');
    assert.equal(tokenPlano.length > 0, true);
  } finally {
    await limpar(admin, d);
    await fecharConexoes(conexoes);
    await admin.end();
  }
});

test.skip('T-H013-20/21 (anexacao): pendente de aplicar a migracao 20261112130000 no banco de desenvolvimento', () => {});
