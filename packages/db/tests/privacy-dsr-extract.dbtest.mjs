// Issue 120 (H-111) | Extrato de acesso no banco (147-DESENHO-H111 §4.3, §7: T-DB-03, T-UN-01, T-UN-02 e T-UN-04
// na camada do banco, e o fluxo gerar -> registrar -> consultar). Banco de desenvolvimento. Cada teste roda em
// transacao e e desfeito (rollback). Valores sinteticos (@example.test). Sem rede, sem e-mail real.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

const hex = () => randomBytes(32).toString('hex');
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PROTOCOLO = /^DSR-\d{8}-[A-Z2-7]{6}$/;
const SECOES_ESPERADAS = [
  'cadastro',
  'perfil_cliente',
  'perfil_profissional',
  'areas_de_atuacao',
  'servicos_profissional',
  'documentos_verificacao',
  'pedidos',
  'consentimentos_de_contato',
  'revelacoes_de_contato',
  'assinatura',
  'acessos_comerciais',
];
// Chaves que nunca podem aparecer no extrato, em nenhum nivel (allowlist do desenho §4.3).
const CHAVES_PROIBIDAS = [
  'auth_user_id',
  'document_enc',
  'document_hmac',
  'email_hmac',
  'phone_enc',
  'address_text_enc',
  'exact_point',
  'suspension_reason',
  'retention_state',
  'storage_path',
  'signature',
  'sha256',
  'token',
  'password',
  'audit',
  'session',
  'challenge',
  'provider',
  'geocode_point_id',
  'professional_id',
  'consent_id',
  'user_id',
];

function protocolo() {
  let sufixo = '';
  for (let i = 0; i < 6; i += 1) sufixo += B32[randomBytes(1)[0] % 32];
  return `DSR-20261119-${sufixo}`;
}

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

async function contar(sql, params) {
  const { rows } = await client.query(sql, params);
  return Number(rows[0].n);
}

async function usuario(status = 'ativo') {
  const id = randomUUID();
  await client.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, $4, now(), now())`,
    [id, `${randomUUID()}@example.test`, randomUUID(), status],
  );
  return id;
}

async function profissional(id) {
  await client.query(
    `insert into app.professional_profile (user_id, verification_status, verified_at, created_at, updated_at)
     values ($1, 'aprovada', now(), now(), now())`,
    [id],
  );
  // Nome publico e slug exigem documento preenchido (CPF, cifrado e HMAC) na regra de cadastro do perfil.
  await client.query(
    `update app.professional_profile
        set document_type = 'CPF', document_enc = $2::bytea, document_hmac = $3,
            public_name = $4, slug = $5
      where user_id = $1`,
    [id, Buffer.from(hex(), 'hex'), hex(), `Nome publico ${id.slice(0, 8)}`, `pro-${id.slice(0, 8)}`],
  );
}

/** Pedido publicado do cliente, com rascunho confirmado e ponto geocodificado (mesma regra do pedido). */
async function pedido(cliente, descricao) {
  const grupo = randomUUID();
  const servico = randomUUID();
  await client.query('insert into app.service_group (id, name, position, active) values ($1, $2, 1, true)', [
    grupo,
    `Grupo teste ${grupo.slice(0, 6)}`,
  ]);
  await client.query(
    `insert into app.service (id, group_id, name, modality, regulated, active)
     values ($1, $2, $3, 'presencial', false, true)`,
    [servico, grupo, `Servico teste ${servico.slice(0, 6)}`],
  );
  const rascunho = randomUUID();
  const email = `${randomUUID()}@example.test`;
  await client.query(
    `insert into app.request_draft (id, browser_nonce_hash, service_id, address_text, urgency, description, status,
                                    expires_at, ip_hmac, created_at, updated_at, first_name, email, email_hmac,
                                    email_verified_at, confirmed_at)
     values ($1, $2, $3, 'Rua sintetica 1', 'imediato', 'Descricao sintetica', 'aberto',
             now() + interval '1 day', $4, now(), now(), 'Ana', $5, $6, now(), now())`,
    [rascunho, hex(), servico, hex(), email, hex()],
  );
  const ponto = await client.query(
    `insert into app.geocode_point (subject_kind, subject_id, address_hash, state, exact_point, geocode_mode, precision, geocoded_at)
     values ('request', $1, $2, 'ok',
             extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography,
             'permanent', 'endereco', now())
     returning id`,
    [rascunho, hex()],
  );
  const { rows } = await client.query(
    `insert into app.service_request (customer_user_id, service_id, status, urgency, description, address_text,
                                      first_name, geocode_point_id, origin_draft_id, published_at, acceptance_deadline_at)
     values ($1, $2, 'publicado', 'imediato', $3, 'Rua sintetica 1', 'Ana', $4, $5, now(), now() + interval '168 hours')
     returning id`,
    [cliente, servico, descricao, ponto.rows[0].id, rascunho],
  );
  return rows[0].id;
}

/** Caso de acesso (ou outro tipo) ja em deferido, pronto para gerar o extrato. */
async function casoDeferido(sujeito, kind = 'acesso') {
  const { rows } = await client.query(
    `insert into app.dsr_case (protocol, subject_user_id, kind, deadline_at)
     values ($1, $2, $3, now() + interval '15 days') returning id`,
    [protocolo(), sujeito, kind],
  );
  const caso = rows[0].id;
  await client.query(`update app.dsr_case set status = 'em_analise' where id = $1`, [caso]);
  await client.query(`update app.dsr_case set status = 'deferido' where id = $1`, [caso]);
  return caso;
}

const GERAR = 'select out_case_id, out_protocol, out_payload from app.dsr_generate_extract($1::uuid)';
const REGISTRAR =
  'select out_case_id, out_status, out_expires_at from app.dsr_register_extract($1::uuid, $2, $3, $4, $5::integer)';

async function gerar(caso) {
  const { rows } = await client.query(GERAR, [caso]);
  return rows[0];
}

async function registrar(caso, { caminho = `${randomUUID()}.json`, tamanho = 2048 } = {}) {
  const { rows } = await client.query(REGISTRAR, [caso, caminho, hex(), hex(), tamanho]);
  return rows[0];
}

async function estadoCaso(caso) {
  const { rows } = await client.query('select status, outcome, closed_at from app.dsr_case where id = $1', [caso]);
  return rows[0];
}

/** Coleta todas as chaves de um objeto JSON, em qualquer nivel. */
function chaves(obj, acc = []) {
  if (Array.isArray(obj)) {
    for (const item of obj) chaves(item, acc);
  } else if (obj !== null && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      acc.push(k);
      chaves(v, acc);
    }
  }
  return acc;
}

/** Cenario: cliente com pedido, consentimento e revelacao; profissional com assinatura e acesso comercial. */
async function cenario() {
  const cliente = await usuario();
  const prof = await usuario();
  await profissional(prof);
  const marcador = `Descricao marcador ${randomUUID()}`;
  const pedidoId = await pedido(cliente, marcador);
  const { rows: consent } = await client.query(
    `insert into app.contact_consent (request_id, kind, scope, professional_id, granted_at, granted_via, text_version)
     values ($1, 'telefone', 'profissional', $2, now(), 'chat', 'v1') returning id`,
    [pedidoId, prof],
  );
  await client.query(
    `insert into app.contact_reveal_log (request_id, professional_id, kind, consent_id, at)
     values ($1, $2, 'telefone', $3, now())`,
    [pedidoId, prof, consent[0].id],
  );
  await client.query('insert into billing.subscription (professional_id) values ($1)', [prof]);
  await client.query(
    `insert into billing.access_grant (professional_id, identity_id, type, starts_at, ends_at)
     values ($1, $2, 'trial', now(), now() + interval '14 days')`,
    [prof, randomUUID()],
  );
  return { cliente, prof, pedidoId, marcador };
}

test('T-DB-03 | so app_system executa as duas funcoes do extrato; anon, authenticated e app_api nao; search_path fixo', async () => {
  await tx(async () => {
    for (const assinatura of ['app.dsr_generate_extract(uuid)', 'app.dsr_register_extract(uuid, text, text, text, integer)']) {
      const { rows } = await client.query(
        `select r.papel, has_function_privilege(r.papel, $1, 'EXECUTE') as ok
           from (values ('app_system', true), ('anon', false), ('authenticated', false), ('app_api', false)) r(papel, esperado)`,
        [assinatura],
      );
      const esperado = { app_system: true, anon: false, authenticated: false, app_api: false };
      for (const linha of rows) assert.equal(linha.ok, esperado[linha.papel], `${linha.papel} em ${assinatura}`);
      const { rows: cat } = await client.query(
        'select prosecdef, proconfig from pg_proc where oid = $1::regprocedure',
        [assinatura],
      );
      assert.equal(cat[0].prosecdef, true, `security definer em ${assinatura}`);
      assert.ok(
        (cat[0].proconfig ?? []).some((c) => c.startsWith('search_path=')),
        `search_path fixo em ${assinatura}`,
      );
    }
    const { rows: montador } = await client.query(
      `select has_function_privilege('anon', 'private.dsr_build_extract(uuid, text, timestamptz)', 'EXECUTE') as anon,
              has_function_privilege('authenticated', 'private.dsr_build_extract(uuid, text, timestamptz)', 'EXECUTE') as auth`,
    );
    assert.equal(montador[0].anon, false);
    assert.equal(montador[0].auth, false);
  });
});

test('acesso deferido: o JSON traz versao 1, protocolo e as onze secoes; o caso nao muda de estado', async () => {
  await tx(async () => {
    const u = await usuario();
    const caso = await casoDeferido(u);
    const out = await gerar(caso);
    assert.match(out.out_protocol, PROTOCOLO);
    const dados = JSON.parse(out.out_payload);
    assert.equal(dados.schema_version, 1);
    assert.equal(dados.protocolo, out.out_protocol);
    assert.ok(dados.gerado_em, 'data de geracao');
    assert.deepEqual(Object.keys(dados.secoes).sort(), [...SECOES_ESPERADAS].sort());
    assert.equal(dados.secoes.cadastro.email.endsWith('@example.test'), true);
    const estado = await estadoCaso(caso);
    assert.equal(estado.status, 'deferido');
    assert.equal(estado.outcome, null);
    assert.equal(await contar('select count(*)::int as n from app.dsr_export where case_id = $1', [caso]), 0);
  });
});

test('T-UN-01 | o extrato do cliente e do profissional nao contem nenhuma chave proibida, em nenhum nivel', async () => {
  await tx(async () => {
    const { cliente, prof } = await cenario();
    for (const titular of [cliente, prof]) {
      const caso = await casoDeferido(titular);
      const dados = JSON.parse((await gerar(caso)).out_payload);
      const presentes = chaves(dados);
      for (const proibida of CHAVES_PROIBIDAS) {
        assert.equal(presentes.includes(proibida), false, `chave proibida no extrato: ${proibida}`);
      }
    }
  });
});

test('T-UN-02 | o pedido de outro titular nao aparece no extrato; so o do proprio titular', async () => {
  await tx(async () => {
    const { cliente, marcador } = await cenario();
    const outro = await usuario();
    const marcadorOutro = `Descricao de outro titular ${randomUUID()}`;
    await pedido(outro, marcadorOutro);
    const caso = await casoDeferido(cliente);
    const texto = (await gerar(caso)).out_payload;
    assert.ok(texto.includes(marcador), 'pedido do proprio titular entra');
    assert.equal(texto.includes(marcadorOutro), false, 'pedido de outro titular fica de fora');
    const dados = JSON.parse(texto);
    assert.equal(dados.secoes.perfil_profissional, null);
    assert.equal(dados.secoes.pedidos.length, 1);
  });
});

test('T-UN-04 | cliente nao recebe secao de profissional; profissional recebe a sua (assinatura e acesso comercial)', async () => {
  await tx(async () => {
    const { cliente, prof } = await cenario();
    const dadosCliente = JSON.parse((await gerar(await casoDeferido(cliente))).out_payload);
    assert.equal(dadosCliente.secoes.perfil_profissional, null);
    assert.deepEqual(dadosCliente.secoes.assinatura, []);
    assert.deepEqual(dadosCliente.secoes.acessos_comerciais, []);

    const dadosProf = JSON.parse((await gerar(await casoDeferido(prof))).out_payload);
    assert.ok(dadosProf.secoes.perfil_profissional, 'perfil profissional presente');
    assert.equal(dadosProf.secoes.perfil_profissional.nome_publico.startsWith('Nome publico'), true);
    assert.equal(dadosProf.secoes.assinatura.length, 1);
    assert.equal(dadosProf.secoes.acessos_comerciais.length, 1);
    assert.equal(dadosProf.secoes.acessos_comerciais[0].tipo, 'trial');
  });
});

test('consentimento e revelacao: o cliente ve o consentimento com o nome publico do profissional e a revelacao como cliente', async () => {
  await tx(async () => {
    const { cliente, prof } = await cenario();
    const dadosCliente = JSON.parse((await gerar(await casoDeferido(cliente))).out_payload);
    assert.equal(dadosCliente.secoes.consentimentos_de_contato.length, 1);
    assert.equal(dadosCliente.secoes.consentimentos_de_contato[0].tipo, 'telefone');
    assert.equal(dadosCliente.secoes.consentimentos_de_contato[0].alcance, 'profissional');
    assert.equal(
      dadosCliente.secoes.consentimentos_de_contato[0].profissional.startsWith('Nome publico'),
      true,
      'nome publico do profissional, ja publico',
    );
    assert.equal(dadosCliente.secoes.revelacoes_de_contato.length, 1);
    assert.equal(dadosCliente.secoes.revelacoes_de_contato[0].papel, 'cliente');

    const dadosProf = JSON.parse((await gerar(await casoDeferido(prof))).out_payload);
    assert.equal(dadosProf.secoes.revelacoes_de_contato.length, 1);
    assert.equal(dadosProf.secoes.revelacoes_de_contato[0].papel, 'profissional');
  });
});

test('geracao recusa caso de outro tipo, caso nao deferido, caso inexistente e extrato ja gravado', async () => {
  await tx(async () => {
    const u = await usuario();
    const correcao = await casoDeferido(u, 'correcao');
    assert.match((await erroDe(GERAR, [correcao])).message, /dsr_tipo_invalido/);

    const { rows } = await client.query(
      `insert into app.dsr_case (protocol, subject_user_id, kind, deadline_at)
       values ($1, $2, 'acesso', now() + interval '15 days') returning id`,
      [protocolo(), u],
    );
    assert.match((await erroDe(GERAR, [rows[0].id])).message, /dsr_nao_deferido/);

    assert.match((await erroDe(GERAR, [randomUUID()])).message, /dsr_nao_encontrado/);
  });
});

test('geracao recusa quando ja existe extrato gravado para o caso', async () => {
  await tx(async () => {
    const u = await usuario();
    const caso = await casoDeferido(u);
    await client.query(
      `insert into app.dsr_export (case_id, storage_path, sha256, signature, schema_version, size_bytes, expires_at)
       values ($1, $2, $3, $4, 1, 2048, now() + interval '7 days')`,
      [caso, `${randomUUID()}.json`, hex(), hex()],
    );
    assert.match((await erroDe(GERAR, [caso])).message, /dsr_extrato_ja_gerado/);
  });
});

test('registro: grava o extrato com validade de 7 dias, conclui o caso, enfileira o aviso e audita', async () => {
  await tx(async () => {
    const u = await usuario();
    const caso = await casoDeferido(u);
    const out = await gerar(caso);
    const reg = await registrar(caso, { tamanho: Buffer.byteLength(out.out_payload, 'utf8') });
    assert.equal(reg.out_status, 'concluido');

    assert.equal(
      await contar(
        `select count(*)::int as n from app.dsr_export
          where case_id = $1 and (expires_at - now()) = interval '7 days' and schema_version = 1`,
        [caso],
      ),
      1,
    );
    const estado = await estadoCaso(caso);
    assert.equal(estado.status, 'concluido');
    assert.equal(estado.outcome, 'extrato_disponibilizado');
    assert.ok(estado.closed_at, 'fechado');

    assert.equal(
      await contar(
        `select count(*)::int as n from app.dsr_case_event where case_id = $1 and event = 'extract_ready'`,
        [caso],
      ),
      1,
    );
    assert.equal(
      await contar(
        `select count(*)::int as n from app.dsr_case_event
          where case_id = $1 and event = 'closed' and from_status = 'deferido' and to_status = 'concluido'`,
        [caso],
      ),
      1,
    );

    assert.equal(
      await contar(
        `select count(*)::int as n from ops.email_outbox
          where dedupe_key = $1 and recipient_user_id = $2 and category = 'acesso' and class = 'critico'
            and state = 'pendente' and template_params = jsonb_build_object('protocolo', $3::text)`,
        [`dsr:${caso}:dsr_extrato_pronto`, u, out.out_protocol],
      ),
      1,
      'aviso so com o protocolo, sem link',
    );

    assert.equal(
      await contar(
        `select count(*)::int as n from audit.audit_event where object_id = $1 and action = 'dsr.extract_ready'`,
        [caso],
      ),
      1,
    );
    assert.equal(
      await contar(
        `select count(*)::int as n from audit.audit_event where object_id = $1 and action = 'dsr.extract_generated'`,
        [caso],
      ),
      1,
    );
  });
});

test('registro: segunda chamada e nova geracao sao recusadas (caso ja concluido)', async () => {
  await tx(async () => {
    const u = await usuario();
    const caso = await casoDeferido(u);
    await registrar(caso);
    assert.match((await erroDe(REGISTRAR, [caso, `${randomUUID()}.json`, hex(), hex(), 10])).message, /dsr_nao_deferido/);
    assert.match((await erroDe(GERAR, [caso])).message, /dsr_nao_deferido/);
  });
});

test('registro: caminho, sha256 e tamanho invalidos sao recusados e nada e gravado', async () => {
  await tx(async () => {
    const u = await usuario();
    const caso = await casoDeferido(u);
    assert.match((await erroDe(REGISTRAR, [caso, 'arquivo.json', hex(), hex(), 10])).message, /dsr_export_path_check/);
    assert.match((await erroDe(REGISTRAR, [caso, `${randomUUID()}.json`, hex(), hex(), 0])).message, /dsr_export_tamanho_check/);
    assert.match((await erroDe(REGISTRAR, [caso, `${randomUUID()}.json`, 'abc', hex(), 10])).message, /dsr_export_sha256_check/);
    assert.equal((await estadoCaso(caso)).status, 'deferido');
    assert.equal(await contar('select count(*)::int as n from app.dsr_export where case_id = $1', [caso]), 0);
  });
});

test('registro recusa caso que nao e de acesso', async () => {
  await tx(async () => {
    const u = await usuario();
    const caso = await casoDeferido(u, 'correcao');
    assert.match((await erroDe(REGISTRAR, [caso, `${randomUUID()}.json`, hex(), hex(), 10])).message, /dsr_tipo_invalido/);
  });
});

test('T-DB-10 analogo | validade do extrato vem de ops.app_config (7 dias; depois 3 dias)', async () => {
  await tx(async () => {
    await client.query(`update ops.app_config set value = '3'::jsonb where key = 'privacy.dsr_export_ttl_days'`);
    const u = await usuario();
    const caso = await casoDeferido(u);
    await registrar(caso);
    const { rows } = await client.query(
      `select (expires_at - now()) = interval '3 days' as ok from app.dsr_export where case_id = $1`,
      [caso],
    );
    assert.equal(rows[0].ok, true);
  });
});

test('integracao | depois do registro, a consulta do proprio titular mostra a validade do extrato', async () => {
  await tx(async () => {
    const u = await usuario();
    const caso = await casoDeferido(u);
    const reg = await registrar(caso);
    const { rows } = await client.query(
      'select out_extract_expires_at from app.dsr_get_own($1::uuid, $2::uuid)',
      [u, caso],
    );
    assert.ok(rows[0].out_extract_expires_at, 'validade visivel ao titular');
    assert.equal(rows[0].out_extract_expires_at.getTime(), reg.out_expires_at.getTime());
  });
});
