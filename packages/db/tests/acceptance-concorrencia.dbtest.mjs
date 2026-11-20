// H-058 (Issue #71) | Integracao e concorrencia do aceite no banco de desenvolvimento (162-DESENHO-H058.md, §7, fatia 6).
// Cobre T-H058-30 e 31 (10 conexoes na ultima vaga e no teto de 4), T-H058-11 (mesma chave simultanea),
// T-H058-08 (replay 5x), T-H058-35 (lock de 3 s em outra sessao: 409 contencao_temporaria) e o limite de 20 por
// minuto pelo banco (T-H058-34, parte do banco). Cada aceite roda pelo adaptador real (PgAcceptanceStore) numa
// conexao propria com COMMIT de verdade; por isso os dados sao COMITADOS, sinteticos, marcados com h058-.
// Limpeza: app.acceptance, app.message e app.conversation negam DELETE por gatilho (imutabilidade, RN-H058), entao
// os registros comitados ficam no DEV com o prefixo h058- e nao sao apagados aqui (decisao pendente do lider).
// Conexao: usa DATABASE_URL_MIGRATIONS (o unico segredo de banco no .env.local); nao usa o papel app_system.
// Executar: node --test --test-concurrency=1 packages/db/tests/acceptance-concorrencia.dbtest.mjs
import { test, before, after } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';
import { concederAcessoVigente } from './fixtures/professional-access.mjs';
import { PgAcceptanceRateLimit, PgAcceptanceStore } from '../dist/index.js';

const MARCA = `h058-${randomUUID().slice(0, 8)}`;
const MS_HORA = 3600 * 1000;
const SP = { lon: -46.6333, lat: -23.5505 };
const sha = (s) => createHash('sha256').update(s).digest('hex');
const blob = () => Buffer.concat([Buffer.from([1]), randomBytes(43)]);
const slugSintetico = () => `h058-${randomUUID().replace(/-/g, '').slice(0, 20)}`;
// Relogio real com 1 minuto de folga: o acesso vigente e a janela do pedido precisam valer no instante do aceite.
const agora = () => new Date(Date.now() - 60_000).toISOString();

let admin;
const conexoesAbertas = new Set();

/** Fabrica de conexao dedicada: cada aceite abre a sua e a libera ao fim (BEGIN e COMMIT na mesma conexao). */
function fabricaDeConexao() {
  return async () => {
    const c = await connect();
    conexoesAbertas.add(c);
    return {
      query: (texto, params) => c.query(texto, params),
      release: () => {
        conexoesAbertas.delete(c);
        void c.end().catch(() => undefined);
      },
    };
  };
}

/** Cliente SQL simples (para o limite de taxa), sobre a conexao de migracoes. */
const clienteSql = () => ({ query: (texto, params) => admin.query(texto, params) });

before(async () => {
  admin = await connect();
});

after(async () => {
  await admin.end();
});

async function usuario() {
  const id = randomUUID();
  await admin.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, 'ativo', $4, $4)`,
    [id, `${MARCA}-${id.slice(0, 8)}@example.test`, randomUUID(), agora()],
  );
  return id;
}

/** Grupo e servico online na mesma transacao (o catalogo exige grupo ativo com servico ativo no COMMIT). */
async function servicoOnline() {
  const grupo = randomUUID();
  const id = randomUUID();
  await admin.query('begin');
  try {
    await admin.query('insert into app.service_group (id, name, position, active) values ($1, $2, 1, true)', [
      grupo,
      `Grupo ${MARCA} ${grupo.slice(0, 6)}`,
    ]);
    await admin.query(
      `insert into app.service (id, group_id, name, modality, regulated, active) values ($1, $2, $3, 'online', false, true)`,
      [id, grupo, `Servico ${MARCA} ${id.slice(0, 6)}`],
    );
    await admin.query('commit');
  } catch (err) {
    await admin.query('rollback');
    throw err;
  }
  return id;
}

/** Profissional elegivel sintetico: perfil aprovado, e-mail verificado, acesso vigente e servico online. */
async function profissional(servicoId) {
  const id = await usuario();
  const quando = agora();
  await admin.query(
    `insert into app.professional_profile (user_id, verification_status, verified_at, created_at, updated_at,
                                           document_type, document_enc, document_hmac, public_name, slug)
     values ($1, 'aprovada', $2, $2, $2, 'CPF', $3, $4, 'Profissional sintetico', $5)`,
    [id, quando, blob(), sha(`doc-${randomUUID()}`), slugSintetico()],
  );
  await admin.query(
    `insert into app.professional_service (professional_id, service_id, modality, declared_at) values ($1, $2, 'online', $3)`,
    [id, servicoId, quando],
  );
  await concederAcessoVigente(admin, id, quando);
  return id;
}

/** Pedido publicado sintetico com prazo de 7 dias; wave2 aberta quando pedido. */
async function pedido({ segundaOnda = false } = {}) {
  const cliente = await usuario();
  const svc = await servicoOnline();
  const rascunhoId = randomUUID();
  const email = `${MARCA}-rascunho-${rascunhoId.slice(0, 8)}@example.test`;
  const agoraIso = agora();
  await admin.query(
    `insert into app.request_draft (id, browser_nonce_hash, service_id, address_text, urgency, description, status,
                                    expires_at, ip_hmac, created_at, updated_at, first_name, email, email_hmac,
                                    email_verified_at, confirmed_at)
     values ($1, $2, $3, 'Rua sintetica 1', 'imediato', 'Descricao sintetica', 'aberto',
             $4, $5, $6, $6, 'Ana', $7, $8, $6, $6)`,
    [rascunhoId, sha(`cookie-${rascunhoId}`), svc, new Date(Date.now() + 7 * 24 * MS_HORA).toISOString(), sha('ip-sintetico'), agoraIso, email, sha(email)],
  );
  const ponto = await admin.query(
    `insert into app.geocode_point (subject_kind, subject_id, address_hash, state, exact_point, geocode_mode, precision, geocoded_at)
     values ('request', $1, $2, 'ok',
             extensions.st_setsrid(extensions.st_makepoint($3, $4), 4326)::extensions.geography,
             'permanent', 'endereco', $5)
     returning id`,
    [rascunhoId, sha(`end-${randomUUID()}`), SP.lon, SP.lat, agoraIso],
  );
  // service_request_prazo_168h: o prazo de admissao fica exatamente 168 h depois da publicacao.
  const publicadoMs = Date.now() - 60_000;
  const publicado = new Date(publicadoMs).toISOString();
  const prazo = new Date(publicadoMs + 168 * MS_HORA).toISOString();
  const r = await admin.query(
    `insert into app.service_request (customer_user_id, service_id, status, urgency, description, address_text, first_name,
                                      geocode_point_id, origin_draft_id, published_at, acceptance_deadline_at)
     values ($1, $2, 'publicado', 'imediato', 'Descricao sintetica', 'Rua sintetica 1', 'Ana', $3, $4, $5, $6)
     returning id`,
    [cliente, svc, ponto.rows[0].id, rascunhoId, publicado, prazo],
  );
  const id = r.rows[0].id;
  if (segundaOnda) {
    await admin.query('update app.service_request set wave2_opened_at = now() where id = $1', [id]);
  }
  return { id, svc };
}

async function contagem(pedidoId) {
  const r = await admin.query(
    `select (select count(*)::int from app.acceptance where request_id = $1) as aceites,
            (select count(*)::int from app.conversation where request_id = $1) as conversas,
            (select count(*)::int from app.message m join app.conversation c on c.id = m.conversation_id where c.request_id = $1) as mensagens,
            (select count(*)::int from ops.outbox_event where aggregate_type = 'service_request' and aggregate_id = $1) as eventos,
            (select acceptances_count from app.service_request where id = $1) as contador`,
    [pedidoId],
  );
  return r.rows[0];
}

function store() {
  return new PgAcceptanceStore({ connect: fabricaDeConexao() });
}

function comando(pedidoId, profissionalId, chave = randomUUID()) {
  return { requestId: pedidoId, professionalId: profissionalId, key: chave, now: new Date() };
}

/** Dispara N aceites ao mesmo tempo, cada um na sua conexao; devolve os resultados na ordem de disparo. */
function disputar(pedidoId, profissionais, chaves = profissionais.map(() => randomUUID())) {
  return Promise.all(profissionais.map((p, i) => store().aceitar(comando(pedidoId, p, chaves[i]))));
}

test('T-H058-30: 10 conexoes disputam a ultima vaga (7 de 8 na 2a onda); exatamente 1 criado, 9 sem_vagas', async () => {
  const { id, svc } = await pedido({ segundaOnda: true });
  for (let i = 0; i < 7; i += 1) {
    const p = await profissional(svc);
    const r = await admin.query('select * from private.acceptance_create($1, $2, $3)', [id, p, new Date().toISOString()]);
    assert.equal(r.rows[0].out_outcome, 'criado', `aceite previo ${i + 1}`);
  }
  assert.equal((await contagem(id)).contador, 7);

  const disputantes = await Promise.all(Array.from({ length: 10 }, () => profissional(svc)));
  const resultados = await disputar(id, disputantes);

  const criados = resultados.filter((r) => r.ok && r.status === 201);
  const cheios = resultados.filter((r) => !r.ok && r.code === 'sem_vagas');
  assert.equal(criados.length, 1, `criados: ${JSON.stringify(resultados.map((r) => r.status ?? r.code))}`);
  assert.equal(cheios.length, 9);
  assert.equal(criados[0].envelope.acceptance.slotNo, 8);
  assert.equal(criados[0].envelope.acceptance.wave, 2);
  const c = await contagem(id);
  assert.equal(c.aceites, 8);
  assert.equal(c.contador, 8);
  assert.equal(c.conversas, 8);
  assert.equal(c.mensagens, 8);
  assert.equal(c.eventos, 8);
});

test('T-H058-31: 10 conexoes com 4 vagas livres (sem 2a onda); exatamente 4 criados, slots 1..4 sem lacuna', async () => {
  const { id, svc } = await pedido();
  const disputantes = await Promise.all(Array.from({ length: 10 }, () => profissional(svc)));
  const resultados = await disputar(id, disputantes);

  const criados = resultados.filter((r) => r.ok && r.status === 201);
  assert.equal(criados.length, 4, `criados: ${JSON.stringify(resultados.map((r) => r.status ?? r.code))}`);
  assert.equal(resultados.filter((r) => !r.ok && r.code === 'sem_vagas').length, 6);
  const slots = criados.map((r) => r.envelope.acceptance.slotNo).sort((a, b) => a - b);
  assert.deepEqual(slots, [1, 2, 3, 4]);
  assert.equal((await contagem(id)).aceites, 4);
});

test('T-H058-11: mesma chave em 10 conexoes simultaneas cria 1 aceite; as demais veem repetida (200) ou contencao', async () => {
  const { id, svc } = await pedido();
  const profissional1 = await profissional(svc);
  const chave = randomUUID();
  const resultados = await Promise.all(Array.from({ length: 10 }, () => store().aceitar(comando(id, profissional1, chave))));

  const criados = resultados.filter((r) => r.ok && r.status === 201);
  assert.equal(criados.length, 1);
  for (const r of resultados) {
    if (r.ok) {
      assert.ok(r.status === 201 || r.status === 200);
      assert.equal(r.envelope.acceptance.id, criados[0].envelope.acceptance.id, 'mesma resposta de dominio');
    } else {
      assert.ok(['operacao_em_andamento', 'contencao_temporaria'].includes(r.code), r.code);
    }
  }
  const c = await contagem(id);
  assert.equal(c.aceites, 1);
  assert.equal(c.mensagens, 1);
});

test('T-H058-08: replay 5x da mesma chave devolve 201 e depois 200 com a mesma resposta; 1 aceite, 1 conversa, 1 mensagem, 1 evento', async () => {
  const { id, svc } = await pedido();
  const p = await profissional(svc);
  const chave = randomUUID();
  const respostas = [];
  for (let i = 0; i < 5; i += 1) respostas.push(await store().aceitar(comando(id, p, chave)));

  assert.deepEqual(
    respostas.map((r) => r.status),
    [201, 200, 200, 200, 200],
  );
  const primeira = respostas[0].envelope;
  for (const r of respostas) {
    assert.equal(r.envelope.acceptance.id, primeira.acceptance.id);
    assert.equal(r.envelope.conversation.id, primeira.conversation.id);
    assert.equal(r.envelope.acceptance.slotNo, primeira.acceptance.slotNo);
    assert.equal(r.envelope.acceptance.acceptedAt, primeira.acceptance.acceptedAt);
    assert.equal(r.envelope.customer.firstName, 'Ana');
  }
  const c = await contagem(id);
  assert.deepEqual([c.aceites, c.conversas, c.mensagens, c.eventos], [1, 1, 1, 1]);
});

test('T-H058-35: lock do pedido mantido por outra sessao por mais de 3 s vira 409 contencao_temporaria, sem escrita', async () => {
  const { id, svc } = await pedido();
  const p = await profissional(svc);
  const segurando = await connect();
  await segurando.query('begin');
  await segurando.query('select id from app.service_request where id = $1 for update', [id]);
  const espera = store().aceitar(comando(id, p));
  // So conta o tempo de espera depois que o aceite esta de fato bloqueado no lock (pg_stat_activity), senao a
  // abertura da conexao poderia consumir a janela e o lock seria liberado antes da disputa.
  let bloqueada = 0;
  for (let i = 0; i < 100 && bloqueada === 0; i += 1) {
    await sleep(100);
    bloqueada = (
      await admin.query(
        `select count(*)::int as n from pg_stat_activity
          where wait_event_type = 'Lock' and query ilike '%acceptance_create%'`,
      )
    ).rows[0].n;
  }
  assert.ok(bloqueada >= 1, 'o aceite precisa estar esperando o lock do pedido');
  await sleep(3500);
  await segurando.query('rollback');
  await segurando.end();

  const r = await espera;
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.equal(r.code, 'contencao_temporaria');
  assert.equal(r.retryAfterSeconds, 1);
  const c = await contagem(id);
  assert.deepEqual([c.aceites, c.conversas, c.mensagens, c.eventos, c.contador], [0, 0, 0, 0, 0]);
});

test('T-H058-34 (banco): 20 requisicoes por minuto passam e a 21a e barrada com Retry-After', async () => {
  const limite = new PgAcceptanceRateLimit({ client: clienteSql(), chaveDoProfissional: (id) => sha(`rl-${id}`) });
  const profissionalId = randomUUID();
  const agoraMs = Date.now();
  for (let i = 0; i < 20; i += 1) {
    const d = await limite.check(profissionalId, agoraMs);
    assert.equal(d.decision, 'permitido', `requisicao ${i + 1}`);
    await limite.record(profissionalId, agoraMs);
  }
  const barrada = await limite.check(profissionalId, agoraMs);
  assert.equal(barrada.decision, 'barrado');
  assert.ok(barrada.retryAfterSeconds >= 1);
});
