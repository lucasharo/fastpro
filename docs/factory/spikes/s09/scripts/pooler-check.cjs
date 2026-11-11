// L1 (S-09): comportamento do pooler do Supabase (modo transacao) a partir da maquina local.
// Somente leitura e set_config local por transacao. Sem DDL, sem escrita de dados.
//
// Entradas (somente por variavel de ambiente; nunca impressas):
//   DATABASE_URL_KEEPALIVE  papel de manutencao ja autorizado (usuario e senha; host direto e ignorado)
//   POOLER_HOST             host do pooler (aws-0-<regiao>.pooler.supabase.com), lido pelo MCP do Supabase
//   POOLER_PORT             opcional, padrao 6543 (modo transacao)
//   POOLER_USER_SUFFIX      opcional; por padrao o ref extraido do host direto (db.<ref>.supabase.co)
// Uso: node scripts/pooler-check.cjs   (a partir da pasta do spike, com dependencias instaladas)
// Saida: JSON com contagens, latencias e erros. Nao imprime host, usuario, senha nem SQL com dados.
const { Pool } = require('pg');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');

const N_PING = 50; // concorrencia do ping-db
const N_CLAIMS = 200; // requisicoes do teste de set_config
const CONCURRENCY_CLAIMS = 50;

function fail(msg) {
  console.error(JSON.stringify({ check: 'L1-pooler', error: msg }));
  process.exit(2);
}

function pct(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function buildConfig() {
  const direct = process.env.DATABASE_URL_KEEPALIVE;
  const host = process.env.POOLER_HOST;
  if (!direct) fail('DATABASE_URL_KEEPALIVE ausente no ambiente');
  if (!host) fail('POOLER_HOST ausente no ambiente (ler pelo MCP do Supabase)');
  if (!/pooler\.supabase\.com$/.test(host)) fail('POOLER_HOST nao parece host de pooler; host direto nao e usado');
  const u = new URL(direct);
  const ref = process.env.POOLER_USER_SUFFIX || (u.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/) || [])[1];
  if (!ref) fail('nao foi possivel obter o ref do projeto a partir do host direto');
  return {
    host,
    port: Number(process.env.POOLER_PORT || 6543),
    user: `${decodeURIComponent(u.username)}.${ref}`,
    password: decodeURIComponent(u.password),
    database: (u.pathname || '/postgres').slice(1) || 'postgres',
  };
}

(async () => {
  const cfg = buildConfig();
  const pool = new Pool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    ssl: { rejectUnauthorized: true },
    max: CONCURRENCY_CLAIMS,
    idleTimeoutMillis: 2000,
    connectionTimeoutMillis: 8000,
  });
  const out = { check: 'L1-pooler', host: 'pooler (valor omitido)', port: cfg.port };
  try {
    // 1) Conexao basica.
    await pool.query('SELECT 1');

    // 2) ping-db: 50 concorrentes, consulta simples.
    const pingLat = [];
    let pingErr = 0;
    const pingStart = performance.now();
    await Promise.all(
      Array.from({ length: N_PING }, async () => {
        const t = performance.now();
        try {
          const r = await pool.query('SELECT 1 AS ok');
          if (r.rows[0].ok !== 1) pingErr++;
        } catch (e) {
          pingErr++;
        }
        pingLat.push(performance.now() - t);
      }),
    );
    pingLat.sort((a, b) => a - b);
    out.pingDb = {
      concurrency: N_PING,
      errors: pingErr,
      totalMs: Math.round(performance.now() - pingStart),
      p50Ms: Math.round(pct(pingLat, 0.5)),
      p95Ms: Math.round(pct(pingLat, 0.95)),
    };

    // 3) ping-db-claims: 200 transacoes com set_config local, em lotes de 50 concorrentes.
    //    Cada uma grava um valor unico e confere que le o proprio valor (0 vazamento).
    let match = 0;
    let mismatch = 0;
    let claimErr = 0;
    const claimLat = [];
    // Amostra de pg_stat_activity durante a carga (somente agregados).
    const activitySamples = [];
    const sampler = setInterval(async () => {
      try {
        const r = await pool.query(
          'SELECT usename, state, count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() GROUP BY usename, state ORDER BY 1, 2',
        );
        activitySamples.push(r.rows.map((x) => ({ usename: x.usename ? '(role)' : null, state: x.state, n: x.n })));
      } catch (e) {
        activitySamples.push({ error: 'pg_stat_activity indisponivel para o papel' });
      }
    }, 300);
    const queue = Array.from({ length: N_CLAIMS }, (_, i) => i);
    const worker = async () => {
      while (queue.length) {
        queue.shift();
        const sent = randomUUID().replace(/-/g, '');
        const t = performance.now();
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(`SELECT set_config('app.s09', '${sent}', true)`);
          const r = await client.query("SELECT current_setting('app.s09') AS v");
          await client.query('COMMIT');
          if (r.rows[0].v === sent) match++;
          else mismatch++;
        } catch (e) {
          claimErr++;
          await client.query('ROLLBACK').catch(() => undefined);
        } finally {
          client.release();
        }
        claimLat.push(performance.now() - t);
      }
    };
    const claimStart = performance.now();
    await Promise.all(Array.from({ length: CONCURRENCY_CLAIMS }, worker));
    clearInterval(sampler);
    claimLat.sort((a, b) => a - b);
    out.pingDbClaims = {
      requests: N_CLAIMS,
      concurrency: CONCURRENCY_CLAIMS,
      match,
      mismatch,
      errors: claimErr,
      leaks: mismatch,
      totalMs: Math.round(performance.now() - claimStart),
      p50Ms: Math.round(pct(claimLat, 0.5)),
      p95Ms: Math.round(pct(claimLat, 0.95)),
    };

    // 4) Agregado de pg_stat_activity ao final (conexoes do pooler ao banco, por papel e estado).
    const final = await pool.query(
      'SELECT state, count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() GROUP BY state ORDER BY 1',
    );
    out.pgStatActivityFinal = final.rows;
    out.pgStatActivitySamplesDuringLoad = activitySamples.length;
    out.pgStatActivityMaxByState = activitySamples
      .filter((s) => Array.isArray(s))
      .flat()
      .reduce((acc, x) => {
        acc[x.state || 'null'] = Math.max(acc[x.state || 'null'] || 0, x.n);
        return acc;
      }, {});

    out.allOk = pingErr === 0 && claimErr === 0 && mismatch === 0;
  } catch (e) {
    out.error = `falha de conexao ou consulta: ${e.code || e.name || 'erro'}`;
    out.allOk = false;
  } finally {
    await pool.end().catch(() => undefined);
  }
  console.log(JSON.stringify(out, null, 2));
  process.exitCode = out.allOk ? 0 : 1;
})();
