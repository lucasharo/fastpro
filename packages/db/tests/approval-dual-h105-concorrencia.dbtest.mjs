// H-105 (Issue #114) | Corrida real com varias conexoes (80-DESENHO-H105 §6, T-H105-07; CA-H105-10).
// Diferente do arquivo transacional: aqui os dados sao COMMITADOS (outra conexao so enxerga o que foi
// commitado) e sao apagados ao fim de cada teste. Residuo e conferido depois da limpeza.
// Limites, por causa da trilha de auditoria (audit.audit_event recusa DELETE/UPDATE/TRUNCATE):
//  - a corrida de votos usa private.admin_approval_vote, que trava o pedido (FOR UPDATE) e nao grava auditoria;
//  - os pedidos simultaneos sao inseridos direto: o indice unico por alvo aberto e o que serializa;
//  - o efeito da suspensao (perfil + consumo) fica em private.approval_dual_vote, que grava auditoria
//    commitada que nao pode ser apagada: essa parte e coberta por transacao em approval-dual-h105.dbtest.mjs.
// Rodar sozinho: node --test --test-concurrency=1 packages/db/tests/approval-dual-h105-concorrencia.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';

const T0 = Date.parse('2099-01-01T12:00:00.000Z');
const HORA = 3600000;
const VINTE = 20;
const at = (ms) => new Date(ms).toISOString();
const MOTIVO = 'Motivo sintetico de teste para a dupla aprovacao (concorrencia)';

let admin;
before(async () => {
  admin = await connect();
});
after(async () => {
  await admin?.end();
});

/** Equipe admin ativa com os papeis dados. Cadastra o id em f.usuarios para a limpeza. */
async function equipe(f, ...papeis) {
  const id = randomUUID();
  await admin.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, 'ativo', now(), now())`,
    [id, `${randomUUID()}@example.test`, randomUUID()],
  );
  f.usuarios.push(id);
  await admin.query(
    `insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at, created_at, status_changed_at)
     values ($1, 'ativo', 'bootstrap', null, now(), now(), now())`,
    [id],
  );
  for (const papel of papeis) {
    await admin.query(
      `insert into app.admin_user_role (id, user_id, role_code, granted_by, grant_origin, granted_at, approval_request_id)
       values (gen_random_uuid(), $1, $2, null, 'bootstrap', now(), null)`,
      [id, papel],
    );
  }
  return id;
}

/** Pedido inserido direto (COMMIT). Sem auditoria: o gatilho de auditoria nao existe em app.approval_request. */
async function pedidoDireto(f, { acao, alvo, valor, exigidos, solicitante }) {
  const id = randomUUID();
  f.pedidos.push(id);
  await admin.query(
    `insert into app.approval_request (id, action_type, subject_ref, amount_cents, reason, requested_by,
       required_approvals, status, created_at, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, 'pendente', $8, $9)`,
    [id, acao, alvo, valor, MOTIVO, solicitante, exigidos, at(T0), at(T0 + 24 * HORA)],
  );
  return id;
}

/** Remove o que o teste criou: votos, pedidos, papeis, equipe e usuarios. Nunca apaga auditoria (nao pode). */
async function limpar(f) {
  await admin.query('delete from app.approval_vote where approval_request_id = any($1::uuid[])', [f.pedidos]);
  await admin.query(
    'delete from app.approval_request where id = any($1::uuid[]) or subject_ref = any($2::uuid[])',
    [f.pedidos, f.alvos],
  );
  await admin.query('delete from app.admin_user_role where user_id = any($1::uuid[])', [f.usuarios]);
  await admin.query('delete from app.admin_staff where user_id = any($1::uuid[])', [f.usuarios]);
  await admin.query('delete from app.app_user where id = any($1::uuid[])', [f.usuarios]);
}

/** Contagem de residuo depois da limpeza. Tudo deve ser zero. */
async function residuo(f) {
  const { rows } = await admin.query(
    `select
       (select count(*) from app.app_user where id = any($1::uuid[]))::int as usuarios,
       (select count(*) from app.approval_request
         where id = any($2::uuid[]) or subject_ref = any($3::uuid[]))::int as pedidos,
       (select count(*) from app.approval_vote where approval_request_id = any($2::uuid[]))::int as votos,
       (select count(*) from audit.audit_event where object_id::text = any($4::text[]))::int as auditoria`,
    [f.usuarios, f.pedidos, f.alvos, f.pedidos],
  );
  return rows[0];
}

/** Dispara n chamadas em conexoes separadas ao mesmo tempo. Cada resultado e {ok} ou {erro, mensagem}. */
async function emCorrida(n, chamada) {
  const conexoes = await Promise.all(Array.from({ length: n }, () => connect()));
  try {
    return await Promise.all(
      conexoes.map((c, i) =>
        chamada(c, i).then(
          (ok) => ({ ok }),
          (err) => ({ erro: err.code, mensagem: err.message }),
        ),
      ),
    );
  } finally {
    await Promise.all(conexoes.map((c) => c.end()));
  }
}

/** Corrida de votos: exatamente 2 aceitos (um pendente e um que aprova); os outros 18 recusados por nao pendente. */
function conferaCorridaDeVotos(resultados) {
  const aceitos = resultados.filter((r) => 'ok' in r).map((r) => r.ok).sort();
  const recusados = resultados.filter((r) => 'erro' in r);
  assert.deepEqual(aceitos, ['aprovada', 'pendente'], 'exatamente 2 votos aceitos: um pendente e o que aprova');
  assert.equal(recusados.length, VINTE - 2, 'os outros 18 votos sao recusados');
  for (const r of recusados) {
    assert.ok(['ADM09', '23514'].includes(r.erro),
      `recusa por pedido nao pendente, nao outro erro (${r.erro}: ${r.mensagem})`);
  }
}

/** Estado final do pedido: status e votos gravados (1 linha por aprovador distinto). */
async function estadoFinal(id) {
  const { rows } = await admin.query(
    `select r.status,
            (select count(*) from app.approval_vote v where v.approval_request_id = r.id)::int as votos,
            (select count(distinct v.approver_id) from app.approval_vote v
              where v.approval_request_id = r.id)::int as distintos
       from app.approval_request r where r.id = $1`,
    [id],
  );
  return rows[0];
}

const RESIDUO_ZERO = { usuarios: 0, pedidos: 0, votos: 0, auditoria: 0 };

// T-H105-07 | estorno de 20001: 20 Financeiros distintos votam ao mesmo tempo; exatamente um efeito (aprovada)
test('T-H105-07 20 votos simultaneos de Financeiros distintos no estorno de 20001: 1 efeito, sem residuo', async () => {
  const f = { usuarios: [], pedidos: [], alvos: [] };
  try {
    const solicitante = await equipe(f, 'financeiro');
    const aprovadores = [];
    for (let i = 0; i < VINTE; i += 1) aprovadores.push(await equipe(f, 'financeiro'));
    const alvo = randomUUID();
    f.alvos.push(alvo);
    const id = await pedidoDireto(f, { acao: 'estorno', alvo, valor: 20001, exigidos: 2, solicitante });

    const resultados = await emCorrida(VINTE, (c, i) =>
      c.query('select private.admin_approval_vote($1, $2, $3) as s', [id, aprovadores[i], at(T0 + 1000)])
        .then((r) => r.rows[0].s));
    conferaCorridaDeVotos(resultados);
    assert.deepEqual(await estadoFinal(id), { status: 'aprovada', votos: 2, distintos: 2 },
      'um unico efeito: o pedido vai a aprovada uma vez, com 2 votos de pessoas distintas');
  } finally {
    await limpar(f);
  }
  assert.deepEqual(await residuo(f), RESIDUO_ZERO, 'nada restou no banco');
});

// T-H105-07 | suspensao: 20 Moderadores distintos votam ao mesmo tempo; exatamente um efeito (aprovada uma vez)
test('T-H105-07 20 votos simultaneos de Moderadores distintos na suspensao: 1 efeito, sem residuo', async () => {
  const f = { usuarios: [], pedidos: [], alvos: [] };
  try {
    const suporte = await equipe(f, 'suporte');
    const moderadores = [];
    for (let i = 0; i < VINTE; i += 1) moderadores.push(await equipe(f, 'moderador'));
    const alvo = randomUUID();
    f.alvos.push(alvo);
    const id = await pedidoDireto(f, { acao: 'suspensao_permanente', alvo, valor: null, exigidos: 2,
      solicitante: suporte });

    const resultados = await emCorrida(VINTE, (c, i) =>
      c.query('select private.admin_approval_vote($1, $2, $3) as s', [id, moderadores[i], at(T0 + 1000)])
        .then((r) => r.rows[0].s));
    conferaCorridaDeVotos(resultados);
    assert.deepEqual(await estadoFinal(id), { status: 'aprovada', votos: 2, distintos: 2 },
      'um unico efeito: a suspensao e aprovada uma vez, com 2 Moderadores distintos');
  } finally {
    await limpar(f);
  }
  assert.deepEqual(await residuo(f), RESIDUO_ZERO, 'nada restou no banco');
});

// T-H105-07 | 20 pedidos simultaneos de estorno para o mesmo alvo: 1 entra; o indice unico recusa os outros 19
test('T-H105-07 20 pedidos simultaneos para o mesmo alvo: 1 pedido aberto, 19 recusados, sem residuo', async () => {
  const f = { usuarios: [], pedidos: [], alvos: [] };
  try {
    const solicitante = await equipe(f, 'financeiro');
    const alvo = randomUUID();
    f.alvos.push(alvo);
    const ids = Array.from({ length: VINTE }, () => randomUUID());
    f.pedidos.push(...ids);

    const resultados = await emCorrida(VINTE, (c, i) =>
      c.query(
        `insert into app.approval_request (id, action_type, subject_ref, amount_cents, reason, requested_by,
           required_approvals, status, created_at, expires_at)
         values ($1, 'estorno', $2, 15000, $3, $4, 1, 'pendente', $5, $6)`,
        [ids[i], alvo, MOTIVO, solicitante, at(T0), at(T0 + 24 * HORA)],
      ).then(() => 'criado'));
    const aceitos = resultados.filter((r) => 'ok' in r);
    const recusados = resultados.filter((r) => 'erro' in r);
    assert.equal(aceitos.length, 1, 'exatamente um pedido aberto para o alvo');
    assert.equal(recusados.length, VINTE - 1, 'os outros 19 sao recusados');
    for (const r of recusados) {
      assert.equal(r.erro, '23505', `recusa do indice unico por alvo aberto (${r.mensagem})`);
    }
    const { rows } = await admin.query(
      "select count(*)::int as n from app.approval_request where subject_ref = $1 and status in ('pendente', 'aprovada')",
      [alvo],
    );
    assert.equal(rows[0].n, 1, 'so um pedido aberto no banco');
  } finally {
    await limpar(f);
  }
  assert.deepEqual(await residuo(f), RESIDUO_ZERO, 'nada restou no banco');
});
