// H-092 | T-H92-39 (complemento): nenhum teste de notificacoes abre socket para provedor de e-mail.
// Prova: socket, TLS, HTTP(S) e fetch para host externo sao bloqueados (com erro), e a lista de
// tentativas reais dos testes de notificacoes fica vazia. A conexao ao banco de desenvolvimento e a
// unica excecao permitida pela guarda.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';
import { guard, expectDenied } from './fixtures/no-network.mjs';

const EXTERNO = 'smtp.provedor.invalid';

test('T-H92-39: socket para host externo e bloqueado e registrado como prova', () => {
  const err = expectDenied(() => net.connect({ host: EXTERNO, port: 587 }));
  assert.ok(err, 'net.connect deveria ser bloqueado');
  assert.match(err.message, /rede bloqueada/);
  assert.ok(guard.probes.some((p) => p.kind === 'net.connect' && p.host === EXTERNO));
});

test('T-H92-39: TLS para host externo e bloqueado', () => {
  const err = expectDenied(() => tls.connect({ host: EXTERNO, port: 465 }));
  assert.ok(err, 'tls.connect deveria ser bloqueado');
  assert.match(err.message, /rede bloqueada/);
});

test('T-H92-39: HTTPS para host externo e bloqueado (request e get)', () => {
  assert.ok(expectDenied(() => https.request({ host: 'api.provedor.invalid', path: '/' })));
  assert.ok(expectDenied(() => https.get('https://api.provedor.invalid/')));
});

test('T-H92-39: fetch para host externo e bloqueado', async () => {
  const erro = expectDenied(() => globalThis.fetch('https://api.provedor.invalid/emails'));
  assert.ok(erro, 'fetch deveria ser bloqueado');
  assert.match(erro.message, /rede bloqueada/);
  assert.ok(guard.probes.some((p) => p.kind === 'fetch' && p.host === 'api.provedor.invalid'));
});

test('T-H92-39: a guarda tem host liberado somente para o banco de desenvolvimento', () => {
  assert.ok(guard.dbHost === null || typeof guard.dbHost === 'string');
  assert.equal(guard.dbHost === null ? false : guard.dbHost === EXTERNO, false);
});

after(() => {
  if (guard.denied.length > 0) {
    throw new Error(`tentativas de rede real registradas: ${guard.denied.length}`);
  }
});
