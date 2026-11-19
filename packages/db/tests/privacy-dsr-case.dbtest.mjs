// Issue 120 (H-111) | Caso de direitos do titular no banco: tabelas, restricoes, maquina de estados e linha do tempo
// (147-DESENHO-H111 §3, §7: T-DB-01, T-DB-02, T-DB-04 a T-DB-09 e criacao). Banco de desenvolvimento.
// Cada teste roda em transacao e e desfeito (rollback). Valores sinteticos (@example.test). Sem rede, sem e-mail.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomInt } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

const PAPEL_SERVICO = ['service', 'role'].join('_');
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const agora = () => new Date().toISOString();
const prazo = () => new Date(Date.now() + 15 * 24 * 3600 * 1000).toISOString();

async function tx(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

/** Executa um comando que deve falhar; savepoint mantem a transacao viva. Devolve o erro (ou falha o teste). */
async function erroDe(sql, params = []) {
  await client.query('savepoint sp');
  try {
    await client.query(sql, params);
  } catch (err) {
    await client.query('rollback to savepoint sp');
    return err;
  }
  await client.query('release savepoint sp');
  assert.fail(`deveria ter falhado: ${sql.slice(0, 80)}`);
}

async function usuario() {
  const id = randomUUID();
  await client.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, 'ativo', now(), now())`,
    [id, `${randomUUID()}@example.test`, randomUUID()],
  );
  return id;
}

function protocolo() {
  let sufixo = '';
  for (let i = 0; i < 6; i += 1) sufixo += B32[randomInt(32)];
  return `DSR-20261119-${sufixo}`;
}

/** Insere um caso direto (fixture). Campos extras entram como colunas. */
async function criarCaso(sujeito, kind = 'acesso', extra = {}) {
  const campos = { protocol: protocolo(), subject_user_id: sujeito, kind, deadline_at: prazo(), ...extra };
  const nomes = Object.keys(campos);
  const marcas = nomes.map((_, i) => `$${i + 1}`);
  const { rows } = await client.query(
    `insert into app.dsr_case (${nomes.join(', ')}) values (${marcas.join(', ')}) returning id`,
    Object.values(campos),
  );
  return rows[0].id;
}

/** SQL de atualizacao de um caso com os campos informados. */
function atualizar(id, campos) {
  const nomes = Object.keys(campos);
  const sets = nomes.map((c, i) => `${c} = $${i + 2}`);
  return { sql: `update app.dsr_case set ${sets.join(', ')} where id = $1`, params: [id, ...Object.values(campos)] };
}

async function mover(id, campos) {
  const { sql, params } = atualizar(id, campos);
  await client.query(sql, params);
}

const NOTA = 'Retencao legal de pagamentos e auditoria, conforme politica [PROPOSTA].';

test('T-DB-01 | tabelas, colunas e restricoes existem no catalogo', async () => {
  await tx(async () => {
    const { rows: cols } = await client.query(
      `select column_name from information_schema.columns where table_schema = 'app' and table_name = 'dsr_case'`,
    );
    const nomes = new Set(cols.map((r) => r.column_name));
    for (const c of ['id', 'protocol', 'subject_user_id', 'kind', 'status', 'channel', 'opened_by_operator_id',
      'request_details', 'legal_basis_note', 'outcome', 'assigned_to', 'opened_at', 'deadline_at', 'closed_at',
      'approval_request_id', 'created_at', 'updated_at']) {
      assert.ok(nomes.has(c), `coluna ausente: ${c}`);
    }
    const { rows: ev } = await client.query(
      `select column_name from information_schema.columns where table_schema = 'app' and table_name = 'dsr_case_event'`,
    );
    const evNomes = new Set(ev.map((r) => r.column_name));
    for (const c of ['id', 'case_id', 'at', 'event', 'from_status', 'to_status', 'actor_ref', 'detail']) {
      assert.ok(evNomes.has(c), `coluna de evento ausente: ${c}`);
    }
    const { rows: ck } = await client.query(
      `select conname from pg_constraint where conrelid = 'app.dsr_case'::regclass and contype = 'c'`,
    );
    const checks = new Set(ck.map((r) => r.conname));
    for (const c of ['dsr_case_protocol_check', 'dsr_case_kind_check', 'dsr_case_status_check', 'dsr_case_channel_check',
      'dsr_case_outcome_check', 'dsr_case_fechamento_check', 'dsr_case_desfecho_check', 'dsr_case_canal_operador_check',
      'dsr_case_prazo_check', 'dsr_case_details_check', 'dsr_case_nota_nao_vazia_check']) {
      assert.ok(checks.has(c), `restricao ausente: ${c}`);
    }
  });
});

test('T-DB-02 | RLS forcada nas duas tabelas; papeis de API, anon e authenticated sem privilegio direto', async () => {
  await tx(async () => {
    const { rows } = await client.query(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relname in ('dsr_case', 'dsr_case_event')`,
    );
    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.equal(r.relrowsecurity, true, `RLS habilitada em ${r.relname}`);
      assert.equal(r.relforcerowsecurity, true, `RLS forcada em ${r.relname}`);
    }
    for (const papel of ['anon', 'authenticated', 'app_api', PAPEL_SERVICO]) {
      for (const tabela of ['app.dsr_case', 'app.dsr_case_event']) {
        for (const priv of ['select', 'insert', 'update', 'delete']) {
          const { rows: p } = await client.query('select has_table_privilege($1, $2, $3) as ok', [papel, tabela, priv]);
          assert.equal(p[0].ok, false, `${papel} nao deve ter ${priv} em ${tabela}`);
        }
      }
    }
    const { rows: leitura } = await client.query(
      `select has_table_privilege('app_system', 'app.dsr_case', 'select') as le,
              has_table_privilege('app_system', 'app.dsr_case', 'insert') as escreve`,
    );
    assert.equal(leitura[0].le, true, 'app_system le o caso');
    assert.equal(leitura[0].escreve, false, 'app_system nao escreve direto (escrita por funcao)');
  });
});

test('T-DB-02 | papel anon e authenticated recebem permission denied ao ler e gravar', async () => {
  await tx(async () => {
    for (const papel of ['anon', 'authenticated']) {
      await client.query(`set local role ${papel}`);
      const lido = await erroDe('select count(*) from app.dsr_case');
      assert.equal(lido.code, '42501', `${papel} leitura`);
      const gravado = await erroDe(
        `insert into app.dsr_case (protocol, subject_user_id, kind, deadline_at) values ($1, gen_random_uuid(), 'acesso', now())`,
        [protocolo()],
      );
      assert.equal(gravado.code, '42501', `${papel} escrita`);
      await client.query('reset role');
    }
  });
});

test('T-DB-04 | um caso ativo por titular e tipo; deferido conta como ativo; terminal libera nova abertura', async () => {
  await tx(async () => {
    const titular = await usuario();
    const c1 = await criarCaso(titular, 'acesso');
    const dup = await erroDe(
      `insert into app.dsr_case (protocol, subject_user_id, kind, deadline_at) values ($1, $2, 'acesso', now() + interval '15 days')`,
      [protocolo(), titular],
    );
    assert.equal(dup.code, '23505', 'segundo caso aberto do mesmo tipo recusado');

    await mover(c1, { status: 'em_analise', assigned_to: null });
    await mover(c1, { status: 'deferido' });
    const dupDeferido = await erroDe(
      `insert into app.dsr_case (protocol, subject_user_id, kind, deadline_at) values ($1, $2, 'acesso', now() + interval '15 days')`,
      [protocolo(), titular],
    );
    assert.equal(dupDeferido.code, '23505', 'deferido ainda conta como ativo (D-A1)');

    await criarCaso(titular, 'correcao');
    const dupCorrecao = await erroDe(
      `insert into app.dsr_case (protocol, subject_user_id, kind, deadline_at) values ($1, $2, 'correcao', now() + interval '15 days')`,
      [protocolo(), titular],
    );
    assert.equal(dupCorrecao.code, '23505', 'segunda correcao ativa recusada');

    const outroTitular = await usuario();
    const c2 = await criarCaso(outroTitular, 'eliminacao');
    await mover(c2, { status: 'cancelado', outcome: 'cancelado_pelo_titular', closed_at: agora() });
    const reabre = await criarCaso(outroTitular, 'eliminacao');
    assert.ok(reabre, 'apos terminal, nova abertura do mesmo tipo e aceita');
  });
});

test('T-DB-05 | transicoes validas passam; saltos e alteracao de estado terminal sao recusados', async () => {
  await tx(async () => {
    const titular = await usuario();
    const c = await criarCaso(titular, 'acesso');
    await mover(c, { status: 'em_analise' });
    await mover(c, { status: 'deferido' });
    await mover(c, { status: 'concluido', outcome: 'extrato_disponibilizado', closed_at: agora() });
    const { rows } = await client.query('select status from app.dsr_case where id = $1', [c]);
    assert.equal(rows[0].status, 'concluido');

    const reabre = atualizar(c, { status: 'aberto', outcome: null, closed_at: null });
    const err1 = await erroDe(reabre.sql, reabre.params);
    assert.match(err1.message, /violacao_maquina_estados/, 'concluido -> aberto recusado');
    const mesmo = atualizar(c, { status: 'concluido' });
    const err2 = await erroDe(mesmo.sql, mesmo.params);
    assert.match(err2.message, /violacao_maquina_estados/, 'terminal nao muda nem para o mesmo estado');

    const salto = await criarCaso(await usuario(), 'acesso');
    const pulo = atualizar(salto, { status: 'concluido', outcome: 'extrato_disponibilizado', closed_at: agora() });
    const err3 = await erroDe(pulo.sql, pulo.params);
    assert.match(err3.message, /violacao_maquina_estados/, 'aberto -> concluido (pulo) recusado');
  });
});

test('T-DB-06 | identidade do caso e imutavel: protocolo, titular, tipo, canal, abertura e prazo', async () => {
  await tx(async () => {
    const titular = await usuario();
    const outro = await usuario();
    const c = await criarCaso(titular, 'acesso');
    const trocas = [
      { protocol: protocolo() },
      { subject_user_id: outro },
      { kind: 'correcao' },
      { opened_at: agora() },
      { deadline_at: agora() },
      { channel: 'dpo_externo' },
    ];
    for (const campos of trocas) {
      const { sql, params } = atualizar(c, campos);
      const err = await erroDe(sql, params);
      assert.match(err.message, /dsr_case_imutavel/, `imutavel: ${Object.keys(campos)[0]}`);
    }
  });
});

test('T-DB-07 | indeferimento e conclusao de eliminacao exigem nota com texto (nula, vazia, so espacos ou quebra)', async () => {
  await tx(async () => {
    for (const nota of [null, '', '   ', '\n\t']) {
      const c = await criarCaso(await usuario(), 'correcao');
      const { sql, params } = atualizar(c, { status: 'indeferido_total', outcome: 'recusado_fraude_identidade', closed_at: agora(), legal_basis_note: nota });
      const err = await erroDe(sql, params);
      assert.match(err.message, /nota_base_legal_obrigatoria/, `indeferido sem nota ${JSON.stringify(nota)}`);
    }
    const eliminacao = await criarCaso(await usuario(), 'eliminacao');
    await mover(eliminacao, { status: 'deferido' });
    const { sql, params } = atualizar(eliminacao, { status: 'concluido', outcome: 'conta_anonimizada', closed_at: agora(), legal_basis_note: '  ' });
    const err = await erroDe(sql, params);
    assert.match(err.message, /nota_base_legal_obrigatoria/, 'concluido de eliminacao sem nota');

    const c = await criarCaso(await usuario(), 'correcao');
    await mover(c, { status: 'indeferido_total', outcome: 'recusado_fraude_identidade', closed_at: agora(), legal_basis_note: NOTA });
    const { rows } = await client.query('select status, legal_basis_note from app.dsr_case where id = $1', [c]);
    assert.equal(rows[0].status, 'indeferido_total');
    assert.equal(rows[0].legal_basis_note, NOTA);
  });
});

test('T-DB-08 | closed_at e outcome obrigatorios em terminal e proibidos fora dele; desfecho coerente com o tipo', async () => {
  await tx(async () => {
    const titular = await usuario();
    const invalido = await erroDe(
      `insert into app.dsr_case (protocol, subject_user_id, kind, deadline_at, outcome)
       values ($1, $2, 'acesso', now() + interval '15 days', 'extrato_disponibilizado')`,
      [protocolo(), titular],
    );
    assert.equal(invalido.code, '23514', 'outcome em caso aberto recusado');

    const comFechamento = await erroDe(
      `insert into app.dsr_case (protocol, subject_user_id, kind, deadline_at, closed_at)
       values ($1, $2, 'acesso', now() + interval '15 days', now())`,
      [protocolo(), titular],
    );
    assert.equal(comFechamento.code, '23514', 'closed_at em caso aberto recusado');

    const c = await criarCaso(titular, 'correcao');
    const semFechamento = atualizar(c, { status: 'indeferido_total', outcome: 'recusado_fraude_identidade', legal_basis_note: NOTA });
    const e1 = await erroDe(semFechamento.sql, semFechamento.params);
    assert.equal(e1.code, '23514', 'terminal sem closed_at recusado');

    const semDesfecho = atualizar(c, { status: 'indeferido_total', closed_at: agora(), legal_basis_note: NOTA });
    const e2 = await erroDe(semDesfecho.sql, semDesfecho.params);
    assert.equal(e2.code, '23514', 'terminal sem outcome recusado');

    const acesso = await criarCaso(await usuario(), 'acesso');
    await mover(acesso, { status: 'deferido' });
    const trocado = atualizar(acesso, { status: 'concluido', outcome: 'conta_anonimizada', closed_at: agora() });
    const e3 = await erroDe(trocado.sql, trocado.params);
    assert.equal(e3.code, '23514', 'conta_anonimizada em caso de acesso recusado');

    const cancel = await criarCaso(await usuario(), 'acesso');
    const cancelErrado = atualizar(cancel, { status: 'cancelado', outcome: 'extrato_disponibilizado', closed_at: agora() });
    const e4 = await erroDe(cancelErrado.sql, cancelErrado.params);
    assert.equal(e4.code, '23514', 'cancelado com desfecho de extrato recusado');

    const eliminacao = await criarCaso(await usuario(), 'eliminacao');
    await mover(eliminacao, { status: 'deferido' });
    await mover(eliminacao, { status: 'concluido', outcome: 'conta_anonimizada', closed_at: agora(), legal_basis_note: NOTA });
    const { rows } = await client.query('select outcome from app.dsr_case where id = $1', [eliminacao]);
    assert.equal(rows[0].outcome, 'conta_anonimizada', 'eliminacao concluida com desfecho coerente');
  });
});

test('T-DB-09 | caso nao pode ser excluido; linha do tempo e append-only (update e delete recusados)', async () => {
  await tx(async () => {
    const c = await criarCaso(await usuario(), 'acesso');
    const apagar = await erroDe('delete from app.dsr_case where id = $1', [c]);
    assert.match(apagar.message, /dsr_case_nao_deletavel/, 'delete de caso recusado');

    await client.query(
      `insert into app.dsr_case_event (case_id, event, from_status, to_status, detail) values ($1, 'opened', null, 'aberto', '{}')`,
      [c],
    );
    const ev = await client.query('select id from app.dsr_case_event where case_id = $1', [c]);
    assert.equal(ev.rows.length, 1);
    const alterar = await erroDe('update app.dsr_case_event set event = $2 where id = $1', [ev.rows[0].id, 'closed']);
    assert.match(alterar.message, /dsr_evento_imutavel/, 'update de evento recusado');
    const remover = await erroDe('delete from app.dsr_case_event where id = $1', [ev.rows[0].id]);
    assert.match(remover.message, /dsr_evento_imutavel/, 'delete de evento recusado');
  });
});

test('criacao | o caso nasce aberto, ou ja indeferido_total com nota (retencao legal); demais estados recusados', async () => {
  await tx(async () => {
    const titular = await usuario();
    const emAnalise = await erroDe(
      `insert into app.dsr_case (protocol, subject_user_id, kind, status, deadline_at)
       values ($1, $2, 'acesso', 'em_analise', now() + interval '15 days')`,
      [protocolo(), titular],
    );
    assert.match(emAnalise.message, /dsr_criacao_estado_invalido/, 'criar em em_analise recusado');

    const semNota = await erroDe(
      `insert into app.dsr_case (protocol, subject_user_id, kind, status, deadline_at, closed_at, outcome)
       values ($1, $2, 'eliminacao', 'indeferido_total', now() + interval '15 days', now(), 'recusado_impedimento_legal')`,
      [protocolo(), titular],
    );
    assert.match(semNota.message, /nota_base_legal_obrigatoria/, 'indeferido na criacao sem nota recusado');

    const { rows } = await client.query(
      `insert into app.dsr_case (protocol, subject_user_id, kind, status, deadline_at, closed_at, outcome, legal_basis_note)
       values ($1, $2, 'eliminacao', 'indeferido_total', now() + interval '15 days', now(), 'recusado_impedimento_legal', $3)
       returning status`,
      [protocolo(), titular, NOTA],
    );
    assert.equal(rows[0].status, 'indeferido_total', 'retencao legal cria o caso ja indeferido com nota');
  });
});

test('T-DB-01 | protocolo, canal, desfecho e tipo fora dos conjuntos sao recusados', async () => {
  await tx(async () => {
    const titular = await usuario();
    const operador = await usuario();
    const protocoloRuim = await erroDe(
      `insert into app.dsr_case (protocol, subject_user_id, kind, deadline_at) values ('DSR-2026-XX', $1, 'acesso', now() + interval '15 days')`,
      [titular],
    );
    assert.equal(protocoloRuim.code, '23514', 'protocolo fora do formato');

    const tipoRuim = await erroDe(
      `insert into app.dsr_case (protocol, subject_user_id, kind, deadline_at) values ($1, $2, 'livre', now() + interval '15 days')`,
      [protocolo(), titular],
    );
    assert.equal(tipoRuim.code, '23514', 'tipo fora da lista');

    const canalSemOperador = await erroDe(
      `insert into app.dsr_case (protocol, subject_user_id, kind, channel, deadline_at) values ($1, $2, 'acesso', 'dpo_externo', now() + interval '15 days')`,
      [protocolo(), titular],
    );
    assert.equal(canalSemOperador.code, '23514', 'canal dpo_externo exige operador');

    const operadorNoTitular = await erroDe(
      `insert into app.dsr_case (protocol, subject_user_id, kind, opened_by_operator_id, deadline_at) values ($1, $2, 'acesso', $3, now() + interval '15 days')`,
      [protocolo(), titular, operador],
    );
    assert.equal(operadorNoTitular.code, '23514', 'operador em canal titular recusado');

    const comCanal = await client.query(
      `insert into app.dsr_case (protocol, subject_user_id, kind, channel, opened_by_operator_id, deadline_at)
       values ($1, $2, 'acesso', 'dpo_externo', $3, now() + interval '15 days') returning id`,
      [protocolo(), titular, operador],
    );
    assert.ok(comCanal.rows[0].id, 'canal dpo_externo com operador aceito');

    const evento = await erroDe(
      `insert into app.dsr_case_event (case_id, event, detail) values ($1, 'tratado', '{}')`,
      [comCanal.rows[0].id],
    );
    assert.equal(evento.code, '23514', 'evento fora da lista');
  });
});

test('parametros privacy.* semeados no DEV com os valores do desenho (§3.2)', async () => {
  const { rows } = await client.query(
    `select key, value from ops.app_config where key like 'privacy.dsr_%' order by key`,
  );
  const mapa = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  assert.equal(mapa['privacy.dsr_deadline_days'], 15);
  assert.equal(mapa['privacy.dsr_export_ttl_days'], 7);
  assert.equal(mapa['privacy.dsr_export_min_interval_days'], 30);
  assert.equal(mapa['privacy.dsr_step_up_minutes'], 15);
});

test('T-DB-01 | gatilhos esperados presentes na tabela do caso e na linha do tempo', async () => {
  const { rows } = await client.query(
    `select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'app' and c.relname in ('dsr_case', 'dsr_case_event') and not t.tgisinternal`,
  );
  const nomes = new Set(rows.map((r) => `${r.relname}.${r.tgname}`));
  for (const esperado of ['dsr_case.dsr_case_insert_guard', 'dsr_case.dsr_case_guard', 'dsr_case.dsr_case_no_delete',
    'dsr_case_event.dsr_case_event_no_mutation']) {
    assert.ok(nomes.has(esperado), `gatilho ausente: ${esperado}`);
  }
});
