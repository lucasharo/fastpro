// Admin de DESENVOLVIMENTO com entrada por codigo no e-mail (decisao do dono, 2026-11-24). Execucao LOCAL, por
// quem tem a conexao do banco DEV. Cria (se ainda nao existir) uma conta so de admin para o e-mail informado, ativa
// na equipe, com os papeis superadmin, moderador, verificacao e auditor (origem bootstrap; so DEV). A conta de admin precisa ser separada da de cliente e da de
// profissional (regra H-017: o banco recusa os papeis juntos); use, por exemplo, o mesmo e-mail com "+admin".
// Uso (raiz do repositorio):
//   node packages/db/scripts/admin-dev-codigo.mjs --email <e-mail> --confirmar-host <host do banco DEV>
// Travas: APP_ENV=local, host do banco confirmado, e-mail sem conta de cliente ou profissional. Nada e impresso alem
// do resultado; nenhum segredo e gravado em arquivo.
import { clientFor, loadEnvValue } from './lib/env.mjs';
import { hostOfDbUrl } from './lib/admin-bootstrap.mjs';

function argumento(argv, nome) {
  const i = argv.indexOf(nome);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

async function main(argv) {
  const email = (argumento(argv, '--email') ?? '').trim().toLowerCase();
  const host = argumento(argv, '--confirmar-host');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    process.stderr.write('admin-dev-codigo: informe --email com um endereco valido\n');
    return 2;
  }
  if (loadEnvValue('APP_ENV') !== 'local') {
    process.stderr.write('admin-dev-codigo: recusado, o script roda somente com APP_ENV=local (desenvolvimento)\n');
    return 2;
  }
  const dbUrl = loadEnvValue('DATABASE_URL_MIGRATIONS');
  if (!dbUrl || host === null || hostOfDbUrl(dbUrl) !== host) {
    process.stderr.write('admin-dev-codigo: recusado, confirme o host do banco DEV em --confirmar-host\n');
    return 2;
  }
  const client = clientFor(dbUrl, 'fastpro-admin-dev-codigo');
  await client.connect();
  try {
    await client.query('begin');
    const { rows: [existente] } = await client.query('select id from app.app_user where lower(email) = $1', [email]);
    let userId = existente?.id;
    if (userId === undefined) {
      const { rows: [novo] } = await client.query(
        `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
         values (gen_random_uuid(), $1, gen_random_uuid(), 'ativo', now(), now()) returning id`,
        [email],
      );
      userId = novo.id;
    }
    await client.query(
      `insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at, created_at, status_changed_at)
       values ($1, 'ativo', 'bootstrap', null, now(), now(), now())
       on conflict (user_id) do update set status = 'ativo', status_changed_at = now()`,
      [userId],
    );
    // No DEV a mesma pessoa testa todas as telas: superadmin (equipe e catalogo), moderador, verificacao e auditor.
    for (const papel of ['superadmin', 'moderador', 'verificacao', 'auditor']) {
      const { rows: [ja] } = await client.query(
        'select 1 from app.admin_user_role where user_id = $1 and role_code = $2 and revoked_at is null',
        [userId, papel],
      );
      if (ja === undefined) {
        await client.query(
          `insert into app.admin_user_role (id, user_id, role_code, granted_by, grant_origin, granted_at)
           values (gen_random_uuid(), $1, $2, null, 'bootstrap', now())`,
          [userId, papel],
        );
      }
    }
    await client.query('commit');
    process.stdout.write('admin-dev-codigo: pronto. Entre no admin com este e-mail e o codigo que chegar.\n');
    return 0;
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    const motivo = String(err?.message ?? '').startsWith('papel_exclusivo')
      ? 'este e-mail ja tem conta de cliente ou de profissional; use outro (ex.: com +admin)'
      : 'falha ao gravar no banco';
    process.stderr.write(`admin-dev-codigo: ${motivo}\n`);
    return 1;
  } finally {
    await client.end();
  }
}

process.exitCode = await main(process.argv.slice(2));
