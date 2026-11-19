// Issue 120 (H-111) | Funcoes do titular no banco (147-DESENHO-H111 §4.1, §7: T-DB-03, T-DB-04, T-DB-10, T-DB-11,
// T-DB-13, T-DB-14, T-DB-15, T-DB-16, T-DB-29, T-DB-30 e regras de conta e limite). Banco de desenvolvimento.
// Cada teste roda em transacao e e desfeito (rollback). Valores sinteticos (@example.test). Sem rede, sem e-mail real.
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

const sha = (s) => createHash('sha256').update(s).digest('hex');
const hex = () => randomBytes(32).toString('hex');
const chave = () => `idem-${randomUUID()}`;
const PROTOCOLO = /^DSR-\d{8}-[A-Z2-7]{6}$/;

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

/** Grant de step-up. criadoMin: minutos atras da criacao; validadeMin: validade a partir da criacao. */
async function grant(sujeito, { criadoMin = 0, validadeMin = 15, consumido = false, token = randomUUID() } = {}) {
  await client.query(
    `insert into app.step_up_grant (user_id, purpose, token_hash, created_at, expires_at, consumed_at)
     values ($1, 'dsr_open', $2, now() - make_interval(mins => $3::int),
             now() - make_interval(mins => $3::int) + make_interval(mins => $4::int),
             case when $5::boolean then now() - make_interval(mins => $3::int) else null end)`,
    [sujeito, sha(token), criadoMin, validadeMin, consumido],
  );
  return { token, hash: sha(token) };
}

const ABRIR = 'select * from app.dsr_open($1::uuid, $2, $3::jsonb, $4, $5)';
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Protocolo sintetico no formato do desenho (fixture; o protocolo real e gerado pela funcao). */
function protocolo() {
  let sufixo = '';
  for (let i = 0; i < 6; i += 1) sufixo += B32[randomBytes(1)[0] % 32];
  return `DSR-20261119-${sufixo}`;
}

async function abrir(sujeito, kind, { hash = null, key = chave(), details = {} } = {}) {
  const { rows } = await client.query(ABRIR, [sujeito, kind, JSON.stringify(details), hash, key]);
  return rows[0];
}

async function contar(sql, params) {
  const { rows } = await client.query(sql, params);
  return Number(rows[0].n);
}

async function statusConta(id) {
  const { rows } = await client.query('select status from app.app_user where id = $1', [id]);
  return rows[0].status;
}

/** Caso ativo de acesso (aberto -> em_analise -> deferido -> concluido) com extrato gravado. */
async function casoConcluidoComExtrato(sujeito, { geradoDias = 1, expiraEm = '6 days' } = {}) {
  const { rows } = await client.query(
    `insert into app.dsr_case (protocol, subject_user_id, kind, deadline_at)
     values ($1, $2, 'acesso', now() + interval '15 days') returning id`,
    [protocolo(), sujeito],
  );
  const caso = rows[0].id;
  await client.query(`update app.dsr_case set status = 'em_analise' where id = $1`, [caso]);
  await client.query(`update app.dsr_case set status = 'deferido' where id = $1`, [caso]);
  await client.query(
    `update app.dsr_case set status = 'concluido', outcome = 'extrato_disponibilizado', closed_at = now()
      where id = $1`,
    [caso],
  );
  // geradoDias: dias atras da geracao; expiraEm: intervalo a partir de agora (negativo = ja expirado).
  await client.query(
    `insert into app.dsr_export (case_id, storage_path, sha256, signature, schema_version, size_bytes,
                                 generated_at, expires_at)
     values ($1, $2, $3, $4, 1, 2048, now() - make_interval(days => $5::int), now() + $6::interval)`,
    [caso, `${randomUUID()}.json`, hex(), hex(), geradoDias, expiraEm],
  );
  return caso;
}

test('T-DB-10 | prazo de deadline_at vem de ops.app_config (15 dias; depois 3 dias)', async () => {
  await tx(async () => {
    const u1 = await usuario();
    const r1 = await abrir(u1, 'correcao');
    const { rows } = await client.query(
      `select (deadline_at - opened_at) = interval '15 days' as ok from app.dsr_case where id = $1`,
      [r1.out_case_id],
    );
    assert.equal(rows[0].ok, true);

    await client.query(`update ops.app_config set value = '3'::jsonb where key = 'privacy.dsr_deadline_days'`);
    const u2 = await usuario();
    const r2 = await abrir(u2, 'correcao');
    const { rows: r } = await client.query(
      `select (deadline_at - opened_at) = interval '3 days' as ok from app.dsr_case where id = $1`,
      [r2.out_case_id],
    );
    assert.equal(r[0].ok, true);
  });
});

test('T-DB-11 | acesso e eliminacao sem step-up valido falham: sem token, expirado, de outro titular ou ja consumido', async () => {
  await tx(async () => {
    const u = await usuario();
    const outro = await usuario();
    const deOutro = await grant(outro);
    const expirado = await grant(u, { criadoMin: 60, validadeMin: 15 });
    const consumido = await grant(u, { consumido: true });
    for (const hash of [null, deOutro.hash, expirado.hash, consumido.hash]) {
      const err = await erroDe(ABRIR, [u, 'acesso', '{}', hash, chave()]);
      assert.match(err.message, /step_up_obrigatorio/);
    }
    const err2 = await erroDe(ABRIR, [u, 'eliminacao', '{}', null, chave()]);
    assert.match(err2.message, /step_up_obrigatorio/);
    assert.equal(await contar('select count(*)::int as n from app.dsr_case where subject_user_id = $1', [u]), 0);
  });
});

test('T-DB-11 | grant de outro titular nao e consumido pela tentativa recusada', async () => {
  await tx(async () => {
    const u = await usuario();
    const outro = await usuario();
    const g = await grant(outro);
    await erroDe(ABRIR, [u, 'acesso', '{}', g.hash, chave()]);
    assert.equal(
      await contar('select count(*)::int as n from app.step_up_grant where token_hash = $1 and consumed_at is null', [g.hash]),
      1,
    );
  });
});

test('CA-03 / T-API-01 | acesso com step-up valido: caso aberto, grant consumido, linha do tempo, auditoria e e-mail', async () => {
  await tx(async () => {
    const u = await usuario();
    const g = await grant(u);
    const r = await abrir(u, 'acesso', { hash: g.hash });
    assert.equal(r.out_status, 'aberto');
    assert.equal(r.out_deduplicated, false);
    assert.match(r.out_protocol, PROTOCOLO);
    assert.equal(
      await contar('select count(*)::int as n from app.step_up_grant where token_hash = $1 and consumed_at is not null', [g.hash]),
      1,
    );
    assert.equal(
      await contar(`select count(*)::int as n from app.dsr_case_event where case_id = $1 and event = 'opened'`, [r.out_case_id]),
      1,
    );
    assert.equal(
      await contar(
        `select count(*)::int as n from audit.audit_event where object_id = $1 and action = 'dsr.case_opened'`,
        [r.out_case_id],
      ),
      1,
    );
    assert.equal(
      await contar(
        `select count(*)::int as n from ops.email_outbox
          where dedupe_key = $1 and recipient_user_id = $2 and state = 'pendente' and category = 'acesso'`,
        [`dsr:${r.out_case_id}:dsr_abertura`, u],
      ),
      1,
    );
  });
});

test('T-DB-13 | idempotencia: mesma chave devolve o mesmo caso, sem novo evento, e-mail ou consumo de grant', async () => {
  await tx(async () => {
    const u = await usuario();
    const g = await grant(u);
    const k = chave();
    const r1 = await abrir(u, 'acesso', { hash: g.hash, key: k });
    const r2 = await abrir(u, 'acesso', { hash: null, key: k });
    assert.equal(r2.out_case_id, r1.out_case_id);
    assert.equal(r2.out_deduplicated, true);
    assert.equal(
      await contar(`select count(*)::int as n from app.dsr_case_event where case_id = $1`, [r1.out_case_id]),
      1,
    );
    assert.equal(
      await contar(`select count(*)::int as n from ops.email_outbox where recipient_user_id = $1`, [u]),
      1,
    );
    const err = await erroDe(ABRIR, [u, 'correcao', '{}', null, k]);
    assert.match(err.message, /idempotencia_conflito/);
  });
});

test('T-DB-04 | segundo caso ativo do mesmo tipo: dsr_em_andamento com o protocolo do caso existente', async () => {
  await tx(async () => {
    const u = await usuario();
    const g1 = await grant(u);
    const g2 = await grant(u);
    const r1 = await abrir(u, 'acesso', { hash: g1.hash });
    const err = await erroDe(ABRIR, [u, 'acesso', '{}', g2.hash, chave()]);
    assert.match(err.message, /dsr_em_andamento/);
    assert.equal(err.detail, r1.out_protocol);
  });
});

test('T-DB-30 | eliminacao suspende a conta; outro titular nao cancela; o dono cancela e a conta volta a ativo', async () => {
  await tx(async () => {
    const u = await usuario();
    const outro = await usuario();
    const g = await grant(u);
    const r = await abrir(u, 'eliminacao', { hash: g.hash });
    assert.equal(r.out_status, 'aberto');
    assert.equal(await statusConta(u), 'em_eliminacao');

    const errOutro = await erroDe('select * from app.dsr_cancel($1::uuid, $2::uuid)', [r.out_case_id, outro]);
    assert.match(errOutro.message, /dsr_nao_encontrado/);

    const c = await client.query('select * from app.dsr_cancel($1::uuid, $2::uuid)', [r.out_case_id, u]);
    assert.equal(c.rows[0].out_status, 'cancelado');
    assert.equal(await statusConta(u), 'ativo');
    const { rows } = await client.query('select status, outcome from app.dsr_case where id = $1', [r.out_case_id]);
    assert.deepEqual(rows[0], { status: 'cancelado', outcome: 'cancelado_pelo_titular' });

    const errDepois = await erroDe('select * from app.dsr_cancel($1::uuid, $2::uuid)', [r.out_case_id, u]);
    assert.match(errDepois.message, /dsr_nao_cancelavel/);
  });
});

test('T-DB-15 | eliminacao com retencao legal: caso indeferido_total, conta inalterada, sem novo caso ativo', async () => {
  await tx(async () => {
    const u = await usuario();
    const administrador = await usuario();
    await client.query(
      `insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at, created_at, status_changed_at)
       values ($1, 'ativo', 'bootstrap', null, now(), now(), now())`,
      [administrador],
    );
    await client.query(
      `insert into app.legal_hold (id, subject_type, subject_id, reason_code, placed_by, placed_at)
       values ($1, 'user', $2, 'teste_h111', $3, now())`,
      [randomUUID(), u, administrador],
    );
    const g = await grant(u);
    const r = await abrir(u, 'eliminacao', { hash: g.hash });
    assert.equal(r.out_status, 'indeferido_total');
    assert.equal(await statusConta(u), 'ativo');
    const { rows } = await client.query('select outcome, closed_at, legal_basis_note from app.dsr_case where id = $1', [
      r.out_case_id,
    ]);
    assert.equal(rows[0].outcome, 'recusado_impedimento_legal');
    assert.notEqual(rows[0].closed_at, null);
    assert.match(rows[0].legal_basis_note, /Retencao legal/);
    assert.equal(
      await contar(
        `select count(*)::int as n from ops.email_outbox where dedupe_key = $1`,
        [`dsr:${r.out_case_id}:dsr_indeferimento`],
      ),
      1,
    );
  });
});

test('T-DB-16 | eliminacao com pedido em andamento: recusada, sem caso e sem mudar a conta', async () => {
  await tx(async () => {
    const u = await usuario();
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
    // Pedido publicado exige rascunho confirmado e ponto geocodificado vinculado a ele (regra do pedido).
    const rascunho = randomUUID();
    const email = `${randomUUID()}@example.test`;
    await client.query(
      `insert into app.request_draft (id, browser_nonce_hash, service_id, address_text, urgency, description, status,
                                      expires_at, ip_hmac, created_at, updated_at, first_name, email, email_hmac,
                                      email_verified_at, confirmed_at)
       values ($1, $2, $3, 'Rua sintetica 1', 'imediato', 'Descricao sintetica', 'aberto',
               now() + interval '1 day', $4, now(), now(), 'Ana', $5, $6, now(), now())`,
      [rascunho, sha(`cookie-${rascunho}`), servico, sha('ip-sintetico'), email, sha(email)],
    );
    const ponto = await client.query(
      `insert into app.geocode_point (subject_kind, subject_id, address_hash, state, exact_point, geocode_mode, precision, geocoded_at)
       values ('request', $1, $2, 'ok',
               extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography,
               'permanent', 'endereco', now())
       returning id`,
      [rascunho, sha(`end-${randomUUID()}`)],
    );
    await client.query(
      `insert into app.service_request (customer_user_id, service_id, status, urgency, description, address_text,
                                        first_name, geocode_point_id, origin_draft_id, published_at, acceptance_deadline_at)
       values ($1, $2, 'publicado', 'imediato', 'Descricao sintetica', 'Rua sintetica 1', 'Ana', $3, $4, now(),
               now() + interval '168 hours')`,
      [u, servico, ponto.rows[0].id, rascunho],
    );
    const g = await grant(u);
    const err = await erroDe(ABRIR, [u, 'eliminacao', '{}', g.hash, chave()]);
    assert.match(err.message, /pedido_em_andamento/);
    assert.equal(await statusConta(u), 'ativo');
    assert.equal(await contar('select count(*)::int as n from app.dsr_case where subject_user_id = $1', [u]), 0);
  });
});

test('conta fora de ativo: correcao recusada com em_eliminacao; acesso continua permitido', async () => {
  await tx(async () => {
    const u = await usuario();
    await client.query(`update app.app_user set status = 'em_eliminacao' where id = $1`, [u]);
    const err = await erroDe(ABRIR, [u, 'correcao', '{}', null, chave()]);
    assert.match(err.message, /conta_nao_ativa/);
    const g = await grant(u);
    const r = await abrir(u, 'acesso', { hash: g.hash });
    assert.equal(r.out_status, 'aberto');
  });
});

test('limite diario: sexta abertura em 24 h e recusada com dsr_limite_diario', async () => {
  await tx(async () => {
    const u = await usuario();
    for (let i = 0; i < 5; i += 1) {
      const { rows } = await client.query(
        `insert into app.dsr_case (protocol, subject_user_id, kind, deadline_at)
         values ($1, $2, 'correcao', now() + interval '15 days') returning id`,
        [protocolo(), u],
      );
      await client.query(
        `update app.dsr_case set status = 'cancelado', outcome = 'cancelado_pelo_titular', closed_at = now()
          where id = $1`,
        [rows[0].id],
      );
    }
    const err = await erroDe(ABRIR, [u, 'correcao', '{}', null, chave()]);
    assert.match(err.message, /dsr_limite_diario/);
  });
});

test('T-DB-14 | acesso: extrato vigente devolve o caso (deduplicado); extrato expirado dentro de 30 dias recusa com carencia', async () => {
  await tx(async () => {
    const u = await usuario();
    const caso = await casoConcluidoComExtrato(u, { geradoDias: 1, expiraEm: '6 days' });
    const g = await grant(u);
    const r = await abrir(u, 'acesso', { hash: g.hash });
    assert.equal(r.out_case_id, caso);
    assert.equal(r.out_deduplicated, true);
    assert.equal(r.out_status, 'concluido');
    assert.equal(
      await contar('select count(*)::int as n from app.dsr_case where subject_user_id = $1', [u]),
      1,
    );
  });

  await tx(async () => {
    const u = await usuario();
    await casoConcluidoComExtrato(u, { geradoDias: 2, expiraEm: '-1 hour' });
    const g = await grant(u);
    const err = await erroDe(ABRIR, [u, 'acesso', '{}', g.hash, chave()]);
    assert.match(err.message, /dsr_carencia/);
    assert.match(err.detail, /^\d{4}-\d{2}-\d{2}/);
    assert.equal(
      await contar('select count(*)::int as n from app.step_up_grant where token_hash = $1 and consumed_at is null', [g.hash]),
      1,
    );
  });
});

test('T-DB-13 | tipos fora do escopo (bloqueio, confirmacao) e chave curta sao recusados', async () => {
  await tx(async () => {
    const u = await usuario();
    for (const kind of ['bloqueio', 'confirmacao']) {
      const err = await erroDe(ABRIR, [u, kind, '{}', null, chave()]);
      assert.match(err.message, /kind_nao_suportado/);
    }
    const err2 = await erroDe(ABRIR, [u, 'correcao', '{}', null, 'curta']);
    assert.match(err2.message, /idempotencia_invalida/);
  });
});

test('listagem e consulta do proprio titular: outro titular nao ve o caso; linha do tempo sem ator', async () => {
  await tx(async () => {
    const u = await usuario();
    const outro = await usuario();
    const g = await grant(u);
    const r = await abrir(u, 'acesso', { hash: g.hash });

    const lista = await client.query('select * from app.dsr_list_own($1::uuid, 10, null, null)', [u]);
    assert.equal(lista.rows.length, 1);
    assert.equal(lista.rows[0].out_protocol, r.out_protocol);
    const listaOutro = await client.query('select * from app.dsr_list_own($1::uuid, 10, null, null)', [outro]);
    assert.equal(listaOutro.rows.length, 0);

    const consulta = await client.query('select * from app.dsr_get_own($1::uuid, $2::uuid)', [u, r.out_case_id]);
    assert.equal(consulta.rows.length, 1);
    assert.ok(Array.isArray(consulta.rows[0].out_timeline));
    assert.equal(consulta.rows[0].out_timeline.length, 1);
    assert.equal(JSON.stringify(consulta.rows[0].out_timeline).includes('actor'), false);

    const alheio = await client.query('select * from app.dsr_get_own($1::uuid, $2::uuid)', [outro, r.out_case_id]);
    assert.equal(alheio.rows.length, 0);
    const inexistente = await client.query('select * from app.dsr_get_own($1::uuid, $2::uuid)', [u, randomUUID()]);
    assert.equal(inexistente.rows.length, 0);

    const errCursor = await erroDe('select * from app.dsr_list_own($1::uuid, 10, now(), null)', [u]);
    assert.match(errCursor.message, /cursor_invalido/);
  });
});

test('T-DB-03 | so app_system executa as funcoes do titular; anon, authenticated e app_api nao', async () => {
  const assinaturas = [
    'app.dsr_open(uuid, text, jsonb, text, text)',
    'app.dsr_cancel(uuid, uuid)',
    'app.dsr_list_own(uuid, integer, timestamptz, uuid)',
    'app.dsr_get_own(uuid, uuid)',
  ];
  for (const assinatura of assinaturas) {
    const { rows } = await client.query(
      `select has_function_privilege('app_system', $1, 'EXECUTE') as sistema,
              has_function_privilege('anon', $1, 'EXECUTE') as anon,
              has_function_privilege('authenticated', $1, 'EXECUTE') as autenticado,
              has_function_privilege('app_api', $1, 'EXECUTE') as api`,
      [assinatura],
    );
    assert.equal(rows[0].sistema, true, `app_system em ${assinatura}`);
    assert.equal(rows[0].anon, false, `anon em ${assinatura}`);
    assert.equal(rows[0].autenticado, false, `authenticated em ${assinatura}`);
    assert.equal(rows[0].api, false, `app_api em ${assinatura}`);
  }
});
