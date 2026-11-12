// H-105 (Issue #114) | Dupla aprovacao para estorno e suspensao permanente (docs/factory/80-DESENHO-H105.md §6,
// T-H105-01 a T-H105-04, T-H105-08, T-H105-10, T-H105-11; 78-REFINO-H105.md CA-H105-01 a CA-H105-08).
// Migracao 20261111460000_admin_approval_estorno_suspensao, aplicada DENTRO da transacao de cada teste.
// Tudo e desfeito com rollback; nada persiste no banco de desenvolvimento. Valores sinteticos (@example.test).
// Erros esperados usam savepoint, porque um erro no Postgres aborta a transacao inteira.
// Simultaneidade (20 votos ao mesmo tempo) exige varias conexoes e fica fora deste arquivo.
// Rodar sozinho: node --test --test-concurrency=1 packages/db/tests/approval-dual-h105.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, REPO_ROOT } from '../scripts/lib/env.mjs';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

const MIGRACAO = readFileSync(
  join(REPO_ROOT, 'supabase', 'migrations', '20261111460000_admin_approval_estorno_suspensao.sql'),
  'utf8',
);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const HORA = 3600000;
const T0 = Date.parse('2099-01-01T12:00:00.000Z');
const at = (ms) => new Date(ms).toISOString();
const MOTIVO = 'Motivo sintetico de teste para a dupla aprovacao';

/** Transacao de teste: aplica a migracao e desfaz tudo no fim. Nada fica no banco compartilhado. */
async function tx(fn) {
  await client.query('begin');
  try {
    await client.query(MIGRACAO);
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

/** Executa fn dentro de savepoint. Devolve o erro (ou null). Mantem a transacao utilizavel. */
async function erroEm(fn) {
  await client.query('savepoint sp_erro');
  try {
    await fn();
  } catch (err) {
    await client.query('rollback to savepoint sp_erro');
    return err;
  }
  await client.query('release savepoint sp_erro');
  return null;
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

/** Equipe admin ativa com os papeis dados (papel concedido pelo bootstrap, sem superadmin). */
async function equipe(...papeis) {
  const id = await usuario();
  await client.query(
    `insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at, created_at, status_changed_at)
     values ($1, 'ativo', 'bootstrap', null, now(), now(), now())`,
    [id],
  );
  for (const papel of papeis) {
    await client.query(
      `insert into app.admin_user_role (id, user_id, role_code, granted_by, grant_origin, granted_at, approval_request_id)
       values (gen_random_uuid(), $1, $2, null, 'bootstrap', now(), null)`,
      [id, papel],
    );
  }
  return id;
}

/** Profissional (perfil aprovado, sem documento: insert direto, o gatilho so protege UPDATE). */
async function profissional() {
  const id = await usuario();
  await client.query(
    `insert into app.professional_profile (user_id, verification_status, verified_at, created_at, updated_at)
     values ($1, 'aprovada', now(), now(), now())`,
    [id],
  );
  return id;
}

/** Sessao nova aberta no instante ms (login com TOTP: totp_at = ms). Cada chamada usa uma sessao propria. */
async function sessao(userId, ms) {
  const hash = sha(randomUUID());
  const { rows } = await client.query('select private.admin_session_open($1, $2, $3, $4) as ok',
    [randomUUID(), userId, hash, at(ms)]);
  assert.equal(rows[0].ok, true, 'sessao de teste aberta');
  return hash;
}

/** Abre pedido. Valor padrao: 15000 no estorno; nulo na suspensao (a funcao recusa valor na suspensao). */
async function abrir(ator, ms, { acao = 'estorno', alvo = randomUUID(), valor, motivo = MOTIVO } = {}) {
  const id = randomUUID();
  const hash = await sessao(ator, ms);
  const v = valor !== undefined ? valor : acao === 'estorno' ? 15000 : null;
  await client.query(
    `select private.approval_dual_open($1, $2, $3, $4, $5, $6, $7, $8)`,
    [ator, hash, acao, alvo, v, motivo, id, at(ms)],
  );
  return id;
}

async function votar(ator, familia, id, ms) {
  const hash = await sessao(ator, ms);
  const { rows } = await client.query(
    `select private.approval_dual_vote($1, $2, $3, $4, $5) as r`, [ator, hash, familia, id, at(ms)]);
  return rows[0].r;
}

async function cancelar(ator, familia, id, ms) {
  const { rows } = await client.query(
    `select private.approval_dual_cancel($1, $2, $3, $4) as status`, [ator, familia, id, at(ms)]);
  return rows[0].status;
}

async function pedido(id) {
  const { rows } = await client.query('select * from app.approval_request where id = $1', [id]);
  return rows[0];
}

async function numVotos(id) {
  const { rows } = await client.query(
    'select count(*)::int as n from app.approval_vote where approval_request_id = $1', [id]);
  return rows[0].n;
}

// T-H105-01 | estorno: 15000 e 20000 centavos exigem 1 voto; 20001 exige 2 (CA-H105-01/02)
test('T-H105-01 estorno ate 20000 centavos exige 1 voto e acima exige 2', () =>
  tx(async () => {
    const fin = await equipe('financeiro');
    for (const [valor, exigido] of [[15000, 1], [20000, 1], [20001, 2]]) {
      const id = await abrir(fin, T0, { valor });
      const p = await pedido(id);
      assert.equal(p.required_approvals, exigido, `valor ${valor} exige ${exigido}`);
      assert.equal(p.status, 'pendente');
      assert.equal(p.amount_cents, valor);
    }
  }));

// T-H105-01 | voto simples: 20001 com um voto fica pendente; o segundo voto distinto aprova
test('T-H105-01 estorno de 20001 fica pendente com 1 voto e aprovado com o 2o distinto', () =>
  tx(async () => {
    const solicitante = await equipe('financeiro');
    const b = await equipe('financeiro');
    const c = await equipe('financeiro');
    const id = await abrir(solicitante, T0, { valor: 20001 });

    const primeiro = await votar(b, 'estorno', id, T0 + 1000);
    assert.deepEqual(primeiro, { status: 'pendente', votes: 1, required: 2 });
    assert.equal((await pedido(id)).status, 'pendente');

    const segundo = await votar(c, 'estorno', id, T0 + 2000);
    assert.deepEqual(segundo, { status: 'aprovada', votes: 2, required: 2 });
    const p = await pedido(id);
    assert.equal(p.status, 'aprovada');
    assert.equal(p.consumed_at, null, 'estorno aprovado nao e consumido (a execucao e da H-106)');
  }));

// CA-H105-01 | estorno de 15000 com um Financeiro distinto: aprovado com uma aprovacao so
test('CA-H105-01 estorno de 15000 e aprovado com um Financeiro distinto', () =>
  tx(async () => {
    const solicitante = await equipe('financeiro');
    const b = await equipe('financeiro');
    const id = await abrir(solicitante, T0, { valor: 15000 });
    assert.deepEqual(await votar(b, 'estorno', id, T0 + 1000), { status: 'aprovada', votes: 1, required: 1 });
  }));

// T-H105-04 | autoaprovacao recusada: quem pede nao aprova; nenhum voto gravado
test('T-H105-04 quem pede nao aprova o proprio pedido de estorno', () =>
  tx(async () => {
    const fin = await equipe('financeiro');
    const id = await abrir(fin, T0, { valor: 15000 });
    const erro = await erroEm(() => votar(fin, 'estorno', id, T0 + 1000));
    assert.equal(erro?.code, '42501');
    assert.match(erro.message, /aprovacao_propria/);
    assert.equal(await numVotos(id), 0, 'nenhum voto gravado');
    assert.equal((await pedido(id)).status, 'pendente');
  }));

// T-H105-04 | quem tem os dois papeis (Suporte + Moderador) nunca aprova o proprio pedido de suspensao
test('T-H105-04 quem pede suspensao com os dois papeis nao aprova o proprio pedido', () =>
  tx(async () => {
    const dual = await equipe('suporte', 'moderador');
    const alvo = await profissional();
    const id = await abrir(dual, T0, { acao: 'suspensao_permanente', alvo });
    const erro = await erroEm(() => votar(dual, 'suspensao_permanente', id, T0 + 1000));
    assert.equal(erro?.code, '42501');
    assert.match(erro.message, /aprovacao_propria/);
    assert.equal(await numVotos(id), 0);
  }));

// T-H105-02 | voto repetido recusado: o mesmo aprovador nao conta duas vezes (estorno e suspensao)
test('T-H105-02 o mesmo aprovador nao conta duas vezes (estorno de 20001)', () =>
  tx(async () => {
    const fin = await equipe('financeiro');
    const b = await equipe('financeiro');
    const id = await abrir(fin, T0, { valor: 20001 });
    await votar(b, 'estorno', id, T0 + 1000);
    const erro = await erroEm(() => votar(b, 'estorno', id, T0 + 2000));
    assert.equal(erro?.code, '23505', 'indice unico por aprovador recusa o segundo voto');
    assert.equal(await numVotos(id), 1);
    assert.equal((await pedido(id)).status, 'pendente', 'o pedido segue com um voto');
  }));

test('T-H105-02 o mesmo Moderador nao conta duas vezes na suspensao', () =>
  tx(async () => {
    const suporte = await equipe('suporte');
    const m1 = await equipe('moderador');
    const alvo = await profissional();
    const id = await abrir(suporte, T0, { acao: 'suspensao_permanente', alvo });
    await votar(m1, 'suspensao_permanente', id, T0 + 1000);
    const erro = await erroEm(() => votar(m1, 'suspensao_permanente', id, T0 + 2000));
    assert.equal(erro?.code, '23505');
    assert.equal((await pedido(id)).status, 'pendente');
    assert.equal((await pedido(id)).required_approvals, 2);
  }));

// T-H105-03 | suspensao: 1 voto mantem o perfil intacto; o 2o voto de outro Moderador suspende e consome
test('T-H105-03 suspensao permanente exige 2 Moderadores distintos e suspende na mesma transacao', () =>
  tx(async () => {
    const suporte = await equipe('suporte');
    const m1 = await equipe('moderador');
    const m2 = await equipe('moderador');
    const alvo = await profissional();
    const id = await abrir(suporte, T0, { acao: 'suspensao_permanente', alvo });

    assert.deepEqual(await votar(m1, 'suspensao_permanente', id, T0 + 1000),
      { status: 'pendente', votes: 1, required: 2 });
    let perfil = (await client.query(
      'select verification_status, suspended_at from app.professional_profile where user_id = $1', [alvo])).rows[0];
    assert.equal(perfil.verification_status, 'aprovada', 'com 1 voto o perfil fica intacto');
    assert.equal(perfil.suspended_at, null);

    assert.deepEqual(await votar(m2, 'suspensao_permanente', id, T0 + 2000),
      { status: 'consumida', votes: 2, required: 2 });
    perfil = (await client.query(
      `select verification_status, suspended_at, suspension_reason
         from app.professional_profile where user_id = $1`, [alvo])).rows[0];
    assert.equal(perfil.verification_status, 'suspensa');
    assert.equal(new Date(perfil.suspended_at).getTime(), T0 + 2000, 'suspensao datada no 2o voto');
    assert.equal(perfil.suspension_reason, MOTIVO);

    const p = await pedido(id);
    assert.equal(p.status, 'consumida');
    assert.equal(new Date(p.consumed_at).getTime(), T0 + 2000);
  }));

// T-H105-03 | matriz de papeis: Suporte nao aprova suspensao; Moderador nao pede; Financeiro nao pede suspensao
test('T-H105-03 papeis fora da familia sao negados (suspensao e estorno)', () =>
  tx(async () => {
    const suporte = await equipe('suporte');
    const moderador = await equipe('moderador');
    const fin = await equipe('financeiro');
    const alvo = await profissional();

    for (const ator of [moderador, fin]) {
      const erro = await erroEm(() => abrir(ator, T0, { acao: 'suspensao_permanente', alvo }));
      assert.equal(erro?.code, '42501', 'pedir suspensao sem permissao e negado');
      assert.match(erro.message, /permissao_negada/);
    }

    const id = await abrir(suporte, T0, { acao: 'suspensao_permanente', alvo });
    const erroVoto = await erroEm(() => votar(suporte, 'suspensao_permanente', id, T0 + 1000));
    assert.equal(erroVoto?.code, '42501', 'Suporte nao aprova suspensao');
    assert.match(erroVoto.message, /permissao_negada/);

    const erroEstorno = await erroEm(() => votar(suporte, 'estorno', id, T0 + 1000));
    assert.equal(erroEstorno?.code, '42501', 'familia do pedido nao confere: negado');
    assert.equal(await numVotos(id), 0);
  }));

// T-H105-02 / CA-H105-05 | cancelamento: so o solicitante; repetir devolve rejeitada; depois, voto e negado
test('cancelamento so pelo solicitante, idempotente, e voto apos cancelar e negado', () =>
  tx(async () => {
    const fin = await equipe('financeiro');
    const b = await equipe('financeiro');
    const id = await abrir(fin, T0, { valor: 20001 });

    const erroOutro = await erroEm(() => cancelar(b, 'estorno', id, T0 + 1000));
    assert.equal(erroOutro?.code, '42501', 'quem nao pediu nao cancela');
    assert.equal((await pedido(id)).status, 'pendente');

    assert.equal(await cancelar(fin, 'estorno', id, T0 + 2000), 'rejeitada');
    assert.equal(await cancelar(fin, 'estorno', id, T0 + 3000), 'rejeitada', 'repetir e idempotente');
    assert.equal((await pedido(id)).status, 'rejeitada');

    const erroVoto = await erroEm(() => votar(b, 'estorno', id, T0 + 4000));
    assert.equal(erroVoto?.code, 'ADM27', 'pedido rejeitado nao aceita voto');
  }));

test('cancelamento de suspensao ja consumida e recusado (ADM27)', () =>
  tx(async () => {
    const suporte = await equipe('suporte');
    const m1 = await equipe('moderador');
    const m2 = await equipe('moderador');
    const alvo = await profissional();
    const id = await abrir(suporte, T0, { acao: 'suspensao_permanente', alvo });
    await votar(m1, 'suspensao_permanente', id, T0 + 1000);
    await votar(m2, 'suspensao_permanente', id, T0 + 2000);
    const erro = await erroEm(() => cancelar(suporte, 'suspensao_permanente', id, T0 + 3000));
    assert.equal(erro?.code, 'ADM27');
    assert.equal((await pedido(id)).status, 'consumida');
  }));

// T-H105-08 / CA-H105-08 | validade de 24 h: voto em expires_at - 1 ms vale; em expires_at ou depois, expira
test('T-H105-08 validade de 24 h: a constraint fixa o prazo e o voto apos o prazo expira o pedido', () =>
  tx(async () => {
    const fin = await equipe('financeiro');
    const b = await equipe('financeiro');

    const viva = await abrir(fin, T0, { valor: 15000 });
    const pv = await pedido(viva);
    assert.equal(new Date(pv.expires_at).getTime() - new Date(pv.created_at).getTime(), 24 * HORA,
      'validade de 24 h a partir do pedido');

    assert.equal((await votar(b, 'estorno', viva, T0 + 24 * HORA - 1)).status, 'aprovada',
      'voto em expires_at - 1 ms vale');

    const alvoEmExpirado = randomUUID();
    const expirada = await abrir(fin, T0, { valor: 15000, alvo: alvoEmExpirado });
    const noPrazo = await votar(b, 'estorno', expirada, T0 + 24 * HORA);
    assert.equal(noPrazo.status, 'expirada', 'voto em expires_at e negado como expirado');
    assert.equal((await pedido(expirada)).status, 'expirada');
    assert.equal(await numVotos(expirada), 0, 'nenhum voto gravado apos o prazo');

    const depois = await abrir(fin, T0, { valor: 20001 });
    assert.equal((await votar(b, 'estorno', depois, T0 + 24 * HORA + 1000)).status, 'expirada',
      'voto 1 s depois tambem expira');
    assert.equal((await pedido(depois)).status, 'expirada');
  }));

test('T-H105-08 pedido vencido nao bloqueia um novo pedido do mesmo alvo', () =>
  tx(async () => {
    const fin = await equipe('financeiro');
    const alvo = randomUUID();
    const antigo = await abrir(fin, T0, { valor: 15000, alvo });
    const novo = await abrir(fin, T0 + 25 * HORA, { valor: 15000, alvo });
    assert.equal((await pedido(antigo)).status, 'expirada', 'o antigo venceu e saiu do caminho');
    assert.equal((await pedido(novo)).status, 'pendente');
  }));

// Pedido aberto unico por alvo (ADM23) e validacao de entrada (ADM22)
test('pedido ja aberto para o mesmo alvo e recusado (ADM23)', () =>
  tx(async () => {
    const fin = await equipe('financeiro');
    const alvo = randomUUID();
    await abrir(fin, T0, { valor: 15000, alvo });
    const erro = await erroEm(() => abrir(fin, T0 + 1000, { valor: 15000, alvo }));
    assert.equal(erro?.code, 'ADM23');
  }));

test('validacao de valor, motivo e alvo recusa com ADM22 (sem gravar pedido)', () =>
  tx(async () => {
    const fin = await equipe('financeiro');
    const suporte = await equipe('suporte');
    const alvo = await profissional();
    const casos = [
      { ator: fin, opts: { valor: 0 }, msg: /valor_invalido/ },
      { ator: fin, opts: { valor: 15000, motivo: 'curto' }, msg: /motivo_invalido/ },
      { ator: suporte, opts: { acao: 'suspensao_permanente', alvo: randomUUID() }, msg: /alvo_invalido/ },
      { ator: suporte, opts: { acao: 'suspensao_permanente', alvo, valor: 100 }, msg: /valor_invalido/ },
    ];
    for (const { ator, opts, msg } of casos) {
      const erro = await erroEm(() => abrir(ator, T0, opts));
      assert.equal(erro?.code, 'ADM22', `caso ${msg}`);
      assert.match(erro.message, msg);
    }
    const { rows } = await client.query(
      `select count(*)::int as n from app.approval_request where requested_by in ($1, $2)`, [fin, suporte]);
    assert.equal(rows[0].n, 0, 'nenhum pedido gravado');
  }));

// Listagem: pedido de outra pessoa aparece so para quem pode votar, e nunca traz o motivo
test('listagem mostra o pedido aos aprovadores elegiveis, sem o motivo', () =>
  tx(async () => {
    const fin = await equipe('financeiro');
    const b = await equipe('financeiro');
    const auditor = await equipe('auditor');
    const id = await abrir(fin, T0, { valor: 20001 });

    const { rows: deB } = await client.query(
      'select * from private.approval_dual_list($1, $2, $3)', [b, 'estorno', at(T0 + 1000)]);
    const visto = deB.find((r) => r.out_id === id);
    assert.ok(visto, 'o Financeiro B ve o pedido para votar');
    assert.equal(visto.out_solicitado_por_mim, false);
    assert.equal(visto.out_votos, 0);
    assert.equal(visto.out_required_approvals, 2);
    assert.deepEqual(Object.keys(visto).sort(), [
      'out_expires_at', 'out_estado', 'out_id', 'out_required_approvals', 'out_solicitado_por_mim',
      'out_subject_ref', 'out_valor_centavos', 'out_votos',
    ].sort(), 'colunas sem motivo');

    const { rows: doAuditor } = await client.query(
      'select * from private.approval_dual_list($1, $2, $3)', [auditor, 'estorno', at(T0 + 1000)]);
    assert.equal(doAuditor.some((r) => r.out_id === id), false, 'auditor sem permissao nao ve o pedido');

    const { rows: doSolicitante } = await client.query(
      'select * from private.approval_dual_list($1, $2, $3)', [fin, 'estorno', at(T0 + 1000)]);
    assert.equal(doSolicitante.find((r) => r.out_id === id).out_solicitado_por_mim, true);
  }));

// T-H105-11 | privilegios: funcoes so para app_system; negacao gravada por funcao propria
test('T-H105-11 funcoes de dupla aprovacao so para app_system', () =>
  tx(async () => {
    const funcoes = [
      'private.approval_dual_open(uuid,text,text,uuid,integer,text,uuid,timestamptz)',
      'private.approval_dual_vote(uuid,text,text,uuid,timestamptz)',
      'private.approval_dual_cancel(uuid,text,uuid,timestamptz)',
      'private.approval_dual_denied_record(uuid,text,uuid,text,timestamptz)',
      'private.approval_dual_list(uuid,text,timestamptz)',
    ];
    for (const f of funcoes) {
      const { rows } = await client.query(
        `select has_function_privilege('app_system', $1, 'execute') as sistema,
                has_function_privilege('app_api', $1, 'execute') as api,
                has_function_privilege('anon', $1, 'execute') as anon,
                has_function_privilege('authenticated', $1, 'execute') as auth,
                has_function_privilege('service_role', $1, 'execute') as servico`, [f]);
      assert.equal(rows[0].sistema, true, `app_system executa ${f}`);
      assert.equal(rows[0].api, false, `app_api nao executa ${f}`);
      assert.equal(rows[0].anon, false);
      assert.equal(rows[0].auth, false);
      assert.equal(rows[0].servico, false);
    }
  }));

// T-H105-11 | auditoria: cada decisao gera evento na mesma transacao (ator, objeto, acao)
test('T-H105-11 cada decisao gera evento de auditoria com o objeto certo', () =>
  tx(async () => {
    const fin = await equipe('financeiro');
    const b = await equipe('financeiro');
    const id = await abrir(fin, T0, { valor: 15000 });
    await votar(b, 'estorno', id, T0 + 1000);

    const { rows } = await client.query(
      `select action, object_type, object_id from audit.audit_event
        where object_id = $1 order by seq`, [id]);
    const acoes = rows.map((r) => r.action);
    assert.ok(acoes.includes('approval.requested'), 'pedido aberto auditado');
    assert.ok(acoes.includes('approval.voted'), 'voto auditado');
    assert.ok(rows.every((r) => r.object_type === 'approval_request'), 'objeto e o pedido');
  }));

// Negacao de voto: a funcao so grava para pedido real da familia (devolve nulo caso contrario)
test('a negacao de voto so e registrada para pedido real da mesma familia', () =>
  tx(async () => {
    const fin = await equipe('financeiro');
    const id = await abrir(fin, T0, { valor: 15000 });
    const { rows: ok } = await client.query(
      `select private.approval_dual_denied_record($1, 'estorno', $2, 'autoaprovacao', $3) as id`,
      [fin, id, at(T0 + 1000)]);
    assert.ok(ok[0].id, 'pedido real da familia gera registro');
    const { rows: outra } = await client.query(
      `select private.approval_dual_denied_record($1, 'suspensao_permanente', $2, 'autoaprovacao', $3) as id`,
      [fin, id, at(T0 + 1000)]);
    assert.equal(outra[0].id, null, 'familia diferente nao grava');
  }));
