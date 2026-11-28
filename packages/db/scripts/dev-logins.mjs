// Provisionador dos logins DEV da API e do sistema (Issue #156, desenho 177 §3, §4 e D-3 a D-6).
// Uso (raiz do repositorio):
//   corepack pnpm db:dev:logins                          cria o que falta, grava no .env.local as senhas e URLs ausentes e testa o login
//   corepack pnpm db:dev:logins -- --verificar           so le: estado dos papeis, teste de login e prova de menor privilegio
//   corepack pnpm db:dev:logins -- --rotacionar-login    troca a senha dos dois logins pela que esta no .env.local
//   corepack pnpm db:dev:logins -- --remover             remove os dois logins (nao roda sozinho; ver supabase/rollbacks)
// A senha em texto nunca vai para argumento, arquivo temporario ou saida: o servidor recebe so o verificador
// SCRAM-SHA-256 calculado aqui (Node stdlib). Nenhuma URL, senha ou verificador e impresso.
// Trava: so o banco do proprio projeto (ref de SUPABASE_URL no host db.<ref>.supabase.co ou usuario postgres.<ref>
// no pooler); APP_ENV=production e recusado. O demo-guard exige APP_ENV=development para banco remoto; a decisao
// adotada (APP_ENV=local) nao cabe nele, por isso esta trava usa a mesma regra de ref sem exigir esse valor.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { parseEnv, safeError } from './lib/env.mjs';
import { projectRefOf } from './lib/demo-guard.mjs';
import { aplicarPreenchimentos, gravarAtomico, lerArquivo } from '../../../scripts/lib/env-local.mjs';

const ENV_PATH = fileURLToPath(new URL('../../../.env.local', import.meta.url));
export const LOGIN_API = 'fastpro_dev_api';
export const LOGIN_SISTEMA = 'fastpro_dev_system';
/** Papel de aplicacao herdado por cada login. bypassRls: o login de sistema precisa do mesmo atributo de app_system (F-5). */
export const LOGINS = [
  { login: LOGIN_API, papel: 'app_api', senhaVar: 'DB_PASSWORD_APP_API', urlVar: 'DATABASE_URL_APP_API', bypassRls: false },
  { login: LOGIN_SISTEMA, papel: 'app_system', senhaVar: 'DB_PASSWORD_APP_SYSTEM', urlVar: 'DATABASE_URL_APP_SYSTEM', bypassRls: true },
];
const ITERACOES_SCRAM = 4096;
const VERIFICADOR_RE = /^SCRAM-SHA-256\$\d+:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;

const hmac = (chave, msg) => createHmac('sha256', chave).update(msg).digest();

/** Chaves SCRAM-SHA-256 (RFC 5802/7677) a partir da senha, do salt e das iteracoes. */
export function derivarScram(senha, salt, iteracoes = ITERACOES_SCRAM) {
  const saltedPassword = pbkdf2Sync(senha, salt, iteracoes, 32, 'sha256');
  const clientKey = hmac(saltedPassword, 'Client Key');
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = hmac(saltedPassword, 'Server Key');
  return { clientKey, storedKey, serverKey };
}

/** Verificador no formato que o PostgreSQL aceita em CREATE/ALTER ROLE ... PASSWORD (sem a senha em texto). */
export function verificadorScram(senha, salt = randomBytes(16), iteracoes = ITERACOES_SCRAM) {
  const { storedKey, serverKey } = derivarScram(senha, salt, iteracoes);
  const texto = `SCRAM-SHA-256$${iteracoes}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
  if (!VERIFICADOR_RE.test(texto)) throw new Error('verificador_invalido');
  return texto;
}

/** URL do login a partir de DATABASE_URL_MIGRATIONS: troca usuario (com o sufixo .<ref> do pooler, se houver) e senha. */
export function derivarUrl(urlMigracoes, login, senha) {
  const u = new URL(urlMigracoes);
  const ref = /\.([a-z0-9]{20})$/.exec(decodeURIComponent(u.username))?.[1];
  u.username = ref ? `${login}.${ref}` : login;
  u.password = senha;
  return u.toString();
}

/** Trava de ambiente. Devolve o motivo da recusa, ou null quando pode prosseguir. Nunca inclui valor de conexao. */
export function recusaAmbiente(env, urlMigracoes) {
  if (env.APP_ENV === 'production') return 'APP_ENV indica producao';
  let u;
  try {
    u = new URL(urlMigracoes);
  } catch {
    return 'DATABASE_URL_MIGRATIONS nao pode ser lida';
  }
  if ([...u.searchParams.keys()].some((k) => k !== 'sslmode')) return 'parametro de URL fora da lista (somente sslmode)';
  const ref = projectRefOf(env.SUPABASE_URL);
  if (ref === null) return 'ref do projeto ausente em SUPABASE_URL';
  const host = u.hostname.toLowerCase();
  const usuario = decodeURIComponent(u.username);
  const direto = host === `db.${ref}.supabase.co`;
  const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(host) && usuario === `postgres.${ref}`;
  if (!direto && !pooler) return 'o banco nao e o do projeto DEV (host ou usuario nao confere)';
  return null;
}

async function papelExiste(c, login) {
  const r = await c.query('select 1 from pg_roles where rolname = $1', [login]);
  return r.rowCount > 0;
}

async function criarPapel(c, cfg, verificador) {
  const bypass = cfg.bypassRls ? 'bypassrls' : 'nobypassrls';
  await c.query(
    `create role ${cfg.login} login inherit nosuperuser nocreatedb nocreaterole noreplication ${bypass} connection limit 10 password '${verificador}'`,
  );
}

/** Copia para o login as configuracoes de papel (ALTER ROLE ... SET) do papel de aplicacao, quando existirem. */
async function copiarConfiguracao(c, cfg) {
  const r = await c.query(
    `select s.setconfig from pg_db_role_setting s join pg_roles p on p.oid = s.setrole where p.rolname = $1 and s.setdatabase = 0`,
    [cfg.papel],
  );
  for (const linha of r.rows.flatMap((x) => x.setconfig ?? [])) {
    const i = linha.indexOf('=');
    const chave = linha.slice(0, i);
    const valor = linha.slice(i + 1);
    if (!/^[a-z_][a-z0-9_.]*$/.test(chave)) throw new Error('configuracao_invalida');
    await c.query(`alter role ${cfg.login} set ${chave} = '${valor.replace(/'/g, "''")}'`);
  }
}

/** Testa o login com a URL derivada. Devolve so o codigo de erro (nunca a mensagem, que pode conter a conexao). */
export async function testarLogin(url) {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15000, application_name: 'fastpro-dev-logins' });
  try {
    await c.connect();
    const r = await c.query('select current_user as usuario');
    return { ok: r.rows[0].usuario !== undefined, codigo: null };
  } catch (err) {
    return { ok: false, codigo: err?.code ?? 'erro' };
  } finally {
    await c.end().catch(() => {});
  }
}

/** Prova de menor privilegio do login da API (CA-156-09): sem leitura irrestrita, sem DDL, sem SET ROLE para app_system. */
async function provaMinimoPrivilegio(url) {
  const linhas = [];
  let ok = true;
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15000, application_name: 'fastpro-dev-logins' });
  await c.connect();
  try {
    try {
      const r = await c.query('select count(*)::int as n from app.app_session');
      const aceito = r.rows[0].n === 0;
      ok = ok && aceito;
      linhas.push(`leitura de app.app_session: ${aceito ? 'ok (0 linhas visiveis)' : `FALHA (${r.rows[0].n} linhas)`}`);
    } catch (err) {
      const aceito = err?.code === '42501';
      ok = ok && aceito;
      linhas.push(`leitura de app.app_session: ${aceito ? 'negada (42501)' : `FALHA (${err?.code ?? 'erro'})`}`);
    }
    try {
      await c.query('set role app_system');
      ok = false;
      linhas.push('set role app_system: FALHA (permitido)');
    } catch {
      linhas.push('set role app_system: negado');
    }
    try {
      await c.query('begin');
      await c.query('drop table app.app_session');
      ok = false;
      linhas.push('drop table app.app_session: FALHA (permitido)');
    } catch (err) {
      const aceito = err?.code === '42501';
      ok = ok && aceito;
      linhas.push(`drop table app.app_session: ${aceito ? 'negado (42501)' : `FALHA (${err?.code ?? 'erro'})`}`);
    } finally {
      await c.query('rollback').catch(() => {});
    }
  } finally {
    await c.end().catch(() => {});
  }
  return { ok, linhas };
}

async function verificar(c, env, url) {
  const linhas = [];
  let codigo = 0;
  for (const cfg of LOGINS) {
    const r = await c.query(
      'select rolcanlogin, rolbypassrls, rolsuper, rolcreaterole, rolcreatedb from pg_roles where rolname = $1',
      [cfg.login],
    );
    if (r.rowCount === 0) {
      linhas.push(`${cfg.login}: ausente`);
      continue;
    }
    const p = r.rows[0];
    linhas.push(
      `${cfg.login}: existe (login=${p.rolcanlogin}, bypassrls=${p.rolbypassrls}, superusuario=${p.rolsuper}, criarpapel=${p.rolcreaterole}, criarbanco=${p.rolcreatedb})`,
    );
    if (p.rolbypassrls !== cfg.bypassRls || p.rolsuper || p.rolcreaterole || p.rolcreatedb || !p.rolcanlogin) {
      linhas.push(`${cfg.login}: atributos fora do esperado`);
      codigo = 1;
    }
    const senha = env[cfg.senhaVar];
    if (!senha) {
      linhas.push(`${cfg.login}: senha ausente no .env.local; teste de login pulado`);
      codigo = 1;
      continue;
    }
    const t = await testarLogin(derivarUrl(url, cfg.login, senha));
    linhas.push(t.ok ? `${cfg.login}: login ok` : `${cfg.login}: falha de login (${t.codigo})`);
    if (!t.ok) codigo = 1;
    if (cfg.login === LOGIN_API && t.ok) {
      const prova = await provaMinimoPrivilegio(derivarUrl(url, cfg.login, senha));
      linhas.push(...prova.linhas.map((l) => `  ${l}`));
      if (!prova.ok) codigo = 1;
    }
  }
  if (await papelExiste(c, LOGIN_API) && (await papelExiste(c, LOGIN_SISTEMA))) {
    const m = await c.query(
      `select pg_has_role('${LOGIN_API}','app_system','USAGE') as api_sistema, pg_has_role('${LOGIN_SISTEMA}','app_api','USAGE') as sistema_api, pg_has_role('${LOGIN_API}','app_api','USAGE') as api_api, pg_has_role('${LOGIN_SISTEMA}','app_system','USAGE') as sistema_sistema`,
    );
    const v = m.rows[0];
    const ok = v.api_sistema === false && v.sistema_api === false && v.api_api === true && v.sistema_sistema === true;
    linhas.push(`membros: cruzados=${ok ? 'nenhum' : 'FALHA'}, proprios=${v.api_api && v.sistema_sistema ? 'ok' : 'FALHA'}`);
    if (!ok) codigo = 1;
  }
  return { codigo, linhas };
}

async function provisionar(c, env, url, texto, versao, rotacionar) {
  const linhas = [];
  const senhas = {};
  const novas = [];
  for (const cfg of LOGINS) {
    let senha = env[cfg.senhaVar];
    if (!senha) {
      senha = randomBytes(24).toString('hex');
      novas.push([cfg.senhaVar, senha]);
    }
    senhas[cfg.login] = senha;
  }
  for (const cfg of LOGINS) {
    if (!env[cfg.urlVar]) novas.push([cfg.urlVar, derivarUrl(url, cfg.login, senhas[cfg.login])]);
  }
  // Ordem: grava senha e URL antes de criar o papel (nunca perde a senha).
  let gravadas = [];
  if (novas.length > 0) {
    const r = aplicarPreenchimentos(
      texto,
      novas,
      'Issue 156 (desenho 177): logins DEV gerados pelo provisionador; sem valores no repositorio.',
    );
    gravarAtomico(ENV_PATH, r.texto);
    gravadas = r.geradas;
  }
  let criados = 0;
  for (const cfg of LOGINS) {
    const existe = await papelExiste(c, cfg.login);
    if (!existe) {
      await criarPapel(c, cfg, verificadorScram(senhas[cfg.login]));
      criados += 1;
      linhas.push(`${cfg.login}: criado`);
    } else if (rotacionar) {
      await c.query(`alter role ${cfg.login} password '${verificadorScram(senhas[cfg.login])}'`);
      linhas.push(`${cfg.login}: senha rotacionada`);
    } else {
      linhas.push(`${cfg.login}: existente`);
    }
    await c.query(`grant ${cfg.papel} to ${cfg.login}${versao >= 160000 ? ' with inherit true, set false' : ''}`);
    await copiarConfiguracao(c, cfg);
  }
  let codigo = 0;
  for (const cfg of LOGINS) {
    const t = await testarLogin(derivarUrl(url, cfg.login, senhas[cfg.login]));
    if (t.ok) linhas.push(`login ${cfg.login}: ok`);
    else {
      codigo = 1;
      const dica = t.codigo === '28P01' ? ' (senha divergente: rode com --rotacionar-login)' : '';
      linhas.push(`login ${cfg.login}: falha (${t.codigo})${dica}`);
    }
  }
  if (gravadas.length > 0) linhas.unshift(`variaveis gravadas no .env.local: ${gravadas.join(', ')}`);
  if (gravadas.length === 0 && criados === 0 && !rotacionar && codigo === 0) linhas.unshift('nada a fazer');
  return { codigo, linhas };
}

async function remover(c) {
  for (const cfg of LOGINS) await c.query(`drop role if exists ${cfg.login}`);
  return { codigo: 0, linhas: ['logins DEV removidos (os papeis de aplicacao nao foram alterados)'] };
}

export async function main(argv, env = { ...process.env }) {
  const texto = lerArquivo(ENV_PATH);
  if (texto === null) return { codigo: 2, linhas: ['arquivo .env.local nao existe: copie .env.example (somente nomes) e rode de novo.'] };
  const ambiente = { ...parseEnv(texto), ...env };
  const url = ambiente.DATABASE_URL_MIGRATIONS;
  if (!url) return { codigo: 2, linhas: ['DATABASE_URL_MIGRATIONS ausente (ambiente ou .env.local)'] };
  const recusa = recusaAmbiente(ambiente, url);
  if (recusa !== null) return { codigo: 2, linhas: [`recusado: ${recusa}`] };
  const modo = argv.includes('--verificar')
    ? 'verificar'
    : argv.includes('--remover')
      ? 'remover'
      : argv.includes('--rotacionar-login')
        ? 'rotacionar'
        : 'provisionar';
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15000, application_name: 'fastpro-dev-logins' });
  await c.connect();
  try {
    const versao = Number((await c.query("select current_setting('server_version_num') as v")).rows[0].v);
    if (modo === 'verificar') return await verificar(c, ambiente, url);
    if (modo === 'remover') return await remover(c);
    return await provisionar(c, ambiente, url, texto, versao, modo === 'rotacionar');
  } finally {
    await c.end().catch(() => {});
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (r) => {
      for (const linha of r.linhas) console.log(linha);
      process.exitCode = r.codigo;
    },
    (err) => {
      console.log(`erro: ${safeError(err)}`);
      process.exitCode = 1;
    },
  );
}
