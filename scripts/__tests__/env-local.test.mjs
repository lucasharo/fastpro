// Testes da biblioteca do .env.local (Issue #156, F1). Usam so texto e pasta temporaria, nunca o .env.local real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  aplicarPreenchimentos,
  gravarAtomico,
  hashDoValor,
  lerEstado,
} from '../lib/env-local.mjs';

test('lerEstado informa presenca, tamanho e hash sem guardar o valor', () => {
  const estado = lerEstado('A=segredo123\nB=\n# C=x\nD=""\n');
  assert.deepEqual(estado.get('A'), { preenchida: true, tamanho: 10, hash: hashDoValor('segredo123') });
  assert.equal(estado.get('B').preenchida, false);
  assert.equal(estado.has('C'), false);
  assert.equal(estado.get('D').preenchida, false);
  assert.equal(JSON.stringify([...estado]).includes('segredo123'), false);
});

test('aplicarPreenchimentos preenche vazio, mantem preenchido, acrescenta ausente e preserva CRLF e comentarios', () => {
  const texto = '# topo\r\nX=1\r\nY=\r\n';
  const r = aplicarPreenchimentos(texto, [
    ['X', '9'],
    ['Y', '2'],
    ['Z', '3'],
  ]);
  assert.deepEqual(r.geradas, ['Y', 'Z']);
  assert.deepEqual(r.mantidas, ['X']);
  assert.ok(r.texto.startsWith('# topo\r\nX=1\r\nY=2\r\n'));
  assert.ok(r.texto.endsWith('Z=3\r\n'));
  assert.equal(r.texto.includes('\n') && !r.texto.replace(/\r\n/g, '').includes('\n'), true);
});

test('aplicarPreenchimentos sem nenhuma entrada nova devolve o mesmo texto', () => {
  const texto = 'A=1\nB=2\n';
  const r = aplicarPreenchimentos(texto, [['A', 'x']]);
  assert.equal(r.texto, texto);
  assert.deepEqual(r.geradas, []);
});

test('gravarAtomico grava o conteudo e nao deixa arquivo temporario', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fp-envlocal-'));
  try {
    const caminho = join(dir, '.env.local');
    gravarAtomico(caminho, 'A=1\n');
    assert.equal(readFileSync(caminho, 'utf8'), 'A=1\n');
    assert.deepEqual(readdirSync(dir), ['.env.local']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
