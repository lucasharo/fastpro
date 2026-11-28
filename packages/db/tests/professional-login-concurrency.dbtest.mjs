// H-016 | Teste de banco: concorrencia do bloqueio progressivo do login do profissional (T-H016-12;
// docs/factory/33-DESENHO-H016.md §5.1 passo 3 e §5.3). Conta nova, chave sintetica (HMAC de teste
// em 64 hex, sem e-mail real). 50 pedidos simultaneos, cada um numa conexao propria, chamam
// private.professional_login_gate, a mesma funcao que PgProfessionalAuth.loginGate usa. Afirma que no
// maximo 4 tentativas passam; as demais recebem bloqueio. Banco de desenvolvimento. As chamadas fazem
// commit (cada uma e sua transacao), entao o teste apaga a chave que criou em finally.
// Nao executado nesta etapa: a execucao fica para a etapa de banco (db:test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';

const PEDIDOS = 50;
const MAXIMO_PASSAM = 4;

const SQL_GATE = 'select * from private.professional_login_gate($1, $2::timestamptz)';

test('T-H016-12 50 logins simultaneos para conta nova: no maximo 4 verificacoes passam', async () => {
  const chave = createHash('sha256')
    .update(`professional-login-concurrency:${randomBytes(16).toString('hex')}`)
    .digest('hex');
  const agora = new Date().toISOString();
  const conexoes = await Promise.all(Array.from({ length: PEDIDOS }, () => connect()));
  try {
    const resultados = await Promise.all(
      conexoes.map(async (conexao) => {
        const { rows } = await conexao.query(SQL_GATE, [chave, agora]);
        return rows[0];
      }),
    );
    const passaram = resultados.filter((linha) => linha.out_bloqueada === false).length;
    const bloqueadas = resultados.filter((linha) => linha.out_bloqueada === true).length;
    assert.equal(passaram + bloqueadas, PEDIDOS, 'cada pedido deve ter uma decisao');
    assert.ok(passaram <= MAXIMO_PASSAM, `no maximo ${MAXIMO_PASSAM} verificacoes podem passar; passaram ${passaram}`);
    assert.ok(passaram >= 1, 'pelo menos uma tentativa deve passar');
  } finally {
    await Promise.all(conexoes.map((conexao) => conexao.end()));
    const limpeza = await connect();
    try {
      await limpeza.query('delete from ops.code_lock where key_hmac = $1', [chave]);
    } finally {
      await limpeza.end();
    }
  }
});
