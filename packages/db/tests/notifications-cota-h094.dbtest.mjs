// H-094 | Cota do Resend: contador, alertas 70/85 e degradacao por classe (59-DESENHO-H094 §5).
// Transacoes desfeitas, relogio fixo em 2099 (linhas isoladas), provedor dublê, sem rede.
// Exceto TD-08 (concorrencia), que usa linhas commitadas em 2099-01-01 e as remove ao final.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect } from '../scripts/lib/env.mjs';
import { processOutbox, SendPacer } from '../dist/notifications.js';
import { NotificationRuleRegistry, PROVIDER_LIMITS, QUOTA_CUTS } from '@fastpro/domain';
import { FakeClock, FakeEmailProvider, FakeRecipientDirectory } from '@fastpro/testkit';
import { guard } from './fixtures/no-network.mjs';

const NOW = '2099-01-01T12:00:00.000Z';
const DAY = '2099-01-01';
const DAY2 = '2099-01-02';
const MES = '2099-01-01';
const MES_FEV = '2099-02-01';
const ROLLBACK_FILE = new URL(
  '../../../supabase/rollbacks/20261111270000_notifications_email_alert_levels.down.sql',
  import.meta.url,
);

// Classe -> tipo de e-mail real (policy.ts). Conteudo nao importa: so o caminho de cota e medido.
const CLASSE = {
  auth: {
    category: 'acesso',
    emailType: 'acesso_login',
    params: () => ({ challenge_ref: randomUUID() }),
  },
  critico: {
    category: 'selecao',
    emailType: 'selecao',
    params: () => ({ request_ref: randomUUID() }),
  },
  digest: {
    category: 'aceite',
    emailType: 'aceite_resumo',
    params: () => ({ request_ref: randomUUID(), count: 1 }),
  },
  lembrete: {
    category: 'prazo',
    emailType: 'prazo_t24',
    params: () => ({ request_ref: randomUUID() }),
  },
};

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
  if (guard.denied.length > 0)
    throw new Error('tentativa de rede real durante os testes de cota H-094');
});

async function tx(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

async function setQuota(period, used) {
  const [soft, hard, reserved] = period === 'dia_utc' ? [90, 100, 10] : [2700, 3000, 300];
  const day = period === 'dia_utc' ? DAY : MES;
  await client.query(
    'insert into ops.external_quota (service, period, period_start, used, soft_limit, hard_limit, reserved_auth) ' +
      "values ('email', $1, $2::date, $3, $4, $5, $6) on conflict (service, period, period_start) do update set used = excluded.used",
    [period, day, used, soft, hard, reserved],
  );
}

async function cota(period, day) {
  const r = await client.query(
    "select used, alert_level, alerted_at from ops.external_quota where service = 'email' and period = $1 and period_start = $2::date",
    [period, day],
  );
  return r.rows[0] ?? null;
}

function setup(nowIso, provider = new FakeEmailProvider()) {
  const clock = new FakeClock(nowIso);
  const directory = new FakeRecipientDirectory();
  return {
    provider,
    directory,
    clock,
    deps: {
      client,
      registry: new NotificationRuleRegistry(),
      provider,
      directory,
      clock,
      useDbClock: false,
    },
  };
}

/** Envia uma linha da classe pelo caminho real (processOutbox) e devolve estado e motivo. */
async function enviar(rec, cls, nowIso = NOW, provider = new FakeEmailProvider()) {
  const s = setup(nowIso, provider);
  s.directory.set(rec, { status: 'ok', email: 'sintetico@teste.invalid' });
  const c = CLASSE[cls];
  const id = (
    await client.query(
      'insert into ops.email_outbox (recipient_user_id, category, class, email_type, template, template_params, dedupe_key, next_attempt_at) ' +
        'values ($1, $2, $3, $4, $4, $5::jsonb, $6, $7::timestamptz) returning id',
      [
        rec,
        c.category,
        cls,
        c.emailType,
        JSON.stringify(c.params()),
        `test.h094:${randomUUID()}`,
        nowIso,
      ],
    )
  ).rows[0].id;
  await processOutbox(s.deps, id, new SendPacer(s.clock));
  return (
    await client.query(
      'select state, reason_code, next_attempt_at from ops.email_outbox where id = $1',
      [id],
    )
  ).rows[0];
}

// TD-01 contagem: aceite soma 1 no dia e no mes por destinatario; recusa devolve a reserva.
test('TD-01 contagem: dois destinatarios aceitos somam 2; indisponivel devolve a reserva', () =>
  tx(async () => {
    assert.equal((await enviar(randomUUID(), 'auth')).state, 'enviado');
    assert.equal((await enviar(randomUUID(), 'auth')).state, 'enviado');
    assert.equal((await cota('dia_utc', DAY)).used, 2);
    assert.equal((await cota('mes', MES)).used, 2);

    const recusado = new FakeEmailProvider().queue({ kind: 'indisponivel', code: 'simulado' });
    await enviar(randomUUID(), 'auth', NOW, recusado);
    assert.equal((await cota('dia_utc', DAY)).used, 2, 'a reserva recusada nao fica contada');
  }));

// TD-02 virada de dia UTC.
test('TD-02 virada de dia: 23:59:59,999 conta em 01/01; 00:00 abre linha nova; mes acumula', () =>
  tx(async () => {
    await enviar(randomUUID(), 'auth', '2099-01-01T23:59:59.999Z');
    assert.equal((await cota('dia_utc', DAY)).used, 1);
    await enviar(randomUUID(), 'auth', '2099-01-02T00:00:00.000Z');
    assert.equal((await cota('dia_utc', DAY2)).used, 1, 'linha nova do dia seguinte');
    assert.equal((await cota('dia_utc', DAY)).used, 1, 'linha do dia anterior nao muda');
    assert.equal((await cota('mes', MES)).used, 2, 'mes continua acumulando');
  }));

// TD-03 virada de mes e fuso (UTC, nunca Brasilia).
test('TD-03 virada de mes: 31/01 23:59:59Z em janeiro; 01/02 01:00Z ja conta em fevereiro (UTC)', () =>
  tx(async () => {
    await enviar(randomUUID(), 'auth', '2099-01-31T23:59:59.000Z');
    assert.equal((await cota('mes', MES)).used, 1);
    await enviar(randomUUID(), 'auth', '2099-02-01T00:00:00.000Z');
    assert.equal((await cota('mes', MES_FEV)).used, 1);
    await enviar(randomUUID(), 'auth', '2099-02-01T01:00:00.000Z');
    assert.equal(
      (await cota('mes', MES_FEV)).used,
      2,
      'prova UTC: 01:00Z ainda e 31/01 em Brasilia',
    );
    assert.equal((await cota('mes', MES)).used, 1, 'janeiro nao recebe o envio de fevereiro');
  }));

// TD-04 alerta 70 no dia, uma unica vez.
test('TD-04 alerta 70 no dia: 69 -> 70 grava nivel 1 uma vez; 71 nao muda nem regrava', () =>
  tx(async () => {
    await setQuota('dia_utc', 69);
    await setQuota('mes', 0);
    await enviar(randomUUID(), 'auth');
    const primeiro = await cota('dia_utc', DAY);
    assert.equal(primeiro.used, 70);
    assert.equal(primeiro.alert_level, 1);
    assert.notEqual(primeiro.alerted_at, null);

    await enviar(randomUUID(), 'auth');
    const segundo = await cota('dia_utc', DAY);
    assert.equal(segundo.used, 71);
    assert.equal(segundo.alert_level, 1);
    assert.equal(
      segundo.alerted_at.getTime(),
      primeiro.alerted_at.getTime(),
      'alerted_at nao muda',
    );

    const r = await client.query(
      'select * from private.email_quota_registrar_alerta(1::smallint, 0::smallint, $1::timestamptz)',
      [NOW],
    );
    assert.equal(r.rows[0].out_dia_subiu, false, 'nivel ja gravado: nao e subida');
  }));

// TD-05 alerta 85 no dia e 2.100/2.550 no mes.
test('TD-05 alerta 85 no dia (84->85 = nivel 2) e mes (2.099->2.100 = 1; 2.549->2.550 = 2)', () =>
  tx(async () => {
    await setQuota('dia_utc', 84);
    await setQuota('mes', 2099);
    await enviar(randomUUID(), 'auth');
    assert.equal((await cota('dia_utc', DAY)).alert_level, 2);
    assert.equal((await cota('mes', MES)).used, 2100);
    assert.equal((await cota('mes', MES)).alert_level, 1);

    await setQuota('mes', 2549);
    await enviar(randomUUID(), 'auth');
    assert.equal((await cota('mes', MES)).used, 2550);
    assert.equal((await cota('mes', MES)).alert_level, 2);
  }));

// TD-06 sem rebaixar: a devolucao (uso volta a 69) nao baixa o nivel gravado.
test('TD-06 sem rebaixar: uso que volta a 69 mantem nivel 1; registrar(0,0) nao altera', () =>
  tx(async () => {
    await setQuota('dia_utc', 69);
    await setQuota('mes', 0);
    await enviar(randomUUID(), 'auth');
    assert.equal((await cota('dia_utc', DAY)).alert_level, 1);

    await setQuota('dia_utc', 69);
    await client.query(
      'select * from private.email_quota_registrar_alerta(0::smallint, 0::smallint, $1::timestamptz)',
      [NOW],
    );
    assert.equal((await cota('dia_utc', DAY)).alert_level, 1);
  }));

// TD-07 periodo novo, alerta novo: o alerta do dia anterior fica no historico.
test('TD-07 virada: o nivel do dia novo comeca em 0 e o do dia anterior permanece', () =>
  tx(async () => {
    await setQuota('dia_utc', 69);
    await setQuota('mes', 0);
    await enviar(randomUUID(), 'auth', NOW);
    assert.equal((await cota('dia_utc', DAY)).alert_level, 1);

    await enviar(randomUUID(), 'auth', '2099-01-02T00:00:00.000Z');
    assert.equal((await cota('dia_utc', DAY2)).alert_level, 0, 'linha nova nasce sem alerta');
    assert.equal((await cota('dia_utc', DAY)).alert_level, 1, 'historico do dia anterior');
  }));

// TD-08 concorrencia: 10 conexoes cruzam o 70 ao mesmo tempo; exatamente uma subida.
test('TD-08 concorrencia: 10 transacoes em paralelo produzem exatamente uma subida', async () => {
  await client.query(
    'insert into ops.external_quota (service, period, period_start, used, soft_limit, hard_limit, reserved_auth) ' +
      "values ('email', 'dia_utc', $1::date, 70, 90, 100, 10) " +
      'on conflict (service, period, period_start) do update set used = 70, alert_level = 0, alerted_at = null',
    [DAY],
  );
  const conexoes = [];
  try {
    for (let i = 0; i < 10; i += 1) conexoes.push(await connect());
    const subiu = await Promise.all(
      conexoes.map(async (c) => {
        await c.query('begin');
        try {
          const r = await c.query(
            'select * from private.email_quota_registrar_alerta(1::smallint, 0::smallint, $1::timestamptz)',
            [NOW],
          );
          await c.query('commit');
          return r.rows[0].out_dia_subiu === true;
        } catch (erro) {
          await c.query('rollback').catch(() => {});
          throw erro;
        }
      }),
    );
    assert.equal(subiu.filter(Boolean).length, 1, 'uma unica subida entre as 10');
    assert.equal((await cota('dia_utc', DAY)).alert_level, 1);
  } finally {
    await Promise.all(conexoes.map((c) => c.end().catch(() => {})));
    await client.query(
      "delete from ops.external_quota where service = 'email' and period = 'dia_utc' and period_start = $1::date",
      [DAY],
    );
  }
});

// TD-09 degradacao por classe no envio real, dia e mes.
test('TD-09 degradacao por classe: 70 adia lembrete e deixa digest; 85 adia digest; 90 adia critico', () =>
  tx(async () => {
    assert.deepEqual(QUOTA_CUTS.lembrete, { dia: 70, mes: 2100 });
    await setQuota('dia_utc', 70);
    assert.equal((await enviar(randomUUID(), 'lembrete')).reason_code, 'cota_dia');
    assert.equal((await enviar(randomUUID(), 'digest')).state, 'enviado');

    await setQuota('dia_utc', 85);
    assert.equal((await enviar(randomUUID(), 'digest')).reason_code, 'cota_dia');

    await setQuota('dia_utc', 90);
    assert.equal((await enviar(randomUUID(), 'critico')).reason_code, 'cota_dia');
    assert.equal((await enviar(randomUUID(), 'auth')).state, 'enviado', 'login usa a reserva');
  }));

test('TD-09 (100/dia): auth adiado com recuo ate 00:00 UTC do dia seguinte', () =>
  tx(async () => {
    await setQuota('dia_utc', 100);
    const r = await enviar(randomUUID(), 'auth');
    assert.equal(r.state, 'adiado_cota');
    assert.equal(r.reason_code, 'cota_dia');
    assert.equal(new Date(r.next_attempt_at).toISOString(), '2099-01-02T00:00:00.000Z');
  }));

test('TD-09 (mes cheio): lembrete adiado por cota_mes mesmo com o dia livre', () =>
  tx(async () => {
    await setQuota('dia_utc', 0);
    await setQuota('mes', 2100);
    const r = await enviar(randomUUID(), 'lembrete');
    assert.equal(r.state, 'adiado_cota');
    assert.equal(r.reason_code, 'cota_mes');
  }));

// TD-11 alerta nao bloqueia: nivel 2 gravado, mas o envio segue abaixo do corte da classe.
test('TD-11 alerta nao bloqueia: nivel 2 gravado e lembrete abaixo do corte segue', () =>
  tx(async () => {
    await setQuota('dia_utc', 0);
    await setQuota('mes', 0);
    await client.query(
      'select * from private.email_quota_registrar_alerta(2::smallint, 2::smallint, $1::timestamptz)',
      [NOW],
    );
    assert.equal((await enviar(randomUUID(), 'lembrete')).state, 'enviado');
    assert.equal((await cota('dia_utc', DAY)).alert_level, 2);
  }));

// TD-12 coerencia SQL x codigo: os literais de reservar_cota repetem PROVIDER_LIMITS e os cortes.
test('TD-12 coerencia: linhas criadas pelo SQL = PROVIDER_LIMITS e QUOTA_CUTS.critico; reserva = diferenca', () =>
  tx(async () => {
    assert.equal((await enviar(randomUUID(), 'auth')).state, 'enviado');
    const d = (
      await client.query(
        "select hard_limit, soft_limit, reserved_auth from ops.external_quota where service = 'email' and period = 'dia_utc' and period_start = $1::date",
        [DAY],
      )
    ).rows[0];
    const m = (
      await client.query(
        "select hard_limit, soft_limit, reserved_auth from ops.external_quota where service = 'email' and period = 'mes' and period_start = $1::date",
        [MES],
      )
    ).rows[0];
    assert.equal(d.hard_limit, PROVIDER_LIMITS.dia);
    assert.equal(d.soft_limit, QUOTA_CUTS.critico.dia);
    assert.equal(d.reserved_auth, d.hard_limit - d.soft_limit);
    assert.equal(m.hard_limit, PROVIDER_LIMITS.mes);
    assert.equal(m.soft_limit, QUOTA_CUTS.critico.mes);
    assert.equal(m.reserved_auth, m.hard_limit - m.soft_limit);
  }));

// TD-13 sem interruptor: nenhuma chave de e-mail, cota, limite ou ativacao em ops.app_config.
test('TD-13 sem interruptor: ops.app_config nao tem chave de e-mail, cota ou resend', async () => {
  const r = await client.query(
    "select count(*)::int as n from ops.app_config where key ~* '(email|quota|cota|resend)'",
  );
  assert.equal(r.rows[0].n, 0);
});

// TD-15 migracao: privilegios, faixa 0..2 (22023) e desfazer restaura a funcao anterior (void).
test('TD-15 privilegios: somente app_system executa a funcao de alerta', async () => {
  const sig = 'private.email_quota_registrar_alerta(smallint,smallint,timestamptz)';
  const r = await client.query(
    "select has_function_privilege('app_system', $1, 'EXECUTE') as sistema, " +
      "has_function_privilege('app_api', $1, 'EXECUTE') as api, " +
      "has_function_privilege('anon', $1, 'EXECUTE') as anon, " +
      "has_function_privilege('authenticated', $1, 'EXECUTE') as autenticado",
    [sig],
  );
  assert.deepEqual(r.rows[0], { sistema: true, api: false, anon: false, autenticado: false });
});

test('TD-15 faixa: nivel 3 e rejeitado com 22023 (nada e gravado)', async () => {
  await assert.rejects(
    client.query(
      'select * from private.email_quota_registrar_alerta(3::smallint, 0::smallint, $1::timestamptz)',
      [NOW],
    ),
    (erro) => erro.code === '22023',
  );
});

test('TD-15 desfazer: o arquivo de rollback restaura a funcao com retorno void', () =>
  tx(async () => {
    const sql = readFileSync(ROLLBACK_FILE, 'utf8')
      .split('\n')
      .filter((linha) => !/^\s*(begin|commit);\s*$/i.test(linha))
      .join('\n');
    await client.query(sql);
    const r = await client.query(
      "select pg_get_function_result('private.email_quota_registrar_alerta(smallint,smallint,timestamptz)'::regprocedure) as retorno",
    );
    assert.equal(r.rows[0].retorno, 'void');
  }));
