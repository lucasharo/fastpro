// Issue 124 (H-115), fatia F4: executor de banco da matriz de acesso (docs/factory/164-DESENHO-H115.md, §4.2).
// Cada caso ativo com sonda de banco vira um teste com o titulo [CP-xx]; o esperado vem de ACCESS_MATRIX (fonte unica).
// Executa como o papel do executor (postgres do DEV, sem SET ROLE: limitacao A-10 da F2, sem alterar grants nem
// credenciais). Por isso as sondas de funcao provam a logica da funcao de producao, e as de privilegio conferem o
// grant efetivo dos papeis da API (has_table_privilege), nao o RLS sob SET ROLE.
// Tudo dentro de uma transacao que termina em rollback; dados 100 % sinteticos, marcados por MARCA.
// Executar: node --test --test-concurrency=1 packages/db/tests/authorization-parity.dbtest.mjs
// Casos deferred cuja relacao ja existe geram aviso; PARITY_STRICT=1 transforma o aviso em falha.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { ACCESS_MATRIX, deferredCases } from '@fastpro/access-matrix';
import { connect } from '../scripts/lib/env.mjs';
import { concederAcessoVigente } from './fixtures/professional-access.mjs';

const AGORA = '2099-08-15T12:00:00.000Z';
const PRAZO = '2099-08-22T12:00:00.000Z';
const SP = { lon: -46.6333, lat: -23.5505 };
const MARCA = `h115-${randomUUID().slice(0, 8)}`;
const sha = (s) => createHash('sha256').update(s).digest('hex');

const SQL_OWNER = 'select * from private.request_owner_get($1::uuid, $2::uuid)';
const SQL_DETALHE = 'select * from private.request_detail_professional($1::uuid, $2::uuid, $3::timestamptz)';
const SQL_TELEFONE = 'select * from private.contact_reveal_phone($1::uuid, $2::uuid, $3::timestamptz)';
const SQL_DESCOBERTA = 'select * from private.discover_requests($1::uuid, 20, null, null, null, $2::timestamptz)';
const SQL_RASCUNHO = 'select * from private.draft_get($1::text, $2::timestamptz)';
const SQL_PRIVILEGIO_UPDATE = `select r.role, has_table_privilege(r.role, 'audit.audit_event', 'UPDATE') as update_ok,
  has_table_privilege(r.role, 'audit.audit_event', 'DELETE') as delete_ok
  from (values ('app_api'), ('app_system'), ('anon'), ('authenticated')) as r(role)`;
// Administracao e fotos (F6): mesmas assinaturas usadas pelas suites de verificacao, auditoria e dupla aprovacao.
const SQL_ATRIBUIR = 'select * from private.verification_case_assign($1,$2,$3,$4,$5)';
const SQL_IDOC = 'select * from private.idoc_review_target($1::uuid, $2::text, $3::uuid, $4::uuid, $5::text, $6::timestamptz)';
const SQL_GUARDA = 'select * from private.admin_guard($1::text, $2::timestamptz)';
const SQL_APROVACAO = 'select * from private.approval_dual_vote($1::uuid, $2::text, $3::text, $4::uuid, $5::timestamptz)';
const SQL_AUDITORIA = `select * from private.audit_query($1::uuid, $2::text, $3::timestamptz, $4::timestamptz,
  null, null, null, 0, 50, $5::timestamptz)`;

let client;
const ctx = {};
const resultados = [];

// Fixtures da administracao (F6). Seguem as suites existentes (verification-case-regras, audit-query, approval-dual):
// staff com papel, sessao aberta pelo fluxo de login (admin_session_open), documento levado a 'recebido' pelo UPDATE.
async function novoUsuario() {
  const id = randomUUID();
  await client.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, 'ativo', now(), now())`,
    [id, `${MARCA}-${id.slice(0, 8)}@example.test`, randomUUID()],
  );
  return id;
}

async function staffComPapel(role) {
  const id = await novoUsuario();
  await client.query(
    `insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at, created_at, status_changed_at)
     values ($1, 'ativo', 'bootstrap', null, now(), now(), now())`,
    [id],
  );
  await client.query(
    `insert into app.admin_user_role (id, user_id, role_code, granted_by, grant_origin, granted_at, approval_request_id)
     values (gen_random_uuid(), $1, $2, null, 'bootstrap', now(), null)`,
    [id, role],
  );
  return id;
}

/** Sessao admin aberta em AGORA (com segundo fator). Devolve o segredo em hash, como a API envia ao banco. */
async function sessaoAdmin(userId) {
  const segredo = sha(`sessao-admin-${randomUUID()}`);
  const { rows } = await client.query('select private.admin_session_open($1, $2, $3, $4) as ok', [randomUUID(), userId, segredo, AGORA]);
  assert.equal(rows[0].ok, true, 'sessao admin de teste aberta');
  return segredo;
}

/** Profissional pendente com um documento recebido: o trigger de fila abre o caso de verificacao. */
async function casoDeVerificacao() {
  const prof = await novoUsuario();
  await client.query(
    `insert into app.professional_profile (user_id, verification_status, created_at, updated_at)
     values ($1, 'pendente', now(), now())`,
    [prof],
  );
  const doc = randomUUID();
  await client.query(
    `insert into app.identity_document (id, professional_id, client_upload_id, declared_type, declared_bytes, status, pending_expires_at)
     values ($1, $2, $3, 'image/jpeg', 1000, 'pendente_envio', now() + interval '30 minutes')`,
    [doc, prof, randomUUID()],
  );
  await client.query(
    `update app.identity_document set status = 'recebido', stored_type = 'image/jpeg', stored_bytes = 16,
       content_sha256 = $2, received_at = $3 where id = $1`,
    [doc, Buffer.alloc(32, 7), AGORA],
  );
  const { rows } = await client.query('select id, version from app.verification_case where professional_id = $1', [prof]);
  return { prof, doc, cs: rows[0] };
}

/** Caso atribuido ao verificador v1 (em_revisao), com sessao admin aberta. */
async function cenarioAtribuido() {
  const cen = await casoDeVerificacao();
  const v1 = await staffComPapel('verificacao');
  const s1 = await sessaoAdmin(v1);
  const a = await sonda(SQL_ATRIBUIR, [v1, s1, cen.cs.id, cen.cs.version, AGORA]);
  assert.equal(a.kind, 'rows', 'atribuicao do caso de teste');
  return { ...cen, v1, s1 };
}

function caso(id) {
  const c = ACCESS_MATRIX.find((x) => x.id === id);
  assert.ok(c, `caso ${id} ausente da matriz`);
  assert.equal(c.status, 'active', `caso ${id} nao esta ativo`);
  return c;
}

before(async () => {
  client = await connect();
  await client.query('begin');
  const usuario = async (status = 'ativo') => {
    const id = randomUUID();
    await client.query(
      `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [id, `${MARCA}-${id.slice(0, 8)}@example.test`, randomUUID(), status, AGORA, AGORA],
    );
    return id;
  };
  const ponto = async (tipo, sujeito) => {
    const r = await client.query(
      `insert into app.geocode_point (subject_kind, subject_id, address_hash, state, exact_point, geocode_mode, precision, geocoded_at)
       values ($1, $2, $3, 'ok', extensions.st_setsrid(extensions.st_makepoint($4, $5), 4326)::extensions.geography,
               'permanent', 'endereco', $6) returning id`,
      [tipo, sujeito, sha(`end-${randomUUID()}`), SP.lon, SP.lat, AGORA],
    );
    return r.rows[0].id;
  };
  const profissional = async ({ verificacao = 'aprovada', vigente = true, expirado = false } = {}) => {
    const id = await usuario();
    await client.query(
      `insert into app.professional_profile (user_id, verification_status, verified_at, created_at, updated_at)
       values ($1, $2, $3, $4, $4)`,
      [id, verificacao, verificacao === 'aprovada' ? AGORA : null, AGORA],
    );
    const g = await ponto('professional_base', id);
    await client.query(
      `insert into app.professional_area (professional_id, geocode_point_id, base_label, radius_m, valid_since, updated_at)
       values ($1, $2, 'Base sintetica', 20000, $3, $3)`,
      [id, g, AGORA],
    );
    if (vigente) await concederAcessoVigente(client, id, AGORA);
    if (expirado) {
      await client.query(
        `insert into billing.access_grant (professional_id, identity_id, type, starts_at, ends_at, status)
         values ($1, $2, 'trial', '2099-07-01T12:00:00.000Z', '2099-07-15T12:00:00.000Z', 'ativa')`,
        [id, randomUUID()],
      );
    }
    return id;
  };

  const grupo = randomUUID();
  const svc = randomUUID();
  await client.query('insert into app.service_group (id, name, position, active) values ($1, $2, 1, true)', [grupo, `Grupo ${MARCA}`]);
  await client.query(
    `insert into app.service (id, group_id, name, modality, regulated, active) values ($1, $2, $3, 'presencial', false, true)`,
    [svc, grupo, `Servico ${MARCA}`],
  );
  ctx.svc = svc;

  // Pedido publicado do DONO (cliente) e rascunho de origem, como na visibilidade H-032.
  const rascunhoId = randomUUID();
  await client.query(
    `insert into app.request_draft (id, browser_nonce_hash, service_id, address_text, urgency, description, status,
                                    expires_at, ip_hmac, created_at, updated_at, first_name, email, email_hmac,
                                    email_verified_at, confirmed_at)
     values ($1, $2, $3, 'Rua sintetica 1', 'imediato', 'Descricao sintetica', 'aberto',
             $4, $5, $6, $6, 'Ana', $7, $8, $6, $6)`,
    [rascunhoId, sha(`cookie-${rascunhoId}`), svc, PRAZO, sha('ip-sintetico'), AGORA, `${MARCA}-rascunho@example.test`, sha(MARCA)],
  );
  ctx.rascunhoHash = sha(`cookie-${rascunhoId}`);
  const dono = await usuario();
  const g = await ponto('request', rascunhoId);
  const pedido = await client.query(
    `insert into app.service_request (customer_user_id, service_id, status, urgency, description, address_text, first_name,
                                      geocode_point_id, origin_draft_id, published_at, acceptance_deadline_at)
     values ($1, $2, 'publicado', 'imediato', 'Descricao sintetica', 'Rua sintetica 1', 'Ana', $3, $4, $5, $6)
     returning id`,
    [dono, svc, g, rascunhoId, AGORA, PRAZO],
  );
  ctx.DONO = dono;
  ctx.PEDIDO = pedido.rows[0].id;
  ctx.OUTRO = await usuario();
  ctx.PRO = await profissional();
  ctx.PRO_SEM = await profissional({ verificacao: 'pendente', vigente: false });
  ctx.PRO_EXP = await profissional({ vigente: false, expirado: true });
  for (const p of [ctx.PRO, ctx.PRO_SEM, ctx.PRO_EXP]) {
    await client.query('insert into app.professional_service (professional_id, service_id, modality, declared_at) values ($1, $2, $3, $4)', [p, svc, 'presencial', AGORA]);
  }
});

after(async () => {
  await client.query('rollback');
  await client.end();
  const r = resultados.map((x) => `${x.id}=${x.status}`);
  const falhas = resultados.filter((x) => x.status === 'falha').map((x) => x.id);
  const pendentes = resultados.filter((x) => x.status === 'pendente').map((x) => x.id);
  console.log(
    `H115 PARIDADE camada=db ativos=${resultados.length} ok=${resultados.filter((x) => x.status === 'ok').length} falhas=[${falhas.join(',')}] pendentes=[${pendentes.join(',')}]`,
  );
  console.log(`H115 PARIDADE detalhe ${r.join(' ')}`);
});

/** Executa uma sonda dentro de um savepoint: erro vira classificacao, nunca aborta a transacao do teste. */
async function sonda(sql, params) {
  await client.query('savepoint s');
  try {
    const r = await client.query(sql, params);
    await client.query('release savepoint s');
    return { kind: 'rows', rows: r.rows };
  } catch (err) {
    await client.query('rollback to savepoint s');
    await client.query('release savepoint s');
    return { kind: 'erro', code: err.code ?? 'desconhecido' };
  }
}

const snake = (s) => s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);

/** Compara o resultado real com o esperado do caso. Devolve null se confere, ou o motivo. */
function confere(esperado, res) {
  if (esperado === undefined) return 'caso sem expectativa de banco';
  switch (esperado.kind) {
    case 'rows': {
      if (res.kind !== 'rows') return `esperado linhas, obtido erro ${res.code}`;
      if (res.rows.length < esperado.minRows) return `esperado >= ${esperado.minRows} linha(s), obtido ${res.rows.length}`;
      const colunas = Object.keys(res.rows[0] ?? {}).map((c) => c.replace(/^out_/, ''));
      const proibidas = (esperado.forbiddenColumns ?? []).filter((c) => colunas.includes(snake(c)));
      return proibidas.length > 0 ? `colunas proibidas presentes: ${proibidas.join(',')}` : null;
    }
    case 'no_rows':
      if (res.kind === 'rows' && res.rows.length === 0) return null;
      return res.kind === 'rows' ? `esperado 0 linhas, obtido ${res.rows.length}` : `esperado 0 linhas, obtido erro ${res.code}`;
    case 'denied':
      return res.kind === 'erro' && res.code === esperado.sqlstate ? null : `esperado ${esperado.sqlstate}, obtido ${res.kind === 'erro' ? res.code : 'linhas'}`;
    case 'exception':
      return res.kind === 'erro' && res.code === esperado.sqlstate ? null : `esperado ${esperado.sqlstate}, obtido ${res.kind === 'erro' ? res.code : 'linhas'}`;
    default:
      return `tipo de expectativa desconhecido: ${esperado.kind}`;
  }
}

function registrar(id, falha) {
  resultados.push({ id, status: falha === null ? 'ok' : 'falha' });
  assert.equal(falha, null, `${id}: ${falha}`);
}

test('[CP-01] dono le o proprio pedido: linha com colunas permitidas e sem campos internos', async () => {
  const c = caso('CP-01');
  registrar(c.id, confere(c.db, await sonda(SQL_OWNER, [ctx.DONO, ctx.PEDIDO])));
});

test('[CP-02] outro cliente nao le o pedido alheio (IDOR): zero linhas', async () => {
  const c = caso('CP-02');
  registrar(c.id, confere(c.db, await sonda(SQL_OWNER, [ctx.OUTRO, ctx.PEDIDO])));
});

test('[CP-03] sem sessao (usuario nulo) a funcao do dono nao devolve pedido', async () => {
  const c = caso('CP-03');
  registrar(c.id, confere(c.db, await sonda(SQL_OWNER, [null, ctx.PEDIDO])));
});

test('[CP-04] profissional elegivel le o pedido no raio: linha sem colunas proibidas ao profissional', async () => {
  const c = caso('CP-04');
  registrar(c.id, confere(c.db, await sonda(SQL_DETALHE, [ctx.PRO, ctx.PEDIDO, AGORA])));
});

test('[CP-05] profissional com verificacao pendente nao le o pedido: zero linhas', async () => {
  const c = caso('CP-05');
  registrar(c.id, confere(c.db, await sonda(SQL_DETALHE, [ctx.PRO_SEM, ctx.PEDIDO, AGORA])));
});

test('[CP-09] elegivel sem aceite nao revela telefone do cliente: zero linhas', async () => {
  const c = caso('CP-09');
  registrar(c.id, confere(c.db, await sonda(SQL_TELEFONE, [ctx.PRO, ctx.PEDIDO, AGORA])));
});

test('[CP-10] resposta do elegivel (banco) sem colunas de e-mail, telefone, endereco ou coordenadas', async () => {
  const c = caso('CP-10');
  const r = await sonda(SQL_DETALHE, [ctx.PRO, ctx.PEDIDO, AGORA]);
  registrar(c.id, confere(c.db, r));
  assert.equal(r.kind, 'rows');
  const colunas = Object.keys(r.rows[0]).join(' ');
  assert.ok(!/email|phone|coordinat|latitude|longitude|address/.test(colunas), `CP-10: colunas sensiveis: ${colunas}`);
});

test('[CP-13] descoberta: profissional elegivel ve o pedido no raio, sem colunas proibidas', async () => {
  const c = caso('CP-13');
  const r = await sonda(SQL_DESCOBERTA, [ctx.PRO, AGORA]);
  registrar(c.id, confere(c.db, r));
  assert.ok(r.rows.some((linha) => linha.out_request_id === ctx.PEDIDO), 'CP-13: pedido do teste deveria estar na descoberta');
});

test('[CP-14] descoberta: assinatura expirada nao recebe pedidos (silencio financeiro)', async () => {
  const c = caso('CP-14');
  registrar(c.id, confere(c.db, await sonda(SQL_DESCOBERTA, [ctx.PRO_EXP, AGORA])));
});

test('[CP-15] rascunho so e lido com o proprio nonce: nonce alheio nao devolve rascunho', async () => {
  const c = caso('CP-15');
  registrar(c.id, confere(c.db, await sonda(SQL_RASCUNHO, [sha(`nonce-alheio-${randomUUID()}`), AGORA])));
  // Controle positivo: com o nonce do rascunho, a mesma funcao devolve a linha (o teste nao passa por funcao vazia).
  const controle = await sonda(SQL_RASCUNHO, [ctx.rascunhoHash, AGORA]);
  assert.equal(controle.kind, 'rows');
  assert.equal(controle.rows.length, 1, 'CP-15: controle positivo deveria devolver o rascunho');
});

test('[CP-18] profissional dono do documento tenta le-lo: negado (sem papel de verificacao)', async () => {
  const c = caso('CP-18');
  const cen = await casoDeVerificacao();
  registrar(c.id, confere(c.db, await sonda(SQL_IDOC, [cen.prof, sha('sessao-do-proprio-profissional'), cen.cs.id, cen.doc, 'analise_inicial', AGORA])));
});

test('[CP-19] verificador com tarefa atribuida le o documento do caso: uma linha', async () => {
  const c = caso('CP-19');
  const cen = await cenarioAtribuido();
  registrar(c.id, confere(c.db, await sonda(SQL_IDOC, [cen.v1, cen.s1, cen.cs.id, cen.doc, 'analise_inicial', AGORA])));
});

test('[CP-20] administrador financeiro (sem verificacao) tenta ler o documento de um caso: negado', async () => {
  const c = caso('CP-20');
  const cen = await cenarioAtribuido();
  const fin = await staffComPapel('financeiro');
  const sf = await sessaoAdmin(fin);
  registrar(c.id, confere(c.db, await sonda(SQL_IDOC, [fin, sf, cen.cs.id, cen.doc, 'analise_inicial', AGORA])));
});

test('[CP-21] admin sem segundo fator nao passa na guarda: zero linhas; com MFA, a mesma guarda devolve a sessao', async () => {
  const c = caso('CP-21');
  const adm = await staffComPapel('verificacao');
  // Controle positivo: com sessao aal2 a guarda devolve uma linha; sem ela (estado sem MFA) nao ha sessao, so o segredo.
  const com = await sessaoAdmin(adm);
  const ok = await sonda(SQL_GUARDA, [com, AGORA]);
  assert.equal(ok.kind, 'rows');
  assert.equal(ok.rows.length, 1, 'CP-21: controle positivo deveria devolver a sessao aal2');
  // A tabela de sessao exige aal2_at (not null): o estado aal1 nao existe como linha, so o segredo sem sessao.
  registrar(c.id, confere(c.db, await sonda(SQL_GUARDA, [sha(`sem-mfa-${randomUUID()}`), AGORA])));
});

test('[CP-22] superadmin nao aprova estorno: sem a permissao de aprovacao, negado antes de qualquer voto', async () => {
  const c = caso('CP-22');
  const sup = await staffComPapel('superadmin');
  const ss = await sessaoAdmin(sup);
  // A permissao e checada antes da leitura do pedido: id sintetico basta para provar a recusa.
  registrar(c.id, confere(c.db, await sonda(SQL_APROVACAO, [sup, ss, 'estorno', randomUUID(), AGORA])));
});

test('[CP-23] auditor consulta a trilha no periodo: consulta aceita (pode vir vazia)', async () => {
  const c = caso('CP-23');
  const aud = await staffComPapel('auditor');
  const sa = await sessaoAdmin(aud);
  registrar(c.id, confere(c.db, await sonda(SQL_AUDITORIA, [aud, sa, '2099-08-01T00:00:00.000Z', '2099-08-02T00:00:00.000Z', AGORA])));
});

test('[CP-27] verificador sem caso atribuido a ele (caso de outro analista): leitura negada', async () => {
  const c = caso('CP-27');
  const cen = await cenarioAtribuido();
  const v2 = await staffComPapel('verificacao');
  const s2 = await sessaoAdmin(v2);
  registrar(c.id, confere(c.db, await sonda(SQL_IDOC, [v2, s2, cen.cs.id, cen.doc, 'analise_inicial', AGORA])));
});

test('[CP-24] papeis da API e anon/authenticated nao tem UPDATE nem DELETE em audit.audit_event (grant efetivo)', async () => {
  const c = caso('CP-24');
  const { rows } = await client.query(SQL_PRIVILEGIO_UPDATE);
  const concedidos = rows.filter((r) => r.update_ok || r.delete_ok).map((r) => r.role);
  registrar(c.id, concedidos.length === 0 ? null : `papeis com UPDATE/DELETE: ${concedidos.join(',')}`);
});

test('[CP-PAR] casos deferred cuja relacao ja existe: aviso (ou falha com PARITY_STRICT=1)', async () => {
  const pendentes = [];
  for (const c of deferredCases()) {
    if (!c.requiresRelation) continue;
    const { rows } = await client.query('select to_regclass($1)::text as r', [c.requiresRelation]);
    if (rows[0].r !== null) pendentes.push(`${c.id} (${c.requiresRelation})`);
  }
  for (const p of pendentes) console.log(`H115 aviso: ativavel sem caso ${p}`);
  if (process.env.PARITY_STRICT === '1') assert.deepEqual(pendentes, [], 'deferred com relacao existente');
});
