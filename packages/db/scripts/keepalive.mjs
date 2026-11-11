// Keep-alive manual do banco de desenvolvimento (H-010). Uso a partir da raiz do repositorio:
//   corepack pnpm db:keepalive
// Variaveis (nomes): DATABASE_URL_KEEPALIVE e KEEPALIVE_LOG (arquivo FORA do repositorio).
// Cadencia: no maximo a cada 5 dias (ADR-020). Ate 3 tentativas. Nunca imprime valores.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { REPO_ROOT, clientFor, loadEnvValue } from './lib/env.mjs';
import { assertOutsideRepo } from './lib/safe-paths.mjs';
import { keepAliveLine } from './lib/backup.mjs';
import { STALE_DAYS, lastOkAgeDays, runKeepAlive } from './lib/keepalive.mjs';

function out(msg) {
  process.stdout.write(`${msg}\n`);
}

async function main() {
  const url = loadEnvValue('DATABASE_URL_KEEPALIVE');
  const logPath = loadEnvValue('KEEPALIVE_LOG');
  if (!url) {
    out('keep-alive: DATABASE_URL_KEEPALIVE nao definida (recusado)');
    return 2;
  }
  if (!logPath) {
    out('keep-alive: KEEPALIVE_LOG nao definida (recusado)');
    return 2;
  }
  try {
    assertOutsideRepo(dirname(logPath), REPO_ROOT, 'KEEPALIVE_LOG');
  } catch (err) {
    out(`keep-alive: ${err.message}`);
    return 2;
  }
  const result = await runKeepAlive({
    connect: async () => {
      const client = clientFor(url, 'fastpro-keepalive', 10000);
      await client.connect();
      return client;
    },
    pause: sleep,
  });
  const now = new Date();
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${keepAliveLine(now, result)}\n`);
  out(
    result.ok
      ? `keep-alive ok (tentativa ${result.tentativas})`
      : `keep-alive FALHOU etapa=${result.etapa}`,
  );
  const logText = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
  const age = lastOkAgeDays(logText, now);
  if (age === null) out('Ultima execucao ok: nenhuma registrada.');
  else
    out(
      `Ultima execucao ok ha ${age} dia(s).${age > STALE_DAYS ? ' AVISO: passou de 4 dias.' : ''}`,
    );
  out(`registro: ${basename(logPath)}`);
  return result.ok ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    process.exitCode = 1;
  },
);
