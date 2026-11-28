// H-102 | Primeiro Superadmin (docs/factory/54-DESENHO-H102.md §6). Execucao LOCAL por quem tem a conexao
// do banco de DESENVOLVIMENTO. Sem rota HTTP, sem chave de servico, sem envio de e-mail.
// Uso (a partir da raiz do repositorio):
//   node packages/db/scripts/admin-bootstrap.mjs --email <e-mail> --confirmar-host <host> [--modo primeiro|continuidade] [--reemitir]
// Efeito: emite o convite de ativacao do Superadmin (origem bootstrap, 72 h) e imprime o link UMA vez no
// terminal. Nao grava o link em arquivo nem em log. A senha e o TOTP sao escolhidos pela pessoa, no fluxo do convite.
// Travas: APP_ENV=local, host confirmado, sem Superadmin ativo (modo primeiro) ou exatamente um (continuidade),
// um convite vivo por e-mail (--reemitir invalida o anterior). As demais travas estao no banco (ADM10).
// Codigos de saida: 0 ok; 2 recusado pelas travas locais; 1 falha.
import { randomBytes, randomUUID } from 'node:crypto';
import { clientFor, loadEnvValue, safeError } from './lib/env.mjs';
import {
  adminCipherKey,
  adminEmailHmac,
  adminTokenHash,
  bootstrapRefusal,
  buildInviteLink,
  parseBootstrapArgs,
  sealAdminInviteEmail,
} from './lib/admin-bootstrap.mjs';

function out(msg) {
  process.stdout.write(`${msg}\n`);
}
function erro(msg) {
  process.stderr.write(`admin-bootstrap: ${msg}\n`);
}

async function main(argv) {
  const args = parseBootstrapArgs(argv);
  const env = {};
  for (const nome of ['APP_ENV', 'PEPPER_EMAIL_HMAC', 'AUTH_CHALLENGE_KEY', 'ADMIN_BASE_URL']) {
    env[nome] = loadEnvValue(nome);
  }
  const dbUrl = loadEnvValue('DATABASE_URL_MIGRATIONS');

  const recusa = bootstrapRefusal(args, env, dbUrl);
  if (recusa !== null) {
    erro(`recusado (${recusa.codigo}): ${recusa.mensagem}`);
    return 2;
  }

  const email = args.email.trim().toLowerCase();
  const key = adminCipherKey(env.AUTH_CHALLENGE_KEY);
  if (key === null) {
    erro('recusado (configuracao_ausente): AUTH_CHALLENGE_KEY invalida');
    return 2;
  }
  const hmac = adminEmailHmac(env.PEPPER_EMAIL_HMAC, email);

  const client = clientFor(dbUrl, 'fastpro-admin-bootstrap');
  await client.connect();
  try {
    const { rows: [vivo] } = await client.query(
      `select count(*)::int as n from app.admin_invite
        where email_hmac = $1 and state in ('emitido', 'aguardando_totp') and expires_at > now()`,
      [hmac],
    );
    if (vivo.n > 0 && !args.reemitir) {
      erro('recusado (convite_vivo_existe): ja ha convite vivo para este e-mail; use --reemitir');
      return 2;
    }

    const id = randomUUID();
    const segmento = randomBytes(32).toString('base64url');
    const enc = sealAdminInviteEmail(key, email, id);
    await client.query(
      `select private.admin_invite_issue($1, 'ativacao', $2, $3, $4, $5, $6, null, null, $7, $8)`,
      [id, email, hmac, enc, adminTokenHash(segmento), ['superadmin'], args.modo, new Date().toISOString()],
    );

    out('Convite do primeiro Superadmin emitido. O link abaixo aparece somente desta vez:');
    out(buildInviteLink(env.ADMIN_BASE_URL, segmento));
    out('Valido por 72 horas, uso unico. Nenhuma senha passa por este comando.');
    return 0;
  } catch (err) {
    if (err?.code === 'ADM10') {
      erro('recusado (travas_do_banco): o banco recusou o bootstrap (ja existe Superadmin ou modo incompativel)');
      return 2;
    }
    if (err?.code === 'ADM06') {
      erro('recusado (email_indisponivel): o e-mail ja tem conta');
      return 2;
    }
    erro(`falha: ${safeError(err)}`);
    return 1;
  } finally {
    await client.end();
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    erro(`falha: ${safeError(err)}`);
    process.exitCode = 1;
  },
);
