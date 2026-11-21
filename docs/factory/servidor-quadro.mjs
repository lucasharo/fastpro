// Servidor local do quadro da fabrica. Escuta so em 127.0.0.1.
// Serve quadro.html e quadro-dados.js, le e move Issues em quadro-status.md (arquivo local, sem GitHub).
// Uso: node docs/factory/servidor-quadro.mjs   e depois abra http://127.0.0.1:8765/quadro.html
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const pasta = dirname(fileURLToPath(import.meta.url));
const PORTA = 8765;
const COLUNAS = ['Backlog', 'Product Owner', 'Arquitetura', 'Desenvolvimento', 'Code Review', 'QA', 'Aguardando aprovação', 'Concluído', 'Descartado', 'Bloqueado'];
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function lerQuadro() {
  return readFileSync(join(pasta, 'quadro-status.md'), 'utf8');
}

// Estrutura: lista de colunas com as Issues de cada uma.
function interpretar(md) {
  const colunas = [];
  let atual = null;
  for (const linha of md.split('\n')) {
    const cab = linha.match(/^## (.+?)(?: \(\d+\))?\s*$/);
    if (cab) { atual = { nome: cab[1].trim(), itens: [] }; colunas.push(atual); continue; }
    const item = linha.match(/^\| #(\d+) \| (.+?) \|\s*$/);
    if (item && atual) atual.itens.push({ numero: Number(item[1]), titulo: item[2].trim() });
  }
  return colunas;
}

// Recompoe o markdown: mantem o cabecalho e o texto fora das tabelas, reescreve as secoes de colunas.
function reescrever(md, colunas) {
  const partes = md.split(/\n(?=## )/);
  const cabecalho = partes[0];
  const restante = partes.slice(1).filter(p => !/^## /.test(p) || true);
  const saida = [cabecalho.trimEnd()];
  for (const col of colunas) {
    if (col.itens.length === 0 && !['Backlog', 'Concluído'].includes(col.nome)) {
      // coluna vazia: mantem o cabecalho com contagem zero
    }
    let bloco = `## ${col.nome} (${col.itens.length})\n\n`;
    if (col.itens.length) {
      bloco += '| Issue | Título |\n|---|---|\n';
      for (const i of col.itens) bloco += `| #${i.numero} | ${i.titulo} |\n`;
    }
    saida.push(bloco.trimEnd());
  }
  return saida.join('\n\n') + '\n';
}

function gerarDados() {
  execFileSync(process.execPath, [join(pasta, 'gerar-quadro-dados.mjs')], { stdio: 'pipe' });
}

function mover(numero, destino) {
  if (!COLUNAS.includes(destino)) throw new Error('coluna invalida');
  const md = lerQuadro();
  const colunas = interpretar(md);
  let achado = null;
  for (const col of colunas) {
    const idx = col.itens.findIndex(i => i.numero === numero);
    if (idx >= 0) { achado = col.itens.splice(idx, 1)[0]; break; }
  }
  if (!achado) throw new Error('Issue nao encontrada');
  const dest = colunas.find(c => c.nome === destino);
  if (!dest) throw new Error('coluna de destino ausente');
  dest.itens.push(achado);
  // Mantem a ordem numerica dentro da coluna.
  dest.itens.sort((a, b) => a.numero - b.numero);
  // Garante que todas as colunas aceitas existam no arquivo.
  for (const nome of COLUNAS) if (!colunas.find(c => c.nome === nome)) colunas.push({ nome, itens: [] });
  const novo = reescrever(md, colunas);
  writeFileSync(join(pasta, 'quadro-status.md'), novo, 'utf8');
  gerarDados();
  return { numero, de: null, para: destino };
}

function enviar(res, status, tipo, corpo) {
  res.writeHead(status, { 'Content-Type': tipo, 'Cache-Control': 'no-store' });
  res.end(corpo);
}

createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORTA}`);
  if (req.method === 'GET' && url.pathname === '/api/quadro') {
    const exec = JSON.parse(readFileSync(join(pasta, 'quadro-execucao.json'), 'utf8'));
    return enviar(res, 200, 'application/json; charset=utf-8', JSON.stringify({ colunas: interpretar(lerQuadro()), ordem: COLUNAS, executando: exec.executando, pronto: exec.pronto || [] }));
  }
  if (req.method === 'POST' && url.pathname === '/api/mover') {
    let corpo = '';
    req.on('data', d => { corpo += d; if (corpo.length > 10000) req.destroy(); });
    req.on('end', () => {
      try {
        const { numero, destino } = JSON.parse(corpo);
        const r = mover(Number(numero), String(destino));
        enviar(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true, ...r }));
      } catch (e) {
        enviar(res, 400, 'application/json; charset=utf-8', JSON.stringify({ ok: false, erro: e.message }));
      }
    });
    return;
  }
  if (req.method === 'GET') {
    const nome = url.pathname === '/' ? 'quadro.html' : url.pathname.slice(1);
    const arq = join(pasta, nome);
    if (nome.includes('..') || !existsSync(arq)) return enviar(res, 404, 'text/plain; charset=utf-8', 'nao encontrado');
    return enviar(res, 200, TIPOS[extname(arq)] || 'application/octet-stream', readFileSync(arq));
  }
  enviar(res, 405, 'text/plain; charset=utf-8', 'metodo nao permitido');
}).listen(PORTA, '127.0.0.1', () => {
  console.log(`Quadro em http://127.0.0.1:${PORTA}/quadro.html`);
});
