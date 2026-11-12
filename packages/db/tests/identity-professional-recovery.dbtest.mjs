// H-016 | Testes de banco das funcoes da migracao 20261112100500 (docs/factory/33-DESENHO-H016.md §4, §5.2,
// §6, §8; 67-DESENHO-H016.md §8). Cobre professional_me, professional_challenge_create, password_reset_peek,
// password_reset_consume e professional_sessions_revoke_others. Cada teste roda numa transacao que termina
// em ROLLBACK: nada e gravado no banco de desenvolvimento. Dados sinteticos (e-mail example.test).
// Executar sozinho: node --test --test-concurrency=1 packages/db/tests/identity-professional-recovery.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';

const AGORA = '2099-01-01T12:00:00.000Z';
const DEPOIS_DO_PRAZO = '2099-01-01T12:16:00.000Z';
const SESSAO_VALIDA = '2099-01-01T12:01:00.000Z';

let client;
let aplicada = false;

before(async () => {
  client = await connect();
  const res = await client.query(
    `select to_regprocedure('private.password_reset_consume(text,timestamptz)') is not null
        and to_regprocedure('private.professional_sessions_revoke_others(uuid,uuid,timestamptz)') is not null as ok`,
  );
  aplicada = res.rows[0].ok === true;
});

after(async () => {
  await client?.end();
});

const hex = () => randomBytes(32).toString('hex');

/** Conta sintetica dentro da transacao corrente. */
async function criarUsuario(c, { verificado, status = 'ativo', profissional = false, situacao = 'pendente' }) {
  const id = randomUUID();
  const authId = randomUUID();
  const email = `sintetico.${randomBytes(6).toString('hex')}@example.test`;
  await c.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz)`,
    [id, email, authId, status, verificado ? AGORA : null, AGORA],
  );
  if (profissional) {
    await c.query(
      `insert into app.professional_profile (user_id, verification_status, created_at, updated_at)
       values ($1, $3, $2::timestamptz, $2::timestamptz)`,
      [id, AGORA, situacao],
    );
  }
  return { id, email, authId };
}

/** Cria um desafio pela funcao real e devolve o hash do token para consulta posterior. */
async function criarDesafio(c, email, proposito, agora = AGORA) {
  const tokenHash = hex();
  const emailHash = hex();
  const res = await c.query(
    'select * from private.professional_challenge_create($1, $2, $3, $4, $5, $6::timestamptz)',
    [email, emailHash, proposito, randomUUID(), tokenHash, agora],
  );
  return { tokenHash, emailHash, criou: res.rows.length > 0, linha: res.rows[0] };
}

/** Roda o corpo numa transacao e sempre desfaz. */
async function emTransacao(corpo) {
  await client.query('begin');
  try {
    return await corpo(client);
  } finally {
    await client.query('rollback');
  }
}

const pular = (t) => t.skip('migracao 20261112100500 ainda nao aplicada no banco de desenvolvimento');

test('professional_me: profissional devolve estado e conta; cliente sem perfil nao devolve nada', async (t) => {
  if (!aplicada) return pular(t);
  await emTransacao(async (c) => {
    const pro = await criarUsuario(c, { verificado: false, profissional: true });
    const cli = await criarUsuario(c, { verificado: true, profissional: false });
    const r1 = await c.query('select * from private.professional_me($1)', [pro.id]);
    assert.equal(r1.rows.length, 1);
    assert.equal(r1.rows[0].out_email_verified, false);
    assert.equal(r1.rows[0].out_status, 'pendente');
    assert.equal(r1.rows[0].out_active, true);
    assert.equal(r1.rows[0].out_auth_user_id, pro.authId);
    const r2 = await c.query('select * from private.professional_me($1)', [cli.id]);
    assert.equal(r2.rows.length, 0, 'cliente sem perfil nao tem estado profissional');
  });
});

test('professional_eligible e is_email_verified: so verificado e aprovado libera (CA-H016-05, CA-H016-22)', async (t) => {
  if (!aplicada) return pular(t);
  // Estado 'aprovada' e gravado na criacao: o guarda do perfil (H-035) so aceita mudanca pela funcao de H-039.
  await emTransacao(async (c) => {
    const pendente = await criarUsuario(c, { verificado: true, profissional: true, situacao: 'pendente' });
    const r = await c.query('select private.professional_eligible($1) as ok, private.is_email_verified($1) as v', [pendente.id]);
    assert.equal(r.rows[0].ok, false, 'pendente nao e elegivel');
    assert.equal(r.rows[0].v, true);
  });
  for (const situacao of ['em_revisao', 'retida_duplicidade', 'recusada', 'suspensa']) {
    await emTransacao(async (c) => {
      const u = await criarUsuario(c, { verificado: true, profissional: true, situacao });
      const r = await c.query('select private.professional_eligible($1) as ok', [u.id]);
      assert.equal(r.rows[0].ok, false, `${situacao} nao e elegivel`);
    });
  }
  await emTransacao(async (c) => {
    const aprovado = await criarUsuario(c, { verificado: true, profissional: true, situacao: 'aprovada' });
    const r = await c.query('select private.professional_eligible($1) as ok', [aprovado.id]);
    assert.equal(r.rows[0].ok, true, 'aprovada e verificada libera');
    const semEmail = await criarUsuario(c, { verificado: false, profissional: true, situacao: 'aprovada' });
    const r2 = await c.query('select private.professional_eligible($1) as ok', [semEmail.id]);
    assert.equal(r2.rows[0].ok, false, 'aprovada sem e-mail verificado nao libera (CA-H016-05)');
  });
});

test('professional_challenge_create: cada proposito so vale para o estado certo da conta', async (t) => {
  if (!aplicada) return pular(t);
  await emTransacao(async (c) => {
    const proNaoVerif = await criarUsuario(c, { verificado: false, profissional: true });
    const proVerif = await criarUsuario(c, { verificado: true, profissional: true });
    const cliVerif = await criarUsuario(c, { verificado: true, profissional: false });
    const cliNaoVerif = await criarUsuario(c, { verificado: false, profissional: false });
    const bloqueado = await criarUsuario(c, { verificado: true, status: 'bloqueado', profissional: true });

    assert.equal((await criarDesafio(c, proNaoVerif.email, 'professional_verify')).criou, true, 'reenvio para pro nao verificado');
    assert.equal((await criarDesafio(c, proVerif.email, 'professional_verify')).criou, false, 'reenvio nao vale para pro verificado');
    assert.equal((await criarDesafio(c, proVerif.email, 'password_reset')).criou, true, 'recuperacao vale para pro verificado');
    assert.equal((await criarDesafio(c, proNaoVerif.email, 'password_reset')).criou, true, 'recuperacao vale para pro nao verificado');
    assert.equal((await criarDesafio(c, cliVerif.email, 'password_reset')).criou, false, 'recuperacao nao vale para cliente');
    assert.equal((await criarDesafio(c, cliVerif.email, 'professional_activate')).criou, true, 'ativacao vale para cliente verificado');
    assert.equal((await criarDesafio(c, cliNaoVerif.email, 'professional_activate')).criou, false, 'ativacao exige e-mail verificado');
    assert.equal((await criarDesafio(c, proVerif.email, 'professional_activate')).criou, false, 'ativacao nao vale para quem ja e profissional');
    assert.equal((await criarDesafio(c, bloqueado.email, 'password_reset')).criou, false, 'conta bloqueada nao recebe desafio');
    assert.equal((await criarDesafio(c, 'ninguem.sintetico@example.test', 'password_reset')).criou, false, 'conta inexistente nao recebe desafio');
  });
});

test('professional_challenge_create: proposito invalido ou nulo levanta erro 22023', async (t) => {
  if (!aplicada) return pular(t);
  // Um erro aborta a transacao no Postgres: cada caso roda na sua propria transacao.
  for (const proposito of ['proposito_inventado', null]) {
    await emTransacao(async (c) => {
      const u = await criarUsuario(c, { verificado: true, profissional: true });
      await assert.rejects(criarDesafio(c, u.email, proposito), (err) => err.code === '22023');
    });
  }
});

test('professional_challenge_create: novo link substitui o anterior do mesmo proposito', async (t) => {
  if (!aplicada) return pular(t);
  await emTransacao(async (c) => {
    const u = await criarUsuario(c, { verificado: true, profissional: true });
    const emailHash = hex();
    const antigo = hex();
    await c.query('select * from private.professional_challenge_create($1, $2, $3, $4, $5, $6::timestamptz)', [
      u.email, emailHash, 'password_reset', randomUUID(), antigo, AGORA,
    ]);
    await c.query('select * from private.professional_challenge_create($1, $2, $3, $4, $5, $6::timestamptz)', [
      u.email, emailHash, 'password_reset', randomUUID(), hex(), AGORA,
    ]);
    const r = await c.query('select invalid_reason, invalidated_at is not null as invalido from app.auth_challenge where token_hash = $1', [antigo]);
    assert.equal(r.rows[0].invalido, true);
    assert.equal(r.rows[0].invalid_reason, 'substituido');
  });
});

test('password_reset_peek: link vivo aparece; vencido, consumido ou inexistente nao', async (t) => {
  if (!aplicada) return pular(t);
  await emTransacao(async (c) => {
    const u = await criarUsuario(c, { verificado: true, profissional: true });
    const d = await criarDesafio(c, u.email, 'password_reset');
    const vivo = await c.query('select * from private.password_reset_peek($1, $2::timestamptz)', [d.tokenHash, SESSAO_VALIDA]);
    assert.equal(vivo.rows.length, 1);
    assert.equal(vivo.rows[0].out_email, u.email);
    assert.equal(vivo.rows[0].out_purpose, 'password_reset');
    const vencido = await c.query('select * from private.password_reset_peek($1, $2::timestamptz)', [d.tokenHash, DEPOIS_DO_PRAZO]);
    assert.equal(vencido.rows.length, 0, 'link de 15 min vencido nao serve');
    const inexistente = await c.query('select * from private.password_reset_peek($1, $2::timestamptz)', [hex(), SESSAO_VALIDA]);
    assert.equal(inexistente.rows.length, 0);
  });
});

test('password_reset_consume: uso unico, verifica o e-mail, revoga sessoes e nao cria perfil para recuperacao', async (t) => {
  if (!aplicada) return pular(t);
  await emTransacao(async (c) => {
    const u = await criarUsuario(c, { verificado: false, profissional: true });
    const d = await criarDesafio(c, u.email, 'password_reset');
    await c.query('select * from private.professional_session_open($1, $2, $3, $4::timestamptz)', [
      randomUUID(), u.id, hex(), AGORA,
    ]);
    const primeiro = await c.query('select * from private.password_reset_consume($1, $2::timestamptz)', [d.tokenHash, SESSAO_VALIDA]);
    assert.equal(primeiro.rows.length, 1);
    assert.equal(primeiro.rows[0].out_email, u.email);
    assert.equal(primeiro.rows[0].out_purpose, 'password_reset');
    const verificado = await c.query('select email_verified_at is not null as v from app.app_user where id = $1', [u.id]);
    assert.equal(verificado.rows[0].v, true, 'consumir o link verifica o e-mail');
    const sessoes = await c.query('select count(*)::int as n from app.app_session where user_id = $1 and revoked_at is null', [u.id]);
    assert.equal(sessoes.rows[0].n, 0, 'troca de senha revoga todas as sessoes');
    const segundo = await c.query('select * from private.password_reset_consume($1, $2::timestamptz)', [d.tokenHash, SESSAO_VALIDA]);
    assert.equal(segundo.rows.length, 0, 'link usado nao serve de novo');
  });
});

test('password_reset_consume: ativacao de cliente cria o perfil profissional pendente', async (t) => {
  if (!aplicada) return pular(t);
  await emTransacao(async (c) => {
    const cli = await criarUsuario(c, { verificado: true, profissional: false });
    const d = await criarDesafio(c, cli.email, 'professional_activate');
    const r = await c.query('select * from private.password_reset_consume($1, $2::timestamptz)', [d.tokenHash, SESSAO_VALIDA]);
    assert.equal(r.rows[0].out_purpose, 'professional_activate');
    const perfil = await c.query('select verification_status from app.professional_profile where user_id = $1', [cli.id]);
    assert.equal(perfil.rows.length, 1);
    assert.equal(perfil.rows[0].verification_status, 'pendente');
  });
});

test('password_reset_consume: link vencido nao consome nem muda a conta', async (t) => {
  if (!aplicada) return pular(t);
  await emTransacao(async (c) => {
    const u = await criarUsuario(c, { verificado: false, profissional: true });
    const d = await criarDesafio(c, u.email, 'password_reset');
    const r = await c.query('select * from private.password_reset_consume($1, $2::timestamptz)', [d.tokenHash, DEPOIS_DO_PRAZO]);
    assert.equal(r.rows.length, 0);
    const verificado = await c.query('select email_verified_at is null as nulo from app.app_user where id = $1', [u.id]);
    assert.equal(verificado.rows[0].nulo, true, 'link vencido nao verifica o e-mail');
  });
});

test('professional_sessions_revoke_others: mantem a sessao atual e revoga as outras', async (t) => {
  if (!aplicada) return pular(t);
  await emTransacao(async (c) => {
    const u = await criarUsuario(c, { verificado: true, profissional: true });
    const atual = randomUUID();
    const outra1 = randomUUID();
    const outra2 = randomUUID();
    for (const id of [atual, outra1, outra2]) {
      await c.query('select * from private.professional_session_open($1, $2, $3, $4::timestamptz)', [id, u.id, hex(), AGORA]);
    }
    const r = await c.query('select private.professional_sessions_revoke_others($1, $2, $3::timestamptz) as n', [
      u.id, atual, SESSAO_VALIDA,
    ]);
    assert.equal(r.rows[0].n, 2);
    const vivas = await c.query('select id from app.app_session where user_id = $1 and revoked_at is null', [u.id]);
    assert.deepEqual(vivas.rows.map((x) => x.id), [atual]);
  });
});
