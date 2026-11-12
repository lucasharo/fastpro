// H-107 (Issue 116) | Teste de banco da AUSENCIA de promocao no MVP (docs/factory/81-DESENHO-H107.md §3, §6;
// 77-REFINO-H107.md CA-10). NAO EXECUTADO nesta etapa: nenhum banco foi tocado. Os casos abaixo ficam descritos
// com skip ate o banco de desenvolvimento estar disponivel. Quando rodarem, devem provar:
//  1. nenhuma relacao em app.* cujo nome contenha promo, discount ou coupon (regra do 81 §3, item (c));
//  2. as funcoes do catalogo (catalog_*_save, catalog_admin_list, catalog_revision_list) nao citam plan,
//     plan_price nem payment no corpo (consulta em pg_proc), para que nenhuma alteracao do catalogo mexa em preco;
//  3. quando a consulta de planos (H-046) existir: plan_price continua sendo a unica fonte de valor (fora do MVP
//     de catalogo). Enquanto H-046 nao existir, este item segue com skip proprio.
// A regra de negocio (nenhuma promocao se aplica sozinha) esta registrada no 81 §3 e no relatorio da entrega.
import { describe, it } from 'node:test';

const MOTIVO = 'NAO_EXECUTADO: banco de desenvolvimento nao disponivel nesta etapa (H-107, 81 §6)';

describe('H-107 ausencia de promocao no MVP (CA-10; banco)', () => {
  it.skip('nenhuma relacao em app.* com nome contendo promo, discount ou coupon', { skip: MOTIVO }, () => {
    // SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    //  WHERE n.nspname = 'app' AND c.relname ~* '(promo|discount|coupon)'  -> esperado: 0 linhas.
  });

  it.skip('funcoes do catalogo nao citam plan, plan_price nem payment no corpo', { skip: MOTIVO }, () => {
    // Para cada private.catalog_* (escrita, leitura e revisoes): prosrc de pg_proc sem 'plan', 'plan_price' ou 'payment'.
  });

  it.skip('plan_price segue como unica fonte de valor da consulta de planos (depende de H-046)', { skip: MOTIVO }, () => {
    // Pendente: so faz sentido quando a consulta de planos existir. Hoje nao ha consulta para comparar.
  });
});
