// H-020 | Testes de banco da reserva de cota do geocodificador temporario (docs/factory/56-DESENHO-H020.md,
// §4.2, §6 teste 8). Banco de desenvolvimento. Cada teste numa transacao desfeita (rollback), exceto o
// de concorrencia, que faz commits em meses sinteticos de 2099 e limpa as proprias linhas. Sem rede.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../scripts/lib/env.mjs';

const SERVICE = 'mapbox_geocoding_temp';
const JUNHO = '2099-06-15T12:00:00.000Z';
const JULHO = '2099-07-01T00:00:01.000Z';
const PERIODO_JUNHO = '2099-06-01';
const PERIODO_JULHO = '2099-07-01';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await limpar(client);
  await client?.end();
});

async function limpar(c) {
  await c.query(
    `delete from ops.external_quota where service = $1 and period = 'mes' and period_start in ($2, $3)`,
    [SERVICE, PERIODO_JUNHO, PERIODO_JULHO],
  );
}

async function tx(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

async function reservar(c, agora, soft, hard) {
  const { rows } = await c.query(
    'select out_ok, out_novo_alerta, out_used from private.mapbox_temp_quota_take($1, $2, $3)',
    [agora, soft, hard],
  );
  return rows[0];
}

async function linha(mes = PERIODO_JUNHO) {
  const { rows } = await client.query(
    `select used, soft_limit, hard_limit, alert_level, breaker_state
       from ops.external_quota where service = $1 and period = 'mes' and period_start = $2`,
    [SERVICE, mes],
  );
  return rows[0];
}

async function forcar(usado, alerta = 0, breaker = 'fechado', hard = 2000) {
  await client.query(
    `insert into ops.external_quota (service, period, period_start, used, soft_limit, hard_limit, alert_level, breaker_state)
     values ($1, 'mes', $2, $3, 1500, $4, $5, $6)
     on conflict (service, period, period_start) do update
       set used = excluded.used, hard_limit = excluded.hard_limit,
           alert_level = excluded.alert_level, breaker_state = excluded.breaker_state`,
    [SERVICE, PERIODO_JUNHO, usado, hard, alerta, breaker],
  );
}

test('T-H020-08a primeira reserva cria a linha do mes com os tetos recebidos', () =>
  tx(async () => {
    const r = await reservar(client, JUNHO, 1500, 2000);
    assert.equal(r.out_ok, true);
    assert.equal(r.out_novo_alerta, false);
    assert.equal(r.out_used, 1);
    const l = await linha();
    assert.deepEqual(
      { used: l.used, soft: l.soft_limit, hard: l.hard_limit, alert: l.alert_level, breaker: l.breaker_state },
      { used: 1, soft: 1500, hard: 2000, alert: 0, breaker: 'fechado' },
    );
  }));

test('T-H020-08b alerta do teto de aviso sai uma unica vez no mes', () =>
  tx(async () => {
    await forcar(1499);
    const primeira = await reservar(client, JUNHO, 1500, 2000);
    assert.deepEqual([primeira.out_ok, primeira.out_novo_alerta, primeira.out_used], [true, true, 1500]);
    const segunda = await reservar(client, JUNHO, 1500, 2000);
    assert.deepEqual([segunda.out_ok, segunda.out_novo_alerta], [true, false]);
    assert.equal((await linha()).alert_level, 1);
  }));

test('T-H020-08c teto atingido: recusa, breaker aberto, alerta nivel 2 uma vez, uso preso no teto', () =>
  tx(async () => {
    await forcar(1999, 1, 'fechado', 2000);
    const ultima = await reservar(client, JUNHO, 1500, 2000);
    assert.deepEqual([ultima.out_ok, ultima.out_novo_alerta, ultima.out_used], [true, false, 2000]);
    const recusada = await reservar(client, JUNHO, 1500, 2000);
    assert.deepEqual([recusada.out_ok, recusada.out_novo_alerta, recusada.out_used], [false, true, 2000]);
    const l = await linha();
    assert.deepEqual([l.used, l.alert_level, l.breaker_state], [2000, 2, 'aberto']);
    const de_novo = await reservar(client, JUNHO, 1500, 2000);
    assert.deepEqual([de_novo.out_ok, de_novo.out_novo_alerta], [false, false]);
    assert.ok((await linha()).used <= (await linha()).hard_limit, 'used nunca passa de hard_limit');
  }));

test('T-H020-08d novo mes reabre a cota sozinho (nova linha)', () =>
  tx(async () => {
    await forcar(2000, 2, 'aberto', 2000);
    const r = await reservar(client, JULHO, 1500, 2000);
    assert.deepEqual([r.out_ok, r.out_used], [true, 1]);
    const novo = await linha(PERIODO_JULHO);
    assert.equal(novo.breaker_state, 'fechado');
  }));

test('T-H020-08e entrada invalida nao toca a cota (22023)', () =>
  tx(async () => {
    const casos = [
      [JUNHO, 1500, 99001],
      [JUNHO, 2000, 1500],
      [JUNHO, -1, 2000],
      [JUNHO, 0, 0],
      [null, 1500, 2000],
    ];
    for (const [agora, soft, hard] of casos) {
      // Cada erro aborta a transacao: um savepoint por caso mantem a proxima verificacao valida.
      await client.query('savepoint entrada');
      await assert.rejects(
        () => reservar(client, agora, soft, hard),
        (err) => err.code === '22023',
      );
      await client.query('rollback to savepoint entrada');
    }
    assert.equal(await linha(), undefined, 'nenhuma linha criada por entrada invalida');
  }));

test('T-H020-08f concorrencia: 12 reservas paralelas com teto 5 aceitam exatamente 5', async () => {
  await limpar(client);
  const clients = await Promise.all(Array.from({ length: 12 }, () => connect()));
  try {
    const resultados = await Promise.all(clients.map((c) => reservar(c, JUNHO, 3, 5)));
    const aceitas = resultados.filter((r) => r.out_ok).length;
    const alertas = resultados.filter((r) => r.out_novo_alerta).length;
    assert.equal(aceitas, 5);
    assert.ok(alertas <= 2, `no maximo 1 alerta por nivel (obtidos ${alertas})`);
    const l = await linha();
    assert.deepEqual([l.used, l.hard_limit, l.alert_level], [5, 5, 2]);
  } finally {
    await Promise.all(clients.map((c) => c.end()));
    await limpar(client);
  }
});

test('T-H020-08g grants: so app_system executa; PUBLIC nao', async () => {
  const { rows } = await client.query(
    `select has_function_privilege('app_system', 'private.mapbox_temp_quota_take(timestamptz,integer,integer)', 'EXECUTE') as app,
            has_function_privilege('public', 'private.mapbox_temp_quota_take(timestamptz,integer,integer)', 'EXECUTE') as publico`,
  );
  assert.deepEqual(rows[0], { app: true, publico: false });
});
