// Issue 120 (H-111) | Grant de step-up e extrato do titular no banco (147-DESENHO-H111 §3.2, §7: T-DB-01, T-DB-02,
// T-DB-09 e regras de imutabilidade do grant e do extrato). Banco de desenvolvimento.
// Cada teste roda em transacao e e desfeito (rollback). Valores sinteticos (@example.test). Sem rede, sem e-mail.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomInt, randomBytes } from 'node:crypto';
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
const hex = () => randomBytes(32).toString('hex');

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

/** Caso de direito (fixture). Acesso por padrao, porque o extrato so existe para acesso. */
async function criarCaso(sujeito, kind = 'acesso') {
  const { rows } = await client.query(
    `insert into app.dsr_case (protocol, subject_user_id, kind, deadline_at)
     values ($1, $2, $3, now() + interval '15 days') returning id`,
    [protocolo(), sujeito, kind],
  );
  return rows[0].id;
}

async function criarGrant(sujeito, extra = {}) {
  const campos = {
    user_id: sujeito,
    purpose: 'dsr_open',
    token_hash: hex(),
    expires_at: null,
    ...extra,
  };
  const { rows } = await client.query(
    `insert into app.step_up_grant (user_id, purpose, token_hash, expires_at)
     values ($1, $2, $3, coalesce($4::timestamptz, now() + interval '15 minutes')) returning id`,
    [campos.user_id, campos.purpose, campos.token_hash, campos.expires_at],
  );
  return rows[0].id;
}

async function criarExtrato(caso, extra = {}) {
  const campos = {
    storage_path: `${randomUUID()}.json`,
    sha256: hex(),
    signature: hex(),
    schema_version: 1,
    size_bytes: 2048,
    ...extra,
  };
  const { rows } = await client.query(
    `insert into app.dsr_export (case_id, storage_path, sha256, signature, schema_version, size_bytes, expires_at)
     values ($1, $2, $3, $4, $5, $6, now() + interval '7 days') returning id`,
    [caso, campos.storage_path, campos.sha256, campos.signature, campos.schema_version, campos.size_bytes],
  );
  return rows[0].id;
}

test('T-DB-01 | colunas essenciais das duas tabelas existem no catalogo', async () => {
  await tx(async () => {
    const { rows: g } = await client.query(
      `select column_name from information_schema.columns where table_schema = 'app' and table_name = 'step_up_grant'`,
    );
    const gNomes = new Set(g.map((r) => r.column_name));
    for (const c of ['id', 'user_id', 'purpose', 'token_hash', 'created_at', 'expires_at', 'consumed_at']) {
      assert.ok(gNomes.has(c), `coluna do grant ausente: ${c}`);
    }
    const { rows: e } = await client.query(
      `select column_name from information_schema.columns where table_schema = 'app' and table_name = 'dsr_export'`,
    );
    const eNomes = new Set(e.map((r) => r.column_name));
    for (const c of ['id', 'case_id', 'storage_bucket', 'storage_path', 'sha256', 'signature', 'schema_version',
      'size_bytes', 'generated_at', 'expires_at', 'purged_at', 'download_count', 'last_download_at']) {
      assert.ok(eNomes.has(c), `coluna do extrato ausente: ${c}`);
    }
  });
});

test('T-DB-02 | RLS forcada nas duas tabelas; papeis de API, anon, authenticated e servico sem privilegio direto', async () => {
  await tx(async () => {
    const { rows } = await client.query(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relname in ('step_up_grant', 'dsr_export')`,
    );
    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.equal(r.relrowsecurity, true, `RLS habilitada em ${r.relname}`);
      assert.equal(r.relforcerowsecurity, true, `RLS forcada em ${r.relname}`);
    }
    for (const papel of ['anon', 'authenticated', 'app_api', PAPEL_SERVICO]) {
      for (const tabela of ['app.step_up_grant', 'app.dsr_export']) {
        for (const priv of ['select', 'insert', 'update', 'delete']) {
          const { rows: p } = await client.query('select has_table_privilege($1, $2, $3) as ok', [papel, tabela, priv]);
          assert.equal(p[0].ok, false, `${papel} nao deve ter ${priv} em ${tabela}`);
        }
      }
    }
    const { rows: leitura } = await client.query(
      `select has_table_privilege('app_system', 'app.dsr_export', 'select') as le,
              has_table_privilege('app_system', 'app.dsr_export', 'insert') as escreve`,
    );
    assert.equal(leitura[0].le, true, 'app_system le o extrato');
    assert.equal(leitura[0].escreve, false, 'app_system nao escreve direto (escrita por funcao)');
  });
});

test('T-DB-02 | anon e authenticated recebem permission denied ao ler e gravar o grant e o extrato', async () => {
  await tx(async () => {
    for (const papel of ['anon', 'authenticated']) {
      await client.query(`set local role ${papel}`);
      const lidoG = await erroDe('select count(*) from app.step_up_grant');
      assert.equal(lidoG.code, '42501', `${papel} leitura do grant`);
      const lidoE = await erroDe('select count(*) from app.dsr_export');
      assert.equal(lidoE.code, '42501', `${papel} leitura do extrato`);
      const gravadoG = await erroDe(
        `insert into app.step_up_grant (user_id, purpose, token_hash, expires_at)
         values (gen_random_uuid(), 'dsr_open', $1, now() + interval '15 minutes')`,
        [hex()],
      );
      assert.equal(gravadoG.code, '42501', `${papel} escrita do grant`);
      await client.query('reset role');
    }
  });
});

test('T-DB-01 | grant: finalidade, formato do hash e validade sao validados', async () => {
  await tx(async () => {
    const titular = await usuario();
    const finalidade = await erroDe(
      `insert into app.step_up_grant (user_id, purpose, token_hash, expires_at)
       values ($1, 'login', $2, now() + interval '15 minutes')`,
      [titular, hex()],
    );
    assert.equal(finalidade.code, '23514', 'finalidade fora de dsr_open recusada');

    const hashRuim = await erroDe(
      `insert into app.step_up_grant (user_id, purpose, token_hash, expires_at)
       values ($1, 'dsr_open', 'token-em-claro', now() + interval '15 minutes')`,
      [titular],
    );
    assert.equal(hashRuim.code, '23514', 'token que nao e hash SHA-256 recusado');

    const vencidoAntes = await erroDe(
      `insert into app.step_up_grant (user_id, purpose, token_hash, expires_at)
       values ($1, 'dsr_open', $2, now() - interval '1 minute')`,
      [titular, hex()],
    );
    assert.equal(vencidoAntes.code, '23514', 'validade anterior a criacao recusada');

    const id = await criarGrant(titular);
    assert.ok(id, 'grant valido aceito');
  });
});

test('T-DB-02 | grant: hash unico; consumo gravado uma vez; identidade imutavel; exclusao recusada', async () => {
  await tx(async () => {
    const titular = await usuario();
    const token = hex();
    const id = await criarGrant(titular, { token_hash: token });

    const repetido = await erroDe(
      `insert into app.step_up_grant (user_id, purpose, token_hash, expires_at)
       values ($1, 'dsr_open', $2, now() + interval '15 minutes')`,
      [titular, token],
    );
    assert.equal(repetido.code, '23505', 'hash repetido recusado');

    const troca = await erroDe('update app.step_up_grant set token_hash = $2 where id = $1', [id, hex()]);
    assert.match(troca.message, /step_up_grant_imutavel/, 'hash nao muda');
    const outroDono = await erroDe('update app.step_up_grant set user_id = $2 where id = $1', [id, await usuario()]);
    assert.match(outroDono.message, /step_up_grant_imutavel/, 'titular do grant nao muda');

    await client.query('update app.step_up_grant set consumed_at = now() where id = $1', [id]);
    const { rows } = await client.query('select consumed_at from app.step_up_grant where id = $1', [id]);
    assert.ok(rows[0].consumed_at, 'primeiro consumo gravado');

    const segundo = await erroDe(
      'update app.step_up_grant set consumed_at = now() + interval \'1 second\' where id = $1',
      [id],
    );
    assert.match(segundo.message, /step_up_grant_ja_consumido/, 'segundo consumo recusado');

    const apagar = await erroDe('delete from app.step_up_grant where id = $1', [id]);
    assert.match(apagar.message, /dsr_registro_nao_deletavel/, 'grant nao pode ser excluido');
    const truncar = await erroDe('truncate app.step_up_grant');
    assert.match(truncar.message, /dsr_registro_nao_deletavel/, 'grant nao pode ser truncado');
  });
});

test('T-DB-01 | extrato: um por caso; formatos de hash, tamanho e caminho validados', async () => {
  await tx(async () => {
    const titular = await usuario();
    const acesso = await criarCaso(titular, 'acesso');
    const id = await criarExtrato(acesso);
    assert.ok(id, 'extrato valido aceito');

    const repetido = await erroDe(
      `insert into app.dsr_export (case_id, storage_path, sha256, signature, schema_version, size_bytes, expires_at)
       values ($1, $2, $3, $4, 1, 10, now() + interval '7 days')`,
      [acesso, `${randomUUID()}.json`, hex(), hex()],
    );
    assert.equal(repetido.code, '23505', 'segundo extrato do mesmo caso recusado');

    const outroCaso = await criarCaso(titular, 'correcao');
    const hashRuim = await erroDe(
      `insert into app.dsr_export (case_id, storage_path, sha256, signature, schema_version, size_bytes, expires_at)
       values ($1, $2, 'curto', $3, 1, 10, now() + interval '7 days')`,
      [outroCaso, `${randomUUID()}.json`, hex()],
    );
    assert.equal(hashRuim.code, '23514', 'hash que nao e SHA-256 recusado');

    const caminhoRuim = await erroDe(
      `insert into app.dsr_export (case_id, storage_path, sha256, signature, schema_version, size_bytes, expires_at)
       values ($1, 'meu-nome.json', $2, $3, 1, 10, now() + interval '7 days')`,
      [outroCaso, hex(), hex()],
    );
    assert.equal(caminhoRuim.code, '23514', 'caminho com nome legivel recusado');

    const tamanhoZero = await erroDe(
      `insert into app.dsr_export (case_id, storage_path, sha256, signature, schema_version, size_bytes, expires_at)
       values ($1, $2, $3, $4, 1, 0, now() + interval '7 days')`,
      [outroCaso, `${randomUUID()}.json`, hex(), hex()],
    );
    assert.equal(tamanhoZero.code, '23514', 'extrato vazio recusado');
  });
});

test('T-DB-02 | extrato: identidade do arquivo imutavel; expurgo gravado uma vez; contador de downloads so cresce', async () => {
  await tx(async () => {
    const titular = await usuario();
    const caso = await criarCaso(titular, 'acesso');
    const id = await criarExtrato(caso);

    const hashTroca = await erroDe('update app.dsr_export set sha256 = $2 where id = $1', [id, hex()]);
    assert.match(hashTroca.message, /dsr_export_imutavel/, 'sha256 nao muda');
    const caminhoTroca = await erroDe('update app.dsr_export set storage_path = $2 where id = $1', [id, `${randomUUID()}.json`]);
    assert.match(caminhoTroca.message, /dsr_export_imutavel/, 'caminho nao muda');

    // Contador sem data da ultima leitura: recusado pela restricao de consistencia (outro extrato, sem downloads).
    const outroCaso = await criarCaso(await usuario(), 'acesso');
    const outroId = await criarExtrato(outroCaso);
    const semData = await erroDe('update app.dsr_export set download_count = 1 where id = $1', [outroId]);
    assert.equal(semData.code, '23514', 'download sem data da ultima leitura recusado');

    await client.query('update app.dsr_export set download_count = 1, last_download_at = now() where id = $1', [id]);
    await client.query('update app.dsr_export set download_count = 2, last_download_at = now() where id = $1', [id]);
    const recua = await erroDe('update app.dsr_export set download_count = 1, last_download_at = now() where id = $1', [id]);
    assert.match(recua.message, /dsr_export_contador_regressivo/, 'contador nao recua');

    await client.query('update app.dsr_export set purged_at = now() where id = $1', [id]);
    const expurgoTroca = await erroDe('update app.dsr_export set purged_at = null where id = $1', [id]);
    assert.match(expurgoTroca.message, /dsr_export_ja_expurgado/, 'expurgo nao e desfeito');

    const apagar = await erroDe('delete from app.dsr_export where id = $1', [id]);
    assert.match(apagar.message, /dsr_registro_nao_deletavel/, 'extrato nao pode ser excluido');
    const truncar = await erroDe('truncate app.dsr_export');
    // Desde a migracao 20261120000000 a tabela de tokens referencia o extrato (FK restrict): o Postgres recusa o
    // TRUNCATE pela chave estrangeira antes do gatilho. A protecao continua valendo; aceita-se a mensagem da FK.
    assert.match(truncar.message, /dsr_registro_nao_deletavel|cannot truncate a table referenced in a foreign key constraint/, 'extrato nao pode ser truncado');
  });
});

test('bucket dsr-exports privado, so application/json, limite de 10 MiB; politica restritiva presente', async () => {
  const { rows } = await client.query(
    `select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'dsr-exports'`,
  );
  assert.equal(rows.length, 1, 'bucket existe');
  assert.equal(rows[0].public, false, 'bucket privado');
  assert.equal(Number(rows[0].file_size_limit), 10485760, 'limite de 10 MiB');
  assert.deepEqual(rows[0].allowed_mime_types, ['application/json'], 'tipo permitido');

  const { rows: pol } = await client.query(
    `select permissive, cmd, roles from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and policyname = 'dsr_exports_negar_acesso_direto'`,
  );
  assert.equal(pol.length, 1, 'politica existe');
  assert.equal(pol[0].permissive, 'RESTRICTIVE', 'politica restritiva');
  assert.equal(pol[0].cmd, 'ALL', 'vale para todas as operacoes');
});

test('T-DB-09 | exclusao de grant e de extrato proibida; contagem de extratos preservada', async () => {
  await tx(async () => {
    const titular = await usuario();
    const caso = await criarCaso(titular, 'acesso');
    const id = await criarExtrato(caso);
    const { rows } = await client.query('select count(*)::int as n from app.dsr_export where case_id = $1', [caso]);
    assert.equal(rows[0].n, 1, 'um extrato gravado');
    const apagar = await erroDe('delete from app.dsr_export where case_id = $1', [caso]);
    assert.match(apagar.message, /dsr_registro_nao_deletavel/, 'delete de extrato recusado');
    const { rows: depois } = await client.query('select id from app.dsr_export where id = $1', [id]);
    assert.equal(depois.length, 1, 'extrato continua presente');
  });
});
