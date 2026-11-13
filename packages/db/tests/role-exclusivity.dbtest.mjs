// H-017 (Issue #30) | Testes de banco da exclusividade de papeis (101-DESENHO-H017.md, §7: T-01 a T-09,
// T-12 a T-15, T-17, T-18). Banco de desenvolvimento. Cada teste roda em transacao e e desfeito (rollback).
// Valores sinteticos (@example.test; UUIDs gerados). Sem rede externa. A corrida (T-10) fica em
// role-exclusivity-concorrencia.dbtest.mjs; o estatico da migracao (T-16) e o unitario (T-11) ficam fora deste banco.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect } from '../scripts/lib/env.mjs';

const MIGRATION = new URL('../../../supabase/migrations/20261112200000_identity_create_role_exclusivity.sql', import.meta.url);
const DOWN = new URL('../../../supabase/rollbacks/20261112200000_identity_create_role_exclusivity.down.sql', import.meta.url);

let client;

before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

const hex64 = () => randomBytes(32).toString('hex');

async function tx(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

/** Executa um comando que deve falhar; usa savepoint para manter a transacao viva. Devolve o erro ou null. */
async function falha(sql, params = []) {
  await client.query('savepoint sp');
  try {
    await client.query(sql, params);
  } catch (err) {
    await client.query('rollback to savepoint sp');
    return err;
  }
  await client.query('release savepoint sp');
  return null;
}

const esperaRegra = (err, chave) => {
  assert.ok(err, `esperado erro ${chave}, veio sucesso`);
  assert.equal(err.code, '23514');
  assert.equal(err.message, chave);
};

async function usuario(extra = {}) {
  const id = randomUUID();
  const email = extra.email ?? `${randomUUID()}@example.test`;
  const authId = randomUUID();
  await client.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at, email_hmac)
     values ($1, $2, $3, 'ativo', now(), now(), $4)`,
    [id, email, authId, extra.hmac ?? null],
  );
  return { id, email, authId };
}

async function clientePerfil(userId) {
  await client.query('insert into app.customer_profile (user_id, created_at) values ($1, now())', [userId]);
}

async function profissionalPerfil(userId) {
  await client.query(
    `insert into app.professional_profile (user_id, created_at, updated_at) values ($1, now(), now())`,
    [userId],
  );
}

/** Admin com status dado (molde de admin-staff.dbtest.mjs). */
async function adminStaff(userId, status = 'ativo') {
  await client.query(
    `insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at, created_at, status_changed_at)
     values ($1, $2, 'bootstrap', null, $3, now(), now())`,
    [userId, status, status === 'ativo' ? new Date() : null],
  );
}

/** Schema de fixture com pedido e aceite; o gatilho de aceite e anexado como a Onda 3 faria (101 §3.3, item 7). */
async function fixtureAceite() {
  const s = `h017_fx_${randomUUID().replace(/-/g, '')}`;
  await client.query(`create schema ${s}`);
  await client.query(
    `create table ${s}.request (id uuid primary key, customer_user_id uuid, state text not null, vagas int not null)`,
  );
  await client.query(
    `create table ${s}.acceptance (id uuid primary key, request_id uuid not null references ${s}.request (id),
                                    professional_id uuid not null)`,
  );
  await client.query(
    `create trigger acceptance_nao_proprio_pedido before insert or update of request_id, professional_id
       on ${s}.acceptance for each row execute function private.acceptance_not_own_request('${s}.request')`,
  );
  return s;
}

async function pedido(s, customerId, state = 'aberto') {
  const id = randomUUID();
  await client.query(`insert into ${s}.request (id, customer_user_id, state, vagas) values ($1, $2, $3, 1)`, [
    id,
    customerId,
    state,
  ]);
  return id;
}

async function contagemAceites(s) {
  return Number((await client.query(`select count(*)::int as n from ${s}.acceptance`)).rows[0].n);
}

// ---------- T-01: identidade unica (CA-01) ----------
test('T-01: auth_user_id, e-mail e email_hmac sao unicos; auth_user_id e imutavel (CA-01, decisao 143)', async () => {
  await tx(async () => {
    const a = await usuario();
    const authId = a.authId;
    const b = await falha(
      `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
       values ($1, $2, $3, 'ativo', now(), now())`,
      [randomUUID(), `${randomUUID()}@example.test`, authId],
    );
    assert.equal(b?.code, '23505', 'auth_user_id repetido deve violar unicidade');

    const hmac = hex64();
    await usuario({ hmac });
    const c = await falha(
      `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at, email_hmac)
       values ($1, $2, $3, 'ativo', now(), now(), $4)`,
      [randomUUID(), `${randomUUID()}@example.test`, randomUUID(), hmac],
    );
    assert.equal(c?.code, '23505', 'email_hmac repetido deve violar unicidade');

    const d = await falha(
      `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
       values ($1, $2, $3, 'ativo', now(), now())`,
      [randomUUID(), a.email, randomUUID()],
    );
    assert.equal(d?.code, '23505', 'e-mail repetido deve violar unicidade');

    const e = await falha(`update app.app_user set auth_user_id = $2 where id = $1`, [a.id, randomUUID()]);
    esperaRegra(e, 'app_user_identidade_imutavel');
  });
});

// ---------- T-02: cliente + profissional no mesmo usuario (CA-02, decisao 136) ----------
test('T-02: mesmo usuario com customer_profile e professional_profile grava os dois', async () => {
  await tx(async () => {
    const u = await usuario();
    await clientePerfil(u.id);
    await profissionalPerfil(u.id);
    const n = await client.query(
      `select (select count(*)::int from app.customer_profile where user_id = $1) as c,
              (select count(*)::int from app.professional_profile where user_id = $1) as p`,
      [u.id],
    );
    assert.deepEqual(n.rows[0], { c: 1, p: 1 });
  });
});

// ---------- T-03: aceite no proprio pedido e recusado, em qualquer estado (CA-03, decisao 142) ----------
test('T-03: aceite do proprio cliente no pedido e recusado em todo estado, por INSERT e por UPDATE', async () => {
  for (const state of ['aberto', 'selecionado', 'cancelado', 'encerrado']) {
    await tx(async () => {
      const s = await fixtureAceite();
      const u = await usuario();
      const r = await pedido(s, u.id, state);
      const vagasAntes = Number((await client.query(`select vagas from ${s}.request where id = $1`, [r])).rows[0].vagas);
      const err = await falha(`insert into ${s}.acceptance (id, request_id, professional_id) values ($1, $2, $3)`, [
        randomUUID(),
        r,
        u.id,
      ]);
      esperaRegra(err, 'aceite_proprio_pedido');
      assert.equal(await contagemAceites(s), 0, `estado ${state}: nenhuma linha de aceite`);

      // Aceite de outra pessoa, depois troca do profissional para o proprio cliente (UPDATE).
      const outro = await usuario();
      const aid = randomUUID();
      await client.query(`insert into ${s}.acceptance (id, request_id, professional_id) values ($1, $2, $3)`, [
        aid,
        r,
        outro.id,
      ]);
      const upd = await falha(`update ${s}.acceptance set professional_id = $2 where id = $1`, [aid, u.id]);
      esperaRegra(upd, 'aceite_proprio_pedido');
      const linha = (await client.query(`select professional_id from ${s}.acceptance where id = $1`, [aid])).rows[0];
      assert.equal(linha.professional_id, outro.id, `estado ${state}: UPDATE recusado, linha inalterada`);
      const vagasDepois = Number((await client.query(`select vagas from ${s}.request where id = $1`, [r])).rows[0].vagas);
      assert.equal(vagasDepois, vagasAntes, `estado ${state}: vagas inalteradas`);
    });
  }
});

// ---------- T-04: aceite de outra pessoa e aceito (CA-04) ----------
test('T-04: aceite de U2 em pedido de U1 e aceito', async () => {
  await tx(async () => {
    const s = await fixtureAceite();
    const u1 = await usuario();
    const u2 = await usuario();
    const r = await pedido(s, u1.id);
    await client.query(`insert into ${s}.acceptance (id, request_id, professional_id) values ($1, $2, $3)`, [
      randomUUID(),
      r,
      u2.id,
    ]);
    assert.equal(await contagemAceites(s), 1);
  });
});

// ---------- T-05: pessoa com os dois perfis aceita pedido de terceiro (CA-05) ----------
test('T-05: U com os dois perfis aceita pedido de U3 (cliente e profissional no mesmo usuario)', async () => {
  await tx(async () => {
    const s = await fixtureAceite();
    const u = await usuario();
    const u3 = await usuario();
    await clientePerfil(u.id);
    await profissionalPerfil(u.id);
    const r = await pedido(s, u3.id);
    const err = await falha(`insert into ${s}.acceptance (id, request_id, professional_id) values ($1, $2, $3)`, [
      randomUUID(),
      r,
      u.id,
    ]);
    assert.equal(err, null, 'aceite de terceiro deve passar');
    assert.equal(await contagemAceites(s), 1);
  });
});

// ---------- T-06: publicar pedido com os dois perfis nao e tocado pela regra (CA-06) ----------
test('T-06: U com os dois perfis publica pedido como cliente; a regra nao atua na publicacao', async () => {
  await tx(async () => {
    const s = await fixtureAceite();
    const u = await usuario();
    await clientePerfil(u.id);
    await profissionalPerfil(u.id);
    const r = await falha(`insert into ${s}.request (id, customer_user_id, state, vagas) values ($1, $2, 'aberto', 1)`, [
      randomUUID(),
      u.id,
    ]);
    assert.equal(r, null, 'publicacao como cliente deve passar');
  });
});

// ---------- T-07: admin nao vira cliente, em nenhum status (CA-07, decisao 137) ----------
test('T-07: admin_staff em qualquer status recusa customer_profile com papel_exclusivo_admin_cliente', async () => {
  for (const status of ['pendente_mfa', 'ativo', 'desativado']) {
    await tx(async () => {
      const u = await usuario();
      await adminStaff(u.id, status);
      const err = await falha('insert into app.customer_profile (user_id, created_at) values ($1, now())', [u.id]);
      esperaRegra(err, 'papel_exclusivo_admin_cliente');
      const n = await client.query('select count(*)::int as n from app.customer_profile where user_id = $1', [u.id]);
      assert.equal(n.rows[0].n, 0, `status ${status}: nenhuma linha de cliente`);
    });
  }
});

// ---------- T-08: admin nao vira profissional (CA-08, decisao 137) ----------
test('T-08: admin_staff em qualquer status recusa professional_profile com papel_exclusivo_admin_profissional', async () => {
  for (const status of ['pendente_mfa', 'ativo', 'desativado']) {
    await tx(async () => {
      const u = await usuario();
      await adminStaff(u.id, status);
      const err = await falha(
        'insert into app.professional_profile (user_id, created_at, updated_at) values ($1, now(), now())',
        [u.id],
      );
      esperaRegra(err, 'papel_exclusivo_admin_profissional');
    });
  }
});

// ---------- T-09: perfil antes do admin e recusado; convite nao conta como ativado (CA-09) ----------
test('T-09: customer_profile ou professional_profile existente recusa admin_staff (papel_exclusivo_perfil_admin)', async () => {
  await tx(async () => {
    const c = await usuario();
    await clientePerfil(c.id);
    esperaRegra(
      await falha(`insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at, created_at, status_changed_at)
                   values ($1, 'pendente_mfa', 'bootstrap', null, null, now(), now())`, [c.id]),
      'papel_exclusivo_perfil_admin',
    );
  });
  await tx(async () => {
    const p = await usuario();
    await profissionalPerfil(p.id);
    esperaRegra(
      await falha(`insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at, created_at, status_changed_at)
                   values ($1, 'pendente_mfa', 'bootstrap', null, null, now(), now())`, [p.id]),
      'papel_exclusivo_perfil_admin',
    );
  });
  await tx(async () => {
    // Caminho do convite (passo 1 de H-102): usuario que ganhou perfil entre a emissao e a ativacao.
    const u = await usuario();
    await clientePerfil(u.id);
    const token = hex64();
    await client.query(
      `insert into app.admin_invite (id, kind, email_hmac, email_enc, token_hash, role_codes, invited_by, state, attempts,
                                     created_at, expires_at)
       values ($1, 'ativacao', $2, decode('00', 'hex'), $3, array['superadmin'], null, 'emitido', 0, now(),
               now() + interval '72 hours')`,
      [randomUUID(), hex64(), token],
    );
    const err = await falha('select private.admin_invite_mark_waiting($1, $2, now())', [token, u.id]);
    esperaRegra(err, 'papel_exclusivo_perfil_admin');
    const estado = (await client.query('select state from app.admin_invite where token_hash = $1', [token])).rows[0];
    assert.equal(estado.state, 'emitido', 'convite continua emitido: nao foi contado como ativado');
    const staff = await client.query('select count(*)::int as n from app.admin_staff where user_id = $1', [u.id]);
    assert.equal(staff.rows[0].n, 0);
  });
});

// ---------- T-12: anexo obrigatorio do gatilho de aceite (condicional) ----------
test('T-12: se app.acceptance existe, o gatilho acceptance_nao_proprio_pedido esta ligado a private.acceptance_not_own_request', async (t) => {
  const existe = (await client.query("select to_regclass('app.acceptance') is not null as x")).rows[0].x;
  if (!existe) return t.skip('adiado: tabela ainda inexistente (Ondas 2 e 3; anexo pela H-069)');
  const r = await client.query(
    `select count(*)::int as n from pg_trigger g join pg_proc p on p.oid = g.tgfoid
      where g.tgrelid = 'app.acceptance'::regclass and g.tgname = 'acceptance_nao_proprio_pedido'
        and p.proname = 'acceptance_not_own_request' and not g.tgisinternal`,
  );
  assert.equal(r.rows[0].n, 1, 'gatilho de aceite ausente em app.acceptance');
});

// ---------- T-13: verificacao previa (CA-12, decisao 140) e retroalimentacao ----------
const bloco = (sql, inicio, fim) => {
  const i = sql.indexOf(inicio);
  const j = sql.indexOf(fim, i);
  assert.ok(i >= 0 && j > i, `trecho nao encontrado: ${inicio}`);
  return sql.slice(i, j + fim.length);
};
const migracao = readFileSync(MIGRATION, 'utf8');
const SQL_VERIFICACAO = bloco(migracao, 'do $$', '$$;');
const SQL_RETRO = bloco(migracao, 'insert into app.customer_profile (user_id, created_at)', 'on conflict (user_id) do nothing;');

test('T-13: verificacao previa aborta com lista de ids (sem e-mail) quando admin tem perfil profissional', async () => {
  await tx(async () => {
    // Desliga so os gatilhos de exclusividade para plantar a violacao que a migracao teria herdado.
    await client.query('alter table app.professional_profile disable trigger role_excl_profissional');
    await client.query('alter table app.admin_staff disable trigger role_excl_admin');
    const u = await usuario();
    await adminStaff(u.id, 'ativo');
    await profissionalPerfil(u.id);
    const err = await falha(SQL_VERIFICACAO);
    assert.ok(err, 'a verificacao deve abortar');
    assert.equal(err.message, 'h017_violacao_existente');
    assert.ok(err.detail?.includes(u.id), 'a lista traz o id opaco');
    assert.ok(!err.detail?.includes(u.email), 'a lista nao traz e-mail');
  });
});

test('T-13: sem violacao a verificacao passa e a retroalimentacao classifica cada caso', async () => {
  await tx(async () => {
    assert.equal(await falha(SQL_VERIFICACAO), null, 'base de desenvolvimento sem violacao passa');
    const cli = await usuario();
    const profSemSessao = await usuario();
    await profissionalPerfil(profSemSessao.id);
    const profComLogin = await usuario();
    await profissionalPerfil(profComLogin.id);
    await client.query(
      `insert into app.app_session (id, user_id, stage, secret_hash, challenge_id, purpose, created_at, expires_at,
                                    absolute_expires_at, recent_auth_at)
       values ($1, $2, 'ativa', $3, $4, 'login', now(), now() + interval '1 hour', now() + interval '1 hour', now())`,
      [randomUUID(), profComLogin.id, hex64(), randomUUID()],
    );
    const adm = await usuario();
    await adminStaff(adm.id, 'ativo');

    await client.query(SQL_RETRO);
    const tem = async (id) =>
      (await client.query('select count(*)::int as n from app.customer_profile where user_id = $1', [id])).rows[0].n;
    assert.equal(await tem(cli.id), 1, 'so cliente: recebe perfil de cliente');
    assert.equal(await tem(profSemSessao.id), 0, 'so profissional sem sessao de cliente: nao recebe');
    assert.equal(await tem(profComLogin.id), 1, 'profissional com sessao de login: recebe');
    assert.equal(await tem(adm.id), 0, 'admin: nao recebe');
  });
});

// ---------- T-14: customer_profile_ensure (ok, idempotente, reservado; tempo proximo) ----------
test('T-14: customer_profile_ensure cria uma vez, e reservado para admin sem gravar nada', async () => {
  await tx(async () => {
    const u = await usuario();
    const a = (await client.query('select out_status from private.customer_profile_ensure($1, now())', [u.id])).rows[0];
    assert.equal(a.out_status, 'ok');
    const b = (await client.query('select out_status from private.customer_profile_ensure($1, now())', [u.id])).rows[0];
    assert.equal(b.out_status, 'ok');
    const n = (await client.query('select count(*)::int as n from app.customer_profile where user_id = $1', [u.id]))
      .rows[0].n;
    assert.equal(n, 1, 'repetido nao duplica');

    const adm = await usuario();
    await adminStaff(adm.id, 'ativo');
    const c = (await client.query('select out_status from private.customer_profile_ensure($1, now())', [adm.id])).rows[0];
    assert.equal(c.out_status, 'reservado');
    const m = (await client.query('select count(*)::int as n from app.customer_profile where user_id = $1', [adm.id]))
      .rows[0].n;
    assert.equal(m, 0, 'admin: nenhuma linha gravada');
  });
});

test('T-14: tempo de resposta do caminho admin e do caminho cliente (medido, sem tolerancia de H-097)', async () => {
  await tx(async () => {
    const N = 30;
    const clientes = [];
    const admins = [];
    for (let i = 0; i < N; i++) clientes.push((await usuario()).id);
    for (let i = 0; i < N; i++) {
      const a = await usuario();
      await adminStaff(a.id, 'ativo');
      admins.push(a.id);
    }
    const medir = async (ids) => {
      const tempos = [];
      for (const id of ids) {
        const t0 = process.hrtime.bigint();
        await client.query('select * from private.customer_profile_ensure($1, now())', [id]);
        tempos.push(Number(process.hrtime.bigint() - t0) / 1e6);
      }
      tempos.sort((x, y) => x - y);
      return tempos[Math.floor(tempos.length / 2)];
    };
    const mediaCliente = await medir(clientes);
    const mediaAdmin = await medir(admins);
    const razao = mediaAdmin / mediaCliente;
    console.log(`# T-14 tempo mediano cliente=${mediaCliente.toFixed(2)}ms admin=${mediaAdmin.toFixed(2)}ms razao=${razao.toFixed(2)}`);
    // Sanidade: uma consulta por chave a mais nao deve ser ordem de grandeza. Limite folgado, a tolerancia real e a da H-097.
    assert.ok(razao < 5, `razao ${razao.toFixed(2)} acima do limite de sanidade`);
  });
});

// ---------- T-15: limitacao aceita de duas contas da mesma pessoa (CA-13, decisao 138) ----------
test('T-15: duas contas com e-mails diferentes podem aceitar o pedido uma da outra (limitacao aceita)', async () => {
  await tx(async () => {
    const s = await fixtureAceite();
    const conta1 = await usuario({ email: `pessoa.a.${randomUUID()}@example.test` });
    const conta2 = await usuario({ email: `pessoa.b.${randomUUID()}@example.test` });
    await clientePerfil(conta1.id);
    const r = await pedido(s, conta1.id);
    const err = await falha(`insert into ${s}.acceptance (id, request_id, professional_id) values ($1, $2, $3)`, [
      randomUUID(),
      r,
      conta2.id,
    ]);
    assert.equal(err, null, 'limitacao aceita: duas contas distintas nao sao bloqueadas');
    console.log('# T-15 limitacao aceita (14-BACKLOG H-017): dois e-mails = duas contas');
  });
});

// ---------- T-17: isolamento diferente de read committed e recusado (CA-10) ----------
test('T-17: insert de admin_staff e de perfil em repeatable read levanta papel_isolamento_nao_suportado', async () => {
  await tx(async () => {
    await client.query('set transaction isolation level repeatable read');
    const u = await usuario();
    const a = await falha(
      `insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at, created_at, status_changed_at)
       values ($1, 'pendente_mfa', 'bootstrap', null, null, now(), now())`,
      [u.id],
    );
    esperaRegra(a, 'papel_isolamento_nao_suportado');
    const c = await falha('insert into app.customer_profile (user_id, created_at) values ($1, now())', [u.id]);
    esperaRegra(c, 'papel_isolamento_nao_suportado');
  });
});

// ---------- T-18: desfazer (reversibilidade) ----------
const SQL_DOWN = readFileSync(DOWN, 'utf8')
  .split(/\r?\n/)
  .filter((l) => !/^\s*(begin|commit)\s*;\s*$/i.test(l))
  .join('\n');
const existeCliente = async () =>
  (await client.query("select to_regclass('app.customer_profile') is not null as x")).rows[0].x;

test('T-18: desfazer com customer_profile vazio funciona e e idempotente (roda duas vezes)', async () => {
  await tx(async () => {
    await client.query('delete from app.customer_profile');
    const vazio = (await client.query('select count(*)::int as n from app.customer_profile')).rows[0].n;
    assert.equal(vazio, 0, 'precondicao: tabela vazia');
    await client.query(SQL_DOWN);
    assert.equal(await existeCliente(), false, 'tabela removida');
    await client.query(SQL_DOWN);
    assert.equal(await existeCliente(), false, 'segunda execucao nao falha');
  });
});

test('T-18: desfazer com linha em customer_profile aborta com rollback_recusado_com_dados', async () => {
  await tx(async () => {
    const u = await usuario();
    await clientePerfil(u.id);
    const err = await falha(SQL_DOWN);
    assert.ok(err, 'deve abortar');
    assert.equal(err.message, 'rollback_recusado_com_dados');
    assert.equal(await existeCliente(), true, 'nada foi removido');
  });
});
