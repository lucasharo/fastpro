// Cadastra um admin DIRETO NO BANCO de DESENVOLVIMENTO (decisao do dono, 2026-11-27). E o caminho do primeiro admin;
// os demais podem ser cadastrados pela tela de Equipe. Tambem redefine a senha de um admin que ja existe (reativa a
// conta e encerra as sessoes dela). Execucao LOCAL, por quem tem a conexao do banco DEV. Papeis: superadmin,
// moderador, verificacao e auditor (origem bootstrap). A conta de admin e separada da de cliente e da de
// profissional (regra H-017); use, por exemplo, o mesmo e-mail com "+admin".
// Uso (raiz do repositorio):
//   corepack pnpm db:admin:dev --email <e-mail> --confirmar-host <host do banco DEV>
// A senha e pedida no terminal, sem aparecer (ou lida de ADMIN_SENHA, para uso sem terminal). Nunca vai como
// argumento, nunca e impressa e so o hash scrypt chega ao banco. Travas: APP_ENV=local e host confirmado.
import { hashAdminPassword } from '../dist/admin-password.js';
import { hostOfDbUrl } from './lib/admin-bootstrap.mjs';
import { clientFor, loadEnvValue, safeError } from './lib/env.mjs';

// Mesma regra de adminPasswordProblem (@fastpro/domain).
const SENHA_MIN = 12;
const SENHA_MAX = 128;

function argumento(argv, nome) {
  const i = argv.indexOf(nome);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

function recusar(motivo, codigo = 2) {
  process.stderr.write(`admin-dev: ${motivo}\n`);
  return codigo;
}

/** Le uma linha do terminal sem eco. */
function perguntarOculto(pergunta) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    let texto = '';
    stdout.write(pergunta);
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.resume();
    const fim = (erro) => {
      stdin.off('data', ler);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      if (erro) reject(erro);
      else resolve(texto);
    };
    function ler(pedaco) {
      for (const c of pedaco) {
        if (c === '\r' || c === '\n') return fim();
        if (c === '\u0003') return fim(new Error('cancelado'));
        if (c === '\u007f' || c === '\b') texto = texto.slice(0, -1);
        else if (c >= ' ') texto += c;
      }
    }
    stdin.on('data', ler);
  });
}

async function lerSenha() {
  const doAmbiente = process.env.ADMIN_SENHA;
  if (doAmbiente) return doAmbiente;
  if (!process.stdin.isTTY) return null;
  const senha = await perguntarOculto(`Senha do admin (${SENHA_MIN} a ${SENHA_MAX} caracteres): `);
  const repetida = await perguntarOculto('Repita a senha: ');
  return senha === repetida ? senha : null;
}

async function main(argv) {
  const email = (argumento(argv, '--email') ?? '').trim().toLowerCase();
  const host = argumento(argv, '--confirmar-host');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return recusar('informe --email com um endereco valido');
  if (loadEnvValue('APP_ENV') !== 'local') {
    return recusar('recusado, o script roda somente com APP_ENV=local (desenvolvimento)');
  }
  const dbUrl = loadEnvValue('DATABASE_URL_MIGRATIONS');
  if (!dbUrl || host === null || hostOfDbUrl(dbUrl) !== host) {
    return recusar('recusado, confirme o host do banco DEV em --confirmar-host');
  }
  const senha = await lerSenha().catch(() => null);
  if (senha === null) return recusar('senha nao informada ou as duas digitacoes sao diferentes');
  if (senha.length < SENHA_MIN || senha.length > SENHA_MAX || senha.toLowerCase() === email) {
    return recusar(`a senha precisa ter de ${SENHA_MIN} a ${SENHA_MAX} caracteres e ser diferente do e-mail`);
  }
  const hash = await hashAdminPassword(senha);

  const client = clientFor(dbUrl, 'fastpro-admin-dev');
  await client.connect();
  try {
    await client.query('begin');
    const {
      rows: [existente],
    } = await client.query(
      `select u.id, s.user_id is not null as admin
         from app.app_user u left join app.admin_staff s on s.user_id = u.id
        where lower(u.email) = $1`,
      [email],
    );
    if (existente !== undefined && existente.admin !== true) {
      await client.query('rollback');
      return recusar('este e-mail ja tem conta que nao e de admin; use outro (ex.: com +admin)', 1);
    }
    let userId = existente?.id;
    if (userId === undefined) {
      const {
        rows: [novo],
      } = await client.query(
        `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
         values (gen_random_uuid(), $1, gen_random_uuid(), 'ativo', now(), now()) returning id`,
        [email],
      );
      userId = novo.id;
    }
    await client.query(
      `insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at, created_at, status_changed_at)
       values ($1, 'ativo', 'bootstrap', null, null, now(), now())
       on conflict (user_id) do update set status = 'ativo', status_changed_at = now()`,
      [userId],
    );
    await client.query(
      `insert into app.admin_credential (user_id, password_hash, updated_at) values ($1, $2, now())
       on conflict (user_id) do update set password_hash = excluded.password_hash, updated_at = now()`,
      [userId, hash],
    );
    await client.query('update app.admin_session set revoked_at = now() where user_id = $1 and revoked_at is null', [
      userId,
    ]);
    // No DEV a mesma pessoa testa todas as telas: superadmin (equipe e catalogo), moderador, verificacao e auditor.
    for (const papel of ['superadmin', 'moderador', 'verificacao', 'auditor']) {
      const {
        rows: [ja],
      } = await client.query(
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
    process.stdout.write('admin-dev: pronto. Entre no admin com este e-mail e a senha informada.\n');
    return 0;
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    return recusar(`falha ao gravar no banco (${safeError(err)})`, 1);
  } finally {
    await client.end();
  }
}

process.exitCode = await main(process.argv.slice(2));
