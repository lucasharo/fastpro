// Keep-alive manual (H-010; desenho 28-DESENHO-H010.md §2): uma consulta de LEITURA ao banco de
// desenvolvimento, com o papel app_keepalive (sem privilegio em tabela). Nao cria tabela, linha ou log
// no banco. Ate 3 tentativas tecnicas (AGENTS, item 6). Registro fora do repositorio: so data, hora,
// resultado e etapa (KA-02). Dependencias injetadas para os testes offline.
export const MAX_ATTEMPTS = 3;
export const STALE_DAYS = 4; // aviso quando a ultima execucao ok passou de 4 dias (margem de 2 dias)
export const KEEPALIVE_QUERY =
  '/*fp:keepalive*/ select 1 as ok, (select count(*)::int from pg_catalog.pg_namespace) as esquemas';

/**
 * Executa ate MAX_ATTEMPTS tentativas. `connect()` devolve um cliente com query/end. Etapas de falha:
 * conectar (sem conexao), consultar (erro do servidor), timeout (SQLSTATE 57014).
 */
export async function runKeepAlive({ connect, pause, pauseMs = 3000, maxAttempts = MAX_ATTEMPTS }) {
  let etapa = 'conectar';
  for (let tentativa = 1; tentativa <= maxAttempts; tentativa += 1) {
    let client = null;
    try {
      client = await connect();
    } catch {
      etapa = 'conectar';
    }
    if (client) {
      try {
        await client.query(KEEPALIVE_QUERY);
        return { ok: true, etapa: null, tentativas: tentativa };
      } catch (err) {
        etapa = err && err.code === '57014' ? 'timeout' : 'consultar';
      } finally {
        await client.end().catch(() => {});
      }
    }
    if (tentativa < maxAttempts) await pause(pauseMs);
  }
  return { ok: false, etapa, tentativas: maxAttempts };
}

/** Idade, em dias, da ultima linha "ok" do registro (null se nao houver). */
export function lastOkAgeDays(logText, now) {
  let last = null;
  for (const line of logText.split(/\r?\n/)) {
    const m = /^(\d{8}T\d{6}Z) ok$/.exec(line.trim());
    if (m) last = m[1];
  }
  if (last === null) return null;
  const y = last.slice(0, 4);
  const mo = last.slice(4, 6);
  const d = last.slice(6, 8);
  const hh = last.slice(9, 11);
  const mm = last.slice(11, 13);
  const ss = last.slice(13, 15);
  const when = Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss);
  return Math.floor((now - when) / 86400000);
}
