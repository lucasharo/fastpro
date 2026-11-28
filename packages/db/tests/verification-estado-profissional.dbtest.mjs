// Issue 54 (H-041) | Estado visivel e recurso do profissional no banco (docs/factory/141-DESENHO-H041.md §8).
// T41-01 (estados e precedencia), T41-02 (em analise neutro), T41-04 (recusa por duplicidade sem motivo),
// T41-06 (sem envio sem caso), T41-07 (recurso em recusada), T41-08 (recurso bloqueado nos casos retidos),
// T41-10 (leitura sem escrita e STABLE), T41-18 (privilegios: so app_system executa).
// Cada teste roda em transacao e termina com rollback. Dados sinteticos: marcador H041 e e-mails @example.test.
// Sem rede, sem Mapbox, sem envio. Rodar sozinho: node --test --test-concurrency=1 <este arquivo>
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { connect } from '../scripts/lib/env.mjs';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

const sha = (s) => createHash('sha256').update(s).digest('hex');
const agora = () => new Date().toISOString();
const SQL_STATE = 'select * from private.professional_verification_state($1)';
const SQL_APPEAL = 'select out_code from private.professional_verification_appeal($1, $2)';

/** Transacao de teste: tudo desfeito no fim. */
async function tx(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
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

/** Pessoa da Verificacao (decide e recebe a atribuicao do caso). */
async function staff() {
  const id = await usuario();
  await client.query(
    `insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at, created_at, status_changed_at)
     values ($1, 'ativo', 'bootstrap', null, now(), now(), now())`,
    [id],
  );
  await client.query(
    `insert into app.admin_user_role (id, user_id, role_code, granted_by, grant_origin, granted_at, approval_request_id)
     values (gen_random_uuid(), $1, 'verificacao', null, 'bootstrap', now(), null)`,
    [id],
  );
  return id;
}

/** Perfil profissional no status dado (insert direto: o gatilho de status so age em update). */
async function perfil(status = 'pendente') {
  const id = await usuario();
  await client.query(
    `insert into app.professional_profile
       (user_id, verification_status, public_name, slug, document_type, document_enc, document_hmac,
        suspended_at, suspension_reason, verified_at, created_at, updated_at)
     values ($1, $2, 'Sintetico H041', $3, 'CPF', $4, $5, $6::timestamptz, $7::text, $8::timestamptz, now(), now())`,
    [
      id,
      status,
      `h041-${randomUUID()}`,
      Buffer.from(`blob-${randomUUID()}`),
      sha(`H041-${randomUUID()}`),
      status === 'suspensa' ? agora() : null,
      status === 'suspensa' ? 'Sintetico H041' : null,
      status === 'aprovada' ? agora() : null,
    ],
  );
  return id;
}

/** Documento de identidade recebido sem passar pelo gatilho (insert direto: nao abre caso). */
async function documentoRecebido(profId) {
  await client.query(
    `insert into app.identity_document
       (id, professional_id, client_upload_id, declared_type, declared_bytes, status,
        stored_type, stored_bytes, content_sha256, pending_expires_at, received_at)
     values (gen_random_uuid(), $1, gen_random_uuid(), 'image/jpeg', 1000, 'recebido',
             'image/jpeg', 16, $2, now() + interval '30 minutes', now())`,
    [profId, Buffer.alloc(32, 7)],
  );
}

/** Caso de verificacao no estado dado, com as colunas exigidas pelas constraints da Issue 52. */
async function caso(profId, { status, reason = null, explicacao = null, appeal = 'nenhum', decidedBy = null,
  assignedTo = null, decidedAt = null }) {
  await client.query(
    `insert into app.verification_case
       (id, professional_id, status, assigned_to, assigned_at, reason_code, explanation_to_professional,
        appeal_status, decided_by, decided_at, sla_target_at, version, created_at, updated_at)
     values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, now() + interval '2 days', 1, now(), now())`,
    [profId, status, assignedTo, assignedTo ? agora() : null, reason, explicacao, appeal, decidedBy, decidedAt],
  );
}

async function estado(profId) {
  const { rows } = await client.query(SQL_STATE, [profId]);
  return rows;
}

async function contaCasos(profId) {
  const { rows } = await client.query('select count(*)::int as n from app.verification_case where professional_id = $1', [profId]);
  return rows[0].n;
}

async function contaEventosRecurso(profId) {
  const { rows } = await client.query(
    `select count(*)::int as n from app.verification_case_event e
       join app.verification_case c on c.id = e.case_id
      where c.professional_id = $1 and e.action = 'appeal_received'`, [profId]);
  return rows[0].n;
}

test('T41-01 | sete fixtures e precedencia: um estado publico por caso', () => tx(async () => {
  const semEnvio = await perfil('pendente');
  assert.deepEqual((await estado(semEnvio)).map((r) => r.out_state), ['sem_envio']);

  const pendente = await perfil('pendente');
  await documentoRecebido(pendente);
  await caso(pendente, { status: 'pendente' });
  const rowPendente = (await estado(pendente))[0];
  assert.equal(rowPendente.out_state, 'em_analise');
  assert.equal(rowPendente.out_appeal, 'indisponivel');

  const revisao = await perfil('em_revisao');
  await documentoRecebido(revisao);
  await caso(revisao, { status: 'em_revisao', assignedTo: await staff() });
  assert.equal((await estado(revisao))[0].out_state, 'em_analise');

  const retida = await perfil('retida_duplicidade');
  await documentoRecebido(retida);
  await caso(retida, { status: 'retida_duplicidade', reason: 'duplicidade_suspeita', decidedBy: await staff(), decidedAt: agora() });
  assert.equal((await estado(retida))[0].out_state, 'em_analise');

  const aprovada = await perfil('aprovada');
  await documentoRecebido(aprovada);
  const decisao = agora();
  await caso(aprovada, { status: 'aprovada', reason: 'aprovado', decidedBy: await staff(), decidedAt: decisao });
  const rowAprovada = (await estado(aprovada))[0];
  assert.equal(rowAprovada.out_state, 'aprovada');
  assert.ok(rowAprovada.out_decided_at, 'data da aprovacao');
  assert.equal(rowAprovada.out_appeal, 'indisponivel');

  const recusada = await perfil('recusada');
  await documentoRecebido(recusada);
  await caso(recusada, { status: 'recusada', reason: 'documento_ilegivel', decidedBy: await staff(), decidedAt: agora() });
  assert.equal((await estado(recusada))[0].out_state, 'recusada');

  const suspensa = await perfil('suspensa');
  assert.equal((await estado(suspensa))[0].out_state, 'suspensa');
}));

test('T41-01 | precedencia: perfil suspenso vence caso aprovado; caso pendente vence perfil retido', () => tx(async () => {
  const suspensoComCaso = await perfil('suspensa');
  await documentoRecebido(suspensoComCaso);
  await caso(suspensoComCaso, { status: 'aprovada', reason: 'aprovado', decidedBy: await staff(), decidedAt: agora() });
  const r1 = (await estado(suspensoComCaso))[0];
  assert.equal(r1.out_state, 'suspensa');
  assert.equal(r1.out_appeal, 'indisponivel');
  assert.equal(r1.out_decided_at, null);

  const retidoComCasoPendente = await perfil('retida_duplicidade');
  await documentoRecebido(retidoComCasoPendente);
  await caso(retidoComCasoPendente, { status: 'pendente' });
  assert.equal((await estado(retidoComCasoPendente))[0].out_state, 'em_analise');
}));

test('T41-01 | perfil inexistente devolve zero linhas; nulo e entrada invalida', () => tx(async () => {
  assert.deepEqual(await estado(randomUUID()), []);
  await assert.rejects(() => client.query(SQL_STATE, [null]), (err) => err.code === '22023');
}));

test('T41-02 | pendente, em_revisao e retido devolvem a mesma linha; retido sem documento e igual a pendente sem documento', () => tx(async () => {
  const pend = await perfil('pendente');
  await documentoRecebido(pend);
  await caso(pend, { status: 'pendente' });

  const rev = await perfil('em_revisao');
  await documentoRecebido(rev);
  await caso(rev, { status: 'em_revisao', assignedTo: await staff() });

  const ret = await perfil('retida_duplicidade');
  await documentoRecebido(ret);
  await caso(ret, { status: 'retida_duplicidade', reason: 'duplicidade_suspeita', decidedBy: await staff(), decidedAt: agora() });

  const a = await estado(pend);
  assert.deepEqual(await estado(rev), a);
  assert.deepEqual(await estado(ret), a);

  const semDocPendente = await perfil('pendente');
  const semDocRetido = await perfil('retida_duplicidade');
  assert.deepEqual(await estado(semDocRetido), await estado(semDocPendente));
}));

test('T41-04 | recusa por duplicidade_suspeita: sem motivo e sem explicacao; recusa comum so difere nesses campos', () => tx(async () => {
  const staffId = await staff();
  const dup = await perfil('recusada');
  await documentoRecebido(dup);
  await caso(dup, { status: 'recusada', reason: 'duplicidade_suspeita', explicacao: null, decidedBy: staffId, decidedAt: agora() });
  const comum = await perfil('recusada');
  await documentoRecebido(comum);
  await caso(comum, { status: 'recusada', reason: 'documento_ilegivel', decidedBy: staffId, decidedAt: agora() });

  const rDup = (await estado(dup))[0];
  const rComum = (await estado(comum))[0];
  assert.equal(rDup.out_state, 'recusada');
  assert.equal(rDup.out_reason_code, null);
  assert.equal(rDup.out_explanation, null);
  assert.equal(rComum.out_reason_code, 'documento_ilegivel');
  assert.deepEqual(Object.keys(rDup), Object.keys(rComum));
  assert.equal(rDup.out_appeal, rComum.out_appeal);
}));

test('T41-06 | sem documento recebido nao ha caso, e a leitura nao cria caso', () => tx(async () => {
  const semEnvio = await perfil('pendente');
  assert.equal((await estado(semEnvio))[0].out_state, 'sem_envio');
  assert.equal(await contaCasos(semEnvio), 0);

  const comDoc = await perfil('pendente');
  await documentoRecebido(comDoc);
  assert.equal((await estado(comDoc))[0].out_state, 'em_analise');
  assert.equal(await contaCasos(comDoc), 0, 'a leitura nao cria caso');
}));

test('T41-07 | recusada sem recurso: primeiro pedido vira em_revisao com recurso pendente; o segundo nao passa', () => tx(async () => {
  const prof = await perfil('recusada');
  await documentoRecebido(prof);
  await caso(prof, { status: 'recusada', reason: 'documento_ilegivel', explicacao: 'Foto cortada.',
    decidedBy: await staff(), decidedAt: agora() });

  assert.equal((await estado(prof))[0].out_appeal, 'disponivel');
  const { rows } = await client.query(SQL_APPEAL, [prof, agora()]);
  assert.equal(rows[0].out_code, 'ok');

  const c = (await client.query(
    'select status, appeal_status, assigned_to from app.verification_case where professional_id = $1', [prof])).rows[0];
  assert.equal(c.status, 'em_revisao');
  assert.equal(c.appeal_status, 'pendente');
  assert.equal(c.assigned_to, null);
  assert.equal(await contaEventosRecurso(prof), 1);

  const depois = (await estado(prof))[0];
  assert.equal(depois.out_state, 'em_analise');
  assert.equal(depois.out_appeal, 'recebido');

  const segundo = await client.query(SQL_APPEAL, [prof, agora()]);
  assert.notEqual(segundo.rows[0].out_code, 'ok');
  assert.equal(await contaEventosRecurso(prof), 1, 'um unico evento de recurso');
}));

test('T41-08 | casos retidos e perfil suspenso nao recorrem; sem caso devolve sem_caso; sem efeito', () => tx(async () => {
  const pend = await perfil('pendente');
  await documentoRecebido(pend);
  await caso(pend, { status: 'pendente' });
  const ret = await perfil('retida_duplicidade');
  await documentoRecebido(ret);
  await caso(ret, { status: 'retida_duplicidade', reason: 'duplicidade_suspeita', decidedBy: await staff(), decidedAt: agora() });
  const susp = await perfil('suspensa');
  await documentoRecebido(susp);
  await caso(susp, { status: 'recusada', reason: 'documento_ilegivel', explicacao: 'x',
    decidedBy: await staff(), decidedAt: agora() });
  const semCaso = await perfil('pendente');

  for (const [prof, esperado] of [[pend, 'nao_elegivel'], [ret, 'nao_elegivel'], [susp, 'nao_elegivel'], [semCaso, 'sem_caso']]) {
    const antes = await estado(prof);
    const { rows } = await client.query(SQL_APPEAL, [prof, agora()]);
    assert.equal(rows[0].out_code, esperado);
    assert.equal(await contaEventosRecurso(prof), 0);
    assert.deepEqual(await estado(prof), antes, 'estado inalterado');
  }
}));

test('T41-10 | leitura nao escreve: contagens de caso, evento, perfil e auditoria iguais; funcao STABLE', () => tx(async () => {
  const prof = await perfil('recusada');
  await documentoRecebido(prof);
  await caso(prof, { status: 'recusada', reason: 'documento_ilegivel', decidedBy: await staff(), decidedAt: agora() });
  const contar = async () => (await client.query(`select
      (select count(*)::int from app.verification_case) as casos,
      (select count(*)::int from app.verification_case_event) as eventos,
      (select count(*)::int from app.professional_profile) as perfis,
      (select count(*)::int from audit.audit_event) as auditoria`)).rows[0];
  const antes = await contar();
  for (let i = 0; i < 3; i += 1) await estado(prof);
  assert.deepEqual(await contar(), antes);
  const { rows } = await client.query(
    `select provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'professional_verification_state'`);
  assert.equal(rows[0].provolatile, 's');
}));

test('T41-18 | privilegios: so app_system executa as duas funcoes; app_api e papeis publicos nao', () => tx(async () => {
  const { rows } = await client.query(
    `select p.proname,
            has_function_privilege('app_system', p.oid, 'EXECUTE') as sistema,
            has_function_privilege('app_api', p.oid, 'EXECUTE') as api,
            has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') as autenticado,
            p.prosecdef as definer
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname in ('professional_verification_state', 'professional_verification_appeal')`);
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.equal(r.sistema, true, `${r.proname}: app_system`);
    assert.equal(r.api, false, `${r.proname}: app_api`);
    assert.equal(r.anon, false, `${r.proname}: anon`);
    assert.equal(r.autenticado, false, `${r.proname}: authenticated`);
    assert.equal(r.definer, true, `${r.proname}: security definer`);
  }
}));
