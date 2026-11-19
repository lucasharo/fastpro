// H-037 (#50) | Cenarios de banco dos documentos de identidade (docs/factory/107-DESENHO-H037.md §4, §13;
// T-05, T-07, T-09, T-11, T-13, T-14, T-21). Migracao 20261112220000 aplicada no banco de desenvolvimento.
// Cada teste roda dentro de uma transacao e termina com rollback: nada persiste no banco compartilhado.
// Perfis e valores sinteticos (@example.test). O papel de conexao nao troca para app_system nesta base; o
// EXECUTE de app_system e lido do catalogo.
// Rodar sozinho: node --test --test-concurrency=1 packages/db/tests/identity-docs-h037.dbtest.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pausa } from 'node:timers/promises';
import { connect } from '../scripts/lib/env.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ROLLBACK = join(RAIZ, 'supabase', 'rollbacks', '20261112220000_identity_create_documents.down.sql');
const CAP = 250000000;
const AGORA = '2026-11-12T12:00:00Z';
const MAIS_31_MIN = '2026-11-12T12:31:00Z';
const PDF = 'application/pdf';
const JPEG = 'image/jpeg';

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

const emitir = (user, cid, tipo, bytes, agora = AGORA, cap = CAP) =>
  client.query(
    'select out_code, out_id, out_status from private.idoc_issue($1, $2, $3, $4, $5, $6)',
    [user, cid, tipo, bytes, agora, cap],
  );

async function emitirOk(user, tipo = JPEG, bytes = 4194304, agora = AGORA) {
  const r = await emitir(user, randomUUID(), tipo, bytes, agora);
  assert.equal(r.rows[0].out_code, 'new');
  return r.rows[0].out_id;
}

const iniciar = (user, id, agora = AGORA) =>
  client.query('select * from private.idoc_confirm_begin($1, $2, $3, 30)', [user, id, agora]);

describe('buckets e postura (T-07, T-21)', () => {
  test('identity-incoming e identity-docs com limites e tipos da decisao 213 e CA-07', async () => {
    const r = await client.query(
      `select id, public, file_size_limit, allowed_mime_types from storage.buckets
        where id in ('identity-incoming', 'identity-docs') order by id`,
    );
    assert.equal(r.rows.length, 2);
    const docs = r.rows.find((b) => b.id === 'identity-docs');
    const entrada = r.rows.find((b) => b.id === 'identity-incoming');
    assert.equal(docs.public, false);
    assert.equal(Number(docs.file_size_limit), 2097152);
    assert.deepEqual([...docs.allowed_mime_types].sort(), [JPEG, PDF].sort());
    assert.equal(entrada.public, false);
    assert.equal(Number(entrada.file_size_limit), 5242880);
    assert.deepEqual(
      [...entrada.allowed_mime_types].sort(),
      ['image/jpeg', 'image/png', 'image/webp', PDF].sort(),
    );
  });

  test('nenhuma politica em storage.objects para os dois buckets (CA-06)', async () => {
    const r = await client.query(
      `select count(*)::int as n from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and (qual like '%identity-%' or with_check like '%identity-%')`,
    );
    assert.equal(r.rows[0].n, 0);
  });

  test('tabela com RLS habilitada e forcada; sem privilegio direto para os papeis proibidos', async () => {
    const r = await client.query(
      `select relrowsecurity, relforcerowsecurity from pg_class
        where oid = 'app.identity_document'::regclass`,
    );
    assert.equal(r.rows[0].relrowsecurity, true);
    assert.equal(r.rows[0].relforcerowsecurity, true);
    for (const papel of ['anon', 'authenticated', 'service_role', 'app_api']) {
      const p = await client.query(
        `select has_table_privilege($1, 'app.identity_document', 'select,insert,update,delete') as ok`,
        [papel],
      );
      assert.equal(p.rows[0].ok, false, `${papel} nao pode DML direto`);
    }
  });

  test('funcoes executaveis so por app_system', async () => {
    const f = "private.idoc_issue(uuid, uuid, text, integer, timestamptz, bigint)";
    const sys = await client.query('select has_function_privilege($1, $2, $3) as ok', ['app_system', f, 'execute']);
    const anon = await client.query('select has_function_privilege($1, $2, $3) as ok', ['anon', f, 'execute']);
    const api = await client.query('select has_function_privilege($1, $2, $3) as ok', ['app_api', f, 'execute']);
    assert.equal(sys.rows[0].ok, true);
    assert.equal(anon.rows[0].ok, false);
    assert.equal(api.rows[0].ok, false);
  });

  // H-038 (Issue 51) acrescenta identity.cert.* ao mesmo catalogo; verification.document.read e de outra Issue e fica fora.
  test('catalogo de auditoria de identidade (identity.*): 3 acoes de identidade e 3 da certificacao (H-038)', async () => {
    const r = await client.query(
      `select action, state_keys from audit.action_catalog
        where object_type = 'identity_document' and action like 'identity.%' order by action`,
    );
    assert.deepEqual(
      r.rows.map((x) => x.action),
      [
        'identity.cert.deleted',
        'identity.cert.received',
        'identity.cert.replaced',
        'identity.doc.deleted',
        'identity.doc.received',
        'identity.doc.refused',
      ],
    );
  });
});

describe('emissao, replay e estados (T-05, T-09, T-13)', () => {
  test('emissao cria pendente sem alterar verification_status (CA-09)', () =>
    tx(async () => {
      const u = await profissional({ estado: 'pendente' });
      await emitirOk(u);
      const r = await client.query(
        'select verification_status from app.professional_profile where user_id = $1',
        [u],
      );
      assert.equal(r.rows[0].verification_status, 'pendente');
    }));

  test('estados que aceitam envio e os que negam (CA-13)', () =>
    tx(async () => {
      for (const estado of ['pendente', 'em_revisao', 'retida_duplicidade', 'recusada']) {
        const u = await profissional({ estado });
        const r = await emitir(u, randomUUID(), JPEG, 1000);
        assert.equal(r.rows[0].out_code, 'new', estado);
      }
      for (const estado of ['aprovada', 'suspensa']) {
        const u = await profissional({ estado });
        const r = await emitir(u, randomUUID(), JPEG, 1000);
        assert.equal(r.rows[0].out_code, 'state_denied', estado);
      }
    }));

  test('e-mail nao verificado e perfil ausente sao recusados', () =>
    tx(async () => {
      const semEmail = await profissional({ verificado: false });
      assert.equal((await emitir(semEmail, randomUUID(), JPEG, 1000)).rows[0].out_code, 'email_unverified');
      const semPerfil = randomUUID();
      assert.equal((await emitir(semPerfil, randomUUID(), JPEG, 1000)).rows[0].out_code, 'no_profile');
    }));

  test('repeticao do mesmo client_upload_id devolve a mesma linha, sem vaga nova', () =>
    tx(async () => {
      const u = await profissional();
      const cid = randomUUID();
      const a = await emitir(u, cid, JPEG, 1000);
      const b = await emitir(u, cid, JPEG, 1000);
      assert.equal(a.rows[0].out_code, 'new');
      assert.equal(b.rows[0].out_code, 'replay');
      assert.equal(b.rows[0].out_id, a.rows[0].out_id);
    }));

  test('sexto documento vivo: funcao devolve doc_limit e o gatilho barra insercao direta (T-05, CA-05)', () =>
    tx(async () => {
      const u = await profissional();
      for (let i = 0; i < 5; i++) await emitirOk(u);
      assert.equal((await emitir(u, randomUUID(), JPEG, 1000)).rows[0].out_code, 'doc_limit');
      const err = await erroDe(
        `insert into app.identity_document (professional_id, client_upload_id, declared_type, declared_bytes,
           status, pending_expires_at) values ($1, $2, $3, 1000, 'pendente_envio', now() + interval '30 minutes')`,
        [u, randomUUID(), JPEG],
      );
      assert.ok(err, 'insercao direta deveria falhar');
      assert.equal(err.message, 'limite_documentos');
    }));

  test('linha substituida ou marcada para expurgo nao conta no limite (T-05)', () =>
    tx(async () => {
      const u = await profissional();
      const ids = [];
      for (let i = 0; i < 5; i++) ids.push(await emitirOk(u));
      await client.query(`update app.identity_document set purge_requested_at = $2 where id = $1`, [ids[0], AGORA]);
      const r = await emitir(u, randomUUID(), JPEG, 1000);
      assert.equal(r.rows[0].out_code, 'new');
    }));

  test('teto global: a segunda reserva passa do teto de duas reservas e vira cap (T-20, decisao 220)', () =>
    tx(async () => {
      const u1 = await profissional();
      const u2 = await profissional();
      const cap = 2097152 * 2 - 1;
      assert.equal((await emitir(u1, randomUUID(), JPEG, 1000, AGORA, cap)).rows[0].out_code, 'new');
      assert.equal((await emitir(u2, randomUUID(), JPEG, 1000, AGORA, cap)).rows[0].out_code, 'cap');
    }));
});

describe('confirmacao, recusa, exclusao e auditoria (T-11, T-14, T-24)', () => {
  test('envio completo grava recebido com auditoria sem PII (T-14)', () =>
    tx(async () => {
      const u = await profissional();
      const id = await emitirOk(u, PDF, 1000);
      const b = await iniciar(u, id);
      assert.equal(b.rows[0].out_code, 'begin');
      const done = await client.query(
        'select private.idoc_confirm_done($1, $2, $3, $4, $5, $6, $7) as r',
        [u, id, b.rows[0].out_attempt, PDF, 1000, Buffer.alloc(32, 7), AGORA],
      );
      assert.equal(done.rows[0].r, 'received');
      const lista = await client.query('select * from private.idoc_list($1, $2)', [u, AGORA]);
      assert.equal(lista.rows[0].out_status, 'recebido');
      assert.equal(lista.rows[0].out_file_kind, 'pdf');
      assert.equal(lista.rows[0].out_deletable, true);
      const ev = await client.query(
        `select after_state from audit.audit_event
          where object_type = 'identity_document' and object_id = $1 and action = 'identity.doc.received'`,
        [id],
      );
      assert.equal(ev.rows.length, 1);
    }));

  test('segunda ativacao com lease viva devolve busy; release com contagem devolve so a lease', () =>
    tx(async () => {
      const u = await profissional();
      const id = await emitirOk(u);
      const a = await iniciar(u, id);
      assert.equal(a.rows[0].out_code, 'begin');
      assert.equal((await iniciar(u, id)).rows[0].out_code, 'busy');
      await client.query('select private.idoc_confirm_release($1, $2, true)', [id, a.rows[0].out_attempt]);
      const again = await iniciar(u, id);
      assert.equal(again.rows[0].out_code, 'begin');
    }));

  test('release sem contagem devolve a tentativa; a quarta tentativa vira too_many', () =>
    tx(async () => {
      const u = await profissional();
      const id = await emitirOk(u);
      for (let i = 0; i < 3; i++) {
        const a = await iniciar(u, id, `2026-11-12T12:0${i}:00Z`);
        assert.equal(a.rows[0].out_code, 'begin');
        await client.query('select private.idoc_confirm_release($1, $2, true)', [id, a.rows[0].out_attempt]);
      }
      assert.equal((await iniciar(u, id, '2026-11-12T12:10:00Z')).rows[0].out_code, 'too_many');
    }));

  test('pendente vencido: expired na ativacao; nova emissao libera a vaga (T-11)', () =>
    tx(async () => {
      const u = await profissional();
      const id = await emitirOk(u);
      assert.equal((await iniciar(u, id, MAIS_31_MIN)).rows[0].out_code, 'expired');
      for (let i = 0; i < 4; i++) await emitirOk(u, JPEG, 1000, AGORA);
      const r = await emitir(u, randomUUID(), JPEG, 1000, MAIS_31_MIN);
      assert.equal(r.rows[0].out_code, 'new');
    }));

  test('recusa por conteudo marca expurgo, audita com codigo fixo e sai da lista (CA-10, decisao 214)', () =>
    tx(async () => {
      const u = await profissional();
      const id = await emitirOk(u);
      const a = await iniciar(u, id);
      const r = await client.query(
        'select private.idoc_confirm_refuse($1, $2, $3, $4, $5) as r',
        [u, id, a.rows[0].out_attempt, 'pdf_ativo', AGORA],
      );
      assert.equal(r.rows[0].r, 'refused');
      const lista = await client.query('select * from private.idoc_list($1, $2)', [u, AGORA]);
      assert.equal(lista.rows.length, 0);
    }));

  test('exclusao de pendente e de recebido; analisado nao exclui (decisao 180, T-24)', () =>
    tx(async () => {
      const u = await profissional();
      const p = await emitirOk(u);
      assert.equal((await client.query('select private.idoc_delete($1, $2, $3) as r', [u, p, AGORA])).rows[0].r, 'deleted');
      const r = await emitirOk(u, JPEG, 1000);
      const a = await iniciar(u, r);
      await client.query(
        'select private.idoc_confirm_done($1, $2, $3, $4, $5, $6, $7)',
        [u, r, a.rows[0].out_attempt, JPEG, 1000, Buffer.alloc(32, 1), AGORA],
      );
      await client.query('update app.identity_document set analyzed_at = $2 where id = $1', [r, AGORA]);
      assert.equal((await client.query('select private.idoc_delete($1, $2, $3) as r', [u, r, AGORA])).rows[0].r, 'already_analyzed');
    }));

  test('analyzed_at so com status recebido ou substituido (coerencia)', () =>
    tx(async () => {
      const u = await profissional();
      const id = await emitirOk(u);
      const err = await erroDe('update app.identity_document set analyzed_at = $2 where id = $1', [id, AGORA]);
      assert.ok(err, 'analyzed_at em pendente deveria falhar');
    }));

  test('perfil recusada: documento ja analisado vira substituido no proximo recebimento (decisao 217)', () =>
    tx(async () => {
      const u = await profissional({ estado: 'recusada' });
      const antigo = await emitirOk(u, JPEG, 1000);
      const a0 = await iniciar(u, antigo);
      await client.query('select private.idoc_confirm_done($1, $2, $3, $4, $5, $6, $7)', [
        u, antigo, a0.rows[0].out_attempt, JPEG, 1000, Buffer.alloc(32, 2), AGORA,
      ]);
      await client.query('update app.identity_document set analyzed_at = $2 where id = $1', [antigo, AGORA]);
      const novo = await emitirOk(u, JPEG, 1000);
      const a1 = await iniciar(u, novo);
      await client.query('select private.idoc_confirm_done($1, $2, $3, $4, $5, $6, $7)', [
        u, novo, a1.rows[0].out_attempt, JPEG, 1000, Buffer.alloc(32, 3), AGORA,
      ]);
      const s = await client.query('select status from app.identity_document where id = $1', [antigo]);
      assert.equal(s.rows[0].status, 'substituido');
    }));

  test('varredura: pendente vencido vira expurgo com objeto na entrada; purge_done remove a linha (T-11)', () =>
    tx(async () => {
      const u = await profissional();
      const id = await emitirOk(u);
      const sw = await client.query('select * from private.idoc_sweep($1, 100)', [MAIS_31_MIN]);
      const linha = sw.rows.find((x) => x.out_id === id);
      assert.ok(linha, 'pendente vencido deveria aparecer na varredura');
      assert.equal(linha.out_staging, true);
      assert.equal(linha.out_final, false);
      const conhecido = await client.query('select * from private.idoc_known_pending($1)', [[id]]);
      assert.equal(conhecido.rows.length, 1);
      const feito = await client.query('select private.idoc_purge_done($1) as n', [[id]]);
      assert.equal(feito.rows[0].n, 1);
      const sumiu = await client.query('select * from private.idoc_known_pending($1)', [[id]]);
      assert.equal(sumiu.rows.length, 0);
    }));
});

describe('listagem e varredura: o que o adaptador espera (107 §4.2; pendencia da fase 1)', () => {
  test('idoc_list devolve so os vivos e nao expirados; a vaga do adaptador (5 - lista) bate com o limite', () =>
    tx(async () => {
      const u = await profissional();
      const primeiro = await emitirOk(u);
      let lista = await client.query('select * from private.idoc_list($1, $2)', [u, AGORA]);
      assert.equal(lista.rows.length, 1);
      assert.equal(lista.rows[0].out_id, primeiro);
      assert.equal(lista.rows[0].out_status, 'em_envio');
      assert.equal(lista.rows[0].out_file_kind, 'imagem');
      assert.equal(lista.rows[0].out_deletable, true);
      // Pendente vencido sai da lista; a contagem do limite tambem o ignora (liberacao preguicosa na emissao).
      lista = await client.query('select * from private.idoc_list($1, $2)', [u, MAIS_31_MIN]);
      assert.equal(lista.rows.length, 0);
      // Cinco vivos: a lista mostra cinco, a vaga do adaptador zera e a sexta emissao e barrada.
      for (let i = 0; i < 4; i++) await emitirOk(u);
      lista = await client.query('select * from private.idoc_list($1, $2)', [u, AGORA]);
      assert.equal(lista.rows.length, 5);
      assert.equal(Math.max(0, 5 - lista.rows.length), 0);
      const sexto = await emitir(u, randomUUID(), JPEG, 100);
      assert.equal(sexto.rows[0].out_code, 'doc_limit');
      // Excluir um pendente tira da lista, libera a vaga e a proxima emissao passa.
      const del = await client.query('select private.idoc_delete($1, $2, $3) as out', [u, lista.rows[0].out_id, AGORA]);
      assert.equal(del.rows[0].out, 'deleted');
      lista = await client.query('select * from private.idoc_list($1, $2)', [u, AGORA]);
      assert.equal(lista.rows.length, 4);
      assert.equal(Math.max(0, 5 - lista.rows.length), 1);
      const nova = await emitir(u, randomUUID(), JPEG, 100);
      assert.equal(nova.rows[0].out_code, 'new');
    }));

  test('idoc_sweep: recebido excluido traz objeto final e nao de entrada; recusado traz so a entrada', () =>
    tx(async () => {
      const u = await profissional();
      const recebido = await emitirOk(u, PDF, 1000);
      const b = await iniciar(u, recebido);
      const done = await client.query(
        'select private.idoc_confirm_done($1, $2, $3, $4, $5, $6, $7) as r',
        [u, recebido, b.rows[0].out_attempt, PDF, 1000, Buffer.alloc(32, 7), AGORA],
      );
      assert.equal(done.rows[0].r, 'received');
      const del = await client.query('select private.idoc_delete($1, $2, $3) as out', [u, recebido, AGORA]);
      assert.equal(del.rows[0].out, 'deleted');
      const recusado = await emitirOk(u);
      const b2 = await iniciar(u, recusado);
      const ref = await client.query(
        'select private.idoc_confirm_refuse($1, $2, $3, $4, $5) as out',
        [u, recusado, b2.rows[0].out_attempt, 'tipo_nao_aceito', AGORA],
      );
      assert.equal(ref.rows[0].out, 'refused');
      const sw = await client.query('select * from private.idoc_sweep($1, 100)', [AGORA]);
      const lr = sw.rows.find((x) => x.out_id === recebido);
      const lf = sw.rows.find((x) => x.out_id === recusado);
      assert.ok(lr && lf, 'as duas linhas marcadas deveriam aparecer na varredura');
      assert.deepEqual([lr.out_staging, lr.out_final], [false, true]);
      assert.deepEqual([lf.out_staging, lf.out_final], [true, false]);
    }));
});

describe('rollback (T-21)', () => {
  test('o arquivo de rollback recusa com dados e desfaz sem dados (dentro de transacao descartada)', async () => {
    const sql = readFileSync(ROLLBACK, 'utf8')
      .split('\n')
      .filter((l) => !/^(begin|commit);\s*$/i.test(l.trim()))
      .join('\n');
    await client.query('begin');
    try {
      const u = await profissional();
      await emitirOk(u);
      const recusado = await erroDe(sql);
      assert.ok(recusado, 'rollback com dados deveria recusar');
      assert.equal(recusado.message, 'rollback_recusado_com_dados');
      // Sem linhas e sem objetos nos buckets (nenhum upload neste teste; o Supabase bloqueia DELETE direto
      // em storage.objects). A guarda de dados e a ordem de remocao sao o que se prova aqui.
      await client.query('delete from app.identity_document');
      // Auditoria e imutavel: se a suite de concorrencia gravou eventos identity.doc.*, o rollback deve recusar
      // pela chave estrangeira do catalogo (107 §4.4, "o que e desejado"). Sem eventos, o rollback completo roda.
      const eventosDoc = await client.query(
        `select count(*)::int as n from audit.audit_event where action like 'identity.doc.%'`,
      );
      if (eventosDoc.rows[0].n > 0) {
        const fk = await erroDe(sql);
        assert.ok(fk, 'rollback com eventos de auditoria deveria recusar');
        assert.match(fk.message, /audit_event_action_fk/);
        process.stdout.write(`# T-21 rollback recusado pela FK do catalogo (eventos de auditoria: ${eventosDoc.rows[0].n})\n`);
      } else {
        await client.query(sql);
        const sumiu = await client.query(`select to_regclass('app.identity_document') as t`);
        assert.equal(sumiu.rows[0].t, null);
      }
    } finally {
      await client.query('rollback');
    }
  });
});

// ---------------------------------------------------------------------------
// Concorrencia real e falha injetada (T-05, T-14, T-20, T-24; ciclo de correcao 2 da #50).
// Os cenarios de concorrencia GRAVAM no banco de desenvolvimento (politica permanente para dados sinteticos):
// usam um marcador unico por execucao no dominio do e-mail sintetico e removem somente os ids que criaram.
// audit.audit_event e imutavel (tg_block_mutation): os eventos que esses cenarios gravam nao podem ser
// removidos; o teste conta e reporta esses eventos em vez de apaga-los.
// Padrao: uma conexao "trava" a linha (ou a trava consultiva do teto) numa transacao aberta; as conexoes de
// trabalho bloqueiam de verdade (confirmado em pg_locks) e so depois a trava e liberada.
// ---------------------------------------------------------------------------
const MARCADOR = `h037-conc-${randomUUID().slice(0, 8)}`;
const APP_NAME = `h037:${MARCADOR}`;
const CRIADOS = { usuarios: [] };
const CONEXOES = [];
const EMITIR_SQL = 'select out_code, out_id, out_status from private.idoc_issue($1, $2, $3, $4, $5, $6)';
const RESERVA = 2097152;

async function nova() {
  const c = await connect();
  CONEXOES.push(c);
  await c.query(`select set_config('application_name', $1, false)`, [APP_NAME]);
  return c;
}

/** Espera ate n sessoes do marcador estarem bloqueadas em lock. Observador: a conexao principal, fora de transacao. */
async function esperarBloqueios(n, limiteMs = 8000) {
  const inicio = Date.now();
  for (;;) {
    const r = await client.query(
      `select count(*)::int as n from pg_locks l join pg_stat_activity a on a.pid = l.pid
        where not l.granted and a.application_name = $1`,
      [APP_NAME],
    );
    if (r.rows[0].n >= n || Date.now() - inicio > limiteMs) return r.rows[0].n;
    await pausa(40);
  }
}

async function perfilCometido(estado = 'pendente') {
  const id = randomUUID();
  CRIADOS.usuarios.push(id);
  await client.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, 'ativo', $4, now())`,
    [id, `${randomUUID()}@${MARCADOR}.example.test`, randomUUID(), AGORA],
  );
  await client.query(
    `insert into app.professional_profile (user_id, verification_status, created_at, updated_at)
     values ($1, $2, now(), now())`,
    [id, estado],
  );
  return id;
}

async function contagem() {
  const r = await client.query(
    `select (select count(*)::int from app.identity_document) as docs,
            (select count(*)::int from app.app_user where email like $1) as usuarios,
            (select count(*)::int from app.professional_profile p join app.app_user u on u.id = p.user_id
              where u.email like $1) as perfis`,
    [`%@${MARCADOR}.example.test`],
  );
  return r.rows[0];
}

/** Remove SOMENTE o que este run criou (ids guardados). Auditoria nao e removida (imutavel). */
async function limpar() {
  const ids = CRIADOS.usuarios;
  if (ids.length === 0) return { docs: 0, perfis: 0, usuarios: 0 };
  const docs = await client.query('delete from app.identity_document where professional_id = any($1::uuid[])', [ids]);
  const perfis = await client.query('delete from app.professional_profile where user_id = any($1::uuid[])', [ids]);
  const usuarios = await client.query('delete from app.app_user where id = any($1::uuid[])', [ids]);
  CRIADOS.usuarios = [];
  return { docs: docs.rowCount, perfis: perfis.rowCount, usuarios: usuarios.rowCount };
}

const comoResultado = (p) => p.then((r) => r.rows[0], (e) => ({ erro: e.message }));

describe('concorrencia real com conexoes separadas (T-05, T-20, T-24; grava e limpa o que criou)', () => {
  let antes;
  before(async () => {
    antes = await contagem();
  });
  after(async () => {
    for (const c of CONEXOES.splice(0)) await c.end().catch(() => {});
    const removidos = await limpar();
    const depois = await contagem();
    process.stdout.write(
      `# h037 concorrencia marcador=${MARCADOR} antes=${JSON.stringify(antes)} removidos=${JSON.stringify(removidos)} depois=${JSON.stringify(depois)}\n`,
    );
    assert.deepEqual(depois, antes, 'a limpeza deve devolver a contagem inicial');
  });

  test('6 emissoes simultaneas com 4 vivos: exatamente 1 aceita, 5 doc_limit, 5 vivos no banco (T-05, CA-05)', async () => {
    const u = await perfilCometido();
    for (let i = 0; i < 4; i++) await client.query(EMITIR_SQL, [u, randomUUID(), JPEG, 1000, AGORA, CAP]);
    const trava = await nova();
    await trava.query('begin');
    await trava.query('select 1 from app.professional_profile where user_id = $1 for update', [u]);
    const trabalhadores = await Promise.all(Array.from({ length: 6 }, () => nova()));
    let promessas;
    let bloqueadas;
    try {
      promessas = trabalhadores.map((c) =>
        comoResultado(c.query(EMITIR_SQL, [u, randomUUID(), JPEG, 1000, AGORA, CAP])));
      bloqueadas = await esperarBloqueios(6);
    } finally {
      await trava.query('rollback');
    }
    const resultados = await Promise.all(promessas);
    process.stdout.write(`# T-05 sessoes bloqueadas antes de liberar a trava: ${bloqueadas}\n`);
    assert.ok(bloqueadas >= 6, `esperava 6 sessoes bloqueadas, viu ${bloqueadas}`);
    assert.deepEqual(
      resultados.map((r) => r.out_code).sort(),
      ['doc_limit', 'doc_limit', 'doc_limit', 'doc_limit', 'doc_limit', 'new'],
    );
    const vivos = await client.query(
      `select count(*)::int as n from app.identity_document
        where professional_id = $1 and purge_requested_at is null and status in ('pendente_envio', 'recebido')`,
      [u],
    );
    assert.equal(vivos.rows[0].n, 5);
  });

  test('duas emissoes simultaneas no limite do teto global: exatamente uma aceita (T-20, RN-15)', async () => {
    const soma = async () =>
      Number(
        (await client.query(
          `select coalesce(sum(d.stored_bytes), 0)::bigint + ${RESERVA}::bigint
                    * count(*) filter (where d.status = 'pendente_envio') as total
             from app.identity_document d`,
        )).rows[0].total,
      );
    const base = await soma();
    const cap = base + RESERVA; // cabe exatamente uma reserva
    const p1 = await perfilCometido();
    const p2 = await perfilCometido();
    const trava = await nova();
    await trava.query('begin');
    await trava.query(`select pg_advisory_xact_lock(hashtext('identity_docs_teto_global'))`);
    const trabalhadores = await Promise.all([nova(), nova()]);
    let promessas;
    let bloqueadas;
    try {
      promessas = [[trabalhadores[0], p1], [trabalhadores[1], p2]].map(([c, u]) =>
        comoResultado(c.query(EMITIR_SQL, [u, randomUUID(), JPEG, 1000, AGORA, cap])));
      bloqueadas = await esperarBloqueios(2);
    } finally {
      await trava.query('rollback');
    }
    const resultados = await Promise.all(promessas);
    process.stdout.write(`# T-20 sessoes bloqueadas no teto: ${bloqueadas}\n`);
    assert.ok(bloqueadas >= 2, `esperava 2 sessoes bloqueadas, viu ${bloqueadas}`);
    assert.deepEqual(resultados.map((r) => r.out_code).sort(), ['cap', 'new']);
    assert.equal(await soma(), base + RESERVA, 'o total nao pode passar do que coube no teto');
  });

  test('duas finalizacoes simultaneas: so uma inicia a tentativa; depois so uma grava recebido (T-24, D-5)', async () => {
    const u = await perfilCometido();
    const emitido = await client.query(EMITIR_SQL, [u, randomUUID(), PDF, 1000, AGORA, CAP]);
    const id = emitido.rows[0].out_id;

    const trava = await nova();
    await trava.query('begin');
    await trava.query('select 1 from app.identity_document where id = $1 for update', [id]);
    const iniciadores = await Promise.all(Array.from({ length: 4 }, () => nova()));
    let inicios;
    let bloqueadas;
    try {
      inicios = iniciadores.map((c) =>
        comoResultado(c.query('select out_code, out_attempt from private.idoc_confirm_begin($1, $2, $3, 30)', [u, id, AGORA])));
      bloqueadas = await esperarBloqueios(4);
    } finally {
      await trava.query('rollback');
    }
    const iniciados = await Promise.all(inicios);
    process.stdout.write(`# T-24 sessoes bloqueadas no inicio da finalizacao: ${bloqueadas}\n`);
    assert.ok(bloqueadas >= 4, `esperava 4 sessoes bloqueadas, viu ${bloqueadas}`);
    assert.deepEqual(iniciados.map((r) => r.out_code).sort(), ['begin', 'busy', 'busy', 'busy']);
    const tentativa = iniciados.find((r) => r.out_code === 'begin').out_attempt;

    const trava2 = await nova();
    await trava2.query('begin');
    await trava2.query('select 1 from app.identity_document where id = $1 for update', [id]);
    const concluidores = await Promise.all([nova(), nova()]);
    let conclusoes;
    let bloqueadas2;
    try {
      conclusoes = concluidores.map((c) =>
        c.query('select private.idoc_confirm_done($1, $2, $3, $4, $5, $6, $7) as r',
          [u, id, tentativa, PDF, 1000, Buffer.alloc(32, 9), AGORA]).then((r) => r.rows[0].r, (e) => `erro:${e.message}`));
      bloqueadas2 = await esperarBloqueios(2);
    } finally {
      await trava2.query('rollback');
    }
    const finais = await Promise.all(conclusoes);
    process.stdout.write(`# T-24 sessoes bloqueadas na conclusao: ${bloqueadas2}\n`);
    assert.ok(bloqueadas2 >= 2, `esperava 2 sessoes bloqueadas, viu ${bloqueadas2}`);
    assert.deepEqual(finais.sort(), ['gone', 'received']);

    const st = await client.query('select status from app.identity_document where id = $1', [id]);
    assert.equal(st.rows[0].status, 'recebido');
    const ev = await client.query(
      `select count(*)::int as n from audit.audit_event
        where object_type = 'identity_document' and object_id = $1 and action = 'identity.doc.received'`,
      [id],
    );
    assert.equal(ev.rows[0].n, 1, 'um unico evento de recebimento');
    const repetido = await client.query('select out_code from private.idoc_confirm_begin($1, $2, $3, 30)', [u, id, AGORA]);
    assert.equal(repetido.rows[0].out_code, 'replay');
  });
});

describe('falha injetada em private.audit_append desfaz a acao (T-14, CA-14)', () => {
  test('recebimento, recusa, exclusao e emissoes recusadas falham: sem mudanca de linha e sem evento', () =>
    tx(async () => {
      const u = await profissional();
      const d1 = await emitirOk(u, JPEG, 1000);
      const d2 = await emitirOk(u, PDF, 1000);
      const b2 = await iniciar(u, d2);
      const lim = await profissional();
      for (let i = 0; i < 5; i++) await emitirOk(lim);
      const aprov = await profissional({ estado: 'aprovada' });
      const linhas = async (usuario) =>
        (await client.query(
          `select id, status, purge_requested_at, stored_type, attempts
             from app.identity_document where professional_id = $1 order by id`,
          [usuario],
        )).rows;
      const eventos = async () =>
        (await client.query(
          'select count(*)::int as n from audit.audit_event where object_id = any($1::uuid[])',
          [[d1, d2]],
        )).rows[0].n;
      const antes = await linhas(u);
      const antesLim = await linhas(lim);
      assert.equal(antes.length, 2);
      assert.equal(antesLim.length, 5);
      assert.equal(await eventos(), 0);

      // Gatilho temporario: toda gravacao em audit.audit_event falha. Some no rollback da transacao de teste.
      await client.query(
        `create function private.h037_falha_auditoria() returns trigger language plpgsql as
         $$ begin raise exception 'falha_injetada_h037'; end $$`,
      );
      await client.query(
        `create trigger h037_falha_auditoria before insert on audit.audit_event
         for each row execute function private.h037_falha_auditoria()`,
      );

      // Controle: a falha de fato dispara (sem isso, os cenarios abaixo seriam vacuos).
      const controle = await erroDe(
        `select private.audit_append($1, 'professional', 'identity.doc.deleted', 'identity_document', $2,
           '{}'::jsonb, '{}'::jsonb, null, null)`,
        [`professional:${u}`, d1],
      );
      assert.equal(controle?.message, 'falha_injetada_h037', 'o controle deveria disparar a falha');

      const recebimento = await erroDe(
        'select private.idoc_confirm_done($1, $2, $3, $4, $5, $6, $7)',
        [u, d2, b2.rows[0].out_attempt, PDF, 1000, Buffer.alloc(32, 4), AGORA],
      );
      const recusa = await erroDe(
        'select private.idoc_confirm_refuse($1, $2, $3, $4, $5)',
        [u, d2, b2.rows[0].out_attempt, 'pdf_ativo', AGORA],
      );
      const exclusao = await erroDe('select private.idoc_delete($1, $2, $3)', [u, d1, AGORA]);
      const emissaoLimite = await erroDe(EMITIR_SQL, [lim, randomUUID(), JPEG, 1000, AGORA, CAP]);
      const emissaoEstado = await erroDe(EMITIR_SQL, [aprov, randomUUID(), JPEG, 1000, AGORA, CAP]);
      assert.equal(recebimento?.message, 'falha_injetada_h037', 'recebimento');
      assert.equal(recusa?.message, 'falha_injetada_h037', 'recusa');
      assert.equal(exclusao?.message, 'falha_injetada_h037', 'exclusao');
      assert.equal(emissaoLimite?.message, 'falha_injetada_h037', 'emissao com recusa por limite');
      assert.equal(emissaoEstado?.message, 'falha_injetada_h037', 'emissao com recusa por estado');

      assert.deepEqual(await linhas(u), antes, 'nenhuma linha do profissional deve mudar');
      assert.deepEqual(await linhas(lim), antesLim, 'a sexta emissao nao pode criar linha');
      assert.equal((await linhas(aprov)).length, 0, 'emissao recusada por estado nao cria linha');
      assert.equal(await eventos(), 0, 'nenhum evento de auditoria pode ter ficado');
    }));
});
