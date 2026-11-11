// H-015 | Testes de banco de anti-enumeracao e limites (T-H015-20, 21, 22, 23, 24, 25, 26, 27, 28,
// 29, 30, 31, 33). Desenho: docs/factory/50-DESENHO-H015.md §6. Banco de desenvolvimento; cada teste
// numa transacao desfeita (rollback). Sem rede; sem envio. Valores sinteticos (@example.test).
// Pendente nesta rodada: T-H015-32 (concorrencia, exige conexoes com commit) e T-H015-34 (regressao
// coberta pela suite completa de db:test).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { connect } from '../scripts/lib/env.mjs';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

const NOW_MS = Date.parse('2099-01-01T12:00:00.000Z');
const at = (seconds) => new Date(NOW_MS + seconds * 1000);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const EMAIL_HASH = (email) => sha(`email:${email}`);
const HOUR = 3600;
const DAY = 86_400;

// Chaves como o TypeScript as monta (50 §1.1). Aqui so o formato importa: 64 hex, dominios distintos.
const K = {
  ip: (ip) => sha(`rl1|pedido|ip|${ip}`),
  ipCodigo: (ip) => sha(`rl1|codigo|ip|${ip}`),
  global: sha('rl1|pedido|global_h|*'),
  globalDia: sha('rl1|pedido|global_d|*'),
  erro: (email) => sha(`rl1|erro_codigo|email|${email}`),
};

async function tx(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

async function pedido({ email, ip, seconds = 0, id = randomUUID() }) {
  const { rows } = await client.query(
    `select * from private.auth_challenge_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      id,
      EMAIL_HASH(email),
      'login',
      sha(`t:${id}`),
      sha(`c:${id}`),
      Buffer.from('blob-email'),
      Buffer.from('blob-segredos'),
      null,
      null,
      at(seconds),
      K.ip(ip),
      K.global,
      K.globalDia,
      20,
      30,
      80,
    ],
  );
  return { id, ...rows[0] };
}

/** Tentativa de codigo. Sem desafio (challengeId null) so conta erro; o codigo "errado" nao confere. */
async function codigo({ email, ip, seconds = 0, challengeId = null, code = sha('errado') }) {
  const { rows } = await client.query(
    `select * from private.auth_code_attempt($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      challengeId,
      EMAIL_HASH(email),
      'login',
      code,
      5,
      at(seconds),
      K.ipCodigo(ip),
      K.erro(email),
      50,
      15,
    ],
  );
  return rows[0];
}

async function soma(key) {
  const { rows } = await client.query(
    'select coalesce(sum(count), 0)::int as s from ops.rate_counter where key_hmac = $1',
    [key],
  );
  return rows[0].s;
}

async function desafios(email) {
  const { rows } = await client.query(
    'select count(*)::int as n from app.auth_challenge where email_hash = $1',
    [EMAIL_HASH(email)],
  );
  return rows[0].n;
}

async function bloqueio(email) {
  const { rows } = await client.query('select * from ops.code_lock where key_hmac = $1', [
    K.erro(email),
  ]);
  return rows[0] ?? null;
}

/** Erros sem desafio ativo ate o bloqueio; devolve o numero da tentativa que bloqueou (ou null). */
async function errosAte(email, ip, seconds, quantidade) {
  for (let i = 1; i <= quantidade; i += 1) {
    const r = await codigo({ email, ip, seconds });
    if (r.out_resultado === 'bloqueado_codigo') return i;
  }
  return null;
}

test('T-H015-20 permissoes: so app_system acessa ops.code_lock e as funcoes novas', () =>
  tx(async () => {
    const rel = await client.query(
      `select c.relrowsecurity, c.relforcerowsecurity from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'ops' and c.relname = 'code_lock'`,
    );
    assert.equal(rel.rows[0].relrowsecurity, true, 'RLS habilitada');
    assert.equal(rel.rows[0].relforcerowsecurity, true, 'RLS forcada');

    // Quem tem privilegio, sem citar papeis: o conjunto de concessoes, menos o dono, deve ser so
    // app_system. Isso cobre PUBLIC, anon, authenticated e o papel de servico de uma vez.
    const quem = (rows) => [...new Set(rows.map((r) => r.nome))].sort();
    const tabela = await client.query(
      `select case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as nome,
              pg_get_userbyid(c.relowner) as dono
         from pg_class c, aclexplode(c.relacl) a
        where c.oid = 'ops.code_lock'::regclass`,
    );
    const donoTabela = (
      await client.query(
        `select pg_get_userbyid(c.relowner) as dono from pg_class c where c.oid = 'ops.code_lock'::regclass`,
      )
    ).rows[0].dono;
    // Papel de backup le todas as tabelas de dominio por desenho (H-010, T-BK-09); so le.
    assert.deepEqual(
      quem(tabela.rows.filter((r) => r.nome !== donoTabela && r.nome !== 'app_backup_reader')),
      ['app_system'],
      'so app_system escreve em ops.code_lock',
    );
    const leitorBackup = await client.query(
      `select has_table_privilege('app_backup_reader', 'ops.code_lock',
                                  'INSERT,UPDATE,DELETE') as escreve`,
    );
    assert.equal(leitorBackup.rows[0].escreve, false, 'papel de backup nao escreve');

    const fns = [
      'private.auth_code_attempt(uuid,text,text,text,integer,timestamptz,text,text,integer,integer)',
      'private.auth_challenge_request(uuid,text,text,text,text,bytea,bytea,uuid,text,timestamptz,text,text,text,integer,integer,integer,uuid)',
      'private.rl_check(text,integer,integer,integer,timestamptz)',
      'private.rl_hit(text,integer,timestamptz)',
      'private.rate_purge(timestamptz)',
    ];
    for (const fn of fns) {
      const dono = (
        await client.query(
          `select pg_get_userbyid(p.proowner) as dono from pg_proc p where p.oid = $1::regprocedure`,
          [fn],
        )
      ).rows[0].dono;
      const execs = await client.query(
        `select case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as nome
           from pg_proc p, aclexplode(p.proacl) a
          where p.oid = $1::regprocedure`,
        [fn],
      );
      assert.deepEqual(
        quem(execs.rows.filter((r) => r.nome !== dono)),
        ['app_system'],
        `so app_system executa ${fn.split('(')[0]}`,
      );
    }

    const sys = await client.query(
      `select has_table_privilege('app_system', 'ops.code_lock', 'SELECT,INSERT,UPDATE,DELETE') as t,
              has_function_privilege('app_system', $1, 'EXECUTE') as f`,
      [fns[0]],
    );
    assert.equal(sys.rows[0].t, true);
    assert.equal(sys.rows[0].f, true);
  }));

test('T-H015-21 IP: 20 passam, o 21o barra com retry 3600; barrado nao incrementa; balde vira', () =>
  tx(async () => {
    const ip = '203.0.113.10';
    for (let i = 0; i < 20; i += 1) {
      const r = await pedido({ email: `ip${i}@example.test`, ip, seconds: 0 });
      assert.equal(r.out_resultado, 'criado', `pedido ${i + 1}`);
    }
    const barrado = await pedido({ email: 'ip20@example.test', ip, seconds: 0 });
    assert.equal(barrado.out_resultado, 'limite');
    assert.equal(barrado.out_motivo, 'ip');
    assert.equal(barrado.out_retry_after, HOUR);
    assert.equal(await soma(K.ip(ip)), 20, 'barrado nao incrementa');
    assert.equal(await desafios('ip20@example.test'), 0, 'barrado nao cria desafio');

    const meio = await pedido({ email: 'ip21@example.test', ip, seconds: 1200 });
    assert.equal(meio.out_resultado, 'limite');
    assert.equal(meio.out_retry_after, 2400, 'retry aponta para a saida do balde de 12:00');

    const depois = await pedido({ email: 'ip22@example.test', ip, seconds: HOUR });
    assert.equal(depois.out_resultado, 'criado', 'com o balde de 12:00 fora da janela');
  }));

test('T-H015-22 NAT: 10 e-mails distintos x 2 pedidos no mesmo IP nao sao barrados', () =>
  tx(async () => {
    const ip = '198.51.100.5';
    for (let i = 0; i < 10; i += 1) {
      const email = `nat${i}@example.test`;
      const a = await pedido({ email, ip, seconds: 0 });
      const b = await pedido({ email, ip, seconds: 61 });
      assert.equal(a.out_resultado, 'criado');
      assert.equal(b.out_resultado, 'criado');
    }
    assert.equal(await soma(K.ip(ip)), 20);
  }));

test('T-H015-23 global: 30/h, 80/dia (zera a meia-noite UTC)', () =>
  tx(async () => {
    const novoIp = (prefixo, i) => `${prefixo}.${Math.floor(i / 250)}.${i % 250}`;
    for (let i = 0; i < 30; i += 1) {
      const r = await pedido({ email: `g1-${i}@example.test`, ip: novoIp('10.1', i), seconds: 0 });
      assert.equal(r.out_resultado, 'criado', `hora 12 #${i + 1}`);
    }
    const hora = await pedido({ email: 'g31@example.test', ip: '10.2.0.1', seconds: 0 });
    assert.equal(hora.out_resultado, 'limite');
    assert.equal(hora.out_motivo, 'global_h', 'IP novo barrado pelo teto horario');
    assert.equal(hora.out_retry_after, HOUR);

    for (let i = 0; i < 30; i += 1) {
      const r = await pedido({ email: `g2-${i}@example.test`, ip: novoIp('10.3', i), seconds: HOUR });
      assert.equal(r.out_resultado, 'criado', `hora 13 #${i + 1}`);
    }
    for (let i = 0; i < 20; i += 1) {
      const r = await pedido({
        email: `g3-${i}@example.test`,
        ip: novoIp('10.4', i),
        seconds: 2 * HOUR,
      });
      assert.equal(r.out_resultado, 'criado', `hora 14 #${i + 1}`);
    }
    const dia = await pedido({ email: 'g81@example.test', ip: '10.5.0.1', seconds: 2 * HOUR });
    assert.equal(dia.out_resultado, 'limite');
    assert.equal(dia.out_motivo, 'global_d');
    assert.equal(dia.out_retry_after, 10 * HOUR, 'ate 00:00 UTC');
    assert.equal(await soma(K.globalDia), 80);

    const virada = await pedido({
      email: 'g82@example.test',
      ip: '10.5.0.2',
      seconds: 12 * HOUR + 1,
    });
    assert.equal(virada.out_resultado, 'criado', 'dia UTC novo zera o teto diario');
  }));

test('T-H015-24 pedido barrado pelo e-mail nao incrementa IP nem global', () =>
  tx(async () => {
    const email = 'dup@example.test';
    const a = await pedido({ email, ip: '192.0.2.1', seconds: 0 });
    assert.equal(a.out_resultado, 'criado');
    const b = await pedido({ email, ip: '192.0.2.2', seconds: 10 });
    assert.equal(b.out_resultado, 'espera');
    assert.equal(b.out_motivo, 'email');
    assert.equal(await soma(K.ip('192.0.2.2')), 0, 'IP do barrado nao conta');
    assert.equal(await soma(K.ip('192.0.2.1')), 1);
    assert.equal(await soma(K.global), 1, 'global conta so o aceito');
    assert.equal(await desafios(email), 1);
  }));

test('T-H015-25 contadores e bloqueios guardam so HMAC', () =>
  tx(async () => {
    const email = 'claro.teste@example.test';
    const ip = '203.0.113.99';
    await pedido({ email, ip, seconds: 0 });
    await errosAte(email, ip, 0, 15);
    const linhas = await client.query(
      `select to_jsonb(r)::text as j from ops.rate_counter r where r.key_hmac = any($1)
       union all
       select to_jsonb(k)::text from ops.code_lock k where k.key_hmac = any($1)`,
      [[K.ip(ip), K.ipCodigo(ip), K.global, K.erro(email)]],
    );
    assert.ok(linhas.rowCount > 0);
    for (const { j } of linhas.rows) {
      assert.equal(j.includes(email), false, 'e-mail nao aparece em claro');
      assert.equal(j.includes(ip), false, 'IP nao aparece em claro');
    }
    const chaves = await client.query(
      `select key_hmac from ops.rate_counter where key_hmac = any($1)`,
      [[K.ip(ip), K.ipCodigo(ip), K.global, K.erro(email)]],
    );
    for (const { key_hmac: k } of chaves.rows) assert.match(k, /^[0-9a-f]{64}$/);
  }));

test('T-H015-26 codigo: 14 erros nao bloqueiam; o 15o e normal; o 16o bloqueia; certo na 16a nao consome', () =>
  tx(async () => {
    const email = 'codigo.bloq@example.test';
    const ip = '192.0.2.20';

    const c0 = await pedido({ email, ip, seconds: 0 });
    const ok = await codigo({ email, ip, seconds: 1, challengeId: c0.id, code: sha(`c:${c0.id}`) });
    assert.equal(ok.out_resultado, 'ok', 'codigo certo antes do bloqueio');

    for (let i = 1; i <= 14; i += 1) {
      const r = await codigo({ email, ip, seconds: 2 });
      assert.notEqual(r.out_resultado, 'bloqueado_codigo', `erro ${i} nao bloqueia`);
    }
    const quinze = await codigo({ email, ip, seconds: 2 });
    assert.notEqual(quinze.out_resultado, 'bloqueado_codigo', 'o 15o devolve resposta normal');
    const dezesseis = await codigo({ email, ip, seconds: 2 });
    assert.equal(dezesseis.out_resultado, 'bloqueado_codigo');
    assert.equal(dezesseis.out_retry_after, 900);

    const novo = await pedido({ email, ip: '192.0.2.21', seconds: 61 });
    assert.equal(novo.out_resultado, 'criado', 'o pedido de novo desafio segue aberto');
    const certo = await codigo({
      email,
      ip,
      seconds: 62,
      challengeId: novo.id,
      code: sha(`c:${novo.id}`),
    });
    assert.equal(certo.out_resultado, 'bloqueado_codigo', 'codigo certo nao e comparado');
    const { rows } = await client.query('select consumed_at from app.auth_challenge where id = $1', [
      novo.id,
    ]);
    assert.equal(rows[0].consumed_at, null, 'desafio nao consumido');
  }));

test('T-H015-27 uniformidade: com ou sem desafio ativo, o bloqueio cai na mesma tentativa e retry', () =>
  tx(async () => {
    const comDesafio = 'com.desafio@example.test';
    const semDesafio = 'sem.desafio@example.test';
    const d = await pedido({ email: comDesafio, ip: '192.0.2.30', seconds: 0 });

    let primeiroComDesafio = null;
    for (let i = 1; i <= 20 && primeiroComDesafio === null; i += 1) {
      const r = await codigo({
        email: comDesafio,
        ip: '192.0.2.31',
        seconds: 1,
        challengeId: d.id,
        code: sha('errado'),
      });
      if (r.out_resultado === 'bloqueado_codigo') primeiroComDesafio = { n: i, retry: r.out_retry_after };
    }
    const n = await errosAte(semDesafio, '192.0.2.32', 1, 20);
    assert.ok(primeiroComDesafio, 'com desafio tambem bloqueia');
    assert.equal(n, primeiroComDesafio.n, 'mesma tentativa do bloqueio');
    const retrySem = await codigo({ email: semDesafio, ip: '192.0.2.32', seconds: 1 });
    assert.equal(retrySem.out_resultado, 'bloqueado_codigo');
    assert.equal(retrySem.out_retry_after, primeiroComDesafio.retry, 'mesmo Retry-After');
  }));

test('T-H015-28 progressao: 15 min, depois 1 h, depois 24 h; zera apos 7 dias sem erro', () =>
  tx(async () => {
    const email = 'progressao@example.test';
    const ip = '192.0.2.40';

    assert.equal(await errosAte(email, ip, 0, 16), 16, 'primeiro bloqueio na 16a');
    let l = await bloqueio(email);
    assert.equal(l.strikes, 1);
    assert.equal(Math.round((new Date(l.locked_until) - at(0)) / 1000), 900);

    // Fim do bloqueio (900 s): 15 novos erros bloqueiam de novo por 1 h.
    assert.equal(await errosAte(email, ip, 900, 15), null, 'no fim do bloqueio o 15o erro nao bloqueia');
    l = await bloqueio(email);
    assert.equal(l.strikes, 2);
    assert.equal(Math.round((new Date(l.locked_until) - at(900)) / 1000), HOUR);

    // Fim de 1 h: o terceiro bloqueio dura 24 h.
    assert.equal(await errosAte(email, ip, 900 + HOUR, 15), null);
    l = await bloqueio(email);
    assert.equal(l.strikes, 3);
    assert.equal(Math.round((new Date(l.locked_until) - at(900 + HOUR)) / 1000), DAY);

    // Mais de 7 dias sem erro: strikes zeram; o proximo bloqueio volta a 15 min.
    const tarde = 900 + HOUR + 7 * DAY + 1;
    assert.equal(await errosAte(email, ip, tarde, 15), null);
    l = await bloqueio(email);
    assert.equal(l.strikes, 1, 'zera apos 7 dias sem erro');
    assert.equal(Math.round((new Date(l.locked_until) - at(tarde)) / 1000), 900);
  }));

test('T-H015-29 o link segue valendo com o e-mail bloqueado; novo pedido segue aceito', () =>
  tx(async () => {
    const email = 'link@example.test';
    const c = await pedido({ email, ip: '192.0.2.50', seconds: 0 });
    assert.equal(c.out_resultado, 'criado');
    assert.equal(await errosAte(email, '192.0.2.51', 0, 15), null, '15 erros ainda nao bloqueiam');
    assert.equal(
      (await codigo({ email, ip: '192.0.2.51', seconds: 0 })).out_resultado,
      'bloqueado_codigo',
    );

    const link = await client.query(
      'select * from private.auth_challenge_consume_link($1, $2)',
      [sha(`t:${c.id}`), at(10)],
    );
    assert.equal(link.rows[0].out_resultado, 'ok', 'link autentica com o codigo bloqueado');

    const novo = await pedido({ email, ip: '192.0.2.52', seconds: 70 });
    assert.equal(novo.out_resultado, 'criado', 'novo pedido aceito dentro dos limites');
  }));

test('T-H015-30 isolamento: bloqueio de um e-mail nao afeta outro', () =>
  tx(async () => {
    const bloqueado = 'iso1@example.test';
    const outro = 'iso2@example.test';
    await errosAte(bloqueado, '192.0.2.60', 0, 15);
    assert.equal(
      (await codigo({ email: bloqueado, ip: '192.0.2.60', seconds: 0 })).out_resultado,
      'bloqueado_codigo',
    );
    const r = await codigo({ email: outro, ip: '192.0.2.60', seconds: 0 });
    assert.equal(r.out_resultado, 'invalido', 'outro e-mail segue com resposta normal');
    const p = await pedido({ email: outro, ip: '192.0.2.61', seconds: 0 });
    assert.equal(p.out_resultado, 'criado');
  }));

test('T-H015-31 IP de codigo: 50 passam, a 51a barra; bloqueio de e-mail nao gasta IP', () =>
  tx(async () => {
    const ip = '192.0.2.70';
    const bloqueado = 'ipcod-bloq@example.test';
    await errosAte(bloqueado, ip, 0, 15);
    for (let i = 0; i < 35; i += 1) {
      const r = await codigo({ email: `ipcod${i}@example.test`, ip, seconds: 0 });
      assert.equal(r.out_resultado, 'invalido');
    }
    assert.equal(await soma(K.ipCodigo(ip)), 50);

    const barradoPorEmail = await codigo({ email: bloqueado, ip, seconds: 0 });
    assert.equal(barradoPorEmail.out_resultado, 'bloqueado_codigo');
    assert.equal(await soma(K.ipCodigo(ip)), 50, 'bloqueio do e-mail nao gasta IP');

    const barrado = await codigo({ email: 'ipcod-51@example.test', ip, seconds: 0 });
    assert.equal(barrado.out_resultado, 'bloqueado_ip');
    assert.equal(barrado.out_retry_after, HOUR);
    assert.equal(await soma(K.ipCodigo(ip)), 50);
  }));

test('T-H015-33 expurgo: remove contadores > 3 dias e bloqueios vencidos e velhos; preserva o resto', () =>
  tx(async () => {
    const velho = sha('purge-velho');
    const recente = sha('purge-recente');
    const lockVelho = sha('purge-lock-velho');
    const lockRecente = sha('purge-lock-recente');
    const lockVivo = sha('purge-lock-vivo');
    await client.query(
      `insert into ops.rate_counter (key_hmac, window_start, count) values
         ($1, $2, 3), ($3, $4, 2)`,
      [velho, at(-4 * DAY), recente, at(-HOUR)],
    );
    await client.query(
      `insert into ops.code_lock (key_hmac, strikes, locked_until, last_error_at, updated_at) values
         ($1, 1, null, $4, $4),
         ($2, 1, null, $5, $5),
         ($3, 3, $6, $4, $4)`,
      [lockVelho, lockRecente, lockVivo, at(-9 * DAY), at(-DAY), at(HOUR)],
    );

    await client.query('select * from private.rate_purge($1)', [at(0)]);

    const count = async (table, col, key) =>
      (await client.query(`select count(*)::int as n from ${table} where ${col} = $1`, [key])).rows[0].n;
    assert.equal(await count('ops.rate_counter', 'key_hmac', velho), 0, 'contador velho removido');
    assert.equal(await count('ops.rate_counter', 'key_hmac', recente), 1, 'contador recente preservado');
    assert.equal(await count('ops.code_lock', 'key_hmac', lockVelho), 0, 'bloqueio velho e vencido removido');
    assert.equal(await count('ops.code_lock', 'key_hmac', lockRecente), 1, 'bloqueio recente preservado');
    assert.equal(await count('ops.code_lock', 'key_hmac', lockVivo), 1, 'bloqueio vivo preservado');
  }));
