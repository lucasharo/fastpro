// E5 (Issues 60 a 67) | Provas de banco da cobranca (migracoes 20261122100000 e 20261122100100).
// Roda no DEV ja migrado. Cada teste roda numa transacao desfeita no fim (o livro nao aceita DELETE).
// Dados sinteticos (@example.test). Sem rede e sem provedor: o pagamento chega como ja consultado no provedor.
// Rodar sozinho: node --test --test-concurrency=1 packages/db/tests/billing-payments.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { connect } from '../scripts/lib/env.mjs';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;
const T0 = Date.parse('2031-03-10T15:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const SUF = randomUUID().slice(0, 8);

async function tx(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

async function perfil(status = 'aprovada') {
  const id = randomUUID();
  await client.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, 'ativo', now(), now())`,
    [id, `e5-${id.slice(0, 8)}-${SUF}@example.test`, randomUUID()],
  );
  await client.query(
    `insert into app.professional_profile
       (user_id, verification_status, public_name, slug, document_type, document_enc, document_hmac, verified_at, created_at, updated_at)
     values ($1, $2, 'Nome Sintetico', $3, 'CPF', $4, $5, now(), now(), now())`,
    [id, status, `e5-slug-${randomUUID()}`, Buffer.from(`blob-${randomUUID()}`), randomBytes(32).toString('hex')],
  );
  return id;
}

async function checkout(pro, { plan = 'mensal', method = 'pix', renovar = false, versao = null, at = T0 } = {}) {
  const r = await client.query(
    'select * from private.billing_checkout_create($1::uuid, $2, $3, $4, $5, $6::timestamptz)',
    [pro, plan, method, renovar, versao, iso(at)],
  );
  return r.rows[0];
}

async function pagar(ck, { id = `p-${randomUUID()}`, status = 'aprovado', paidAt = T0, valor, method = 'pix', at } = {}) {
  const r = await client.query(
    'select * from private.billing_payment_apply($1::uuid, $2, $3, $4, $5, $6::timestamptz, null, null, $7::timestamptz)',
    [ck.out_checkout_id, id, method, valor ?? ck.out_amount_cents, status, iso(paidAt), iso(at ?? paidAt)],
  );
  return { ...r.rows[0], id };
}

async function estado(pro, at) {
  const r = await client.query('select estado, access_until from private.commercial_access($1::uuid, $2::timestamptz)', [
    pro,
    iso(at),
  ]);
  return r.rows[0];
}

test('checkout: nao verificado, plano invalido, boleto e adesao obrigatoria', async () => {
  await tx(async () => {
    const pendente = await perfil('pendente');
    assert.equal((await checkout(pendente)).out_code, 'not_verified');
    const pro = await perfil();
    assert.equal((await checkout(pro, { plan: 'bienal' })).out_code, 'plano_invalido');
    assert.equal((await checkout(pro, { plan: null })).out_code, 'plano_invalido');
    assert.equal((await checkout(pro, { method: 'boleto' })).out_code, 'metodo_invalido');
    assert.equal((await checkout(pro, { method: 'cartao', renovar: true })).out_code, 'adesao_obrigatoria');
    const ok = await checkout(pro, { plan: 'trimestral', method: 'cartao', renovar: true, versao: 'v1' });
    assert.equal(ok.out_code, 'ok');
    assert.equal(ok.out_mode, 'recorrente');
    assert.equal(ok.out_amount_cents, 8070);
    assert.equal(ok.out_months, 3);
    const pix = await checkout(pro, { method: 'pix', renovar: true });
    assert.equal(pix.out_mode, 'avulso', 'Pix nunca renova sozinho (H-051)');
  });
});

test('pagamento aprovado concede o periodo em meses civis; repetido nao duplica (H-048, H-049)', async () => {
  await tx(async () => {
    const pro = await perfil();
    const ck = await checkout(pro);
    const p = await pagar(ck);
    assert.equal(p.out_code, 'concedido');
    assert.equal(new Date(p.out_period_start).toISOString(), iso(T0));
    assert.equal(new Date(p.out_period_end).toISOString(), '2031-04-10T15:00:00.000Z');
    const de2 = await pagar(ck, { id: p.id });
    assert.equal(de2.out_code, 'sem_mudanca');
    const n = await client.query("select count(*)::int as n from billing.access_grant where professional_id=$1 and type='paid'", [pro]);
    assert.equal(n.rows[0].n, 1);
    assert.equal((await estado(pro, T0 + DIA)).estado, 'ativa');
  });
});

test('pendente nao concede; aprovado depois concede; nunca regride (H-048, H-050)', async () => {
  await tx(async () => {
    const pro = await perfil();
    const ck = await checkout(pro);
    const p = await pagar(ck, { status: 'pendente' });
    assert.equal(p.out_code, 'registrado');
    assert.equal((await estado(pro, T0 + HORA)).estado, 'sem_acesso');
    const ap = await pagar(ck, { id: p.id, status: 'aprovado', paidAt: T0 + HORA });
    assert.equal(ap.out_code, 'concedido');
    const volta = await pagar(ck, { id: p.id, status: 'pendente', paidAt: T0 + 2 * HORA });
    assert.equal(volta.out_code, 'sem_mudanca');
    const est = await pagar(ck, { id: p.id, status: 'estornado', paidAt: T0 + 3 * HORA });
    assert.equal(est.out_code, 'registrado', 'estorno so registra; acesso e decisao do Financeiro');
    assert.equal((await estado(pro, T0 + 4 * HORA)).estado, 'ativa');
  });
});

test('valor diferente do checkout e recusado sem efeito', async () => {
  await tx(async () => {
    const pro = await perfil();
    const ck = await checkout(pro);
    assert.equal((await pagar(ck, { valor: 100 })).out_code, 'valor_divergente');
    assert.equal((await pagar(ck, { method: 'boleto' })).out_code, 'metodo_invalido');
  });
});

test('renovacao antecipada e dentro da carencia encadeiam sem lacuna; depois de 72 h comeca no pagamento (08 §8.4)', async () => {
  await tx(async () => {
    const pro = await perfil();
    const p1 = await pagar(await checkout(pro));
    const fim1 = Date.parse(p1.out_period_end);
    const antecipado = await pagar(await checkout(pro), { paidAt: fim1 - 5 * DIA });
    assert.equal(new Date(antecipado.out_period_start).toISOString(), iso(fim1));
    const fim2 = Date.parse(antecipado.out_period_end);
    assert.equal((await estado(pro, fim2 + 10 * HORA)).estado, 'em_carencia');
    const naCarencia = await pagar(await checkout(pro), { paidAt: fim2 + 70 * HORA });
    assert.equal(new Date(naCarencia.out_period_start).toISOString(), iso(fim2), 'sem lacuna nem tempo perdido');
    const fim3 = Date.parse(naCarencia.out_period_end);
    assert.equal((await estado(pro, fim3 + 73 * HORA)).estado, 'expirada');
    const tarde = await pagar(await checkout(pro), { paidAt: fim3 + 100 * HORA });
    assert.equal(new Date(tarde.out_period_start).toISOString(), iso(fim3 + 100 * HORA));
  });
});

test('cancelamento: acesso ate o fim, sem carencia; nova compra reabre (H-052)', async () => {
  await tx(async () => {
    const pro = await perfil();
    const p = await pagar(await checkout(pro));
    const fim = Date.parse(p.out_period_end);
    const c = await client.query('select * from private.billing_subscription_cancel($1::uuid, $2::timestamptz)', [pro, iso(T0 + DIA)]);
    assert.equal(c.rows[0].out_code, 'ok');
    const de2 = await client.query('select * from private.billing_subscription_cancel($1::uuid, $2::timestamptz)', [pro, iso(T0 + DIA)]);
    assert.equal(de2.rows[0].out_code, 'ja_cancelada');
    assert.equal((await estado(pro, T0 + 2 * DIA)).estado, 'cancelada_com_acesso_ate_fim_do_periodo');
    assert.equal((await estado(pro, fim + HORA)).estado, 'expirada', 'cancelada nao tem carencia');
    const nova = await pagar(await checkout(pro), { paidAt: fim + 2 * HORA });
    assert.equal(new Date(nova.out_period_start).toISOString(), iso(fim + 2 * HORA));
    const s = await client.query('select cancel_at_period_end from billing.subscription where professional_id=$1', [pro]);
    assert.equal(s.rows[0].cancel_at_period_end, false);
  });
});

test('webhook: o mesmo evento e gravado uma vez', async () => {
  await tx(async () => {
    const chave = `payment:${randomUUID()}:payment.updated`;
    const a = await client.query('select * from private.billing_event_record($1, $2, $3, $4, $5::timestamptz)', [chave, 'payment', '123', true, iso(T0)]);
    assert.equal(a.rows[0].out_new, true);
    await client.query('select private.billing_event_finish($1::uuid, $2, $3::timestamptz)', [a.rows[0].out_event_id, 'concedido', iso(T0)]);
    const b = await client.query('select * from private.billing_event_record($1, $2, $3, $4, $5::timestamptz)', [chave, 'payment', '123', true, iso(T0)]);
    assert.equal(b.rows[0].out_new, false);
    assert.equal(b.rows[0].out_event_id, a.rows[0].out_event_id);
  });
});

test('assinatura recorrente: ligacao registra a adesao e nao aceita assinatura de outro profissional (H-051)', async () => {
  await tx(async () => {
    const pro = await perfil();
    const ck = await checkout(pro, { method: 'cartao', renovar: true, versao: 'renovacao-cartao-v1' });
    const sub = `pre-${randomUUID()}`;
    const r = await client.query('select private.billing_subscription_link($1::uuid, $2, $3, $4::timestamptz) as c', [ck.out_checkout_id, sub, 'authorized', iso(T0)]);
    assert.equal(r.rows[0].c, 'ok');
    const s = await client.query('select mode, auto_renew_opt_in_at, auto_renew_text_version from billing.subscription where professional_id=$1', [pro]);
    assert.equal(s.rows[0].mode, 'cartao_recorrente');
    assert.ok(s.rows[0].auto_renew_opt_in_at);
    assert.equal(s.rows[0].auto_renew_text_version, 'renovacao-cartao-v1');
    const outro = await perfil();
    const ck2 = await checkout(outro, { method: 'cartao', renovar: true, versao: 'renovacao-cartao-v1' });
    const r2 = await client.query('select private.billing_subscription_link($1::uuid, $2, $3, $4::timestamptz) as c', [ck2.out_checkout_id, sub, 'authorized', iso(T0)]);
    assert.equal(r2.rows[0].c, 'assinatura_de_outro');
  });
});

test('papeis: so app_system executa as funcoes de cobranca', async () => {
  const r = await client.query(
    `select has_function_privilege('app_system', 'private.billing_payment_apply(uuid,text,text,integer,text,timestamptz,timestamptz,text,timestamptz)', 'execute') as sys,
            has_function_privilege('app_api', 'private.billing_payment_apply(uuid,text,text,integer,text,timestamptz,timestamptz,text,timestamptz)', 'execute') as api,
            has_function_privilege('anon', 'private.billing_checkout_create(uuid,text,text,boolean,text,timestamptz)', 'execute') as anon`,
  );
  assert.deepEqual(r.rows[0], { sys: true, api: false, anon: false });
});
