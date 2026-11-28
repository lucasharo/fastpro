// H-107 (Issue 116) | Teste de banco da AUSENCIA de promocao no MVP (docs/factory/81-DESENHO-H107.md §3, §6;
// 77-REFINO-H107.md CA-10). Somente leitura do catalogo (pg_class, pg_proc): nada e gravado.
// Provam:
//  1. nenhuma relacao em app.* cujo nome contenha promo, discount ou coupon (regra do 81 §3, item (c));
//  2. as funcoes private.catalog_* (escrita, leitura e revisoes) nao citam plan, plan_price nem payment no corpo,
//     para que nenhuma alteracao do catalogo mexa em preco.
//  3. plan_price como unica fonte de valor da consulta de planos (H-046): segue com skip, motivo abaixo.
// Rodar sozinho: node --test --test-concurrency=1 packages/db/tests/catalog-promo-ausente.dbtest.mjs
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../scripts/lib/env.mjs';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

// Caso 3: a consulta de planos (H-046) ainda nao existe no banco; nao ha o que comparar com plan_price.
const MOTIVO_H046 = 'pendente: depende de H-046 (consulta de planos), sem consulta de planos no banco (81 §6)';

describe('H-107 ausencia de promocao no MVP (CA-10; banco)', () => {
  it('nenhuma relacao em app.* com nome contendo promo, discount ou coupon', async () => {
    const { rows } = await client.query(
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'app'
          and c.relname ~* '(promo|discount|coupon)'`);
    assert.deepEqual(rows, [], 'nenhuma relacao de promocao em app.*');
  });

  it('funcoes private.catalog_* nao citam plan, plan_price nem payment no corpo', async () => {
    const { rows: todas } = await client.query(
      `select p.proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private'
          and left(p.proname, 8) = 'catalog_'`);
    assert.ok(todas.length > 0, 'ha funcoes private.catalog_* para verificar');

    const { rows: citam } = await client.query(
      `select p.proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private'
          and left(p.proname, 8) = 'catalog_'
          and p.prosrc ~* '(plan|payment)'`);
    assert.deepEqual(citam, [], 'nenhuma funcao do catalogo cita plan, plan_price ou payment');
  });

  it.skip('plan_price segue como unica fonte de valor da consulta de planos (depende de H-046)', { skip: MOTIVO_H046 }, () => {});
});
