// H-058 (Issue #71) | Testes de banco das tabelas de aceite e de chat (162-DESENHO-H058.md, §7, fatia 2).
// Cobre T-H058-24 (colunas sem preco/prazo/texto/anexo), T-H058-36 (privilegios), T-H058-37 (gatilhos de
// defesa em profundidade) e a parte de T-H058-27 que nao depende da funcao de aceite (mensagem de sistema).
// Banco de desenvolvimento COMPARTILHADO: uma transacao aberta no before; cada teste roda num savepoint
// desfeito; rollback no after. Dados 100 % sinteticos (prefixo h058-), sem rede, sem envio.
// Executar sozinho: node --test --test-concurrency=1 packages/db/tests/acceptance-tabelas.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';
import { concederAcessoVigente } from './fixtures/professional-access.mjs';

const AGORA = '2099-08-15T12:00:00.000Z';
const MARCA = `h058-${randomUUID().slice(0, 8)}`;
const SP = { lon: -46.6333, lat: -23.5505 };
const sha = (s) => createHash('sha256').update(s).digest('hex');

let client;

before(async () => {
  client = await connect();
  await client.query('begin');
});

after(async () => {
  await client.query('rollback');
  await client.end();
});

async function isolado(fn) {
  await client.query('savepoint t');
  try {
    await fn();
  } finally {
    await client.query('rollback to savepoint t');
  }
}

/** Executa a consulta esperando erro; devolve o erro. Falha se a consulta passar. */
async function erroEm(sql, params = []) {
  await client.query('savepoint e');
  try {
    await client.query(sql, params);
  } catch (err) {
    await client.query('rollback to savepoint e');
    return err;
  }
  await client.query('rollback to savepoint e');
  assert.fail('esperava erro e a consulta devolveu resultado');
}

async function usuario(c) {
  const id = randomUUID();
  await c.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, 'ativo', $4, $4)`,
    [id, `${MARCA}-${id.slice(0, 8)}@example.test`, randomUUID(), AGORA],
  );
  return id;
}

async function profissional(c) {
  const id = await usuario(c);
  await c.query(
    `insert into app.professional_profile (user_id, verification_status, verified_at, created_at, updated_at)
     values ($1, 'aprovada', $2, $2, $2)`,
    [id, AGORA],
  );
  await concederAcessoVigente(c, id, AGORA);
  return id;
}

async function ponto(c, tipo, sujeito) {
  const r = await c.query(
    `insert into app.geocode_point (subject_kind, subject_id, address_hash, state, exact_point, geocode_mode, precision, geocoded_at)
     values ($1, $2, $3, 'ok',
             extensions.st_setsrid(extensions.st_makepoint($4, $5), 4326)::extensions.geography,
             'permanent', 'endereco', $6)
     returning id`,
    [tipo, sujeito, sha(`end-${randomUUID()}`), SP.lon, SP.lat, AGORA],
  );
  return r.rows[0].id;
}

async function servico(c) {
  const grupo = randomUUID();
  const id = randomUUID();
  await c.query(
    'insert into app.service_group (id, name, position, active) values ($1, $2, 1, true)',
    [grupo, `Grupo ${MARCA} ${grupo.slice(0, 6)}`],
  );
  await c.query(
    `insert into app.service (id, group_id, name, modality, regulated, active)
     values ($1, $2, $3, 'presencial', false, true)`,
    [id, grupo, `Servico ${MARCA} ${id.slice(0, 6)}`],
  );
  return id;
}

async function rascunho(c, svc) {
  const id = randomUUID();
  const expira = new Date(Date.parse(AGORA) + 7 * 86400000).toISOString();
  const email = `${MARCA}-rascunho-${id.slice(0, 8)}@example.test`;
  await c.query(
    `insert into app.request_draft (id, browser_nonce_hash, service_id, address_text, urgency, description, status,
                                    expires_at, ip_hmac, created_at, updated_at, first_name, email, email_hmac,
                                    email_verified_at, confirmed_at)
     values ($1, $2, $3, 'Rua sintetica 1', 'imediato', 'Descricao sintetica', 'aberto',
             $4, $5, $6, $6, 'Ana', $7, $8, $6, $6)`,
    [id, sha(`cookie-${id}`), svc, expira, sha('ip-sintetico'), AGORA, email, sha(email)],
  );
  return id;
}

/** Pedido publicado sintetico (publicado em AGORA, prazo AGORA + 168 h). */
async function pedido(c, svc) {
  const cliente = await usuario(c);
  const rasc = await rascunho(c, svc);
  const g = await ponto(c, 'request', rasc);
  const r = await c.query(
    `insert into app.service_request (customer_user_id, service_id, status, urgency, description, address_text, first_name,
                                      geocode_point_id, origin_draft_id, published_at, acceptance_deadline_at)
     select $1::uuid, $2::uuid, 'publicado', 'imediato', 'Descricao sintetica', 'Rua sintetica 1', 'Ana', $3::uuid, $4::uuid,
            d.dl - interval '168 hours', d.dl
       from (select $5::timestamptz + interval '168 hours' as dl) d
     returning id`,
    [cliente, svc, g, rasc, AGORA],
  );
  return { id: r.rows[0].id, cliente };
}

/** Aceite direto no banco (fixture; a funcao de aceite e da fatia 3). Devolve o id. */
async function aceiteDireto(
  c,
  { pedidoId, prof, slot, identidade = randomUUID(), aceitoEm = AGORA },
) {
  const r = await c.query(
    `insert into app.acceptance (request_id, professional_id, identity_id, slot_no, accepted_at)
     values ($1, $2, $3, $4, $5) returning id`,
    [pedidoId, prof, identidade, slot, aceitoEm],
  );
  return r.rows[0].id;
}

async function conversaDireta(c, { pedidoId, prof, cliente, aceiteId }) {
  const r = await c.query(
    `insert into app.conversation (request_id, customer_user_id, professional_id, acceptance_id)
     values ($1, $2, $3, $4) returning id`,
    [pedidoId, cliente, prof, aceiteId],
  );
  return r.rows[0].id;
}

async function mensagemSistema(
  c,
  conversaId,
  { dedupe = `acceptance:${randomUUID()}:accepted` } = {},
) {
  const r = await c.query(
    `insert into app.message (conversation_id, kind, system_event, template_version, dedupe_key, params)
     values ($1, 'sistema', 'aceite', 1, $2, '{}'::jsonb) returning id`,
    [conversaId, dedupe],
  );
  return r.rows[0].id;
}

test('T-H058-24: colunas de aceite, conversa e mensagem sem preco, prazo, texto livre ou anexo', async () => {
  await isolado(async () => {
    const colunas = async (tabela) =>
      (
        await client.query(
          `select column_name from information_schema.columns
            where table_schema = 'app' and table_name = $1 order by ordinal_position`,
          [tabela],
        )
      ).rows.map((r) => r.column_name);
    assert.deepEqual(await colunas('acceptance'), [
      'id',
      'request_id',
      'professional_id',
      'identity_id',
      'slot_no',
      'wave',
      'status',
      'accepted_at',
      'withdrawn_at',
      'removed_reason',
      'created_at',
    ]);
    const proibidas =
      /preco|price|valor|prazo|deadline|texto|text|anexo|attach|mensagem|message|body/i;
    for (const t of ['acceptance', 'conversation']) {
      for (const col of await colunas(t)) assert.doesNotMatch(col, proibidas, `${t}.${col}`);
    }
  });
});

test('T-H058-36: anon, authenticated, service_role, app_api e app_backup_reader nao leem nem escrevem', async () => {
  for (const tabela of ['app.acceptance', 'app.conversation', 'app.message']) {
    for (const papel of ['anon', 'authenticated', 'service_role', 'app_api', 'app_backup_reader']) {
      for (const priv of ['select', 'insert', 'update', 'delete']) {
        const r = await client.query('select has_table_privilege($1, $2, $3) as ok', [
          papel,
          tabela,
          priv,
        ]);
        assert.equal(r.rows[0].ok, false, `${papel} ${priv} em ${tabela}`);
      }
    }
  }
  const sistema = await client.query(
    "select has_table_privilege('app_system', 'app.acceptance', 'insert') as ok",
  );
  assert.equal(sistema.rows[0].ok, false, 'app_system nao insere direto: escrita so pela funcao');
});

test('T-H058-37: insercao direta fora da funcao e recusada pelo banco (dono, vaga, onda, fechado, prazo, limite)', async () => {
  await isolado(async () => {
    const svc = await servico(client);
    const { id: pid, cliente } = await pedido(client, svc);

    // Dono do pedido: o gatilho de I-19 recusa (profissional = cliente do pedido).
    await client.query(
      `insert into app.professional_profile (user_id, verification_status, verified_at, created_at, updated_at)
       values ($1, 'aprovada', $2, $2, $2)`,
      [cliente, AGORA],
    );
    let e = await erroEm(
      `insert into app.acceptance (request_id, professional_id, identity_id, slot_no, accepted_at)
       values ($1, $2, gen_random_uuid(), 1, $3)`,
      [pid, cliente, AGORA],
    );
    assert.match(e.message, /aceite_proprio_pedido/);

    const prof = await profissional(client);
    // Vaga errada: slot 2 com contagem zero.
    e = await erroEm(
      `insert into app.acceptance (request_id, professional_id, identity_id, slot_no, accepted_at)
       values ($1, $2, gen_random_uuid(), 2, $3)`,
      [pid, prof, AGORA],
    );
    assert.match(e.message, /aceite_vaga_incorreta/);

    // Sem segunda onda: contagem 4 (vagas 1..4 usadas), o 5o e recusado.
    // A funcao de aceite (fatia 3) incrementa a contagem; aqui a fixture simula isso a cada vaga.
    for (let slot = 1; slot <= 4; slot += 1) {
      await aceiteDireto(client, { pedidoId: pid, prof: await profissional(client), slot });
      await client.query(
        'update app.service_request set acceptances_count = acceptances_count + 1 where id = $1',
        [pid],
      );
    }
    e = await erroEm(
      `insert into app.acceptance (request_id, professional_id, identity_id, slot_no, accepted_at)
       values ($1, $2, gen_random_uuid(), 5, $3)`,
      [pid, prof, AGORA],
    );
    assert.match(e.message, /aceite_sem_vaga/);

    // Com a segunda onda aberta e contagem 8, o 9o e recusado.
    await client.query(
      'update app.service_request set wave2_opened_at = $2, acceptances_count = 8 where id = $1',
      [pid, AGORA],
    );
    e = await erroEm(
      `insert into app.acceptance (request_id, professional_id, identity_id, slot_no, accepted_at)
       values ($1, $2, gen_random_uuid(), 9, $3)`,
      [pid, prof, AGORA],
    );
    assert.match(e.message, /aceite_sem_vaga/);
  });

  await isolado(async () => {
    const svc = await servico(client);
    const { id: pid } = await pedido(client, svc);
    const prof = await profissional(client);
    // Pedido ja selecionado: admissao encerrada.
    await client.query("update app.service_request set status = 'selecionado' where id = $1", [
      pid,
    ]);
    let e = await erroEm(
      `insert into app.acceptance (request_id, professional_id, identity_id, slot_no, accepted_at)
       values ($1, $2, gen_random_uuid(), 1, $3)`,
      [pid, prof, AGORA],
    );
    assert.match(e.message, /aceite_fora_do_prazo/);
  });

  await isolado(async () => {
    const svc = await servico(client);
    const { id: pid } = await pedido(client, svc);
    const prof = await profissional(client);
    // Instante igual ou posterior ao prazo (aberto a direita): recusado.
    const e = await erroEm(
      `insert into app.acceptance (request_id, professional_id, identity_id, slot_no, accepted_at)
       values ($1, $2, gen_random_uuid(), 1, (select acceptance_deadline_at from app.service_request where id = $1))`,
      [pid, prof],
    );
    assert.match(e.message, /aceite_fora_do_prazo/);
  });
});

test('T-H058-27 (parte de banco): mensagem de sistema sem remetente; UPDATE, DELETE e insercao humana recusados', async () => {
  await isolado(async () => {
    const svc = await servico(client);
    const { id: pid, cliente } = await pedido(client, svc);
    const prof = await profissional(client);
    const aceite = await aceiteDireto(client, { pedidoId: pid, prof, slot: 1 });
    const conversa = await conversaDireta(client, {
      pedidoId: pid,
      prof,
      cliente,
      aceiteId: aceite,
    });
    const msg = await mensagemSistema(client, conversa, {
      dedupe: `acceptance:${aceite}:accepted`,
    });

    const linha = (
      await client.query(
        'select kind, sender_user_id, system_event, body_text, dedupe_key, template_version, state from app.message where id = $1',
        [msg],
      )
    ).rows[0];
    assert.deepEqual(linha, {
      kind: 'sistema',
      sender_user_id: null,
      system_event: 'aceite',
      body_text: null,
      dedupe_key: `acceptance:${aceite}:accepted`,
      template_version: 1,
      state: 'enviada',
    });

    let e = await erroEm('update app.message set state = $2 where id = $1', [msg, 'restrita']);
    assert.match(e.message, /mensagem_imutavel/);
    e = await erroEm('delete from app.message where id = $1', [msg]);
    assert.match(e.message, /mensagem_imutavel/);
    e = await erroEm(
      `insert into app.message (conversation_id, kind, sender_user_id, client_message_id, body_text)
       values ($1, 'humana', $2, gen_random_uuid(), 'oi')`,
      [conversa, cliente],
    );
    assert.match(e.message, /mensagem_humana_indisponivel/);
    // Dedupe por conversa: a mesma chave de sistema nao se repete.
    e = await erroEm(
      `insert into app.message (conversation_id, kind, system_event, template_version, dedupe_key)
       values ($1, 'sistema', 'aceite', 1, $2)`,
      [conversa, `acceptance:${aceite}:accepted`],
    );
    assert.equal(e.code, '23505');
    // Texto gravado na mensagem de sistema e recusado pela forma.
    e = await erroEm(
      `insert into app.message (conversation_id, kind, system_event, template_version, dedupe_key, body_text)
       values ($1, 'sistema', 'aceite', 1, 'outra-chave', 'Estou disponível para trabalhar')`,
      [conversa],
    );
    assert.equal(e.code, '23514');
  });
});

test('aceite e conversa: retirada so vai de ativo para retirado; sem remocao; chaves imutaveis', async () => {
  await isolado(async () => {
    const svc = await servico(client);
    const { id: pid, cliente } = await pedido(client, svc);
    const prof = await profissional(client);
    const aceite = await aceiteDireto(client, { pedidoId: pid, prof, slot: 1 });
    await client.query(
      'update app.service_request set acceptances_count = acceptances_count + 1 where id = $1',
      [pid],
    );

    let e = await erroEm('update app.acceptance set accepted_at = $2 where id = $1', [
      aceite,
      '2099-08-16T00:00:00Z',
    ]);
    assert.match(e.message, /aceite_campo_imutavel/);
    e = await erroEm('delete from app.acceptance where id = $1', [aceite]);
    assert.match(e.message, /registro_nao_removivel/);

    await client.query(
      "update app.acceptance set status = 'retirado', withdrawn_at = $2 where id = $1",
      [aceite, AGORA],
    );
    e = await erroEm(
      "update app.acceptance set status = 'ativo', withdrawn_at = null where id = $1",
      [aceite],
    );
    assert.match(e.message, /aceite_transicao_invalida/);

    // Conversa: nasce ativa, chaves batem com o aceite ativo (o aceite acima ja esta retirado).
    const aceite2 = await aceiteDireto(client, {
      pedidoId: pid,
      prof: await profissional(client),
      slot: 2,
    });
    const outroProf = await profissional(client);
    e = await erroEm(
      `insert into app.conversation (request_id, customer_user_id, professional_id, acceptance_id)
       values ($1, $2, $3, $4)`,
      [pid, cliente, outroProf, aceite2],
    );
    assert.match(e.message, /conversa_chave_inconsistente/);
    e = await erroEm(
      `insert into app.conversation (request_id, customer_user_id, professional_id, acceptance_id, state)
       values ($1, $2, (select professional_id from app.acceptance where id = $3), $3, 'somente_leitura')`,
      [pid, cliente, aceite2],
    );
    assert.match(e.message, /conversa_inicia_ativa/);
    const conversa = await conversaDireta(client, {
      pedidoId: pid,
      prof: (
        await client.query('select professional_id from app.acceptance where id = $1', [aceite2])
      ).rows[0].professional_id,
      cliente,
      aceiteId: aceite2,
    });
    // Valor diferente do atual: o gatilho recusa antes da checagem de chave estrangeira.
    e = await erroEm('update app.conversation set request_id = $2 where id = $1', [
      conversa,
      randomUUID(),
    ]);
    assert.match(e.message, /conversa_campo_imutavel/);
    e = await erroEm('delete from app.conversation where id = $1', [conversa]);
    assert.match(e.message, /registro_nao_removivel/);
  });
});
