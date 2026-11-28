// H-038 (Issue 51) | Cenarios de banco das certificacoes (docs/factory/148-DESENHO-H038.md, secao 6: T-01, T-02,
// T-03, T-05 (sequencial e indice), T-06, T-10, T-11, T-12, T-13, T-16). Migracao 20261113440000 aplicada no DEV.
// Cada teste roda em uma transacao e termina com rollback: nada persiste no banco compartilhado.
// Perfis, servicos e valores sinteticos (@example.test), sem servicos externos.
// Fora desta suite nesta rodada: T-04 (gate integrado com verification_case_decide, depende da leitura do R-01)
// e a parte concorrente de T-05 (exige fixtures commitadas, incompativeis com a politica de rollback).
// Rodar sozinho: node --test --test-concurrency=1 packages/db/tests/identity-cert-h038.dbtest.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { connect } from '../scripts/lib/env.mjs';

const CAP = 250000000;
const AGORA = '2026-11-12T12:00:00Z';
const MAIS_31_MIN = '2026-11-12T12:31:00Z';
const JPEG = 'image/jpeg';
const SHA = Buffer.alloc(32, 7);

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

/** Transacao de teste: tudo desfeito no fim. */
async function tx(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

/** Executa um comando que deve falhar e devolve o erro; o savepoint desfaz a falha para seguir na transacao. */
async function erroDe(sql, params) {
  await client.query('savepoint cenario');
  try {
    await client.query(sql, params);
    return null;
  } catch (err) {
    return err;
  } finally {
    await client.query('rollback to savepoint cenario');
  }
}

async function profissional({ estado = 'pendente', verificado = true } = {}) {
  const id = randomUUID();
  await client.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, 'ativo', $4, now())`,
    [id, `${randomUUID()}@example.test`, randomUUID(), verificado ? AGORA : null],
  );
  await client.query(
    `insert into app.professional_profile (user_id, verification_status, created_at, updated_at)
     values ($1, $2, now(), now())`,
    [id, estado],
  );
  return id;
}

async function grupo() {
  const r = await client.query('select id from app.service_group order by position limit 1');
  return r.rows[0].id;
}

async function servico(regulado) {
  const r = await client.query(
    `insert into app.service (group_id, name, modality, regulated, active)
     values ($1, $2, 'online', $3, true) returning id`,
    [await grupo(), `Servico sintetico ${randomUUID()}`, regulado],
  );
  return r.rows[0].id;
}

async function vincular(prof, svc) {
  await client.query(
    `insert into app.professional_service (professional_id, service_id, modality, declared_at)
     values ($1, $2, 'online', now())`,
    [prof, svc],
  );
}

const emitirCert = (user, svc, tipo = JPEG, bytes = 300000, agora = AGORA, cap = CAP) =>
  client.query(
    'select out_code, out_id, out_status from private.idoc_issue_cert($1, $2, $3, $4, $5, $6, $7)',
    [user, randomUUID(), svc, tipo, bytes, agora, cap],
  );

async function certificarNova(user, svc) {
  const r = await emitirCert(user, svc);
  assert.equal(r.rows[0].out_code, 'new');
  return r.rows[0].out_id;
}

async function iniciar(user, id, agora = AGORA) {
  const r = await client.query('select * from private.idoc_confirm_begin($1, $2, $3, 30)', [user, id, agora]);
  assert.equal(r.rows[0].out_code, 'begin');
  return r.rows[0].out_attempt;
}

async function concluir(user, id, attempt, tipo = JPEG, bytes = 300000, agora = AGORA) {
  const r = await client.query(
    'select private.idoc_confirm_done($1, $2, $3, $4, $5, $6, $7) as r',
    [user, id, attempt, tipo, bytes, SHA, agora],
  );
  return r.rows[0].r;
}

/** Emite, inicia e conclui uma certificacao: fica 'recebido' (a viva do par profissional-servico). */
async function certificar(user, svc) {
  const id = await certificarNova(user, svc);
  const attempt = await iniciar(user, id);
  assert.equal(await concluir(user, id, attempt), 'received');
  return id;
}

const emitirIdentidade = (user, tipo = JPEG, bytes = 4194304, agora = AGORA, cap = CAP) =>
  client.query(
    'select out_code, out_id, out_status from private.idoc_issue($1, $2, $3, $4, $5, $6)',
    [user, randomUUID(), tipo, bytes, agora, cap],
  );

async function statusDoProfissional(user) {
  const r = await client.query('select verification_status from app.professional_profile where user_id = $1', [user]);
  return r.rows[0].verification_status;
}

async function certs(user, svc) {
  const r = await client.query(
    `select id, status from app.identity_document
      where professional_id = $1 and service_id = $2 and kind = 'certificacao' order by created_at, id`,
    [user, svc],
  );
  return r.rows;
}

// ---------------------------------------------------------------------------------------------------------------
describe('T-01 esquema aditivo de identity_document', () => {
  test('coerencia tipo x servico, FK e kind invalido', () =>
    tx(async () => {
      const prof = await profissional();
      const svc = await servico(true);
      await vincular(prof, svc);

      const ident = await erroDe(
        `insert into app.identity_document (professional_id, client_upload_id, kind, service_id, declared_type,
           declared_bytes, status, pending_expires_at, created_at)
         values ($1, $2, 'identidade', $3, $4, 1000, 'pendente_envio', now() + interval '30 minutes', now())`,
        [prof, randomUUID(), svc, JPEG],
      );
      assert.equal(ident?.code, '23514', 'identidade com service_id deve violar CHECK');

      const semServico = await erroDe(
        `insert into app.identity_document (professional_id, client_upload_id, kind, declared_type,
           declared_bytes, status, pending_expires_at, created_at)
         values ($1, $2, 'certificacao', $3, 1000, 'pendente_envio', now() + interval '30 minutes', now())`,
        [prof, randomUUID(), JPEG],
      );
      assert.equal(semServico?.code, '23514', 'certificacao sem service_id deve violar CHECK');

      const fk = await erroDe(
        `insert into app.identity_document (professional_id, client_upload_id, kind, service_id, declared_type,
           declared_bytes, status, pending_expires_at, created_at)
         values ($1, $2, 'certificacao', $3, $4, 1000, 'pendente_envio', now() + interval '30 minutes', now())`,
        [prof, randomUUID(), randomUUID(), JPEG],
      );
      assert.equal(fk?.code, '23503', 'servico inexistente deve violar FK');

      const kind = await erroDe(
        `insert into app.identity_document (professional_id, client_upload_id, kind, declared_type,
           declared_bytes, status, pending_expires_at, created_at)
         values ($1, $2, 'outro', $3, 1000, 'pendente_envio', now() + interval '30 minutes', now())`,
        [prof, randomUUID(), JPEG],
      );
      assert.equal(kind?.code, '23514', 'kind fora de identidade/certificacao deve violar CHECK');

      const ok = await erroDe(
        `insert into app.identity_document (professional_id, client_upload_id, kind, service_id, declared_type,
           declared_bytes, status, pending_expires_at, created_at)
         values ($1, $2, 'certificacao', $3, $4, 1000, 'pendente_envio', now() + interval '30 minutes', now())`,
        [prof, randomUUID(), svc, JPEG],
      );
      assert.equal(ok, null, 'certificacao com servico valido deve ser aceita');
    }));
});

describe('T-02 emissao de certificacao (idoc_issue_cert)', () => {
  test('so servico regulamentado vinculado passa; os demais recebem a mesma resposta', () =>
    tx(async () => {
      const prof = await profissional();
      const reg = await servico(true);
      const comum = await servico(false);
      const regNaoVinc = await servico(true);
      await vincular(prof, reg);
      await vincular(prof, comum);

      assert.equal((await emitirCert(prof, reg)).rows[0].out_code, 'new');
      const negados = [comum, regNaoVinc, randomUUID()];
      for (const svc of negados) {
        assert.equal((await emitirCert(prof, svc)).rows[0].out_code, 'service_denied');
      }
    }));

  test('uma reserva pendente viva por servico; outro servico segue livre; estado suspensa e negado', () =>
    tx(async () => {
      const prof = await profissional();
      const a = await servico(true);
      const b = await servico(true);
      await vincular(prof, a);
      await vincular(prof, b);

      assert.equal((await emitirCert(prof, a)).rows[0].out_code, 'new');
      assert.equal((await emitirCert(prof, a)).rows[0].out_code, 'limite_certificacao');
      assert.equal((await emitirCert(prof, b)).rows[0].out_code, 'new');

      const suspenso = await profissional({ estado: 'suspensa' });
      await vincular(suspenso, a);
      assert.equal((await emitirCert(suspenso, a)).rows[0].out_code, 'state_denied');
    }));
});

describe('T-03 certificacoes_completas e certificacao_servico_ok', () => {
  test('sem servico regulamentado = true; contagem por servico; nunca nulo', () =>
    tx(async () => {
      const prof = await profissional();
      const comum = await servico(false);
      await vincular(prof, comum);
      const sem = await client.query('select private.certificacoes_completas($1) as v', [prof]);
      assert.equal(sem.rows[0].v, true);

      const r1 = await servico(true);
      await vincular(prof, r1);
      const um = await client.query('select private.certificacoes_completas($1) as v', [prof]);
      assert.equal(um.rows[0].v, false, '1 REG sem certificacao = false');

      await certificar(prof, r1);
      const r2 = await servico(true);
      await vincular(prof, r2);
      const dois = await client.query('select private.certificacoes_completas($1) as v', [prof]);
      assert.equal(dois.rows[0].v, false, '2 REG com 1 certificacao = false');

      await certificar(prof, r2);
      const ambos = await client.query('select private.certificacoes_completas($1) as v', [prof]);
      assert.equal(ambos.rows[0].v, true, '2 REG com 2 certificacoes = true');
      assert.notEqual(ambos.rows[0].v, null);
    }));

  test('pendente, purgada e substituida nao contam; so a viva recebida conta', () =>
    tx(async () => {
      const prof = await profissional();
      const svc = await servico(true);
      await vincular(prof, svc);

      const pendente = await certificarNova(prof, svc);
      assert.equal(
        (await client.query('select private.certificacoes_completas($1) as v', [prof])).rows[0].v,
        false,
        'pendente_envio nao conta',
      );
      await client.query('update app.identity_document set purge_requested_at = now() where id = $1', [pendente]);

      const viva = await certificar(prof, svc);
      assert.equal(
        (await client.query('select private.certificacoes_completas($1) as v', [prof])).rows[0].v,
        true,
      );
      await client.query('update app.identity_document set purge_requested_at = now() where id = $1', [viva]);
      assert.equal(
        (await client.query('select private.certificacoes_completas($1) as v', [prof])).rows[0].v,
        false,
        'certificacao com purge_requested_at nao conta',
      );
    }));

  test('certificacao_servico_ok: nao regulamentado = true; regulamentado depende de certificacao recebida', () =>
    tx(async () => {
      const prof = await profissional();
      const comum = await servico(false);
      const reg = await servico(true);
      await vincular(prof, reg);
      const ok = (svc) =>
        client.query('select private.certificacao_servico_ok($1, $2) as v', [prof, svc]).then((r) => r.rows[0].v);
      assert.equal(await ok(comum), true);
      assert.equal(await ok(reg), false);
      await certificar(prof, reg);
      assert.equal(await ok(reg), true);
    }));
});

describe('T-05 varios arquivos por servico (decisao 2026-11-27)', () => {
  test('um envio novo soma ao anterior: os dois ficam recebidos', () =>
    tx(async () => {
      const prof = await profissional();
      const svc = await servico(true);
      await vincular(prof, svc);
      const a = await certificar(prof, svc);
      const b = await certificar(prof, svc);
      const porId = new Map((await certs(prof, svc)).map((x) => [x.id, x.status]));
      assert.equal(porId.get(a), 'recebido');
      assert.equal(porId.get(b), 'recebido');
    }));

  test('o sexto arquivo do mesmo servico e recusado', () =>
    tx(async () => {
      const prof = await profissional();
      const svc = await servico(true);
      await vincular(prof, svc);
      for (let i = 0; i < 5; i += 1) await certificar(prof, svc);
      assert.equal((await emitirCert(prof, svc)).rows[0].out_code, 'limite_certificacao');
    }));

  test('certificacao analisada nao muda quando perfil recusado recebe identidade nova', () =>
    tx(async () => {
      const prof = await profissional({ estado: 'recusada' });
      const svc = await servico(true);
      await vincular(prof, svc);
      const cert = await certificar(prof, svc);
      await client.query('update app.identity_document set analyzed_at = now() where id = $1', [cert]);

      const ident = await emitirIdentidade(prof);
      assert.equal(ident.rows[0].out_code, 'new');
      assert.equal(await concluir(prof, ident.rows[0].out_id, await iniciar(prof, ident.rows[0].out_id)), 'received');
      const [{ status }] = await certs(prof, svc);
      assert.equal(status, 'recebido', 'a identidade nao substitui certificacao');
    }));
});

describe('T-06 cotas independentes e teto global', () => {
  test('certificacao nao consome os 5 documentos de identidade', () =>
    tx(async () => {
      const prof = await profissional();
      const svc = await servico(true);
      await vincular(prof, svc);
      await certificar(prof, svc);
      for (let i = 0; i < 5; i += 1) {
        assert.equal((await emitirIdentidade(prof)).rows[0].out_code, 'new', `identidade ${i + 1}`);
      }
      assert.equal((await emitirIdentidade(prof)).rows[0].out_code, 'doc_limit', 'sexta identidade e recusada');
    }));

  test('teto global de bytes continua valendo para certificacao', () =>
    tx(async () => {
      const prof = await profissional();
      const svc = await servico(true);
      await vincular(prof, svc);
      const r = await emitirCert(prof, svc, JPEG, 300000, AGORA, 1);
      assert.equal(r.rows[0].out_code, 'cap');
    }));
});

describe('T-10 auditoria dos eventos de certificacao', () => {
  test('cada recebimento grava evento sem nome, caminho ou IP', () =>
    tx(async () => {
      const prof = await profissional();
      const svc = await servico(true);
      await vincular(prof, svc);
      const a = await certificar(prof, svc);
      const b = await certificar(prof, svc);

      const ev = await client.query(
        `select action, object_id, after_state from audit.audit_event
          where object_id in ($1, $2) order by seq`,
        [a, b],
      );
      const acoes = ev.rows.map((x) => `${x.action}:${x.object_id}`);
      assert.ok(acoes.includes(`identity.cert.received:${a}`));
      assert.ok(acoes.includes(`identity.cert.received:${b}`));
      const permitidas = new Set(['file_kind', 'size_bytes', 'reason_code']);
      for (const x of ev.rows) {
        for (const chave of Object.keys(x.after_state ?? {})) {
          assert.ok(permitidas.has(chave), `chave fora da lista permitida: ${chave}`);
        }
      }
    }));
});

describe('T-11 exclusao pelo dono (idoc_delete)', () => {
  test('nao analisada = deleted; analisada = already_analyzed; alheia = not_found', () =>
    tx(async () => {
      const prof = await profissional();
      const outro = await profissional();
      const svc = await servico(true);
      await vincular(prof, svc);
      const id = await certificar(prof, svc);

      const alheia = await client.query('select private.idoc_delete($1, $2, $3) as r', [outro, id, AGORA]);
      assert.equal(alheia.rows[0].r, 'not_found');

      await client.query('update app.identity_document set analyzed_at = now() where id = $1', [id]);
      const analisada = await client.query('select private.idoc_delete($1, $2, $3) as r', [prof, id, AGORA]);
      assert.equal(analisada.rows[0].r, 'already_analyzed');

      const outra = await certificarNova(prof, svc);
      const apagada = await client.query('select private.idoc_delete($1, $2, $3) as r', [prof, outra, AGORA]);
      assert.equal(apagada.rows[0].r, 'deleted');
      const evento = await client.query(
        "select count(*)::int as n from audit.audit_event where object_id = $1 and action = 'identity.cert.deleted'",
        [outra],
      );
      assert.equal(evento.rows[0].n, 1);
    }));
});

describe('T-12 neutralidade sobre verification_status', () => {
  test('emissao, finalizacao e exclusao de certificacao nao mudam o estado do perfil', () =>
    tx(async () => {
      const prof = await profissional({ estado: 'em_revisao' });
      const svc = await servico(true);
      await vincular(prof, svc);
      const antes = await statusDoProfissional(prof);
      const id = await certificar(prof, svc);
      await client.query('select private.idoc_delete($1, $2, $3)', [prof, id, AGORA]);
      assert.equal(await statusDoProfissional(prof), antes);
    }));
});

describe('T-13 varredura trata certificacao como identidade', () => {
  test('pendente vencida de certificacao sai na varredura e e expurgada', () =>
    tx(async () => {
      const prof = await profissional();
      const svc = await servico(true);
      await vincular(prof, svc);
      const id = await certificarNova(prof, svc);
      const varredura = await client.query('select out_id, out_staging, out_final from private.idoc_sweep($1, 1000)', [
        MAIS_31_MIN,
      ]);
      const linha = varredura.rows.find((x) => x.out_id === id);
      assert.ok(linha, 'certificacao vencida deve aparecer na varredura');
      assert.equal(linha.out_staging, true);
      const purgadas = await client.query('select private.idoc_purge_done($1) as n', [[id]]);
      assert.equal(purgadas.rows[0].n, 1);
    }));
});

describe('T-16 privilegios, search_path e lista de dono', () => {
  test('so app_system executa as funcoes novas; search_path vazio; definer', async () => {
    const funcoes = [
      'private.idoc_issue_cert(uuid, uuid, uuid, text, integer, timestamptz, bigint)',
      'private.certificacoes_completas(uuid)',
      'private.certificacao_servico_ok(uuid, uuid)',
      'private.idoc_list(uuid, timestamptz)',
    ];
    for (const f of funcoes) {
      const sys = await client.query('select has_function_privilege($1, $2, $3) as ok', ['app_system', f, 'execute']);
      assert.equal(sys.rows[0].ok, true, `app_system deve executar ${f}`);
      for (const papel of ['anon', 'authenticated', 'app_api', 'public']) {
        const p = await client.query('select has_function_privilege($1, $2, $3) as ok', [papel, f, 'execute']);
        assert.equal(p.rows[0].ok, false, `${papel} nao deve executar ${f}`);
      }
      const meta = await client.query('select prosecdef, proconfig from pg_proc where oid = $1::regprocedure', [f]);
      assert.equal(meta.rows[0].prosecdef, true, `${f} deve ser security definer`);
      assert.ok(
        (meta.rows[0].proconfig ?? []).some((c) => /^search_path=("")?$/.test(c)),
        `${f} deve ter search_path vazio`,
      );
    }
  });

  test('idoc_list devolve kind e service_id para identidade e certificacao', () =>
    tx(async () => {
      const prof = await profissional();
      const svc = await servico(true);
      await vincular(prof, svc);
      const cert = await certificar(prof, svc);
      const ident = await emitirIdentidade(prof);
      const r = await client.query(
        'select out_id, out_kind, out_service_id, out_deletable from private.idoc_list($1, $2) order by out_kind',
        [prof, AGORA],
      );
      const porId = new Map(r.rows.map((x) => [x.out_id, x]));
      assert.equal(porId.get(cert).out_kind, 'certificacao');
      assert.equal(porId.get(cert).out_service_id, svc);
      assert.equal(porId.get(ident.rows[0].out_id).out_kind, 'identidade');
      assert.equal(porId.get(ident.rows[0].out_id).out_service_id, null);
    }));
});
