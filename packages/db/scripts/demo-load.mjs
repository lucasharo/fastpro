// H-120 (Issue 129) | Carga e remocao seletiva dos dados sinteticos de demonstracao (85-DESENHO-H120).
// COMANDO EXPLICITO e opt-in: nunca entra no seed do reset, no check:all nem no CI.
//   pnpm db:demo:load -- --dry-run   aplica numa transacao e DESFAZ (nada fica gravado)
//   pnpm db:demo:load                aplica numa transacao (commit). Reexecucao nao duplica.
//   pnpm db:demo:remove -- --dry-run apaga marcados numa transacao e DESFAZ
//   pnpm db:demo:remove              apaga so o que tem marcador de demo (de baixo para cima)
// Reset total: `pnpm db:reset` ou `supabase db reset` (ja existentes; nada novo aqui).
// Trava (FASTPRO_DEMO_ALLOW=local + host local; host remoto recusado sempre). Sem --force.
// Camada 1 agora: 2 clientes, 13 perfis de profissional, 2 rascunhos e 1 coordenada comum.
// Camada 2 (pedidos, aceites, chat, fotos): so detecao por to_regclass; nada e executado sem a tabela.
// Sem registro na cadeia de auditoria; sem e-mail; sem senha (login de demo no Auth local nao feito).
// Conexao: DATABASE_URL_MIGRATIONS (ambiente ou .env.local). Nenhum valor e impresso.
// Codigos de saida: 0 ok; 2 recusado pela trava ou argumentos; 1 falha (transacao desfeita).
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { connect, loadEnvValue, safeError } from './lib/env.mjs';
import {
  CLIENTES,
  COORDENADA,
  CONTAGENS_CAMADA1,
  DEMO_EMAIL_LIKE,
  DEMO_ID_LIKE,
  PROFISSIONAIS,
  RASCUNHOS,
  demoCpfDigits,
} from './lib/demo-ids.mjs';
import {
  addressHash,
  demoGuardRefusal,
  documentHmac,
  loadDemoKeys,
  normalizeAddress,
  sealDocument,
  sha256Hex,
} from './lib/demo-guard.mjs';

export const CAMADA2_BLOCOS = Object.freeze([
  { nome: 'pedidos', tabela: 'app.service_request' },
  { nome: 'aceites', tabela: 'app.acceptance' },
  { nome: 'chat', tabela: 'app.conversation' },
  { nome: 'fotos', tabela: 'app.media_asset' },
]);

export const SQL = Object.freeze({
  servicoAtivo: 'select id from app.service where active order by name limit 1',
  appUser: `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
            values ($1, $2, $3, 'ativo', now(), now())
            on conflict (id) do nothing`,
  perfil: `insert into app.professional_profile (user_id, verification_status, verified_at, suspended_at,
             suspension_reason, created_at, updated_at, public_name, slug, document_type, document_enc, document_hmac)
           values ($1, $2, $3, $4, $5, now(), now(), $6, $7, 'CPF', $8, $9)
           on conflict (user_id) do nothing`,
  coordenada: `insert into app.geocode_point (id, subject_kind, subject_id, address_hash, state, exact_point,
                 geocode_mode, precision, reserved_at, geocoded_at)
               values ($1, $2, $3, $4, 'ok',
                 extensions.st_setsrid(extensions.st_makepoint($5::float8, $6::float8), 4326)::extensions.geography,
                 'permanent', 'endereco', now(), now())
               on conflict (id) do nothing`,
  rascunho: `insert into app.request_draft (id, browser_nonce_hash, service_id, address_text, urgency, description,
               status, expires_at, ip_hmac, created_at, updated_at)
             values ($1, $2, $3, $4, 'nao_definido', $5, 'aberto', now() + interval '7 days', $6, now(), now())
             on conflict (id) do nothing`,
  // Inconsistencia de marca: e-mail de demo sem prefixo, ou prefixo sem e-mail de demo. Para a remocao.
  inconsistencia: `select id::text as id from app.app_user
                    where (email like $1 and id::text not like $2)
                       or (id::text like $2 and email not like $1)
                    order by id`,
  servicosAtivos: 'select count(*)::int as n from app.service where active',
  camada2Existe: 'select to_regclass($1) is not null as presente',
});

// Remocao de baixo para cima (filhos antes dos pais). Sempre pelo prefixo de id reservado.
export const REMOCAO = Object.freeze([
  ['sessoes', 'delete from app.app_session where user_id in (select id from app.app_user where id::text like $1)'],
  ['desafios', 'delete from app.auth_challenge where user_id in (select id from app.app_user where id::text like $1)'],
  ['perfis', 'delete from app.professional_profile where user_id::text like $1'],
  ['orcamento_geo', 'delete from app.geocode_budget where subject_id::text like $1'],
  ['coordenadas', 'delete from app.geocode_point where id::text like $1 or subject_id::text like $1'],
  ['rascunhos', 'delete from app.request_draft where id::text like $1'],
  ['usuarios', 'delete from app.app_user where id::text like $1'],
]);

function out(msg) {
  process.stdout.write(`${msg}\n`);
}

function erro(msg) {
  process.stderr.write(`demo-load: ${msg}\n`);
}

/**
 * Camada 2 (H-120 §0): so detecta as tabelas. Nao executa SQL de escrita: as tabelas nao existem
 * e nenhuma migracao de H-120 as cria. Devolve o estado de cada bloco para o relatorio.
 */
export async function runCamada2(client) {
  const blocos = [];
  for (const bloco of CAMADA2_BLOCOS) {
    const res = await client.query(SQL.camada2Existe, [bloco.tabela]);
    const presente = res.rows[0]?.presente === true;
    blocos.push({
      nome: bloco.nome,
      status: presente
        ? 'nao executado: bloco da camada 2 ainda nao implementado'
        : 'nao executado: tabela ausente',
    });
  }
  return blocos;
}

/** Carga da camada 1. Insere com on conflict (id) do nothing; outro conflito (e-mail, CPF, slug) aborta. */
export async function carregarCamada1(client, keys) {
  const servico = await client.query(SQL.servicoAtivo);
  if (servico.rowCount === 0) {
    return { falha: 'catalogo vazio: rode pnpm db:seed:catalog antes da carga de demonstracao' };
  }
  const serviceId = servico.rows[0].id;
  const c = { clientes: 0, profissionais: 0, profissionaisAprovados: 0, rascunhos: 0, coordenadas: 0 };

  for (const cl of CLIENTES) {
    c.clientes += (await client.query(SQL.appUser, [cl.id, cl.email, cl.authId])).rowCount;
  }

  for (const p of PROFISSIONAIS) {
    await client.query(SQL.appUser, [p.id, p.email, p.authId]);
    const digits = demoCpfDigits(p.n);
    const suspensa = p.status === 'suspensa';
    const aprovada = p.status === 'aprovada';
    const res = await client.query(SQL.perfil, [
      p.id,
      p.status,
      aprovada ? new Date() : null,
      suspensa ? new Date() : null,
      suspensa ? 'Demonstracao sintetica (H-120)' : null,
      p.publicName,
      p.slug,
      sealDocument(keys.encKey, keys.version, p.id, digits),
      documentHmac(keys.hmacKey, 'CPF', digits),
    ]);
    c.profissionais += res.rowCount;
    if (aprovada && res.rowCount === 1) c.profissionaisAprovados += 1;
  }

  for (const r of RASCUNHOS) {
    c.rascunhos += (
      await client.query(SQL.rascunho, [
        r.id,
        sha256Hex(`demo-h120-rascunho-${r.n}`),
        serviceId,
        COORDENADA.endereco,
        'Pedido sintetico de demonstracao (H-120).',
        sha256Hex(`demo-h120-ip-${r.n}`),
      ])
    ).rowCount;
  }

  c.coordenadas += (
    await client.query(SQL.coordenada, [
      COORDENADA.id,
      COORDENADA.subjectKind,
      COORDENADA.subjectId,
      addressHash(keys.addressKey, normalizeAddress(COORDENADA.endereco)),
      COORDENADA.lng,
      COORDENADA.lat,
    ])
  ).rowCount;

  return { contagens: c };
}

/** Remocao seletiva. Recusa estado misto (marca inconsistente) antes de apagar qualquer linha. */
export async function removerDemo(client) {
  const conflito = await client.query(SQL.inconsistencia, [DEMO_EMAIL_LIKE, DEMO_ID_LIKE]);
  if (conflito.rowCount > 0) {
    return {
      falha:
        `marca inconsistente em ${conflito.rowCount} usuario(s) (ids: ${conflito.rows.map((r) => r.id).join(', ')}); nada foi apagado`,
    };
  }
  const apagadas = {};
  for (const [nome, sql] of REMOCAO) {
    apagadas[nome] = (await client.query(sql, [DEMO_ID_LIKE])).rowCount;
  }
  return { apagadas };
}

function linhaContagem(rotulo, inseridos, total) {
  if (inseridos === 0) return `${rotulo}: ja existiam (0 inseridos de ${total})`;
  return `${rotulo}: inseridos ${inseridos} de ${total}`;
}

function relatorioCarga(c, blocos, dryRun) {
  out(`carga de demonstracao (camada 1)${dryRun ? ' (dry-run, DESFEITO)' : ''}`);
  out(linhaContagem('clientes', c.clientes, CONTAGENS_CAMADA1.clientes));
  out(
    linhaContagem('profissionais', c.profissionais, CONTAGENS_CAMADA1.profissionais) +
      ` (aprovados nesta carga: ${c.profissionaisAprovados} de ${CONTAGENS_CAMADA1.profissionaisAprovados})`,
  );
  out(linhaContagem('rascunhos de pedido', c.rascunhos, CONTAGENS_CAMADA1.rascunhos));
  out(linhaContagem('coordenada comum', c.coordenadas, CONTAGENS_CAMADA1.coordenadas));
  for (const b of blocos) out(`camada 2, ${b.nome}: ${b.status}`);
}

function relatorioRemocao(apagadas, dryRun) {
  out(`remocao seletiva de demonstracao${dryRun ? ' (dry-run, DESFEITO)' : ''}`);
  for (const [nome, n] of Object.entries(apagadas)) out(`${nome}: apagadas ${n}`);
  out('Storage (camada 2): remocao nao implementada nesta versao; nenhum objeto de demo e criado na camada 1.');
}

function lerChavesDeTeste() {
  const env = {};
  for (const nome of ['DOCUMENT_HMAC_KEY', 'DATA_ENC_KEY_ACTIVE_VERSION', 'ADDRESS_HASH_KEY']) {
    env[nome] = loadEnvValue(nome);
  }
  const versao = (env.DATA_ENC_KEY_ACTIVE_VERSION ?? '').trim();
  if (/^[1-9][0-9]{0,2}$/.test(versao)) {
    env[`DATA_ENC_KEY_V${Number(versao)}`] = loadEnvValue(`DATA_ENC_KEY_V${Number(versao)}`);
  }
  return env;
}

async function main(argv) {
  const remover = argv.includes('--remove');
  const dryRun = argv.includes('--dry-run');
  const extras = argv.filter((a) => a !== '--remove' && a !== '--dry-run');
  if (extras.length > 0) {
    erro('recusado (argumento_desconhecido): use --dry-run ou --remove');
    return 2;
  }

  const envTrava = { FASTPRO_DEMO_ALLOW: loadEnvValue('FASTPRO_DEMO_ALLOW') };
  const dbUrl = loadEnvValue('DATABASE_URL_MIGRATIONS');
  const recusaTrava = demoGuardRefusal(envTrava, dbUrl);
  if (recusaTrava !== null) {
    erro(`recusado (${recusaTrava.codigo}): ${recusaTrava.mensagem}`);
    return 2;
  }

  let keys = null;
  if (!remover) {
    const chaves = loadDemoKeys(lerChavesDeTeste());
    if (!chaves.ok) {
      erro(`recusado (${chaves.refusal.codigo}): ${chaves.refusal.mensagem}`);
      return 2;
    }
    keys = chaves.keys;
  }

  const client = await connect();
  try {
    // Trava repetida imediatamente antes do primeiro comando de escrita (mesmos valores).
    const recusaAntesDeEscrever = demoGuardRefusal(envTrava, dbUrl);
    if (recusaAntesDeEscrever !== null) {
      erro(`recusado (${recusaAntesDeEscrever.codigo}): ${recusaAntesDeEscrever.mensagem}`);
      return 2;
    }
    await client.query('begin');
    try {
      if (remover) {
        const r = await removerDemo(client);
        if (r.falha) {
          await client.query('rollback');
          erro(r.falha);
          return 1;
        }
        await client.query(dryRun ? 'rollback' : 'commit');
        relatorioRemocao(r.apagadas, dryRun);
        return 0;
      }
      const r = await carregarCamada1(client, keys);
      if (r.falha) {
        await client.query('rollback');
        erro(r.falha);
        return 1;
      }
      const blocos = await runCamada2(client);
      await client.query(dryRun ? 'rollback' : 'commit');
      relatorioCarga(r.contagens, blocos, dryRun);
      return 0;
    } catch (err) {
      await client.query('rollback');
      throw err;
    }
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      erro(safeError(err));
      process.exitCode = 1;
    },
  );
}
