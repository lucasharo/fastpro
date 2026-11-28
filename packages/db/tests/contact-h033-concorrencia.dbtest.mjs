// Issue 46 (H-033) | T-22 de concorrencia do telefone (docs/factory/129-DESENHO-H033.md, §8). Arquivo separado de
// contact-h033.dbtest.mjs porque exige conexoes reais com commit (cada conexao e sua propria transacao implicita).
// Dados COMMITADOS, sinteticos e marcados com h033c-: pedidos com prazo vencido (fora da visibilidade dos profissionais).
// Nada e apagado: consentimento e registro de revelacao sao imutaveis por desenho (CA-09, CA-13).
// Nenhuma funcao do banco e alterada. A guarda de aceite segue fechada ate a E6, entao a parte de revelacao prova apenas
// que nenhuma revelacao sai durante a revogacao concorrente; a prova com aceite ativo fica com a E6.
// Executar: node --test --test-concurrency=1 packages/db/tests/contact-h033-concorrencia.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';
import { concederAcessoVigente } from './fixtures/professional-access.mjs';

const N = 20;
const MARCA = `h033c-${randomUUID().slice(0, 8)}`;
const sha = (s) => createHash('sha256').update(s).digest('hex');
const blob = () => Buffer.concat([Buffer.from([1]), randomBytes(43)]);
const agora = () => new Date().toISOString();
const contar = (lista) => lista.reduce((m, s) => ({ ...m, [s]: (m[s] ?? 0) + 1 }), {});

let admin;
let conexoes = [];
let servicoId;

before(async () => {
  admin = await connect();
  const s = await admin.query('select id from app.service where active order by name limit 1');
  assert.equal(s.rows.length, 1, 'precisa de um servico ativo no catalogo de desenvolvimento (so leitura)');
  servicoId = s.rows[0].id;
  conexoes = await Promise.all(Array.from({ length: N }, () => connect()));
});

after(async () => {
  await Promise.all(conexoes.map((c) => c.end()));
  await admin.end();
});

async function usuario() {
  const id = randomUUID();
  await admin.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, 'ativo', now(), now())`,
    [id, `${MARCA}-${id.slice(0, 8)}@example.test`, randomUUID()],
  );
  return id;
}

async function profissional() {
  const id = await usuario();
  await admin.query(
    `insert into app.professional_profile (user_id, verification_status, verified_at, created_at, updated_at)
     values ($1, 'aprovada', now(), now(), now())`,
    [id],
  );
  await concederAcessoVigente(admin, id, new Date());
  return id;
}

/** Pedido publicado com prazo vencido ha 2 dias (aceite encerrado), dono informado. Retorna o id. */
async function pedidoVencido(cliente) {
  const draft = randomUUID();
  const email = `${MARCA}-rascunho-${draft.slice(0, 8)}@example.test`;
  await admin.query(
    `insert into app.request_draft (id, browser_nonce_hash, service_id, address_text, urgency, description, status,
                                    expires_at, ip_hmac, created_at, updated_at, first_name, email, email_hmac,
                                    email_verified_at, confirmed_at)
     values ($1, $2, $3, 'Rua sintetica 1', 'imediato', 'Descricao sintetica', 'aberto',
             now() + interval '5 days', $4, now() - interval '9 days', now() - interval '9 days', 'Ana', $5, $6,
             now() - interval '9 days', now() - interval '9 days')`,
    [draft, sha(`cookie-${draft}`), servicoId, sha('ip-sintetico'), email, sha(email)],
  );
  const g = await admin.query(
    `insert into app.geocode_point (subject_kind, subject_id, address_hash, state, exact_point, geocode_mode, precision, geocoded_at)
     values ('request', $1, $2, 'ok',
             extensions.st_setsrid(extensions.st_makepoint(-46.6333, -23.5505), 4326)::extensions.geography,
             'permanent', 'endereco', now() - interval '9 days')
     returning id`,
    [draft, sha(`end-${draft}`)],
  );
  const r = await admin.query(
    `insert into app.service_request (customer_user_id, service_id, status, urgency, description, address_text, first_name,
                                      geocode_point_id, origin_draft_id, published_at, acceptance_deadline_at)
     values ($1, $2, 'publicado', 'imediato', 'Descricao sintetica', 'Rua sintetica 1', 'Ana', $3, $4,
             now() - interval '9 days', now() - interval '2 days')
     returning id`,
    [cliente, servicoId, g.rows[0].id, draft],
  );
  return r.rows[0].id;
}

test('T-22a | 20 conexoes registram o mesmo telefone: um consentimento_ativo, as demais ja_definido, uma linha de consentimento', async () => {
  const cliente = await usuario();
  const p = await pedidoVencido(cliente);
  const chave = blob();
  const estados = await Promise.all(
    conexoes.map((c) =>
      c
        .query('select out_state from private.request_phone_attach($1, $2, $3, true, $4, $5)', [cliente, p, chave, 'v1', agora()])
        .then((r) => r.rows[0].out_state),
    ),
  );
  assert.deepEqual(contar(estados), { consentimento_ativo: 1, ja_definido: N - 1 });
  const linhas = await admin.query('select count(*)::int as n from app.contact_consent where request_id = $1', [p]);
  assert.equal(linhas.rows[0].n, 1);
});

test('T-22b | revogacao e revelacao simultaneas (10 de cada): a revogacao vale uma vez; nenhuma revelacao sai (guarda fechada ate a E6)', async () => {
  const cliente = await usuario();
  const prof = await profissional();
  const p = await pedidoVencido(cliente);
  await admin.query('select out_state from private.request_phone_attach($1, $2, $3, true, $4, $5)', [
    cliente, p, blob(), 'v1', agora(),
  ]);
  const tarefas = [];
  for (let i = 0; i < 10; i++) {
    tarefas.push(
      conexoes[i]
        .query('select out_revoked from private.contact_consent_revoke($1, $2, null, $3)', [cliente, p, agora()])
        .then((r) => ({ tipo: 'revoga', n: r.rows[0].out_revoked })),
    );
    tarefas.push(
      conexoes[10 + i]
        .query('select * from private.contact_reveal_phone($1, $2, $3)', [prof, p, agora()])
        .then((r) => ({ tipo: 'revela', n: r.rows.length })),
    );
  }
  const res = await Promise.all(tarefas);
  assert.equal(res.filter((x) => x.tipo === 'revoga').reduce((s, x) => s + x.n, 0), 1);
  assert.equal(res.filter((x) => x.tipo === 'revela').reduce((s, x) => s + x.n, 0), 0);
  const log = await admin.query('select count(*)::int as n from app.contact_reveal_log where request_id = $1', [p]);
  assert.equal(log.rows[0].n, 0);
  const revogadas = await admin.query(
    'select count(*)::int as n from app.contact_consent where request_id = $1 and revoked_at is not null',
    [p],
  );
  assert.equal(revogadas.rows[0].n, 1);
  const depois = await admin.query('select * from private.contact_reveal_phone($1, $2, $3)', [prof, p, agora()]);
  assert.equal(depois.rows.length, 0);
});

test('T-22c | 20 revogacoes gerais simultaneas: uma devolve 1 (cliente_geral), as demais 0; nenhuma linha nova', async () => {
  const cliente = await usuario();
  const p = await pedidoVencido(cliente);
  await admin.query('select out_state from private.request_phone_attach($1, $2, $3, true, $4, $5)', [
    cliente, p, blob(), 'v1', agora(),
  ]);
  const antes = await admin.query('select count(*)::int as n from app.contact_consent where request_id = $1', [p]);
  const res = await Promise.all(
    conexoes.map((c) =>
      c
        .query('select out_revoked from private.contact_consent_revoke($1, $2, null, $3)', [cliente, p, agora()])
        .then((r) => r.rows[0].out_revoked),
    ),
  );
  assert.deepEqual(contar(res), { 1: 1, 0: N - 1 });
  const motivos = await admin.query(
    'select revoked_reason, count(*)::int as n from app.contact_consent where request_id = $1 group by revoked_reason',
    [p],
  );
  assert.deepEqual(motivos.rows, [{ revoked_reason: 'cliente_geral', n: 1 }]);
  const depois = await admin.query('select count(*)::int as n from app.contact_consent where request_id = $1', [p]);
  assert.equal(depois.rows[0].n, antes.rows[0].n);
});
