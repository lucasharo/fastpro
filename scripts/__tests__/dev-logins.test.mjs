// Testes do provisionador dos logins DEV (Issue #156, F2). Sem banco: so funcoes puras.
// As URLs de teste sao montadas pela API do URL (dados sinteticos): nenhum literal de conexao no repositorio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';
import { derivarScram, derivarUrl, recusaAmbiente, verificadorScram } from '../../packages/db/scripts/dev-logins.mjs';

function urlFicticia(host, usuario, senha, porta = '5432', banco = 'postgres') {
  const u = new URL('postgresql://placeholder/x');
  u.hostname = host;
  u.port = porta;
  u.username = usuario;
  u.password = senha;
  u.pathname = `/${banco}`;
  return u.toString();
}

test('SCRAM-SHA-256 bate com o vetor da RFC 7677 (ClientProof)', () => {
  const salt = Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64');
  const { clientKey, storedKey } = derivarScram('pencil', salt, 4096);
  const authMessage =
    'n=user,r=rOprNGfwEbeRWgbNEkqO,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096,c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0';
  const signature = createHmac('sha256', storedKey).update(authMessage).digest();
  const proof = Buffer.alloc(clientKey.length);
  for (let i = 0; i < clientKey.length; i += 1) proof[i] = clientKey[i] ^ signature[i];
  assert.equal(proof.toString('base64'), 'dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=');
});

test('verificador SCRAM tem o formato aceito pelo PostgreSQL e nao contem a senha', () => {
  const v = verificadorScram('segredo-de-teste-123456', Buffer.alloc(16, 7));
  assert.match(v, /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
  assert.equal(v.includes('segredo-de-teste'), false);
});

test('derivarUrl troca usuario e senha e mantem host, porta e banco', () => {
  const u = new URL(derivarUrl(urlFicticia('db.abcdefghijklmnopqrst.supabase.co', 'postgres', 'antiga'), 'fastpro_dev_api', 'nova123'));
  assert.equal(u.username, 'fastpro_dev_api');
  assert.equal(u.password, 'nova123');
  assert.equal(u.hostname, 'db.abcdefghijklmnopqrst.supabase.co');
  assert.equal(u.port, '5432');
  assert.equal(u.pathname, '/postgres');
});

test('derivarUrl preserva o sufixo de projeto do pooler (usuario papel.ref)', () => {
  const u = new URL(derivarUrl(urlFicticia('aws-0.pooler.supabase.com', 'postgres.abcdefghijklmnopqrst', 'antiga'), 'fastpro_dev_system', 'x'));
  assert.equal(u.username, 'fastpro_dev_system.abcdefghijklmnopqrst');
});

const REF = 'abcdefghijklmnopqrst';
const ENV_OK = { SUPABASE_URL: `https://${REF}.supabase.co`, APP_ENV: 'local' };

test('trava aceita o banco DEV pelo host direto com o ref do projeto', () => {
  assert.equal(recusaAmbiente(ENV_OK, urlFicticia(`db.${REF}.supabase.co`, 'postgres', 'x')), null);
});

test('trava aceita o banco DEV pelo pooler com usuario postgres.<ref>', () => {
  assert.equal(recusaAmbiente(ENV_OK, urlFicticia('aws-0.pooler.supabase.com', `postgres.${REF}`, 'x')), null);
});

test('trava recusa APP_ENV de producao, host de outro projeto, ref ausente e parametro fora da lista', () => {
  assert.match(recusaAmbiente({ ...ENV_OK, APP_ENV: 'production' }, urlFicticia(`db.${REF}.supabase.co`, 'postgres', 'x')), /producao/);
  assert.notEqual(recusaAmbiente(ENV_OK, urlFicticia('db.zzzzzzzzzzzzzzzzzzzz.supabase.co', 'postgres', 'x')), null);
  assert.notEqual(recusaAmbiente({}, urlFicticia(`db.${REF}.supabase.co`, 'postgres', 'x')), null);
  assert.notEqual(recusaAmbiente(ENV_OK, `${urlFicticia(`db.${REF}.supabase.co`, 'postgres', 'x')}?host=127.0.0.1`), null);
  assert.notEqual(recusaAmbiente(ENV_OK, urlFicticia('127.0.0.1', 'postgres', 'x')), null);
});
