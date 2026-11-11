// L3 (S-09): verifica o limite de corpo de 4 MB no parser do Nest, com 413 proprio.
// Sobe o handler empacotado (dist/index.cjs) em porta efemera, envia corpos JSON de
// tamanhos conhecidos, imprime um resumo JSON e fecha o proprio servidor.
// Uso: node scripts/body-limit-check.cjs   (depois de: npm run bundle)
const http = require('node:http');
const { performance } = require('node:perf_hooks');
const handler = require('../dist/index.cjs').default;

const MB = 1024 * 1024;
// Tamanhos em bytes do corpo JSON enviado. Limite configurado: 4 MB (4.194.304 bytes).
const cases = [
  { label: '1.0 MB', bytes: 1.0 * MB, expect: 200 },
  { label: '3.5 MB', bytes: 3.5 * MB, expect: 200 },
  { label: '4.0 MB exato (limite, aceito)', bytes: 4 * MB, expect: 200 },
  { label: '4.0 MB + 1 byte', bytes: 4 * MB + 1, expect: 413 },
  { label: '4.5 MB', bytes: 4.5 * MB, expect: 413 },
  { label: '5.0 MB', bytes: 5 * MB, expect: 413 },
];

function payloadOfBytes(target) {
  // Corpo JSON valido de tamanho aproximado 'target' bytes: {"d":"aaa..."}
  const overhead = Buffer.byteLength('{"d":""}');
  return Buffer.from(JSON.stringify({ d: 'a'.repeat(Math.max(0, target - overhead)) }));
}

function post(port, body) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/v1/echo',
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': body.length },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () =>
          resolve({ status: res.statusCode, ms: Math.round(performance.now() - t0), body: data.slice(0, 160) }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

(async () => {
  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch(() => {
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const results = [];
  try {
    for (const c of cases) {
      const body = payloadOfBytes(c.bytes);
      const r = await post(port, body);
      results.push({
        label: c.label,
        sentBytes: body.length,
        status: r.status,
        expected: c.expect,
        ok: r.status === c.expect,
        ms: r.ms,
        bodyHead: r.status === 413 ? r.body : undefined,
      });
    }
  } finally {
    await new Promise((r) => server.close(r));
  }
  const summary = { check: 'L3-body-limit-4mb', allOk: results.every((x) => x.ok), results };
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.allOk ? 0 : 1;
})().catch((err) => {
  console.error(JSON.stringify({ check: 'L3-body-limit-4mb', error: String(err && err.message) }));
  process.exitCode = 2;
});
