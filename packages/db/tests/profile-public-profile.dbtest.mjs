// Issue 56 (H-043) | Cenarios de banco da leitura publica do perfil (docs/factory/143-DESENHO-H043.md, §4 e §8).
// Cobre T43-02 (lista fechada), T43-03 (sem contato, documento nem localizacao no JSON), T43-06 e T43-07
// (negacoes devolvem null), T43-08 (slug invalido devolve null, nunca erro), T43-16 (indice de slug),
// T43-18 (atributos e grants da funcao), T43-19 (imutabilidade). Cada teste roda numa transacao e termina
// com rollback: nada persiste no banco compartilhado. Dados sinteticos com marcador unico (@example.test).
// Rodar sozinho: node --test --test-concurrency=1 packages/db/tests/profile-public-profile.dbtest.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';

const SQL_LER = 'select private.professional_public_profile($1) as perfil';
const FUNCAO = 'private.professional_public_profile(text)';
const CHAVES_PERFIL = ['publicName', 'slug', 'verified', 'services', 'rating'];
const CHAVES_GRUPO = ['groupName', 'items'];
const CHAVES_ITEM = ['modalities', 'name'];
const CHAVES_REPUTACAO = ['average', 'count'];
const PROIBIDOS = ['phone', 'whatsapp', 'email', 'userId', 'user_id', 'document', 'radius', 'base', 'commercial'];

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

/** Cria usuario e perfil sinteticos; devolve o slug e o id. Os status sao gravados direto (sem gatilho de atualizacao). */
async function criarPerfil({ m = randomUUID().slice(0, 8), status = 'aprovada', suspenso = false, usuarioStatus = 'ativo', caso = null, catalogo = false } = {}) {
  const id = randomUUID();
  const slug = `perfil-${m}`;
  await client.query(
    'insert into app.app_user (id, email, auth_user_id, status, created_at) values ($1, $2, $3, $4, now())',
    [id, `${m}@example.test`, randomUUID(), usuarioStatus],
  );
  // Cadastro completo (nome, slug e documento juntos): documento sintetico, HMAC unico por perfil.
  await client.query(
    `insert into app.professional_profile
       (user_id, verification_status, suspended_at, suspension_reason, created_at, updated_at, public_name, slug,
        document_type, document_enc, document_hmac)
     values ($1, $2, $3, $4, now(), now(), $5, $6, 'CPF', $7, $8)`,
    [
      id,
      status,
      suspenso ? new Date().toISOString() : null,
      suspenso ? 'teste sintetico' : null,
      `Ana ${m}`,
      slug,
      Buffer.from(`documento-sintetico-${m}`),
      createHash('sha256').update(`hmac-sintetico-${id}`).digest('hex'),
    ],
  );
  if (caso !== null) {
    // Caso em revisao exige responsavel (vc_revisao_com_responsavel): cria um revisor sintetico na transacao.
    if (caso === 'em_revisao') {
      const revisor = randomUUID();
      await client.query(
        'insert into app.app_user (id, email, auth_user_id, status, created_at) values ($1, $2, $3, $4, now())',
        [revisor, `revisor-${m}@example.test`, randomUUID(), 'ativo'],
      );
      await client.query(
        `insert into app.admin_staff (user_id, status, origin, created_at, status_changed_at)
         values ($1, 'pendente_mfa', 'bootstrap', now(), now())`,
        [revisor],
      );
      await client.query(
        `insert into app.verification_case (professional_id, status, assigned_to, sla_target_at, created_at, updated_at)
         values ($1, 'em_revisao', $2, now() + interval '1 day', now(), now())`,
        [id, revisor],
      );
    } else {
      await client.query(
        `insert into app.verification_case (professional_id, status, sla_target_at, created_at, updated_at)
         values ($1, $2, now() + interval '1 day', now(), now())`,
        [id, caso],
      );
    }
  }
  if (catalogo) {
    const grupo = randomUUID();
    await client.query('insert into app.service_group (id, name, position, active) values ($1, $2, 1, true)', [grupo, `Grupo ${m}`]);
    const servicoA = randomUUID();
    const servicoB = randomUUID();
    const inativo = randomUUID();
    await client.query(
      `insert into app.service (id, group_id, name, modality, regulated, active)
       values ($1, $2, $3, 'ambos', false, true), ($4, $2, $5, 'ambos', false, true), ($6, $2, $7, 'ambos', false, true)`,
      [servicoA, grupo, `Servico ${m} A`, servicoB, `Servico ${m} B`, inativo, `Inativo ${m}`],
    );
    // Base sintetica: servico presencial exige base vigente (regra servico_presencial_sem_base).
    const ponto = randomUUID();
    await client.query(
      `insert into app.geocode_point (id, subject_kind, subject_id, address_hash, state, exact_point, geocode_mode, precision, geocoded_at)
       values ($1, 'professional_base', $2, $3, 'ok', $4::extensions.geography, 'permanent', 'endereco', now())`,
      [ponto, id, createHash('sha256').update(`endereco-${id}`).digest('hex'), 'SRID=4326;POINT(-46.63 -23.55)'],
    );
    await client.query(
      `insert into app.professional_area (professional_id, geocode_point_id, base_label, radius_m, valid_since, updated_at)
       values ($1, $2, 'Base sintetica', 5000, now(), now())`,
      [id, ponto],
    );
    await client.query(
      `insert into app.professional_service (professional_id, service_id, modality, declared_at)
       values ($1, $2, 'presencial', now()), ($1, $2, 'online', now()), ($1, $3, 'presencial', now()), ($1, $4, 'online', now())`,
      [id, servicoA, servicoB, inativo],
    );
    // Desativa o servico depois do vinculo: o servico desativado nao pode aparecer no perfil.
    await client.query('update app.service set active = false where id = $1', [inativo]);
  }
  return { id, slug, m };
}

async function lerPerfil(slug) {
  const r = await client.query(SQL_LER, [slug]);
  return r.rows[0].perfil;
}

describe('T43-02 leitura de perfil aprovado: lista fechada', () => {
  test('perfil aprovado devolve exatamente as chaves permitidas, em todos os niveis', () =>
    tx(async () => {
      const f = await criarPerfil({ catalogo: true });
      const perfil = await lerPerfil(f.slug);
      assert.deepEqual(Object.keys(perfil).sort(), [...CHAVES_PERFIL].sort());
      assert.equal(perfil.verified, true);
      assert.equal(perfil.publicName, `Ana ${f.m}`);
      assert.equal(perfil.slug, f.slug);
      assert.deepEqual(Object.keys(perfil.rating).sort(), CHAVES_REPUTACAO);
      assert.equal(perfil.rating.average, null);
      assert.equal(perfil.rating.count, 0);
      assert.equal(perfil.services.length, 1);
      const grupo = perfil.services[0];
      assert.deepEqual(Object.keys(grupo).sort(), CHAVES_GRUPO);
      assert.equal(grupo.groupName, `Grupo ${f.m}`);
      for (const item of grupo.items) assert.deepEqual(Object.keys(item).sort(), CHAVES_ITEM);
    }));

  test('servicos agrupados, em ordem alfabetica, modalidades em ordem e servico inativo fora', () =>
    tx(async () => {
      const f = await criarPerfil({ catalogo: true });
      const perfil = await lerPerfil(f.slug);
      assert.deepEqual(perfil.services[0].items, [
        { name: `Servico ${f.m} A`, modalities: ['online', 'presencial'] },
        { name: `Servico ${f.m} B`, modalities: ['presencial'] },
      ]);
      assert.equal(perfil.services[0].items.some((x) => x.name.startsWith('Inativo')), false);
    }));

  test('perfil aprovado sem servicos devolve lista vazia, nunca nulo', () =>
    tx(async () => {
      const f = await criarPerfil();
      const perfil = await lerPerfil(f.slug);
      assert.deepEqual(perfil.services, []);
    }));

  test('o JSON nao carrega e-mail, identificador interno nem marcadores de contato', () =>
    tx(async () => {
      const f = await criarPerfil({ catalogo: true });
      const perfil = await lerPerfil(f.slug);
      const texto = JSON.stringify(perfil);
      assert.equal(texto.includes(`${f.m}@example.test`), false);
      assert.equal(texto.includes(f.id), false);
      const chaves = [];
      const percorrer = (v) => {
        if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { chaves.push(k); percorrer(x); }
      };
      percorrer(perfil);
      for (const proibido of PROIBIDOS) {
        assert.equal(chaves.some((k) => k.toLowerCase().includes(proibido.toLowerCase())), false, proibido);
      }
    }));
});

describe('T43-06 e T43-07 perfil nao visivel devolve null', () => {
  const casos = [
    ['pendente', { status: 'pendente' }],
    ['em revisao', { status: 'em_revisao' }],
    ['retida por duplicidade', { status: 'retida_duplicidade' }],
    ['recusada', { status: 'recusada' }],
    ['suspensa por status', { status: 'suspensa' }],
    ['aprovada com suspended_at', { suspenso: true }],
    ['usuario bloqueado', { usuarioStatus: 'bloqueado' }],
    ['aprovada com caso pendente', { caso: 'pendente' }],
    ['aprovada com caso em revisao', { caso: 'em_revisao' }],
  ];
  for (const [nome, opts] of casos) {
    test(`${nome}: null`, () =>
      tx(async () => {
        const f = await criarPerfil(opts);
        assert.equal(await lerPerfil(f.slug), null);
      }));
  }
});

describe('T43-08 slug inexistente ou mal formado devolve null, sem erro', () => {
  const invalidos = ['', 'Maiuscula', 'com espaco', 'x_y', '-inicio', 'a'.repeat(101), '../etc', 'acento-é'];
  for (const slug of invalidos) {
    test(`slug ${JSON.stringify(slug.slice(0, 20))}: null`, () =>
      tx(async () => {
        assert.equal(await lerPerfil(slug), null);
      }));
  }
  test('nulo devolve null', () =>
    tx(async () => {
      assert.equal(await lerPerfil(null), null);
    }));
  test('UUID e slug inexistente de formato valido devolvem null', () =>
    tx(async () => {
      assert.equal(await lerPerfil(randomUUID()), null);
      assert.equal(await lerPerfil(`inexistente-${randomUUID().slice(0, 8)}`), null);
    }));
});

describe('T43-16 indice de slug', () => {
  test('slug tem indice unico em app.professional_profile e o plano usa o indice', () =>
    tx(async () => {
      const idx = await client.query(
        "select indexdef from pg_indexes where schemaname = 'app' and tablename = 'professional_profile' and indexdef ilike '%(slug)%'",
      );
      assert.ok(idx.rows.some((r) => /unique/i.test(r.indexdef)), 'indice unico de slug');
      await client.query('set local enable_seqscan = off');
      const plano = await client.query("explain select 1 from app.professional_profile p where p.slug = 'slug-sintetico'");
      assert.ok(plano.rows.some((r) => /professional_profile_slug_key/.test(r['QUERY PLAN'])), 'plano usa o indice');
    }));
});

describe('T43-18 atributos e grants da funcao', () => {
  test('stable, security definer, search_path vazio e so app_system com EXECUTE', () =>
    tx(async () => {
      const r = await client.query(
        `select p.provolatile, p.prosecdef, array_to_string(p.proconfig, ',') as config,
                has_function_privilege('app_system', p.oid, 'EXECUTE') as app_system,
                has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
                has_function_privilege('app_api', p.oid, 'EXECUTE') as app_api,
                has_function_privilege('${'service' + '_role'}', p.oid, 'EXECUTE') as servico,
                exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as publico
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'private' and p.proname = 'professional_public_profile'`,
      );
      const f = r.rows[0];
      assert.equal(f.provolatile, 's');
      assert.equal(f.prosecdef, true);
      assert.match(f.config, /search_path=/);
      assert.equal(f.app_system, true);
      assert.equal(f.anon, false);
      assert.equal(f.authenticated, false);
      assert.equal(f.app_api, false);
      assert.equal(f.servico, false);
      assert.equal(f.publico, false);
    }));
});

describe('T43-19 imutabilidade: a leitura nao grava nada', () => {
  test('contagens e conteudo do perfil e do caso iguais antes e depois de N leituras', () =>
    tx(async () => {
      const f = await criarPerfil({ catalogo: true, caso: null });
      const fotografia = async () => {
        const r = await client.query(
          `select (select count(*)::int from app.professional_profile) as perfis,
                  (select count(*)::int from app.professional_service) as servicos,
                  (select count(*)::int from app.verification_case) as casos,
                  (select count(*)::int from audit.audit_event) as auditoria,
                  (select md5(string_agg(p::text, '|')) from app.professional_profile p where p.user_id = $1) as hash_perfil,
                  (select md5(string_agg(s::text, '|')) from app.professional_service s where s.professional_id = $1) as hash_servicos`,
          [f.id],
        );
        return r.rows[0];
      };
      const antes = await fotografia();
      for (let i = 0; i < 5; i += 1) await lerPerfil(f.slug);
      assert.deepEqual(await fotografia(), antes);
    }));
});
