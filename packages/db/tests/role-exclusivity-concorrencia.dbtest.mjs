// H-017 (Issue #30) | T-10 da exclusividade de papeis: corrida entre dois clientes (101-DESENHO-H017.md, §6, §7).
// Banco de desenvolvimento, dois clientes reais em paralelo. Cada rodada usa um usuario novo e apaga so as
// proprias linhas no fim (o banco DEV e compartilhado com outras Issues; nada alem dos ids desta rodada e tocado).
// Duas ordens por tipo de perfil: (a) admin primeiro, perfil depois; (b) perfil primeiro, admin depois.
// Em toda rodada: exatamente um dos dois comandos falha, com a chave esperada; nunca as duas linhas; nada de deadlock.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as esperar } from 'node:timers/promises';
import { connect } from '../scripts/lib/env.mjs';

const RODADAS = 50;
const ESPERA_MS = 40;

const ADMIN_SQL = `insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at, created_at, status_changed_at)
                   values ($1, 'pendente_mfa', 'bootstrap', null, null, now(), now())`;
const PERFIL_SQL = {
  cliente: 'insert into app.customer_profile (user_id, created_at) values ($1, now())',
  profissional:
    'insert into app.professional_profile (user_id, created_at, updated_at) values ($1, now(), now())',
};
const CHAVE_PERFIL = {
  cliente: 'papel_exclusivo_admin_cliente',
  profissional: 'papel_exclusivo_admin_profissional',
};
const CHAVE_ADMIN = 'papel_exclusivo_perfil_admin';

let setup;
let a;
let b;

before(async () => {
  setup = await connect();
  a = await connect();
  b = await connect();
});
after(async () => {
  await a?.end();
  await b?.end();
  await setup?.end();
});

const dormir = (ms) => esperar(ms);

/** Executa e devolve { ok } ou { err }, sem lancar; permite comparar as duas pontas. */
const tentar = (cli, sql, params) =>
  cli.query(sql, params).then(
    () => ({ ok: true }),
    (err) => ({ err }),
  );

async function criarUsuario() {
  const id = randomUUID();
  await setup.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, 'ativo', now(), now())`,
    [id, `${randomUUID()}@example.test`, randomUUID()],
  );
  return id;
}

async function limpar(id) {
  await setup.query('delete from app.customer_profile where user_id = $1', [id]);
  await setup.query('delete from app.professional_profile where user_id = $1', [id]);
  await setup.query('delete from app.admin_staff where user_id = $1', [id]);
  await setup.query('delete from app.app_user where id = $1', [id]);
}

async function linhasDe(id) {
  const r = await setup.query(
    `select (select count(*)::int from app.admin_staff where user_id = $1) as admin,
            (select count(*)::int from app.customer_profile where user_id = $1) as cliente,
            (select count(*)::int from app.professional_profile where user_id = $1) as profissional`,
    [id],
  );
  return r.rows[0];
}

/** Ordem (a): admin commita primeiro; a outra ponta (perfil) deve falhar com a chave do perfil. */
async function rodadaAdminPrimeiro(tipo, id) {
  await a.query('begin');
  await a.query(ADMIN_SQL, [id]); // A segura a trava do papel
  const pB = (async () => {
    await b.query('begin');
    return tentar(b, PERFIL_SQL[tipo], [id]);
  })();
  await dormir(ESPERA_MS);
  await a.query('commit');
  const rB = await pB;
  await b.query('rollback').catch(() => {});
  return { perdedor: rB, chaveEsperada: CHAVE_PERFIL[tipo], vencedor: 'admin' };
}

/** Ordem (b): perfil commita primeiro; o admin deve falhar com a chave de perfil existente. */
async function rodadaPerfilPrimeiro(tipo, id) {
  await b.query('begin');
  await b.query(PERFIL_SQL[tipo], [id]); // B segura a trava do papel
  const pA = (async () => {
    await a.query('begin');
    return tentar(a, ADMIN_SQL, [id]);
  })();
  await dormir(ESPERA_MS);
  await b.query('commit');
  const rA = await pA;
  await a.query('rollback').catch(() => {});
  return { perdedor: rA, chaveEsperada: CHAVE_ADMIN, vencedor: tipo };
}

async function executar(tipo, ordem) {
  const id = await criarUsuario();
  try {
    const rodada = ordem === 'admin_primeiro' ? await rodadaAdminPrimeiro(tipo, id) : await rodadaPerfilPrimeiro(tipo, id);
    const { perdedor, chaveEsperada } = rodada;
    if (!perdedor.err) return { erro: 'nenhum comando falhou (as duas linhas podem ter coexistido)', id };
    if (perdedor.err.code === '40P01') return { erro: 'deadlock', id };
    if (perdedor.err.message !== chaveEsperada) {
      return { erro: `chave ${perdedor.err.message} em vez de ${chaveEsperada}`, id };
    }
    const n = await linhasDe(id);
    const total = n.admin + n.cliente + n.profissional;
    if (total !== 1) return { erro: `linhas coexistindo: ${JSON.stringify(n)}`, id };
    return { ok: true, id };
  } finally {
    await limpar(id);
  }
}

for (const tipo of ['cliente', 'profissional']) {
  for (const ordem of ['admin_primeiro', 'perfil_primeiro']) {
    test(`T-10: ${RODADAS} rodadas, admin x ${tipo}, ordem ${ordem}: nunca coexistem, um falha com a chave, sem deadlock`, { timeout: 900000 }, async () => {
      const falhas = [];
      let ok = 0;
      for (let i = 0; i < RODADAS; i++) {
        const r = await executar(tipo, ordem);
        if (r.ok) ok++;
        else falhas.push(`rodada ${i + 1}: ${r.erro}`);
      }
      console.log(`# T-10 admin x ${tipo} (${ordem}): ${ok}/${RODADAS} rodadas conformes`);
      assert.deepEqual(falhas, [], `rodadas fora do esperado:\n${falhas.join('\n')}`);
      assert.equal(ok, RODADAS);
    });
  }
}
