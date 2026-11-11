// H-092 | Guarda de rede dos testes de notificacoes. Ao ser importado, troca os pontos de saida de
// rede (net.Socket.connect, que cobre tls e pg; http/https request e get; fetch) por funcoes que
// FALHAM. Unica excecao: o host do banco de desenvolvimento (lido do ambiente; nunca impresso).
// Tentativas reais vao para guard.denied (o teste de guarda exige lista vazia). Tentativas de prova
// feitas dentro de guard.expectDenied() vao para guard.probes.
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { loadConnectionString } from '../../scripts/lib/env.mjs';

const dbHost = (() => {
  try {
    return new URL(loadConnectionString()).hostname.toLowerCase();
  } catch {
    return null;
  }
})();

const state = { probing: false, denied: [], probes: [] };

function deny(kind, host) {
  const entry = { kind, host: String(host ?? '') };
  if (state.probing) state.probes.push(entry);
  else state.denied.push(entry);
  throw new Error(`rede bloqueada (H-092): ${kind}`);
}

function checkHost(kind, host) {
  const h = String(host ?? 'localhost').toLowerCase();
  if (dbHost !== null && h === dbHost) return;
  deny(kind, h);
}

const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  // net.connect repassa as opcoes normalizadas em array: desembrulha antes de ler o host.
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (first !== null && typeof first === 'object') checkHost('net.connect', first.host);
  else if (typeof first === 'number')
    checkHost('net.connect', typeof args[1] === 'string' ? args[1] : undefined);
  else deny('net.connect(caminho)', first);
  return origConnect.apply(this, args);
};

const hostFromOptions = (a) => {
  if (typeof a === 'string') return new URL(a).hostname;
  if (a instanceof URL) return a.hostname;
  return a?.hostname ?? a?.host ?? 'localhost';
};

for (const mod of [http, https]) {
  for (const fn of ['request', 'get']) {
    const orig = mod[fn];
    mod[fn] = function guardedHttp(...args) {
      checkHost(`${mod === http ? 'http' : 'https'}.${fn}`, hostFromOptions(args[0]));
      return orig.apply(this, args);
    };
  }
}

globalThis.fetch = (input) => {
  const raw = typeof input === 'string' ? input : (input?.url ?? '');
  const host = (() => {
    try {
      return new URL(raw).hostname;
    } catch {
      return '';
    }
  })();
  checkHost('fetch', host);
  return Promise.reject(new Error('rede bloqueada (H-092): fetch'));
};

/** Executa fn esperando bloqueio; devolve o erro lancado (null se nao foi bloqueada). */
export function expectDenied(fn) {
  state.probing = true;
  try {
    fn();
  } catch (err) {
    return err;
  } finally {
    state.probing = false;
  }
  return null;
}

export const guard = Object.freeze({
  get denied() {
    return state.denied;
  },
  get probes() {
    return state.probes;
  },
  dbHost,
  expectDenied,
});
