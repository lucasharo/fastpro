// Testes do gerador de chaves DEV (Issue #156, F1). Arquivos em pasta temporaria; nunca o .env.local real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executar, planejar } from '../gerar-chaves-dev.mjs';
import { hashDoValor, lerEstado } from '../lib/env-local.mjs';

const CHAVE_LONGA = 'a'.repeat(40);
let contador = 0;
const gerarFixo = () => {
  contador += 1;
  return `chave${String(contador).padStart(3, '0')}`;
};

test('primeira execucao gera o grupo rotas-minimas e literais de ambiente', () => {
  const r = planejar(`CATALOG_RATE_HMAC_KEY=${CHAVE_LONGA}\nSITE_URL=http://127.0.0.1:3000\n`, 'rotas-minimas', gerarFixo);
  assert.deepEqual(r.geradas, [
    'PEPPER_EMAIL_HMAC',
    'PEPPER_CODE_HMAC',
    'PEPPER_IP_HMAC',
    'SESSION_COOKIE_SECRET',
    'JOBS_TICK_SECRET',
    'DRAFT_IP_HMAC_KEY',
    'ADDRESS_HASH_KEY',
    'ADDRESS_ENC_KEY',
    'PHONE_ENC_KEY',
    'REQUEST_PUBLISH_HMAC_KEY',
    'DISCOVERY_CURSOR_KEY',
    'PROFILE_RATE_HMAC_KEY',
    'DATA_ENC_KEY_V1',
    'DOCUMENT_HMAC_KEY',
    'APP_ENV',
    'APP_BASE_URL',
    'DATA_ENC_KEY_ACTIVE_VERSION',
    'MAPBOX_TEMP_SOFT_LIMIT',
    'MAPBOX_TEMP_HARD_LIMIT',
  ]);
  assert.deepEqual(r.curtas, []);
});

test('segunda execucao gera zero e nao altera valores preexistentes', () => {
  const primeira = planejar(`CATALOG_RATE_HMAC_KEY=${CHAVE_LONGA}\n`, 'rotas-minimas', gerarFixo);
  const antes = lerEstado(primeira.texto);
  const segunda = planejar(primeira.texto, 'rotas-minimas', gerarFixo);
  assert.deepEqual(segunda.geradas, []);
  const depois = lerEstado(segunda.texto);
  for (const [nome, e] of antes) {
    if (e.preenchida) assert.equal(depois.get(nome).hash, e.hash, `hash mudou em ${nome}`);
  }
});

test('chave preenchida nunca e substituida mesmo quando existe no grupo', () => {
  const r = planejar('PEPPER_EMAIL_HMAC=valor-antigo-do-dono\n', 'rotas-minimas', gerarFixo);
  assert.equal(r.texto.includes('PEPPER_EMAIL_HMAC=valor-antigo-do-dono'), true);
  assert.equal(r.geradas.includes('PEPPER_EMAIL_HMAC'), false);
  assert.equal(r.mantidas.includes('PEPPER_EMAIL_HMAC'), true);
});

test('CATALOG_RATE_HMAC_KEY curta e reportada so pelo nome, sem trocar o valor', () => {
  const r = planejar('CATALOG_RATE_HMAC_KEY=curta\n', 'rotas-minimas', gerarFixo);
  assert.deepEqual(r.curtas, ['CATALOG_RATE_HMAC_KEY']);
  assert.equal(r.texto.includes('CATALOG_RATE_HMAC_KEY=curta'), true);
});

test('grupo desconhecido e recusado', () => {
  assert.throws(() => planejar('', 'nao-existe', gerarFixo), /grupo desconhecido/);
});

test('executar sem arquivo devolve codigo 2 e nao cria arquivo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fp-chaves-'));
  try {
    const r = executar({ caminho: join(dir, '.env.local') });
    assert.equal(r.codigo, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executar grava, a segunda execucao gera zero e a saida nunca traz valor gerado', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fp-chaves-'));
  try {
    const caminho = join(dir, '.env.local');
    writeFileSync(caminho, `CATALOG_RATE_HMAC_KEY=${CHAVE_LONGA}\nSITE_URL=http://127.0.0.1:3000\n`, 'utf8');
    const primeira = executar({ caminho, gerar: gerarFixo });
    assert.equal(primeira.codigo, 0);
    assert.equal(primeira.geradas.length, 19);
    const gravado = readFileSync(caminho, 'utf8');
    const valorGerado = /^PEPPER_EMAIL_HMAC=(.*)$/m.exec(gravado)[1];
    assert.equal(primeira.linhas.join('\n').includes(valorGerado), false);
    const segunda = executar({ caminho, gerar: gerarFixo });
    assert.equal(segunda.codigo, 0);
    assert.equal(segunda.geradas.length, 0);
    assert.equal(lerEstado(readFileSync(caminho, 'utf8')).get('PEPPER_EMAIL_HMAC').hash, hashDoValor(valorGerado));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('copia MAPBOX_ACCESS_TOKEN do nome de servidor ja existente e nunca sobrescreve', () => {
  const r = planejar(`MAPBOX_ACCESS_TOKEN_SERVER=${'t'.repeat(20)}
`, 'rotas-minimas', gerarFixo);
  assert.ok(r.geradas.includes('MAPBOX_ACCESS_TOKEN'));
  assert.match(r.texto, /^MAPBOX_ACCESS_TOKEN=t{20}$/m);
  const r2 = planejar(
    `MAPBOX_ACCESS_TOKEN_SERVER=${'t'.repeat(20)}
MAPBOX_ACCESS_TOKEN=${'u'.repeat(20)}
`,
    'rotas-minimas',
    gerarFixo,
  );
  assert.equal(r2.geradas.includes('MAPBOX_ACCESS_TOKEN'), false);
  assert.match(r2.texto, /^MAPBOX_ACCESS_TOKEN=u{20}$/m);
});

test('chaves de cifra saem em base64 de 32 bytes (formato lido pelo codigo)', () => {
  const r = planejar('', 'rotas-minimas', gerarFixo);
  for (const nome of ['DATA_ENC_KEY_V1', 'DOCUMENT_HMAC_KEY']) {
    const linha = r.texto.split(/\r?\n/).find((l) => l.startsWith(`${nome}=`));
    const valor = linha.slice(nome.length + 1);
    assert.equal(Buffer.from(valor, 'base64').length, 32, nome);
  }
});
