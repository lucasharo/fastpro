// Issue 120 (H-111) | Anonimizacao da conta do titular no banco (147-DESENHO-H111 §4.3, §7: T-DB-15, T-DB-16, T-DB-17,
// T-DB-19 e T-DB-26 na parte implementada nesta fatia). Banco de desenvolvimento. Cada teste roda em transacao e e
// desfeito (rollback). Valores sinteticos (@example.test). Sem rede, sem e-mail real.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

const hex = () => randomBytes(32).toString('hex');
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const ANONIMO = /^anon-[0-9a-f]{32}@anon\.fastpro\.internal$/;
const CHAMADA = 'select private.dsr_anonymize_subject($1::uuid) as r';

function protocolo() {
  let sufixo = '';
  for (let i = 0; i < 6; i += 1) sufixo += B32[randomBytes(1)[0] % 32];
  return `DSR-20261119-${sufixo}`;
}

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

async function usuario(status = 'em_eliminacao', email = `${randomUUID()}@example.test`) {
  const id = randomUUID();
  await client.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, $4, now(), now())`,
    [id, email, randomUUID(), status],
  );
  return id;
}

async function administrador() {
  const id = await usuario('ativo');
  await client.query(
    `insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at, created_at, status_changed_at)
     values ($1, 'ativo', 'bootstrap', null, now(), now(), now())`,
    [id],
  );
  return id;
}

/** Sessao ativa (senha) e grant de step-up ainda abertos do titular. */
async function sessaoEGrant(id) {
  const sessao = randomUUID();
  await client.query(
    `insert into app.app_session (id, user_id, stage, secret_hash, purpose, created_at, expires_at,
                                  absolute_expires_at, recent_auth_at, auth_method)
     values ($1, $2, 'ativa', $3, 'password', now(), now() + interval '1 day',
             now() + interval '1 day', now(), 'password')`,
    [sessao, id, hex()],
  );
  const grant = randomUUID();
  await client.query(
    `insert into app.step_up_grant (id, user_id, purpose, token_hash, created_at, expires_at)
     values ($1, $2, 'dsr_open', $3, now(), now() + interval '15 minutes')`,
    [grant, id, hex()],
  );
  return { sessao, grant };
}

/** Caso (por padrao de eliminacao titular) em deferido; ate='aberto' para o caso ficar so aberto. */
async function caso(sujeito, { kind = 'eliminacao', canal = 'titular', operador = null, ate = 'deferido' } = {}) {
  const { rows } = await client.query(
    `insert into app.dsr_case (protocol, subject_user_id, kind, channel, opened_by_operator_id, deadline_at)
     values ($1, $2, $3, $4, $5, now() + interval '15 days') returning id`,
    [protocolo(), sujeito, kind, canal, operador],
  );
  const id = rows[0].id;
  if (ate !== 'aberto') {
    await client.query(`update app.dsr_case set status = 'em_analise' where id = $1`, [id]);
    await client.query(`update app.dsr_case set status = 'deferido' where id = $1`, [id]);
  }
  return id;
}

async function profissional(id) {
  await client.query(
    `insert into app.professional_profile (user_id, verification_status, verified_at, created_at, updated_at)
     values ($1, 'aprovada', now(), now(), now())`,
    [id],
  );
  await client.query(
    `update app.professional_profile
        set document_type = 'CPF', document_enc = $2::bytea, document_hmac = $3,
            public_name = $4, slug = $5
      where user_id = $1`,
    [id, Buffer.from(hex(), 'hex'), hex(), `Nome publico ${id.slice(0, 8)}`, `pro-${id.slice(0, 8)}`],
  );
}

/** Pedido publicado do cliente, com rascunho e ponto geocodificado (mesma forma do teste de extrato). */
async function pedido(cliente, descricao) {
  const grupo = randomUUID();
  const servico = randomUUID();
  await client.query('insert into app.service_group (id, name, position, active) values ($1, $2, 1, true)', [
    grupo,
    `Grupo teste ${grupo.slice(0, 6)}`,
  ]);
  await client.query(
    `insert into app.service (id, group_id, name, modality, regulated, active)
     values ($1, $2, $3, 'presencial', false, true)`,
    [servico, grupo, `Servico teste ${servico.slice(0, 6)}`],
  );
  const rascunho = randomUUID();
  await client.query(
    `insert into app.request_draft (id, browser_nonce_hash, service_id, address_text, urgency, description, status,
                                    expires_at, ip_hmac, created_at, updated_at, first_name, email, email_hmac,
                                    email_verified_at, confirmed_at)
     values ($1, $2, $3, 'Rua sintetica 1', 'imediato', 'Descricao sintetica', 'aberto',
             now() + interval '1 day', $4, now(), now(), 'Ana', $5, $6, now(), now())`,
    [rascunho, hex(), servico, hex(), `${randomUUID()}@example.test`, hex()],
  );
  const ponto = await client.query(
    `insert into app.geocode_point (subject_kind, subject_id, address_hash, state, exact_point, geocode_mode, precision, geocoded_at)
     values ('request', $1, $2, 'ok',
             extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography,
             'permanent', 'endereco', now())
     returning id`,
    [rascunho, hex()],
  );
  const { rows } = await client.query(
    `insert into app.service_request (customer_user_id, service_id, status, urgency, description, address_text,
                                      first_name, geocode_point_id, origin_draft_id, published_at, acceptance_deadline_at)
     values ($1, $2, 'publicado', 'imediato', $3, 'Rua sintetica 1', 'Ana', $4, $5, now(), now() + interval '168 hours')
     returning id`,
    [cliente, servico, descricao, ponto.rows[0].id, rascunho],
  );
  return rows[0].id;
}

/** Recusa: a chamada falha com o codigo esperado, e a conta e o caso ficam exatamente como estavam. */
async function recusa(montar, codigoEsperado, statusConta = 'em_eliminacao') {
  return tx(async () => {
    const { conta, caso: c } = await montar();
    const err = await erroDe(CHAMADA, [c]);
    assert.match(err.message, new RegExp(codigoEsperado));
    const st = (await client.query('select status, email from app.app_user where id = $1', [conta])).rows[0];
    assert.equal(st.status, statusConta, 'conta preservada');
    assert.doesNotMatch(st.email, /^anon-/, 'e-mail preservado');
    const cs = (await client.query('select status, outcome from app.dsr_case where id = $1', [c])).rows[0];
    assert.equal(cs.outcome, null, 'caso sem desfecho');
  });
}

test('T-DB-17 | cliente sem pedidos: conta anonimizada, sessoes encerradas, caso concluido e e-mail original livre', () =>
  tx(async () => {
    const original = `${randomUUID()}@example.test`;
    const id = await usuario('em_eliminacao', original);
    const { sessao, grant } = await sessaoEGrant(id);
    const c = await caso(id);

    const { rows } = await client.query(CHAMADA, [c]);
    assert.equal(rows[0].r, 'processado');

    const conta = (
      await client.query(
        'select email, email_hmac, status, retention_state, anonymized_at, email_verified_at from app.app_user where id = $1',
        [id],
      )
    ).rows[0];
    assert.match(conta.email, ANONIMO);
    assert.equal(conta.status, 'anonimizado');
    assert.equal(conta.retention_state, 'expurgado');
    assert.notEqual(conta.anonymized_at, null);
    assert.equal(conta.email_hmac, null);
    assert.equal(conta.email_verified_at, null);

    const s = (await client.query('select revoked_at from app.app_session where id = $1', [sessao])).rows[0];
    assert.notEqual(s.revoked_at, null, 'sessao revogada');
    const g = (await client.query('select consumed_at from app.step_up_grant where id = $1', [grant])).rows[0];
    assert.notEqual(g.consumed_at, null, 'grant consumido');

    const caso2 = (
      await client.query('select status, outcome, closed_at, legal_basis_note from app.dsr_case where id = $1', [c])
    ).rows[0];
    assert.equal(caso2.status, 'concluido');
    assert.equal(caso2.outcome, 'conta_anonimizada');
    assert.notEqual(caso2.closed_at, null);
    assert.match(caso2.legal_basis_note, /\S/);

    const eventos = (await client.query('select event from app.dsr_case_event where case_id = $1', [c])).rows.map(
      (r) => r.event,
    );
    assert.ok(eventos.includes('anonymized'), 'evento anonymized');
    assert.ok(eventos.includes('closed'), 'evento closed');

    // Decisao 679: o endereco original fica livre para novo cadastro.
    await client.query(
      `insert into app.app_user (id, email, auth_user_id, status, created_at) values ($1, $2, $3, 'ativo', now())`,
      [randomUUID(), original, randomUUID()],
    );
  }));

test('T-DB-19 | repetir a chamada num caso ja anonimizado e no-op e nao duplica eventos', () =>
  tx(async () => {
    const id = await usuario('em_eliminacao');
    const c = await caso(id);
    await client.query(CHAMADA, [c]);
    const { rows } = await client.query(CHAMADA, [c]);
    assert.equal(rows[0].r, 'ja_anonimizado');
    const n = await client.query(
      "select count(*)::int as n from app.dsr_case_event where case_id = $1 and event = 'closed'",
      [c],
    );
    assert.equal(n.rows[0].n, 1);
  }));

test('T-DB-17 | a anonimizacao de um titular nao toca a conta de outro titular', () =>
  tx(async () => {
    const outro = await usuario('em_eliminacao');
    const { sessao } = await sessaoEGrant(outro);
    const emailOutro = (await client.query('select email from app.app_user where id = $1', [outro])).rows[0].email;
    const id = await usuario('em_eliminacao');
    await client.query(CHAMADA, [await caso(id)]);
    const depois = (
      await client.query(
        `select u.email, u.status, s.revoked_at from app.app_user u
           join app.app_session s on s.user_id = u.id where u.id = $1 and s.id = $2`,
        [outro, sessao],
      )
    ).rows[0];
    assert.equal(depois.email, emailOutro);
    assert.equal(depois.status, 'em_eliminacao');
    assert.equal(depois.revoked_at, null);
  }));

test('T-DB-15 | caso ainda aberto (nao deferido) e recusado sem alterar nada', () =>
  recusa(async () => {
    const id = await usuario();
    return { conta: id, caso: await caso(id, { ate: 'aberto' }) };
  }, 'dsr_nao_deferido'));

test('T-DB-15 | direito de acesso nao e eliminacao: recusado', () =>
  recusa(async () => {
    const id = await usuario();
    return { conta: id, caso: await caso(id, { kind: 'acesso' }) };
  }, 'dsr_tipo_invalido'));

test('desenho §4.3 | eliminacao assistida (dpo_externo) exige aprovacao que ainda nao existe: recusada', () =>
  recusa(async () => {
    const id = await usuario();
    const op = await administrador();
    return { conta: id, caso: await caso(id, { canal: 'dpo_externo', operador: op }) };
  }, 'dsr_aprovacao_indisponivel'));

test('T-DB-16 | conta fora de em_eliminacao (ativa) e recusada', () =>
  recusa(
    async () => {
      const id = await usuario('ativo');
      return { conta: id, caso: await caso(id) };
    },
    'dsr_conta_fora_de_eliminacao',
    'ativo',
  ));

test('desenho §4.3 | titular profissional e recusado (passo profissional ainda nao existe)', () =>
  recusa(async () => {
    const id = await usuario();
    await profissional(id);
    return { conta: id, caso: await caso(id) };
  }, 'eliminacao_profissional_pendente'));

test('T-DB-16 | pedido publicado em andamento e recusado', () =>
  recusa(async () => {
    const id = await usuario();
    await pedido(id, 'Descricao sintetica em andamento');
    return { conta: id, caso: await caso(id) };
  }, 'pedido_em_andamento'));

test('desenho §4.3 | pedido ja encerrado ainda tem conteudo imutavel: recusado (pendencia registrada)', () =>
  recusa(async () => {
    const id = await usuario();
    const pid = await pedido(id, 'Descricao sintetica encerrada');
    await client.query(`update app.service_request set status = 'concluido' where id = $1`, [pid]);
    return { conta: id, caso: await caso(id) };
  }, 'pedido_conteudo_imutavel_pendente'));

test('T-DB-15 | bloqueio legal ativo sobre o titular e recusado', () =>
  recusa(async () => {
    const id = await usuario();
    const adm = await administrador();
    await client.query(
      `insert into app.legal_hold (id, subject_type, subject_id, reason_code, placed_by, placed_at)
       values ($1, 'user', $2, 'teste_h111', $3, now())`,
      [randomUUID(), id, adm],
    );
    return { conta: id, caso: await caso(id) };
  }, 'retencao_legal_ativa'));
