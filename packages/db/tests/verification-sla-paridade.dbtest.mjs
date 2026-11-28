// Issue 52 (H-039) | T-19 (docs/factory/124-DESENHO-H039.md §6, CA-H039-15): paridade das datas de fronteira
// entre private.verification_sla_target (SQL) e o espelho do dominio (packages/domain/src/verification/sla.ts).
// A mesma tabela de casos esta em verification.test.ts. Funcao estavel, sem escrita: a consulta roda em
// transacao desfeita. Dados sinteticos nao sao criados. Sem rede, sem envio de e-mail, sem Mapbox.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../scripts/lib/env.mjs';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

// Entrada e saida em horario de Brasilia (UTC-3, sem horario de verao desde 2019). Sabado e domingo contam
// como segunda 00:00; soma de dois dias uteis mantendo a hora; sem feriados (dec. 384 e 397).
const CASOS_FRONTEIRA = [
  ['2026-11-12T10:00:00', '2026-11-16T10:00:00', 'quinta cruza o fim de semana'],
  ['2026-11-13T10:00:00', '2026-11-17T10:00:00', 'sexta 10:00'],
  ['2026-11-13T23:59:00', '2026-11-17T23:59:00', 'sexta 23:59'],
  ['2026-11-14T00:00:00', '2026-11-18T00:00:00', 'sabado 00:00'],
  ['2026-11-14T10:00:00', '2026-11-18T00:00:00', 'sabado 10:00'],
  ['2026-11-15T23:59:00', '2026-11-18T00:00:00', 'domingo 23:59'],
  ['2026-11-16T09:00:00', '2026-11-18T09:00:00', 'segunda 09:00'],
];

for (const [entrada, esperado, rotulo] of CASOS_FRONTEIRA) {
  test(`T-19 | ${rotulo}: ${entrada} -03 vira ${esperado} -03 (paridade com o espelho TS)`, async () => {
    await client.query('begin');
    try {
      const { rows } = await client.query(
        'select private.verification_sla_target($1::timestamptz) as alvo',
        [`${entrada}-03:00`],
      );
      assert.equal(
        new Date(rows[0].alvo).getTime(),
        new Date(`${esperado}-03:00`).getTime(),
        `prazo-meta de ${entrada}`,
      );
    } finally {
      await client.query('rollback');
    }
  });
}
