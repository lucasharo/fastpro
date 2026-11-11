// Linha de base local: sobe o handler empacotado (dist/index.cjs) num servidor HTTP simples.
// Nao imprime valores de ambiente.
const http = require('node:http');
const t0 = Date.now();
const mod = require('../dist/index.cjs');
const handler = mod.default;
const port = Number(process.env.PORT || 3900);
http
  .createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch(() => {
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    });
  })
  .listen(port, () => {
    console.log(JSON.stringify({ ev: 'listening', port, msToListen: Date.now() - t0 }));
  });
